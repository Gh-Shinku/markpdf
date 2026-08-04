from __future__ import annotations

import shutil
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4


RUNTIME_DIR = Path(".runtime")
JOBS_DIR = RUNTIME_DIR / "jobs"


@dataclass
class JobWorkspace:
    path: Path

    @classmethod
    def create(cls) -> "JobWorkspace":
        path = JOBS_DIR / uuid4().hex
        path.mkdir(parents=True, exist_ok=False)
        return cls(path=path)

    def cleanup(self) -> None:
        shutil.rmtree(self.path, ignore_errors=True)
