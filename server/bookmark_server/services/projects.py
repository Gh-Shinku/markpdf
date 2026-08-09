from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..core import flatten_to_pymupdf_toc, parse_toc_items, validate_toc_json_structure
from .playground_repository import PlaygroundRepository
from .project_repository import ProjectRepository
from .projects_common import (
    DEFAULT_TOC,
    DOCUMENT_FILENAME,
    LEGACY_OUTPUT_FILENAME,
    LEGACY_SOURCE_FILENAME,
    default_data_dir,
    utc_now_iso,
)
from .settings_repository import SettingsRepository
from .toc_file_repository import TocFileRepository


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
    """Compatibility facade over focused file-backed repositories."""

    def __init__(self, root: Path | None = None) -> None:
        self.root = root or default_data_dir()
        self.projects = ProjectRepository(self.root)
        self.settings = SettingsRepository(self.root)
        self.toc_files = TocFileRepository(self.root, self.projects)
        self.playground = PlaygroundRepository(self.root)

        self.projects_dir = self.projects.projects_dir
        self.settings_file = self.settings.settings_file
        self.playground_dir = self.playground.playground_dir
        self.playground_chats_dir = self.playground.playground_chats_dir
        self.playground_index_file = self.playground.playground_index_file

    def ensure_root(self) -> None:
        self.projects.ensure_root()

    def list_projects(self) -> list[dict[str, Any]]:
        return self.projects.list_projects()

    def create_project(
        self,
        pdf_filename: str,
        pdf_bytes: bytes,
        toc_bytes: bytes | None = None,
        toc_filename: str | None = None,
        page_offset: int = 0,
    ) -> dict[str, Any]:
        return self.projects.create_project(pdf_filename, pdf_bytes, toc_bytes, toc_filename, page_offset)

    def get_project(self, project_id: str) -> dict[str, Any]:
        return self.projects.get_project(project_id)

    def delete_project(self, project_id: str) -> None:
        self.projects.delete_project(project_id)

    def read_toc_text(self, project_id: str) -> str:
        return self.projects.read_toc_text(project_id)

    def save_toc_text(self, project_id: str, toc_text: str, generated: bool = False) -> dict[str, Any]:
        return self.projects.save_toc_text(project_id, toc_text, generated)

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
        return self.projects.update_project_metadata(
            project_id,
            page_offset=page_offset,
            toc_start=toc_start,
            toc_end=toc_end,
            provider_id=provider_id,
            provider_id_set=provider_id_set,
            inject_toc_page=inject_toc_page,
        )

    def record_validation(self, project_id: str, validation: ValidationResult, page_offset: int) -> dict[str, Any]:
        return self.projects.record_validation(project_id, validation, page_offset)

    def pdf_path(self, project_id: str) -> Path:
        return self.projects.pdf_path(project_id)

    def toc_path(self, project_id: str) -> Path:
        return self.projects.toc_path(project_id)

    def cache_dir(self) -> Path:
        path = self.root / "cache"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def list_playground_chats(self) -> dict[str, Any]:
        return self.playground.list_playground_chats()

    def create_playground_chat(self, provider_id: str | None = None, thinking_mode: str | None = None) -> dict[str, Any]:
        return self.playground.create_playground_chat(provider_id, thinking_mode)

    def get_playground_chat(self, chat_id: str) -> dict[str, Any]:
        return self.playground.get_playground_chat(chat_id)

    def set_active_playground_chat(self, chat_id: str) -> dict[str, Any]:
        return self.playground.set_active_playground_chat(chat_id)

    def rename_playground_chat(self, chat_id: str, title: str) -> dict[str, Any]:
        return self.playground.rename_playground_chat(chat_id, title)

    def update_playground_chat_settings(
        self,
        chat_id: str,
        *,
        provider_id: str | None = None,
        thinking_mode: str | None = None,
    ) -> dict[str, Any]:
        return self.playground.update_playground_chat_settings(chat_id, provider_id=provider_id, thinking_mode=thinking_mode)

    def delete_playground_chat(self, chat_id: str) -> dict[str, Any]:
        return self.playground.delete_playground_chat(chat_id)

    def append_playground_exchange(
        self,
        chat_id: str,
        provider_id: str,
        thinking_mode: str,
        user_message: dict[str, Any],
        assistant_message: dict[str, Any],
    ) -> dict[str, Any]:
        return self.playground.append_playground_exchange(chat_id, provider_id, thinking_mode, user_message, assistant_message)

    def save_playground_attachment(self, chat_id: str, attachment_id: str, data_url: str) -> str:
        return self.playground.save_playground_attachment(chat_id, attachment_id, data_url)

    def playground_attachment_path(self, chat_id: str, attachment_filename: str) -> Path:
        return self.playground.playground_attachment_path(chat_id, attachment_filename)

    def validate_toc(self, project_id: str, toc_text: str, page_offset: int) -> ValidationResult:
        pdf_path = self.pdf_path(project_id)
        if not pdf_path.exists():
            raise KeyError(project_id)

        try:
            raw_data = json.loads(toc_text)
            normalized = validate_toc_json_structure(raw_data)
            items = parse_toc_items(normalized)
            page_count = self.projects.pdf_page_count(pdf_path)
            flattened = flatten_to_pymupdf_toc(items=items, page_offset=page_offset, pdf_page_count=page_count)
        except json.JSONDecodeError as exc:
            return ValidationResult(valid=False, issues=[ValidationIssue(f"JSON syntax error: {exc.msg} at line {exc.lineno}")])
        except ValueError as exc:
            return ValidationResult(valid=False, issues=[ValidationIssue(str(exc))])

        return ValidationResult(valid=True, issues=[], normalized_toc=normalized, bookmark_count=len(flattened))

    def read_llm_settings(self) -> dict[str, Any]:
        return self.settings.read_llm_settings()

    def read_llm_providers(self) -> list[dict[str, Any]]:
        return self.settings.read_llm_providers()

    def save_llm_providers(self, providers: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return self.settings.save_llm_providers(providers)

    def save_llm_settings(self, settings: dict[str, Any]) -> dict[str, Any]:
        return self.settings.save_llm_settings(settings)

    def public_llm_settings(self) -> dict[str, Any]:
        return self.settings.public_llm_settings()

    def public_llm_providers(self) -> list[dict[str, Any]]:
        return self.settings.public_llm_providers()

    def public_provider(self, provider: dict[str, Any]) -> dict[str, Any]:
        return self.settings.public_provider(provider)

    def get_llm_provider(self, provider_id: str) -> dict[str, Any]:
        return self.settings.get_llm_provider(provider_id)

    def read_toc_prompt(self) -> str:
        return self.settings.read_toc_prompt()

    def save_toc_prompt(self, prompt: str) -> str:
        return self.settings.save_toc_prompt(prompt)

    def record_provider_verification(self, provider_id: str, status: str, message: str) -> dict[str, Any]:
        return self.settings.record_provider_verification(provider_id, status, message)

    def list_toc_files(self, project_id: str) -> list[dict[str, Any]]:
        return self.toc_files.list_toc_files(project_id)

    def read_toc_file(self, project_id: str, toc_file_id: str) -> str:
        return self.toc_files.read_toc_file(project_id, toc_file_id)

    def save_toc_file(self, project_id: str, toc_file_id: str, toc_text: str) -> dict[str, Any]:
        return self.toc_files.save_toc_file(project_id, toc_file_id, toc_text)

    def create_generated_toc_file(self, project_id: str, job_id: str, toc_text: str, provider: dict[str, Any] | None = None) -> dict[str, Any]:
        return self.toc_files.create_generated_toc_file(project_id, job_id, toc_text, provider)


store = ProjectStore()
