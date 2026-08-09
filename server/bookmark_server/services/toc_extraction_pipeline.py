from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

import fitz

from ..core import validate_toc_json_structure
from .pdf_rendering import render_pdf_page_image
from .storage import write_json_atomic
from .toc_assembly import prune_null_page_nodes
from .toc_cache import find_matching_flat_raw_cache, make_cache_file_path, make_flat_pages_work_dir
from .toc_correction import correct_tree_levels
from .toc_extractors import FlatExtractor
from .vlm_client import build_chat_completion_options, llm_request_profile


FlatPageEventCallback = Callable[
    [
        int,
        int,
        str,
        str,
        int | None,
        float | None,
    ],
    None,
]


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
    rescan: bool = False,
    rescan_pages: list[int] | None = None,
    prompt: str | None = None,
    sampling: dict[str, Any] | None = None,
    thinking_mode: str | None = None,
    extra_body: dict[str, Any] | None = None,
    on_page_rendered: Callable[[int, int], None] | None = None,
    on_flat_page_event: FlatPageEventCallback | None = None,
) -> tuple[list[dict[str, Any]], Path, bool, Path | None, dict[str, Any]]:
    extractor = FlatExtractor(
        toc_start=toc_start,
        toc_end=toc_end,
        prompt=prompt,
        pdf_name=input_pdf.stem,
    )
    rendered_prompt = extractor.build_prompt()
    completion_options, warnings = build_chat_completion_options(
        base_url=base_url,
        model=model,
        sampling=sampling,
        thinking_mode=thinking_mode,
        extra_body=extra_body,
    )
    request_profile = llm_request_profile(
        base_url=base_url,
        model=model,
        sampling=sampling,
        thinking_mode=thinking_mode,
        extra_body=extra_body,
    )

    stats: dict[str, Any] = {
        "vlm_calls": 0,
        "render_seconds": 0.0,
        "api_seconds": 0.0,
        "cache_pages": 0,
        "vlm_pages": 0,
        "warnings": warnings,
    }

    cache_file = make_cache_file_path(
        input_pdf=input_pdf,
        cache_dir=cache_dir,
        toc_start=toc_start,
        toc_end=toc_end,
        dpi=dpi,
        model=model,
        mode=extractor.mode,
        prompt=rendered_prompt,
        request_profile=request_profile,
    )

    if cache_file.exists() and not overwrite_cache and not rescan:
        cached_data = json.loads(cache_file.read_text(encoding="utf-8"))
        validated_cached = validate_toc_json_structure(cached_data)
        pruned_cached = prune_null_page_nodes(validated_cached)
        return pruned_cached, cache_file, True, None, stats

    total_pages = toc_end - toc_start + 1
    work_dir = make_flat_pages_work_dir(
        input_pdf=input_pdf,
        cache_dir=cache_dir,
        toc_start=toc_start,
        toc_end=toc_end,
        dpi=dpi,
        model=model,
        prompt=rendered_prompt,
        request_profile=request_profile,
    )
    work_dir.mkdir(parents=True, exist_ok=True)

    rescan_set = set(rescan_pages or [])
    if any(page < 1 or page > total_pages for page in rescan_set):
        raise ValueError(f"Rescan page index out of range. Valid range: 1-{total_pages}")

    existing_page_files = list(work_dir.glob("page_*.json"))

    if not existing_page_files and not overwrite_cache and not rescan:
        fallback_raw = find_matching_flat_raw_cache(
            cache_dir=cache_dir,
            input_pdf=input_pdf,
            toc_start=toc_start,
            toc_end=toc_end,
            model=model,
            dpi=dpi,
            prompt=rendered_prompt,
            request_profile=request_profile,
        )
        if fallback_raw is not None:
            raw_data = json.loads(fallback_raw.read_text(encoding="utf-8"))
            raw_pages = raw_data.get("pages", [])
            if isinstance(raw_pages, list):
                for page_item in raw_pages:
                    if not isinstance(page_item, dict):
                        continue
                    page_no = page_item.get("page_call_index")
                    raw_json = page_item.get("raw_json")
                    if not isinstance(page_no, int) or page_no < 1 or page_no > total_pages:
                        continue
                    try:
                        validated_page_items = extractor._validate_flat_list(raw_json)
                    except Exception:
                        continue
                    write_json_atomic(work_dir / f"page_{page_no}.json", validated_page_items)

            existing_page_files = list(work_dir.glob("page_*.json"))

    if rescan and not existing_page_files:
        raise ValueError("No per-page cache found for --rescan. Run extract once without --rescan first.")

    page_items_collected: list[list[dict[str, Any]]] = []
    vlm_called = False
    with fitz.open(input_pdf) as doc:
        if toc_end >= doc.page_count:
            raise ValueError(f"TOC end index {toc_end} out of range (page_count={doc.page_count})")

        for page_call_index in range(1, total_pages + 1):
            pdf_page_index = toc_start + page_call_index - 1
            page_cache_file = work_dir / f"page_{page_call_index}.json"

            should_scan = overwrite_cache
            if rescan and page_call_index in rescan_set:
                should_scan = True
            if not page_cache_file.exists():
                should_scan = True

            if should_scan:
                vlm_called = True
                stats["vlm_pages"] += 1

                if on_flat_page_event is not None:
                    on_flat_page_event(page_call_index, total_pages, "VLM", "rendering", None, None)

                render_start = datetime.now().timestamp()
                rendered_page = render_pdf_page_image(input_pdf, pdf_page_index + 1, dpi)
                data_url = str(rendered_page["data_url"])
                render_elapsed = datetime.now().timestamp() - render_start
                stats["render_seconds"] += render_elapsed

                if on_flat_page_event is not None:
                    on_flat_page_event(page_call_index, total_pages, "VLM", "rendering", None, render_elapsed)

                if on_flat_page_event is not None:
                    on_flat_page_event(page_call_index, total_pages, "VLM", "scanning", None, None)

                api_start = datetime.now().timestamp()
                page_flat_items = extractor.extract_single_page_flat(
                    image_data_url=data_url,
                    api_key=api_key,
                    base_url=base_url,
                    model=model,
                    completion_options=completion_options,
                )
                api_elapsed = datetime.now().timestamp() - api_start
                stats["api_seconds"] += api_elapsed
                stats["vlm_calls"] += 1

                if on_flat_page_event is not None:
                    on_flat_page_event(page_call_index, total_pages, "VLM", "scanning", len(page_flat_items), api_elapsed)

                write_json_atomic(page_cache_file, page_flat_items)

                if on_flat_page_event is not None:
                    on_flat_page_event(page_call_index, total_pages, "VLM", "success", len(page_flat_items), None)
            else:
                stats["cache_pages"] += 1
                cache_start = datetime.now().timestamp()
                page_flat_items = extractor._validate_flat_list(
                    json.loads(page_cache_file.read_text(encoding="utf-8"))
                )
                cache_elapsed = datetime.now().timestamp() - cache_start
                if on_flat_page_event is not None:
                    on_flat_page_event(page_call_index, total_pages, "CACHE", "cache_loaded", len(page_flat_items), cache_elapsed)

            if on_page_rendered is not None:
                on_page_rendered(page_call_index, total_pages)

            page_items_collected.append(page_flat_items)

    rebuilt = extractor.rebuild_from_page_items(page_items_collected)
    pruned_rebuilt = prune_null_page_nodes(rebuilt)

    try:
        corrected = correct_tree_levels(
            pruned_rebuilt,
            api_key=api_key,
            base_url=base_url,
            model=model,
            completion_options=completion_options,
        )
        corrected = prune_null_page_nodes(corrected)
        stats["level_correction"] = "applied"
    except Exception:
        corrected = pruned_rebuilt
        stats["level_correction"] = "failed"

    write_json_atomic(cache_file, corrected)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    raw_cache_file = cache_dir / f"flat_raw_{timestamp}.json"
    write_json_atomic(
        raw_cache_file,
        {
            "mode": "flat",
            "input_pdf": str(input_pdf),
            "toc_start": toc_start,
            "toc_end": toc_end,
            "model": model,
            "dpi": dpi,
            "prompt": rendered_prompt,
            "request_profile": request_profile,
            "work_dir": str(work_dir),
            "pages": [
                {
                    "page_call_index": i,
                    "raw_json": page_items_collected[i - 1],
                }
                for i in range(1, total_pages + 1)
            ],
        },
    )

    loaded_from_cache = not vlm_called
    return corrected, cache_file, loaded_from_cache, raw_cache_file, stats
