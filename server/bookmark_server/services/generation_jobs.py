from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import uuid4

from .projects import default_data_dir, utc_now_iso


JOB_STATUS_QUEUED = "queued"
JOB_STATUS_RUNNING = "running"
JOB_STATUS_SUCCEEDED = "succeeded"
JOB_STATUS_FAILED = "failed"
TERMINAL_JOB_STATUSES = {JOB_STATUS_SUCCEEDED, JOB_STATUS_FAILED}


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
        }
        self.write_job(job)
        return job

    def get_job(self, job_id: str) -> dict[str, Any]:
        path = self._job_path(job_id)
        if not path.exists():
            raise KeyError(job_id)
        return json.loads(path.read_text(encoding="utf-8"))

    def mark_running(self, job_id: str, message: str) -> dict[str, Any]:
        job = self.get_job(job_id)
        now = utc_now_iso()
        job["status"] = JOB_STATUS_RUNNING
        job["message"] = message
        job["started_at"] = job.get("started_at") or now
        job["updated_at"] = now
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
        self.write_job(job)
        return job

    def write_job(self, job: dict[str, Any]) -> None:
        self.jobs_dir.mkdir(parents=True, exist_ok=True)
        path = self._job_path(str(job["id"]))
        path.write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")

    def _job_path(self, job_id: str) -> Path:
        return self.jobs_dir / f"{job_id}.json"


generation_job_store = GenerationJobStore()
