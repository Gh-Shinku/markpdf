import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";
import { useRef, useState } from "react";
import {
  ArrowLeft,
  BookMarked,
  Download,
  FileText,
  Files,
  Loader2,
  Play,
  Wand2,
} from "lucide-react";
import { AppNavigation } from "./AppNavigation";
import { JsonEditor, type JsonEditorHandle } from "../JsonEditor";
import { PreviewSettingsMenu } from "./PreviewSettingsMenu";
import previewStyles from "./PreviewSettingsMenu.module.css";
import type { Project } from "../types";
import type { TocFile } from "../types";
import { PdfViewer } from "./PdfViewer";
import { makeBookmarkedFilename } from "../utils";

const DEFAULT_FILE_EXPLORER_WIDTH = 190;
const MIN_FILE_EXPLORER_WIDTH = 140;
const MAX_FILE_EXPLORER_WIDTH = 320;
const MIN_EDITOR_WIDTH = 260;

type WorkspaceViewProps = {
  project: Project | null;
  tocText: string;
  tocFiles: TocFile[];
  selectedTocFileId: string;
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
  onSelectTocFile: (tocFileId: string) => void;
  onSplitterKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onSplitterPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onSplitterPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onSplitterPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onSplitterPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
};

export function WorkspaceView({
  project,
  tocText,
  tocFiles,
  selectedTocFileId,
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
  onSelectTocFile,
  onSplitterKeyDown,
  onSplitterPointerDown,
  onSplitterPointerMove,
  onSplitterPointerUp,
  onSplitterPointerCancel,
}: WorkspaceViewProps) {
  const pdfFrameSrc = project ? `/api/projects/${project.id}/pdf?v=${pdfVersion}` : "";
  const [isFileExplorerOpen, setFileExplorerOpen] = useState(false);
  const [fileExplorerWidth, setFileExplorerWidth] = useState(DEFAULT_FILE_EXPLORER_WIDTH);
  const [isFileExplorerResizing, setFileExplorerResizing] = useState(false);
  const tocWorkspaceRef = useRef<HTMLDivElement | null>(null);
  const isDraggingFileExplorerRef = useRef(false);
  const tocExplorerStyle = {
    "--toc-explorer-width": `${fileExplorerWidth}px`,
  } as CSSProperties;

  function clampFileExplorerWidth(value: number): number {
    const bounds = tocWorkspaceRef.current?.getBoundingClientRect();
    const availableMax = bounds?.width
      ? Math.max(MIN_FILE_EXPLORER_WIDTH, bounds.width - MIN_EDITOR_WIDTH)
      : MAX_FILE_EXPLORER_WIDTH;
    return Math.min(
      Math.min(MAX_FILE_EXPLORER_WIDTH, availableMax),
      Math.max(MIN_FILE_EXPLORER_WIDTH, value),
    );
  }

  function updateFileExplorerWidth(clientX: number) {
    const bounds = tocWorkspaceRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setFileExplorerWidth(clampFileExplorerWidth(clientX - bounds.left));
  }

  function onFileExplorerSplitterPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    isDraggingFileExplorerRef.current = true;
    setFileExplorerResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFileExplorerWidth(event.clientX);
  }

  function onFileExplorerSplitterPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isDraggingFileExplorerRef.current) return;
    event.preventDefault();
    updateFileExplorerWidth(event.clientX);
  }

  function stopFileExplorerResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    isDraggingFileExplorerRef.current = false;
    setFileExplorerResizing(false);
  }

  function onFileExplorerSplitterKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setFileExplorerWidth((value) => clampFileExplorerWidth(value - 12));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setFileExplorerWidth((value) => clampFileExplorerWidth(value + 12));
    } else if (event.key === "Home") {
      event.preventDefault();
      setFileExplorerWidth(MIN_FILE_EXPLORER_WIDTH);
    } else if (event.key === "End") {
      event.preventDefault();
      setFileExplorerWidth(clampFileExplorerWidth(MAX_FILE_EXPLORER_WIDTH));
    }
  }

  return (
    <main className={`app-shell${isResizing || isFileExplorerResizing ? " resizing" : ""}`}>
      <AppNavigation
        active="workspace"
        onHome={onReturnHome}
        onTasks={onOpenTasks}
        onSettings={onOpenSettings}
      />
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
            <div className="pane-title-row">
              <button
                className={`file-explorer-toggle${isFileExplorerOpen ? " open" : ""}`}
                type="button"
                aria-label={isFileExplorerOpen ? "Hide TOC files" : "Show TOC files"}
                aria-controls="toc-file-explorer"
                aria-expanded={isFileExplorerOpen}
                title={isFileExplorerOpen ? "Hide TOC files" : "Show TOC files"}
                onClick={() => setFileExplorerOpen((value) => !value)}
              >
                <Files size={16} aria-hidden="true" />
              </button>
              <h2>TOC Editor</h2>
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
          <div
            className={`toc-editor-workspace${isFileExplorerOpen ? " explorer-open" : ""}`}
            ref={tocWorkspaceRef}
            style={tocExplorerStyle}
          >
            <aside
              className="toc-file-explorer"
              id="toc-file-explorer"
              aria-label="TOC files"
              hidden={!isFileExplorerOpen}
            >
              <div className="toc-file-explorer-header">Explorer</div>
              <div className="toc-file-explorer-section">TOC files</div>
              {tocFiles.map((file) => (
                <button
                  key={file.id}
                  className={file.id === selectedTocFileId ? "active" : ""}
                  type="button"
                  onClick={() => onSelectTocFile(file.id)}
                  title={file.name}
                >
                  {file.name}
                </button>
              ))}
            </aside>
            {isFileExplorerOpen ? (
              <div
                className="toc-file-explorer-splitter"
                role="separator"
                aria-label="Resize file explorer"
                aria-orientation="vertical"
                aria-valuemin={MIN_FILE_EXPLORER_WIDTH}
                aria-valuemax={MAX_FILE_EXPLORER_WIDTH}
                aria-valuenow={Math.round(fileExplorerWidth)}
                tabIndex={0}
                onKeyDown={onFileExplorerSplitterKeyDown}
                onPointerDown={onFileExplorerSplitterPointerDown}
                onPointerMove={onFileExplorerSplitterPointerMove}
                onPointerUp={stopFileExplorerResize}
                onPointerCancel={stopFileExplorerResize}
              />
            ) : null}
            <JsonEditor ref={editorRef} value={tocText} theme={theme} onChange={onEditorChange} />
          </div>
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
                toolbarStart={
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
                      <PreviewSettingsMenu
                        pageOffset={pageOffset}
                        onPageOffsetChange={onPageOffsetChange}
                      />
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
                }
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
