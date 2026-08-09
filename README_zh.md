# PDF Bookmark Workspace

用于本地管理 PDF 目录 JSON、生成书签并预览结果的桌面式 WebUI。

- 使用指南(导入、编辑、AI 生成、设置):[docs/USAGE.md](docs/USAGE.md)
- 应用内置文档页面:启动后访问 `http://127.0.0.1:5173/docs`
- English README:[README.md](README.md)

## 环境要求

- **uv**：用于后端依赖管理与启动，必需。
- **Python 3.12+**：后端要求的 Python 版本。`uv` 可以安装并管理兼容版本；但 Unix 启动脚本还会调用 `python3` 做端口检查，因此本机也需要可用的 `python3` 命令。
- **Node.js / npm**：用于安装和构建前端，必需。为满足 Vite 的 engine 要求，建议使用 Node.js `^20.19.0` 或 `>=22.12.0`。

## Run

启动应用(首次运行会自动构建前端,API 与 Web UI 共用同一端口,并自动打开浏览器):

```bash
./bookmark              # http://127.0.0.1:8000
./bookmark --port 8123  # 指定其他端口
./bookmark --no-open    # 不自动打开浏览器
```

启动器在前台常驻,便于查看日志与应用 URL。按 `Ctrl+C` 停止。

Windows 上使用批处理启动器:

```bat
bookmark.bat              :: http://127.0.0.1:8000
bookmark.bat --port 8123  :: 指定其他端口
```

### 开发模式

启动后端:

```bash
cd server
uv sync --group dev
uv pip install -e .
uv run uvicorn bookmark_server.main:app --reload --host 127.0.0.1 --port 8000
```

启动前端:

```bash
cd web
npm install
npm run dev
```

打开 `http://127.0.0.1:5173/`。Vite 会将 `/api/*` 转发到本地后端。
`npm run build` 将生产前端输出到 `web/dist`,后端检测到该目录后会自动托管
(可用 `BOOKMARK_WEB_DIST` 覆盖路径)。

项目数据默认存储在 `server/workspace_data/`。可在启动后端时通过
`BOOKMARK_WORKSPACE_DATA` 指定其他本地目录。

## Dev

- 服务端测试:`cd server && uv run pytest`(或 `uv run pytest -q`)。
- 前端检查:`cd web && npm run check`(format / lint / css lint / build / test)。
- 目录结构:

```text
server/bookmark_server/
  core/        PDF 书签写入与 TOC 校验、注入逻辑
  routes/      FastAPI 路由(projects、jobs、settings)
  services/    生成任务、VLM 提取管线(缓存、建树、层级校正)
server/tests/  服务端测试
web/src/       React 前端(Home / Tasks / Settings / Workspace / Docs 页面)
docs/          USAGE.md(用户指南,应用内渲染)
```
