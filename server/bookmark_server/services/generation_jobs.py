from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import uuid4

from .projects import default_data_dir, utc_now_iso
from .storage import read_json_object, safe_id, write_json_atomic


JOB_STATUS_QUEUED = "queued"
JOB_STATUS_RUNNING = "running"
JOB_STATUS_SUCCEEDED = "succeeded"
JOB_STATUS_FAILED = "failed"
TERMINAL_JOB_STATUSES = {JOB_STATUS_SUCCEEDED, JOB_STATUS_FAILED}
ACTIVE_JOB_STATUSES = {JOB_STATUS_QUEUED, JOB_STATUS_RUNNING}


@dataclass(frozen=True)
class GenerationJobStore:
    root: Path | None = None

    @property
    def jobs_dir(self) -> Path:
        return (self.root or default_data_dir()) / "jobs"

    def create_job(
        self,
        project_id: str,
        toc_start: int,
        toc_end: int,
        provider: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        self.jobs_dir.mkdir(parents=True, exist_ok=True)
        now = utc_now_iso()
        job = {
            "id": uuid4().hex,
            "type": "generate_toc",
            "project_id": project_id,
            "status": JOB_STATUS_QUEUED,
            "message": "Queued TOC generation",
            "toc_start": toc_start,
            "toc_end": toc_end,
            "created_at": now,
            "updated_at": now,
            "started_at": None,
            "finished_at": None,
            "error": None,
            "result": None,
            "provider": provider,
            "progress": {
                "phase": "queued",
                "current_page": None,
                "completed_pages": 0,
                "total_pages": toc_end - toc_start + 1,
                "source": None,
                "entries": None,
            },
        }
        self.write_job(job)
        return job

    def get_job(self, job_id: str) -> dict[str, Any]:
        path = self._job_path(job_id)
        if not path.exists():
            raise KeyError(job_id)
        return self._normalize_job(read_json_object(path))

    def mark_running(self, job_id: str, message: str) -> dict[str, Any]:
        job = self.get_job(job_id)
        now = utc_now_iso()
        job["status"] = JOB_STATUS_RUNNING
        job["message"] = message
        job["started_at"] = job.get("started_at") or now
        job["updated_at"] = now
        self.write_job(job)
        return job

    def update_progress(
        self,
        job_id: str,
        *,
        phase: str,
        message: str,
        current_page: int | None = None,
        completed_pages: int | None = None,
        total_pages: int | None = None,
        source: str | None = None,
        entries: int | None = None,
    ) -> dict[str, Any]:
        job = self.get_job(job_id)
        progress = dict(job.get("progress") or {})
        progress["phase"] = phase
        progress["current_page"] = current_page
        if completed_pages is not None:
            progress["completed_pages"] = completed_pages
        if total_pages is not None:
            progress["total_pages"] = total_pages
        progress["source"] = source
        progress["entries"] = entries
        job["message"] = message
        job["progress"] = progress
        job["updated_at"] = utc_now_iso()
        self.write_job(job)
        return job

    def mark_succeeded(
        self,
        job_id: str,
        message: str,
        result: dict[str, Any],
    ) -> dict[str, Any]:
        job = self.get_job(job_id)
        now = utc_now_iso()
        job["status"] = JOB_STATUS_SUCCEEDED
        job["message"] = message
        job["updated_at"] = now
        job["finished_at"] = now
        job["error"] = None
        job["result"] = result
        progress = dict(job.get("progress") or {})
        progress["phase"] = "completed"
        progress["current_page"] = progress.get("total_pages")
        progress["completed_pages"] = progress.get("total_pages", 0)
        job["progress"] = progress
        self.write_job(job)
        return job

    def mark_failed(self, job_id: str, message: str, error: str) -> dict[str, Any]:
        job = self.get_job(job_id)
        now = utc_now_iso()
        job["status"] = JOB_STATUS_FAILED
        job["message"] = message
        job["updated_at"] = now
        job["finished_at"] = now
        job["error"] = error
        progress = dict(job.get("progress") or {})
        progress["phase"] = "failed"
        job["progress"] = progress
        self.write_job(job)
        return job

    def list_jobs(self, project_id: str, limit: int = 10) -> list[dict[str, Any]]:
        return [job for job in self.list_all_jobs(limit=None) if job.get("project_id") == project_id][:limit]

    def list_all_jobs(
        self,
        limit: int | None = 50,
        status: str | None = None,
    ) -> list[dict[str, Any]]:
        if not self.jobs_dir.exists():
            return []
        jobs: list[dict[str, Any]] = []
        for path in self.jobs_dir.glob("*.json"):
            try:
                job = self._normalize_job(read_json_object(path))
            except (OSError, json.JSONDecodeError, ValueError):
                continue
            if status is None or job.get("status") == status:
                jobs.append(job)
        jobs.sort(key=lambda job: str(job.get("updated_at") or ""), reverse=True)
        return jobs if limit is None else jobs[:limit]

    def find_active_job(self, project_id: str) -> dict[str, Any] | None:
        return next(
            (job for job in self.list_jobs(project_id) if job.get("status") in ACTIVE_JOB_STATUSES),
            None,
        )

    def recover_interrupted_jobs(self) -> int:
        if not self.jobs_dir.exists():
            return 0
        recovered = 0
        for path in self.jobs_dir.glob("*.json"):
            try:
                job = self._normalize_job(read_json_object(path))
            except (OSError, json.JSONDecodeError, ValueError):
                continue
            if job.get("status") not in ACTIVE_JOB_STATUSES:
                continue
            self.mark_failed(
                str(job["id"]),
                "TOC generation interrupted by server restart",
                "The server restarted before TOC generation completed.",
            )
            recovered += 1
        return recovered

    def write_job(self, job: dict[str, Any]) -> None:
        self.jobs_dir.mkdir(parents=True, exist_ok=True)
        path = self._job_path(str(job["id"]))
        write_json_atomic(path, job)

    def _job_path(self, job_id: str) -> Path:
        return self.jobs_dir / f"{safe_id(job_id, 'job_id')}.json"

    def _normalize_job(self, job: dict[str, Any]) -> dict[str, Any]:
        total_pages = max(0, int(job.get("toc_end", 0)) - int(job.get("toc_start", 0)) + 1)
        status = str(job.get("status") or JOB_STATUS_QUEUED)
        phase = "completed" if status == JOB_STATUS_SUCCEEDED else "failed" if status == JOB_STATUS_FAILED else "queued"
        progress = {
            "phase": phase,
            "current_page": None,
            "completed_pages": total_pages if status == JOB_STATUS_SUCCEEDED else 0,
            "total_pages": total_pages,
            "source": None,
            "entries": None,
        }
        progress.update(job.get("progress") or {})
        return {**job, "progress": progress}


generation_job_store = GenerationJobStore()
