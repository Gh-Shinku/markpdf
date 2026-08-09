from __future__ import annotations

import base64
from datetime import datetime
import hashlib
import json
import re
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Callable

import fitz
from openai import OpenAI

from ..core import validate_toc_json_structure


DEFAULT_FLAT_PROMPT = (
    "Role: You are a high-precision OCR Data Entry Clerk.\n"
    "Task: Extract ToC entries from the current page as a FLAT list of items.\n\n"
    "### Specific Rules:\n"
    "1. **Flat Output**: Do NOT nest items. Every entry must be a direct element of the root array.\n"
    "2. **Text Cleaning**: \n"
    "   - Merge multi-line titles into a single string.\n"
    "   - Remove leader dots (e.g., 'Chapter 1.......10' becomes text:'Chapter 1', page:10).\n"
    "3. **Page Range**: Only process the content visible on THIS page. Do not guess what's on the next page.\n"
    "4. **Filtering**: Ignore headers, footers, and decorative elements.\n"
    "5. **Verbatim**: Keep the original numbering (e.g., '1.2.3', 'Appendix A') within the 'text' field.\n"
    "6. **Indent Level**: Set 'indent' to the visual indentation depth of each entry relative to the leftmost ToC column on this page: 0 for top-level entries, and 1 for each deeper indentation level. Judge from indentation and font size, and keep the scale consistent within the page.\n"
    "7. **Page Numbers**: Copy the printed page number exactly as shown, as a string (e.g. '12' or 'vii'), or set to null when not visible. Roman-numeral pages are ignored by the reader, so skip such entries entirely.\n"
    "8. **Missing Page Numbers**: If an entry has no printed page number (e.g. a 'Chapter 1' heading), copy the page of the first entry that follows it within the same chapter; keep null only when no such page exists.\n\n"
    "### Output Format:\n"
    "Return ONLY a JSON array. No markdown, no conversational text.\n"
    'Schema: [{"text": "Full Title String", "page": string_or_null, "indent": integer}, ...]'
)


_ROMAN_RE = re.compile(
    r"^(?=[MDCLXVI])M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$",
    re.IGNORECASE,
)


def render_prompt_template(
    template: str,
    toc_start: int,
    toc_end: int,
    pdf_name: str,
) -> str:
    """Render a prompt template with the supported placeholder variables.

    Placeholders are replaced with plain str.replace (not str.format) so that
    JSON braces in templates pass through untouched. Page numbers render
    1-based, matching the user-facing selection.
    """
    return (
        template.replace("{toc_start}", str(toc_start + 1))
        .replace("{toc_end}", str(toc_end + 1))
        .replace("{pdf_name}", pdf_name)
    )


FlatPageEventCallback = Callable[
    [
        int,  # page_call_index (1-based within TOC slice)
        int,  # total pages in TOC slice
        str,  # status: CACHE|VLM
        str,  # stage: rendering|scanning|success|cache_loaded
        int | None,  # entries extracted/loaded
        float | None,  # elapsed seconds for this atomic step
    ],
    None,
]


def prune_null_page_nodes(toc_data: list[dict[str, Any]]) -> list[dict[str, Any]]:
    def walk(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
        pruned: list[dict[str, Any]] = []
        for node in nodes:
            children = walk(node.get("children", []))
            page = node.get("page")
            if page is None:
                # Drop null-page nodes from final TOC and promote descendants.
                pruned.extend(children)
                continue
            pruned.append(
                {
                    "title": node.get("title"),
                    "page": page,
                    "attribute": node.get("attribute", "relative"),
                    "children": children,
                }
            )
        return pruned

    return walk(toc_data)


def request_toc_from_vlm(
    image_data_urls: list[str],
    prompt: str,
    api_key: str,
    base_url: str,
    model: str,
) -> str:
    client = OpenAI(api_key=api_key, base_url=base_url)
    content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
    for data_url in image_data_urls:
        content.append({"type": "image_url", "image_url": {"url": data_url}})

    completion = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": content}],
        temperature=0,
    )

    return _read_completion_text(completion.choices[0].message.content)


def request_chat_from_vlm(
    messages: list[dict[str, Any]],
    api_key: str,
    base_url: str,
    model: str,
) -> str:
    client = OpenAI(api_key=api_key, base_url=base_url)
    completion = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=0,
    )
    return _read_completion_text(completion.choices[0].message.content)


