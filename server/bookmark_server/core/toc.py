from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

PAGE_ATTRIBUTE_RELATIVE = "relative"
PAGE_ATTRIBUTE_ABSOLUTE = "absolute"
VALID_PAGE_ATTRIBUTES = {PAGE_ATTRIBUTE_RELATIVE, PAGE_ATTRIBUTE_ABSOLUTE}


@dataclass
class TocItem:
    title: str
    book_page: int | None
    page_attribute: str
    children: list["TocItem"]


@dataclass
class PageTarget:
    page: int
    attribute: str


def parse_toc_items(data: Any) -> list[TocItem]:
    if not isinstance(data, list):
        raise ValueError("Top-level JSON must be an array")

    def parse_node(node: Any) -> TocItem:
        if not isinstance(node, dict):
            raise ValueError("Each TOC node must be an object")

        title = node.get("title")
        page = node.get("page")
        attribute = node.get("attribute", PAGE_ATTRIBUTE_RELATIVE)
        children = node.get("children")

        if not isinstance(title, str) or not title.strip():
            raise ValueError(f"Invalid title in node: {node!r}")
        if page is not None and (not isinstance(page, int) or page < 1):
            raise ValueError(f"Invalid page in node: {node!r}")
        if attribute not in VALID_PAGE_ATTRIBUTES:
            raise ValueError(f"Invalid attribute in node: {node!r}")
        if not isinstance(children, list):
            raise ValueError(f"Invalid children in node: {node!r}")

        return TocItem(
            title=title.strip(),
            book_page=page,
            page_attribute=attribute,
            children=[parse_node(child) for child in children],
        )

    return [parse_node(item) for item in data]


def validate_toc_json_structure(data: Any) -> list[dict[str, Any]]:
    items = parse_toc_items(data)

    def to_dict(item: TocItem) -> dict[str, Any]:
        return {
            "title": item.title,
            "page": item.book_page,
            "attribute": item.page_attribute,
            "children": [to_dict(child) for child in item.children],
        }

    return [to_dict(item) for item in items]


def load_toc_json_file(toc_json_path: Path) -> list[dict[str, Any]]:
    data = json.loads(toc_json_path.read_text(encoding="utf-8"))
    return validate_toc_json_structure(data)


def flatten_to_pymupdf_toc(
    items: list[TocItem],
    page_offset: int,
    pdf_page_count: int,
) -> list[list[Any]]:
    toc: list[list[Any]] = []

    def resolve_node_page_target(node: TocItem) -> PageTarget | None:
        if node.book_page is not None:
            return PageTarget(page=node.book_page, attribute=node.page_attribute)
        for child in node.children:
            child_target = resolve_node_page_target(child)
            if child_target is not None:
                return child_target
        return None

    def resolve_next_sibling_page_target(
        nodes: list[TocItem],
        start_index: int,
    ) -> PageTarget | None:
        for next_node in nodes[start_index + 1 :]:
            next_target = resolve_node_page_target(next_node)
            if next_target is not None:
                return next_target
        return None

    def convert_to_pdf_index(target: PageTarget) -> int:
        if target.attribute == PAGE_ATTRIBUTE_ABSOLUTE:
            return target.page - 1
        return target.page + page_offset - 1

    def walk(nodes: list[TocItem], level: int) -> None:
        for index, node in enumerate(nodes):
            resolved_target = resolve_node_page_target(node)
            if resolved_target is None:
                # Heading-like nodes without parsed children use the first
                # resolvable page from a following sibling.
                resolved_target = resolve_next_sibling_page_target(nodes, index)
            if resolved_target is None:
                raise ValueError(
                    "Cannot resolve page for node (missing page and descendants): "
                    f"{node.title!r}"
                )

            pdf_index = convert_to_pdf_index(resolved_target)
            if pdf_index < 0 or pdf_index >= pdf_page_count:
                raise ValueError(
                    "Converted PDF page index out of range for node "
                    f"{node.title!r}: page={resolved_target.page}, "
                    f"attribute={resolved_target.attribute}, offset={page_offset}, "
                    f"pdf_index={pdf_index}, page_count={pdf_page_count}"
                )

            toc.append([level, node.title, pdf_index + 1])
            walk(node.children, level + 1)

    walk(items, level=1)
    return toc
