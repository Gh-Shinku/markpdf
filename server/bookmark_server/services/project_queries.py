from __future__ import annotations

from typing import Any

from . import runtime
from .pdf_rendering import render_pdf_page_image


class ProjectNotFoundError(KeyError):
    pass


def get_project(project_id: str) -> dict[str, Any]:
    try:
        return runtime.store.get_project(project_id)
    except KeyError as exc:
        raise ProjectNotFoundError(project_id) from exc


def render_project_page(project_id: str, page: int, dpi: int) -> dict[str, Any]:
    project = get_project(project_id)
    rendered = render_pdf_page_image(runtime.store.pdf_path(project_id), page, dpi)
    return {
        "project_id": project["id"],
        "page": page,
        **rendered,
    }
