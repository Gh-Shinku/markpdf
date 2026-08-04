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

from .core import validate_toc_json_structure


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
                    "children": children,
                }
            )
        return pruned

    return walk(toc_data)


def render_pages_as_data_urls(
    pdf: fitz.Document,
    start: int,
    end: int,
    dpi: int,
    on_page_rendered: Callable[[int, int], None] | None = None,
) -> list[str]:
    data_urls: list[str] = []
    zoom = dpi / 72.0
    matrix = fitz.Matrix(zoom, zoom)
    total_pages = end - start + 1

    for i, page_index in enumerate(range(start, end + 1), start=1):
        page = pdf.load_page(page_index)
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        image_bytes = pix.tobytes("png")
        b64 = base64.b64encode(image_bytes).decode("ascii")
        data_urls.append(f"data:image/png;base64,{b64}")
        if on_page_rendered is not None:
            on_page_rendered(i, total_pages)

    return data_urls


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

    raise ValueError("VLM response does not include readable text content")


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
        return self._build_tree(enriched)

    def _heal_cross_page(self, flat_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        healed: list[dict[str, Any]] = []
        for item in flat_items:
            text = str(item.get("text", "")).strip()
            page = item.get("page")
            if not text:
                continue

            if page is None and healed:
                previous_text = healed[-1]["text"]
                healed[-1]["text"] = f"{previous_text}{text}"
                continue

            healed.append({"text": text, "page": page})

        return healed

    def _detect_level(self, text: str, previous_level: int) -> int:
        match = self._numbering_re.match(text)
        if match:
            numbering = match.group(1).rstrip(".")
            segments = [segment for segment in numbering.split(".") if segment]
            return max(1, len(segments))

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
        previous_level = 1
        for item in flat_items:
            level = self._detect_level(item["text"], previous_level=previous_level)
            previous_level = level
            enriched.append(
                {
                    "title": item["text"],
                    "page": item["page"],
                    "children": [],
                    "_level": level,
                }
            )
        return enriched

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
    def __init__(self, toc_start: int, toc_end: int) -> None:
        self.toc_start = toc_start
        self.toc_end = toc_end

    @property
    @abstractmethod
    def mode(self) -> str:
        raise NotImplementedError

    @abstractmethod
    def build_prompt(self) -> str:
        raise NotImplementedError

    @abstractmethod
    def parse_response(self, raw_text: str) -> list[dict[str, Any]]:
        raise NotImplementedError

    def extract_from_images(
        self,
        image_data_urls: list[str],
        api_key: str,
        base_url: str,
        model: str,
    ) -> list[dict[str, Any]]:
        raw_response = request_toc_from_vlm(
            image_data_urls=image_data_urls,
            prompt=self.build_prompt(),
            api_key=api_key,
            base_url=base_url,
            model=model,
        )
        return self.parse_response(raw_response)


class TreeExtractor(BaseExtractor):
    @property
    def mode(self) -> str:
        return "tree"

    def build_prompt(self) -> str:
        return (
            "Role: You are a professional Document Digitization Specialist.\n"
            "Task: Extract the Table of Contents (ToC) from the provided images into a structured JSON tree.\n"
            f"Context: These images cover the ToC from book pages {self.toc_start} to {self.toc_end}.\n\n"
            "### Extraction Rules:\n"
            "1. **Hierarchical Logic**: Determine levels based on indentation, font size, and numbering (e.g., 1.1 is a child of 1).\n"
            "2. **Content**: Extract the exact title text. Do not include leading dots (......) or filler characters.\n"
            "3. **Page Numbers**: Use the printed page numbers shown in the image. Set to null if not visible.\n"
            "4. **Completeness**: Every single entry visible in the images must be included. Do not summarize.\n"
            "5. **Empty Children**: The 'children' key must be an empty list [] if no sub-items exist.\n\n"
            "### Output Format (Strict JSON):\n"
            "Return ONLY a valid JSON array at the top level. No markdown blocks, no preamble, no explanations.\n"
            "Example Structure:\n"
            "[\n"
            '  {"title": "Chapter 1", "page": 1, "children": [\n'
            '    {"title": "1.1 Sub-section", "page": 2, "children": []}\n'
            "  ]}\n"
            "]"
        )

    def parse_response(self, raw_text: str) -> list[dict[str, Any]]:
        json_text = extract_json_text(raw_text)
        parsed = json.loads(json_text)
        return validate_toc_json_structure(parsed)


class FlatExtractor(BaseExtractor):
    def __init__(self, toc_start: int, toc_end: int) -> None:
        super().__init__(toc_start=toc_start, toc_end=toc_end)
        self.assembler = TOCAssembler()

    @property
    def mode(self) -> str:
        return "flat"

    def build_prompt(self) -> str:
        return (
            "Role: You are a high-precision OCR Data Entry Clerk.\n"
            "Task: Extract ToC entries from the current page as a FLAT list of items.\n\n"
            "### Specific Rules:\n"
            "1. **Flat Output**: Do NOT nest items. Every entry must be a direct element of the root array.\n"
            "2. **Text Cleaning**: \n"
            "   - Merge multi-line titles into a single string.\n"
            "   - Remove leader dots (e.g., 'Chapter 1.......10' becomes text:'Chapter 1', page:10).\n"
            "3. **Page Range**: Only process the content visible on THIS page. Do not guess what's on the next page.\n"
            "4. **Filtering**: Ignore headers, footers, and decorative elements.\n"
            "5. **Verbatim**: Keep the original numbering (e.g., '1.2.3', 'Appendix A') within the 'text' field.\n\n"
            "### Output Format:\n"
            "Return ONLY a JSON array. No markdown, no conversational text.\n"
            'Schema: [{"text": "Full Title String", "page": integer_or_null}, ...]'
        )
    
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

        for item in flat_items:
            page = item.get("page")

            if page is not None and last_page is not None and page < last_page:
                # Drop abnormal entries (typically header/footer OCR noise)
                # when page sequence breaks non-decreasing monotonicity.
                continue

            filtered.append(item)
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
        for page_items in page_flat_items:
            merged_flat_items.extend(page_items)

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

            if not isinstance(text, str) or not text.strip():
                raise ValueError(f"Invalid text in flat node: {node!r}")
            if page is not None and not isinstance(page, int):
                raise ValueError(f"Invalid page in flat node: {node!r}")

            validated.append({"text": text.strip(), "page": page})

        return validated


def make_cache_file_path(
    input_pdf: Path,
    cache_dir: Path,
    toc_start: int,
    toc_end: int,
    dpi: int,
    model: str,
    mode: str,
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
) -> Path:
    key_data = {
        "input_pdf": str(input_pdf.resolve()),
        "toc_start": toc_start,
        "toc_end": toc_end,
        "dpi": dpi,
        "model": model,
        "mode": "flat-pages",
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


def _build_extractor(mode: str, toc_start: int, toc_end: int) -> BaseExtractor:
    if mode == "tree":
        return TreeExtractor(toc_start=toc_start, toc_end=toc_end)
    if mode == "flat":
        return FlatExtractor(toc_start=toc_start, toc_end=toc_end)
    raise ValueError(f"Unsupported extraction mode: {mode}")


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
    mode: str,
    rescan: bool = False,
    rescan_pages: list[int] | None = None,
    on_page_rendered: Callable[[int, int], None] | None = None,
    on_flat_page_event: FlatPageEventCallback | None = None,
) -> tuple[list[dict[str, Any]], Path, bool, Path | None, dict[str, Any]]:
    extractor = _build_extractor(mode=mode, toc_start=toc_start, toc_end=toc_end)

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
    )

    # Priority 1: final TOC cache.
    if cache_file.exists() and not overwrite_cache and not rescan:
        cached_data = json.loads(cache_file.read_text(encoding="utf-8"))
        validated_cached = validate_toc_json_structure(cached_data)
        pruned_cached = prune_null_page_nodes(validated_cached)
        return pruned_cached, cache_file, True, None, stats

    if mode == "flat" and isinstance(extractor, FlatExtractor):
        total_pages = toc_end - toc_start + 1
        work_dir = make_flat_pages_work_dir(
            input_pdf=input_pdf,
            cache_dir=cache_dir,
            toc_start=toc_start,
            toc_end=toc_end,
            dpi=dpi,
            model=model,
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
                    page = doc.load_page(pdf_page_index)
                    zoom = dpi / 72.0
                    matrix = fitz.Matrix(zoom, zoom)
                    pix = page.get_pixmap(matrix=matrix, alpha=False)
                    image_bytes = pix.tobytes("png")
                    b64 = base64.b64encode(image_bytes).decode("ascii")
                    data_url = f"data:image/png;base64,{b64}"
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

        cache_file.parent.mkdir(parents=True, exist_ok=True)
        cache_file.write_text(
            json.dumps(pruned_rebuilt, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        raw_cache_file = cache_dir / f"flat_raw_{timestamp}.json"
        raw_cache_file.write_text(
            json.dumps(
                {
                    "mode": mode,
                    "input_pdf": str(input_pdf),
                    "toc_start": toc_start,
                    "toc_end": toc_end,
                    "model": model,
                    "dpi": dpi,
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
        return pruned_rebuilt, cache_file, loaded_from_cache, raw_cache_file, stats

    # Priority 3: direct VLM call (tree mode).
    with fitz.open(input_pdf) as doc:
        if toc_end >= doc.page_count:
            raise ValueError(f"TOC end index {toc_end} out of range (page_count={doc.page_count})")

        image_data_urls = render_pages_as_data_urls(
            pdf=doc,
            start=toc_start,
            end=toc_end,
            dpi=dpi,
            on_page_rendered=on_page_rendered,
        )

    validated = extractor.extract_from_images(
        image_data_urls=image_data_urls,
        api_key=api_key,
        base_url=base_url,
        model=model,
    )

    pruned = prune_null_page_nodes(validated)
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(json.dumps(pruned, ensure_ascii=False, indent=2), encoding="utf-8")
    return pruned, cache_file, False, None, stats
