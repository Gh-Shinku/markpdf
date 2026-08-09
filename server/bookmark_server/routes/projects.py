from __future__ import annotations

import json
import base64
from concurrent.futures import ThreadPoolExecutor
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel, Field, field_validator
import fitz

from ..core import apply_toc_to_pdf, inject_toc_page_bookmark
from ..services.generation_jobs import generation_job_store
from ..services.projects import store, utc_now_iso
from ..services.toc_extraction import (
    DEFAULT_FLAT_PROMPT,
    build_chat_completion_options,
    extract_toc_json,
    render_pdf_page_image,
    request_chat_from_vlm,
    request_chat_from_vlm_stream,
    request_toc_from_vlm,
)


router = APIRouter(tags=["projects"])
generation_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="toc-generation")


MAX_PROMPT_LENGTH = 20000
PLAYGROUND_DPI = 220


class TocPayload(BaseModel):
    toc_json: str


class ProjectMetadataPayload(BaseModel):
    page_offset: int | None = None
    toc_start: int | None = None
    toc_end: int | None = None
    provider_id: str | None = None
    inject_toc_page: bool | None = None


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


class SamplingPayload(BaseModel):
    temperature: float | None = None
    top_p: float | None = None
    max_tokens: int | None = None
    presence_penalty: float | None = None
    frequency_penalty: float | None = None
    seed: int | None = None

    @field_validator("temperature")
    @classmethod
    def validate_temperature(cls, value: float | None) -> float | None:
        if value is not None and not 0 <= value <= 2:
            raise ValueError("temperature must be between 0 and 2")
        return value

    @field_validator("top_p")
    @classmethod
    def validate_top_p(cls, value: float | None) -> float | None:
        if value is not None and not 0 <= value <= 1:
            raise ValueError("top_p must be between 0 and 1")
        return value

    @field_validator("max_tokens")
    @classmethod
    def validate_max_tokens(cls, value: int | None) -> int | None:
        if value is not None and value < 1:
            raise ValueError("max_tokens must be >= 1")
        return value

    @field_validator("presence_penalty", "frequency_penalty")
    @classmethod
    def validate_penalty(cls, value: float | None) -> float | None:
        if value is not None and not -2 <= value <= 2:
            raise ValueError("penalties must be between -2 and 2")
        return value


class ProviderPayload(BaseModel):
    id: str | None = None
    name: str
    base_url: str
    model: str
    api_key: str | None = None
    sampling: SamplingPayload | None = None
    thinking_mode: str = "auto"
    extra_body: dict[str, Any] | None = None

    @field_validator("thinking_mode")
    @classmethod
    def validate_thinking_mode(cls, value: str) -> str:
        if value not in {"auto", "on", "off"}:
            raise ValueError("thinking_mode must be auto, on, or off")
        return value


class ProvidersPayload(BaseModel):
    providers: list[ProviderPayload]


class PromptsPayload(BaseModel):
    prompt: str | None = None


class TocFileApplyPayload(BaseModel):
    page_offset: int = 0


class PlaygroundAttachmentPayload(BaseModel):
    type: str
    project_id: str
    page: int
    dpi: int = PLAYGROUND_DPI
    sha256: str


class PlaygroundMessagePayload(BaseModel):
    id: str | None = None
    role: str
    content: str
    attachments: list[PlaygroundAttachmentPayload] = Field(default_factory=list)


class PlaygroundChatPayload(BaseModel):
    provider_id: str
    messages: list[PlaygroundMessagePayload]


class PlaygroundSessionMessagePayload(BaseModel):
    provider_id: str
    message: PlaygroundMessagePayload


class PlaygroundChatCreatePayload(BaseModel):
    provider_id: str | None = None


class PlaygroundChatRenamePayload(BaseModel):
    title: str


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


def _provider_completion_options(provider: dict[str, Any], *, stream: bool = False) -> tuple[dict[str, Any], list[str]]:
    return build_chat_completion_options(
        base_url=str(provider.get("base_url") or ""),
        model=str(provider.get("model") or ""),
        sampling=provider.get("sampling") if isinstance(provider.get("sampling"), dict) else None,
        thinking_mode=str(provider.get("thinking_mode") or "auto"),
        extra_body=provider.get("extra_body") if isinstance(provider.get("extra_body"), dict) else None,
        stream=stream,
    )


def _playground_chat_or_404(chat_id: str) -> dict[str, Any]:
    try:
        return store.get_playground_chat(chat_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Playground chat not found") from exc


def _render_project_page_or_http(project_id: str, page: int) -> dict[str, Any]:
    project = _project_or_404(project_id)
    try:
        rendered = render_pdf_page_image(store.pdf_path(project_id), page, PLAYGROUND_DPI)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "project_id": project["id"],
        "page": page,
        **rendered,
    }


