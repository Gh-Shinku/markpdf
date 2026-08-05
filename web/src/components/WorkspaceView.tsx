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
import { PreviewSettingsMenu } from "./PreviewSettingsMenu";
import previewStyles from "./PreviewSettingsMenu.module.css";
import type { Project } from "../types";
import { PdfViewer } from "./PdfViewer";
import { makeBookmarkedFilename } from "../utils";

type WorkspaceViewProps = {
  project: Project | null;
  tocText: string;
  pageOffset: string;
  theme: "light" | "dark";
  canUseProjectActions: boolean;
  isPreviewing: boolean;
  isGenerating: boolean;
  pdfVersion: number;
  isResizing: boolean;
  workspaceStyle: CSSProperties;
  workspaceRef: RefObject<HTMLElement | null>;
  editorRef: RefObject<JsonEditorHandle | null>;
  splitPercent: number;
  minSplitPercent: number;
  maxSplitPercent: number;
  onReturnHome: () => void;
  onOpenTasks: () => void;
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
  theme,
  canUseProjectActions,
  isPreviewing,
  isGenerating,
  pdfVersion,
  isResizing,
  workspaceStyle,
  workspaceRef,
  editorRef,
  splitPercent,
  minSplitPercent,
  maxSplitPercent,
  onReturnHome,
  onOpenTasks,
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
  const pdfFrameSrc = project ? `/api/projects/${project.id}/pdf?v=${pdfVersion}` : "";

  return (
    <main className={`app-shell${isResizing ? " resizing" : ""}`}>
      <AppNavigation active="workspace" onHome={onReturnHome} onTasks={onOpenTasks} onSettings={onOpenSettings} />
      <header className="workspace-header">
        <button className="back-button" type="button" onClick={onReturnHome}>
          <ArrowLeft size={17} aria-hidden="true" />
          <span>Projects</span>
        </button>
        <div className="workspace-title">
          <BookMarked size={17} aria-hidden="true" />
          <span>{project?.name ?? "Loading project"}</span>
        </div>
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
                    <div className={previewStyles.actionGroup}>
                      <button
                        className={`primary-action ${previewStyles.previewButton}`}
                        type="button"
                        disabled={!canUseProjectActions}
                        onClick={onApplyPreview}
                      >
                        {isPreviewing ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
                        Preview
                      </button>
                      <PreviewSettingsMenu pageOffset={pageOffset} onPageOffsetChange={onPageOffsetChange} />
                    </div>
                    {project ? (
                      <a
                        className={`secondary-action icon-only ${previewStyles.downloadButton}`}
                        href={pdfFrameSrc}
                        download={makeBookmarkedFilename(project)}
                        aria-label="Download PDF"
                        title="Download PDF"
                      >
                        <Download size={16} />
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
