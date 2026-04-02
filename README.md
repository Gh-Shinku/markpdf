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

### Extract TOC JSON

```bash
uv run pdf-bookmark extract INPUT_PDF OUTPUT_JSON \
	--toc-start 5 \
	--toc-end 9
```

Options:

- `INPUT_PDF`: Path to the source PDF.
- `OUTPUT_JSON`: Path to save extracted TOC JSON.
- `--toc-start`: The first TOC page in the PDF (0-based, inclusive).
- `--toc-end`: The last TOC page in the PDF (0-based, inclusive).
- `--api-key`: Optional. VLM API Key (defaults to `DASHSCOPE_API_KEY`).
- `--base-url`: Optional. API endpoint (defaults to DashScope).
- `--model`: Optional. VLM model name.
- `--dpi`: Optional. Render DPI for TOC pages (default: `220`).
- `--cache-dir`: Optional. Directory for TOC JSON cache (default: `cache`).
- `--overwrite-cache`: Optional. Ignore existing cache and force new VLM extraction.

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
- `--page-offset`: Offset to convert book page numbers to PDF page indices:

	`pdf_page_index = book_page + page_offset`

## API Configuration

```bash
export DASHSCOPE_API_KEY="your_key"
```

## VLM Response Format

The tool expects a strict JSON array from the VLM:

```json
[
	{
		"title": "Chapter 1: Introduction",
		"page": 1,
		"children": [
			{
				"title": "1.1 Background",
				"page": 3,
				"children": []
			}
		]
	}
]
```

### Notes on Format:
- `page`: Must be the **actual page number printed in the book**, not the PDF index.
- If a node has no page (e.g., a "Part" header), use `null`. The tool will automatically resolve the target page from its first child.
- `children`: Must always be present (use `[]` if empty).

## Troubleshooting

- **Inaccurate Recognition**: Try increasing `--dpi` or using a more capable `--model`.
- **Page Out of Range**: Usually indicates an incorrect `--page-offset`.
- **Cache Hit**: `extract` skips VLM calls if a matching cache exists in `--cache-dir`. Use `--overwrite-cache` to force re-extraction.
