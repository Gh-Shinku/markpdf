import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject
} from "react";
import {
  ArrowLeft,
  BookMarked,
  Download,
  FileText,
  Loader2,
  Play,
  Wand2
} from "lucide-react";
import { AppNavigation } from "./AppNavigation";
import { JsonEditor, type JsonEditorHandle } from "../JsonEditor";
import { StatusLine } from "./StatusLine";
import type { PreviewPdf, Project, Status } from "../types";
import { PdfViewer } from "./PdfViewer";

type WorkspaceViewProps = {
  project: Project | null;
  tocText: string;
  pageOffset: string;
  status: Status;
  theme: "light" | "dark";
  canUseProjectActions: boolean;
  isPreviewing: boolean;
  isGenerating: boolean;
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
  onOpenSettings: () => void;
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
  theme,
  canUseProjectActions,
  isPreviewing,
  isGenerating,
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
  onOpenSettings,
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
      <AppNavigation active="workspace" onHome={onReturnHome} onSettings={onOpenSettings} />
      <header className="workspace-header">
        <button className="back-button" type="button" onClick={onReturnHome}>
          <ArrowLeft size={17} aria-hidden="true" />
          <span>Projects</span>
        </button>
        <div className="workspace-title">
          <BookMarked size={17} aria-hidden="true" />
          <span>{project?.name ?? "Loading project"}</span>
        </div>
        {status.kind === "error" ? (
          <div className="workspace-header-status"><StatusLine status={status} /></div>
        ) : null}
      </header>

      <section className="workspace-grid" ref={workspaceRef} style={workspaceStyle}>
        <section className="editor-pane">
          <div className="pane-header">
            <div>
              <h2>TOC JSON</h2>
            </div>
            <button
              className="secondary-action"
              type="button"
              disabled={!project || isGenerating}
              onClick={onOpenGenerateDialog}
            >
              <Wand2 size={16} />
              AI Generate
            </button>
          </div>

          <JsonEditor ref={editorRef} value={tocText} theme={theme} onChange={onEditorChange} />
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
                      {isPreviewing ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
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
