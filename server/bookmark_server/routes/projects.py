from __future__ import annotations

import json
import base64
from concurrent.futures import ThreadPoolExecutor
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
import fitz

from ..core import apply_toc_to_pdf
from ..services.generation_jobs import generation_job_store
from ..services.projects import store
from ..services.toc_extraction import DEFAULT_FLAT_PROMPT, extract_toc_json, request_toc_from_vlm


router = APIRouter(tags=["projects"])
generation_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="toc-generation")


MAX_PROMPT_LENGTH = 20000


class TocPayload(BaseModel):
    toc_json: str


class ProjectMetadataPayload(BaseModel):
    page_offset: int | None = None
    toc_start: int | None = None
    toc_end: int | None = None
    provider_id: str | None = None


class ValidatePayload(BaseModel):
    toc_json: str
    page_offset: int = 0


class ApplyPayload(BaseModel):
    toc_json: str
    page_offset: int = 0


class GeneratePayload(BaseModel):
    toc_start: int
    toc_end: int
    provider_id: str
    page_offset: int | None = None


class LlmSettingsPayload(BaseModel):
    base_url: str | None = None
    model: str | None = None
    api_key: str | None = None


class ProviderPayload(BaseModel):
    id: str | None = None
    name: str
    base_url: str
    model: str
    api_key: str | None = None


class ProvidersPayload(BaseModel):
    providers: list[ProviderPayload]


class PromptsPayload(BaseModel):
    prompt: str | None = None


class TocFileApplyPayload(BaseModel):
    page_offset: int = 0


def _project_or_404(project_id: str) -> dict[str, Any]:
    try:
        return store.get_project(project_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc


def _provider_or_400(provider_id: str) -> dict[str, Any]:
    try:
        provider = store.get_llm_provider(provider_id)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail="Selected VLM API was not found") from exc
    if provider.get("verification_status") != "verified":
        raise HTTPException(status_code=400, detail="Selected VLM API has not passed the vision test")
    if not str(provider.get("api_key") or ""):
        raise HTTPException(status_code=400, detail="Selected VLM API does not have an API key")
    return provider


def _provider_snapshot(provider: dict[str, Any]) -> dict[str, str]:
    return {key: str(provider.get(key) or "") for key in ("id", "name", "base_url", "model")}


def _validate_generation(project: dict[str, Any], payload: GeneratePayload) -> dict[str, Any]:
    if payload.toc_start < 1 or payload.toc_end < 1:
        raise HTTPException(status_code=400, detail="TOC page range must be one-based and >= 1")
    if payload.toc_start > payload.toc_end:
        raise HTTPException(status_code=400, detail="TOC start page must be <= TOC end page")
    if payload.toc_end > int(project.get("page_count") or 0):
        raise HTTPException(status_code=400, detail="TOC end page exceeds PDF page count")
    if generation_job_store.find_active_job(str(project["id"])) is not None:
        raise HTTPException(status_code=409, detail="TOC generation is already running for this project")
    return _provider_or_400(payload.provider_id)


