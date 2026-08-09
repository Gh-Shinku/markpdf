from __future__ import annotations

from pydantic import BaseModel


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


class TocFileApplyPayload(BaseModel):
    page_offset: int = 0
