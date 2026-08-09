from __future__ import annotations

from pydantic import BaseModel


class GeneratePayload(BaseModel):
    toc_start: int
    toc_end: int
    provider_id: str
    page_offset: int | None = None
