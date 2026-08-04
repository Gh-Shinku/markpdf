from __future__ import annotations

import fitz

from bookmark.core import apply_toc_to_pdf


def test_apply_toc_to_pdf_writes_bookmarks(tmp_path) -> None:
    input_pdf = tmp_path / "input.pdf"
    output_pdf = tmp_path / "nested" / "output.pdf"

    doc = fitz.open()
    for _ in range(4):
        doc.new_page()
    doc.save(input_pdf)
    doc.close()

    bookmark_count = apply_toc_to_pdf(
        input_pdf=input_pdf,
        output_pdf=output_pdf,
        toc_data=[
            {
                "title": "Contents",
                "page": 1,
                "attribute": "absolute",
                "children": [],
            },
            {
                "title": "Chapter 1",
                "page": 0,
                "attribute": "relative",
                "children": [
                    {
                        "title": "Section 1.1",
                        "page": 2,
                        "attribute": "relative",
                        "children": [],
                    },
                ],
            }
        ],
        page_offset=1,
    )

    assert bookmark_count == 3
    with fitz.open(output_pdf) as output_doc:
        assert output_doc.get_toc() == [
            [1, "Contents", 1],
            [1, "Chapter 1", 2],
            [2, "Section 1.1", 4],
        ]
