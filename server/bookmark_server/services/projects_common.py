from __future__ import annotations

import os
from datetime import UTC, datetime
from pathlib import Path


DEFAULT_TOC = [
    {
        "title": "Contents",
        "page": 1,
        "attribute": "absolute",
        "children": [],
    }
]

DOCUMENT_FILENAME = "document.pdf"
LEGACY_SOURCE_FILENAME = "source.pdf"
LEGACY_OUTPUT_FILENAME = "output.pdf"


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


def default_data_dir() -> Path:
    return Path(os.getenv("BOOKMARK_WORKSPACE_DATA", "workspace_data"))
