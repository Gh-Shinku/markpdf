from __future__ import annotations

import pytest

from bookmark_server.core import (
    flatten_to_pymupdf_toc,
    inject_toc_page_bookmark,
    parse_toc_items,
    validate_toc_json_structure,
)


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


def test_inject_toc_page_bookmark_prepends_absolute_bookmark() -> None:
    toc_data = [
        {"title": "Chapter 1", "page": 1, "attribute": "relative", "children": []},
    ]
    injected = inject_toc_page_bookmark(toc_data, toc_start=3, page_count=10)
    assert injected[0] == {
        "title": "Contents",
        "page": 3,
        "attribute": "absolute",
        "children": [],
    }
    assert injected[1:] == toc_data
    # 原列表不被修改
    assert toc_data[0]["title"] == "Chapter 1"


def test_inject_toc_page_bookmark_uses_cjk_title_for_chinese_toc() -> None:
    toc_data = [
        {"title": "第一章", "page": 1, "attribute": "relative", "children": []},
        {"title": "1.1 小节", "page": 2, "attribute": "relative", "children": []},
    ]
    injected = inject_toc_page_bookmark(toc_data, toc_start=3, page_count=10)
    assert injected[0]["title"] == "目录"


def test_inject_toc_page_bookmark_uses_latin_title_for_mixed_latin_toc() -> None:
    # 拉丁字符占多数时使用 Contents
    toc_data = [
        {"title": "Chapter 1", "page": 1, "attribute": "relative", "children": []},
        {"title": "2 附录", "page": 2, "attribute": "relative", "children": []},
    ]
    injected = inject_toc_page_bookmark(toc_data, toc_start=3, page_count=10)
    assert injected[0]["title"] == "Contents"


def test_inject_toc_page_bookmark_skips_out_of_range() -> None:
    toc_data = [{"title": "A", "page": 1, "attribute": "relative", "children": []}]
    assert inject_toc_page_bookmark(toc_data, toc_start=0, page_count=10) == toc_data
    assert inject_toc_page_bookmark(toc_data, toc_start=11, page_count=10) == toc_data


def test_inject_toc_page_bookmark_is_idempotent() -> None:
    toc_data = [
        {"title": "目录", "page": 3, "attribute": "absolute", "children": []},
        {"title": "Chapter 1", "page": 1, "attribute": "relative", "children": []},
    ]
    injected = inject_toc_page_bookmark(toc_data, toc_start=3, page_count=10)
    assert injected == toc_data


def test_inject_toc_page_bookmark_skips_when_contents_already_present() -> None:
    toc_data = [
        {"title": "Contents", "page": 3, "attribute": "absolute", "children": []},
        {"title": "Chapter 1", "page": 1, "attribute": "relative", "children": []},
    ]
    injected = inject_toc_page_bookmark(toc_data, toc_start=3, page_count=10)
    assert injected == toc_data
