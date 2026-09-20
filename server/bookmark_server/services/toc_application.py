from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import uuid4

from ..core import apply_toc_to_pdf, inject_toc_page_bookmark
from . import runtime
from .project_queries import get_project


class TocFileNotFoundError(KeyError):
    pass


class TocValidationError(ValueError):
    pass


class TocApplyError(RuntimeError):
    pass


@dataclass(frozen=True)
class AppliedPdf:
    path: Path
    filename: str


def toc_with_injected_page(project: dict[str, Any], toc_data: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not project.get("inject_toc_page", False):
        return toc_data
    return inject_toc_page_bookmark(
        toc_data,
        toc_start=int(project.get("toc_start") or 1),
        page_count=int(project.get("page_count") or 0),
    )


def prepare_toc_for_apply(
    project_id: str,
    project: dict[str, Any],
    toc_text: str,
    page_offset: int,
    *,
    record_validation: bool = False,
) -> list[dict[str, Any]]:
    validation = runtime.store.validate_toc(
        project_id=project_id,
        toc_text=toc_text,
        page_offset=page_offset,
    )
    if record_validation:
        runtime.store.record_validation(project_id, validation, page_offset)
    if not validation.valid or validation.normalized_toc is None:
        detail = validation.issues[0].message if validation.issues else "Invalid TOC JSON"
        raise TocValidationError(detail)
    return toc_with_injected_page(project, validation.normalized_toc)


def apply_toc_text_to_project(
    project_id: str,
    toc_text: str,
    page_offset: int,
    *,
    project: dict[str, Any] | None = None,
    record_validation: bool = True,
) -> AppliedPdf:
    project = project or get_project(project_id)
    toc_data = prepare_toc_for_apply(
        project_id,
        project,
        toc_text,
        page_offset,
        record_validation=record_validation,
    )
    return apply_toc_data_to_project(project_id, project, toc_data, page_offset)


def apply_toc_data_to_project(
    project_id: str,
    project: dict[str, Any],
    toc_data: list[dict[str, Any]],
    page_offset: int,
) -> AppliedPdf:
    document_pdf = runtime.store.pdf_path(project_id)
    temporary_pdf = document_pdf.with_name(f".{document_pdf.stem}.{uuid4().hex}.pdf")
    try:
        apply_toc_to_pdf(
            input_pdf=document_pdf,
            output_pdf=temporary_pdf,
            toc_data=toc_data,
            page_offset=page_offset,
        )
        temporary_pdf.replace(document_pdf)
    except Exception as exc:
        temporary_pdf.unlink(missing_ok=True)
        raise TocApplyError("Failed to apply TOC to PDF") from exc

    return AppliedPdf(
        path=document_pdf,
        filename=str(project.get("pdf_filename") or "source.pdf"),
    )


def apply_toc_file_to_project(project_id: str, toc_file_id: str, page_offset: int) -> AppliedPdf:
    try:
        toc_text = runtime.store.read_toc_file(project_id, toc_file_id)
    except KeyError as exc:
        raise TocFileNotFoundError(toc_file_id) from exc
    project = get_project(project_id)
    toc_data = prepare_toc_for_apply(project_id, project, toc_text, page_offset)
    toc_text_with_injected_page = json.dumps(toc_data, ensure_ascii=False, indent=2)
    runtime.store.save_toc_file(project_id, toc_file_id, toc_text_with_injected_page)
    return apply_toc_text_to_project(
        project_id,
        toc_text_with_injected_page,
        page_offset,
        project=project,
        record_validation=True,
    )


def build_applied_pdf_bytes(project_id: str, toc_text: str, page_offset: int) -> tuple[bytes, str]:
    project = get_project(project_id)
    toc_data = prepare_toc_for_apply(project_id, project, toc_text, page_offset)
    document_pdf = runtime.store.pdf_path(project_id)
    temporary_pdf = document_pdf.with_name(f".{document_pdf.stem}.{uuid4().hex}.pdf")
    try:
        apply_toc_to_pdf(document_pdf, temporary_pdf, toc_data, page_offset)
        return temporary_pdf.read_bytes(), str(project.get("pdf_filename") or "bookmarked.pdf")
    finally:
        temporary_pdf.unlink(missing_ok=True)
