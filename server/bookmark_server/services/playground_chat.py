from __future__ import annotations

import json
from typing import Any, Iterator
from uuid import uuid4

from ..schemas.playground import (
    PLAYGROUND_DPI,
    PlaygroundChatPayload,
    PlaygroundMessagePayload,
    PlaygroundSessionMessagePayload,
)
from . import runtime
from .project_queries import render_project_page
from .provider_config import get_verified_provider, provider_completion_options
from .projects import utc_now_iso
from .toc_extraction import request_chat_from_vlm, request_chat_from_vlm_stream


class PlaygroundChatNotFoundError(KeyError):
    pass


def get_playground_chat(chat_id: str) -> dict[str, Any]:
    try:
        return runtime.store.get_playground_chat(chat_id)
    except KeyError as exc:
        raise PlaygroundChatNotFoundError(chat_id) from exc


def playground_messages(payload: PlaygroundChatPayload) -> list[dict[str, Any]]:
    if not payload.messages:
        raise ValueError("At least one message is required")
    converted: list[dict[str, Any]] = []
    for message in payload.messages:
        if message.role not in {"user", "assistant", "system"}:
            raise ValueError("Unsupported playground message role")
        if message.role == "assistant":
            converted.append({"role": "assistant", "content": message.content})
            continue

        attachments = message.attachments if message.role == "user" else []
        if not attachments:
            converted.append({"role": message.role, "content": message.content})
            continue

        parts: list[dict[str, Any]] = [{"type": "text", "text": message.content}]
        for attachment in attachments:
            if attachment.type != "pdf_page":
                raise ValueError("Unsupported playground attachment type")
            if attachment.dpi != PLAYGROUND_DPI:
                raise ValueError(f"Playground PDF pages must use {PLAYGROUND_DPI} DPI")
            rendered = render_project_page(attachment.project_id, attachment.page, PLAYGROUND_DPI)
            if str(rendered["sha256"]) != attachment.sha256:
                raise RuntimeError("PDF page rendering changed; insert the page again")
            parts.append({"type": "image_url", "image_url": {"url": rendered["data_url"]}})
        converted.append({"role": message.role, "content": parts})
    return converted


def playground_message_to_vlm(message: PlaygroundMessagePayload) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    if message.role != "user":
        raise ValueError("Playground chat sends must use a user message")

    rendered_attachments: list[dict[str, Any]] = []
    if not message.attachments:
        return {"role": "user", "content": message.content}, rendered_attachments

    parts: list[dict[str, Any]] = [{"type": "text", "text": message.content}]
    for attachment in message.attachments:
        if attachment.type != "pdf_page":
            raise ValueError("Unsupported playground attachment type")
        if attachment.dpi != PLAYGROUND_DPI:
            raise ValueError(f"Playground PDF pages must use {PLAYGROUND_DPI} DPI")
        rendered = render_project_page(attachment.project_id, attachment.page, PLAYGROUND_DPI)
        if str(rendered["sha256"]) != attachment.sha256:
            raise RuntimeError("PDF page rendering changed; insert the page again")
        parts.append({"type": "image_url", "image_url": {"url": rendered["data_url"]}})
        rendered_attachments.append(
            {
                "id": uuid4().hex,
                "type": "pdf_page",
                "project_id": attachment.project_id,
                "page": attachment.page,
                "dpi": attachment.dpi,
                "sha256": attachment.sha256,
                "name": f"page {attachment.page}",
                "data_url": rendered["data_url"],
            }
        )
    return {"role": "user", "content": parts}, rendered_attachments


def stored_playground_message(
    *,
    role: str,
    content: str,
    message_id: str | None = None,
    attachments: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "id": message_id or uuid4().hex,
        "role": role,
        "content": content,
        "created_at": utc_now_iso(),
        "attachments": attachments or [],
    }


