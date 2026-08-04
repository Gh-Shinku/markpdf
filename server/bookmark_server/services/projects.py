from __future__ import annotations

import json
import os
import shutil
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import fitz

from bookmark.core import flatten_to_pymupdf_toc, parse_toc_items, validate_toc_json_structure


DEFAULT_TOC = [
    {
        "title": "Contents",
        "page": 1,
        "attribute": "absolute",
        "children": [],
    }
]


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


def default_data_dir() -> Path:
    return Path(os.getenv("BOOKMARK_WORKSPACE_DATA", "workspace_data"))


@dataclass(frozen=True)
class ValidationIssue:
    message: str


@dataclass(frozen=True)
class ValidationResult:
    valid: bool
    issues: list[ValidationIssue]
    normalized_toc: list[dict[str, Any]] | None = None
    bookmark_count: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "valid": self.valid,
            "issues": [{"message": issue.message} for issue in self.issues],
            "normalized_toc": self.normalized_toc,
            "bookmark_count": self.bookmark_count,
        }


class ProjectStore:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or default_data_dir()
        self.projects_dir = self.root / "projects"
        self.settings_file = self.root / "settings.json"

    def ensure_root(self) -> None:
        self.projects_dir.mkdir(parents=True, exist_ok=True)

    def list_projects(self) -> list[dict[str, Any]]:
        self.ensure_root()
        projects: list[dict[str, Any]] = []
        for metadata_file in self.projects_dir.glob("*/project.json"):
            try:
                projects.append(json.loads(metadata_file.read_text(encoding="utf-8")))
            except (OSError, json.JSONDecodeError):
                continue
        return sorted(projects, key=lambda item: item.get("updated_at", ""), reverse=True)

    def create_project(
        self,
        pdf_filename: str,
        pdf_bytes: bytes,
        toc_bytes: bytes | None = None,
        toc_filename: str | None = None,
        page_offset: int = 0,
    ) -> dict[str, Any]:
        self.ensure_root()
        project_id = uuid4().hex
        project_dir = self.projects_dir / project_id
        project_dir.mkdir(parents=True, exist_ok=False)

        (project_dir / "source.pdf").write_bytes(pdf_bytes)
        toc_text = self._initial_toc_text(toc_bytes)
        (project_dir / "toc.json").write_text(toc_text, encoding="utf-8")

        page_count = self._pdf_page_count(project_dir / "source.pdf")
        now = utc_now_iso()
        metadata = {
            "id": project_id,
            "name": Path(pdf_filename).stem or "Untitled PDF",
            "pdf_filename": pdf_filename or "source.pdf",
            "toc_filename": toc_filename,
            "page_offset": page_offset,
            "page_count": page_count,
            "created_at": now,
            "updated_at": now,
            "toc_updated_at": now,
            "generated_at": None,
            "last_validation": None,
        }
        self._write_metadata(project_id, metadata)
        return metadata

    def get_project(self, project_id: str) -> dict[str, Any]:
        metadata_file = self._project_dir(project_id) / "project.json"
        if not metadata_file.exists():
            raise KeyError(project_id)
        return json.loads(metadata_file.read_text(encoding="utf-8"))

    def delete_project(self, project_id: str) -> None:
        project_dir = self._project_dir(project_id)
        if not project_dir.exists():
            raise KeyError(project_id)
        shutil.rmtree(project_dir)

    def read_toc_text(self, project_id: str) -> str:
        toc_file = self.toc_path(project_id)
        if not toc_file.exists():
            raise KeyError(project_id)
        return toc_file.read_text(encoding="utf-8")

    def save_toc_text(self, project_id: str, toc_text: str, generated: bool = False) -> dict[str, Any]:
        metadata = self.get_project(project_id)
        self.toc_path(project_id).write_text(toc_text, encoding="utf-8")
        now = utc_now_iso()
        metadata["updated_at"] = now
        metadata["toc_updated_at"] = now
        if generated:
            metadata["generated_at"] = now
        self._write_metadata(project_id, metadata)
        return metadata

    def update_project_metadata(self, project_id: str, page_offset: int) -> dict[str, Any]:
        metadata = self.get_project(project_id)
        metadata["page_offset"] = page_offset
        metadata["updated_at"] = utc_now_iso()
        self._write_metadata(project_id, metadata)
        return metadata

    def record_validation(
        self,
        project_id: str,
        validation: ValidationResult,
        page_offset: int,
    ) -> dict[str, Any]:
        metadata = self.get_project(project_id)
        metadata["page_offset"] = page_offset
        metadata["updated_at"] = utc_now_iso()
        metadata["last_validation"] = {
            "valid": validation.valid,
            "bookmark_count": validation.bookmark_count,
            "checked_at": utc_now_iso(),
            "issues": [{"message": issue.message} for issue in validation.issues],
        }
        self._write_metadata(project_id, metadata)
        return metadata

    def pdf_path(self, project_id: str) -> Path:
        return self._project_dir(project_id) / "source.pdf"

    def toc_path(self, project_id: str) -> Path:
        return self._project_dir(project_id) / "toc.json"

    def output_path(self, project_id: str) -> Path:
        return self._project_dir(project_id) / "output.pdf"

    def cache_dir(self) -> Path:
        path = self.root / "cache"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def validate_toc(self, project_id: str, toc_text: str, page_offset: int) -> ValidationResult:
        pdf_path = self.pdf_path(project_id)
        if not pdf_path.exists():
            raise KeyError(project_id)

        try:
            raw_data = json.loads(toc_text)
            normalized = validate_toc_json_structure(raw_data)
            items = parse_toc_items(normalized)
            page_count = self._pdf_page_count(pdf_path)
            flattened = flatten_to_pymupdf_toc(
                items=items,
                page_offset=page_offset,
                pdf_page_count=page_count,
            )
        except json.JSONDecodeError as exc:
            return ValidationResult(
                valid=False,
                issues=[ValidationIssue(f"JSON syntax error: {exc.msg} at line {exc.lineno}")],
            )
        except ValueError as exc:
            return ValidationResult(valid=False, issues=[ValidationIssue(str(exc))])

        return ValidationResult(
            valid=True,
            issues=[],
            normalized_toc=normalized,
            bookmark_count=len(flattened),
        )

    def read_llm_settings(self) -> dict[str, Any]:
        if not self.settings_file.exists():
            return {
                "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
                "model": "qwen3-vl-flash",
                "api_key": "",
            }
        return json.loads(self.settings_file.read_text(encoding="utf-8"))

    def save_llm_settings(self, settings: dict[str, Any]) -> dict[str, Any]:
        self.root.mkdir(parents=True, exist_ok=True)
        previous = self.read_llm_settings()
        api_key = settings.get("api_key")
        next_settings = {
            "base_url": str(settings.get("base_url") or previous.get("base_url") or "").strip(),
            "model": str(settings.get("model") or previous.get("model") or "").strip(),
            "api_key": previous.get("api_key", "") if api_key is None else str(api_key),
        }
        self.settings_file.write_text(
            json.dumps(next_settings, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return next_settings

    def public_llm_settings(self) -> dict[str, Any]:
        settings = self.read_llm_settings()
        api_key = str(settings.get("api_key") or "")
        return {
            "base_url": settings.get("base_url") or "",
            "model": settings.get("model") or "",
            "has_api_key": bool(api_key),
            "api_key_hint": self._api_key_hint(api_key),
        }

    def _project_dir(self, project_id: str) -> Path:
        return self.projects_dir / project_id

    def _write_metadata(self, project_id: str, metadata: dict[str, Any]) -> None:
        project_dir = self._project_dir(project_id)
        project_dir.mkdir(parents=True, exist_ok=True)
        (project_dir / "project.json").write_text(
            json.dumps(metadata, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _initial_toc_text(self, toc_bytes: bytes | None) -> str:
        if toc_bytes is None:
            return json.dumps(DEFAULT_TOC, ensure_ascii=False, indent=2)
        toc_text = toc_bytes.decode("utf-8")
        raw_data = json.loads(toc_text)
        normalized = validate_toc_json_structure(raw_data)
        return json.dumps(normalized, ensure_ascii=False, indent=2)

    def _pdf_page_count(self, pdf_path: Path) -> int:
        with fitz.open(pdf_path) as doc:
            return doc.page_count

    def _api_key_hint(self, api_key: str) -> str:
        if not api_key:
            return ""
        if len(api_key) <= 8:
            return "configured"
        return f"{api_key[:4]}...{api_key[-4:]}"


store = ProjectStore()
