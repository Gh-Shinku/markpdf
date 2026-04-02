from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import fitz


@dataclass
class TocItem:
    title: str
    book_page: int | None
    children: list["TocItem"]


def _parse_toc_items(data: Any) -> list[TocItem]:
    if not isinstance(data, list):
        raise ValueError("Top-level JSON must be an array")

    def parse_node(node: Any) -> TocItem:
        if not isinstance(node, dict):
            raise ValueError("Each TOC node must be an object")

        title = node.get("title")
        page = node.get("page")
        children = node.get("children")

        if not isinstance(title, str) or not title.strip():
            raise ValueError(f"Invalid title in node: {node!r}")
        if page is not None and not isinstance(page, int):
            raise ValueError(f"Invalid page in node: {node!r}")
        if not isinstance(children, list):
            raise ValueError(f"Invalid children in node: {node!r}")

        return TocItem(
            title=title.strip(),
            book_page=page,
            children=[parse_node(child) for child in children],
        )

    return [parse_node(item) for item in data]


def validate_toc_json_structure(data: Any) -> list[dict[str, Any]]:
    items = _parse_toc_items(data)

    def to_dict(item: TocItem) -> dict[str, Any]:
        return {
            "title": item.title,
            "page": item.book_page,
            "children": [to_dict(child) for child in item.children],
        }

    return [to_dict(item) for item in items]


def load_toc_json_file(toc_json_path: Path) -> list[dict[str, Any]]:
    data = json.loads(toc_json_path.read_text(encoding="utf-8"))
    return validate_toc_json_structure(data)


def _flatten_to_pymupdf_toc(
    items: list[TocItem],
    page_offset: int,
    pdf_page_count: int,
) -> list[list[Any]]:
    toc: list[list[Any]] = []

    def resolve_node_book_page(node: TocItem) -> int | None:
        if node.book_page is not None:
            return node.book_page
        for child in node.children:
            child_page = resolve_node_book_page(child)
            if child_page is not None:
                return child_page
        return None

    def resolve_next_sibling_book_page(nodes: list[TocItem], start_index: int) -> int | None:
        for next_node in nodes[start_index + 1 :]:
            next_page = resolve_node_book_page(next_node)
            if next_page is not None:
                return next_page
        return None

    def walk(nodes: list[TocItem], level: int) -> None:
        for index, node in enumerate(nodes):
            resolved_book_page = resolve_node_book_page(node)
            if resolved_book_page is None:
                # Fallback: for heading-like nodes (e.g. Part I/II) that have
                # no page and no parsed children, use the first page from
                # following sibling nodes.
                resolved_book_page = resolve_next_sibling_book_page(nodes, index)
            if resolved_book_page is None:
                raise ValueError(
                    "Cannot resolve page for node (missing page and descendants): "
                    f"{node.title!r}"
                )

            pdf_index = resolved_book_page + page_offset
            if pdf_index < 0 or pdf_index >= pdf_page_count:
                raise ValueError(
                    "Converted PDF page index out of range for node "
                    f"{node.title!r}: book_page={resolved_book_page}, "
                    f"offset={page_offset}, pdf_index={pdf_index}, page_count={pdf_page_count}"
                )

            toc.append([level, node.title, pdf_index + 1])
            walk(node.children, level + 1)

    walk(items, level=1)
    return toc


def apply_toc_to_pdf(
    input_pdf: Path,
    output_pdf: Path,
    toc_data: list[dict[str, Any]],
    page_offset: int,
) -> int:
    items = _parse_toc_items(toc_data)
    with fitz.open(input_pdf) as doc:
        toc = _flatten_to_pymupdf_toc(
            items=items,
            page_offset=page_offset,
            pdf_page_count=doc.page_count,
        )
        doc.set_toc(toc)
        output_pdf.parent.mkdir(parents=True, exist_ok=True)
        doc.save(output_pdf)
    return len(toc)