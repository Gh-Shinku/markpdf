# PDF Bookmark Generator with VLM

A CLI tool for scanned (image-only) PDFs with a full extract-then-apply workflow:

1. Extract TOC JSON from TOC page images using a VLM.
2. Apply TOC JSON to a PDF as bookmarks using PyMuPDF.

## Installation

Dependencies are managed via `pyproject.toml`. It is recommended to use `uv`:

```bash
uv sync
```

## CLI Usage

The CLI now provides two subcommands:

- `extract`: Run VLM recognition and save TOC JSON.
- `apply`: Load TOC JSON and write bookmarks into a PDF.
- `remove-ocr`: Remove OCR text layer and keep page images unchanged.

## Web Workspace

The repository also contains a local web workspace for managing multiple PDF bookmark projects:

- `server/`: FastAPI backend that stores local projects and applies or generates TOC JSON.
- `web/`: React + Vite frontend with a Home Manager, Monaco TOC JSON editor, and PDF preview pane.

Project data is stored locally under `workspace_data/` by default. This includes uploaded PDFs,
TOC JSON files, generated outputs, cache files, and LLM settings. Override the location when
starting the backend if you want the data outside the repository:

```bash
BOOKMARK_WORKSPACE_DATA=/path/to/bookmark-data \
	uv run uvicorn server.bookmark_server.main:app --reload --host 127.0.0.1 --port 8000
```

Run the backend:

```bash
uv run uvicorn server.bookmark_server.main:app --reload --host 127.0.0.1 --port 8000
```

Run the frontend:

```bash
cd web
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`. The Vite dev server proxies `/api/*` to the FastAPI backend.
Both development servers are configured for localhost use.

In the Home Manager, create a project from a PDF and optionally attach an initial TOC JSON file.
Click a project to open the workspace. The right pane renders the source PDF inline; after
`Preview`, it renders the generated bookmarked PDF and exposes a `Download` link.

Workspace actions:

- `Save`: Persist the current editor content to the project's `toc.json`.
- `Validate`: Parse and validate TOC JSON against the source PDF and page offset.
- `Preview`: Validate, apply bookmarks, and render the generated PDF.
- `AI Generate`: Use the configured OpenAI-compatible VLM settings to generate TOC JSON from a
  TOC page range. This overwrites the saved project JSON after a confirmation dialog.
- `Settings`: Configure `base_url`, `model`, and API key for generation. The API key is stored in
  the local server settings file in plain text, so use this only in a trusted local workspace.

### Extract TOC JSON

```bash
uv run pdf-bookmark extract INPUT_PDF [OUTPUT_JSON] \
	--toc-start 5 \
	--toc-end 9
```

Options:

- `INPUT_PDF`: Path to the source PDF.
- `OUTPUT_JSON`: Optional path to save extracted TOC JSON. If omitted, extraction result is stored in cache only.
- `--toc-start`: The first TOC page in the PDF (1-based, inclusive).
- `--toc-end`: The last TOC page in the PDF (1-based, inclusive).
- `--api-key`: Optional. VLM API Key (defaults to `DASHSCOPE_API_KEY`).
- `--base-url`: Optional. API endpoint (defaults to DashScope).
- `--model`: Optional. VLM model name.
- `--dpi`: Optional. Render DPI for TOC pages (default: `220`).
- `--cache-dir`: Optional. Directory for TOC JSON cache (default: `cache`).
- `--overwrite-cache`: Optional. Ignore existing cache and force new VLM extraction.
- `--mode`: Optional. `tree` or `flat` extraction strategy (default: `tree`).
- `--rescan`: Optional. Only for `--mode flat`. Re-run recognition for selected TOC pages using per-page cache.
- `--pages`: Optional. Used with `--rescan`. 1-based page indexes in TOC slice, e.g. `5,8-10`.
- `--auto-apply`: Optional. Automatically apply extracted TOC and export bookmarked PDF.
- `--apply-output-pdf`: Required when `--auto-apply` is set.
- `--page-offset`: Required when `--auto-apply` is set.

Example: extract and export in one command

```bash
uv run pdf-bookmark extract INPUT_PDF \
	--toc-start 5 \
	--toc-end 9 \
	--mode flat \
	--auto-apply \
	--apply-output-pdf OUTPUT_PDF \
	--page-offset 12
```

Example: partial rescan in flat mode (only re-run selected TOC images)

```bash
uv run pdf-bookmark extract INPUT_PDF \
	--toc-start 5 \
	--toc-end 9 \
	--mode flat \
	--rescan \
	--pages 4-5
```

### Apply TOC JSON to PDF

```bash
uv run pdf-bookmark apply INPUT_PDF OUTPUT_PDF \
	--toc-json toc.json \
	--page-offset 12
```

Options:

- `INPUT_PDF`: Path to the source PDF.
- `OUTPUT_PDF`: Path where the bookmarked PDF will be saved.
- `--toc-json`: Path to the TOC JSON file (from `extract` or user-provided).
- `--page-offset`: Offset to convert relative book page numbers to one-based PDF page numbers:

	`pdf_page_number = logical_book_page + page_offset`

	The offset applies only to TOC nodes whose `attribute` is `relative`.

### Remove OCR Text Layer

Use this command when you want to strip selectable/searchable OCR text while preserving the scanned page images.

```bash
uv run pdf-bookmark remove-ocr INPUT_PDF OUTPUT_PDF
```

Options:

- `INPUT_PDF`: Path to the source PDF.
- `OUTPUT_PDF`: Path where the OCR-stripped PDF will be saved.

Implementation notes:

- A full-page redaction is applied per page.
- `images=fitz.PDF_REDACT_IMAGE_NONE` ensures images are not modified.
- The output is saved with `garbage=4` to clean up deleted OCR text data.

## API Configuration

```bash
export DASHSCOPE_API_KEY="your_key"
```

The CLI reads `DASHSCOPE_API_KEY` when `--api-key` is omitted. The web workspace reads generation
settings from its local Settings page instead.

## VLM Response Format

The tool expects a strict JSON array from the VLM:

```json
[
	{
		"title": "Chapter 1: Introduction",
		"page": 1,
		"attribute": "relative",
		"children": [
			{
				"title": "1.1 Background",
				"page": 3,
				"attribute": "relative",
				"children": []
			}
		]
	}
]
```

### Notes on Format:
- `page`: Page number for this entry. Its meaning depends on `attribute`.
- `attribute`: Optional. Use `relative` for logical book page numbers and `absolute` for one-based PDF page numbers. If omitted, `relative` is used.
- `relative`: Converted with `pdf_page_number = page + page_offset`.
- `absolute`: `page` is already the one-based PDF page number. `page_offset` is ignored.
- If a node has no page (e.g. a "Part" header), use `null`. The tool will automatically resolve the target page and attribute from its first child or following sibling.
- `children`: Must always be present (use `[]` if empty).

## Troubleshooting

- **Inaccurate Recognition**: Try increasing `--dpi` or using a more capable `--model`.
- **Mode Recommendation**: For TOCs with clear numbering/hierarchy patterns (for example `1`, `1.1`, `1.1.1`), prefer `--mode flat`.
- **Page Out of Range**: Usually indicates an incorrect `--page-offset` for relative pages or an invalid absolute PDF page number.
- **Cache Hit**: `extract` skips VLM calls if a matching cache exists in `--cache-dir`. Use `--overwrite-cache` to force re-extraction.
- **Partial Rescan**: In `flat` mode, the tool stores per-page cache files and can refresh only selected pages with `--rescan --pages ...`, then rebuild final TOC JSON.
