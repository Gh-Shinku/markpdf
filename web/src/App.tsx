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
import { parseError, requestJson } from "./api";
import { GenerateDialog } from "./components/GenerateDialog";
import { HomeView } from "./components/HomeView";
import { SettingsView } from "./components/SettingsView";
import { WorkspaceView } from "./components/WorkspaceView";
import type { JsonEditorHandle } from "./JsonEditor";
import type {
  PreviewPdf,
  Project,
  SettingsDraft,
  SettingsState,
  Status,
  ValidationIssue,
  View
} from "./types";
import { makeBookmarkedFilename } from "./utils";

const DEFAULT_SPLIT_PERCENT = 48;
const MIN_SPLIT_PERCENT = 30;
const MAX_SPLIT_PERCENT = 70;

function clampSplitPercent(value: number): number {
  return Math.min(MAX_SPLIT_PERCENT, Math.max(MIN_SPLIT_PERCENT, value));
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

  if (view.kind === "settings") {
    return (
      <SettingsView
        settings={settings}
        settingsDraft={settingsDraft}
        status={status}
        onSettingsDraftChange={setSettingsDraft}
        onBack={leaveSettings}
        onSave={saveSettings}
      />
    );
  }

  if (view.kind === "home") {
    return (
      <HomeView
        projects={projects}
        pendingTocFile={pendingTocFile}
        status={status}
        onPendingTocFileChange={setPendingTocFile}
        onCreateProject={(event) => void createProject(event)}
        onOpenProject={(projectId) => void openProject(projectId)}
        onDeleteProject={(projectId) => void deleteProject(projectId)}
        onOpenSettings={openSettings}
      />
    );
  }

  return (
    <>
      <WorkspaceView
        project={project}
        tocText={tocText}
        pageOffset={pageOffset}
        dirty={dirty}
        status={status}
        canUseProjectActions={canUseProjectActions}
        previewPdf={previewPdf}
        pdfVersion={pdfVersion}
        isResizing={isResizing}
        workspaceStyle={workspaceStyle}
        workspaceRef={workspaceRef}
        editorRef={editorRef}
        splitPercent={splitPercent}
        minSplitPercent={MIN_SPLIT_PERCENT}
        maxSplitPercent={MAX_SPLIT_PERCENT}
        onReturnHome={returnHome}
        onPageOffsetChange={setPageOffset}
        onSaveToc={() => void saveTocJson()}
        onFormatToc={formatTocJson}
        onValidateToc={() => void validateToc()}
        onOpenGenerateDialog={() => setGenerateDialogOpen(true)}
        onApplyPreview={() => void applyPreview()}
        onOpenSettings={openSettings}
        onEditorChange={updateEditorText}
        onSplitterKeyDown={resizeSplitterWithKeyboard}
        onSplitterPointerDown={startSplitterDrag}
        onSplitterPointerMove={dragSplitter}
        onSplitterPointerUp={stopSplitterDrag}
        onSplitterPointerCancel={stopSplitterDrag}
      />
      {generateDialogOpen && project ? (
        <GenerateDialog
          project={project}
          tocStart={tocStart}
          tocEnd={tocEnd}
          onTocStartChange={setTocStart}
          onTocEndChange={setTocEnd}
          onCancel={() => setGenerateDialogOpen(false)}
          onGenerate={() => void generateToc()}
        />
      ) : null}
    </>
  );
}
