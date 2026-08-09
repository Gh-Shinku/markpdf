from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


PLAYGROUND_DPI = 220


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
    thinking_mode: str = "auto"
    message: PlaygroundMessagePayload

    @field_validator("thinking_mode")
    @classmethod
    def validate_thinking_mode(cls, value: str) -> str:
        if value not in {"auto", "on", "off"}:
            raise ValueError("thinking_mode must be auto, on, or off")
        return value


class PlaygroundChatCreatePayload(BaseModel):
    provider_id: str | None = None
    thinking_mode: str = "auto"

    @field_validator("thinking_mode")
    @classmethod
    def validate_thinking_mode(cls, value: str) -> str:
        if value not in {"auto", "on", "off"}:
            raise ValueError("thinking_mode must be auto, on, or off")
        return value


class PlaygroundChatRenamePayload(BaseModel):
    title: str


class PlaygroundChatSettingsPayload(BaseModel):
    provider_id: str
    thinking_mode: str = "auto"

    @field_validator("thinking_mode")
    @classmethod
    def validate_thinking_mode(cls, value: str) -> str:
        if value not in {"auto", "on", "off"}:
            raise ValueError("thinking_mode must be auto, on, or off")
        return value
