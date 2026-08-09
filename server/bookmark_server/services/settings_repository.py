from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from uuid import uuid4

from .projects_common import utc_now_iso
from .storage import read_json_object, safe_id, write_json_atomic
from .toc_prompts import DEFAULT_FLAT_PROMPT


class SettingsRepository:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.settings_file = root / "settings.json"

    def read_llm_settings(self) -> dict[str, Any]:
        providers = self.read_llm_providers()
        return providers[0] if providers else {"base_url": "", "model": "", "api_key": ""}

    def read_llm_providers(self) -> list[dict[str, Any]]:
        if not self.settings_file.exists():
            return [self.provider_record("default", "Qwen VL", "https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen3-vl-flash", "")]
        raw = read_json_object(self.settings_file)
        if isinstance(raw.get("providers"), list):
            return [self.normalize_provider(item, index) for index, item in enumerate(raw["providers"]) if isinstance(item, dict)]
        return [self.provider_record("default", str(raw.get("model") or "Default VLM"), str(raw.get("base_url") or ""), str(raw.get("model") or ""), str(raw.get("api_key") or ""))]

    def read_settings(self) -> dict[str, Any]:
        if not self.settings_file.exists():
            return {}
        try:
            return read_json_object(self.settings_file)
        except (OSError, json.JSONDecodeError, ValueError):
            return {}

    def write_settings(self, raw: dict[str, Any]) -> None:
        write_json_atomic(self.settings_file, raw)

    def save_llm_providers(self, providers: list[dict[str, Any]]) -> list[dict[str, Any]]:
        existing = {str(item["id"]): item for item in self.read_llm_providers()}
        normalized: list[dict[str, Any]] = []
        seen: set[str] = set()
        for index, item in enumerate(providers):
            provider_id = str(item.get("id") or uuid4().hex)
            safe_id(provider_id, "provider_id")
            if provider_id in seen:
                raise ValueError("Provider IDs must be unique")
            seen.add(provider_id)
            previous = existing.get(provider_id)
            api_key_value = item.get("api_key")
            api_key = str(previous.get("api_key") or "") if api_key_value in {None, ""} and previous else str(api_key_value or "")
            provider = self.provider_record(
                provider_id,
                str(item.get("name") or item.get("model") or f"VLM API {index + 1}").strip(),
                str(item.get("base_url") or "").strip(),
                str(item.get("model") or "").strip(),
                api_key,
                sampling=item.get("sampling") if isinstance(item.get("sampling"), dict) else None,
                thinking_mode=str(item.get("thinking_mode") or "auto"),
                extra_body=item.get("extra_body") if isinstance(item.get("extra_body"), dict) else None,
            )
            if previous and self.provider_connection(previous) == self.provider_connection(provider):
                provider.update({key: previous.get(key) for key in ("verification_status", "verification_message", "verified_at")})
            normalized.append(provider)
        raw = self.read_settings()
        raw["providers"] = normalized
        self.write_settings(raw)
        return normalized

    def save_llm_settings(self, settings: dict[str, Any]) -> dict[str, Any]:
        provider = self.read_llm_providers()[0]
        provider.update(settings)
        return self.save_llm_providers([provider])[0]

    def public_llm_settings(self) -> dict[str, Any]:
        settings = self.read_llm_settings()
        api_key = str(settings.get("api_key") or "")
        return {
            "base_url": settings.get("base_url") or "",
            "model": settings.get("model") or "",
            "has_api_key": bool(api_key),
            "api_key_hint": self.api_key_hint(api_key),
        }

    def public_llm_providers(self) -> list[dict[str, Any]]:
        return [self.public_provider(item) for item in self.read_llm_providers()]

    def public_provider(self, provider: dict[str, Any]) -> dict[str, Any]:
        public = {key: value for key, value in provider.items() if key != "api_key"}
        api_key = str(provider.get("api_key") or "")
        public.update({"has_api_key": bool(api_key), "api_key_hint": self.api_key_hint(api_key)})
        return public

    def get_llm_provider(self, provider_id: str) -> dict[str, Any]:
        safe_provider_id = safe_id(provider_id, "provider_id")
        provider = next((item for item in self.read_llm_providers() if item["id"] == safe_provider_id), None)
        if provider is None:
            raise KeyError(provider_id)
        return provider

    def read_toc_prompt(self) -> str:
        settings = self.read_settings()
        value = settings.get("prompt")
        if not isinstance(value, str) or not value.strip():
            legacy = settings.get("prompts")
            if isinstance(legacy, dict):
                value = legacy.get("flat")
        if not isinstance(value, str) or not value.strip():
            return DEFAULT_FLAT_PROMPT
        return value

    def save_toc_prompt(self, prompt: str) -> str:
        raw = self.read_settings()
        raw["prompt"] = prompt.strip()
        raw.pop("prompts", None)
        self.write_settings(raw)
        return self.read_toc_prompt()

    def record_provider_verification(self, provider_id: str, status: str, message: str) -> dict[str, Any]:
        safe_provider_id = safe_id(provider_id, "provider_id")
        providers = self.read_llm_providers()
        provider = next((item for item in providers if item["id"] == safe_provider_id), None)
        if provider is None:
            raise KeyError(provider_id)
        provider["verification_status"] = status
        provider["verification_message"] = message
        provider["verified_at"] = utc_now_iso()
        raw = self.read_settings()
        raw["providers"] = providers
        self.write_settings(raw)
        return self.public_provider(provider)

    def provider_record(
        self,
        provider_id: str,
        name: str,
        base_url: str,
        model: str,
        api_key: str,
        sampling: dict[str, Any] | None = None,
        thinking_mode: str | None = None,
        extra_body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return {
            "id": provider_id,
            "name": name,
            "base_url": base_url,
            "model": model,
            "api_key": api_key,
            "sampling": self.normalize_provider_sampling(sampling),
            "thinking_mode": thinking_mode if thinking_mode in {"auto", "on", "off"} else "auto",
            "extra_body": extra_body if isinstance(extra_body, dict) and extra_body else None,
            "verification_status": "unverified",
            "verification_message": "Not tested",
            "verified_at": None,
        }

    def normalize_provider(self, item: dict[str, Any], index: int) -> dict[str, Any]:
        provider = self.provider_record(
            str(item.get("id") or uuid4().hex),
            str(item.get("name") or item.get("model") or f"VLM API {index + 1}"),
            str(item.get("base_url") or ""),
            str(item.get("model") or ""),
            str(item.get("api_key") or ""),
            sampling=item.get("sampling") if isinstance(item.get("sampling"), dict) else None,
            thinking_mode=str(item.get("thinking_mode") or "auto"),
            extra_body=item.get("extra_body") if isinstance(item.get("extra_body"), dict) else None,
        )
        provider.update({key: item.get(key) for key in ("verification_status", "verification_message", "verified_at") if key in item})
        return provider

    def provider_connection(self, provider: dict[str, Any]) -> tuple[str, str, str]:
        return (
            str(provider.get("base_url") or ""),
            str(provider.get("model") or ""),
            str(provider.get("api_key") or ""),
        )

    def normalize_provider_sampling(self, sampling: dict[str, Any] | None) -> dict[str, Any]:
        source = sampling if isinstance(sampling, dict) else {"temperature": 0}
        normalized: dict[str, Any] = {}
        for key in ("temperature", "top_p", "max_tokens", "presence_penalty", "frequency_penalty", "seed"):
            value = source.get(key)
            if value is not None:
                try:
                    normalized[key] = int(value) if key in {"max_tokens", "seed"} else float(value)
                except (TypeError, ValueError):
                    continue
        if not normalized:
            normalized["temperature"] = 0
        return normalized

    def api_key_hint(self, api_key: str) -> str:
        if not api_key:
            return ""
        if len(api_key) <= 8:
            return "configured"
        return f"{api_key[:4]}...{api_key[-4:]}"
