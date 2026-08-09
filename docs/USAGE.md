# PDF Bookmark Workspace — User Guide

A local web workspace for creating, editing, generating, validating, and writing
PDF outlines (bookmarks). The app stores a project's table of contents (TOC) as
JSON, renders the PDF beside a Monaco-based editor, and can use an
OpenAI-compatible vision language model (VLM) to extract outlines from printed
table-of-contents pages.

## Overview

- **Projects** — import one or more PDFs, browse them in a project library, and
  keep generation metadata with each project.
- **Workspace editor** — edit one or more TOC JSON files per project with live
  JSON validation and auto-save.
- **Preview** — validate the selected TOC file and write the resulting outline
  back into the project PDF.
- **AI generation** — scan the printed table-of-contents pages with a configured
  VLM provider and save the generated result as a TOC file.
- **Prompt Playground** — test prompts against a selected VLM provider,
  including backend-rendered PDF page images.
- **Tasks** — monitor background generation jobs, including status, progress,
  failures, and generated-result actions.

## Getting Started

1. Launch the app from the project root:

   ```bash
   ./bookmark
   ```

   The launcher builds the frontend on first run, serves the API and web UI on
   one port (`http://127.0.0.1:8000` by default), and opens the browser
   automatically. See `README.md` for launcher options such as `--port` and
   `--no-open`.

2. Upload one or more PDFs from the **Projects** page.
3. If you want AI generation, configure and test at least one
   OpenAI-compatible VLM API in **Settings**.
4. Configure the project's generation metadata before adding it to the queue:
   TOC page range, page offset, and VLM provider.

Project data lives under `server/workspace_data/` by default, including PDFs,
TOC files, metadata, task records, and generation caches. Set the
`BOOKMARK_WORKSPACE_DATA` environment variable to use a different location.

## Projects

The **Projects** page is the main entry point for project-level operations.

- **Import** — drag PDFs onto the upload area or use the file picker. Multiple
  PDFs can be uploaded at once; each PDF creates its own project. Upload
  failures are reported per file.
- **Open** — click a project row to open its workspace.
- **Configure generation** — open the row action menu and set the TOC page
  range, page offset, and VLM provider.
- **Select** — move the cursor near the left side of a row to reveal its
  checkbox. After selecting one or more projects, use the bottom selection bar
  for batch actions.
- **Add to queue** — enqueue selected projects for AI generation using each
  project's saved metadata.
- **Download PDF** — download the project's current bookmarked PDF as
  `<name>_bookmarked.pdf`.
- **Delete** — remove the project and all files associated with it after
  confirmation.

Each project stores the following metadata:

| Metadata          | Meaning                                                               |
| ----------------- | --------------------------------------------------------------------- |
| `page_offset`     | Offset used to map a relative TOC page to a real PDF page.            |
| `toc_start`       | First printed table-of-contents page, as a 1-based PDF page.          |
| `toc_end`         | Last printed table-of-contents page, as a 1-based PDF page.           |
| `provider_id`     | VLM provider used when this project is added to the generation queue. |
| `inject_toc_page` | Whether Preview should prepend a bookmark pointing to the TOC page.   |

### Page Offset and TOC Range

The app distinguishes between two page-number systems:

- **PDF page** — the physical page position in the PDF file, counted from 1.
- **Printed page** — the page number printed in the book and used by TOC
  entries.

For TOC entries with `attribute: "relative"`, the app computes:

```text
PDF page = printed page + page_offset
```

For example, if printed page `1` starts on PDF page `28`, set
`page_offset` to `27`. If the printed page and PDF page are the same, use `0`.
Negative offsets are valid when the printed numbering is ahead of the PDF page
position.

`toc_start` and `toc_end` are always 1-based PDF pages and form an inclusive
range. They identify the printed table-of-contents pages that the VLM should
scan, not the logical chapter pages referenced by TOC entries.

## Workspace Editor

The workspace shows the selected TOC JSON file on the left and the PDF preview
on the right. The two panes are separated by a draggable divider.

- **TOC files** — a project can contain multiple TOC JSON files. Use the file
  explorer button in the editor toolbar to switch files. The last opened file is
  remembered per project.
- **Auto-save** — editor changes are saved automatically after a short debounce.
  Project metadata such as page offset and TOC range is saved separately.
- **Validation** — the editor uses the same TOC JSON shape as the backend and
  highlights schema errors while editing.
- **Keyboard shortcuts** — Monaco editor contributions are enabled so common
  VS Code-style editing shortcuts are available.
- **Preview actions** — use **Preview** to validate and apply the current TOC;
  use the download button to export the current bookmarked PDF.

## Previewing

**Preview** validates the selected TOC JSON file, writes the outline into the
PDF, and replaces the project's `document.pdf` with the bookmarked copy. The
preview pane then reloads the updated PDF.

- Invalid JSON, invalid TOC shape, and out-of-range pages are rejected before
  writing.
- If writing fails, the previous successful PDF is kept.
- Preview settings are opened from the chevron next to the **Preview** button:
  - **Page offset** — used when resolving `relative` TOC pages.
  - **Inject ToC page** — when enabled, a top-level bookmark pointing to
    `toc_start` is prepended automatically. The title is `目录` when CJK
    characters dominate the TOC titles and `Contents` otherwise. The injected
    bookmark uses `attribute: "absolute"`, is idempotent, and is persisted back
    into the TOC file being applied.

