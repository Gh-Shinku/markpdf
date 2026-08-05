from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import fitz
import pytest
from fastapi.testclient import TestClient

from bookmark_server.main import app
from bookmark_server.routes import projects as projects_route
from bookmark_server.services.generation_jobs import GenerationJobStore
from bookmark_server.services.projects import ProjectStore


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


def test_create_list_and_read_project_toc(tmp_path, isolated_project_store) -> None:
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
    assert isolated_project_store.pdf_path(project["id"]).name == "document.pdf"
    assert [path.name for path in isolated_project_store.pdf_path(project["id"]).parent.glob("*.pdf")] == ["document.pdf"]


def test_project_validate_and_apply(tmp_path, isolated_project_store) -> None:
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

    persisted_response = client.get(f"/api/projects/{project['id']}/pdf")
    assert persisted_response.status_code == 200
    assert persisted_response.content == apply_response.content
    assert [path.name for path in isolated_project_store.pdf_path(project["id"]).parent.glob("*.pdf")] == ["document.pdf"]


def test_project_pdf_migrates_legacy_output_and_removes_legacy_files(tmp_path, isolated_project_store) -> None:
    project_dir = isolated_project_store.projects_dir / "legacy-project"
    project_dir.mkdir(parents=True)
    source_pdf = project_dir / "source.pdf"
    output_pdf = project_dir / "output.pdf"
    _make_pdf(source_pdf, page_count=1)
    _make_pdf(output_pdf, page_count=2)
    expected_pdf = output_pdf.read_bytes()

    migrated_pdf = isolated_project_store.pdf_path("legacy-project")

    assert migrated_pdf.name == "document.pdf"
    assert migrated_pdf.read_bytes() == expected_pdf
    assert not source_pdf.exists()
    assert not output_pdf.exists()


def test_project_apply_failure_keeps_last_successful_pdf(tmp_path, isolated_project_store, monkeypatch) -> None:
    project = _create_project(tmp_path, page_count=2)
    toc_text = json.dumps([{"title": "Chapter 1", "page": 1, "attribute": "absolute", "children": []}])

    success_response = client.post(
        f"/api/projects/{project['id']}/apply",
        json={"toc_json": toc_text, "page_offset": 0},
    )
    assert success_response.status_code == 200
    last_successful_pdf = success_response.content

    def fail_apply(**kwargs):
        Path(kwargs["output_pdf"]).write_bytes(b"partial PDF")
        raise OSError("disk full")

    monkeypatch.setattr(projects_route, "apply_toc_to_pdf", fail_apply)
    failure_response = client.post(
        f"/api/projects/{project['id']}/apply",
        json={"toc_json": toc_text, "page_offset": 0},
    )

    assert failure_response.status_code == 500
    assert failure_response.json()["detail"] == "Failed to apply TOC to PDF"
    persisted_response = client.get(f"/api/projects/{project['id']}/pdf")
    assert persisted_response.content == last_successful_pdf
    assert list(isolated_project_store.pdf_path(project["id"]).parent.glob(".*.pdf")) == []


def test_project_metadata_persists_page_offset_and_toc_range(tmp_path) -> None:
    project = _create_project(tmp_path, page_count=4)

    response = client.put(
        f"/api/projects/{project['id']}/metadata",
        json={"page_offset": 28, "toc_start": 2, "toc_end": 3},
    )

    assert response.status_code == 200
    assert response.json()["project"]["page_offset"] == 28
    assert response.json()["project"]["toc_start"] == 2
    assert response.json()["project"]["toc_end"] == 3
    project_response = client.get(f"/api/projects/{project['id']}")
    assert project_response.json()["project"]["page_offset"] == 28
    assert project_response.json()["project"]["toc_start"] == 2
    assert project_response.json()["project"]["toc_end"] == 3


def test_project_metadata_rejects_invalid_toc_range(tmp_path) -> None:
    project = _create_project(tmp_path, page_count=4)

    response = client.put(
        f"/api/projects/{project['id']}/metadata",
        json={"toc_start": 2, "toc_end": 8},
    )

    assert response.status_code == 400
    assert "exceeds PDF page count" in response.json()["detail"]


