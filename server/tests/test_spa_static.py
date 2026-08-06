from pathlib import Path

from fastapi.testclient import TestClient

from bookmark_server.main import create_app


def _make_dist(tmp_path: Path) -> Path:
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html><body>app shell</body></html>", encoding="utf-8")
    (dist / "assets" / "app.js").write_text("console.log('app');", encoding="utf-8")
    (dist / "pdfjs" / "wasm").mkdir(parents=True)
    (dist / "pdfjs" / "wasm" / "pdf.wasm").write_bytes(b"\x00asm")
    return dist


def test_spa_fallback_serves_index_for_frontend_routes(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("BOOKMARK_WEB_DIST", str(_make_dist(tmp_path)))
    client = TestClient(create_app())

    response = client.get("/")
    assert response.status_code == 200
    assert response.text == "<html><body>app shell</body></html>"

    # Deep SPA route falls back to the app shell.
    response = client.get("/projects/abc123")
    assert response.status_code == 200
    assert response.text == "<html><body>app shell</body></html>"


def test_spa_serves_existing_static_files(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("BOOKMARK_WEB_DIST", str(_make_dist(tmp_path)))
    client = TestClient(create_app())

    response = client.get("/assets/app.js")
    assert response.status_code == 200
    assert response.text == "console.log('app');"

    # pdfjs worker assets shipped inside the dist directory are served too.
    response = client.get("/pdfjs/wasm/pdf.wasm")
    assert response.status_code == 200
    assert response.content == b"\x00asm"


def test_api_routes_take_precedence_over_spa_fallback(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("BOOKMARK_WEB_DIST", str(_make_dist(tmp_path)))
    client = TestClient(create_app())

    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_spa_not_mounted_without_dist(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.delenv("BOOKMARK_WEB_DIST", raising=False)
    monkeypatch.setenv("BOOKMARK_WEB_DIST", str(tmp_path / "missing"))
    client = TestClient(create_app())

    response = client.get("/")
    assert response.status_code == 404
    response = client.get("/api/health")
    assert response.status_code == 200
