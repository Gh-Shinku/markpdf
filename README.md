# PDF Bookmark Workspace

A desktop-style web UI for managing PDF outline (bookmark) JSON locally, generating outlines from printed table-of-contents pages with a vision language model (VLM), and writing the results back into the PDF.

- **User guide**: [docs/USAGE.md](docs/USAGE.md)
- **In-app documentation**: visit `http://127.0.0.1:5173/docs` after starting the app
- **中文文档**: [README_zh.md](README_zh.md)

## Run

Start the backend:

```bash
cd server
uv sync --group dev
uv pip install -e .
uv run uvicorn bookmark_server.main:app --reload --host 127.0.0.1 --port 8000
```

Start the frontend:

```bash
cd web
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`. Vite proxies `/api/*` to the local backend.

Project data is stored in `server/workspace_data/` by default. Set the
`BOOKMARK_WORKSPACE_DATA` environment variable before starting the backend to
use a different directory.

## Dev

- Server tests: `cd server && uv run pytest` (or `uv run pytest -q`).
- Frontend checks: `cd web && npm run check` (format / lint / css lint / build / test).
- Layout:

```text
server/bookmark_server/
  core/        PDF bookmark writing, TOC validation and injection
  routes/      FastAPI routes (projects, jobs, settings)
  services/    generation jobs, VLM extraction pipeline (cache, tree assembly, level correction)
server/tests/  server tests
web/src/       React frontend (Home / Tasks / Settings / Workspace / Docs views)
docs/          USAGE.md (user guide, rendered in-app)
```
