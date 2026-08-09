from __future__ import annotations

import json
from typing import Any

from openai import OpenAI

from ..core import validate_toc_json_structure
from .toc_assembly import extract_json_text


LEVEL_CORRECTION_PROMPT = (
    "Role: You are a book Table of Contents structure reviewer.\n"
    "Task: Review the ToC JSON tree below and fix ONLY hierarchical (parent/child) errors.\n"
    "Common errors: an entry sits at the wrong depth relative to its numbering "
    "(e.g. '2.1' must be a child of '2', '1.1.1' must be nested under '1.1') or a whole "
    "page's entries were shifted one level too deep/shallow due to inconsistent indentation.\n\n"
    "### Rules:\n"
    "1. Do NOT add, remove, or reorder entries. Do NOT change 'title', 'page', or 'attribute' values.\n"
    "2. Fix only the 'children' nesting (and thus the depth) of entries.\n"
    "3. Keep every entry exactly once. A node with no children must keep 'children': [].\n"
    "4. If the structure is already correct, return the input unchanged.\n\n"
    "### Output Format:\n"
    "Return ONLY the corrected JSON array at the top level. No markdown blocks, no preamble, no explanations.\n"
    "Input ToC JSON:\n"
)


def request_llm_json(
    prompt: str,
    api_key: str,
    base_url: str,
    model: str,
    completion_options: dict[str, Any] | None = None,
) -> str:
    client = OpenAI(api_key=api_key, base_url=base_url)
    options = {"model": model, "temperature": 0, **(completion_options or {})}
    completion = client.chat.completions.create(
        messages=[{"role": "user", "content": prompt}],
        **options,
    )

    message_content = completion.choices[0].message.content
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

    raise ValueError("LLM response does not include readable text content")


def correct_tree_levels(
    toc_data: list[dict[str, Any]],
    api_key: str,
    base_url: str,
    model: str,
    completion_options: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    prompt = LEVEL_CORRECTION_PROMPT + json.dumps(toc_data, ensure_ascii=False)
    raw_response = request_llm_json(
        prompt=prompt,
        api_key=api_key,
        base_url=base_url,
        model=model,
        completion_options=completion_options,
    )
    parsed = json.loads(extract_json_text(raw_response))
    return validate_toc_json_structure(parsed)
