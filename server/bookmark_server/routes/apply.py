from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from bookmark.core import apply_toc_to_pdf, load_toc_json_file

from ..services.jobs import JobWorkspace


router = APIRouter(tags=["apply"])


def _safe_output_name(filename: str | None) -> str:
    stem = Path(filename or "bookmarked").stem or "bookmarked"
    return f"{stem}_bookmarked.pdf"


async def _save_upload(upload: UploadFile, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as output:
        while chunk := await upload.read(1024 * 1024):
            output.write(chunk)


@router.post("/apply")
async def apply_bookmarks(
    background_tasks: BackgroundTasks,
    pdf: UploadFile = File(...),
    toc_json: UploadFile = File(...),
    page_offset: int = Form(...),
) -> FileResponse:
    if pdf.content_type not in {None, "application/pdf", "application/octet-stream"}:
        raise HTTPException(status_code=400, detail="Uploaded PDF must be a PDF file")

    job = JobWorkspace.create()
    input_pdf = job.path / "input.pdf"
    input_json = job.path / "toc.json"
    output_pdf = job.path / "output.pdf"

    try:
        await _save_upload(pdf, input_pdf)
        await _save_upload(toc_json, input_json)
        toc_data = load_toc_json_file(input_json)
        apply_toc_to_pdf(
            input_pdf=input_pdf,
            output_pdf=output_pdf,
            toc_data=toc_data,
            page_offset=page_offset,
        )
    except ValueError as exc:
        job.cleanup()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception:
        job.cleanup()
        raise

    background_tasks.add_task(job.cleanup)
    return FileResponse(
        output_pdf,
        media_type="application/pdf",
        filename=_safe_output_name(pdf.filename),
        background=background_tasks,
    )
