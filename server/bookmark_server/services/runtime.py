from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from .generation_jobs import generation_job_store
from .projects import store


generation_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="toc-generation")
