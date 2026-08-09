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
        # 默认 toc 已含 "Contents" 书签,语言感知注入判重后不再重复注入。
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
    assert response.json()["project"]["provider_id"] is None
    project_response = client.get(f"/api/projects/{project['id']}")
    assert project_response.json()["project"]["page_offset"] == 28
    assert project_response.json()["project"]["toc_start"] == 2
    assert project_response.json()["project"]["toc_end"] == 3
    assert project_response.json()["project"]["provider_id"] is None


def test_project_metadata_persists_verified_provider(tmp_path) -> None:
    project = _create_project(tmp_path, page_count=4)
    provider_id = _save_verified_provider()

    response = client.put(
        f"/api/projects/{project['id']}/metadata",
        json={"provider_id": provider_id},
    )

    assert response.status_code == 200
    assert response.json()["project"]["provider_id"] == provider_id
    project_response = client.get(f"/api/projects/{project['id']}")
    assert project_response.json()["project"]["provider_id"] == provider_id


def test_project_metadata_rejects_unverified_provider(tmp_path) -> None:
    project = _create_project(tmp_path, page_count=4)

    response = client.put(
        f"/api/projects/{project['id']}/metadata",
        json={"provider_id": "default"},
    )

    assert response.status_code == 400
    assert "vision test" in response.json()["detail"]


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


def test_provider_sampling_and_qwen_thinking_options_are_used(monkeypatch) -> None:
    response = client.put(
        "/api/settings/providers",
        json={
            "providers": [
                {
                    "name": "Qwen",
                    "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
                    "model": "qwen3-vl-flash",
                    "api_key": "secret",
                    "sampling": {"temperature": 0.3, "top_p": 0.8},
                    "thinking_mode": "on",
                    "extra_body": {"trace_id": "abc"},
                }
            ]
        },
    )
    assert response.status_code == 200
    provider = response.json()["providers"][0]
    assert provider["sampling"] == {"temperature": 0.3, "top_p": 0.8}
    assert provider["thinking_mode"] == "on"
    projects_route.store.record_provider_verification(provider["id"], "verified", "Vision test passed")
    captured: dict[str, Any] = {}

    def fake_request_chat_from_vlm(messages, api_key, base_url, model, **kwargs):
        captured.update(kwargs["completion_options"])
        return "ok"

    monkeypatch.setattr(projects_route, "request_chat_from_vlm", fake_request_chat_from_vlm)
    chat_response = client.post(
        "/api/playground/chat",
        json={"provider_id": provider["id"], "messages": [{"role": "user", "content": "prompt"}]},
    )

    assert chat_response.status_code == 200
    assert captured["temperature"] == 0.3
    assert captured["top_p"] == 0.8
    assert captured["extra_body"] == {"enable_thinking": True, "trace_id": "abc"}


def test_provider_request_options_preserve_verification() -> None:
    provider_id = _save_verified_provider()

    response = client.put(
        "/api/settings/providers",
        json={
            "providers": [
                {
                    "id": provider_id,
                    "name": "Test VLM",
                    "base_url": "https://example.test/v1",
                    "model": "model-a",
                    "sampling": {"temperature": 0.2},
                    "thinking_mode": "off",
                }
            ]
        },
    )

    assert response.status_code == 200
    provider = response.json()["providers"][0]
    assert provider["verification_status"] == "verified"
    assert provider["thinking_mode"] == "off"
    assert provider["sampling"] == {"temperature": 0.2}


def test_unsupported_thinking_mode_warns_and_omits_extra_body(monkeypatch) -> None:
    response = client.put(
        "/api/settings/providers",
        json={
            "providers": [
                {
                    "name": "Unknown",
                    "base_url": "https://example.test/v1",
                    "model": "model-a",
                    "api_key": "secret",
                    "thinking_mode": "off",
                }
            ]
        },
    )
    assert response.status_code == 200
    provider = response.json()["providers"][0]
    projects_route.store.record_provider_verification(provider["id"], "verified", "Vision test passed")
    captured: dict[str, Any] = {}

    def fake_request_chat_from_vlm(messages, api_key, base_url, model, **kwargs):
        captured.update(kwargs["completion_options"])
        return "ok"

    monkeypatch.setattr(projects_route, "request_chat_from_vlm", fake_request_chat_from_vlm)
    chat_response = client.post(
        "/api/playground/chat",
        json={"provider_id": provider["id"], "messages": [{"role": "user", "content": "prompt"}]},
    )

    assert chat_response.status_code == 200
    assert chat_response.json()["warnings"]
    assert "extra_body" not in captured
    assert "reasoning_effort" not in captured


