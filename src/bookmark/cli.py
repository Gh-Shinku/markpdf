from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import fitz
from openai import OpenAI


@dataclass
class TocItem:
    title: str
    book_page: int | None
    children: list["TocItem"]


class ProgressReporter:
    def __init__(self, total_steps: int) -> None:
        self.total_steps = total_steps
        self.current_step = 0
        self.started_at = time.perf_counter()

    def step(self, message: str) -> None:
        self.current_step += 1
        elapsed = time.perf_counter() - self.started_at
        print(
            f"[{self.current_step}/{self.total_steps}] {message} "
            f"(elapsed: {elapsed:.1f}s)"
        )

    def info(self, message: str) -> None:
        elapsed = time.perf_counter() - self.started_at
        print(f"    - {message} (elapsed: {elapsed:.1f}s)")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="pdf-bookmark",
        description=(
            "Generate bookmarks for scanned/image-only PDFs by recognizing table of contents pages with a VLM."
        ),
    )
    parser.add_argument("input_pdf", type=Path, help="Input PDF path")
    parser.add_argument("output_pdf", type=Path, help="Output PDF path")
    parser.add_argument(
        "--toc-start",
        type=int,
        required=True,
        help="TOC start page index in PDF (0-based, inclusive)",
    )
    parser.add_argument(
        "--toc-end",
        type=int,
        required=True,
        help="TOC end page index in PDF (0-based, inclusive)",
    )
    parser.add_argument(
        "--page-offset",
        type=int,
        required=True,
        help=(
            "Offset between PDF page index and book page number: "
            "pdf_page_index = book_page + page_offset"
        ),
    )
    parser.add_argument(
        "--api-key",
        default=None,
        help="VLM API key. If omitted, reads DASHSCOPE_API_KEY from env",
    )
    parser.add_argument(
        "--base-url",
        default="https://dashscope.aliyuncs.com/compatible-mode/v1",
        help="VLM API base URL",
    )
    parser.add_argument(
        "--model",
        default="qwen3-vl-flash",
        help="VLM model name",
    )
    parser.add_argument(
        "--dpi",
        type=int,
        default=220,
        help="DPI used when rendering TOC pages for VLM input",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=Path("cache"),
        help="Directory used to persist recognized TOC JSON",
    )
    parser.add_argument(
        "--overwrite-cache",
        action="store_true",
        help="Overwrite existing local TOC cache and call VLM again",
    )
    return parser.parse_args()


def render_pages_as_data_urls(
    pdf: fitz.Document,
    start: int,
    end: int,
    dpi: int,
    on_page_rendered: Callable[[int, int], None] | None = None,
) -> list[str]:
    data_urls: list[str] = []
    zoom = dpi / 72.0
    mat = fitz.Matrix(zoom, zoom)
    total_pages = end - start + 1
    for i, page_index in enumerate(range(start, end + 1), start=1):
        page = pdf.load_page(page_index)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        image_bytes = pix.tobytes("png")
        b64 = base64.b64encode(image_bytes).decode("ascii")
        data_urls.append(f"data:image/png;base64,{b64}")
        if on_page_rendered is not None:
            on_page_rendered(i, total_pages)
    return data_urls


