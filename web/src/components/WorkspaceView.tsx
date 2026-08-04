import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject
} from "react";
import {
  BookMarked,
  Download,
  FileText,
  Home,
  Loader2,
  Play,
  Settings,
  Wand2
} from "lucide-react";
import { JsonEditor, type JsonEditorHandle } from "../JsonEditor";
import type { PreviewPdf, Project, Status } from "../types";
import { formatDate } from "../utils";
import { PdfViewer } from "./PdfViewer";
import { StatusLine } from "./StatusLine";

type WorkspaceViewProps = {
  project: Project | null;
  tocText: string;
  pageOffset: string;
  status: Status;
  canUseProjectActions: boolean;
  previewPdf: PreviewPdf | null;
  pdfVersion: number;
  isResizing: boolean;
  workspaceStyle: CSSProperties;
  workspaceRef: RefObject<HTMLElement | null>;
  editorRef: RefObject<JsonEditorHandle | null>;
  splitPercent: number;
  minSplitPercent: number;
  maxSplitPercent: number;
  onReturnHome: () => void;
  onPageOffsetChange: (value: string) => void;
  onOpenGenerateDialog: () => void;
  onApplyPreview: () => void;
  onOpenSettings: () => void;
  onEditorChange: (value: string) => void;
  onSplitterKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onSplitterPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onSplitterPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onSplitterPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onSplitterPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
};

export function WorkspaceView({
  project,
  tocText,
  pageOffset,
  status,
  canUseProjectActions,
  previewPdf,
  pdfVersion,
  isResizing,
  workspaceStyle,
  workspaceRef,
  editorRef,
  splitPercent,
  minSplitPercent,
  maxSplitPercent,
  onReturnHome,
  onPageOffsetChange,
  onOpenGenerateDialog,
  onApplyPreview,
  onOpenSettings,
  onEditorChange,
  onSplitterKeyDown,
  onSplitterPointerDown,
  onSplitterPointerMove,
  onSplitterPointerUp,
  onSplitterPointerCancel
}: WorkspaceViewProps) {
  const pdfFrameSrc = project
    ? previewPdf?.url ?? `/api/projects/${project.id}/pdf?v=${pdfVersion}`
    : "";

  return (
    <main className={`app-shell${isResizing ? " resizing" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <BookMarked size={22} aria-hidden="true" />
          <div>
            <h1>{project?.name ?? "PDF Bookmark Workspace"}</h1>
            <p>
              {project
                ? `${project.pdf_filename} - ${project.page_count} pages`
                : "Editor and preview for TOC JSON."}
            </p>
          </div>
        </div>

        <div className="toolbar">
          <button className="secondary-action" type="button" onClick={onReturnHome}>
            <Home size={16} />
            Home
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={!project || status.kind === "loading"}
            onClick={onOpenGenerateDialog}
          >
            <Wand2 size={16} />
            AI Generate
          </button>
          <button
            className="primary-action"
            type="button"
            disabled={!canUseProjectActions}
            onClick={onApplyPreview}
          >
            {status.kind === "loading" ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
            Preview
          </button>
          {previewPdf ? (
            <a className="download-action" href={previewPdf.url} download={previewPdf.filename}>
              <Download size={16} />
              Download
            </a>
          ) : null}
          <button className="secondary-action icon-only" type="button" onClick={onOpenSettings}>
            <Settings size={16} />
          </button>
        </div>
      </header>

      <section className="workspace-grid" ref={workspaceRef} style={workspaceStyle}>
        <section className="editor-pane">
          <div className="pane-header">
            <div>
              <h2>TOC JSON</h2>
              <p>Autosaved - updated {formatDate(project?.toc_updated_at ?? null)}</p>
            </div>
          </div>

          <JsonEditor ref={editorRef} value={tocText} onChange={onEditorChange} />
        </section>

        <div
          className="splitter"
          role="separator"
          aria-label="Resize editor and preview panes"
          aria-orientation="vertical"
          aria-valuemin={minSplitPercent}
          aria-valuemax={maxSplitPercent}
          aria-valuenow={Math.round(splitPercent)}
          tabIndex={0}
          onKeyDown={onSplitterKeyDown}
          onPointerDown={onSplitterPointerDown}
          onPointerMove={onSplitterPointerMove}
          onPointerUp={onSplitterPointerUp}
          onPointerCancel={onSplitterPointerCancel}
        />

        <section className="preview-pane">
          <div className="pane-header">
            <div>
              <h2>{previewPdf ? "Bookmarked Preview" : "Source PDF"}</h2>
              <p>{project ? project.pdf_filename : "No PDF selected"}</p>
            </div>
            <div className="preview-statusbar">
              <label className="offset-control">
                <span>Offset</span>
                <input
                  type="number"
                  step="1"
                  value={pageOffset}
                  onChange={(event) => onPageOffsetChange(event.target.value)}
                />
              </label>
              <StatusLine status={status} />
            </div>
          </div>

          <div className="pdf-frame">
            {project ? (
              <PdfViewer source={pdfFrameSrc} />
            ) : (
              <div className="empty-preview">
                <FileText size={34} />
                <span>Select a project to render it here.</span>
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
