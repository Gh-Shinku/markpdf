from __future__ import annotations

import json
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..core import apply_toc_to_pdf
from ..services.generation_jobs import generation_job_store
from ..services.projects import store
from ..services.toc_extraction import extract_toc_json


router = APIRouter(tags=["projects"])


class TocPayload(BaseModel):
    toc_json: str


class ProjectMetadataPayload(BaseModel):
    page_offset: int


class ValidatePayload(BaseModel):
    toc_json: str
    page_offset: int = 0


class ApplyPayload(BaseModel):
    toc_json: str
    page_offset: int = 0


class GeneratePayload(BaseModel):
    toc_start: int
    toc_end: int


class LlmSettingsPayload(BaseModel):
    base_url: str | None = None
    model: str | None = None
    api_key: str | None = None


def _project_or_404(project_id: str) -> dict[str, Any]:
    try:
        return store.get_project(project_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc


def _run_generate_toc_job(
    job_id: str,
    project_id: str,
    payload: GeneratePayload,
    settings: dict[str, Any],
) -> None:
    total_pages = payload.toc_end - payload.toc_start + 1
    generation_job_store.mark_running(job_id, "Preparing TOC generation")

    def record_page_progress(
        page_call_index: int,
        callback_total_pages: int,
        source: str,
        stage: str,
        entries: int | None,
        _elapsed: float | None,
    ) -> None:
        if stage == "rendering":
            phase = "rendering"
            message = f"Rendering TOC page {page_call_index} of {callback_total_pages}"
            completed_pages = page_call_index - 1
        elif stage == "scanning":
            phase = "scanning"
            message = f"Reading TOC page {page_call_index} of {callback_total_pages} with VLM"
            completed_pages = page_call_index - 1
        else:
            phase = "processing"
            message = f"Processed TOC page {page_call_index} of {callback_total_pages}"
            completed_pages = page_call_index

        generation_job_store.update_progress(
            job_id,
            phase=phase,
            message=message,
            current_page=page_call_index,
            completed_pages=completed_pages,
            total_pages=callback_total_pages,
            source=source.lower(),
            entries=entries,
        )

    try:
        toc_data, _, _, _, stats = extract_toc_json(
            input_pdf=store.pdf_path(project_id),
            toc_start=payload.toc_start - 1,
            toc_end=payload.toc_end - 1,
            api_key=str(settings.get("api_key") or ""),
            base_url=str(settings.get("base_url") or ""),
            model=str(settings.get("model") or ""),
            dpi=220,
            cache_dir=store.cache_dir(),
            overwrite_cache=False,
            mode="flat",
            on_flat_page_event=record_page_progress,
        )
        generation_job_store.update_progress(
            job_id,
            phase="saving",
            message="Saving generated TOC JSON",
            current_page=total_pages,
            completed_pages=total_pages,
            total_pages=total_pages,
        )
        toc_text = json.dumps(toc_data, ensure_ascii=False, indent=2)
        metadata = store.save_toc_text(project_id, toc_text, generated=True)
        generation_job_store.mark_succeeded(
            job_id,
            "Generated TOC replaced the project JSON",
            {
                "project": metadata,
                "stats": stats,
            },
        )
    except Exception as exc:
        generation_job_store.mark_failed(
            job_id,
            "TOC generation failed",
            str(exc),
        )


@router.get("/projects")
def list_projects() -> dict[str, Any]:
    return {"projects": store.list_projects()}


@router.post("/projects")
async def create_project(
    pdf: UploadFile = File(...),
    toc_json: UploadFile | None = File(default=None),
) -> dict[str, Any]:
    if pdf.content_type not in {None, "application/pdf", "application/octet-stream"}:
        raise HTTPException(status_code=400, detail="Uploaded PDF must be a PDF file")

    try:
        metadata = store.create_project(
            pdf_filename=pdf.filename or "source.pdf",
            pdf_bytes=await pdf.read(),
            toc_bytes=await toc_json.read() if toc_json is not None else None,
            toc_filename=toc_json.filename if toc_json is not None else None,
        )
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="TOC JSON must be UTF-8") from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"JSON syntax error: {exc.msg}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"project": metadata}


@router.get("/projects/{project_id}")
def get_project(project_id: str) -> dict[str, Any]:
    return {"project": _project_or_404(project_id)}