def _read_completion_text(message_content: Any) -> str:
    if isinstance(message_content, str):
        return message_content

    if isinstance(message_content, list):
        chunks: list[str] = []
        for part in message_content:
            if isinstance(part, dict) and part.get("type") == "text":
                text = part.get("text")
                if isinstance(text, str):
                    chunks.append(text)
        if chunks:
            return "\n".join(chunks)

    raise ValueError("VLM response does not include readable text content")


def render_pdf_page_image(
    input_pdf: Path,
    page: int,
    dpi: int,
) -> dict[str, Any]:
    """Render a 1-based PDF page to the same PNG data URL used for VLM calls."""
    if page < 1:
        raise ValueError("PDF page must be >= 1")
    with fitz.open(input_pdf) as doc:
        if page > doc.page_count:
            raise ValueError(f"PDF page {page} out of range (page_count={doc.page_count})")
        pdf_page = doc.load_page(page - 1)
        zoom = dpi / 72.0
        matrix = fitz.Matrix(zoom, zoom)
        pix = pdf_page.get_pixmap(matrix=matrix, alpha=False)
        image_bytes = pix.tobytes("png")
    b64 = base64.b64encode(image_bytes).decode("ascii")
    return {
        "dpi": dpi,
        "mime_type": "image/png",
        "width": pix.width,
        "height": pix.height,
        "sha256": hashlib.sha256(image_bytes).hexdigest(),
        "data_url": f"data:image/png;base64,{b64}",
    }


def extract_json_text(raw_text: str) -> str:
    candidate = raw_text.strip()
    if candidate.startswith("```"):
        candidate = re.sub(r"^```(?:json)?\s*", "", candidate)
        candidate = re.sub(r"\s*```$", "", candidate)
    return candidate.strip()