def _playground_messages(payload: PlaygroundChatPayload) -> list[dict[str, Any]]:
    if not payload.messages:
        raise HTTPException(status_code=400, detail="At least one message is required")
    converted: list[dict[str, Any]] = []
    for message in payload.messages:
        if message.role not in {"user", "assistant", "system"}:
            raise HTTPException(status_code=400, detail="Unsupported playground message role")
        if message.role == "assistant":
            converted.append({"role": "assistant", "content": message.content})
            continue

        attachments = message.attachments if message.role == "user" else []
        if not attachments:
            converted.append({"role": message.role, "content": message.content})
            continue

        parts: list[dict[str, Any]] = [{"type": "text", "text": message.content}]
        for attachment in attachments:
            if attachment.type != "pdf_page":
                raise HTTPException(status_code=400, detail="Unsupported playground attachment type")
            if attachment.dpi != PLAYGROUND_DPI:
                raise HTTPException(status_code=400, detail=f"Playground PDF pages must use {PLAYGROUND_DPI} DPI")
            rendered = _render_project_page_or_http(attachment.project_id, attachment.page)
            if str(rendered["sha256"]) != attachment.sha256:
                raise HTTPException(status_code=409, detail="PDF page rendering changed; insert the page again")
            parts.append({"type": "image_url", "image_url": {"url": rendered["data_url"]}})
        converted.append({"role": message.role, "content": parts})
    return converted


def _playground_message_to_vlm(message: PlaygroundMessagePayload) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    if message.role != "user":
        raise HTTPException(status_code=400, detail="Playground chat sends must use a user message")

    rendered_attachments: list[dict[str, Any]] = []
    if not message.attachments:
        return {"role": "user", "content": message.content}, rendered_attachments

    parts: list[dict[str, Any]] = [{"type": "text", "text": message.content}]
    for attachment in message.attachments:
        if attachment.type != "pdf_page":
            raise HTTPException(status_code=400, detail="Unsupported playground attachment type")
        if attachment.dpi != PLAYGROUND_DPI:
            raise HTTPException(status_code=400, detail=f"Playground PDF pages must use {PLAYGROUND_DPI} DPI")
        rendered = _render_project_page_or_http(attachment.project_id, attachment.page)
        if str(rendered["sha256"]) != attachment.sha256:
            raise HTTPException(status_code=409, detail="PDF page rendering changed; insert the page again")
        parts.append({"type": "image_url", "image_url": {"url": rendered["data_url"]}})
        rendered_attachments.append(
            {
                "id": uuid4().hex,
                "type": "pdf_page",
                "project_id": attachment.project_id,
                "page": attachment.page,
                "dpi": attachment.dpi,
                "sha256": attachment.sha256,
                "name": f"page {attachment.page}",
                "data_url": rendered["data_url"],
            }
        )
    return {"role": "user", "content": parts}, rendered_attachments


def _stored_playground_message(
    *,
    role: str,
    content: str,
    message_id: str | None = None,
    attachments: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "id": message_id or uuid4().hex,
        "role": role,
        "content": content,
        "created_at": utc_now_iso(),
        "attachments": attachments or [],
    }


