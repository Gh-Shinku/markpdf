from __future__ import annotations

import json
from pathlib import Path

import fitz
import pytest
from fastapi.testclient import TestClient

from bookmark_server.main import app
from bookmark_server.routes import projects as projects_route
from bookmark_server.services.projects import ProjectStore
from bookmark_server.services.toc_extraction import (
    DEFAULT_PROMPTS,
    FlatExtractor,
    TreeExtractor,
    find_matching_flat_raw_cache,
    make_cache_file_path,
    make_flat_pages_work_dir,
    render_prompt_template,
)


client = TestClient(app)


@pytest.fixture(autouse=True)
def isolated_project_store(tmp_path, monkeypatch) -> ProjectStore:
    root = tmp_path / "workspace_data"
    store = ProjectStore(root)
    monkeypatch.setattr(projects_route, "store", store)
    return store


def _make_pdf(path: Path, page_count: int = 2) -> None:
    doc = fitz.open()
    for _ in range(page_count):
        doc.new_page()
    doc.save(path)
    doc.close()


# The pre-customization flat prompt, kept verbatim as a regression lock.
LEGACY_FLAT_PROMPT = (
    "Role: You are a high-precision OCR Data Entry Clerk.\n"
    "Task: Extract ToC entries from the current page as a FLAT list of items.\n\n"
    "### Specific Rules:\n"
    "1. **Flat Output**: Do NOT nest items. Every entry must be a direct element of the root array.\n"
    "2. **Text Cleaning**: \n"
    "   - Merge multi-line titles into a single string.\n"
    "   - Remove leader dots (e.g., 'Chapter 1.......10' becomes text:'Chapter 1', page:10).\n"
    "3. **Page Range**: Only process the content visible on THIS page. Do not guess what's on the next page.\n"
    "4. **Filtering**: Ignore headers, footers, and decorative elements.\n"
    "5. **Verbatim**: Keep the original numbering (e.g., '1.2.3', 'Appendix A') within the 'text' field.\n\n"
    "### Output Format:\n"
    "Return ONLY a JSON array. No markdown, no conversational text.\n"
    'Schema: [{"text": "Full Title String", "page": integer_or_null}, ...]'
)


def test_default_flat_prompt_is_byte_identical_to_legacy() -> None:
    rendered = FlatExtractor(toc_start=0, toc_end=2, pdf_name="book").build_prompt()
    assert rendered == LEGACY_FLAT_PROMPT
    assert rendered == DEFAULT_PROMPTS["flat"]
    assert "{toc_" not in rendered


def test_default_tree_prompt_renders_one_based_pages() -> None:
    rendered = TreeExtractor(toc_start=0, toc_end=2, pdf_name="book").build_prompt()
    assert rendered == (
        DEFAULT_PROMPTS["tree"]
        .replace("{toc_start}", "1")
        .replace("{toc_end}", "3")
    )
    assert "book pages 1 to 3" in rendered
    assert "{toc_start}" not in rendered and "{toc_end}" not in rendered


def test_custom_prompt_renders_placeholders_and_keeps_json_braces() -> None:
    template = (
        "Extract entries from pages {toc_start}-{toc_end} of {pdf_name}. "
        'Return [{"title": "x", "page": 1}].'
    )
    rendered = FlatExtractor(
        toc_start=3,
        toc_end=5,
        prompt=template,
        pdf_name="my book",
    ).build_prompt()
    assert rendered == (
        "Extract entries from pages 4-6 of my book. Return [{\"title\": \"x\", \"page\": 1}]."
    )


def test_render_prompt_template_handles_unknown_braces() -> None:
    rendered = render_prompt_template(
        "Literal {json} braces {toc_start} {pdf_name}",
        toc_start=0,
        toc_end=1,
        pdf_name="b",
    )
    assert rendered == "Literal {json} braces 1 b"


def test_cache_paths_depend_on_prompt(tmp_path: Path) -> None:
    input_pdf = tmp_path / "book.pdf"
    _make_pdf(input_pdf)
    cache_dir = tmp_path / "cache"

    path_a = make_cache_file_path(input_pdf, cache_dir, 0, 2, 220, "model-x", "flat", "prompt A")
    path_b = make_cache_file_path(input_pdf, cache_dir, 0, 2, 220, "model-x", "flat", "prompt B")
    assert path_a != path_b
    assert path_a == make_cache_file_path(input_pdf, cache_dir, 0, 2, 220, "model-x", "flat", "prompt A")

    dir_a = make_flat_pages_work_dir(input_pdf, cache_dir, 0, 2, 220, "model-x", "prompt A")
    dir_b = make_flat_pages_work_dir(input_pdf, cache_dir, 0, 2, 220, "model-x", "prompt B")
    assert dir_a != dir_b