## AI Generation

AI generation can be started from either:

- the **Projects** page, by configuring one or more projects and clicking
  **Add to queue**; or
- the workspace toolbar, by clicking **AI Generate** for the current project.

Generation requires:

- a verified VLM provider;
- a valid `toc_start` / `toc_end` range; and
- a valid `page_offset`.

Each page in the TOC range is rendered at 220 DPI and sent to the VLM. The model
returns a flat list of entries for each page. The server then assembles entries
into a nested TOC tree, performs a hierarchy-correction pass, saves the result
as a generated TOC file, and attempts to apply it to the project PDF.

- **Auto-apply** — successful generations are applied automatically. If TOC
  generation succeeds but applying the result fails, the task is marked failed
  with a message such as `TOC generated but applying failed`; the generated TOC
  file can still be inspected and corrected manually.
- **Cache** — per-page VLM responses and final TOC outputs are cached under
  `workspace_data/cache/`. Cache keys include the PDF, page range, model, DPI,
  and rendered prompt. Repeating an identical run is fast; changing the prompt
  invalidates the relevant cache entries.

## Prompts

The page-scanning prompt is customizable in **Settings → Prompt** and supports
up to 20,000 characters. The following placeholders are substituted before the
request is sent:

| Placeholder   | Meaning                               |
| ------------- | ------------------------------------- |
| `{toc_start}` | First page of the TOC range, 1-based. |
| `{toc_end}`   | Last page of the TOC range, 1-based.  |
| `{pdf_name}`  | PDF file name without extension.      |

The default prompt asks the model to follow these rules:

1. Return a flat array only; do not nest entries.
2. Merge multi-line titles and remove leader dots such as
   `Chapter 1.......10`.
3. Process only content visible on the current scanned page.
4. Ignore headers, footers, page decorations, and non-TOC elements.
5. Preserve original numbering in titles, such as `1.2.3` or `Appendix A`.
6. Report visual indentation depth as `indent`, where `0` is top level.
7. Copy the printed page number as a string. Entries with roman numerals or
   unparsable page numbers are dropped by the reader.
8. For a heading without a visible page number, inherit the page of the first
   following entry in the same chapter when possible.

The model must return a JSON array only:

```json
[{ "text": "Full Title String", "page": "12", "indent": 0 }]
```

## Prompt Playground

Use **Playground** to iterate on extraction prompts without starting a full
generation task.

- Select a verified VLM API and a project PDF.
- Insert a PDF page image by page number. The image is rendered by the backend
  at 220 DPI through the same PyMuPDF path used by AI generation.
- Click **Inject prompt into chat** to copy the current playground prompt into
  the chat box, edit it if needed, then send. The server sends exactly the text
  visible in the chat box.
- Save the current playground prompt as the global page-scanning prompt.

When a page image is sent, the server re-renders the same project page and
checks its SHA-256 hash before forwarding the request. If the underlying PDF or
rendering output changed, the request is rejected and the page should be
inserted again. This keeps playground experiments reproducible with generation
runs.

## Settings

- **VLM APIs** — manage OpenAI-compatible providers. Each provider has a name,
  base URL, model, and API key. The provider list displays the API name; open a
  provider to edit its connection details.
- **Test provider** — sends a tiny synthetic image to the provider and expects
  the exact response `VLM_OK`. Only verified providers can be used for
  generation.
- **Prompt** — edit the global page-scanning prompt. **Restore default** resets
  it to the built-in prompt.
- **Inject ToC page** — configured per project from workspace preview settings.

## TOC JSON Format

The TOC is a JSON array. Every node must be an object with this shape:

| Field       | Type                         | Required | Description                                                                                                    |
| ----------- | ---------------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| `title`     | string                       | Yes      | Bookmark title. Blank titles are invalid.                                                                      |
| `page`      | number \| `null`             | Yes      | Printed page number for `relative` entries, PDF page for `absolute` entries, or `null` for heading-only nodes. |
| `attribute` | `"relative"` \| `"absolute"` | No       | How `page` is interpreted. Defaults to `"relative"`.                                                           |
| `children`  | array                        | Yes      | Nested child bookmarks. Use `[]` for leaf nodes.                                                               |

Page resolution rules:

- `relative` — `page + page_offset` yields the 1-based PDF page.
- `absolute` — `page` is already the 1-based PDF page; `page_offset` is ignored.
- `page: null` — used for heading-only nodes. The backend resolves the bookmark
  target from the first child with a page, or from the next sibling when needed.

Example:

```json
[
  {
    "title": "Part I",
    "page": null,
    "children": [
      {
        "title": "Chapter 1",
        "page": 1,
        "children": [
          {
            "title": "Introduction",
            "page": 1,
            "children": []
          },
          {
            "title": "Background",
            "page": 4,
            "children": []
          }
        ]
      }
    ]
  },
  {
    "title": "Contents",
    "page": 3,
    "attribute": "absolute",
    "children": []
  }
]
```

## Tasks

The **Tasks** page lists generation jobs across all projects.

- **Status** — `queued`, `running`, `succeeded`, or `failed`.
- **Progress** — while a task is running, the page-level progress bar reports
  rendering, scanning, cache loading, processing, and saving phases.
- **Filters** — All / Active / Succeeded / Failed.
- **Actions** — open the related project. For succeeded jobs, generated results
  can also be applied or downloaded when the task record still references an
  available project.
