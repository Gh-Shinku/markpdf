from __future__ import annotations

import base64
from typing import Any

import fitz
from fastapi import APIRouter, HTTPException

from ..schemas.settings import LlmSettingsPayload, PromptsPayload, ProvidersPayload
from ..services import runtime
from ..services.toc_extraction import DEFAULT_FLAT_PROMPT, request_toc_from_vlm
from ..services.provider_config import provider_completion_options


router = APIRouter(tags=["settings"])
MAX_PROMPT_LENGTH = 20000


@router.get("/settings/llm")
def get_llm_settings() -> dict[str, Any]:
    return {"settings": runtime.store.public_llm_settings()}


@router.put("/settings/llm")
def save_llm_settings(payload: LlmSettingsPayload) -> dict[str, Any]:
    settings = runtime.store.save_llm_settings(payload.model_dump())
    public = runtime.store.public_llm_settings()
    public["has_api_key"] = bool(settings.get("api_key"))
    return {"settings": public}


@router.get("/settings/providers")
def get_llm_providers() -> dict[str, Any]:
    return {"providers": runtime.store.public_llm_providers()}


@router.put("/settings/providers")
def save_llm_providers(payload: ProvidersPayload) -> dict[str, Any]:
    try:
        providers = runtime.store.save_llm_providers([item.model_dump(exclude_none=True) for item in payload.providers])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"providers": [runtime.store._public_provider(item) for item in providers]}


@router.get("/settings/prompts")
def get_toc_prompts() -> dict[str, Any]:
    return {
        "prompt": runtime.store.read_toc_prompt(),
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
    saved = runtime.store.save_toc_prompt(prompt)
    return {
        "prompt": saved,
        "default": DEFAULT_FLAT_PROMPT,
    }


@router.post("/settings/providers/{provider_id}/test")
def test_llm_provider(provider_id: str) -> dict[str, Any]:
    try:
        provider = runtime.store.get_llm_provider(provider_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="VLM API not found") from exc
    if not str(provider.get("api_key") or ""):
        raise HTTPException(status_code=400, detail="Configure an API key before testing")
    try:
        pixmap = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 128, 64), False)
        pixmap.clear_with(0x21A366)
        image_url = f"data:image/png;base64,{base64.b64encode(pixmap.tobytes('png')).decode('ascii')}"
        completion_options, _warnings = provider_completion_options(provider)
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
        return {"provider": runtime.store.record_provider_verification(provider_id, "failed", str(exc))}
    return {"provider": runtime.store.record_provider_verification(provider_id, "verified", "Vision test passed")}
