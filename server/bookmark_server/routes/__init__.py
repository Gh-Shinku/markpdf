from __future__ import annotations

from fastapi import APIRouter

from . import generation_jobs, playground, projects, settings


api_router = APIRouter()
api_router.include_router(projects.router)
api_router.include_router(generation_jobs.router)
api_router.include_router(settings.router)
api_router.include_router(playground.router)
