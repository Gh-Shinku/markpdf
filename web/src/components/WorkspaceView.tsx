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
  Loader2,
  Play,
  Wand2
} from "lucide-react";
import { JsonEditor, type JsonEditorHandle } from "../JsonEditor";
import type { PreviewPdf, Project, Status } from "../types";
import { formatDate } from "../utils";
import { PdfViewer } from "./PdfViewer";

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
      <header className="topbar workspace-topbar">
        <button className="home-logo-button" type="button" aria-label="Home" onClick={onReturnHome}>
          <BookMarked size={20} aria-hidden="true" />
        </button>
      </header>

      <section className="workspace-grid" ref={workspaceRef} style={workspaceStyle}>
        <section className="editor-pane">
          <div className="pane-header">
            <div>
              <h2>TOC JSON</h2>
              <p>Autosaved - updated {formatDate(project?.toc_updated_at ?? null)}</p>
            </div>
            <button
              className="secondary-action"
              type="button"
              disabled={!project || status.kind === "loading"}
              onClick={onOpenGenerateDialog}
            >
              <Wand2 size={16} />
              AI Generate
            </button>
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
          <div className="pdf-frame">
            {project ? (
              <PdfViewer
                source={pdfFrameSrc}
                toolbarStart={(
                  <div className="pdf-meta-leading">
                    <button
                      className="primary-action"
                      type="button"
                      disabled={!canUseProjectActions}
                      onClick={onApplyPreview}
                    >
                      {status.kind === "loading" ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
                      Preview
                    </button>
                  </div>
                )}
                toolbarControlsExtra={(
                  <label className="offset-control">
                    <span>Offset</span>
                    <input
                      type="number"
                      step="1"
                      value={pageOffset}
                      onChange={(event) => onPageOffsetChange(event.target.value)}
                    />
                  </label>
                )}
                toolbarEnd={(
                  <div className="preview-statusbar">
                    {previewPdf ? (
                      <a className="download-action" href={previewPdf.url} download={previewPdf.filename}>
                        <Download size={16} />
                        Download
                      </a>
                    ) : null}
                  </div>
                )}
              />
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