def build_prompt(toc_start: int, toc_end: int) -> str:
    return (
        "## 角色定义\n"
        "你是一个极其严谨的文档解析专家，专门负责从多张连续的目录图像中提取高精度的结构化数据。\n\n"
        
        "## 任务描述\n"
        f"你将收到一组按顺序排列的 PDF 目录页图像（索引范围：{toc_start} 至 {toc_end}）。\n"
        "你的目标是忽略物理分页的限制，将它们视为一个单一的、连续的逻辑文档，并提取完整的章节树状结构。\n\n"
        
        "## 核心规则（处理跨页断联）\n"
        "1. **语义合并**：如果某行标题在图片 A 末尾被截断，请在图片 B 开头寻找剩余文字和页码，并将其合并为一个完整的条目。\n"
        "2. **页码识别**：提取书本上印制的真实原始页码（整数）。如果某条目没有页码（如前言），请设为 null。\n"
        "3. **层级推理**：根据标题的缩进、字体大小或编号逻辑（如 1.1, 1.1.1）推断嵌套关系。不要遗漏任何层级。\n"
        "4. **去除杂质**：忽略目录条目之间的引导线（如点号、虚线）以及页码旁边的页眉页脚信息。\n\n"
        
        "## 输出规范\n"
        "- 必须输出一个统一的、合并后的 JSON 数组，严禁按图片进行分段输出。\n"
        "- 严格遵守以下 JSON 结构：\n"
        '  [{"title": "章节名称", "page": 10, "children": [{"title": "子章节", "page": 11, "children": []}]}]\n'
        "- `children` 字段必须存在，若无子项则为空数组 `[]`。\n"
        "- **禁止包含任何解释性文字、Markdown 标签或提示语，仅返回纯 JSON 字符串。**"
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
        messages=[
            {
                "role": "user",
                "content": content,
            }
        ],
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
        # Tolerate markdown wrappers like ```json ... ```
        candidate = re.sub(r"^```(?:json)?\s*", "", candidate)
        candidate = re.sub(r"\s*```$", "", candidate)
    return candidate.strip()


def parse_toc_items(data: Any) -> list[TocItem]:
    if not isinstance(data, list):
        raise ValueError("Top-level JSON must be an array")

    def parse_node(node: Any) -> TocItem:
        if not isinstance(node, dict):
            raise ValueError("Each TOC node must be an object")

        title = node.get("title")
        page = node.get("page")
        children = node.get("children")

        if not isinstance(title, str) or not title.strip():
            raise ValueError(f"Invalid title in node: {node!r}")
        if page is not None and not isinstance(page, int):
            raise ValueError(f"Invalid page in node: {node!r}")
        if not isinstance(children, list):
            raise ValueError(f"Invalid children in node: {node!r}")

        return TocItem(
            title=title.strip(),
            book_page=page,
            children=[parse_node(child) for child in children],
        )

    return [parse_node(item) for item in data]


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


def load_toc_items_from_cache(cache_file: Path) -> list[TocItem]:
    data = json.loads(cache_file.read_text(encoding="utf-8"))
    return parse_toc_items(data)


def save_toc_to_cache(cache_file: Path, data: Any) -> None:
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def flatten_to_pymupdf_toc(
    items: list[TocItem],
    page_offset: int,
    pdf_page_count: int,
) -> list[list[Any]]:
    toc: list[list[Any]] = []

    def resolve_node_book_page(node: TocItem) -> int | None:
        if node.book_page is not None:
            return node.book_page
        for child in node.children:
            child_page = resolve_node_book_page(child)
            if child_page is not None:
                return child_page
        return None

    def walk(nodes: list[TocItem], level: int) -> None:
        for node in nodes:
            resolved_book_page = resolve_node_book_page(node)
            if resolved_book_page is None:
                raise ValueError(
                    "Cannot resolve page for node (missing page and descendants): "
                    f"{node.title!r}"
                )

            pdf_index = resolved_book_page + page_offset
            if pdf_index < 0 or pdf_index >= pdf_page_count:
                raise ValueError(
                    "Converted PDF page index out of range for node "
                    f"{node.title!r}: book_page={resolved_book_page}, "
                    f"offset={page_offset}, pdf_index={pdf_index}, page_count={pdf_page_count}"
                )
            # PyMuPDF TOC expects 1-based page numbers.
            toc.append([level, node.title, pdf_index + 1])
            walk(node.children, level + 1)

    walk(items, level=1)
    return toc


def validate_input_args(args: argparse.Namespace) -> None:
    if not args.input_pdf.exists():
        raise FileNotFoundError(f"Input PDF does not exist: {args.input_pdf}")
    if args.toc_start < 0 or args.toc_end < 0:
        raise ValueError("--toc-start and --toc-end must be >= 0")
    if args.toc_start > args.toc_end:
        raise ValueError("--toc-start must be <= --toc-end")


def main() -> int:
    args = parse_args()
    try:
        progress = ProgressReporter(total_steps=7)

        progress.step("Validating input arguments")
        validate_input_args(args)

        progress.step("Preparing TOC cache key")
        cache_file = make_cache_file_path(
            input_pdf=args.input_pdf,
            cache_dir=args.cache_dir,
            toc_start=args.toc_start,
            toc_end=args.toc_end,
            dpi=args.dpi,
            model=args.model,
        )

        api_key = args.api_key or os.getenv("DASHSCOPE_API_KEY")
        should_call_vlm = True
        toc_items: list[TocItem]

        progress.step("Checking local TOC cache")
        if cache_file.exists() and not args.overwrite_cache:
            try:
                toc_items = load_toc_items_from_cache(cache_file)
                should_call_vlm = False
                progress.info(f"Loaded TOC from cache: {cache_file}")
            except Exception:
                print(
                    f"Cache is unreadable, will regenerate: {cache_file}",
                    file=sys.stderr,
                )

        if should_call_vlm and not api_key:
            raise ValueError(
                "Missing API key. Use --api-key or set DASHSCOPE_API_KEY environment variable"
            )

        progress.step("Opening PDF and validating TOC range")
        with fitz.open(args.input_pdf) as doc:
            if args.toc_end >= doc.page_count:
                raise ValueError(
                    f"TOC end index {args.toc_end} out of range (page_count={doc.page_count})"
                )

            if should_call_vlm:
                progress.step("Rendering TOC pages into images")
                image_data_urls = render_pages_as_data_urls(
                    doc,
                    start=args.toc_start,
                    end=args.toc_end,
                    dpi=args.dpi,
                    on_page_rendered=lambda current, total: progress.info(
                        f"Rendered TOC page image {current}/{total}"
                    ),
                )

                progress.step("Calling VLM and parsing TOC JSON")
                raw_response = request_toc_from_vlm(
                    image_data_urls=image_data_urls,
                    api_key=api_key,
                    base_url=args.base_url,
                    model=args.model,
                    toc_start=args.toc_start,
                    toc_end=args.toc_end,
                )

                json_text = extract_json_text(raw_response)
                parsed = json.loads(json_text)
                toc_items = parse_toc_items(parsed)
                save_toc_to_cache(cache_file, parsed)
                progress.info(f"Saved TOC cache: {cache_file}")
            else:
                progress.step("Skipping VLM call because cache is available")
                progress.step("Skipping parsing because cached TOC is already loaded")

            progress.step("Building bookmarks and saving output PDF")
            toc = flatten_to_pymupdf_toc(
                items=toc_items,
                page_offset=args.page_offset,
                pdf_page_count=doc.page_count,
            )

            doc.set_toc(toc)

            args.output_pdf.parent.mkdir(parents=True, exist_ok=True)
            doc.save(args.output_pdf)

        print(f"Bookmarks generated successfully: {args.output_pdf}")
        print(f"Total bookmarks: {len(toc)}")
        return 0
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
