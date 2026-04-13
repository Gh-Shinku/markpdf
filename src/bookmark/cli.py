from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Callable

import fitz

from .extractor import extract_toc_json
from .writer import apply_toc_to_pdf, load_toc_json_file, remove_ocr_layer


class ProgressReporter:
    RESET = "\033[0m"
    DIM = "\033[2m"
    GREEN = "\033[32m"
    CYAN = "\033[36m"

    def __init__(self, total_steps: int) -> None:
        self.total_steps = total_steps
        self.current_step = 0
        self.started_at = time.perf_counter()
        self.last_step_at = self.started_at

    def step(self, message: str) -> None:
        now = time.perf_counter()
        self.current_step += 1
        elapsed = now - self.last_step_at
        self.last_step_at = now
        print(
            f"[{self.current_step}/{self.total_steps}] {message} "
            f"(elapsed: {elapsed:.1f}s)"
        )

    def info(self, message: str) -> None:
        print(f"    - {message}")

    def page_event(
        self,
        current: int,
        total: int,
        status: str,
        message: str,
        elapsed: float | None = None,
    ) -> None:
        color = self.CYAN if status == "VLM" else self.GREEN
        prefix = f"({current}/{total}) {color}[{status}]{self.RESET}"
        if elapsed is None:
            print(f"{prefix} {message}")
        else:
            print(f"{prefix} {message} {self.DIM}(elapsed: {elapsed:.2f}s){self.RESET}")


def _make_flat_page_event_handler(progress: ProgressReporter) -> Callable:
    def handler(
        current: int,
        total: int,
        status: str,
        stage: str,
        entries: int | None,
        elapsed: float | None,
    ) -> None:
        if stage == "rendering":
            if elapsed is None:
                progress.page_event(current, total, status, "Rendering page image...")
            else:
                progress.page_event(current, total, status, "Rendering page image...", elapsed)
            return

        if stage == "scanning":
            if elapsed is None:
                progress.page_event(current, total, status, "Uploading & Scanning with VLM...")
            else:
                progress.page_event(current, total, status, "Uploading & Scanning with VLM...", elapsed)
            return

        if stage == "success":
            progress.page_event(
                current,
                total,
                status,
                f"Success: Extracted {entries or 0} entries.",
            )
            return

        if stage == "cache_loaded":
            progress.page_event(
                current,
                total,
                status,
                f"Loaded {entries or 0} entries from cache.",
                elapsed,
            )
            return

    return handler


