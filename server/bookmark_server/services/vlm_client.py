from __future__ import annotations

from typing import Any

from openai import OpenAI


SAMPLING_FIELDS = {
    "temperature",
    "top_p",
    "max_tokens",
    "presence_penalty",
    "frequency_penalty",
    "seed",
}
DEFAULT_SAMPLING = {"temperature": 0}
THINKING_WARNING = (
    "Thinking mode is not mapped for this VLM API; using the API default behavior. "
    "Set extra_body on the API configuration to pass provider-specific thinking parameters."
)


def build_chat_completion_options(
    *,
    base_url: str,
    model: str,
    sampling: dict[str, Any] | None = None,
    thinking_mode: str | None = None,
    extra_body: dict[str, Any] | None = None,
    stream: bool = False,
) -> tuple[dict[str, Any], list[str]]:
    options: dict[str, Any] = {"model": model}
    warnings: list[str] = []
    for key, value in (sampling or DEFAULT_SAMPLING).items():
        if key in SAMPLING_FIELDS and value is not None:
            options[key] = value
    if stream:
        options["stream"] = True

    mode = (thinking_mode or "auto").strip().lower()
    user_extra_body = dict(extra_body or {})
    generated_extra_body: dict[str, Any] = {}
    if mode in {"on", "off"}:
        if _is_qwen_provider(base_url, model):
            generated_extra_body["enable_thinking"] = mode == "on"
        elif _is_openai_reasoning_provider(base_url, model):
            options["reasoning_effort"] = "medium" if mode == "on" else "none"
        elif not user_extra_body:
            warnings.append(THINKING_WARNING)

    merged_extra_body = {**generated_extra_body, **user_extra_body}
    if merged_extra_body:
        options["extra_body"] = merged_extra_body
    return options, warnings


def llm_request_profile(
    *,
    base_url: str,
    model: str,
    sampling: dict[str, Any] | None = None,
    thinking_mode: str | None = None,
    extra_body: dict[str, Any] | None = None,
) -> str:
    import json

    options, _warnings = build_chat_completion_options(
        base_url=base_url,
        model=model,
        sampling=sampling,
        thinking_mode=thinking_mode,
        extra_body=extra_body,
    )
    return json.dumps(options, ensure_ascii=True, sort_keys=True, default=str)


def _is_qwen_provider(base_url: str, model: str) -> bool:
    haystack = f"{base_url} {model}".lower()
    return "dashscope.aliyuncs.com" in haystack or "qwen" in haystack or "qwq" in haystack


def _is_openai_reasoning_provider(base_url: str, model: str) -> bool:
    haystack = f"{base_url} {model}".lower()
    if "openai.azure.com" not in haystack and "api.openai.com" not in haystack:
        return False
    return model.lower().startswith(("o1", "o3", "o4", "gpt-5"))


def request_toc_from_vlm(
    image_data_urls: list[str],
    prompt: str,
    api_key: str,
    base_url: str,
    model: str,
    completion_options: dict[str, Any] | None = None,
) -> str:
    client = OpenAI(api_key=api_key, base_url=base_url)
    content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
    for data_url in image_data_urls:
        content.append({"type": "image_url", "image_url": {"url": data_url}})

    options = {"model": model, "temperature": 0, **(completion_options or {})}
    completion = client.chat.completions.create(
        messages=[{"role": "user", "content": content}],
        **options,
    )

    return _read_completion_text(completion.choices[0].message.content)


def request_chat_from_vlm(
    messages: list[dict[str, Any]],
    api_key: str,
    base_url: str,
    model: str,
    completion_options: dict[str, Any] | None = None,
) -> str:
    client = OpenAI(api_key=api_key, base_url=base_url)
    options = {"model": model, "temperature": 0, **(completion_options or {})}
    completion = client.chat.completions.create(
        messages=messages,
        **options,
    )
    return _read_completion_text(completion.choices[0].message.content)


def request_chat_from_vlm_stream(
    messages: list[dict[str, Any]],
    api_key: str,
    base_url: str,
    model: str,
    completion_options: dict[str, Any] | None = None,
):
    client = OpenAI(api_key=api_key, base_url=base_url)
    options = {"model": model, "temperature": 0, "stream": True, **(completion_options or {})}
    stream = client.chat.completions.create(
        messages=messages,
        **options,
    )
    for chunk in stream:
        choices = getattr(chunk, "choices", None) or []
        if not choices:
            continue
        delta = getattr(choices[0], "delta", None)
        reasoning_text = _read_completion_delta_text(_read_delta_field(delta, "reasoning_content"))
        if reasoning_text:
            yield {"type": "thinking", "text": reasoning_text}
        text = _read_completion_delta_text(getattr(delta, "content", None))
        if text:
            yield {"type": "content", "text": text}


def _read_completion_text(message_content: Any) -> str:
    if isinstance(message_content, str):
        return message_content

    if isinstance(message_content, list):
        chunks: list[str] = []
        for part in message_content:
            if isinstance(part, dict) and part.get("type") == "text":
                text = part.get("text")
                if isinstance(text, str):
                    chunks.append(text)
        if chunks:
            return "\n".join(chunks)

    raise ValueError("VLM response does not include readable text content")


def _read_completion_delta_text(delta_content: Any) -> str:
    if isinstance(delta_content, str):
        return delta_content

    if isinstance(delta_content, list):
        chunks: list[str] = []
        for part in delta_content:
            if isinstance(part, dict) and part.get("type") == "text":
                text = part.get("text")
                if isinstance(text, str):
                    chunks.append(text)
        return "".join(chunks)

    return ""


def _read_delta_field(delta: Any, field: str) -> Any:
    value = getattr(delta, field, None)
    if value is not None:
        return value
    model_extra = getattr(delta, "model_extra", None)
    if isinstance(model_extra, dict):
        return model_extra.get(field)
    if isinstance(delta, dict):
        return delta.get(field)
    return None
