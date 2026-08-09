from __future__ import annotations

import hashlib
import json
from pathlib import Path

from .toc_prompts import DEFAULT_FLAT_PROMPT


def make_cache_file_path(
    input_pdf: Path,
    cache_dir: Path,
    toc_start: int,
    toc_end: int,
    dpi: int,
    model: str,
    mode: str,
    prompt: str,
    request_profile: str = "",
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
        "mode": mode,
        "prompt": prompt,
        "request_profile": request_profile,
    }
    digest = hashlib.sha256(
        json.dumps(key_data, ensure_ascii=True, sort_keys=True).encode("utf-8")
    ).hexdigest()
    return cache_dir / f"toc_{digest}.json"


def make_flat_pages_work_dir(
    input_pdf: Path,
    cache_dir: Path,
    toc_start: int,
    toc_end: int,
    dpi: int,
    model: str,
    prompt: str,
    request_profile: str = "",
) -> Path:
    key_data = {
        "input_pdf": str(input_pdf.resolve()),
        "toc_start": toc_start,
        "toc_end": toc_end,
        "dpi": dpi,
        "model": model,
        "mode": "flat-pages",
        "prompt": prompt,
        "request_profile": request_profile,
    }
    digest = hashlib.sha256(
        json.dumps(key_data, ensure_ascii=True, sort_keys=True).encode("utf-8")
    ).hexdigest()[:12]
    return cache_dir / f"flat_pages_{input_pdf.stem}_{digest}"


def find_matching_flat_raw_cache(
    cache_dir: Path,
    input_pdf: Path,
    toc_start: int,
    toc_end: int,
    model: str,
    dpi: int,
    prompt: str,
    request_profile: str = "",
) -> Path | None:
    raw_files = sorted(cache_dir.glob("flat_raw_*.json"), reverse=True)
    input_pdf_resolved = str(input_pdf.resolve())

    for raw_file in raw_files:
        try:
            data = json.loads(raw_file.read_text(encoding="utf-8"))
        except Exception:
            continue

        if not isinstance(data, dict):
            continue

        if data.get("mode") != "flat":
            continue
        if data.get("toc_start") != toc_start or data.get("toc_end") != toc_end:
            continue
        if data.get("model") != model or data.get("dpi") != dpi:
            continue
        if data.get("request_profile", "") != request_profile:
            continue

        recorded_prompt = data.get("prompt")
        if recorded_prompt is None:
            if prompt != DEFAULT_FLAT_PROMPT:
                continue
        elif recorded_prompt != prompt:
            continue

        raw_pdf = data.get("input_pdf")
        if not isinstance(raw_pdf, str):
            continue

        same_pdf = False
        try:
            same_pdf = str(Path(raw_pdf).resolve()) == input_pdf_resolved
        except Exception:
            same_pdf = raw_pdf == str(input_pdf)

        if not same_pdf:
            continue

        pages = data.get("pages")
        if isinstance(pages, list) and pages:
            return raw_file

    return None