def _sse_event(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _playground_stream_chunk(chunk: Any) -> tuple[str, str]:
    if isinstance(chunk, str):
        return "content", chunk
    if isinstance(chunk, dict):
        kind = str(chunk.get("type") or "content")
        if kind not in {"content", "thinking"}:
            kind = "content"
        return kind, str(chunk.get("text") or "")
    return "content", str(chunk or "")


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
            sampling=settings.get("sampling") if isinstance(settings.get("sampling"), dict) else None,
            thinking_mode=str(settings.get("thinking_mode") or "auto"),
            extra_body=settings.get("extra_body") if isinstance(settings.get("extra_body"), dict) else None,
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
        try:
            # 自动应用生成的 TOC。结构/语法问题会使应用失败,
            # 此时任务标记失败并在任务列表中展示,便于人工兜底。
            apply_project_toc_file(
                project_id,
                str(toc_file["id"]),
                TocFileApplyPayload(page_offset=int(store.get_project(project_id).get("page_offset") or 0)),
            )
        except Exception as exc:
            generation_job_store.mark_failed(
                job_id,
                "TOC generated but applying failed",
                str(exc),
            )
            return
        generation_job_store.mark_succeeded(
            job_id,
            "TOC generated and applied",
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


@router.get("/projects/{project_id}/rendered-pages/{page}")
def get_project_rendered_page(project_id: str, page: int) -> dict[str, Any]:
    return _render_project_page_or_http(project_id, page)


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
        inject_toc_page=payload.inject_toc_page,
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


def _toc_with_injected_page(project: dict[str, Any], toc_data: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not project.get("inject_toc_page", True):
        return toc_data
    return inject_toc_page_bookmark(
        toc_data,
        toc_start=int(project.get("toc_start") or 1),
        page_count=int(project.get("page_count") or 0),
    )


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
    toc_data = _toc_with_injected_page(project, validation.normalized_toc)
    temporary_pdf = document_pdf.with_name(f".{document_pdf.stem}.{uuid4().hex}.pdf")
    try:
        apply_toc_to_pdf(
            input_pdf=document_pdf,
            output_pdf=temporary_pdf,
            toc_data=toc_data,
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


def _prepare_toc_for_apply(
    project_id: str,
    project: dict[str, Any],
    toc_text: str,
    page_offset: int,
) -> list[dict[str, Any]]:
    """Validate TOC text and return it with the ToC page bookmark injected."""
    validation = store.validate_toc(
        project_id=project_id,
        toc_text=toc_text,
        page_offset=page_offset,
    )
    if not validation.valid or validation.normalized_toc is None:
        detail = validation.issues[0].message if validation.issues else "Invalid TOC JSON"
        raise HTTPException(status_code=400, detail=detail)
    return _toc_with_injected_page(project, validation.normalized_toc)


@router.post("/projects/{project_id}/toc-files/{toc_file_id}/apply")
def apply_project_toc_file(project_id: str, toc_file_id: str, payload: TocFileApplyPayload) -> FileResponse:
    try:
        toc_text = store.read_toc_file(project_id, toc_file_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="TOC file not found") from exc
    project = _project_or_404(project_id)
    toc_data = _prepare_toc_for_apply(project_id, project, toc_text, payload.page_offset)
    # Persist the injected ToC page bookmark into the file being applied so the
    # stored TOC stays in sync with what was written into the PDF.
    store.save_toc_file(project_id, toc_file_id, json.dumps(toc_data, ensure_ascii=False, indent=2))
    return apply_project_toc(
        project_id,
        ApplyPayload(toc_json=json.dumps(toc_data, ensure_ascii=False, indent=2), page_offset=payload.page_offset),
    )


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
    toc_data = _prepare_toc_for_apply(
        str(job["project_id"]),
        project,
        toc_text,
        int(project.get("page_offset") or 0),
    )
    store.save_toc_file(
        str(job["project_id"]),
        str(toc_file["id"]),
        json.dumps(toc_data, ensure_ascii=False, indent=2),
    )
    document_pdf = store.pdf_path(str(job["project_id"]))
    temporary_pdf = document_pdf.with_name(f".{document_pdf.stem}.{uuid4().hex}.pdf")
    try:
        apply_toc_to_pdf(document_pdf, temporary_pdf, toc_data, int(project.get("page_offset") or 0))
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
        completion_options, _warnings = _provider_completion_options(provider)
        response = request_toc_from_vlm(
            [image_url],
            "Confirm that you can process the attached image. Reply with exactly VLM_OK.",
            str(provider["api_key"]),
            str(provider["base_url"]),
            str(provider["model"]),
            completion_options=completion_options,
        )
        if "VLM_OK" not in response.upper():
            raise ValueError("The model did not return the expected visual test response")
    except Exception as exc:
        return {"provider": store.record_provider_verification(provider_id, "failed", str(exc))}
    return {"provider": store.record_provider_verification(provider_id, "verified", "Vision test passed")}


@router.get("/playground/chats")
def list_playground_chats() -> dict[str, Any]:
    return store.list_playground_chats()


@router.post("/playground/chats")
def create_playground_chat(payload: PlaygroundChatCreatePayload | None = None) -> dict[str, Any]:
    chat = store.create_playground_chat(provider_id=payload.provider_id if payload else None)
    return {"chat": chat, **store.list_playground_chats()}


@router.get("/playground/chats/{chat_id}")
def get_playground_chat(chat_id: str) -> dict[str, Any]:
    chat = _playground_chat_or_404(chat_id)
    store.set_active_playground_chat(chat_id)
    return {"chat": chat}


@router.put("/playground/chats/{chat_id}/active")
def set_active_playground_chat(chat_id: str) -> dict[str, Any]:
    return store.set_active_playground_chat(chat_id)


@router.patch("/playground/chats/{chat_id}")
def rename_playground_chat(chat_id: str, payload: PlaygroundChatRenamePayload) -> dict[str, Any]:
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Playground chat title is required")
    try:
        chat = store.rename_playground_chat(chat_id, title[:120])
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Playground chat not found") from exc
    return {"chat": chat, **store.list_playground_chats()}


@router.delete("/playground/chats/{chat_id}")
def delete_playground_chat(chat_id: str) -> dict[str, Any]:
    try:
        return store.delete_playground_chat(chat_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Playground chat not found") from exc


@router.get("/playground/chats/{chat_id}/attachments/{attachment_filename}")
def get_playground_chat_attachment(chat_id: str, attachment_filename: str) -> FileResponse:
    try:
        path = store.playground_attachment_path(chat_id, attachment_filename)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Playground attachment not found") from exc
    return FileResponse(path, media_type="image/png")


@router.post("/playground/chats/{chat_id}/messages")
def send_playground_chat_message(chat_id: str, payload: PlaygroundSessionMessagePayload) -> dict[str, Any]:
    _playground_chat_or_404(chat_id)
    provider = _provider_or_400(payload.provider_id)
    vlm_message, rendered_attachments = _playground_message_to_vlm(payload.message)
    stored_attachments: list[dict[str, Any]] = []
    completion_options, warnings = _provider_completion_options(provider)
    try:
        content = request_chat_from_vlm(
            [vlm_message],
            api_key=str(provider["api_key"]),
            base_url=str(provider["base_url"]),
            model=str(provider["model"]),
            completion_options=completion_options,
        )
        for rendered_attachment in rendered_attachments:
            attachment_url = store.save_playground_attachment(
                chat_id,
                str(rendered_attachment["id"]),
                str(rendered_attachment["data_url"]),
            )
            stored = {key: value for key, value in rendered_attachment.items() if key != "data_url"}
            stored["url"] = attachment_url
            stored["data_url"] = attachment_url
            stored_attachments.append(stored)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    user_message = _stored_playground_message(
        role="user",
        content=payload.message.content,
        message_id=payload.message.id,
        attachments=stored_attachments,
    )
    assistant_message = _stored_playground_message(role="assistant", content=content)
    chat = store.append_playground_exchange(chat_id, str(provider["id"]), user_message, assistant_message)
    return {"chat": chat, "message": assistant_message, "warnings": warnings, **store.list_playground_chats()}


@router.post("/playground/chats/{chat_id}/messages/stream")
def stream_playground_chat_message(chat_id: str, payload: PlaygroundSessionMessagePayload) -> StreamingResponse:
    _playground_chat_or_404(chat_id)
    provider = _provider_or_400(payload.provider_id)
    vlm_message, rendered_attachments = _playground_message_to_vlm(payload.message)
    completion_options, warnings = _provider_completion_options(provider, stream=True)
    show_thinking = str(provider.get("thinking_mode") or "auto").strip().lower() != "off"

    def stream_events():
        content_chunks: list[str] = []
        try:
            for warning in warnings:
                yield _sse_event("warning", {"detail": warning})
            for chunk in request_chat_from_vlm_stream(
                [vlm_message],
                api_key=str(provider["api_key"]),
                base_url=str(provider["base_url"]),
                model=str(provider["model"]),
                completion_options=completion_options,
            ):
                kind, text = _playground_stream_chunk(chunk)
                if not text:
                    continue
                if kind == "thinking":
                    if show_thinking:
                        yield _sse_event("thinking", {"text": text})
                    continue
                content_chunks.append(text)
                yield _sse_event("delta", {"text": text})

            stored_attachments: list[dict[str, Any]] = []
            for rendered_attachment in rendered_attachments:
                attachment_url = store.save_playground_attachment(
                    chat_id,
                    str(rendered_attachment["id"]),
                    str(rendered_attachment["data_url"]),
                )
                stored = {key: value for key, value in rendered_attachment.items() if key != "data_url"}
                stored["url"] = attachment_url
                stored["data_url"] = attachment_url
                stored_attachments.append(stored)

            user_message = _stored_playground_message(
                role="user",
                content=payload.message.content,
                message_id=payload.message.id,
                attachments=stored_attachments,
            )
            assistant_message = _stored_playground_message(role="assistant", content="".join(content_chunks))
            chat = store.append_playground_exchange(chat_id, str(provider["id"]), user_message, assistant_message)
            yield _sse_event("final", {"chat": chat, "message": assistant_message, "warnings": warnings, **store.list_playground_chats()})
        except Exception as exc:
            yield _sse_event("error", {"detail": str(exc)})

    return StreamingResponse(stream_events(), media_type="text/event-stream")


@router.post("/playground/chat")
def run_playground_chat(payload: PlaygroundChatPayload) -> dict[str, Any]:
    provider = _provider_or_400(payload.provider_id)
    completion_options, warnings = _provider_completion_options(provider)
    try:
        content = request_chat_from_vlm(
            _playground_messages(payload),
            api_key=str(provider["api_key"]),
            base_url=str(provider["base_url"]),
            model=str(provider["model"]),
            completion_options=completion_options,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"message": {"role": "assistant", "content": content}, "warnings": warnings}