def test_project_apply_returns_validation_error(tmp_path) -> None:
    project = _create_project(tmp_path, page_count=2)
    toc_text = json.dumps([{"title": "Chapter 1", "page": 9, "children": []}])

    response = client.post(
        f"/api/projects/{project['id']}/apply",
        json={"toc_json": toc_text, "page_offset": 0},
    )

    assert response.status_code == 400
    assert "out of range" in response.json()["detail"]


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


def _save_verified_provider() -> str:
    response = client.put("/api/settings/providers", json={"providers": [{"name": "Test VLM", "base_url": "https://example.test/v1", "model": "model-a", "api_key": "secret"}]})
    assert response.status_code == 200
    provider_id = response.json()["providers"][0]["id"]
    projects_route.store.record_provider_verification(provider_id, "verified", "Vision test passed")
    return provider_id


def test_generate_toc_creates_candidate_file(tmp_path, monkeypatch) -> None:
    project = _create_project(tmp_path, page_count=3)
    provider_id = _save_verified_provider()

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
        json={"toc_start": 1, "toc_end": 2, "provider_id": provider_id},
    )

    assert response.status_code == 200
    job_id = response.json()["job"]["id"]

    job_response = client.get(f"/api/jobs/{job_id}")
    assert job_response.status_code == 200
    job = job_response.json()["job"]
    assert job["status"] == "succeeded"
    assert job["progress"]["phase"] == "completed"
    assert job["progress"]["completed_pages"] == 2
    assert job["progress"]["total_pages"] == 2
    assert job["result"]["toc_file"]["kind"] == "generated"
    saved_toc = client.get(f"/api/projects/{project['id']}/toc").json()["toc_json"]
    assert json.loads(saved_toc)[0]["title"] == "Contents"
    candidate = client.get(f"/api/projects/{project['id']}/toc-files/{job['result']['toc_file']['id']}")
    assert json.loads(candidate.json()["toc_json"])[0]["title"] == "Generated"


def test_generate_failure_preserves_saved_json(tmp_path, monkeypatch) -> None:
    project = _create_project(tmp_path, page_count=3)
    original_toc = client.get(f"/api/projects/{project['id']}/toc").json()["toc_json"]
    provider_id = _save_verified_provider()

    def fake_extract_toc_json(**kwargs):
        raise ValueError("VLM rejected the image")

    monkeypatch.setattr(projects_route, "extract_toc_json", fake_extract_toc_json)

    response = client.post(
        f"/api/projects/{project['id']}/generate-toc",
        json={"toc_start": 1, "toc_end": 1, "provider_id": provider_id},
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
        json={"toc_start": 1, "toc_end": 1, "provider_id": "default"},
    )

    assert response.status_code == 400
    assert "vision test" in response.json()["detail"]


def test_generation_job_persists_on_disk(tmp_path, isolated_project_store, monkeypatch) -> None:
    project = _create_project(tmp_path, page_count=3)
    provider_id = _save_verified_provider()

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
        json={"toc_start": 1, "toc_end": 1, "provider_id": provider_id},
    )

    job_id = response.json()["job"]["id"]
    reloaded_store = GenerationJobStore(isolated_project_store.root)
    reloaded_job = reloaded_store.get_job(job_id)
    assert reloaded_job["status"] == "succeeded"
    assert reloaded_job["project_id"] == project["id"]


def test_generation_jobs_list_progress_and_recover_interrupted_job(tmp_path, isolated_project_store) -> None:
    project = _create_project(tmp_path, page_count=3)
    job_store = projects_route.generation_job_store
    job = job_store.create_job(project["id"], toc_start=1, toc_end=3)
    job_store.mark_running(job["id"], "Preparing TOC generation")
    job_store.update_progress(
        job["id"],
        phase="scanning",
        message="Reading TOC page 2 of 3 with VLM",
        current_page=2,
        completed_pages=1,
        total_pages=3,
        source="vlm",
    )

    list_response = client.get(f"/api/projects/{project['id']}/generation-jobs")
    assert list_response.status_code == 200
    listed_job = list_response.json()["jobs"][0]
    assert listed_job["id"] == job["id"]
    assert listed_job["progress"]["phase"] == "scanning"
    assert listed_job["progress"]["completed_pages"] == 1

    assert job_store.recover_interrupted_jobs() == 1
    recovered_job = job_store.get_job(job["id"])
    assert recovered_job["status"] == "failed"
    assert recovered_job["progress"]["phase"] == "failed"
    assert "restart" in recovered_job["error"]


