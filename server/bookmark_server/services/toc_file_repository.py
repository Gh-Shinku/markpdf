from __future__ import annotations

from pathlib import Path
from typing import Any

from .project_repository import ProjectRepository
from .projects_common import utc_now_iso
from .storage import safe_id, write_text_atomic


class TocFileRepository:
    def __init__(self, root: Path, projects: ProjectRepository) -> None:
        self.root = root
        self.projects = projects

    def list_toc_files(self, project_id: str) -> list[dict[str, Any]]:
        metadata = self.projects.get_project(project_id)
        records = metadata.get("toc_files")
        if not isinstance(records, list):
            return [{"id": "main", "name": "toc.json", "kind": "manual", "created_at": metadata.get("toc_updated_at"), "updated_at": metadata.get("toc_updated_at"), "source_job_id": None}]
        return records

    def read_toc_file(self, project_id: str, toc_file_id: str) -> str:
        return self.toc_file_path(project_id, toc_file_id).read_text(encoding="utf-8")

    def save_toc_file(self, project_id: str, toc_file_id: str, toc_text: str) -> dict[str, Any]:
        path = self.toc_file_path(project_id, toc_file_id)
        write_text_atomic(path, toc_text)
        metadata = self.projects.get_project(project_id)
        now = utc_now_iso()
        metadata["updated_at"] = now
        if toc_file_id == "main":
            metadata["toc_updated_at"] = now
        for record in metadata.get("toc_files", []):
            if record.get("id") == toc_file_id:
                record["updated_at"] = now
        self.projects.write_metadata(project_id, metadata)
        return metadata

    def create_generated_toc_file(self, project_id: str, job_id: str, toc_text: str, provider: dict[str, Any] | None = None) -> dict[str, Any]:
        safe_job_id = safe_id(job_id, "job_id")
        metadata = self.projects.get_project(project_id)
        candidate_dir = self.projects.project_dir(project_id) / "toc_candidates"
        toc_file_id = f"generated-{safe_job_id}"
        write_text_atomic(candidate_dir / f"{toc_file_id}.json", toc_text)
        now = utc_now_iso()
        record = {
            "id": toc_file_id,
            "name": f"generated-{safe_job_id[:8]}.json",
            "kind": "generated",
            "created_at": now,
            "updated_at": now,
            "source_job_id": safe_job_id,
            "provider": provider,
        }
        records = metadata.setdefault("toc_files", self.list_toc_files(project_id))
        records.append(record)
        metadata["generated_at"] = now
        metadata["updated_at"] = now
        self.projects.write_metadata(project_id, metadata)
        return record

    def toc_file_path(self, project_id: str, toc_file_id: str) -> Path:
        if toc_file_id == "main":
            return self.projects.toc_path(project_id)
        safe_toc_file_id = safe_id(toc_file_id, "toc_file_id")
        record = next((item for item in self.list_toc_files(project_id) if item.get("id") == safe_toc_file_id), None)
        if record is None:
            raise KeyError(toc_file_id)
        return self.projects.project_dir(project_id) / "toc_candidates" / f"{safe_toc_file_id}.json"
