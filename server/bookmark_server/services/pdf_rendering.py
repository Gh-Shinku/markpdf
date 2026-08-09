from __future__ import annotations

import base64
import hashlib
from pathlib import Path
from typing import Any

import fitz


def render_pdf_page_image(
    input_pdf: Path,
    page: int,
    dpi: int,
) -> dict[str, Any]:
    if page < 1:
        raise ValueError("PDF page must be >= 1")
    with fitz.open(input_pdf) as doc:
        if page > doc.page_count:
            raise ValueError(f"PDF page {page} out of range (page_count={doc.page_count})")
        pdf_page = doc.load_page(page - 1)
        zoom = dpi / 72.0
        matrix = fitz.Matrix(zoom, zoom)
        pix = pdf_page.get_pixmap(matrix=matrix, alpha=False)
        image_bytes = pix.tobytes("png")
    b64 = base64.b64encode(image_bytes).decode("ascii")
    return {
        "dpi": dpi,
        "mime_type": "image/png",
        "width": pix.width,
        "height": pix.height,
        "sha256": hashlib.sha256(image_bytes).hexdigest(),
        "data_url": f"data:image/png;base64,{b64}",
    }
