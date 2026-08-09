from __future__ import annotations

from typing import Any

from pydantic import BaseModel, field_validator


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