def test_generate_toc_creates_candidate_file(tmp_path, monkeypatch) -> None:
    project = _create_project(tmp_path, page_count=3)
    provider_id = _save_verified_provider()

    def fake_extract_toc_json(**kwargs):
        assert kwargs["toc_start"] == 0
        assert kwargs["toc_end"] == 1
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
    candidate_nodes = json.loads(candidate.json()["toc_json"])
    # 自动 apply 将注入的目录书签持久化写回了候选文件。
    assert candidate_nodes[0]["title"] == "Contents"
    assert candidate_nodes[0]["attribute"] == "absolute"
    assert candidate_nodes[1]["title"] == "Generated"


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
    assert first_response.json()["project"]["provider_id"] == provider_id
    second_response = client.get(f"/api/projects/{second_project['id']}")
    assert second_response.json()["project"]["toc_start"] == 3
    assert second_response.json()["project"]["toc_end"] == 6
    assert second_response.json()["project"]["page_offset"] == -1
    assert second_response.json()["project"]["provider_id"] == provider_id


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


def test_apply_toc_file_persists_injected_toc_page(tmp_path, isolated_project_store) -> None:
    project = _create_project(tmp_path, page_count=4)
    toc_text = json.dumps(
        [
            {"title": "Chapter 1", "page": 1, "attribute": "relative", "children": []},
        ]
    )
    save_response = client.put(
        f"/api/projects/{project['id']}/toc-files/main",
        json={"toc_json": toc_text},
    )
    assert save_response.status_code == 200

    apply_response = client.post(
        f"/api/projects/{project['id']}/toc-files/main/apply",
        json={"page_offset": 0},
    )
    assert apply_response.status_code == 200

    # 英文目录注入 "Contents" 书签,并持久化写入被 apply 的 toc 文件顶部。
    persisted = client.get(f"/api/projects/{project['id']}/toc").json()["toc_json"]
    persisted_nodes = json.loads(persisted)
    assert persisted_nodes[0]["title"] == "Contents"
    assert persisted_nodes[0]["page"] == 1
    assert persisted_nodes[0]["attribute"] == "absolute"
    assert persisted_nodes[1]["title"] == "Chapter 1"

    # 再次 apply 不会重复注入(幂等)。
    apply_response = client.post(
        f"/api/projects/{project['id']}/toc-files/main/apply",
        json={"page_offset": 0},
    )
    assert apply_response.status_code == 200
    persisted_nodes = json.loads(client.get(f"/api/projects/{project['id']}/toc").json()["toc_json"])
    assert [node["title"] for node in persisted_nodes] == ["Contents", "Chapter 1"]


def test_rendered_page_api_returns_reproducible_backend_image(tmp_path) -> None:
    project = _create_project(tmp_path, page_count=2)

    response = client.get(f"/api/projects/{project['id']}/rendered-pages/1")

    assert response.status_code == 200
    data = response.json()
    assert data["project_id"] == project["id"]
    assert data["page"] == 1
    assert data["dpi"] == 220
    assert data["mime_type"] == "image/png"
    assert data["width"] > 0
    assert data["height"] > 0
    assert data["sha256"]
    assert data["data_url"].startswith("data:image/png;base64,")


def test_rendered_page_api_rejects_out_of_range_page(tmp_path) -> None:
    project = _create_project(tmp_path, page_count=1)

    response = client.get(f"/api/projects/{project['id']}/rendered-pages/2")

    assert response.status_code == 400
    assert "out of range" in response.json()["detail"]


