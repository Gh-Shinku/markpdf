import { ChangeEvent, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BookMarked,
  CheckCircle2,
  Download,
  FileJson,
  FileText,
  Loader2,
  Play,
  Upload
} from "lucide-react";
import { JsonEditor } from "./JsonEditor";

type Status =
  | { kind: "idle"; message: string }
  | { kind: "loading"; message: string }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

type PdfSource = {
  url: string;
  filename: string;
  kind: "source" | "generated";
};

const EMPTY_TOC = `[
  {
    "title": "Contents",
    "page": 4,
    "attribute": "absolute",
    "children": []
  },
  {
    "title": "Chapter 1",
    "page": 1,
    "attribute": "relative",
    "children": []
  }
]`;

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function selectedFileLabel(file: File | null): string {
  return file ? `${file.name} · ${formatBytes(file.size)}` : "No file selected";
}

async function parseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string") {
      return body.detail;
    }
    return JSON.stringify(body.detail ?? body);
  } catch {
    return `Request failed with HTTP ${response.status}`;
  }
}

function makeBookmarkedFilename(file: File): string {
  return `${file.name.replace(/\.pdf$/i, "")}_bookmarked.pdf`;
}

export function App() {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [jsonFileName, setJsonFileName] = useState<string | null>(null);
  const [tocText, setTocText] = useState(EMPTY_TOC);
  const [pageOffset, setPageOffset] = useState("0");
  const [status, setStatus] = useState<Status>({
    kind: "idle",
    message: "Upload a PDF, edit TOC JSON, then preview the result"
  });
  const [sourcePdf, setSourcePdf] = useState<PdfSource | null>(null);
  const [previewPdf, setPreviewPdf] = useState<PdfSource | null>(null);

  const canPreview = useMemo(
    () => Boolean(pdfFile && tocText.trim() && pageOffset.trim() && status.kind !== "loading"),
    [pageOffset, pdfFile, status.kind, tocText]
  );

  useEffect(() => {
    return () => {
      if (sourcePdf) {
        URL.revokeObjectURL(sourcePdf.url);
      }
      if (previewPdf && previewPdf.url !== sourcePdf?.url) {
        URL.revokeObjectURL(previewPdf.url);
      }
    };
  }, [previewPdf, sourcePdf]);

  function replaceSourcePdf(next: PdfSource | null) {
    setSourcePdf((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous.url);
      }
      return next;
    });
  }

  function replacePreviewPdf(next: PdfSource | null) {
    setPreviewPdf((previous) => {
      if (previous && previous.url !== sourcePdf?.url) {
        URL.revokeObjectURL(previous.url);
      }
      return next;
    });
  }

  function updatePdf(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setPdfFile(file);
    if (!file) {
      replaceSourcePdf(null);
      replacePreviewPdf(null);
      setStatus({ kind: "idle", message: "Upload a PDF to start previewing" });
      return;
    }

    const source = {
      url: URL.createObjectURL(file),
      filename: file.name,
      kind: "source" as const
    };
    replaceSourcePdf(source);
    replacePreviewPdf(source);
    setStatus({ kind: "idle", message: "Source PDF loaded in preview" });
  }

  async function updateJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setJsonFileName(null);
      return;
    }

    try {
      const text = await file.text();
      setTocText(text);
      setJsonFileName(file.name);
      setStatus({ kind: "idle", message: "TOC JSON loaded into editor" });
    } catch {
      setStatus({ kind: "error", message: "Failed to read TOC JSON file" });
    }
  }

  async function preview() {
    if (!pdfFile) {
      setStatus({ kind: "error", message: "Select a source PDF first" });
      return;
    }

    const offset = Number.parseInt(pageOffset, 10);
    if (!Number.isInteger(offset)) {
      setStatus({ kind: "error", message: "Page offset must be an integer" });
      return;
    }

    try {
      JSON.parse(tocText);
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? `JSON syntax error: ${error.message}` : "Invalid JSON"
      });
      return;
    }

    const tocBlob = new Blob([tocText], { type: "application/json" });
    const formData = new FormData();
    formData.append("pdf", pdfFile);
    formData.append("toc_json", tocBlob, jsonFileName ?? "toc.json");
    formData.append("page_offset", String(offset));

    setStatus({ kind: "loading", message: "Generating preview PDF" });
    try {
      const response = await fetch("/api/apply", {
        method: "POST",
        body: formData
      });
      if (!response.ok) {
        throw new Error(await parseError(response));
      }

      const blob = await response.blob();
      const nextPreview = {
        url: URL.createObjectURL(blob),
        filename: makeBookmarkedFilename(pdfFile),
        kind: "generated" as const
      };
      replacePreviewPdf(nextPreview);
      setStatus({ kind: "success", message: "Preview PDF updated" });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to generate preview"
      });
    }
  }

  const statusIcon =
    status.kind === "loading" ? (
      <Loader2 className="spin" size={17} />
    ) : status.kind === "success" ? (
      <CheckCircle2 size={17} />
    ) : status.kind === "error" ? (
      <AlertCircle size={17} />
    ) : (
      <BookMarked size={17} />
    );

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <BookMarked size={24} aria-hidden="true" />
          <div>
            <h1>PDF Bookmark Workspace</h1>
            <p>Editor and preview for TOC JSON.</p>
          </div>
        </div>

        <div className="toolbar">
          <label className="upload-control">
            <FileText size={17} />
            <span>PDF</span>
            <input type="file" accept="application/pdf,.pdf" onChange={updatePdf} />
          </label>
          <label className="upload-control">
            <FileJson size={17} />
            <span>JSON</span>
            <input type="file" accept="application/json,.json" onChange={updateJson} />
          </label>
          <label className="offset-control">
            <span>Offset</span>
            <input
              type="number"
              step="1"
              value={pageOffset}
              onChange={(event) => setPageOffset(event.target.value)}
            />
          </label>
          <button className="primary-action" type="button" disabled={!canPreview} onClick={preview}>
            {status.kind === "loading" ? <Loader2 className="spin" size={17} /> : <Play size={17} />}
            Preview
          </button>
          {previewPdf?.kind === "generated" ? (
            <a className="download-action" href={previewPdf.url} download={previewPdf.filename}>
              <Download size={17} />
              Download
            </a>
          ) : null}
        </div>
      </header>

      <section className="workspace-grid">
        <section className="editor-pane">
          <div className="pane-header">
            <div>
              <h2>TOC JSON</h2>
              <p>{jsonFileName ?? "Untitled TOC"}</p>
            </div>
            <div className="file-meta">
              <Upload size={15} />
              <span>{selectedFileLabel(pdfFile)}</span>
            </div>
          </div>

          <JsonEditor value={tocText} onChange={setTocText} />

          <div className="schema-footer">
            <span>relative PDF page = page + offset</span>
            <span>absolute page = one-based PDF page</span>
          </div>
        </section>

        <section className="preview-pane">
          <div className="pane-header">
            <div>
              <h2>PDF Preview</h2>
              <p>{previewPdf ? previewPdf.filename : "No PDF selected"}</p>
            </div>
            <div className={`status-pill ${status.kind}`}>
              {statusIcon}
              <span>{status.message}</span>
            </div>
          </div>

          <div className="pdf-frame">
            {previewPdf ? (
              <iframe title="PDF preview" src={previewPdf.url} />
            ) : (
              <div className="empty-preview">
                <FileText size={34} />
                <span>Select a PDF to render it here.</span>
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
