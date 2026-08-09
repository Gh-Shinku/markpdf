from __future__ import annotations

import json
from typing import Any

from . import runtime
from .project_queries import get_project
from .provider_config import get_verified_provider, provider_snapshot
from .toc_application import apply_toc_file_to_project
from .toc_extraction import extract_toc_json


class GenerationValidationError(ValueError):
    pass


class ActiveGenerationJobError(RuntimeError):
    pass


def validate_generation(project: dict[str, Any], toc_start: int, toc_end: int, provider_id: str) -> dict[str, Any]:
    if toc_start < 1 or toc_end < 1:
        raise GenerationValidationError("TOC page range must be one-based and >= 1")
    if toc_start > toc_end:
        raise GenerationValidationError("TOC start page must be <= TOC end page")
    if toc_end > int(project.get("page_count") or 0):
        raise GenerationValidationError("TOC end page exceeds PDF page count")
    if runtime.generation_job_store.find_active_job(str(project["id"])) is not None:
        raise ActiveGenerationJobError("TOC generation is already running for this project")
    return get_verified_provider(provider_id)


def create_generation_job(
    project_id: str,
    toc_start: int,
    toc_end: int,
    provider_id: str,
    page_offset: int | None,
    *,
    background_tasks: Any | None = None,
) -> dict[str, Any]:
    project = get_project(project_id)
    settings = validate_generation(project, toc_start, toc_end, provider_id)
    runtime.store.update_project_metadata(
        project_id,
        page_offset=page_offset,
        toc_start=toc_start,
        toc_end=toc_end,
        provider_id=provider_id,
        provider_id_set=True,
    )
    job = runtime.generation_job_store.create_job(
        project_id=project_id,
        toc_start=toc_start,
        toc_end=toc_end,
        provider=provider_snapshot(settings),
    )
    args = (job["id"], project_id, toc_start, toc_end, settings)
    if background_tasks is not None:
        background_tasks.add_task(run_generate_toc_job, *args)
    else:
        runtime.generation_executor.submit(run_generate_toc_job, *args)
    return job


def create_batch_generation_jobs(requests: list[dict[str, Any]]) -> list[dict[str, Any]]:
    prepared: list[tuple[str, int, int, str, int | None, dict[str, Any]]] = []
    project_ids: set[str] = set()
    for item in requests:
        project_id = str(item.get("project_id") or "")
        toc_start = int(item["toc_start"])
        toc_end = int(item["toc_end"])
        provider_id = str(item["provider_id"])
        page_offset = item.get("page_offset")
        if not project_id or project_id in project_ids:
            raise GenerationValidationError("Each project can be selected once")
        project_ids.add(project_id)
        settings = validate_generation(get_project(project_id), toc_start, toc_end, provider_id)
        prepared.append((project_id, toc_start, toc_end, provider_id, page_offset, settings))

    jobs: list[dict[str, Any]] = []
    for project_id, toc_start, toc_end, provider_id, page_offset, settings in prepared:
        runtime.store.update_project_metadata(
            project_id,
            page_offset=page_offset,
            toc_start=toc_start,
            toc_end=toc_end,
            provider_id=provider_id,
            provider_id_set=True,
        )
        job = runtime.generation_job_store.create_job(project_id, toc_start, toc_end, provider_snapshot(settings))
        runtime.generation_executor.submit(run_generate_toc_job, job["id"], project_id, toc_start, toc_end, settings)
        jobs.append(job)
    return jobs


def run_generate_toc_job(
    job_id: str,
    project_id: str,
    toc_start: int,
    toc_end: int,
    settings: dict[str, Any],
) -> None:
    total_pages = toc_end - toc_start + 1
    runtime.generation_job_store.mark_running(job_id, "Preparing TOC generation")

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

        runtime.generation_job_store.update_progress(
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
            input_pdf=runtime.store.pdf_path(project_id),
            toc_start=toc_start - 1,
            toc_end=toc_end - 1,
            api_key=str(settings.get("api_key") or ""),
            base_url=str(settings.get("base_url") or ""),
            model=str(settings.get("model") or ""),
            dpi=220,
            cache_dir=runtime.store.cache_dir(),
            overwrite_cache=False,
            prompt=runtime.store.read_toc_prompt(),
            sampling=settings.get("sampling") if isinstance(settings.get("sampling"), dict) else None,
            thinking_mode=str(settings.get("thinking_mode") or "auto"),
            extra_body=settings.get("extra_body") if isinstance(settings.get("extra_body"), dict) else None,
            on_flat_page_event=record_page_progress,
        )
        runtime.generation_job_store.update_progress(
            job_id,
            phase="saving",
            message="Saving generated TOC JSON",
            current_page=total_pages,
            completed_pages=total_pages,
            total_pages=total_pages,
        )
        toc_text = json.dumps(toc_data, ensure_ascii=False, indent=2)
        toc_file = runtime.store.create_generated_toc_file(project_id, job_id, toc_text, provider_snapshot(settings))
        try:
            apply_toc_file_to_project(
                project_id,
                str(toc_file["id"]),
                int(runtime.store.get_project(project_id).get("page_offset") or 0),
            )
        except Exception as exc:
            runtime.generation_job_store.mark_failed(
                job_id,
                "TOC generated but applying failed",
                str(exc),
            )
            return
        runtime.generation_job_store.mark_succeeded(
            job_id,
            "TOC generated and applied",
            {
                "project": runtime.store.get_project(project_id),
                "toc_file": toc_file,
                "stats": stats,
            },
        )
    except Exception as exc:
        runtime.generation_job_store.mark_failed(
            job_id,
            "TOC generation failed",
            str(exc),
        )