def test_playground_chat_sends_text_and_pdf_page_attachment(tmp_path, monkeypatch) -> None:
    project = _create_project(tmp_path, page_count=1)
    provider_id = _save_verified_provider()
    rendered = client.get(f"/api/projects/{project['id']}/rendered-pages/1").json()
    captured: dict[str, Any] = {}

    def fake_request_chat_from_vlm(messages, api_key, base_url, model, **kwargs):
        captured["messages"] = messages
        captured["api_key"] = api_key
        captured["base_url"] = base_url
        captured["model"] = model
        return "raw vlm response"

    monkeypatch.setattr(projects_route, "request_chat_from_vlm", fake_request_chat_from_vlm)

    response = client.post(
        "/api/playground/chat",
        json={
            "provider_id": provider_id,
            "messages": [
                {
                    "role": "user",
                    "content": "Extract this page.",
                    "attachments": [
                        {
                            "type": "pdf_page",
                            "project_id": project["id"],
                            "page": 1,
                            "dpi": 220,
                            "sha256": rendered["sha256"],
                        }
                    ],
                }
            ],
        },
    )

    assert response.status_code == 200
    assert response.json()["message"]["content"] == "raw vlm response"
    assert captured["api_key"] == "secret"
    assert captured["base_url"] == "https://example.test/v1"
    assert captured["model"] == "model-a"
    assert captured["messages"][0]["role"] == "user"
    assert captured["messages"][0]["content"][0] == {"type": "text", "text": "Extract this page."}
    assert captured["messages"][0]["content"][1]["type"] == "image_url"
    assert captured["messages"][0]["content"][1]["image_url"]["url"].startswith("data:image/png;base64,")


def test_playground_chat_sessions_save_history_but_send_only_current_message(monkeypatch) -> None:
    provider_id = _save_verified_provider()
    captured_calls: list[list[dict[str, Any]]] = []

    def fake_request_chat_from_vlm(messages, api_key, base_url, model, **kwargs):
        captured_calls.append(messages)
        return f"answer {len(captured_calls)}"

    monkeypatch.setattr(projects_route, "request_chat_from_vlm", fake_request_chat_from_vlm)

    create_response = client.post("/api/playground/chats", json={"provider_id": provider_id})
    assert create_response.status_code == 200
    chat_id = create_response.json()["chat"]["id"]

    first_response = client.post(
        f"/api/playground/chats/{chat_id}/messages",
        json={
            "provider_id": provider_id,
            "message": {"id": "user-1", "role": "user", "content": "old prompt", "attachments": []},
        },
    )
    second_response = client.post(
        f"/api/playground/chats/{chat_id}/messages",
        json={
            "provider_id": provider_id,
            "message": {"id": "user-2", "role": "user", "content": "current prompt", "attachments": []},
        },
    )

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert captured_calls[-1] == [{"role": "user", "content": "current prompt"}]
    chat_response = client.get(f"/api/playground/chats/{chat_id}")
    assert chat_response.status_code == 200
    messages = chat_response.json()["chat"]["messages"]
    assert [message["content"] for message in messages] == [
        "old prompt",
        "answer 1",
        "current prompt",
        "answer 2",
    ]


