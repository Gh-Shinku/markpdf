from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import fitz
import pytest
from fastapi.testclient import TestClient

from server.bookmark_server.main import app
from server.bookmark_server.routes import projects as projects_route
from server.bookmark_server.services.generation_jobs import GenerationJobStore
from server.bookmark_server.services.projects import ProjectStore


client = TestClient(app)


@pytest.fixture(autouse=True)
def isolated_project_store(tmp_path, monkeypatch) -> ProjectStore:
    root = tmp_path / "workspace_data"
    store = ProjectStore(root)
    job_store = GenerationJobStore(root)
    monkeypatch.setattr(projects_route, "store", store)
    monkeypatch.setattr(projects_route, "generation_job_store", job_store)
    return store


def _make_pdf(path: Path, page_count: int = 4) -> None:
    doc = fitz.open()
    for _ in range(page_count):
        doc.new_page()
    doc.save(path)
    doc.close()


def _create_project(tmp_path: Path, page_count: int = 4) -> dict[str, Any]:
    input_pdf = tmp_path / "input.pdf"
    _make_pdf(input_pdf, page_count=page_count)
    response = client.post(
        "/api/projects",
        files={"pdf": ("input.pdf", input_pdf.read_bytes(), "application/pdf")},
    )

    assert response.status_code == 200
    return response.json()["project"]


def test_create_list_and_read_project_toc(tmp_path) -> None:
    project = _create_project(tmp_path)

    list_response = client.get("/api/projects")
    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()["projects"]] == [project["id"]]

    toc_response = client.get(f"/api/projects/{project['id']}/toc")
    assert toc_response.status_code == 200
    assert json.loads(toc_response.json()["toc_json"])[0]["attribute"] == "absolute"

    pdf_response = client.get(f"/api/projects/{project['id']}/pdf")
    assert pdf_response.status_code == 200
    assert pdf_response.headers["content-type"] == "application/pdf"
    assert pdf_response.headers["content-disposition"].startswith("inline;")


def test_project_validate_and_apply(tmp_path) -> None:
    project = _create_project(tmp_path, page_count=4)
    toc_text = json.dumps(
        [
            {"title": "Contents", "page": 1, "attribute": "absolute", "children": []},
            {"title": "Chapter 1", "page": 1, "attribute": "relative", "children": []},
        ]
    )

    validate_response = client.post(
        f"/api/projects/{project['id']}/validate",
        json={"toc_json": toc_text, "page_offset": 1},
    )
    assert validate_response.status_code == 200
    assert validate_response.json()["validation"]["valid"] is True
    assert validate_response.json()["validation"]["bookmark_count"] == 2

    apply_response = client.post(
        f"/api/projects/{project['id']}/apply",
        json={"toc_json": toc_text, "page_offset": 1},
    )
    assert apply_response.status_code == 200

    output_pdf = tmp_path / "output.pdf"
    output_pdf.write_bytes(apply_response.content)
    with fitz.open(output_pdf) as doc:
        assert doc.get_toc() == [[1, "Contents", 1], [1, "Chapter 1", 2]]


def test_project_validate_rejects_out_of_range_page(tmp_path) -> None:
    project = _create_project(tmp_path, page_count=2)
    toc_text = json.dumps([{"title": "Chapter 1", "page": 9, "children": []}])

    response = client.post(
        f"/api/projects/{project['id']}/validate",
        json={"toc_json": toc_text, "page_offset": 0},
    )

    assert response.status_code == 200
    assert response.json()["validation"]["valid"] is False
    assert "out of range" in response.json()["validation"]["issues"][0]["message"]


def test_llm_settings_are_saved_and_redacted() -> None:
    save_response = client.put(
        "/api/settings/llm",
        json={
            "base_url": "https://example.test/v1",
            "model": "model-a",
            "api_key": "sk-1234567890",
        },
    )
    assert save_response.status_code == 200
    assert save_response.json()["settings"]["has_api_key"] is True

    get_response = client.get("/api/settings/llm")
    assert get_response.status_code == 200
    settings = get_response.json()["settings"]
    assert settings["base_url"] == "https://example.test/v1"
    assert settings["model"] == "model-a"
    assert "api_key" not in settings
    assert settings["api_key_hint"] == "sk-1...7890"


