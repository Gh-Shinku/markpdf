from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from fastapi.responses import Response

from ..schemas.generation_jobs import GeneratePayload
from ..services import runtime
from ..services.project_queries import ProjectNotFoundError, get_project
from ..services.provider_config import ProviderConfigError
from ..services.toc_application import (
    TocFileNotFoundError,
    TocValidationError,
    apply_toc_file_to_project,
    build_applied_pdf_bytes,
    prepare_toc_for_apply,
)
from ..services.toc_generation import (
    ActiveGenerationJobError,
    GenerationValidationError,
    create_batch_generation_jobs,
    create_generation_job,
)


router = APIRouter(tags=["generation-jobs"])


def _generation_error(exc: Exception) -> HTTPException:
    if isinstance(exc, ProjectNotFoundError):
        return HTTPException(status_code=404, detail="Project not found")
    if isinstance(exc, ActiveGenerationJobError):
        return HTTPException(status_code=409, detail=str(exc))
    return HTTPException(status_code=400, detail=str(exc))


@router.post("/projects/{project_id}/generate-toc")
def generate_project_toc(
    project_id: str,
    payload: GeneratePayload,
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    try:
        job = create_generation_job(
            project_id,
            payload.toc_start,
            payload.toc_end,
            payload.provider_id,
            payload.page_offset,
            background_tasks=background_tasks,
        )
    except (ProjectNotFoundError, GenerationValidationError, ActiveGenerationJobError, ProviderConfigError) as exc:
        raise _generation_error(exc) from exc
    return {"job": job}


@router.post("/generation-jobs/batch")
def generate_toc_batch(payload: dict[str, Any]) -> dict[str, Any]:
    requests = payload.get("requests")
    if not isinstance(requests, list) or not requests:
        raise HTTPException(status_code=400, detail="Select at least one project")
    validated: list[dict[str, Any]] = []
    for item in requests:
        try:
            request = GeneratePayload.model_validate(item)
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Invalid generation request") from exc
        validated.append({"project_id": str(item.get("project_id") or ""), **request.model_dump()})
    try:
        return {"jobs": create_batch_generation_jobs(validated)}
    except (ProjectNotFoundError, GenerationValidationError, ActiveGenerationJobError, ProviderConfigError, KeyError, ValueError) as exc:
        raise _generation_error(exc) from exc


@router.get("/projects/{project_id}/generation-jobs")
def list_project_generation_jobs(
    project_id: str,
    limit: int = Query(default=10, ge=1, le=50),
) -> dict[str, Any]:
    try:
        get_project(project_id)
    except ProjectNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc
    return {"jobs": runtime.generation_job_store.list_jobs(project_id, limit)}


@router.get("/generation-jobs")
def list_generation_jobs(
    limit: int = Query(default=50, ge=1, le=100),
    status: str | None = Query(default=None, pattern="^(queued|running|succeeded|failed)$"),
) -> dict[str, Any]:
    return {"jobs": runtime.generation_job_store.list_all_jobs(limit=limit, status=status)}


@router.get("/jobs/{job_id}")
def get_generation_job(job_id: str) -> dict[str, Any]:
    try:
        job = runtime.generation_job_store.get_job(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    return {"job": job}


@router.post("/jobs/{job_id}/apply")
def apply_generation_job(job_id: str):
    try:
        job = runtime.generation_job_store.get_job(job_id)
        toc_file = (job.get("result") or {}).get("toc_file") or {}
        toc_file_id = str(toc_file["id"])
    except (KeyError, TypeError) as exc:
        raise HTTPException(status_code=404, detail="Generated TOC candidate not found") from exc
    try:
        project = get_project(str(job["project_id"]))
        applied = apply_toc_file_to_project(
            str(job["project_id"]),
            toc_file_id,
            int(project.get("page_offset") or 0),
        )
    except (ProjectNotFoundError, TocFileNotFoundError) as exc:
        raise HTTPException(status_code=404, detail="Generated TOC candidate not found") from exc
    except TocValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    from fastapi.responses import FileResponse

    return FileResponse(applied.path, media_type="application/pdf", filename=applied.filename)


@router.get("/jobs/{job_id}/download")
def download_generation_job(job_id: str) -> Response:
    try:
        job = runtime.generation_job_store.get_job(job_id)
        toc_file = (job.get("result") or {}).get("toc_file") or {}
        toc_text = runtime.store.read_toc_file(str(job["project_id"]), str(toc_file["id"]))
    except (KeyError, TypeError) as exc:
        raise HTTPException(status_code=404, detail="Generated TOC candidate not found") from exc
    try:
        project = get_project(str(job["project_id"]))
        toc_data = prepare_toc_for_apply(
            str(job["project_id"]),
            project,
            toc_text,
            int(project.get("page_offset") or 0),
        )
        runtime.store.save_toc_file(
            str(job["project_id"]),
            str(toc_file["id"]),
            json.dumps(toc_data, ensure_ascii=False, indent=2),
        )
        content, filename = build_applied_pdf_bytes(
            str(job["project_id"]),
            json.dumps(toc_data, ensure_ascii=False, indent=2),
            int(project.get("page_offset") or 0),
        )
    except (ProjectNotFoundError, TocValidationError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
