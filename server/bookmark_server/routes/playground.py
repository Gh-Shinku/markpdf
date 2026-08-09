from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse

from ..schemas.playground import (
    PlaygroundChatCreatePayload,
    PlaygroundChatPayload,
    PlaygroundChatRenamePayload,
    PlaygroundChatSettingsPayload,
    PlaygroundSessionMessagePayload,
)
from ..services import playground_chat, runtime
from ..services.project_queries import ProjectNotFoundError
from ..services.provider_config import ProviderConfigError, get_verified_provider
from ..services.playground_chat import PlaygroundChatNotFoundError


router = APIRouter(tags=["playground"])


def _provider_or_http(provider_id: str) -> dict[str, Any]:
    try:
        return get_verified_provider(provider_id)
    except ProviderConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _playground_service_error(exc: Exception) -> HTTPException:
    if isinstance(exc, PlaygroundChatNotFoundError):
        return HTTPException(status_code=404, detail="Playground chat not found")
    if isinstance(exc, ProjectNotFoundError):
        return HTTPException(status_code=404, detail="Project not found")
    if isinstance(exc, ProviderConfigError):
        return HTTPException(status_code=400, detail=str(exc))
    if isinstance(exc, RuntimeError) and "rendering changed" in str(exc):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, ValueError):
        return HTTPException(status_code=400, detail=str(exc))
    return HTTPException(status_code=502, detail=str(exc))


@router.get("/playground/chats")
def list_playground_chats() -> dict[str, Any]:
    return runtime.store.list_playground_chats()


@router.post("/playground/chats")
def create_playground_chat(payload: PlaygroundChatCreatePayload | None = None) -> dict[str, Any]:
    provider_id = payload.provider_id if payload else None
    if provider_id is not None:
        _provider_or_http(provider_id)
    chat = runtime.store.create_playground_chat(
        provider_id=provider_id,
        thinking_mode=payload.thinking_mode if payload else "auto",
    )
    return {"chat": chat, **runtime.store.list_playground_chats()}


@router.get("/playground/chats/{chat_id}")
def get_playground_chat(chat_id: str) -> dict[str, Any]:
    try:
        chat = playground_chat.get_playground_chat(chat_id)
    except PlaygroundChatNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Playground chat not found") from exc
    runtime.store.set_active_playground_chat(chat_id)
    return {"chat": chat}


@router.put("/playground/chats/{chat_id}/active")
def set_active_playground_chat(chat_id: str) -> dict[str, Any]:
    try:
        return runtime.store.set_active_playground_chat(chat_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Playground chat not found") from exc


@router.patch("/playground/chats/{chat_id}")
def rename_playground_chat(chat_id: str, payload: PlaygroundChatRenamePayload) -> dict[str, Any]:
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Playground chat title is required")
    try:
        chat = runtime.store.rename_playground_chat(chat_id, title[:120])
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Playground chat not found") from exc
    return {"chat": chat, **runtime.store.list_playground_chats()}


@router.put("/playground/chats/{chat_id}/settings")
def update_playground_chat_settings(chat_id: str, payload: PlaygroundChatSettingsPayload) -> dict[str, Any]:
    _provider_or_http(payload.provider_id)
    try:
        chat = runtime.store.update_playground_chat_settings(
            chat_id,
            provider_id=payload.provider_id,
            thinking_mode=payload.thinking_mode,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Playground chat not found") from exc
    return {"chat": chat, **runtime.store.list_playground_chats()}


@router.delete("/playground/chats/{chat_id}")
def delete_playground_chat(chat_id: str) -> dict[str, Any]:
    try:
        return runtime.store.delete_playground_chat(chat_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Playground chat not found") from exc


@router.get("/playground/chats/{chat_id}/attachments/{attachment_filename}")
def get_playground_chat_attachment(chat_id: str, attachment_filename: str) -> FileResponse:
    try:
        path = runtime.store.playground_attachment_path(chat_id, attachment_filename)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Playground attachment not found") from exc
    return FileResponse(path, media_type="image/png")


@router.post("/playground/chats/{chat_id}/messages")
def send_playground_chat_message(chat_id: str, payload: PlaygroundSessionMessagePayload) -> dict[str, Any]:
    try:
        return playground_chat.send_playground_chat_message(chat_id, payload)
    except Exception as exc:
        raise _playground_service_error(exc) from exc


@router.post("/playground/chats/{chat_id}/messages/stream")
def stream_playground_chat_message(chat_id: str, payload: PlaygroundSessionMessagePayload) -> StreamingResponse:
    try:
        playground_chat.get_playground_chat(chat_id)
        _provider_or_http(payload.provider_id)
    except Exception as exc:
        raise _playground_service_error(exc) from exc
    return StreamingResponse(
        playground_chat.stream_playground_chat_message(chat_id, payload),
        media_type="text/event-stream",
    )


@router.post("/playground/chat")
def run_playground_chat(payload: PlaygroundChatPayload) -> dict[str, Any]:
    try:
        return playground_chat.run_playground_chat(payload)
    except Exception as exc:
        raise _playground_service_error(exc) from exc