def _write_raw_cache(cache_dir: Path, filename: str, record: dict) -> None:
    (cache_dir / filename).write_text(json.dumps(record), encoding="utf-8")


def _base_raw_record(input_pdf: Path, **overrides: object) -> dict:
    record: dict = {
        "mode": "flat",
        "input_pdf": str(input_pdf.resolve()),
        "toc_start": 0,
        "toc_end": 2,
        "model": "model-x",
        "dpi": 220,
        "pages": [{"page_call_index": 1, "raw_json": []}],
    }
    record.update(overrides)
    return record


def test_find_matching_flat_raw_cache_legacy_record_matches_default_prompt_only(
    tmp_path: Path,
) -> None:
    input_pdf = tmp_path / "book.pdf"
    _make_pdf(input_pdf)
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    legacy = cache_dir / "flat_raw_legacy.json"
    legacy.write_text(
        json.dumps(_base_raw_record(input_pdf)),
        encoding="utf-8",
    )

    assert (
        find_matching_flat_raw_cache(
            cache_dir, input_pdf, 0, 2, "model-x", 220, DEFAULT_PROMPTS["flat"]
        )
        == legacy
    )
    assert (
        find_matching_flat_raw_cache(
            cache_dir, input_pdf, 0, 2, "model-x", 220, "custom prompt"
        )
        is None
    )


def test_find_matching_flat_raw_cache_new_record_matches_prompt_strictly(tmp_path: Path) -> None:
    input_pdf = tmp_path / "book.pdf"
    _make_pdf(input_pdf)
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    record = cache_dir / "flat_raw_prompted.json"
    record.write_text(
        json.dumps(_base_raw_record(input_pdf, prompt="prompt X")),
        encoding="utf-8",
    )

    assert (
        find_matching_flat_raw_cache(
            cache_dir, input_pdf, 0, 2, "model-x", 220, "prompt X"
        )
        == record
    )
    assert (
        find_matching_flat_raw_cache(
            cache_dir, input_pdf, 0, 2, "model-x", 220, "prompt Y"
        )
        is None
    )


def test_store_prompts_round_trip_and_empty_resets(tmp_path: Path) -> None:
    store = ProjectStore(tmp_path / "data")
    assert store.read_toc_prompts() == DEFAULT_PROMPTS

    saved = store.save_toc_prompts({"flat": "  custom flat  ", "tree": "custom tree"})
    assert saved == {"flat": "custom flat", "tree": "custom tree"}
    assert store.read_toc_prompts() == {"flat": "custom flat", "tree": "custom tree"}

    assert store.save_toc_prompts({"flat": "   ", "tree": ""}) == DEFAULT_PROMPTS


def test_store_providers_and_prompts_coexist(tmp_path: Path) -> None:
    store = ProjectStore(tmp_path / "data")
    store.save_toc_prompts({"flat": "custom flat", "tree": "custom tree"})

    providers = store.save_llm_providers(
        [{"id": "p1", "name": "X", "base_url": "http://x", "model": "m", "api_key": "k"}]
    )
    assert providers[0]["id"] == "p1"
    assert store.read_toc_prompts() == {"flat": "custom flat", "tree": "custom tree"}

    store.save_toc_prompts({"flat": "new flat", "tree": ""})
    assert store.get_llm_provider("p1")["name"] == "X"
    assert store.read_toc_prompts()["flat"] == "new flat"

    store.record_provider_verification("p1", "verified", "ok")
    assert store.read_toc_prompts()["flat"] == "new flat"


def test_prompts_endpoints_round_trip(isolated_project_store: ProjectStore) -> None:
    get_response = client.get("/api/settings/prompts")
    assert get_response.status_code == 200
    body = get_response.json()
    assert body["prompts"] == DEFAULT_PROMPTS
    assert body["defaults"] == DEFAULT_PROMPTS

    put_response = client.put(
        "/api/settings/prompts",
        json={"flat": "custom flat prompt", "tree": "custom tree prompt"},
    )
    assert put_response.status_code == 200
    assert put_response.json()["prompts"] == {
        "flat": "custom flat prompt",
        "tree": "custom tree prompt",
    }

    assert client.get("/api/settings/prompts").json()["prompts"]["flat"] == "custom flat prompt"


def test_prompts_endpoint_rejects_oversize_prompt(isolated_project_store: ProjectStore) -> None:
    response = client.put(
        "/api/settings/prompts",
        json={"flat": "x" * 20001, "tree": ""},
    )
    assert response.status_code == 400


def test_prompts_endpoint_blank_resets_to_default(isolated_project_store: ProjectStore) -> None:
    client.put("/api/settings/prompts", json={"flat": "custom", "tree": "custom"})
    response = client.put("/api/settings/prompts", json={"flat": "", "tree": "   "})
    assert response.status_code == 200
    assert response.json()["prompts"] == DEFAULT_PROMPTS
