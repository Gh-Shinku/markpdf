# PDF Bookmark Workspace — User Guide

A local web UI for managing PDF outline (bookmark) JSON, generating outlines with a
vision language model (VLM), and writing the result back into the PDF.

## Overview

- **Projects** — import PDFs, browse them in a library, and maintain one or more
  TOC JSON files per project.
- **Workspace editor** — edit TOC JSON in a Monaco-based editor with live
  validation; edits auto-save.
- **Preview** — validate and write the outline into the PDF with one click.
  The project PDF is replaced by a bookmarked copy.
- **AI generation** — a VLM scans the printed table-of-contents pages of the PDF
  and produces a TOC JSON file, which is applied to the project automatically.
- **Tasks** — a job list shows generation progress, failures, and per-job
  downloads.

## Getting Started

1. Launch the app from the project root:

   ```bash
   ./bookmark
   ```

   The launcher builds the frontend on first run, serves the API and the web
   UI on one port (`http://127.0.0.1:8000` by default), and opens the browser
   automatically. See `README.md` for options (`--port`, `--no-open`).
2. Upload one or more PDFs from the **Projects** page.
3. Configure at least one OpenAI-compatible VLM API in **Settings** if you want
   to use AI generation.

Project data (PDFs, TOC files, caches) lives under `server/workspace_data/` by
default; the backend reads the `BOOKMARK_WORKSPACE_DATA` environment variable to
override the location.

## Projects

- **Import** — drag PDFs onto the upload zone or use the file picker. Multiple
  files are imported in parallel; failures are reported per file.
- **Open** — click a project row to open its workspace.
- **Select** — use the checkboxes to multi-select projects, then run batch
  actions from the floating bar: **Generate**, **Download**, or **Delete**.
- **Download** — exports the project PDF with the applied outline
  (`<name>_bookmarked.pdf`).
- **Delete** — removes the project and all of its files. Confirm when prompted.

Each project stores generation settings: page offset, TOC start/end pages, and
the VLM provider to use.

## Workspace Editor

The workspace shows the TOC JSON on the left (Monaco editor) and the PDF preview
on the right, split by a draggable divider.

- **TOC files** — a project can hold multiple TOC JSON files. Open the file
  explorer (leftmost button in the editor toolbar) to switch between them. The
  last opened file is remembered per project and restored next time.
- **Auto-save** — edits are saved automatically (debounced) as you type; the
  page offset and other metadata are saved immediately.
- **Page offset** — relative page numbers in the TOC are shifted by this value
  (0-based offset, i.e. `1` means "subtract 1"). Change it from the Preview
  settings menu.
- **Keyboard** — the editor supports the usual Monaco shortcuts (Ctrl+F search,
  Ctrl+Z undo, etc.).

## Previewing

**Preview** validates the current TOC JSON, writes the outline into the PDF,
and replaces the project's `document.pdf`. The preview pane then shows the
bookmarked file.

- The validation step reports problems before writing; invalid JSON or
  out-of-range pages are rejected with an error message.
- If writing fails, the previous successful PDF version is kept.
- Preview settings (the chevron next to the Preview button):
  - **Page offset** — same value used by the editor.
  - **注入目录 page** (Inject ToC page) — when enabled, a bookmark pointing to
    the first table-of-contents page is prepended automatically. The title is
    `目录` for CJK-heavy documents and `Contents` otherwise. The injection is
    idempotent and is persisted back into the TOC file being applied.

## AI Generation

From the workspace toolbar, click **AI Generate** (the wand button; the chevron
opens the same settings) and choose:

- **VLM API** — which configured provider to use.
- **TOC start page / TOC end page** — the 1-based page range of the printed
  table of contents in the PDF (the pages that will be scanned).

Generation runs as a background job (see **Tasks**). Each page in the range is
rendered at 220 DPI and sent to the VLM, which returns a flat list of entries.
The server then assembles the entries into a nested tree, fixes indentation
levels with a second LLM call, and saves the result as a TOC file.

- **Auto-apply** — successful generations are applied to the project
  automatically (equivalent to clicking Preview). If applying fails, the job is
  marked **failed** with the message *"TOC generated but applying failed"* so
  you can inspect and fix it manually.
- **Cache** — per-page VLM results and final TOCs are cached under
  `workspace_data/cache/`, keyed by PDF, page range, model, DPI, and the exact
  rendered prompt. Rerunning the same range is instant; changing the prompt
  invalidates the cache and triggers a rescan.

