import {
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  AlertCircle,
  ArrowLeft,
  BookMarked,
  CheckCircle2,
  Download,
  FileJson,
  FileText,
  FolderOpen,
  Home,
  Loader2,
  Play,
  Save,
  Settings,
  ShieldCheck,
  Trash2,
  Upload,
  Wand2,
  X
} from "lucide-react";
import { JsonEditor, JsonEditorHandle } from "./JsonEditor";

type Status =
  | { kind: "idle"; message: string }
  | { kind: "loading"; message: string }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

type View =
  | { kind: "home" }
  | { kind: "workspace"; projectId: string }
  | { kind: "settings"; returnProjectId?: string };

type ValidationIssue = {
  message: string;
};

type ValidationSnapshot = {
  valid: boolean;
  bookmark_count: number;
  checked_at: string;
  issues: ValidationIssue[];
};

type Project = {
  id: string;
  name: string;
  pdf_filename: string;
  toc_filename: string | null;
  page_offset: number;
  page_count: number;
  created_at: string;
  updated_at: string;
  toc_updated_at: string;
  generated_at: string | null;
  last_validation: ValidationSnapshot | null;
};

type SettingsState = {
  base_url: string;
  model: string;
  has_api_key: boolean;
  api_key_hint: string;
};

type SettingsDraft = {
  baseUrl: string;
  model: string;
  apiKey: string;
};

type PreviewPdf = {
  url: string;
  filename: string;
};

const DEFAULT_SPLIT_PERCENT = 48;
const MIN_SPLIT_PERCENT = 30;
const MAX_SPLIT_PERCENT = 70;

