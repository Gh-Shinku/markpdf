from __future__ import annotations

from fastapi import FastAPI

from .routes import projects


app = FastAPI(title="PDF Bookmark Server")
app.include_router(projects.router, prefix="/api")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