@router.delete("/projects/{project_id}")
def delete_project(project_id: str) -> dict[str, str]:
    try:
        store.delete_project(project_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc
    return {"status": "deleted"}


@router.get("/projects/{project_id}/pdf")
def get_project_pdf(project_id: str) -> FileResponse:
    project = _project_or_404(project_id)
    return FileResponse(
        store.pdf_path(project_id),
        media_type="application/pdf",
        filename=project.get("pdf_filename") or "source.pdf",
        content_disposition_type="inline",
    )


@router.get("/projects/{project_id}/toc")
def get_project_toc(project_id: str) -> dict[str, str]:
    _project_or_404(project_id)
    return {"toc_json": store.read_toc_text(project_id)}


@router.put("/projects/{project_id}/toc")
def save_project_toc(project_id: str, payload: TocPayload) -> dict[str, Any]:
    _project_or_404(project_id)
    metadata = store.save_toc_text(project_id, payload.toc_json)
    return {"project": metadata, "toc_json": payload.toc_json}


@router.put("/projects/{project_id}/metadata")
def update_project_metadata(project_id: str, payload: ProjectMetadataPayload) -> dict[str, Any]:
    _project_or_404(project_id)
    metadata = store.update_project_metadata(project_id, payload.page_offset)
    return {"project": metadata}


@router.post("/projects/{project_id}/validate")
def validate_project_toc(project_id: str, payload: ValidatePayload) -> dict[str, Any]:
    _project_or_404(project_id)
    validation = store.validate_toc(
        project_id=project_id,
        toc_text=payload.toc_json,
        page_offset=payload.page_offset,
    )
    metadata = store.record_validation(project_id, validation, payload.page_offset)
    return {"validation": validation.to_dict(), "project": metadata}


@router.post("/projects/{project_id}/apply")
def apply_project_toc(project_id: str, payload: ApplyPayload) -> FileResponse:
    project = _project_or_404(project_id)
    validation = store.validate_toc(
        project_id=project_id,
        toc_text=payload.toc_json,
        page_offset=payload.page_offset,
    )
    store.record_validation(project_id, validation, payload.page_offset)
    if not validation.valid or validation.normalized_toc is None:
        detail = validation.issues[0].message if validation.issues else "Invalid TOC JSON"
        raise HTTPException(status_code=400, detail=detail)

    document_pdf = store.pdf_path(project_id)
    temporary_pdf = document_pdf.with_name(f".{document_pdf.stem}.{uuid4().hex}.pdf")
    try:
        apply_toc_to_pdf(
            input_pdf=document_pdf,
            output_pdf=temporary_pdf,
            toc_data=validation.normalized_toc,
            page_offset=payload.page_offset,
        )
        temporary_pdf.replace(document_pdf)
    except Exception as exc:
        temporary_pdf.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="Failed to apply TOC to PDF") from exc

    return FileResponse(
        document_pdf,
        media_type="application/pdf",
        filename=project.get("pdf_filename") or "source.pdf",
    )


@router.post("/projects/{project_id}/generate-toc")
def generate_project_toc(
    project_id: str,
    payload: GeneratePayload,
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    project = _project_or_404(project_id)
    if payload.toc_start < 1 or payload.toc_end < 1:
        raise HTTPException(status_code=400, detail="TOC page range must be one-based and >= 1")
    if payload.toc_start > payload.toc_end:
        raise HTTPException(status_code=400, detail="TOC start page must be <= TOC end page")
    if payload.toc_end > int(project.get("page_count") or 0):
        raise HTTPException(status_code=400, detail="TOC end page exceeds PDF page count")

    settings = store.read_llm_settings()
    api_key = str(settings.get("api_key") or "")
    if not api_key:
        raise HTTPException(status_code=400, detail="LLM API key is not configured")

    active_job = generation_job_store.find_active_job(project_id)
    if active_job is not None:
        raise HTTPException(status_code=409, detail="TOC generation is already running for this project")

    job = generation_job_store.create_job(
        project_id=project_id,
        toc_start=payload.toc_start,
        toc_end=payload.toc_end,
    )
    background_tasks.add_task(_run_generate_toc_job, job["id"], project_id, payload, settings)
    return {"job": job}


@router.get("/projects/{project_id}/generation-jobs")
def list_project_generation_jobs(
    project_id: str,
    limit: int = Query(default=10, ge=1, le=50),
) -> dict[str, Any]:
    _project_or_404(project_id)
    return {"jobs": generation_job_store.list_jobs(project_id, limit)}


@router.get("/generation-jobs")
def list_generation_jobs(
    limit: int = Query(default=50, ge=1, le=100),
    status: str | None = Query(default=None, pattern="^(queued|running|succeeded|failed)$"),
) -> dict[str, Any]:
    return {"jobs": generation_job_store.list_all_jobs(limit=limit, status=status)}


@router.get("/jobs/{job_id}")
def get_generation_job(job_id: str) -> dict[str, Any]:
    try:
        job = generation_job_store.get_job(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    return {"job": job}


@router.get("/settings/llm")
def get_llm_settings() -> dict[str, Any]:
    return {"settings": store.public_llm_settings()}


@router.put("/settings/llm")
def save_llm_settings(payload: LlmSettingsPayload) -> dict[str, Any]:
    settings = store.save_llm_settings(payload.model_dump())
    public = store.public_llm_settings()
    public["has_api_key"] = bool(settings.get("api_key"))
    return {"settings": public}
