# PDF Bookmark Generator with VLM

A CLI tool for scanned (image-only) PDFs that:

1. Renders specified Table of Contents (TOC) pages into images.
2. Uses a Vision Language Model (VLM) to recognize the hierarchical TOC structure.
3. Injects bookmarks into the PDF using PyMuPDF.

## Installation

Dependencies are managed via `pyproject.toml`. It is recommended to use `uv`:

```bash
uv sync
```

## CLI Usage

```bash
uv run pdf-bookmark INPUT_PDF OUTPUT_PDF \
	--toc-start 5 \
	--toc-end 9 \
	--page-offset 12
```

### Arguments

- `INPUT_PDF`: Path to the source PDF.
- `OUTPUT_PDF`: Path where the bookmarked PDF will be saved.
- `--toc-start`: The first page of the TOC in the PDF (0-based index, inclusive).
- `--toc-end`: The last page of the TOC in the PDF (0-based index, inclusive).
- `--page-offset`: The offset to convert book page numbers to PDF page indices:

	`pdf_page_index = book_page + page_offset`

- `--api-key`: Optional. VLM API Key (defaults to `DASHSCOPE_API_KEY` environment variable).
- `--base-url`: Optional. API endpoint (defaults to DashScope).
- `--model`: Optional. VLM model name (defaults to `qwen3.5-omni-plus`).
- `--dpi`: Optional. Resolution for rendering TOC pages (defaults to `220`).
- `--cache-dir`: Optional. Directory to store recognized TOC JSON (defaults to `cache`).
- `--overwrite-cache`: Optional. Ignore existing cache and call VLM again.

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
- **Cache Hit**: The program skips VLM calls if a matching cache is found in `--cache-dir`. Use `--overwrite-cache` to force a re-scan.