class TOCAssembler:
    _numbering_re = re.compile(r"^\s*((?:\d+\.)+\d*|\d+)\b")

    def assemble(self, flat_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        healed = self._heal_cross_page(flat_items)
        enriched = self._assign_levels(healed)
        tree = self._build_tree(enriched)
        return self._inherit_missing_pages(tree)

    def _heal_cross_page(self, flat_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        healed: list[dict[str, Any]] = []
        for item in flat_items:
            text = str(item.get("text", "")).strip()
            page = item.get("page")
            if not text:
                continue

            if page is None and healed:
                previous = healed[-1]
                # 仅合并跨页续行:该条目是下一页首条(page 无值)且上一页末条
                # 已带页码。同页内的 null-page 条目(如无页码的章节标题)
                # 保持独立,避免被误拼接进前一条目。
                previous_index = previous.get("_page_index")
                if (
                    previous_index is not None
                    and item.get("_page_index") != previous_index
                ):
                    previous["text"] = f"{previous['text']}{text}"
                    continue

            healed.append(
                {
                    "text": text,
                    "page": page,
                    "indent": item.get("indent"),
                    "_page_index": item.get("_page_index"),
                }
            )

        for healed_item in healed:
            healed_item.pop("_page_index", None)
        return healed

    @staticmethod
    def _inherit_missing_pages(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Fill null pages from the first descendant that carries a page.

        Chapter headings often have no printed page number; without this pass
        they would be dropped by prune_null_page_nodes. Runs after assembly so
        prompt violations still produce a usable tree.
        """
        def fill(node: dict[str, Any]) -> int | None:
            if node.get("page") is not None:
                return node["page"]
            for child in node.get("children", []):
                inherited = fill(child)
                if inherited is not None:
                    node["page"] = inherited
                    break
            return node.get("page")

        for node in nodes:
            fill(node)
        return nodes

    def _detect_level(self, text: str, previous_level: int, chapter_level: int | None) -> int:
        match = self._numbering_re.match(text)
        if match:
            numbering = match.group(1).rstrip(".")
            segments = [segment for segment in numbering.split(".") if segment]
            depth = max(1, len(segments))
            if chapter_level is not None:
                # 章节标题(如 'Chapter 1')之后的编号条目相对章节偏移,
                # 即 '1.' 是章内第一级,'1.1' 是第二级。
                return max(1, chapter_level + depth)
            return depth

        leading_spaces = len(text) - len(text.lstrip(" "))
        if leading_spaces > 0:
            return max(1, leading_spaces // 2 + 1)

        lower_text = text.lower()
        if (
            lower_text.startswith("part")
            or lower_text.startswith("chapter")
            or (text.startswith("第") and ("部分" in text or "章" in text))
        ):
            return 1

        return max(1, previous_level)

    def _assign_levels(self, flat_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        enriched: list[dict[str, Any]] = []
        ancestors: list[tuple[int, int]] = []  # (level, indent) chain of open ancestors
        previous_level = 1
        chapter_level: int | None = None
        for item in flat_items:
            indent = item.get("indent")
            if indent is None:
                level = self._detect_level(
                    item["text"], previous_level=previous_level, chapter_level=chapter_level
                )
                if self._is_chapter_heading(item["text"]):
                    chapter_level = level
            else:
                level = self._level_from_indent(int(indent), ancestors)
                # Mirror the depth clamp applied by _build_tree so that a
                # skipped indent level (e.g. a scale jump between pages) opens
                # exactly one level and following siblings inherit the clamped
                # depth instead of the raw delta-derived one.
                level = min(level, len(ancestors) + 1)
                while ancestors and ancestors[-1][0] >= level:
                    ancestors.pop()
                ancestors.append((level, int(indent)))
            previous_level = level
            enriched.append(
                {
                    "title": item["text"],
                    "page": item["page"],
                    "attribute": "relative",
                    "children": [],
                    "_level": level,
                    "_indent": indent,
                }
            )
        return enriched

    @staticmethod
    def _is_chapter_heading(text: str) -> bool:
        lower_text = text.lower()
        return (
            lower_text.startswith("part")
            or lower_text.startswith("chapter")
            or (text.startswith("第") and ("部分" in text or "章" in text))
        )

    def _level_from_indent(self, indent: int, stack: list[tuple[int, int]]) -> int:
        """Derive the tree level from the VLM-reported indent.

        Uses the delta against the nearest open ancestor's indent instead of the
        absolute value, so that a constant page-to-page shift in the VLM's
        indent scale does not change the derived hierarchy.
        """
        if not stack:
            return 1
        top_level, top_indent = stack[-1]
        delta = indent - top_indent
        if delta > 0:
            return top_level + delta
        if delta == 0:
            return top_level
        return max(1, top_level + delta)

    def _build_tree(self, enriched_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        roots: list[dict[str, Any]] = []
        stack: list[dict[str, Any]] = []

        for item in enriched_items:
            level = int(item["_level"])
            if level > len(stack) + 1:
                level = len(stack) + 1
            level = max(1, level)

            node = {
                "title": item["title"],
                "page": item["page"],
                "attribute": item["attribute"],
                "children": [],
            }

            while len(stack) >= level:
                stack.pop()

            if not stack:
                roots.append(node)
            else:
                stack[-1]["children"].append(node)

            stack.append(node)

        return roots


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
                # ToC pages are not monotonic: front matter (Preface etc.)
                # often carries a higher page number than the first body page.
                # Only drop entries whose page regresses AND whose text repeats
                # (the typical header/footer OCR noise pattern).
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
    ) -> list[dict[str, Any]]:
        raw_response = request_toc_from_vlm(
            image_data_urls=[image_data_url],
            prompt=self.build_prompt(),
            api_key=api_key,
            base_url=base_url,
            model=model,
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
        """Resolve a raw page value into an integer page number.

        Roman-numeral pages (e.g. 'vii' from Prefaces that precede the first
        relative page) and unparseable strings are dropped by returning
        keep=False, so they never reach the assembled TOC.
        """
        if page is None:
            return None, True
        if isinstance(page, int):
            return page, True

        cleaned = str(page).strip().rstrip(".").rstrip(",")
        if not cleaned:
            return None, False
        if cleaned.isdigit():
            return int(cleaned), True
        if _ROMAN_RE.match(cleaned):
            return None, False
        return None, False


def request_llm_json(
    prompt: str,
    api_key: str,
    base_url: str,
    model: str,
) -> str:
    """Send a text-only prompt and return the raw text response."""
    client = OpenAI(api_key=api_key, base_url=base_url)
    completion = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0,
    )

    message_content = completion.choices[0].message.content
    if isinstance(message_content, str):
        return message_content

    if isinstance(message_content, list):
        chunks: list[str] = []
        for part in message_content:
            if isinstance(part, dict) and part.get("type") == "text":
                text = part.get("text")
                if isinstance(text, str):
                    chunks.append(text)
        if chunks:
            return "\n".join(chunks)

    raise ValueError("LLM response does not include readable text content")


LEVEL_CORRECTION_PROMPT = (
    "Role: You are a book Table of Contents structure reviewer.\n"
    "Task: Review the ToC JSON tree below and fix ONLY hierarchical (parent/child) errors.\n"
    "Common errors: an entry sits at the wrong depth relative to its numbering "
    "(e.g. '2.1' must be a child of '2', '1.1.1' must be nested under '1.1') or a whole "
    "page's entries were shifted one level too deep/shallow due to inconsistent indentation.\n\n"
    "### Rules:\n"
    "1. Do NOT add, remove, or reorder entries. Do NOT change 'title', 'page', or 'attribute' values.\n"
    "2. Fix only the 'children' nesting (and thus the depth) of entries.\n"
    "3. Keep every entry exactly once. A node with no children must keep 'children': [].\n"
    "4. If the structure is already correct, return the input unchanged.\n\n"
    "### Output Format:\n"
    "Return ONLY the corrected JSON array at the top level. No markdown blocks, no preamble, no explanations.\n"
    "Input ToC JSON:\n"
)


def correct_tree_levels(
    toc_data: list[dict[str, Any]],
    api_key: str,
    base_url: str,
    model: str,
) -> list[dict[str, Any]]:
    """Ask the LLM to fix obvious hierarchy errors in the assembled tree.

    The tree has already been rebuilt from per-page flat extraction with
    indent-based leveling; this pass repairs residual cross-page drift.
    Raises on any failure so callers can fall back to the assembled tree.
    """
    prompt = LEVEL_CORRECTION_PROMPT + json.dumps(toc_data, ensure_ascii=False)
    raw_response = request_llm_json(
        prompt=prompt,
        api_key=api_key,
        base_url=base_url,
        model=model,
    )
    parsed = json.loads(extract_json_text(raw_response))
    return validate_toc_json_structure(parsed)


def make_cache_file_path(
    input_pdf: Path,
    cache_dir: Path,
    toc_start: int,
    toc_end: int,
    dpi: int,
    model: str,
    mode: str,
    prompt: str,
) -> Path:
    stat = input_pdf.stat()
    key_data = {
        "input_pdf": str(input_pdf.resolve()),
        "pdf_size": stat.st_size,
        "pdf_mtime_ns": stat.st_mtime_ns,
        "toc_start": toc_start,
        "toc_end": toc_end,
        "dpi": dpi,
        "model": model,
        "mode": mode,
        "prompt": prompt,
    }
    digest = hashlib.sha256(
        json.dumps(key_data, ensure_ascii=True, sort_keys=True).encode("utf-8")
    ).hexdigest()
    return cache_dir / f"toc_{digest}.json"


def make_flat_pages_work_dir(
    input_pdf: Path,
    cache_dir: Path,
    toc_start: int,
    toc_end: int,
    dpi: int,
    model: str,
    prompt: str,
) -> Path:
    key_data = {
        "input_pdf": str(input_pdf.resolve()),
        "toc_start": toc_start,
        "toc_end": toc_end,
        "dpi": dpi,
        "model": model,
        "mode": "flat-pages",
        "prompt": prompt,
    }
    digest = hashlib.sha256(
        json.dumps(key_data, ensure_ascii=True, sort_keys=True).encode("utf-8")
    ).hexdigest()[:12]
    return cache_dir / f"flat_pages_{input_pdf.stem}_{digest}"


def find_matching_flat_raw_cache(
    cache_dir: Path,
    input_pdf: Path,
    toc_start: int,
    toc_end: int,
    model: str,
    dpi: int,
    prompt: str,
) -> Path | None:
    raw_files = sorted(cache_dir.glob("flat_raw_*.json"), reverse=True)
    input_pdf_resolved = str(input_pdf.resolve())

    for raw_file in raw_files:
        try:
            data = json.loads(raw_file.read_text(encoding="utf-8"))
        except Exception:
            continue

        if not isinstance(data, dict):
            continue

        if data.get("mode") != "flat":
            continue
        if data.get("toc_start") != toc_start or data.get("toc_end") != toc_end:
            continue
        if data.get("model") != model or data.get("dpi") != dpi:
            continue

        # Legacy records (created before prompts were configurable) have no
        # prompt field; they only match when the default prompt is requested.
        recorded_prompt = data.get("prompt")
        if recorded_prompt is None:
            if prompt != DEFAULT_FLAT_PROMPT:
                continue
        elif recorded_prompt != prompt:
            continue

        raw_pdf = data.get("input_pdf")
        if not isinstance(raw_pdf, str):
            continue

        same_pdf = False
        try:
            same_pdf = str(Path(raw_pdf).resolve()) == input_pdf_resolved
        except Exception:
            same_pdf = raw_pdf == str(input_pdf)

        if not same_pdf:
            continue

        pages = data.get("pages")
        if isinstance(pages, list) and pages:
            return raw_file

    return None


def extract_toc_json(
    input_pdf: Path,
    toc_start: int,
    toc_end: int,
    api_key: str,
    base_url: str,
    model: str,
    dpi: int,
    cache_dir: Path,
    overwrite_cache: bool,
    rescan: bool = False,
    rescan_pages: list[int] | None = None,
    prompt: str | None = None,
    on_page_rendered: Callable[[int, int], None] | None = None,
    on_flat_page_event: FlatPageEventCallback | None = None,
) -> tuple[list[dict[str, Any]], Path, bool, Path | None, dict[str, Any]]:
    extractor = FlatExtractor(
        toc_start=toc_start,
        toc_end=toc_end,
        prompt=prompt,
        pdf_name=input_pdf.stem,
    )
    rendered_prompt = extractor.build_prompt()

    stats: dict[str, Any] = {
        "vlm_calls": 0,
        "render_seconds": 0.0,
        "api_seconds": 0.0,
        "cache_pages": 0,
        "vlm_pages": 0,
    }

    cache_file = make_cache_file_path(
        input_pdf=input_pdf,
        cache_dir=cache_dir,
        toc_start=toc_start,
        toc_end=toc_end,
        dpi=dpi,
        model=model,
        mode=extractor.mode,
        prompt=rendered_prompt,
    )

    # Priority 1: final TOC cache.
    if cache_file.exists() and not overwrite_cache and not rescan:
        cached_data = json.loads(cache_file.read_text(encoding="utf-8"))
        validated_cached = validate_toc_json_structure(cached_data)
        pruned_cached = prune_null_page_nodes(validated_cached)
        return pruned_cached, cache_file, True, None, stats

    total_pages = toc_end - toc_start + 1
    work_dir = make_flat_pages_work_dir(
        input_pdf=input_pdf,
        cache_dir=cache_dir,
        toc_start=toc_start,
        toc_end=toc_end,
        dpi=dpi,
        model=model,
        prompt=rendered_prompt,
    )
    work_dir.mkdir(parents=True, exist_ok=True)

    rescan_set = set(rescan_pages or [])
    if any(page < 1 or page > total_pages for page in rescan_set):
        raise ValueError(f"Rescan page index out of range. Valid range: 1-{total_pages}")

    existing_page_files = list(work_dir.glob("page_*.json"))

    if not existing_page_files and not overwrite_cache and not rescan:
        fallback_raw = find_matching_flat_raw_cache(
            cache_dir=cache_dir,
            input_pdf=input_pdf,
            toc_start=toc_start,
            toc_end=toc_end,
            model=model,
            dpi=dpi,
            prompt=rendered_prompt,
        )
        if fallback_raw is not None:
            raw_data = json.loads(fallback_raw.read_text(encoding="utf-8"))
            raw_pages = raw_data.get("pages", [])
            if isinstance(raw_pages, list):
                for page_item in raw_pages:
                    if not isinstance(page_item, dict):
                        continue
                    page_no = page_item.get("page_call_index")
                    raw_json = page_item.get("raw_json")
                    if not isinstance(page_no, int) or page_no < 1 or page_no > total_pages:
                        continue
                    try:
                        validated_page_items = extractor._validate_flat_list(raw_json)
                    except Exception:
                        continue
                    (work_dir / f"page_{page_no}.json").write_text(
                        json.dumps(validated_page_items, ensure_ascii=False, indent=2),
                        encoding="utf-8",
                    )

            existing_page_files = list(work_dir.glob("page_*.json"))

    if rescan and not existing_page_files:
        raise ValueError(
            "No per-page cache found for --rescan. Run extract once without --rescan first."
        )

    # Priority 2: per-page flat cache (with optional partial rescan update).
    page_items_collected: list[list[dict[str, Any]]] = []
    vlm_called = False
    with fitz.open(input_pdf) as doc:
        if toc_end >= doc.page_count:
            raise ValueError(f"TOC end index {toc_end} out of range (page_count={doc.page_count})")

        for page_call_index in range(1, total_pages + 1):
            pdf_page_index = toc_start + page_call_index - 1
            page_cache_file = work_dir / f"page_{page_call_index}.json"

            should_scan = overwrite_cache
            if rescan and page_call_index in rescan_set:
                should_scan = True
            if not page_cache_file.exists():
                should_scan = True

            if should_scan:
                vlm_called = True
                stats["vlm_pages"] += 1

                if on_flat_page_event is not None:
                    on_flat_page_event(
                        page_call_index,
                        total_pages,
                        "VLM",
                        "rendering",
                        None,
                        None,
                    )

                render_start = datetime.now().timestamp()
                rendered_page = render_pdf_page_image(input_pdf, pdf_page_index + 1, dpi)
                data_url = str(rendered_page["data_url"])
                render_elapsed = datetime.now().timestamp() - render_start
                stats["render_seconds"] += render_elapsed

                if on_flat_page_event is not None:
                    on_flat_page_event(
                        page_call_index,
                        total_pages,
                        "VLM",
                        "rendering",
                        None,
                        render_elapsed,
                    )

                if on_flat_page_event is not None:
                    on_flat_page_event(
                        page_call_index,
                        total_pages,
                        "VLM",
                        "scanning",
                        None,
                        None,
                    )

                api_start = datetime.now().timestamp()

                page_flat_items = extractor.extract_single_page_flat(
                    image_data_url=data_url,
                    api_key=api_key,
                    base_url=base_url,
                    model=model,
                )
                api_elapsed = datetime.now().timestamp() - api_start
                stats["api_seconds"] += api_elapsed
                stats["vlm_calls"] += 1

                if on_flat_page_event is not None:
                    on_flat_page_event(
                        page_call_index,
                        total_pages,
                        "VLM",
                        "scanning",
                        len(page_flat_items),
                        api_elapsed,
                    )

                page_cache_file.write_text(
                    json.dumps(page_flat_items, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )

                if on_flat_page_event is not None:
                    on_flat_page_event(
                        page_call_index,
                        total_pages,
                        "VLM",
                        "success",
                        len(page_flat_items),
                        None,
                    )
            else:
                stats["cache_pages"] += 1
                cache_start = datetime.now().timestamp()
                page_flat_items = extractor._validate_flat_list(
                    json.loads(page_cache_file.read_text(encoding="utf-8"))
                )
                cache_elapsed = datetime.now().timestamp() - cache_start
                if on_flat_page_event is not None:
                    on_flat_page_event(
                        page_call_index,
                        total_pages,
                        "CACHE",
                        "cache_loaded",
                        len(page_flat_items),
                        cache_elapsed,
                    )

            if on_page_rendered is not None:
                on_page_rendered(page_call_index, total_pages)

            page_items_collected.append(page_flat_items)

    rebuilt = extractor.rebuild_from_page_items(page_items_collected)
    pruned_rebuilt = prune_null_page_nodes(rebuilt)

    try:
        corrected = correct_tree_levels(
            pruned_rebuilt,
            api_key=api_key,
            base_url=base_url,
            model=model,
        )
        corrected = prune_null_page_nodes(corrected)
        stats["level_correction"] = "applied"
    except Exception:
        corrected = pruned_rebuilt
        stats["level_correction"] = "failed"

    cache_file.parent.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(
        json.dumps(corrected, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    raw_cache_file = cache_dir / f"flat_raw_{timestamp}.json"
    raw_cache_file.write_text(
        json.dumps(
            {
                "mode": "flat",
                "input_pdf": str(input_pdf),
                "toc_start": toc_start,
                "toc_end": toc_end,
                "model": model,
                "dpi": dpi,
                "prompt": rendered_prompt,
                "work_dir": str(work_dir),
                "pages": [
                    {
                        "page_call_index": i,
                        "raw_json": page_items_collected[i - 1],
                    }
                    for i in range(1, total_pages + 1)
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    loaded_from_cache = not vlm_called
    return corrected, cache_file, loaded_from_cache, raw_cache_file, stats