def _validate_metadata(project: dict[str, Any], payload: ProjectMetadataPayload) -> ProjectMetadataPayload:
    toc_start = payload.toc_start if payload.toc_start is not None else int(project.get("toc_start") or 1)
    toc_end = payload.toc_end if payload.toc_end is not None else int(project.get("toc_end") or project.get("page_count") or 0)
    if toc_start < 1 or toc_end < 1:
        raise HTTPException(status_code=400, detail="TOC page range must be one-based and >= 1")
    if toc_start > toc_end:
        raise HTTPException(status_code=400, detail="TOC start page must be <= TOC end page")
    if toc_end > int(project.get("page_count") or 0):
        raise HTTPException(status_code=400, detail="TOC end page exceeds PDF page count")
    if "provider_id" in payload.model_fields_set and payload.provider_id is not None:
        _provider_or_400(payload.provider_id)
    return payload


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
            prompt=store.read_toc_prompt(),
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
        toc_file = store.create_generated_toc_file(project_id, job_id, toc_text, _provider_snapshot(settings))
        generation_job_store.mark_succeeded(
            job_id,
            "Generated a TOC candidate",
            {
                "project": store.get_project(project_id),
                "toc_file": toc_file,
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
    project = _project_or_404(project_id)
    _validate_metadata(project, payload)
    metadata = store.update_project_metadata(
        project_id,
        page_offset=payload.page_offset,
        toc_start=payload.toc_start,
        toc_end=payload.toc_end,
        provider_id=payload.provider_id,
        provider_id_set="provider_id" in payload.model_fields_set,
    )
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


@router.get("/projects/{project_id}/toc-files")
def list_project_toc_files(project_id: str) -> dict[str, Any]:
    _project_or_404(project_id)
    return {"toc_files": store.list_toc_files(project_id)}


@router.get("/projects/{project_id}/toc-files/{toc_file_id}")
def get_project_toc_file(project_id: str, toc_file_id: str) -> dict[str, Any]:
    _project_or_404(project_id)
    try:
        return {"toc_json": store.read_toc_file(project_id, toc_file_id)}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="TOC file not found") from exc


@router.put("/projects/{project_id}/toc-files/{toc_file_id}")
def save_project_toc_file(project_id: str, toc_file_id: str, payload: TocPayload) -> dict[str, Any]:
    try:
        metadata = store.save_toc_file(project_id, toc_file_id, payload.toc_json)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="TOC file not found") from exc
    return {"project": metadata, "toc_json": payload.toc_json}


@router.post("/projects/{project_id}/toc-files/{toc_file_id}/apply")
def apply_project_toc_file(project_id: str, toc_file_id: str, payload: TocFileApplyPayload) -> FileResponse:
    try:
        toc_text = store.read_toc_file(project_id, toc_file_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="TOC file not found") from exc
    return apply_project_toc(project_id, ApplyPayload(toc_json=toc_text, page_offset=payload.page_offset))


