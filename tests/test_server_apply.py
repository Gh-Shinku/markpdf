from __future__ import annotations

import json

import fitz
from fastapi.testclient import TestClient

from server.bookmark_server.main import app


client = TestClient(app)


def _make_pdf(path, page_count: int = 4) -> None:
    doc = fitz.open()
    for _ in range(page_count):
        doc.new_page()
    doc.save(path)
    doc.close()


def test_health() -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_apply_returns_bookmarked_pdf(tmp_path) -> None:
    input_pdf = tmp_path / "input.pdf"
    _make_pdf(input_pdf)
    toc_json = [
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
    ]

    response = client.post(
        "/api/apply",
        data={"page_offset": "1"},
        files={
            "pdf": ("input.pdf", input_pdf.read_bytes(), "application/pdf"),
            "toc_json": (
                "toc.json",
                json.dumps(toc_json).encode("utf-8"),
                "application/json",
            ),
        },
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"

    output_pdf = tmp_path / "output.pdf"
    output_pdf.write_bytes(response.content)
    with fitz.open(output_pdf) as doc:
        assert doc.get_toc() == [
            [1, "Contents", 1],
            [1, "Chapter 1", 2],
            [2, "Section 1.1", 4],
        ]


def test_apply_rejects_invalid_json(tmp_path) -> None:
    input_pdf = tmp_path / "input.pdf"
    _make_pdf(input_pdf)

    response = client.post(
        "/api/apply",
        data={"page_offset": "0"},
        files={
            "pdf": ("input.pdf", input_pdf.read_bytes(), "application/pdf"),
            "toc_json": ("toc.json", b'{"title": "nope"}', "application/json"),
        },
    )

    assert response.status_code == 400
    assert "Top-level JSON must be an array" in response.json()["detail"]


def test_apply_rejects_out_of_range_page(tmp_path) -> None:
    input_pdf = tmp_path / "input.pdf"
    _make_pdf(input_pdf, page_count=2)
    toc_json = [{"title": "Chapter 1", "page": 9, "children": []}]

    response = client.post(
        "/api/apply",
        data={"page_offset": "0"},
        files={
            "pdf": ("input.pdf", input_pdf.read_bytes(), "application/pdf"),
            "toc_json": (
                "toc.json",
                json.dumps(toc_json).encode("utf-8"),
                "application/json",
            ),
        },
    )

    assert response.status_code == 400
    assert "out of range" in response.json()["detail"]


def test_apply_rejects_invalid_attribute(tmp_path) -> None:
    input_pdf = tmp_path / "input.pdf"
    _make_pdf(input_pdf)
    toc_json = [{"title": "Chapter 1", "page": 1, "attribute": "pdf", "children": []}]

    response = client.post(
        "/api/apply",
        data={"page_offset": "0"},
        files={
            "pdf": ("input.pdf", input_pdf.read_bytes(), "application/pdf"),
            "toc_json": (
                "toc.json",
                json.dumps(toc_json).encode("utf-8"),
                "application/json",
            ),
        },
    )

    assert response.status_code == 400
    assert "Invalid attribute" in response.json()["detail"]
