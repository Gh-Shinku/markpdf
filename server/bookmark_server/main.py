from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse

from .routes import api_router
from .services import runtime

# Default location of the built frontend relative to the repository root.
DEFAULT_WEB_DIST = Path(__file__).resolve().parents[2] / "web" / "dist"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    runtime.generation_job_store.recover_interrupted_jobs()
    yield


def mount_web_dist(app: FastAPI, dist_dir: Path | None = None) -> bool:
    """Serve the built frontend from a single process.

    Picks up `BOOKMARK_WEB_DIST` when no directory is given. Serves static
    files that exist under the dist directory and falls back to index.html
    for everything else (SPA routing). Returns True when the frontend was
    mounted. API routes are registered before this catch-all, so `/api/*`
    keeps taking precedence.
    """
    if dist_dir is None:
        dist_dir = Path(os.getenv("BOOKMARK_WEB_DIST", str(DEFAULT_WEB_DIST)))
    if not dist_dir.is_dir():
        return False

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str) -> FileResponse:
        candidate = dist_dir / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(dist_dir / "index.html")

    return True


def create_app() -> FastAPI:
    app = FastAPI(title="PDF Bookmark Server", lifespan=lifespan)
    app.include_router(api_router, prefix="/api")

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    mount_web_dist(app)
    return app


app = create_app()
