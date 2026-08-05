# PDF Bookmark Server

本目录是 PDF Bookmark Workspace 的独立 Python 后端项目。

```bash
uv sync --group dev
uv pip install -e .
uv run uvicorn bookmark_server.main:app --reload --host 127.0.0.1 --port 8000
```

运行测试：

```bash
uv run pytest -q
```
