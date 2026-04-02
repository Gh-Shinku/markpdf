from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import fitz

from .extractor import extract_toc_json
from .writer import apply_toc_to_pdf, load_toc_json_file


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


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="pdf-bookmark",
        description=(
            "Extract TOC JSON from scanned/image-only PDFs and apply JSON TOC back as bookmarks."
        ),
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    extract_parser = subparsers.add_parser(
        "extract",
        help="Extract TOC JSON from PDF TOC pages using VLM",
    )
    extract_parser.add_argument("input_pdf", type=Path, help="Input PDF path")
    extract_parser.add_argument("output_json", type=Path, help="Output TOC JSON path")
    extract_parser.add_argument(
        "--toc-start",
        type=int,
        required=True,
        help="TOC start page index in PDF (0-based, inclusive)",
    )
    extract_parser.add_argument(
        "--toc-end",
        type=int,
        required=True,
        help="TOC end page index in PDF (0-based, inclusive)",
    )
    extract_parser.add_argument(
        "--api-key",
        default=None,
        help="VLM API key. If omitted, reads DASHSCOPE_API_KEY from env",
    )
    extract_parser.add_argument(
        "--base-url",
        default="https://dashscope.aliyuncs.com/compatible-mode/v1",
        help="VLM API base URL",
    )
    extract_parser.add_argument(
        "--model",
        default="qwen3-vl-flash",
        help="VLM model name",
    )
    extract_parser.add_argument(
        "--dpi",
        type=int,
        default=220,
        help="DPI used when rendering TOC pages for VLM input",
    )
    extract_parser.add_argument(
        "--cache-dir",
        type=Path,
        default=Path("cache"),
        help="Directory used to persist recognized TOC JSON",
    )
    extract_parser.add_argument(
        "--overwrite-cache",
        action="store_true",
        help="Overwrite existing local TOC cache and call VLM again",
    )

    apply_parser = subparsers.add_parser(
        "apply",
        help="Apply TOC JSON as PDF bookmarks",
    )
    apply_parser.add_argument("input_pdf", type=Path, help="Input PDF path")
    apply_parser.add_argument("output_pdf", type=Path, help="Output PDF path")
    apply_parser.add_argument(
        "--toc-json",
        type=Path,
        required=True,
        help="Path to TOC JSON file",
    )
    apply_parser.add_argument(
        "--page-offset",
        type=int,
        required=True,
        help=(
            "Offset between PDF page index and book page number: "
            "pdf_page_index = book_page + page_offset"
        ),
    )

    return parser


def _validate_extract_args(args: argparse.Namespace) -> None:
    if not args.input_pdf.exists():
        raise FileNotFoundError(f"Input PDF does not exist: {args.input_pdf}")
    if args.toc_start < 0 or args.toc_end < 0:
        raise ValueError("--toc-start and --toc-end must be >= 0")
    if args.toc_start > args.toc_end:
        raise ValueError("--toc-start must be <= --toc-end")


def _validate_apply_args(args: argparse.Namespace) -> None:
    if not args.input_pdf.exists():
        raise FileNotFoundError(f"Input PDF does not exist: {args.input_pdf}")
    if not args.toc_json.exists():
        raise FileNotFoundError(f"TOC JSON does not exist: {args.toc_json}")


def run_extract(args: argparse.Namespace) -> int:
    progress = ProgressReporter(total_steps=4)
    progress.step("Validating extract arguments")
    _validate_extract_args(args)

    api_key = args.api_key or os.getenv("DASHSCOPE_API_KEY")
    if not api_key:
        raise ValueError("Missing API key. Use --api-key or set DASHSCOPE_API_KEY environment variable")

    with fitz.open(args.input_pdf) as doc:
        if args.toc_end >= doc.page_count:
            raise ValueError(f"TOC end index {args.toc_end} out of range (page_count={doc.page_count})")

    progress.step("Extracting TOC JSON")
    toc_json, cache_file, loaded_from_cache = extract_toc_json(
        input_pdf=args.input_pdf,
        toc_start=args.toc_start,
        toc_end=args.toc_end,
        api_key=api_key,
        base_url=args.base_url,
        model=args.model,
        dpi=args.dpi,
        cache_dir=args.cache_dir,
        overwrite_cache=args.overwrite_cache,
        on_page_rendered=lambda current, total: progress.info(
            f"Rendered TOC page image {current}/{total}"
        ),
    )

    progress.step("Writing extracted JSON file")
    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(
        json.dumps(toc_json, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    progress.step("Extraction completed")
    progress.info(f"TOC source: {'cache' if loaded_from_cache else 'vlm'}")
    progress.info(f"Cache file: {cache_file}")
    progress.info(f"Output JSON: {args.output_json}")
    progress.info(f"Top-level entries: {len(toc_json)}")
    return 0


def run_apply(args: argparse.Namespace) -> int:
    progress = ProgressReporter(total_steps=4)
    progress.step("Validating apply arguments")
    _validate_apply_args(args)

    progress.step("Loading and validating TOC JSON")
    toc_json = load_toc_json_file(args.toc_json)

    progress.step("Applying bookmarks to PDF")
    bookmark_count = apply_toc_to_pdf(
        input_pdf=args.input_pdf,
        output_pdf=args.output_pdf,
        toc_data=toc_json,
        page_offset=args.page_offset,
    )

    progress.step("Apply completed")
    progress.info(f"Output PDF: {args.output_pdf}")
    progress.info(f"Total bookmarks: {bookmark_count}")
    return 0


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        if args.command == "extract":
            return run_extract(args)
        if args.command == "apply":
            return run_apply(args)
        raise ValueError(f"Unsupported command: {args.command}")
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