def test_global_generation_jobs_list_sorts_and_filters_status(tmp_path, isolated_project_store) -> None:
    first_project = _create_project(tmp_path, page_count=2)
    second_project = _create_project(tmp_path, page_count=2)
    job_store = projects_route.generation_job_store
    succeeded = job_store.create_job(first_project["id"], toc_start=1, toc_end=1)
    job_store.mark_succeeded(succeeded["id"], "Generated", {})
    active = job_store.create_job(second_project["id"], toc_start=1, toc_end=2)
    job_store.mark_running(active["id"], "Generating")

    all_response = client.get("/api/generation-jobs")
    assert all_response.status_code == 200
    assert [job["id"] for job in all_response.json()["jobs"]] == [active["id"], succeeded["id"]]

    running_response = client.get("/api/generation-jobs?status=running")
    assert running_response.status_code == 200
    assert [job["id"] for job in running_response.json()["jobs"]] == [active["id"]]


def test_batch_generation_persists_project_metainfo(tmp_path, monkeypatch) -> None:
    first_project = _create_project(tmp_path, page_count=5)
    second_project = _create_project(tmp_path, page_count=8)
    provider_id = _save_verified_provider()

    class FakeExecutor:
        def submit(self, *args, **kwargs):
            return None

    monkeypatch.setattr(projects_route, "generation_executor", FakeExecutor())

    response = client.post(
        "/api/generation-jobs/batch",
        json={
            "requests": [
                {
                    "project_id": first_project["id"],
                    "toc_start": 2,
                    "toc_end": 4,
                    "page_offset": 10,
                    "provider_id": provider_id,
                },
                {
                    "project_id": second_project["id"],
                    "toc_start": 3,
                    "toc_end": 6,
                    "page_offset": -1,
                    "provider_id": provider_id,
                },
            ],
        },
    )

    assert response.status_code == 200
    first_response = client.get(f"/api/projects/{first_project['id']}")
    assert first_response.json()["project"]["toc_start"] == 2
    assert first_response.json()["project"]["toc_end"] == 4
    assert first_response.json()["project"]["page_offset"] == 10
    second_response = client.get(f"/api/projects/{second_project['id']}")
    assert second_response.json()["project"]["toc_start"] == 3
    assert second_response.json()["project"]["toc_end"] == 6
    assert second_response.json()["project"]["page_offset"] == -1


def test_generation_rejects_second_active_job(tmp_path) -> None:
    project = _create_project(tmp_path, page_count=3)
    provider_id = _save_verified_provider()
    projects_route.generation_job_store.create_job(project["id"], toc_start=1, toc_end=1)

    response = client.post(
        f"/api/projects/{project['id']}/generate-toc",
        json={"toc_start": 1, "toc_end": 1, "provider_id": provider_id},
    )

    assert response.status_code == 409
    assert "already running" in response.json()["detail"]


def test_generation_job_without_progress_is_normalized(tmp_path) -> None:
    job_store = GenerationJobStore(tmp_path / "workspace_data")
    job_store.jobs_dir.mkdir(parents=True)
    legacy_job = {
        "id": "legacy-job",
        "type": "generate_toc",
        "project_id": "project-1",
        "status": "succeeded",
        "message": "Generated TOC replaced the project JSON",
        "toc_start": 3,
        "toc_end": 5,
        "created_at": "2026-08-05T00:00:00+00:00",
        "updated_at": "2026-08-05T00:01:00+00:00",
        "started_at": None,
        "finished_at": "2026-08-05T00:01:00+00:00",
        "error": None,
        "result": None,
    }
    (job_store.jobs_dir / "legacy-job.json").write_text(json.dumps(legacy_job), encoding="utf-8")

    normalized = job_store.get_job("legacy-job")

    assert normalized["progress"]["phase"] == "completed"
    assert normalized["progress"]["completed_pages"] == 3