## Prompts

The prompt used for page scanning is fully customizable in **Settings →
Prompt** (up to 20,000 characters). Three placeholders are substituted before
the request is sent:

| Placeholder | Meaning |
| --- | --- |
| `{toc_start}` | First page of the TOC range (1-based) |
| `{toc_end}` | Last page of the TOC range (1-based) |
| `{pdf_name}` | The PDF file name without extension |

The default prompt asks the model to obey these rules:

1. **Flat output** — every entry is a direct element of the root array, never nested.
2. **Text cleaning** — merge multi-line titles; strip leader dots
   (`Chapter 1.......10` → text `Chapter 1`, page 10).
3. **Page range** — only process content visible on the current page.
4. **Filtering** — ignore headers, footers, and decorative elements.
5. **Verbatim** — keep the original numbering (`1.2.3`, `Appendix A`) in the text.
6. **Indent level** — report the visual indentation depth (0 = top level) so the
   server can rebuild nesting.
7. **Page numbers** — copy the printed page number exactly as a string
   (`'12'` or `'vii'`); entries with roman numerals or unparsable page numbers
   are dropped by the reader.
8. **Missing page numbers** — a heading without a printed page number inherits
   the page of the first entry that follows it within the same chapter.

The model must reply with a JSON array only:

```json
[{"text": "Full Title String", "page": "12", "indent": 0}]
```

## Settings

- **VLM APIs** — manage OpenAI-compatible providers (base URL, model, API key).
  Click **Test** to verify a provider: the backend sends a tiny synthetic image
  and expects the model to answer `VLM_OK`. Only verified providers can be used
  for generation.
- **Prompt** — edit the scanning prompt (see above). **Restore default** brings
  back the built-in prompt. The prompt is stored globally and applies to all
  projects.
- **Inject ToC page** is a per-project option in the workspace preview settings
  (see *Previewing*).

## TOC JSON Format

The TOC is a JSON array. Every entry has:

| Field | Type | Description |
| --- | --- | --- |
| `title` | string | The bookmark text. |
| `page` | number | The page number as printed in the PDF. |
| `attribute` | `"relative"` \| `"absolute"` (optional) | How `page` is interpreted; defaults to `"relative"`. |
| `children` | array (optional) | Nested sub-bookmarks. |

- **relative** — the printed page number plus the project's page offset yields
  the real PDF page (1-based).
- **absolute** — `page` is already the 1-based PDF page; the offset is ignored.

Example:

```json
[
  {
    "title": "Chapter 1",
    "page": 1,
    "children": [
      { "title": "Introduction", "page": 1 },
      { "title": "Background", "page": 4 }
    ]
  },
  {
    "title": "Chapter 2",
    "page": 10,
    "attribute": "relative"
  }
]
```

## Tasks

The **Tasks** page lists every generation job across all projects.

- **Status** — `queued`, `running`, `succeeded`, or `failed`, with a progress
  bar while running. A job that generated a TOC but failed to apply it is
  marked `failed` with the reason shown.
- **Filters** — All / Active / Succeeded / Failed.
- **Actions** — open the project, apply the generated TOC to the project PDF
  (`Apply`), or download the bookmarked PDF without applying.

## FAQ / Troubleshooting

**The generation job is slow.** Pages are rendered at 220 DPI and scanned one
by one. Reruns of the same page range are served from cache and are much
faster.

**My prompt changes did nothing.** The cache key includes the exact rendered
prompt. After editing the prompt, the first run rescans every page; afterwards
results are cached again.

**Roman-numeral pages (i, ii, iii…) are missing from the result.** By design —
the reader drops entries whose printed page number is a roman numeral or cannot
be parsed.

**The backend can't reach the VLM provider.** If you run behind a local HTTP
proxy, the proxy may intercept requests to `127.0.0.1` (a common issue on
Linux). Configure your proxy to bypass localhost, or unset it for the backend
process.

**Preview says the TOC is invalid.** Check the reported issues: page numbers
out of range, missing `title`/`page`, or invalid JSON. Use the validation
message in the workspace to locate the offending entry.

**Where is my data?** Everything lives in the workspace data directory
(`server/workspace_data/` by default): project PDFs, TOC files, and the
generation cache. Back it up to keep your library.
