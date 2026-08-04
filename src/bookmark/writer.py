from __future__ import annotations

from pathlib import Path

import fitz

from .core import apply_toc_to_pdf, load_toc_json_file, validate_toc_json_structure


def remove_ocr_layer(input_pdf: Path, output_pdf: Path) -> None:
    with fitz.open(input_pdf) as doc:
        for page in doc:
            page_rect = page.rect
            page.add_redact_annot(page_rect)
            page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)

        output_pdf.parent.mkdir(parents=True, exist_ok=True)
        doc.save(output_pdf, garbage=4, deflate=True)
