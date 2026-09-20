from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any
from uuid import uuid4

import fitz

from ..core import validate_toc_json_structure
from .projects_common import (
    DEFAULT_TOC,
    DOCUMENT_FILENAME,
    LEGACY_OUTPUT_FILENAME,
    LEGACY_SOURCE_FILENAME,
    utc_now_iso,
)
from .storage import read_json_object, safe_id, write_bytes_atomic, write_json_atomic, write_text_atomic


class ProjectRepository:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.projects_dir = root / "projects"

    def ensure_root(self) -> None:
        self.projects_dir.mkdir(parents=True, exist_ok=True)

    def list_projects(self) -> list[dict[str, Any]]:
        self.ensure_root()
        projects: list[dict[str, Any]] = []
        for metadata_file in self.projects_dir.glob("*/project.json"):
            try:
                projects.append(self.normalize_metadata(read_json_object(metadata_file)))
            except (OSError, json.JSONDecodeError, ValueError):
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
        toc_text = self.initial_toc_text(toc_bytes)
        project_id = uuid4().hex
        project_dir = self.project_dir(project_id)
        project_dir.mkdir(parents=True, exist_ok=False)

        try:
            document_path = project_dir / DOCUMENT_FILENAME
            write_bytes_atomic(document_path, pdf_bytes)
            write_text_atomic(project_dir / "toc.json", toc_text)

            page_count = self.pdf_page_count(document_path)
            now = utc_now_iso()
            metadata = {
                "id": project_id,
                "name": Path(pdf_filename).stem or "Untitled PDF",
                "pdf_filename": pdf_filename or "source.pdf",
                "toc_filename": toc_filename,
                "page_offset": page_offset,
                "toc_start": 1,
                "toc_end": page_count,
                "inject_toc_page": False,
                "provider_id": None,
                "page_count": page_count,
                "created_at": now,
                "updated_at": now,
                "toc_updated_at": now,
                "generated_at": None,
                "last_validation": None,
            }
            self.write_metadata(project_id, metadata)
            return metadata
        except Exception:
            shutil.rmtree(project_dir, ignore_errors=True)
            raise

    def get_project(self, project_id: str) -> dict[str, Any]:
        metadata_file = self.project_dir(project_id) / "project.json"
        if not metadata_file.exists():
            raise KeyError(project_id)
        return self.normalize_metadata(read_json_object(metadata_file))

    def delete_project(self, project_id: str) -> None:
        project_dir = self.project_dir(project_id)
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
        write_text_atomic(self.toc_path(project_id), toc_text)
        now = utc_now_iso()
        metadata["updated_at"] = now
        metadata["toc_updated_at"] = now
        if generated:
            metadata["generated_at"] = now
        self.write_metadata(project_id, metadata)
        return metadata

    def update_project_metadata(
        self,
        project_id: str,
        *,
        page_offset: int | None = None,
        toc_start: int | None = None,
        toc_end: int | None = None,
        provider_id: str | None = None,
        provider_id_set: bool = False,
        inject_toc_page: bool | None = None,
    ) -> dict[str, Any]:
        metadata = self.get_project(project_id)
        if page_offset is not None:
            metadata["page_offset"] = page_offset
        if toc_start is not None:
            metadata["toc_start"] = toc_start
        if toc_end is not None:
            metadata["toc_end"] = toc_end
        if provider_id_set:
            metadata["provider_id"] = provider_id
        if inject_toc_page is not None:
            metadata["inject_toc_page"] = inject_toc_page
        metadata["updated_at"] = utc_now_iso()
        self.write_metadata(project_id, metadata)
        return metadata

    def record_validation(self, project_id: str, validation: Any, page_offset: int) -> dict[str, Any]:
        metadata = self.get_project(project_id)
        metadata["page_offset"] = page_offset
        metadata["updated_at"] = utc_now_iso()
        metadata["last_validation"] = {
            "valid": validation.valid,
            "bookmark_count": validation.bookmark_count,
            "checked_at": utc_now_iso(),
            "issues": [{"message": issue.message} for issue in validation.issues],
        }
        self.write_metadata(project_id, metadata)
        return metadata

    def pdf_path(self, project_id: str) -> Path:
        project_dir = self.project_dir(project_id)
        document_path = project_dir / DOCUMENT_FILENAME
        legacy_paths = [
            project_dir / LEGACY_SOURCE_FILENAME,
            project_dir / LEGACY_OUTPUT_FILENAME,
        ]

        if document_path.exists():
            for legacy_path in legacy_paths:
                legacy_path.unlink(missing_ok=True)
            return document_path

        legacy_document = next((path for path in reversed(legacy_paths) if path.exists()), None)
        if legacy_document is None:
            raise KeyError(project_id)

        legacy_document.replace(document_path)
        for legacy_path in legacy_paths:
            legacy_path.unlink(missing_ok=True)
        return document_path

    def toc_path(self, project_id: str) -> Path:
        return self.project_dir(project_id) / "toc.json"

    def project_dir(self, project_id: str) -> Path:
        return self.projects_dir / safe_id(project_id, "project_id")

    def write_metadata(self, project_id: str, metadata: dict[str, Any]) -> None:
        write_json_atomic(self.project_dir(project_id) / "project.json", metadata)

    def normalize_metadata(self, metadata: dict[str, Any]) -> dict[str, Any]:
        page_count = int(metadata.get("page_count") or 0)
        normalized = dict(metadata)
        normalized["page_offset"] = int(normalized.get("page_offset") or 0)
        normalized["toc_start"] = int(normalized.get("toc_start") or 1)
        normalized["toc_end"] = int(normalized.get("toc_end") or page_count)
        normalized["provider_id"] = normalized.get("provider_id") or None
        normalized["inject_toc_page"] = bool(normalized.get("inject_toc_page", False))
        return normalized

    def initial_toc_text(self, toc_bytes: bytes | None) -> str:
        if toc_bytes is None:
            return json.dumps(DEFAULT_TOC, ensure_ascii=False, indent=2)
        toc_text = toc_bytes.decode("utf-8")
        raw_data = json.loads(toc_text)
        normalized = validate_toc_json_structure(raw_data)
        return json.dumps(normalized, ensure_ascii=False, indent=2)

    def pdf_page_count(self, pdf_path: Path) -> int:
        with fitz.open(pdf_path) as doc:
            return doc.page_count
