from __future__ import annotations

import json
import os
import shutil
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import fitz

from ..core import flatten_to_pymupdf_toc, parse_toc_items, validate_toc_json_structure
from .toc_extraction import DEFAULT_FLAT_PROMPT


DEFAULT_TOC = [
    {
        "title": "Contents",
        "page": 1,
        "attribute": "absolute",
        "children": [],
    }
]

DOCUMENT_FILENAME = "document.pdf"
LEGACY_SOURCE_FILENAME = "source.pdf"
LEGACY_OUTPUT_FILENAME = "output.pdf"


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


def default_data_dir() -> Path:
    return Path(os.getenv("BOOKMARK_WORKSPACE_DATA", "workspace_data"))


@dataclass(frozen=True)
class ValidationIssue:
    message: str


@dataclass(frozen=True)
class ValidationResult:
    valid: bool
    issues: list[ValidationIssue]
    normalized_toc: list[dict[str, Any]] | None = None
    bookmark_count: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "valid": self.valid,
            "issues": [{"message": issue.message} for issue in self.issues],
            "normalized_toc": self.normalized_toc,
            "bookmark_count": self.bookmark_count,
        }


class ProjectStore:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or default_data_dir()
        self.projects_dir = self.root / "projects"
        self.settings_file = self.root / "settings.json"

    def ensure_root(self) -> None:
        self.projects_dir.mkdir(parents=True, exist_ok=True)

    def list_projects(self) -> list[dict[str, Any]]:
        self.ensure_root()
        projects: list[dict[str, Any]] = []
        for metadata_file in self.projects_dir.glob("*/project.json"):
            try:
                projects.append(self._normalize_metadata(json.loads(metadata_file.read_text(encoding="utf-8"))))
            except (OSError, json.JSONDecodeError):
                continue
        return sorted(projects, key=lambda item: item.get("updated_at", ""), reverse=True)

    def create_project(
        self,
        pdf_filename: str,
        pdf_bytes: bytes,
        toc_bytes: bytes | None = None,
        toc_filename: str | None = None,
        page_offset: int = 0,
    ) -> dict[str, Any]:
        self.ensure_root()
        project_id = uuid4().hex
        project_dir = self.projects_dir / project_id
        project_dir.mkdir(parents=True, exist_ok=False)

        document_path = project_dir / DOCUMENT_FILENAME
        document_path.write_bytes(pdf_bytes)
        toc_text = self._initial_toc_text(toc_bytes)
        (project_dir / "toc.json").write_text(toc_text, encoding="utf-8")

        page_count = self._pdf_page_count(document_path)
        now = utc_now_iso()
        metadata = {
            "id": project_id,
            "name": Path(pdf_filename).stem or "Untitled PDF",
            "pdf_filename": pdf_filename or "source.pdf",
            "toc_filename": toc_filename,
            "page_offset": page_offset,
            "toc_start": 1,
            "toc_end": page_count,
            "inject_toc_page": True,
            "provider_id": None,
            "page_count": page_count,
            "created_at": now,
            "updated_at": now,
            "toc_updated_at": now,
            "generated_at": None,
            "last_validation": None,
        }
        self._write_metadata(project_id, metadata)
        return metadata

    def get_project(self, project_id: str) -> dict[str, Any]:
        metadata_file = self._project_dir(project_id) / "project.json"
        if not metadata_file.exists():
            raise KeyError(project_id)
        return self._normalize_metadata(json.loads(metadata_file.read_text(encoding="utf-8")))

    def delete_project(self, project_id: str) -> None:
        project_dir = self._project_dir(project_id)
        if not project_dir.exists():
            raise KeyError(project_id)
        shutil.rmtree(project_dir)

    def read_toc_text(self, project_id: str) -> str:
        toc_file = self.toc_path(project_id)
        if not toc_file.exists():
            raise KeyError(project_id)
        return toc_file.read_text(encoding="utf-8")

    def save_toc_text(self, project_id: str, toc_text: str, generated: bool = False) -> dict[str, Any]:
        metadata = self.get_project(project_id)
        self.toc_path(project_id).write_text(toc_text, encoding="utf-8")
        now = utc_now_iso()
        metadata["updated_at"] = now
        metadata["toc_updated_at"] = now
        if generated:
            metadata["generated_at"] = now
        self._write_metadata(project_id, metadata)
        return metadata

    def update_project_metadata(
        self,
        project_id: str,
        *,
        page_offset: int | None = None,
        toc_start: int | None = None,
        toc_end: int | None = None,
        provider_id: str | None = None,
        provider_id_set: bool = False,
        inject_toc_page: bool | None = None,
    ) -> dict[str, Any]:
        metadata = self.get_project(project_id)
        if page_offset is not None:
            metadata["page_offset"] = page_offset
        if toc_start is not None:
            metadata["toc_start"] = toc_start
        if toc_end is not None:
            metadata["toc_end"] = toc_end
        if provider_id_set:
            metadata["provider_id"] = provider_id
        if inject_toc_page is not None:
            metadata["inject_toc_page"] = inject_toc_page
        metadata["updated_at"] = utc_now_iso()
        self._write_metadata(project_id, metadata)
        return metadata

    def record_validation(
        self,
        project_id: str,
        validation: ValidationResult,
        page_offset: int,
    ) -> dict[str, Any]:
        metadata = self.get_project(project_id)
        metadata["page_offset"] = page_offset
        metadata["updated_at"] = utc_now_iso()
        metadata["last_validation"] = {
            "valid": validation.valid,
            "bookmark_count": validation.bookmark_count,
            "checked_at": utc_now_iso(),
            "issues": [{"message": issue.message} for issue in validation.issues],
        }
        self._write_metadata(project_id, metadata)
        return metadata

    def pdf_path(self, project_id: str) -> Path:
        project_dir = self._project_dir(project_id)
        document_path = project_dir / DOCUMENT_FILENAME
        legacy_paths = [
            project_dir / LEGACY_SOURCE_FILENAME,
            project_dir / LEGACY_OUTPUT_FILENAME,
        ]

        if document_path.exists():
            for legacy_path in legacy_paths:
                legacy_path.unlink(missing_ok=True)
            return document_path

        legacy_document = next(
            (path for path in reversed(legacy_paths) if path.exists()),
            None,
        )
        if legacy_document is None:
            raise KeyError(project_id)

        legacy_document.replace(document_path)
        for legacy_path in legacy_paths:
            legacy_path.unlink(missing_ok=True)
        return document_path

    def toc_path(self, project_id: str) -> Path:
        return self._project_dir(project_id) / "toc.json"

    def cache_dir(self) -> Path:
        path = self.root / "cache"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def validate_toc(self, project_id: str, toc_text: str, page_offset: int) -> ValidationResult:
        pdf_path = self.pdf_path(project_id)
        if not pdf_path.exists():
            raise KeyError(project_id)

        try:
            raw_data = json.loads(toc_text)
            normalized = validate_toc_json_structure(raw_data)
            items = parse_toc_items(normalized)
            page_count = self._pdf_page_count(pdf_path)
            flattened = flatten_to_pymupdf_toc(
                items=items,
                page_offset=page_offset,
                pdf_page_count=page_count,
            )
        except json.JSONDecodeError as exc:
            return ValidationResult(
                valid=False,
                issues=[ValidationIssue(f"JSON syntax error: {exc.msg} at line {exc.lineno}")],
            )
        except ValueError as exc:
            return ValidationResult(valid=False, issues=[ValidationIssue(str(exc))])

        return ValidationResult(
            valid=True,
            issues=[],
            normalized_toc=normalized,
            bookmark_count=len(flattened),
        )

    def read_llm_settings(self) -> dict[str, Any]:
        providers = self.read_llm_providers()
        return providers[0] if providers else {"base_url": "", "model": "", "api_key": ""}

    def read_llm_providers(self) -> list[dict[str, Any]]:
        if not self.settings_file.exists():
            return [self._provider_record("default", "Qwen VL", "https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen3-vl-flash", "")]
        raw = json.loads(self.settings_file.read_text(encoding="utf-8"))
        if isinstance(raw.get("providers"), list):
            return [self._normalize_provider(item, index) for index, item in enumerate(raw["providers"]) if isinstance(item, dict)]
        # Migrate the legacy single-provider file without changing its credential.
        return [self._provider_record("default", str(raw.get("model") or "Default VLM"), str(raw.get("base_url") or ""), str(raw.get("model") or ""), str(raw.get("api_key") or ""))]

    def _read_settings(self) -> dict[str, Any]:
        if not self.settings_file.exists():
            return {}
        try:
            raw = json.loads(self.settings_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        return raw if isinstance(raw, dict) else {}

    def _write_settings(self, raw: dict[str, Any]) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        self.settings_file.write_text(
            json.dumps(raw, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def save_llm_providers(self, providers: list[dict[str, Any]]) -> list[dict[str, Any]]:
        self.root.mkdir(parents=True, exist_ok=True)
        existing = {str(item["id"]): item for item in self.read_llm_providers()}
        normalized: list[dict[str, Any]] = []
        seen: set[str] = set()
        for index, item in enumerate(providers):
            provider_id = str(item.get("id") or uuid4().hex)
            if provider_id in seen:
                raise ValueError("Provider IDs must be unique")
            seen.add(provider_id)
            previous = existing.get(provider_id)
            api_key_value = item.get("api_key")
            api_key = str(previous.get("api_key") or "") if api_key_value in {None, ""} and previous else str(api_key_value or "")
            provider = self._provider_record(
                provider_id,
                str(item.get("name") or item.get("model") or f"VLM API {index + 1}").strip(),
                str(item.get("base_url") or "").strip(),
                str(item.get("model") or "").strip(),
                api_key,
            )
            if previous and self._provider_connection(previous) == self._provider_connection(provider):
                provider.update({key: previous.get(key) for key in ("verification_status", "verification_message", "verified_at")})
            normalized.append(provider)
        raw = self._read_settings()
        raw["providers"] = normalized
        self._write_settings(raw)
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
            "api_key_hint": self._api_key_hint(api_key),
        }

    def public_llm_providers(self) -> list[dict[str, Any]]:
        return [self._public_provider(item) for item in self.read_llm_providers()]

    def get_llm_provider(self, provider_id: str) -> dict[str, Any]:
        provider = next((item for item in self.read_llm_providers() if item["id"] == provider_id), None)
        if provider is None:
            raise KeyError(provider_id)
        return provider

    def read_toc_prompt(self) -> str:
        """Return the effective ToC prompt (stored override or built-in default)."""
        settings = self._read_settings()
        value = settings.get("prompt")
        if not isinstance(value, str) or not value.strip():
            # Migrate the legacy {prompts: {flat, tree}} layout.
            legacy = settings.get("prompts")
            if isinstance(legacy, dict):
                value = legacy.get("flat")
        if not isinstance(value, str) or not value.strip():
            return DEFAULT_FLAT_PROMPT
        return value

    def save_toc_prompt(self, prompt: str) -> str:
        """Persist the ToC prompt override, preserving the providers key."""
        raw = self._read_settings()
        raw["prompt"] = prompt.strip()
        if "prompts" in raw:
            del raw["prompts"]
        self._write_settings(raw)
        return self.read_toc_prompt()

    def record_provider_verification(self, provider_id: str, status: str, message: str) -> dict[str, Any]:
        providers = self.read_llm_providers()
        provider = next((item for item in providers if item["id"] == provider_id), None)
        if provider is None:
            raise KeyError(provider_id)
        provider["verification_status"] = status
        provider["verification_message"] = message
        provider["verified_at"] = utc_now_iso()
        raw = self._read_settings()
        raw["providers"] = providers
        self._write_settings(raw)
        return self._public_provider(provider)

    def list_toc_files(self, project_id: str) -> list[dict[str, Any]]:
        metadata = self.get_project(project_id)
        records = metadata.get("toc_files")
        if not isinstance(records, list):
            return [{"id": "main", "name": "toc.json", "kind": "manual", "created_at": metadata.get("toc_updated_at"), "updated_at": metadata.get("toc_updated_at"), "source_job_id": None}]
        return records

    def read_toc_file(self, project_id: str, toc_file_id: str) -> str:
        return self._toc_file_path(project_id, toc_file_id).read_text(encoding="utf-8")

    def save_toc_file(self, project_id: str, toc_file_id: str, toc_text: str) -> dict[str, Any]:
        path = self._toc_file_path(project_id, toc_file_id)
        path.write_text(toc_text, encoding="utf-8")
        metadata = self.get_project(project_id)
        now = utc_now_iso()
        metadata["updated_at"] = now
        if toc_file_id == "main":
            metadata["toc_updated_at"] = now
        for record in metadata.get("toc_files", []):
            if record.get("id") == toc_file_id:
                record["updated_at"] = now
        self._write_metadata(project_id, metadata)
        return metadata

    def create_generated_toc_file(self, project_id: str, job_id: str, toc_text: str, provider: dict[str, Any] | None = None) -> dict[str, Any]:
        metadata = self.get_project(project_id)
        candidate_dir = self._project_dir(project_id) / "toc_candidates"
        candidate_dir.mkdir(parents=True, exist_ok=True)
        toc_file_id = f"generated-{job_id}"
        (candidate_dir / f"{toc_file_id}.json").write_text(toc_text, encoding="utf-8")
        now = utc_now_iso()
        record = {
            "id": toc_file_id,
            "name": f"generated-{job_id[:8]}.json",
            "kind": "generated",
            "created_at": now,
            "updated_at": now,
            "source_job_id": job_id,
            "provider": provider,
        }
        records = metadata.setdefault("toc_files", self.list_toc_files(project_id))
        records.append(record)
        metadata["generated_at"] = now
        metadata["updated_at"] = now
        self._write_metadata(project_id, metadata)
        return record

    def _toc_file_path(self, project_id: str, toc_file_id: str) -> Path:
        if toc_file_id == "main":
            return self.toc_path(project_id)
        record = next((item for item in self.list_toc_files(project_id) if item.get("id") == toc_file_id), None)
        if record is None:
            raise KeyError(toc_file_id)
        return self._project_dir(project_id) / "toc_candidates" / f"{toc_file_id}.json"

    def _provider_record(self, provider_id: str, name: str, base_url: str, model: str, api_key: str) -> dict[str, Any]:
        return {"id": provider_id, "name": name, "base_url": base_url, "model": model, "api_key": api_key, "verification_status": "unverified", "verification_message": "Not tested", "verified_at": None}

    def _normalize_provider(self, item: dict[str, Any], index: int) -> dict[str, Any]:
        provider = self._provider_record(str(item.get("id") or uuid4().hex), str(item.get("name") or item.get("model") or f"VLM API {index + 1}"), str(item.get("base_url") or ""), str(item.get("model") or ""), str(item.get("api_key") or ""))
        provider.update({key: item.get(key) for key in ("verification_status", "verification_message", "verified_at") if key in item})
        return provider

    def _provider_connection(self, provider: dict[str, Any]) -> tuple[str, str, str]:
        return (str(provider.get("base_url") or ""), str(provider.get("model") or ""), str(provider.get("api_key") or ""))

    def _public_provider(self, provider: dict[str, Any]) -> dict[str, Any]:
        public = {key: value for key, value in provider.items() if key != "api_key"}
        api_key = str(provider.get("api_key") or "")
        public.update({"has_api_key": bool(api_key), "api_key_hint": self._api_key_hint(api_key)})
        return public

    def _project_dir(self, project_id: str) -> Path:
        return self.projects_dir / project_id

    def _normalize_metadata(self, metadata: dict[str, Any]) -> dict[str, Any]:
        page_count = int(metadata.get("page_count") or 0)
        normalized = dict(metadata)
        normalized["page_offset"] = int(normalized.get("page_offset") or 0)
        normalized["toc_start"] = int(normalized.get("toc_start") or 1)
        normalized["toc_end"] = int(normalized.get("toc_end") or page_count)
        normalized["provider_id"] = normalized.get("provider_id") or None
        normalized["inject_toc_page"] = bool(normalized.get("inject_toc_page", True))
        return normalized

    def _write_metadata(self, project_id: str, metadata: dict[str, Any]) -> None:
        project_dir = self._project_dir(project_id)
        project_dir.mkdir(parents=True, exist_ok=True)
        (project_dir / "project.json").write_text(
            json.dumps(metadata, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _initial_toc_text(self, toc_bytes: bytes | None) -> str:
        if toc_bytes is None:
            return json.dumps(DEFAULT_TOC, ensure_ascii=False, indent=2)
        toc_text = toc_bytes.decode("utf-8")
        raw_data = json.loads(toc_text)
        normalized = validate_toc_json_structure(raw_data)
        return json.dumps(normalized, ensure_ascii=False, indent=2)

    def _pdf_page_count(self, pdf_path: Path) -> int:
        with fitz.open(pdf_path) as doc:
            return doc.page_count

    def _api_key_hint(self, api_key: str) -> str:
        if not api_key:
            return ""
        if len(api_key) <= 8:
            return "configured"
        return f"{api_key[:4]}...{api_key[-4:]}"


store = ProjectStore()