def parse_pages_spec(spec: str) -> list[int]:
    pages: set[int] = set()
    for part in spec.split(","):
        token = part.strip()
        if not token:
            continue

        if "-" in token:
            lo_s, hi_s = token.split("-", 1)
            lo = int(lo_s.strip())
            hi = int(hi_s.strip())
            if lo <= 0 or hi <= 0:
                raise ValueError("--pages values must be >= 1")
            if lo > hi:
                raise ValueError(f"Invalid pages range: {token}")
            for page in range(lo, hi + 1):
                pages.add(page)
        else:
            page = int(token)
            if page <= 0:
                raise ValueError("--pages values must be >= 1")
            pages.add(page)

    if not pages:
        raise ValueError("--pages is empty")
    return sorted(pages)


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
    extract_parser.add_argument(
        "output_json",
        type=Path,
        nargs="?",
        default=None,
        help="Optional output TOC JSON path (if omitted, only cache is written)",
    )
    extract_parser.add_argument(
        "--toc-start",
        type=int,
        required=True,
        help="TOC start page number in PDF (1-based, inclusive)",
    )
    extract_parser.add_argument(
        "--toc-end",
        type=int,
        required=True,
        help="TOC end page number in PDF (1-based, inclusive)",
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
    extract_parser.add_argument(
        "--mode",
        choices=["tree", "flat"],
        default="tree",
        help="Extraction strategy: direct tree extraction or smart flat extraction",
    )
    extract_parser.add_argument(
        "--rescan",
        action="store_true",
        help="Rescan selected TOC pages in flat mode using per-page cache",
    )
    extract_parser.add_argument(
        "--pages",
        default=None,
        help="Pages to rescan in TOC slice (1-based), e.g. 5,8-10",
    )
    extract_parser.add_argument(
        "--auto-apply",
        action="store_true",
        help="Automatically apply extracted TOC to export a bookmarked PDF",
    )
    extract_parser.add_argument(
        "--apply-output-pdf",
        type=Path,
        default=None,
        help="Output PDF path used by --auto-apply",
    )
    extract_parser.add_argument(
        "--page-offset",
        type=int,
        default=None,
        help=(
            "Offset for PDF bookmark export when using --auto-apply: "
            "pdf_page_index = book_page + page_offset"
        ),
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

    remove_ocr_parser = subparsers.add_parser(
        "remove-ocr",
        help="Remove OCR text layer while keeping page images",
    )
    remove_ocr_parser.add_argument("input_pdf", type=Path, help="Input PDF path")
    remove_ocr_parser.add_argument("output_pdf", type=Path, help="Output PDF path")

    return parser


def _validate_extract_args(args: argparse.Namespace) -> None:
    if not args.input_pdf.exists():
        raise FileNotFoundError(f"Input PDF does not exist: {args.input_pdf}")
    if args.toc_start < 1 or args.toc_end < 1:
        raise ValueError("--toc-start and --toc-end must be >= 1")
    if args.toc_start > args.toc_end:
        raise ValueError("--toc-start must be <= --toc-end")

    # Internally keep extractor contract unchanged (0-based PDF indexes).
    args._toc_start_index0 = args.toc_start - 1
    args._toc_end_index0 = args.toc_end - 1

    if args.pages and not args.rescan:
        raise ValueError("--pages requires --rescan")
    if args.rescan and args.mode != "flat":
        raise ValueError("--rescan is only supported in --mode flat")
    if args.pages:
        parsed_pages = parse_pages_spec(args.pages)
        total_pages = args.toc_end - args.toc_start + 1
        if any(page > total_pages for page in parsed_pages):
            raise ValueError(f"--pages out of TOC range. Valid range: 1-{total_pages}")
        args._rescan_pages = parsed_pages
    else:
        args._rescan_pages = None
    if args.rescan and not args.pages:
        total_pages = args.toc_end - args.toc_start + 1
        args._rescan_pages = list(range(1, total_pages + 1))
    if args.auto_apply:
        if args.apply_output_pdf is None:
            raise ValueError("--auto-apply requires --apply-output-pdf")
        if args.page_offset is None:
            raise ValueError("--auto-apply requires --page-offset")


def _validate_apply_args(args: argparse.Namespace) -> None:
    if not args.input_pdf.exists():
        raise FileNotFoundError(f"Input PDF does not exist: {args.input_pdf}")
    if not args.toc_json.exists():
        raise FileNotFoundError(f"TOC JSON does not exist: {args.toc_json}")


def _validate_remove_ocr_args(args: argparse.Namespace) -> None:
    if not args.input_pdf.exists():
        raise FileNotFoundError(f"Input PDF does not exist: {args.input_pdf}")


def run_extract(args: argparse.Namespace) -> int:
    total_steps = 3
    if args.output_json is not None:
        total_steps += 1
    if args.auto_apply:
        total_steps += 1

    progress = ProgressReporter(total_steps=total_steps)
    progress.step("Validating extract arguments")
    _validate_extract_args(args)

    api_key = args.api_key or os.getenv("DASHSCOPE_API_KEY")
    if not api_key:
        raise ValueError("Missing API key. Use --api-key or set DASHSCOPE_API_KEY environment variable")

    with fitz.open(args.input_pdf) as doc:
        if args.toc_end > doc.page_count:
            raise ValueError(
                f"TOC end page {args.toc_end} out of range (page_count={doc.page_count})"
            )

    page_render_cb = None
    if args.mode == "tree":
        page_render_cb = lambda current, total: progress.info(
            f"Rendered TOC page image {current}/{total}"
        )

    progress.step("Extracting TOC JSON")
    toc_json, cache_file, loaded_from_cache, raw_cache_file, extract_stats = extract_toc_json(
        input_pdf=args.input_pdf,
        toc_start=args._toc_start_index0,
        toc_end=args._toc_end_index0,
        api_key=api_key,
        base_url=args.base_url,
        model=args.model,
        dpi=args.dpi,
        cache_dir=args.cache_dir,
        overwrite_cache=args.overwrite_cache,
        mode=args.mode,
        rescan=args.rescan,
        rescan_pages=args._rescan_pages,
        on_flat_page_event=_make_flat_page_event_handler(progress),
        on_page_rendered=page_render_cb,
    )

    if args.output_json is not None:
        progress.step("Writing extracted JSON file")
        args.output_json.parent.mkdir(parents=True, exist_ok=True)
        args.output_json.write_text(
            json.dumps(toc_json, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    if args.auto_apply:
        progress.step("Applying bookmarks to output PDF")
        bookmark_count = apply_toc_to_pdf(
            input_pdf=args.input_pdf,
            output_pdf=args.apply_output_pdf,
            toc_data=toc_json,
            page_offset=args.page_offset,
        )
        progress.info(f"Auto-applied output PDF: {args.apply_output_pdf}")
        progress.info(f"Auto-applied bookmark count: {bookmark_count}")

    progress.step("Extraction completed")
    progress.info(f"Extraction mode: {args.mode}")
    if args.rescan:
        progress.info(
            "Rescan pages: "
            + ",".join(str(page) for page in (args._rescan_pages or []))
        )
    progress.info(f"TOC source: {'cache' if loaded_from_cache else 'vlm'}")
    progress.info(f"VLM API Calls: {extract_stats.get('vlm_calls', 0)} times")
    progress.info(f"Render Time (flat pages): {extract_stats.get('render_seconds', 0.0):.2f}s")
    progress.info(f"VLM Time (flat pages): {extract_stats.get('api_seconds', 0.0):.2f}s")
    progress.info(f"Cache file: {cache_file}")
    if raw_cache_file is not None:
        progress.info(f"Flat raw cache file: {raw_cache_file}")
    if args.output_json is not None:
        progress.info(f"Output JSON: {args.output_json}")
    else:
        progress.info("Output JSON: skipped (cache-only mode)")
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


def run_remove_ocr(args: argparse.Namespace) -> int:
    progress = ProgressReporter(total_steps=3)
    progress.step("Validating remove-ocr arguments")
    _validate_remove_ocr_args(args)

    progress.step("Removing OCR text layer from PDF")
    remove_ocr_layer(input_pdf=args.input_pdf, output_pdf=args.output_pdf)

    progress.step("remove-ocr completed")
    progress.info(f"Output PDF: {args.output_pdf}")
    return 0


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        if args.command == "extract":
            return run_extract(args)
        if args.command == "apply":
            return run_apply(args)
        if args.command == "remove-ocr":
            return run_remove_ocr(args)
        raise ValueError(f"Unsupported command: {args.command}")
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