function clampSplitPercent(value: number): number {
  return Math.min(MAX_SPLIT_PERCENT, Math.max(MIN_SPLIT_PERCENT, value));
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

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return (await response.json()) as T;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "Never";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function makeBookmarkedFilename(project: Project): string {
  return `${project.pdf_filename.replace(/\.pdf$/i, "")}_bookmarked.pdf`;
}

export function App() {
  const [view, setView] = useState<View>({ kind: "home" });
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [tocText, setTocText] = useState("");
  const [pageOffset, setPageOffset] = useState("0");
  const [pendingTocFile, setPendingTocFile] = useState<File | null>(null);
  const [settings, setSettings] = useState<SettingsState | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft>({
    baseUrl: "",
    model: "",
    apiKey: ""
  });
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [tocStart, setTocStart] = useState("1");
  const [tocEnd, setTocEnd] = useState("1");
  const [dirty, setDirty] = useState(false);
  const [pdfVersion, setPdfVersion] = useState(0);
  const [status, setStatus] = useState<Status>({
    kind: "idle",
    message: "Select a project or create one from a PDF"
  });
  const editorRef = useRef<JsonEditorHandle | null>(null);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const isDraggingSplitterRef = useRef(false);
  const [splitPercent, setSplitPercent] = useState(DEFAULT_SPLIT_PERCENT);
  const [isResizing, setIsResizing] = useState(false);
  const [previewPdf, setPreviewPdf] = useState<PreviewPdf | null>(null);

  useEffect(() => {
    void loadProjects();
    void loadSettings();
  }, []);

  useEffect(() => {
    function openEditorSearch(event: KeyboardEvent) {
      if (view.kind !== "workspace") {
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "f") {
        return;
      }

      event.preventDefault();
      editorRef.current?.openFind();
    }

    window.addEventListener("keydown", openEditorSearch, true);
    return () => window.removeEventListener("keydown", openEditorSearch, true);
  }, [view.kind]);

  useEffect(() => {
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirty) {
        return;
      }
      event.preventDefault();
    }

    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    return () => {
      if (previewPdf) {
        URL.revokeObjectURL(previewPdf.url);
      }
    };
  }, [previewPdf]);

  const workspaceStyle = {
    "--editor-split": `${splitPercent}%`
  } as CSSProperties;

  const canUseProjectActions = useMemo(
    () => Boolean(project && tocText.trim() && pageOffset.trim() && status.kind !== "loading"),
    [pageOffset, project, status.kind, tocText]
  );

  async function loadProjects() {
    try {
      const data = await requestJson<{ projects: Project[] }>("/api/projects");
      setProjects(data.projects);
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to load projects"
      });
    }
  }

  async function loadSettings() {
    try {
      const data = await requestJson<{ settings: SettingsState }>("/api/settings/llm");
      setSettings(data.settings);
      setSettingsDraft({
        baseUrl: data.settings.base_url,
        model: data.settings.model,
        apiKey: ""
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to load settings"
      });
    }
  }

  async function openProject(projectId: string) {
    if (dirty && !window.confirm("Discard unsaved JSON changes and open another project?")) {
      return;
    }

    setStatus({ kind: "loading", message: "Loading project" });
    clearPreviewPdf();
    try {
      const [projectData, tocData] = await Promise.all([
        requestJson<{ project: Project }>(`/api/projects/${projectId}`),
        requestJson<{ toc_json: string }>(`/api/projects/${projectId}/toc`)
      ]);
      setProject(projectData.project);
      setTocText(tocData.toc_json);
      setPageOffset(String(projectData.project.page_offset ?? 0));
      setDirty(false);
      setPdfVersion((value) => value + 1);
      setView({ kind: "workspace", projectId });
      setStatus({ kind: "idle", message: "Project loaded" });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to load project"
      });
    }
  }

  function returnHome() {
    if (dirty && !window.confirm("Discard unsaved JSON changes and return home?")) {
      return;
    }
    setView({ kind: "home" });
    setProject(null);
    setTocText("");
    setDirty(false);
    clearPreviewPdf();
    void loadProjects();
  }

  async function createProject(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) {
      return;
    }

    const formData = new FormData();
    formData.append("pdf", file);
    if (pendingTocFile) {
      formData.append("toc_json", pendingTocFile);
    }

    setStatus({ kind: "loading", message: "Creating project" });
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        body: formData
      });
      if (!response.ok) {
        throw new Error(await parseError(response));
      }
      const data = (await response.json()) as { project: Project };
      setPendingTocFile(null);
      await loadProjects();
      await openProject(data.project.id);
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to create project"
      });
    }
  }

  async function deleteProject(projectId: string) {
    if (!window.confirm("Delete this project and its local PDF/JSON files?")) {
      return;
    }

    try {
      await requestJson<{ status: string }>(`/api/projects/${projectId}`, { method: "DELETE" });
      await loadProjects();
      if (project?.id === projectId) {
        returnHome();
      }
      setStatus({ kind: "success", message: "Project deleted" });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to delete project"
      });
    }
  }

  function updateEditorText(nextText: string) {
    setTocText(nextText);
    setDirty(true);
  }

  async function saveTocJson() {
    if (!project) {
      return;
    }

    setStatus({ kind: "loading", message: "Saving TOC JSON" });
    try {
      const data = await requestJson<{ project: Project; toc_json: string }>(
        `/api/projects/${project.id}/toc`,
        {
          method: "PUT",
          body: JSON.stringify({ toc_json: tocText })
        }
      );
      setProject(data.project);
      setDirty(false);
      await loadProjects();
      setStatus({ kind: "success", message: "TOC JSON saved" });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to save TOC JSON"
      });
    }
  }

  async function validateToc(showSuccess = true): Promise<boolean> {
    if (!project) {
      return false;
    }

    const offset = Number.parseInt(pageOffset, 10);
    if (!Number.isInteger(offset)) {
      setStatus({ kind: "error", message: "Page offset must be an integer" });
      return false;
    }

    try {
      const data = await requestJson<{
        validation: {
          valid: boolean;
          issues: ValidationIssue[];
          bookmark_count: number;
        };
        project: Project;
      }>(`/api/projects/${project.id}/validate`, {
        method: "POST",
        body: JSON.stringify({ toc_json: tocText, page_offset: offset })
      });
      setProject(data.project);
      await loadProjects();
      if (!data.validation.valid) {
        setStatus({
          kind: "error",
          message: data.validation.issues[0]?.message ?? "Invalid TOC JSON"
        });
        return false;
      }
      if (showSuccess) {
        setStatus({
          kind: "success",
          message: `Validation passed (${data.validation.bookmark_count} bookmarks)`
        });
      }
      return true;
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Validation failed"
      });
      return false;
    }
  }

  async function applyPreview() {
    if (!project) {
      return;
    }
    if (!(await validateToc(false))) {
      return;
    }

    const offset = Number.parseInt(pageOffset, 10);
    setStatus({ kind: "loading", message: "Applying TOC to PDF" });
    try {
      const response = await fetch(`/api/projects/${project.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toc_json: tocText, page_offset: offset })
      });
      if (!response.ok) {
        throw new Error(await parseError(response));
      }
      const blob = await response.blob();
      const nextPreview = {
        url: URL.createObjectURL(blob),
        filename: makeBookmarkedFilename(project)
      };
      clearPreviewPdf();
      setPreviewPdf(nextPreview);
      setStatus({ kind: "success", message: "Preview PDF updated" });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to apply TOC"
      });
    }
  }

  function formatTocJson() {
    try {
      const parsed = JSON.parse(tocText);
      setTocText(JSON.stringify(parsed, null, 2));
      setDirty(true);
      setStatus({ kind: "success", message: "TOC JSON formatted" });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? `JSON syntax error: ${error.message}` : "Invalid JSON"
      });
    }
  }

  async function generateToc() {
    if (!project) {
      return;
    }

    const start = Number.parseInt(tocStart, 10);
    const end = Number.parseInt(tocEnd, 10);
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      setStatus({ kind: "error", message: "TOC page range must be integer page numbers" });
      return;
    }

    setGenerateDialogOpen(false);
    setStatus({ kind: "loading", message: "Generating TOC JSON with LLM" });
    try {
      const data = await requestJson<{ project: Project; toc_json: string }>(
        `/api/projects/${project.id}/generate-toc`,
        {
          method: "POST",
          body: JSON.stringify({ toc_start: start, toc_end: end })
        }
      );
      setProject(data.project);
      setTocText(data.toc_json);
      setPageOffset(String(data.project.page_offset ?? 0));
      setDirty(false);
      clearPreviewPdf();
      await loadProjects();
      setStatus({ kind: "success", message: "Generated TOC replaced the project JSON" });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to generate TOC"
      });
    }
  }

  async function saveSettings() {
    setStatus({ kind: "loading", message: "Saving LLM settings" });
    try {
      const payload: { base_url: string; model: string; api_key?: string } = {
        base_url: settingsDraft.baseUrl,
        model: settingsDraft.model
      };
      if (settingsDraft.apiKey.trim()) {
        payload.api_key = settingsDraft.apiKey;
      }
      const data = await requestJson<{ settings: SettingsState }>("/api/settings/llm", {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      setSettings(data.settings);
      setSettingsDraft({
        baseUrl: data.settings.base_url,
        model: data.settings.model,
        apiKey: ""
      });
      setStatus({ kind: "success", message: "LLM settings saved" });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to save settings"
      });
    }
  }

  function openSettings() {
    setView({
      kind: "settings",
      returnProjectId: view.kind === "workspace" ? view.projectId : undefined
    });
  }

  function leaveSettings() {
    if (view.kind === "settings" && view.returnProjectId) {
      setView({ kind: "workspace", projectId: view.returnProjectId });
      return;
    }
    setView({ kind: "home" });
  }

  function clearPreviewPdf() {
    setPreviewPdf((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous.url);
      }
      return null;
    });
  }

  function updateSplitFromClientX(clientX: number) {
    const bounds = workspaceRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0) {
      return;
    }

    const nextPercent = ((clientX - bounds.left) / bounds.width) * 100;
    setSplitPercent(clampSplitPercent(nextPercent));
  }

  function startSplitterDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    isDraggingSplitterRef.current = true;
    setIsResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    updateSplitFromClientX(event.clientX);
  }

  function dragSplitter(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isDraggingSplitterRef.current) {
      return;
    }

    event.preventDefault();
    updateSplitFromClientX(event.clientX);
  }

  function stopSplitterDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    isDraggingSplitterRef.current = false;
    setIsResizing(false);
  }

  function resizeSplitterWithKeyboard(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setSplitPercent((value) => clampSplitPercent(value - 2));
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      setSplitPercent((value) => clampSplitPercent(value + 2));
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      setSplitPercent(MIN_SPLIT_PERCENT);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      setSplitPercent(MAX_SPLIT_PERCENT);
    }
  }

  const statusIcon =
    status.kind === "loading" ? (
      <Loader2 className="spin" size={16} />
    ) : status.kind === "success" ? (
      <CheckCircle2 size={16} />
    ) : status.kind === "error" ? (
      <AlertCircle size={16} />
    ) : (
      <BookMarked size={16} />
    );

  if (view.kind === "settings") {
    return (
      <main className="app-shell settings-shell">
        <header className="topbar">
          <div className="brand">
            <Settings size={22} aria-hidden="true" />
            <div>
              <h1>LLM Settings</h1>
              <p>OpenAI-compatible API configuration for local generation.</p>
            </div>
          </div>
          <div className="toolbar">
            <button className="secondary-action" type="button" onClick={leaveSettings}>
              <ArrowLeft size={16} />
              Back
            </button>
            <button className="primary-action" type="button" onClick={saveSettings}>
              <Save size={16} />
              Save
            </button>
          </div>
        </header>

        <section className="settings-panel">
          <div className="settings-form">
            <label>
              <span>Base URL</span>
              <input
                value={settingsDraft.baseUrl}
                onChange={(event) =>
                  setSettingsDraft((draft) => ({ ...draft, baseUrl: event.target.value }))
                }
              />
            </label>
            <label>
              <span>Model</span>
              <input
                value={settingsDraft.model}
                onChange={(event) =>
                  setSettingsDraft((draft) => ({ ...draft, model: event.target.value }))
                }
              />
            </label>
            <label>
              <span>API key</span>
              <input
                type="password"
                placeholder={
                  settings?.has_api_key
                    ? `Configured (${settings.api_key_hint})`
                    : "Paste an API key"
                }
                value={settingsDraft.apiKey}
                onChange={(event) =>
                  setSettingsDraft((draft) => ({ ...draft, apiKey: event.target.value }))
                }
              />
            </label>
            <p className="settings-note">
              The key is stored in a local server config file in plain text. Use this only for a
              trusted local workspace.
            </p>
          </div>
          <StatusLine status={status} icon={statusIcon} />
        </section>
      </main>
    );
  }

  if (view.kind === "home") {
    return (
      <main className="app-shell home-shell">
        <header className="topbar">
          <div className="brand">
            <BookMarked size={22} aria-hidden="true" />
            <div>
              <h1>PDF Bookmark Manager</h1>
              <p>Local projects for PDF and TOC JSON workspaces.</p>
            </div>
          </div>

          <div className="toolbar">
            <label className="upload-control">
              <FileJson size={16} />
              <span>{pendingTocFile ? pendingTocFile.name : "Optional JSON"}</span>
              <input
                type="file"
                accept="application/json,.json"
                onChange={(event) => setPendingTocFile(event.target.files?.[0] ?? null)}
              />
            </label>
            {pendingTocFile ? (
              <button className="secondary-action icon-only" type="button" onClick={() => setPendingTocFile(null)}>
                <X size={16} />
              </button>
            ) : null}
            <label className="primary-action upload-control">
              <Upload size={16} />
              <span>New Project</span>
              <input type="file" accept="application/pdf,.pdf" onChange={createProject} />
            </label>
            <button className="secondary-action" type="button" onClick={openSettings}>
              <Settings size={16} />
              Settings
            </button>
          </div>
        </header>

        <section className="manager">
          <div className="manager-header">
            <div>
              <h2>Projects</h2>
              <p>{projects.length} local project{projects.length === 1 ? "" : "s"}</p>
            </div>
            <StatusLine status={status} icon={statusIcon} />
          </div>

          {projects.length ? (
            <div className="project-table" role="table">
              <div className="project-row project-row-head" role="row">
                <span>Name</span>
                <span>Pages</span>
                <span>TOC</span>
                <span>Validation</span>
                <span />
              </div>
              {projects.map((item) => (
                <button
                  className="project-row"
                  key={item.id}
                  type="button"
                  onClick={() => void openProject(item.id)}
                >
                  <span className="project-name">
                    <FolderOpen size={16} />
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.pdf_filename}</small>
                    </span>
                  </span>
                  <span>{item.page_count}</span>
                  <span>{item.generated_at ? "Generated" : "Manual"}</span>
                  <span className={item.last_validation?.valid ? "ok-text" : "muted-text"}>
                    {item.last_validation
                      ? item.last_validation.valid
                        ? `${item.last_validation.bookmark_count} bookmarks`
                        : "Needs fix"
                      : "Unchecked"}
                  </span>
                  <span className="row-actions">
                    <Trash2
                      size={16}
                      onClick={(event) => {
                        event.stopPropagation();
                        void deleteProject(item.id);
                      }}
                    />
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-manager">
              <FileText size={34} />
              <span>Upload a PDF to create the first project.</span>
            </div>
          )}
        </section>
      </main>
    );
  }

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
          <button className="secondary-action" type="button" onClick={returnHome}>
            <Home size={16} />
            Home
          </button>
          <label className="offset-control">
            <span>Offset</span>
            <input
              type="number"
              step="1"
              value={pageOffset}
              onChange={(event) => setPageOffset(event.target.value)}
            />
          </label>
          <button className="secondary-action" type="button" disabled={!dirty} onClick={saveTocJson}>
            <Save size={16} />
            Save
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={!tocText.trim()}
            onClick={formatTocJson}
          >
            <FileJson size={16} />
            Format
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={!canUseProjectActions}
            onClick={() => void validateToc()}
          >
            <ShieldCheck size={16} />
            Validate
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={!project || status.kind === "loading"}
            onClick={() => setGenerateDialogOpen(true)}
          >
            <Wand2 size={16} />
            AI Generate
          </button>
          <button
            className="primary-action"
            type="button"
            disabled={!canUseProjectActions}
            onClick={applyPreview}
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
          <button className="secondary-action icon-only" type="button" onClick={openSettings}>
            <Settings size={16} />
          </button>
        </div>
      </header>

      <section className="workspace-grid" ref={workspaceRef} style={workspaceStyle}>
        <section className="editor-pane">
          <div className="pane-header">
            <div>
              <h2>TOC JSON</h2>
              <p>
                {dirty ? "Unsaved changes" : "Saved"} - updated {formatDate(project?.toc_updated_at ?? null)}
              </p>
            </div>
          </div>

          <JsonEditor ref={editorRef} value={tocText} onChange={updateEditorText} />
        </section>

        <div
          className="splitter"
          role="separator"
          aria-label="Resize editor and preview panes"
          aria-orientation="vertical"
          aria-valuemin={MIN_SPLIT_PERCENT}
          aria-valuemax={MAX_SPLIT_PERCENT}
          aria-valuenow={Math.round(splitPercent)}
          tabIndex={0}
          onKeyDown={resizeSplitterWithKeyboard}
          onPointerDown={startSplitterDrag}
          onPointerMove={dragSplitter}
          onPointerUp={stopSplitterDrag}
          onPointerCancel={stopSplitterDrag}
        />

        <section className="preview-pane">
          <div className="pane-header">
            <div>
              <h2>{previewPdf ? "Bookmarked Preview" : "Source PDF"}</h2>
              <p>{project ? project.pdf_filename : "No PDF selected"}</p>
            </div>
            <StatusLine status={status} icon={statusIcon} />
          </div>

          <div className="pdf-frame">
            {project ? (
              <iframe title="PDF preview" src={pdfFrameSrc} />
            ) : (
              <div className="empty-preview">
                <FileText size={34} />
                <span>Select a project to render it here.</span>
              </div>
            )}
          </div>
        </section>
      </section>

      {generateDialogOpen && project ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="generate-title">
            <div className="modal-header">
              <h2 id="generate-title">Generate TOC JSON</h2>
              <button
                className="secondary-action icon-only"
                type="button"
                onClick={() => setGenerateDialogOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <p className="warning-text">
              The generated result will overwrite the saved JSON for this project.
            </p>
            <div className="range-grid">
              <label>
                <span>TOC start page</span>
                <input value={tocStart} type="number" min="1" onChange={(event) => setTocStart(event.target.value)} />
              </label>
              <label>
                <span>TOC end page</span>
                <input
                  value={tocEnd}
                  type="number"
                  min="1"
                  max={project.page_count}
                  onChange={(event) => setTocEnd(event.target.value)}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button className="secondary-action" type="button" onClick={() => setGenerateDialogOpen(false)}>
                Cancel
              </button>
              <button className="primary-action" type="button" onClick={generateToc}>
                <Wand2 size={16} />
                Generate and Replace
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function StatusLine({ status, icon }: { status: Status; icon: React.ReactNode }) {
  return (
    <div className={`status-pill ${status.kind}`}>
      {icon}
      <span>{status.message}</span>
    </div>
  );
}