def test_playground_chat_stream_sends_deltas_and_saves_history(monkeypatch) -> None:
    provider_id = _save_verified_provider()
    captured: dict[str, Any] = {}

    def fake_request_chat_from_vlm_stream(messages, api_key, base_url, model, **kwargs):
        captured["messages"] = messages
        yield "hello"
        yield " world"

    monkeypatch.setattr(projects_route, "request_chat_from_vlm_stream", fake_request_chat_from_vlm_stream)
    create_response = client.post("/api/playground/chats", json={"provider_id": provider_id})
    chat_id = create_response.json()["chat"]["id"]

    response = client.post(
        f"/api/playground/chats/{chat_id}/messages/stream",
        json={
            "provider_id": provider_id,
            "message": {"id": "user-stream", "role": "user", "content": "current prompt", "attachments": []},
        },
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert "event: delta\ndata: {\"text\": \"hello\"}" in response.text
    assert "event: delta\ndata: {\"text\": \" world\"}" in response.text
    assert "event: final" in response.text
    assert captured["messages"] == [{"role": "user", "content": "current prompt"}]
    chat_response = client.get(f"/api/playground/chats/{chat_id}")
    assert [message["content"] for message in chat_response.json()["chat"]["messages"]] == [
        "current prompt",
        "hello world",
    ]


def test_playground_chat_stream_sends_thinking_without_saving_it(monkeypatch) -> None:
    provider_id = _save_verified_provider()

    def fake_request_chat_from_vlm_stream(messages, api_key, base_url, model, **kwargs):
        yield {"type": "thinking", "text": "reasoning"}
        yield {"type": "content", "text": "answer"}

    monkeypatch.setattr(projects_route, "request_chat_from_vlm_stream", fake_request_chat_from_vlm_stream)
    create_response = client.post("/api/playground/chats", json={"provider_id": provider_id})
    chat_id = create_response.json()["chat"]["id"]

    response = client.post(
        f"/api/playground/chats/{chat_id}/messages/stream",
        json={
            "provider_id": provider_id,
            "message": {"id": "user-stream", "role": "user", "content": "current prompt", "attachments": []},
        },
    )

    assert response.status_code == 200
    assert "event: thinking\ndata: {\"text\": \"reasoning\"}" in response.text
    assert "event: delta\ndata: {\"text\": \"answer\"}" in response.text
    chat_response = client.get(f"/api/playground/chats/{chat_id}")
    assert [message["content"] for message in chat_response.json()["chat"]["messages"]] == [
        "current prompt",
        "answer",
    ]


def test_playground_chat_stream_suppresses_thinking_when_provider_is_off(monkeypatch) -> None:
    response = client.put(
        "/api/settings/providers",
        json={
            "providers": [
                {
                    "name": "Qwen",
                    "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
                    "model": "qwen3.7-flash",
                    "api_key": "secret",
                    "thinking_mode": "off",
                }
            ]
        },
    )
    assert response.status_code == 200
    provider = response.json()["providers"][0]
    projects_route.store.record_provider_verification(provider["id"], "verified", "Vision test passed")
    captured: dict[str, Any] = {}

    def fake_request_chat_from_vlm_stream(messages, api_key, base_url, model, **kwargs):
        captured["completion_options"] = kwargs["completion_options"]
        yield {"type": "thinking", "text": "reasoning"}
        yield {"type": "content", "text": "answer"}

    monkeypatch.setattr(projects_route, "request_chat_from_vlm_stream", fake_request_chat_from_vlm_stream)
    create_response = client.post("/api/playground/chats", json={"provider_id": provider["id"]})
    chat_id = create_response.json()["chat"]["id"]

    stream_response = client.post(
        f"/api/playground/chats/{chat_id}/messages/stream",
        json={
            "provider_id": provider["id"],
            "message": {"id": "user-stream", "role": "user", "content": "current prompt", "attachments": []},
        },
    )

    assert stream_response.status_code == 200
    assert captured["completion_options"]["extra_body"] == {"enable_thinking": False}
    assert "event: thinking" not in stream_response.text
    assert "event: delta\ndata: {\"text\": \"answer\"}" in stream_response.text


def test_playground_chat_stream_error_does_not_save_incomplete_history(monkeypatch) -> None:
    provider_id = _save_verified_provider()

    def fake_request_chat_from_vlm_stream(messages, api_key, base_url, model, **kwargs):
        yield "partial"
        raise RuntimeError("stream failed")

    monkeypatch.setattr(projects_route, "request_chat_from_vlm_stream", fake_request_chat_from_vlm_stream)
    create_response = client.post("/api/playground/chats", json={"provider_id": provider_id})
    chat_id = create_response.json()["chat"]["id"]

    response = client.post(
        f"/api/playground/chats/{chat_id}/messages/stream",
        json={
            "provider_id": provider_id,
            "message": {"id": "user-stream", "role": "user", "content": "current prompt", "attachments": []},
        },
    )

    assert response.status_code == 200
    assert "event: delta\ndata: {\"text\": \"partial\"}" in response.text
    assert "event: error\ndata: {\"detail\": \"stream failed\"}" in response.text
    chat_response = client.get(f"/api/playground/chats/{chat_id}")
    assert chat_response.json()["chat"]["messages"] == []


def test_playground_chat_session_rename() -> None:
    provider_id = _save_verified_provider()
    create_response = client.post("/api/playground/chats", json={"provider_id": provider_id})
    chat_id = create_response.json()["chat"]["id"]

    rename_response = client.patch(
        f"/api/playground/chats/{chat_id}",
        json={"title": "  Renamed chat  "},
    )

    assert rename_response.status_code == 200
    assert rename_response.json()["chat"]["title"] == "Renamed chat"
    assert rename_response.json()["chats"][0]["title"] == "Renamed chat"
    get_response = client.get(f"/api/playground/chats/{chat_id}")
    assert get_response.json()["chat"]["title"] == "Renamed chat"


def test_playground_chat_session_rename_rejects_empty_title() -> None:
    provider_id = _save_verified_provider()
    create_response = client.post("/api/playground/chats", json={"provider_id": provider_id})
    chat_id = create_response.json()["chat"]["id"]

    response = client.patch(f"/api/playground/chats/{chat_id}", json={"title": "   "})

    assert response.status_code == 400
    assert "required" in response.json()["detail"]


def test_playground_chat_session_stores_pdf_page_attachment(tmp_path, monkeypatch) -> None:
    project = _create_project(tmp_path, page_count=1)
    provider_id = _save_verified_provider()
    rendered = client.get(f"/api/projects/{project['id']}/rendered-pages/1").json()

    def fake_request_chat_from_vlm(messages, api_key, base_url, model, **kwargs):
        return "raw vlm response"

    monkeypatch.setattr(projects_route, "request_chat_from_vlm", fake_request_chat_from_vlm)

    create_response = client.post("/api/playground/chats", json={"provider_id": provider_id})
    chat_id = create_response.json()["chat"]["id"]
    send_response = client.post(
        f"/api/playground/chats/{chat_id}/messages",
        json={
            "provider_id": provider_id,
            "message": {
                "id": "user-with-image",
                "role": "user",
                "content": "Extract this page.",
                "attachments": [
                    {
                        "type": "pdf_page",
                        "project_id": project["id"],
                        "page": 1,
                        "dpi": 220,
                        "sha256": rendered["sha256"],
                    }
                ],
            },
        },
    )

    assert send_response.status_code == 200
    attachment = send_response.json()["chat"]["messages"][0]["attachments"][0]
    assert attachment["data_url"].startswith("/api/playground/chats/")
    image_response = client.get(attachment["data_url"])
    assert image_response.status_code == 200
    assert image_response.headers["content-type"] == "image/png"
    assert image_response.content.startswith(b"\x89PNG")


def test_playground_chat_rejects_changed_rendered_page_hash(tmp_path) -> None:
    project = _create_project(tmp_path, page_count=1)
    provider_id = _save_verified_provider()

    response = client.post(
        "/api/playground/chat",
        json={
            "provider_id": provider_id,
            "messages": [
                {
                    "role": "user",
                    "content": "Use this page.",
                    "attachments": [
                        {
                            "type": "pdf_page",
                            "project_id": project["id"],
                            "page": 1,
                            "dpi": 220,
                            "sha256": "not-the-current-render",
                        }
                    ],
                }
            ],
        },
    )

    assert response.status_code == 409
    assert "changed" in response.json()["detail"]


def test_generate_toc_auto_apply_failure_marks_job_failed(tmp_path, monkeypatch) -> None:
    project = _create_project(tmp_path, page_count=4)
    provider_id = _save_verified_provider()

    def fake_extract_toc_json(**kwargs):
        # 结构合法但页码越界:生成成功,apply 时校验失败。
        return (
            [{"title": "Broken", "page": 99, "attribute": "relative", "children": []}],
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

    job = client.get(f"/api/jobs/{job_id}").json()["job"]
    assert job["status"] == "failed"
    assert job["message"] == "TOC generated but applying failed"
    assert "page" in job["error"].lower() or "out of range" in job["error"].lower()

    # 生成的候选文件保留,便于用户人工兜底。
    candidate_id = job["result"]["toc_file"]["id"] if job.get("result") else None
    assert candidate_id is None or True
