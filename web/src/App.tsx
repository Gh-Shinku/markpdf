import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BookMarked,
  CheckCircle2,
  Download,
  FileJson,
  FileText,
  Loader2,
  Upload
} from "lucide-react";

type Status =
  | { kind: "idle"; message: string }
  | { kind: "loading"; message: string }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

type DownloadState = {
  url: string;
  filename: string;
};

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

export function App() {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [jsonFile, setJsonFile] = useState<File | null>(null);
  const [pageOffset, setPageOffset] = useState("0");
  const [status, setStatus] = useState<Status>({
    kind: "idle",
    message: "Ready to apply bookmarks"
  });
  const [download, setDownload] = useState<DownloadState | null>(null);

  const canSubmit = useMemo(
    () => Boolean(pdfFile && jsonFile && pageOffset.trim() && status.kind !== "loading"),
    [jsonFile, pageOffset, pdfFile, status.kind]
  );

  useEffect(() => {
    return () => {
      if (download) {
        URL.revokeObjectURL(download.url);
      }
    };
  }, [download]);

  function updatePdf(event: ChangeEvent<HTMLInputElement>) {
    setPdfFile(event.target.files?.[0] ?? null);
    setDownload(null);
  }

  function updateJson(event: ChangeEvent<HTMLInputElement>) {
    setJsonFile(event.target.files?.[0] ?? null);
    setDownload(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pdfFile || !jsonFile) {
      setStatus({ kind: "error", message: "Select both a PDF and a TOC JSON file" });
      return;
    }

    const offset = Number.parseInt(pageOffset, 10);
    if (!Number.isInteger(offset)) {
      setStatus({ kind: "error", message: "Page offset must be an integer" });
      return;
    }

    if (download) {
      URL.revokeObjectURL(download.url);
      setDownload(null);
    }

    const formData = new FormData();
    formData.append("pdf", pdfFile);
    formData.append("toc_json", jsonFile);
    formData.append("page_offset", String(offset));

    setStatus({ kind: "loading", message: "Applying bookmarks to PDF" });
    try {
      const response = await fetch("/api/apply", {
        method: "POST",
        body: formData
      });
      if (!response.ok) {
        throw new Error(await parseError(response));
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const filename = `${pdfFile.name.replace(/\.pdf$/i, "")}_bookmarked.pdf`;
      setDownload({ url, filename });
      setStatus({ kind: "success", message: "Bookmarked PDF is ready" });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to apply bookmarks"
      });
    }
  }

  const statusIcon =
    status.kind === "loading" ? (
      <Loader2 className="spin" size={18} />
    ) : status.kind === "success" ? (
      <CheckCircle2 size={18} />
    ) : status.kind === "error" ? (
      <AlertCircle size={18} />
    ) : (
      <BookMarked size={18} />
    );

  return (
    <main className="app-shell">
      <section className="workspace">
        <div className="title-row">
          <BookMarked size={30} aria-hidden="true" />
          <div>
            <h1>PDF Bookmark Workspace</h1>
            <p>Apply structured TOC JSON to scanned PDF books.</p>
          </div>
        </div>

        <div className="content-grid">
          <form className="tool-panel" onSubmit={submit}>
            <label className="file-input">
              <span className="input-label">
                <FileText size={18} />
                Source PDF
              </span>
              <input type="file" accept="application/pdf,.pdf" onChange={updatePdf} />
              <span className="file-name">{selectedFileLabel(pdfFile)}</span>
            </label>

            <label className="file-input">
              <span className="input-label">
                <FileJson size={18} />
                TOC JSON
              </span>
              <input type="file" accept="application/json,.json" onChange={updateJson} />
              <span className="file-name">{selectedFileLabel(jsonFile)}</span>
            </label>

            <label className="number-field">
              <span>Page offset</span>
              <input
                type="number"
                step="1"
                value={pageOffset}
                onChange={(event) => setPageOffset(event.target.value)}
              />
            </label>

            <div className={`status-line ${status.kind}`}>
              {statusIcon}
              <span>{status.message}</span>
            </div>

            <div className="actions">
              <button type="submit" disabled={!canSubmit}>
                {status.kind === "loading" ? <Loader2 className="spin" size={18} /> : <Upload size={18} />}
                Apply bookmarks
              </button>
              {download ? (
                <a className="download-link" href={download.url} download={download.filename}>
                  <Download size={18} />
                  Download PDF
                </a>
              ) : null}
            </div>
          </form>

          <aside className="details-panel">
            <div>
              <h2>Input Contract</h2>
              <p>JSON must be a top-level array of bookmark nodes.</p>
            </div>
            <pre>{`[
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
]`}</pre>
            <dl>
              <div>
                <dt>PDF</dt>
                <dd>{selectedFileLabel(pdfFile)}</dd>
              </div>
              <div>
                <dt>JSON</dt>
                <dd>{selectedFileLabel(jsonFile)}</dd>
              </div>
              <div>
                <dt>Mapping</dt>
                <dd>relative: page + {pageOffset || "0"} · absolute: PDF page number</dd>
              </div>
            </dl>
          </aside>
        </div>
      </section>
    </main>
  );
}
