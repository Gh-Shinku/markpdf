# PDF Bookmark Workspace

用于本地管理 PDF 目录 JSON、生成书签并预览结果的桌面式 WebUI。

## Run

启动后端：

```bash
cd server
uv sync --group dev
uv pip install -e .
uv run uvicorn bookmark_server.main:app --reload --host 127.0.0.1 --port 8000
```

启动前端：

```bash
cd web
npm install
npm run dev
```

打开 `http://127.0.0.1:5173/`。Vite 会将 `/api/*` 转发到本地后端。

项目数据默认存储在 `server/workspace_data/`。可在启动后端时通过
`BOOKMARK_WORKSPACE_DATA` 指定其他本地目录。

## Workspace

- 导入 PDF 创建本地项目，并在 Monaco 编辑器中维护 TOC JSON。
- 编辑 JSON 和页码偏移会自动保存，但只有点击 Preview 才会写入 PDF。
- Preview 成功时替换项目唯一的 `document.pdf`；失败时保留最近一次成功版本。
- Settings 页面配置 OpenAI 兼容 VLM，以从指定目录页生成 TOC JSON。

TOC JSON 使用数组根节点。每项包含 `title`、`page`、可选 `attribute`
（`relative` 或 `absolute`）和 `children`。相对页码会加上项目页码偏移，
绝对页码直接使用 PDF 的一基页码。
