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
            "attribute": "relative",
            "children": [
                {
                    "title": "Section 1.1",
                    "page": 3,
                    "attribute": "relative",
                    "children": [],
                },
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
        ([{"title": "A", "page": 0, "children": []}], "Invalid page"),
        ([{"title": "A", "page": 1, "attribute": "pdf", "children": []}], "Invalid attribute"),
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
        [1, "Chapter 1", 3],
        [2, "Section 1.1", 5],
    ]


def test_flatten_to_pymupdf_toc_uses_absolute_page_without_offset() -> None:
    items = parse_toc_items(
        [
            {"title": "Contents", "page": 2, "attribute": "absolute", "children": []},
            {"title": "Chapter 1", "page": 1, "attribute": "relative", "children": []},
        ]
    )

    assert flatten_to_pymupdf_toc(items, page_offset=4, pdf_page_count=10) == [
        [1, "Contents", 2],
        [1, "Chapter 1", 5],
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
        [1, "Part I", 4],
        [2, "Chapter 1", 4],
    ]


def test_flatten_to_pymupdf_toc_resolves_null_page_attribute_from_child() -> None:
    items = parse_toc_items(
        [
            {
                "title": "Front Matter",
                "page": None,
                "children": [
                    {
                        "title": "Contents",
                        "page": 2,
                        "attribute": "absolute",
                        "children": [],
                    },
                ],
            }
        ]
    )

    assert flatten_to_pymupdf_toc(items, page_offset=4, pdf_page_count=10) == [
        [1, "Front Matter", 2],
        [2, "Contents", 2],
    ]


def test_flatten_to_pymupdf_toc_resolves_null_page_from_next_sibling() -> None:
    items = parse_toc_items(
        [
            {"title": "Part I", "page": None, "children": []},
            {"title": "Contents", "page": 4, "attribute": "absolute", "children": []},
        ]
    )

    assert flatten_to_pymupdf_toc(items, page_offset=3, pdf_page_count=10) == [
        [1, "Part I", 4],
        [1, "Contents", 4],
    ]


def test_flatten_to_pymupdf_toc_rejects_out_of_range_relative_page() -> None:
    items = parse_toc_items(
        [{"title": "Chapter 1", "page": 11, "children": []}]
    )

    with pytest.raises(ValueError, match="out of range"):
        flatten_to_pymupdf_toc(items, page_offset=0, pdf_page_count=10)


def test_flatten_to_pymupdf_toc_rejects_out_of_range_absolute_page() -> None:
    items = parse_toc_items(
        [{"title": "Contents", "page": 11, "attribute": "absolute", "children": []}]
    )

    with pytest.raises(ValueError, match="attribute=absolute"):
        flatten_to_pymupdf_toc(items, page_offset=-8, pdf_page_count=10)
