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

from .writer import validate_toc_json_structure


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
            "你是一个严谨的目录提取助手。"
            f"这些图像对应 PDF 索引范围 [{self.toc_start}, {self.toc_end}] 的目录页。"
            "请提取完整目录树并返回严格 JSON。"
            "JSON 顶层必须是数组，节点结构必须为："
            '{"title": "章节标题", "page": 整数或null, "children": [...]}。'
            "要求："
            "1) page 使用书本真实页码，不是 PDF 索引；"
            "2) children 必须始终存在；"
            "3) 保留原始层级与顺序；"
            "4) 仅输出 JSON，不要输出 markdown 或解释。"
        )

    def parse_response(self, raw_text: str) -> list[dict[str, Any]]:
        json_text = extract_json_text(raw_text)
        parsed = json.loads(json_text)
        return validate_toc_json_structure(parsed)


class FlatExtractor(BaseExtractor):
    def __init__(self, toc_start: int, toc_end: int) -> None:
        super().__init__(toc_start=toc_start, toc_end=toc_end)
        self.assembler = TOCAssembler()
        self.raw_page_outputs: list[dict[str, Any]] = []

    @property
    def mode(self) -> str:
        return "flat"

    def build_prompt(self) -> str:
        return (
            "你是目录OCR助手。"
            "你只做当前目录页图像的条目提取，不做层级推理，不跨页合并。"
            "输出必须是一个扁平 JSON 数组，格式为："
            '[{"text": "1.1 章节名", "page": 10}, ...]。'
            "规则："
            "1) 每个条目尽量完整；"
            "2) page 使用书本真实页码，可为 null；"
            "3) 严禁输出嵌套结构；"
            "4) 忽略页眉页脚信息；"
            "5) 严禁输出 markdown、解释和多余文本，只输出 JSON。"
        )

    def parse_response(self, raw_text: str) -> list[dict[str, Any]]:
        json_text = extract_json_text(raw_text)
        parsed = json.loads(json_text)
        flat_list = self._validate_flat_list(parsed)
        assembled_tree = self.assembler.assemble(flat_list)
        return validate_toc_json_structure(assembled_tree)

    def extract_from_images(
        self,
        image_data_urls: list[str],
        api_key: str,
        base_url: str,
        model: str,
    ) -> list[dict[str, Any]]:
        self.raw_page_outputs = []
        merged_flat_items: list[dict[str, Any]] = []
        for page_no, data_url in enumerate(image_data_urls, start=1):
            raw_response = request_toc_from_vlm(
                image_data_urls=[data_url],
                prompt=self.build_prompt(),
                api_key=api_key,
                base_url=base_url,
                model=model,
            )
            json_text = extract_json_text(raw_response)
            parsed = json.loads(json_text)
            self.raw_page_outputs.append(
                {
                    "page_call_index": page_no,
                    "raw_json": parsed,
                }
            )
            page_flat_items = self._validate_flat_list(parsed)
            merged_flat_items.extend(page_flat_items)

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
    on_page_rendered: Callable[[int, int], None] | None = None,
) -> tuple[list[dict[str, Any]], Path, bool, Path | None]:
    extractor = _build_extractor(mode=mode, toc_start=toc_start, toc_end=toc_end)

    cache_file = make_cache_file_path(
        input_pdf=input_pdf,
        cache_dir=cache_dir,
        toc_start=toc_start,
        toc_end=toc_end,
        dpi=dpi,
        model=model,
        mode=extractor.mode,
    )

    if cache_file.exists() and not overwrite_cache:
        cached_data = json.loads(cache_file.read_text(encoding="utf-8"))
        validated_cached = validate_toc_json_structure(cached_data)
        pruned_cached = prune_null_page_nodes(validated_cached)
        return pruned_cached, cache_file, True, None

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

    raw_cache_file: Path | None = None
    if mode == "flat" and isinstance(extractor, FlatExtractor):
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
                    "pages": extractor.raw_page_outputs,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    cache_file.parent.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(json.dumps(pruned, ensure_ascii=False, indent=2), encoding="utf-8")

    return pruned, cache_file, False, raw_cache_file
