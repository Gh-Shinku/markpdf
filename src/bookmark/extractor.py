from __future__ import annotations

import base64
import hashlib
import json
import re
from pathlib import Path
from typing import Any, Callable

import fitz
from openai import OpenAI

from .writer import validate_toc_json_structure


def render_pages_as_data_urls(
    pdf: fitz.Document,
    start: int,
    end: int,
    dpi: int,
    on_page_rendered: Callable[[int, int], None] | None = None,
) -> list[str]:
    data_urls: list[str] = []
    zoom = dpi / 72.0
    matrix = fitz.Matrix(zoom, zoom)
    total_pages = end - start + 1

    for i, page_index in enumerate(range(start, end + 1), start=1):
        page = pdf.load_page(page_index)
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        image_bytes = pix.tobytes("png")
        b64 = base64.b64encode(image_bytes).decode("ascii")
        data_urls.append(f"data:image/png;base64,{b64}")
        if on_page_rendered is not None:
            on_page_rendered(i, total_pages)

    return data_urls


def build_prompt(toc_start: int, toc_end: int) -> str:
    return (
        "你是一个严谨的目录提取助手。"
        f"这些图像对应 PDF 索引范围 [{toc_start}, {toc_end}] 的目录页。"
        "请提取完整目录树并返回严格 JSON。"
        "JSON 顶层必须是数组，节点结构必须为："
        '{"title": "章节标题", "page": 整数或null, "children": [...]}。'
        "要求："
        "1) page 使用书本真实页码，不是 PDF 索引；"
        "2) children 必须始终存在；"
        "3) 保留原始层级与顺序；"
        "4) 仅输出 JSON，不要输出 markdown 或解释。"
    )


def request_toc_from_vlm(
    image_data_urls: list[str],
    api_key: str,
    base_url: str,
    model: str,
    toc_start: int,
    toc_end: int,
) -> str:
    client = OpenAI(api_key=api_key, base_url=base_url)
    content: list[dict[str, Any]] = [{"type": "text", "text": build_prompt(toc_start, toc_end)}]
    for data_url in image_data_urls:
        content.append({"type": "image_url", "image_url": {"url": data_url}})

    completion = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": content}],
        temperature=0,
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

    raise ValueError("VLM response does not include readable text content")


def extract_json_text(raw_text: str) -> str:
    candidate = raw_text.strip()
    if candidate.startswith("```"):
        candidate = re.sub(r"^```(?:json)?\s*", "", candidate)
        candidate = re.sub(r"\s*```$", "", candidate)
    return candidate.strip()


def make_cache_file_path(
    input_pdf: Path,
    cache_dir: Path,
    toc_start: int,
    toc_end: int,
    dpi: int,
    model: str,
) -> Path:
    stat = input_pdf.stat()
    key_data = {
        "input_pdf": str(input_pdf.resolve()),
        "pdf_size": stat.st_size,
        "pdf_mtime_ns": stat.st_mtime_ns,
        "toc_start": toc_start,
        "toc_end": toc_end,
        "dpi": dpi,
        "model": model,
    }
    digest = hashlib.sha256(
        json.dumps(key_data, ensure_ascii=True, sort_keys=True).encode("utf-8")
    ).hexdigest()
    return cache_dir / f"toc_{digest}.json"


def extract_toc_json(
    input_pdf: Path,
    toc_start: int,
    toc_end: int,
    api_key: str,
    base_url: str,
    model: str,
    dpi: int,
    cache_dir: Path,
    overwrite_cache: bool,
    on_page_rendered: Callable[[int, int], None] | None = None,
) -> tuple[list[dict[str, Any]], Path, bool]:
    cache_file = make_cache_file_path(
        input_pdf=input_pdf,
        cache_dir=cache_dir,
        toc_start=toc_start,
        toc_end=toc_end,
        dpi=dpi,
        model=model,
    )

    if cache_file.exists() and not overwrite_cache:
        cached_data = json.loads(cache_file.read_text(encoding="utf-8"))
        validated_cached = validate_toc_json_structure(cached_data)
        return validated_cached, cache_file, True

    with fitz.open(input_pdf) as doc:
        if toc_end >= doc.page_count:
            raise ValueError(f"TOC end index {toc_end} out of range (page_count={doc.page_count})")

        image_data_urls = render_pages_as_data_urls(
            pdf=doc,
            start=toc_start,
            end=toc_end,
            dpi=dpi,
            on_page_rendered=on_page_rendered,
        )

    raw_response = request_toc_from_vlm(
        image_data_urls=image_data_urls,
        api_key=api_key,
        base_url=base_url,
        model=model,
        toc_start=toc_start,
        toc_end=toc_end,
    )

    json_text = extract_json_text(raw_response)
    parsed = json.loads(json_text)
    validated = validate_toc_json_structure(parsed)

    cache_file.parent.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(json.dumps(validated, ensure_ascii=False, indent=2), encoding="utf-8")

    return validated, cache_file, False