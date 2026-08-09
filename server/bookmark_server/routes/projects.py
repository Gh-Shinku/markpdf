from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from ..schemas.projects import ApplyPayload, ProjectMetadataPayload, TocFileApplyPayload, TocPayload, ValidatePayload
from ..services import runtime
from ..services.project_queries import ProjectNotFoundError, get_project, render_project_page
from ..services.provider_config import ProviderConfigError, get_verified_provider
from ..services.toc_application import (
    TocApplyError,
    TocFileNotFoundError,
    TocValidationError,
    apply_toc_file_to_project,
    apply_toc_text_to_project,
)


router = APIRouter(tags=["projects"])


def _http_project(project_id: str) -> dict[str, Any]:
    try:
        return get_project(project_id)
    except ProjectNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc


def _validate_metadata(project: dict[str, Any], payload: ProjectMetadataPayload) -> None:
    toc_start = payload.toc_start if payload.toc_start is not None else int(project.get("toc_start") or 1)
    toc_end = payload.toc_end if payload.toc_end is not None else int(project.get("toc_end") or project.get("page_count") or 0)
    if toc_start < 1 or toc_end < 1:
        raise HTTPException(status_code=400, detail="TOC page range must be one-based and >= 1")
    if toc_start > toc_end:
        raise HTTPException(status_code=400, detail="TOC start page must be <= TOC end page")
    if toc_end > int(project.get("page_count") or 0):
        raise HTTPException(status_code=400, detail="TOC end page exceeds PDF page count")
    if "provider_id" in payload.model_fields_set and payload.provider_id is not None:
        try:
            get_verified_provider(payload.provider_id)
        except ProviderConfigError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc


def _file_response(applied_pdf) -> FileResponse:
    return FileResponse(
        applied_pdf.path,
        media_type="application/pdf",
        filename=applied_pdf.filename,
    )


@router.get("/projects")
def list_projects() -> dict[str, Any]:
    return {"projects": runtime.store.list_projects()}


@router.post("/projects")
async def create_project(
    pdf: UploadFile = File(...),
    toc_json: UploadFile | None = File(default=None),
) -> dict[str, Any]:
    if pdf.content_type not in {None, "application/pdf", "application/octet-stream"}:
        raise HTTPException(status_code=400, detail="Uploaded PDF must be a PDF file")

    try:
        metadata = runtime.store.create_project(
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
def read_project(project_id: str) -> dict[str, Any]:
    return {"project": _http_project(project_id)}


@router.delete("/projects/{project_id}")
def delete_project(project_id: str) -> dict[str, str]:
    try:
        runtime.store.delete_project(project_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc
    return {"status": "deleted"}


@router.get("/projects/{project_id}/pdf")
def get_project_pdf(project_id: str) -> FileResponse:
    project = _http_project(project_id)
    return FileResponse(
        runtime.store.pdf_path(project_id),
        media_type="application/pdf",
        filename=project.get("pdf_filename") or "source.pdf",
        content_disposition_type="inline",
    )


@router.get("/projects/{project_id}/rendered-pages/{page}")
def get_project_rendered_page(project_id: str, page: int) -> dict[str, Any]:
    try:
        return render_project_page(project_id, page, 220)
    except ProjectNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/projects/{project_id}/toc")
def get_project_toc(project_id: str) -> dict[str, str]:
    _http_project(project_id)
    return {"toc_json": runtime.store.read_toc_text(project_id)}


@router.put("/projects/{project_id}/toc")
def save_project_toc(project_id: str, payload: TocPayload) -> dict[str, Any]:
    _http_project(project_id)
    metadata = runtime.store.save_toc_text(project_id, payload.toc_json)
    return {"project": metadata, "toc_json": payload.toc_json}


@router.put("/projects/{project_id}/metadata")
def update_project_metadata(project_id: str, payload: ProjectMetadataPayload) -> dict[str, Any]:
    project = _http_project(project_id)
    _validate_metadata(project, payload)
    metadata = runtime.store.update_project_metadata(
        project_id,
        page_offset=payload.page_offset,
        toc_start=payload.toc_start,
        toc_end=payload.toc_end,
        provider_id=payload.provider_id,
        provider_id_set="provider_id" in payload.model_fields_set,
        inject_toc_page=payload.inject_toc_page,
    )
    return {"project": metadata}


@router.post("/projects/{project_id}/validate")
def validate_project_toc(project_id: str, payload: ValidatePayload) -> dict[str, Any]:
    _http_project(project_id)
    validation = runtime.store.validate_toc(
        project_id=project_id,
        toc_text=payload.toc_json,
        page_offset=payload.page_offset,
    )
    metadata = runtime.store.record_validation(project_id, validation, payload.page_offset)
    return {"validation": validation.to_dict(), "project": metadata}


@router.post("/projects/{project_id}/apply")
def apply_project_toc(project_id: str, payload: ApplyPayload) -> FileResponse:
    try:
        return _file_response(apply_toc_text_to_project(project_id, payload.toc_json, payload.page_offset))
    except ProjectNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc
    except TocValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except TocApplyError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/projects/{project_id}/toc-files")
def list_project_toc_files(project_id: str) -> dict[str, Any]:
    _http_project(project_id)
    return {"toc_files": runtime.store.list_toc_files(project_id)}


@router.get("/projects/{project_id}/toc-files/{toc_file_id}")
def get_project_toc_file(project_id: str, toc_file_id: str) -> dict[str, Any]:
    _http_project(project_id)
    try:
        return {"toc_json": runtime.store.read_toc_file(project_id, toc_file_id)}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="TOC file not found") from exc


@router.put("/projects/{project_id}/toc-files/{toc_file_id}")
def save_project_toc_file(project_id: str, toc_file_id: str, payload: TocPayload) -> dict[str, Any]:
    try:
        metadata = runtime.store.save_toc_file(project_id, toc_file_id, payload.toc_json)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="TOC file not found") from exc
    return {"project": metadata, "toc_json": payload.toc_json}


@router.post("/projects/{project_id}/toc-files/{toc_file_id}/apply")
def apply_project_toc_file(project_id: str, toc_file_id: str, payload: TocFileApplyPayload) -> FileResponse:
    try:
        return _file_response(apply_toc_file_to_project(project_id, toc_file_id, payload.page_offset))
    except ProjectNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc
    except TocFileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="TOC file not found") from exc
    except TocValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except TocApplyError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