def sse_event(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def playground_stream_chunk(chunk: Any) -> tuple[str, str]:
    if isinstance(chunk, str):
        return "content", chunk
    if isinstance(chunk, dict):
        kind = str(chunk.get("type") or "content")
        if kind not in {"content", "thinking"}:
            kind = "content"
        return kind, str(chunk.get("text") or "")
    return "content", str(chunk or "")


def save_rendered_attachments(chat_id: str, rendered_attachments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    stored_attachments: list[dict[str, Any]] = []
    for rendered_attachment in rendered_attachments:
        attachment_url = runtime.store.save_playground_attachment(
            chat_id,
            str(rendered_attachment["id"]),
            str(rendered_attachment["data_url"]),
        )
        stored = {key: value for key, value in rendered_attachment.items() if key != "data_url"}
        stored["url"] = attachment_url
        stored["data_url"] = attachment_url
        stored_attachments.append(stored)
    return stored_attachments


def send_playground_chat_message(chat_id: str, payload: PlaygroundSessionMessagePayload) -> dict[str, Any]:
    get_playground_chat(chat_id)
    provider = get_verified_provider(payload.provider_id)
    vlm_message, rendered_attachments = playground_message_to_vlm(payload.message)
    completion_options, warnings = provider_completion_options(provider, thinking_mode=payload.thinking_mode)
    content = request_chat_from_vlm(
        [vlm_message],
        api_key=str(provider["api_key"]),
        base_url=str(provider["base_url"]),
        model=str(provider["model"]),
        completion_options=completion_options,
    )
    stored_attachments = save_rendered_attachments(chat_id, rendered_attachments)
    user_message = stored_playground_message(
        role="user",
        content=payload.message.content,
        message_id=payload.message.id,
        attachments=stored_attachments,
    )
    assistant_message = stored_playground_message(role="assistant", content=content)
    chat = runtime.store.append_playground_exchange(
        chat_id,
        str(provider["id"]),
        payload.thinking_mode,
        user_message,
        assistant_message,
    )
    return {"chat": chat, "message": assistant_message, "warnings": warnings, **runtime.store.list_playground_chats()}


def stream_playground_chat_message(chat_id: str, payload: PlaygroundSessionMessagePayload) -> Iterator[str]:
    get_playground_chat(chat_id)
    provider = get_verified_provider(payload.provider_id)
    vlm_message, rendered_attachments = playground_message_to_vlm(payload.message)
    completion_options, warnings = provider_completion_options(
        provider,
        stream=True,
        thinking_mode=payload.thinking_mode,
    )
    show_thinking = payload.thinking_mode != "off"
    content_chunks: list[str] = []
    try:
        for warning in warnings:
            yield sse_event("warning", {"detail": warning})
        for chunk in request_chat_from_vlm_stream(
            [vlm_message],
            api_key=str(provider["api_key"]),
            base_url=str(provider["base_url"]),
            model=str(provider["model"]),
            completion_options=completion_options,
        ):
            kind, text = playground_stream_chunk(chunk)
            if not text:
                continue
            if kind == "thinking":
                if show_thinking:
                    yield sse_event("thinking", {"text": text})
                continue
            content_chunks.append(text)
            yield sse_event("delta", {"text": text})

        stored_attachments = save_rendered_attachments(chat_id, rendered_attachments)
        user_message = stored_playground_message(
            role="user",
            content=payload.message.content,
            message_id=payload.message.id,
            attachments=stored_attachments,
        )
        assistant_message = stored_playground_message(role="assistant", content="".join(content_chunks))
        chat = runtime.store.append_playground_exchange(
            chat_id,
            str(provider["id"]),
            payload.thinking_mode,
            user_message,
            assistant_message,
        )
        yield sse_event("final", {"chat": chat, "message": assistant_message, "warnings": warnings, **runtime.store.list_playground_chats()})
    except Exception as exc:
        yield sse_event("error", {"detail": str(exc)})


def run_playground_chat(payload: PlaygroundChatPayload) -> dict[str, Any]:
    provider = get_verified_provider(payload.provider_id)
    completion_options, warnings = provider_completion_options(provider)
    content = request_chat_from_vlm(
        playground_messages(payload),
        api_key=str(provider["api_key"]),
        base_url=str(provider["base_url"]),
        model=str(provider["model"]),
        completion_options=completion_options,
    )
    return {"message": {"role": "assistant", "content": content}, "warnings": warnings}
