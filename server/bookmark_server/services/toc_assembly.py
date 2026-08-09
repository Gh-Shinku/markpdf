from __future__ import annotations

import json
import re
from typing import Any


_ROMAN_RE = re.compile(
    r"^(?=[MDCLXVI])M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$",
    re.IGNORECASE,
)


def prune_null_page_nodes(toc_data: list[dict[str, Any]]) -> list[dict[str, Any]]:
    def walk(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
        pruned: list[dict[str, Any]] = []
        for node in nodes:
            children = walk(node.get("children", []))
            page = node.get("page")
            if page is None:
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
                previous_index = previous.get("_page_index")
                if previous_index is not None and item.get("_page_index") != previous_index:
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
        ancestors: list[tuple[int, int]] = []
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


def parse_flat_page(page: int | str | None) -> tuple[int | None, bool]:
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
