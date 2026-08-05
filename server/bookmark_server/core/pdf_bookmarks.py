from __future__ import annotations

from pathlib import Path
from typing import Any

import fitz

from .toc import flatten_to_pymupdf_toc, parse_toc_items


def apply_toc_to_pdf(
    input_pdf: Path,
    output_pdf: Path,
    toc_data: list[dict[str, Any]],
    page_offset: int,
) -> int:
    items = parse_toc_items(toc_data)
    with fitz.open(input_pdf) as doc:
        toc = flatten_to_pymupdf_toc(
            items=items,
            page_offset=page_offset,
            pdf_page_count=doc.page_count,
        )
        doc.set_toc(toc)
        output_pdf.parent.mkdir(parents=True, exist_ok=True)
        doc.save(output_pdf)
    return len(toc)
