from __future__ import annotations

import json
from abc import ABC, abstractmethod
from typing import Any

from ..core import validate_toc_json_structure
from .toc_assembly import TOCAssembler, extract_json_text, parse_flat_page
from .toc_prompts import DEFAULT_FLAT_PROMPT, render_prompt_template
from .vlm_client import request_toc_from_vlm


class BaseExtractor(ABC):
    def __init__(
        self,
        toc_start: int,
        toc_end: int,
        prompt: str | None = None,
        pdf_name: str = "",
    ) -> None:
        self.toc_start = toc_start
        self.toc_end = toc_end
        self.prompt = prompt
        self.pdf_name = pdf_name

    @property
    @abstractmethod
    def mode(self) -> str:
        raise NotImplementedError

    def build_prompt(self) -> str:
        template = self.prompt or DEFAULT_FLAT_PROMPT
        return render_prompt_template(
            template,
            toc_start=self.toc_start,
            toc_end=self.toc_end,
            pdf_name=self.pdf_name,
        )

    @abstractmethod
    def parse_response(self, raw_text: str) -> list[dict[str, Any]]:
        raise NotImplementedError


class FlatExtractor(BaseExtractor):
    def __init__(
        self,
        toc_start: int,
        toc_end: int,
        prompt: str | None = None,
        pdf_name: str = "",
    ) -> None:
        super().__init__(toc_start=toc_start, toc_end=toc_end, prompt=prompt, pdf_name=pdf_name)
        self.assembler = TOCAssembler()

    @property
    def mode(self) -> str:
        return "flat"

    def parse_response(self, raw_text: str) -> list[dict[str, Any]]:
        json_text = extract_json_text(raw_text)
        parsed = json.loads(json_text)
        flat_list = self._validate_flat_list(parsed)
        assembled_tree = self.assembler.assemble(flat_list)
        return validate_toc_json_structure(assembled_tree)

    def _filter_anomalies_by_monotonic_page(
        self,
        flat_items: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        filtered: list[dict[str, Any]] = []
        last_page: int | None = None
        seen_texts: set[str] = set()

        for item in flat_items:
            page = item.get("page")
            text_key = str(item.get("text", "")).strip().lower()

            if page is not None and last_page is not None and page < last_page:
                if text_key in seen_texts:
                    continue

            filtered.append(item)
            seen_texts.add(text_key)
            if page is not None:
                last_page = page

        return filtered

    def extract_single_page_flat(
        self,
        image_data_url: str,
        api_key: str,
        base_url: str,
        model: str,
        completion_options: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        raw_response = request_toc_from_vlm(
            image_data_urls=[image_data_url],
            prompt=self.build_prompt(),
            api_key=api_key,
            base_url=base_url,
            model=model,
            completion_options=completion_options,
        )
        json_text = extract_json_text(raw_response)
        parsed = json.loads(json_text)
        return self._validate_flat_list(parsed)

    def rebuild_from_page_items(
        self,
        page_flat_items: list[list[dict[str, Any]]],
    ) -> list[dict[str, Any]]:
        merged_flat_items: list[dict[str, Any]] = []
        for page_index, page_items in enumerate(page_flat_items):
            for item in page_items:
                marked = dict(item)
                marked["_page_index"] = page_index
                merged_flat_items.append(marked)

        merged_flat_items = self._filter_anomalies_by_monotonic_page(merged_flat_items)
        assembled_tree = self.assembler.assemble(merged_flat_items)
        return validate_toc_json_structure(assembled_tree)

    def _validate_flat_list(self, data: Any) -> list[dict[str, Any]]:
        if not isinstance(data, list):
            raise ValueError("Flat extraction output must be a JSON array")

        validated: list[dict[str, Any]] = []
        for node in data:
            if not isinstance(node, dict):
                raise ValueError(f"Invalid flat node: {node!r}")

            text = node.get("text")
            page = node.get("page")
            indent = node.get("indent")

            if not isinstance(text, str) or not text.strip():
                raise ValueError(f"Invalid text in flat node: {node!r}")
            if page is not None and not isinstance(page, (int, str)):
                raise ValueError(f"Invalid page in flat node: {node!r}")
            if isinstance(page, bool):
                raise ValueError(f"Invalid page in flat node: {node!r}")
            if indent is not None and (not isinstance(indent, int) or isinstance(indent, bool) or indent < 0):
                raise ValueError(f"Invalid indent in flat node: {node!r}")

            parsed_page, keep = self._parse_flat_page(page)
            if not keep:
                continue
            validated.append({"text": text.strip(), "page": parsed_page, "indent": indent})

        return validated

    @staticmethod
    def _parse_flat_page(page: int | str | None) -> tuple[int | None, bool]:
        return parse_flat_page(page)
