from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any
from uuid import uuid4


_SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def safe_id(value: str, label: str = "id") -> str:
    candidate = str(value)
    if not candidate or not _SAFE_ID_RE.fullmatch(candidate):
        raise KeyError(f"Invalid {label}: {value!r}")
    return candidate


def write_text_atomic(path: Path, content: str, encoding: str = "utf-8") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        temporary_path.write_text(content, encoding=encoding)
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def write_bytes_atomic(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        temporary_path.write_bytes(content)
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def write_json_atomic(path: Path, data: Any) -> None:
    write_text_atomic(path, json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def read_json_object(path: Path) -> dict[str, Any]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError(f"Expected JSON object at {path}")
    return raw


def read_json_array(path: Path) -> list[Any]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError(f"Expected JSON array at {path}")
    return raw
