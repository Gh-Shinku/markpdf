from __future__ import annotations

import pytest

from bookmark.core import flatten_to_pymupdf_toc, parse_toc_items, validate_toc_json_structure


def test_validate_toc_json_structure_normalizes_nested_items() -> None:
    data = [
        {
            "title": "  Chapter 1  ",
            "page": 1,
            "children": [
                {"title": "Section 1.1", "page": 3, "children": []},
            ],
        }
    ]

    assert validate_toc_json_structure(data) == [
        {
            "title": "Chapter 1",
            "page": 1,
            "children": [
                {"title": "Section 1.1", "page": 3, "children": []},
            ],
        }
    ]


@pytest.mark.parametrize(
    ("data", "message"),
    [
        ({}, "Top-level JSON must be an array"),
        ([[]], "Each TOC node must be an object"),
        ([{"title": " ", "page": 1, "children": []}], "Invalid title"),
        ([{"title": "A", "page": "1", "children": []}], "Invalid page"),
        ([{"title": "A", "page": 1}], "Invalid children"),
    ],
)
def test_validate_toc_json_structure_rejects_invalid_shapes(
    data: object,
    message: str,
) -> None:
    with pytest.raises(ValueError, match=message):
        validate_toc_json_structure(data)


def test_flatten_to_pymupdf_toc_preserves_levels_and_converts_pages() -> None:
    items = parse_toc_items(
        [
            {
                "title": "Chapter 1",
                "page": 1,
                "children": [
                    {"title": "Section 1.1", "page": 3, "children": []},
                ],
            }
        ]
    )

    assert flatten_to_pymupdf_toc(items, page_offset=2, pdf_page_count=10) == [
        [1, "Chapter 1", 4],
        [2, "Section 1.1", 6],
    ]


def test_flatten_to_pymupdf_toc_resolves_null_page_from_child() -> None:
    items = parse_toc_items(
        [
            {
                "title": "Part I",
                "page": None,
                "children": [
                    {"title": "Chapter 1", "page": 4, "children": []},
                ],
            }
        ]
    )

    assert flatten_to_pymupdf_toc(items, page_offset=0, pdf_page_count=10) == [
        [1, "Part I", 5],
        [2, "Chapter 1", 5],
    ]


def test_flatten_to_pymupdf_toc_resolves_null_page_from_next_sibling() -> None:
    items = parse_toc_items(
        [
            {"title": "Part I", "page": None, "children": []},
            {"title": "Chapter 1", "page": 4, "children": []},
        ]
    )

    assert flatten_to_pymupdf_toc(items, page_offset=0, pdf_page_count=10) == [
        [1, "Part I", 5],
        [1, "Chapter 1", 5],
    ]


def test_flatten_to_pymupdf_toc_rejects_out_of_range_page() -> None:
    items = parse_toc_items(
        [{"title": "Chapter 1", "page": 10, "children": []}]
    )

    with pytest.raises(ValueError, match="out of range"):
        flatten_to_pymupdf_toc(items, page_offset=0, pdf_page_count=10)
