from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from .routes import projects
from .services.generation_jobs import generation_job_store


@asynccontextmanager
async def lifespan(_app: FastAPI):
    generation_job_store.recover_interrupted_jobs()
    yield


app = FastAPI(title="PDF Bookmark Server", lifespan=lifespan)
app.include_router(projects.router, prefix="/api")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
