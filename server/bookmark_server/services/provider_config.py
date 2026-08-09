from __future__ import annotations

from typing import Any

from . import runtime
from .toc_extraction import build_chat_completion_options


class ProviderConfigError(ValueError):
    pass


def get_verified_provider(provider_id: str) -> dict[str, Any]:
    try:
        provider = runtime.store.get_llm_provider(provider_id)
    except KeyError as exc:
        raise ProviderConfigError("Selected VLM API was not found") from exc
    if provider.get("verification_status") != "verified":
        raise ProviderConfigError("Selected VLM API has not passed the vision test")
    if not str(provider.get("api_key") or ""):
        raise ProviderConfigError("Selected VLM API does not have an API key")
    return provider


def provider_snapshot(provider: dict[str, Any]) -> dict[str, str]:
    return {key: str(provider.get(key) or "") for key in ("id", "name", "base_url", "model")}


def provider_completion_options(
    provider: dict[str, Any],
    *,
    stream: bool = False,
    thinking_mode: str | None = None,
) -> tuple[dict[str, Any], list[str]]:
    return build_chat_completion_options(
        base_url=str(provider.get("base_url") or ""),
        model=str(provider.get("model") or ""),
        sampling=provider.get("sampling") if isinstance(provider.get("sampling"), dict) else None,
        thinking_mode=thinking_mode or str(provider.get("thinking_mode") or "auto"),
        extra_body=provider.get("extra_body") if isinstance(provider.get("extra_body"), dict) else None,
        stream=stream,
    )