@router.post("/projects/{project_id}/generate-toc")
def generate_project_toc(
    project_id: str,
    payload: GeneratePayload,
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    project = _project_or_404(project_id)
    settings = _validate_generation(project, payload)
    store.update_project_metadata(
        project_id,
        page_offset=payload.page_offset,
        toc_start=payload.toc_start,
        toc_end=payload.toc_end,
        provider_id=payload.provider_id,
        provider_id_set=True,
    )

    job = generation_job_store.create_job(
        project_id=project_id,
        toc_start=payload.toc_start,
        toc_end=payload.toc_end,
        provider=_provider_snapshot(settings),
    )
    background_tasks.add_task(_run_generate_toc_job, job["id"], project_id, payload, settings)
    return {"job": job}


@router.post("/generation-jobs/batch")
def generate_toc_batch(payload: dict[str, Any], background_tasks: BackgroundTasks) -> dict[str, Any]:
    requests = payload.get("requests")
    if not isinstance(requests, list) or not requests:
        raise HTTPException(status_code=400, detail="Select at least one project")
    prepared: list[tuple[str, GeneratePayload, dict[str, Any]]] = []
    project_ids: set[str] = set()
    for item in requests:
        try:
            request = GeneratePayload.model_validate(item)
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Invalid generation request") from exc
        project_id = str(item.get("project_id") or "")
        if not project_id or project_id in project_ids:
            raise HTTPException(status_code=400, detail="Each project can be selected once")
        project_ids.add(project_id)
        prepared.append((project_id, request, _validate_generation(_project_or_404(project_id), request)))
    jobs = []
    for project_id, request, settings in prepared:
        store.update_project_metadata(
            project_id,
            page_offset=request.page_offset,
            toc_start=request.toc_start,
            toc_end=request.toc_end,
            provider_id=request.provider_id,
            provider_id_set=True,
        )
        job = generation_job_store.create_job(project_id, request.toc_start, request.toc_end, _provider_snapshot(settings))
        generation_executor.submit(_run_generate_toc_job, job["id"], project_id, request, settings)
        jobs.append(job)
    return {"jobs": jobs}


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


@router.post("/jobs/{job_id}/apply")
def apply_generation_job(job_id: str) -> FileResponse:
    try:
        job = generation_job_store.get_job(job_id)
        toc_file = (job.get("result") or {}).get("toc_file") or {}
        toc_file_id = str(toc_file["id"])
    except (KeyError, TypeError) as exc:
        raise HTTPException(status_code=404, detail="Generated TOC candidate not found") from exc
    project = _project_or_404(str(job["project_id"]))
    return apply_project_toc_file(str(job["project_id"]), toc_file_id, TocFileApplyPayload(page_offset=int(project.get("page_offset") or 0)))


@router.get("/jobs/{job_id}/download")
def download_generation_job(job_id: str) -> Response:
    try:
        job = generation_job_store.get_job(job_id)
        toc_file = (job.get("result") or {}).get("toc_file") or {}
        toc_text = store.read_toc_file(str(job["project_id"]), str(toc_file["id"]))
    except (KeyError, TypeError) as exc:
        raise HTTPException(status_code=404, detail="Generated TOC candidate not found") from exc
    project = _project_or_404(str(job["project_id"]))
    validation = store.validate_toc(str(job["project_id"]), toc_text, int(project.get("page_offset") or 0))
    if not validation.valid or validation.normalized_toc is None:
        raise HTTPException(status_code=400, detail="Generated TOC candidate is invalid")
    document_pdf = store.pdf_path(str(job["project_id"]))
    temporary_pdf = document_pdf.with_name(f".{document_pdf.stem}.{uuid4().hex}.pdf")
    try:
        apply_toc_to_pdf(document_pdf, temporary_pdf, validation.normalized_toc, int(project.get("page_offset") or 0))
        content = temporary_pdf.read_bytes()
    finally:
        temporary_pdf.unlink(missing_ok=True)
    return Response(content=content, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{project.get("pdf_filename") or "bookmarked.pdf"}'})


@router.get("/settings/llm")
def get_llm_settings() -> dict[str, Any]:
    return {"settings": store.public_llm_settings()}


@router.put("/settings/llm")
def save_llm_settings(payload: LlmSettingsPayload) -> dict[str, Any]:
    settings = store.save_llm_settings(payload.model_dump())
    public = store.public_llm_settings()
    public["has_api_key"] = bool(settings.get("api_key"))
    return {"settings": public}


@router.get("/settings/providers")
def get_llm_providers() -> dict[str, Any]:
    return {"providers": store.public_llm_providers()}


@router.put("/settings/providers")
def save_llm_providers(payload: ProvidersPayload) -> dict[str, Any]:
    try:
        providers = store.save_llm_providers([item.model_dump(exclude_none=True) for item in payload.providers])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"providers": [store._public_provider(item) for item in providers]}


@router.get("/settings/prompts")
def get_toc_prompts() -> dict[str, Any]:
    return {
        "prompt": store.read_toc_prompt(),
        "default": DEFAULT_FLAT_PROMPT,
    }


@router.put("/settings/prompts")
def save_toc_prompts(payload: PromptsPayload) -> dict[str, Any]:
    prompt = payload.prompt or ""
    if len(prompt) > MAX_PROMPT_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Prompt exceeds {MAX_PROMPT_LENGTH} characters",
        )
    saved = store.save_toc_prompt(prompt)
    return {
        "prompt": saved,
        "default": DEFAULT_FLAT_PROMPT,
    }


@router.post("/settings/providers/{provider_id}/test")
def test_llm_provider(provider_id: str) -> dict[str, Any]:
    try:
        provider = store.get_llm_provider(provider_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="VLM API not found") from exc
    if not str(provider.get("api_key") or ""):
        raise HTTPException(status_code=400, detail="Configure an API key before testing")
    try:
        pixmap = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 128, 64), False)
        pixmap.clear_with(0x21A366)
        image_url = f"data:image/png;base64,{base64.b64encode(pixmap.tobytes('png')).decode('ascii')}"
        response = request_toc_from_vlm([image_url], "Confirm that you can process the attached image. Reply with exactly VLM_OK.", str(provider["api_key"]), str(provider["base_url"]), str(provider["model"]))
        if "VLM_OK" not in response.upper():
            raise ValueError("The model did not return the expected visual test response")
    except Exception as exc:
        return {"provider": store.record_provider_verification(provider_id, "failed", str(exc))}
    return {"provider": store.record_provider_verification(provider_id, "verified", "Vision test passed")}