def test_generate_toc_overwrites_saved_json(tmp_path, monkeypatch) -> None:
    project = _create_project(tmp_path, page_count=3)
    client.put(
        "/api/settings/llm",
        json={
            "base_url": "https://example.test/v1",
            "model": "model-a",
            "api_key": "secret",
        },
    )

    def fake_extract_toc_json(**kwargs):
        assert kwargs["toc_start"] == 0
        assert kwargs["toc_end"] == 1
        assert kwargs["mode"] == "flat"
        return (
            [{"title": "Generated", "page": 1, "attribute": "relative", "children": []}],
            Path("cache.json"),
            False,
            None,
            {"vlm_calls": 1},
        )

    monkeypatch.setattr(projects_route, "extract_toc_json", fake_extract_toc_json)

    response = client.post(
        f"/api/projects/{project['id']}/generate-toc",
        json={"toc_start": 1, "toc_end": 2},
    )

    assert response.status_code == 200
    job_id = response.json()["job"]["id"]

    job_response = client.get(f"/api/jobs/{job_id}")
    assert job_response.status_code == 200
    job = job_response.json()["job"]
    assert job["status"] == "succeeded"
    assert job["result"]["project"]["generated_at"] is not None
    saved_toc = client.get(f"/api/projects/{project['id']}/toc").json()["toc_json"]
    assert json.loads(saved_toc)[0]["title"] == "Generated"


def test_generate_failure_preserves_saved_json(tmp_path, monkeypatch) -> None:
    project = _create_project(tmp_path, page_count=3)
    original_toc = client.get(f"/api/projects/{project['id']}/toc").json()["toc_json"]
    client.put(
        "/api/settings/llm",
        json={
            "base_url": "https://example.test/v1",
            "model": "model-a",
            "api_key": "secret",
        },
    )

    def fake_extract_toc_json(**kwargs):
        raise ValueError("VLM rejected the image")

    monkeypatch.setattr(projects_route, "extract_toc_json", fake_extract_toc_json)

    response = client.post(
        f"/api/projects/{project['id']}/generate-toc",
        json={"toc_start": 1, "toc_end": 1},
    )

    assert response.status_code == 200
    job_id = response.json()["job"]["id"]
    job = client.get(f"/api/jobs/{job_id}").json()["job"]
    assert job["status"] == "failed"
    assert "VLM rejected" in job["error"]
    saved_toc = client.get(f"/api/projects/{project['id']}/toc").json()["toc_json"]
    assert saved_toc == original_toc


def test_generate_requires_api_key(tmp_path) -> None:
    project = _create_project(tmp_path, page_count=2)

    response = client.post(
        f"/api/projects/{project['id']}/generate-toc",
        json={"toc_start": 1, "toc_end": 1},
    )

    assert response.status_code == 400
    assert "API key" in response.json()["detail"]


def test_generation_job_persists_on_disk(tmp_path, isolated_project_store, monkeypatch) -> None:
    project = _create_project(tmp_path, page_count=3)
    client.put(
        "/api/settings/llm",
        json={
            "base_url": "https://example.test/v1",
            "model": "model-a",
            "api_key": "secret",
        },
    )

    def fake_extract_toc_json(**kwargs):
        return (
            [{"title": "Persisted", "page": 1, "attribute": "relative", "children": []}],
            Path("cache.json"),
            False,
            None,
            {"vlm_calls": 1},
        )

    monkeypatch.setattr(projects_route, "extract_toc_json", fake_extract_toc_json)

    response = client.post(
        f"/api/projects/{project['id']}/generate-toc",
        json={"toc_start": 1, "toc_end": 1},
    )

    job_id = response.json()["job"]["id"]
    reloaded_store = GenerationJobStore(isolated_project_store.root)
    reloaded_job = reloaded_store.get_job(job_id)
    assert reloaded_job["status"] == "succeeded"
    assert reloaded_job["project_id"] == project["id"]
