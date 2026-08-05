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
import { useLocation, useMatch, useNavigate } from "react-router-dom";
import { parseError, requestJson } from "./api";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { GenerateDialog } from "./components/GenerateDialog";
import { HomeView } from "./components/HomeView";
import { SettingsView } from "./components/SettingsView";
import { WorkspaceView } from "./components/WorkspaceView";
import type { JsonEditorHandle } from "./JsonEditor";
import type {
  GenerationJob,
  PreviewPdf,
  Project,
  SettingsDraft,
  SettingsState,
  Status
} from "./types";
import { makeBookmarkedFilename } from "./utils";

const DEFAULT_SPLIT_PERCENT = 48;
const MIN_SPLIT_PERCENT = 30;
const MAX_SPLIT_PERCENT = 70;
const THEME_STORAGE_KEY = "bookmark.theme";

export type ThemePreference = "system" | "light" | "dark";

function readThemePreference(): ThemePreference {
  const value = window.localStorage.getItem(THEME_STORAGE_KEY);
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

function resolveTheme(preference: ThemePreference, prefersDark: boolean): "light" | "dark" {
  return preference === "system" ? (prefersDark ? "dark" : "light") : preference;
}

function clampSplitPercent(value: number): number {
  return Math.min(MAX_SPLIT_PERCENT, Math.max(MIN_SPLIT_PERCENT, value));
}

export function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const projectRouteMatch = useMatch("/projects/:projectId");
  const settingsRouteMatch = useMatch("/settings");
  const currentProjectId = projectRouteMatch?.params.projectId ?? null;
  const isSettingsRoute = Boolean(settingsRouteMatch);
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [tocText, setTocText] = useState("");
  const [pageOffset, setPageOffset] = useState("0");
  const [themePreference, setThemePreference] = useState<ThemePreference>(readThemePreference);
  const [prefersDark, setPrefersDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [settings, setSettings] = useState<SettingsState | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft>({
    baseUrl: "",
    model: "",
    apiKey: ""
  });
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [projectPendingDelete, setProjectPendingDelete] = useState<Project | null>(null);
  const [tocStart, setTocStart] = useState("1");
  const [tocEnd, setTocEnd] = useState("1");
  const [pdfVersion, setPdfVersion] = useState(0);
  const [activeGenerationJobId, setActiveGenerationJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({
    kind: "idle",
    message: "Select a project or create one from a PDF"
  });
  const editorRef = useRef<JsonEditorHandle | null>(null);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const isDraggingSplitterRef = useRef(false);
  const lastSavedTocRef = useRef("");
  const lastSavedOffsetRef = useRef("0");
  const tocSaveSequenceRef = useRef(0);
  const offsetSaveSequenceRef = useRef(0);
  const [splitPercent, setSplitPercent] = useState(DEFAULT_SPLIT_PERCENT);
  const [isResizing, setIsResizing] = useState(false);
  const [previewPdf, setPreviewPdf] = useState<PreviewPdf | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const resolvedTheme = resolveTheme(themePreference, prefersDark);

  useEffect(() => {
    void loadProjects();
    void loadSettings();
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const updatePreference = () => setPrefersDark(mediaQuery.matches);
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    window.localStorage.setItem(THEME_STORAGE_KEY, themePreference);
  }, [resolvedTheme, themePreference]);

  useEffect(() => {
    if (!currentProjectId) {
      return;
    }
    if (project?.id === currentProjectId) {
      return;
    }

    const projectId = currentProjectId;
    let cancelled = false;
    setStatus({ kind: "loading", message: "Loading project" });
    setProject(null);
    setTocText("");
    setPageOffset("0");
    lastSavedTocRef.current = "";
    lastSavedOffsetRef.current = "0";
    clearPreviewPdf();

    async function loadProjectRoute() {
      try {
        await reloadProject(projectId);
        if (cancelled) {
          return;
        }
        setPdfVersion((value) => value + 1);
        setStatus({ kind: "idle", message: "Project loaded" });
      } catch (error) {
        if (cancelled) {
          return;
        }
        setProject(null);
        setTocText("");
        setStatus({
          kind: "error",
          message: error instanceof Error ? error.message : "Failed to load project"
        });
      }
    }

    void loadProjectRoute();

    return () => {
      cancelled = true;
    };
  }, [currentProjectId, project?.id]);

  useEffect(() => {
    if (currentProjectId || isSettingsRoute) {
      return;
    }

    setProject(null);
    setTocText("");
    lastSavedTocRef.current = "";
    lastSavedOffsetRef.current = "0";
    clearPreviewPdf();
  }, [currentProjectId, isSettingsRoute]);

  useEffect(() => {
    function openEditorSearch(event: KeyboardEvent) {
      if (!currentProjectId) {
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
  }, [currentProjectId]);

  useEffect(() => {
    function handleAppShortcut(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }
      if (event.key.toLowerCase() === "o" && location.pathname === "/") {
        event.preventDefault();
        document.getElementById("project-import")?.click();
      }
      if (event.key === ",") {
        event.preventDefault();
        openSettings();
      }
    }
    window.addEventListener("keydown", handleAppShortcut);
    return () => window.removeEventListener("keydown", handleAppShortcut);
  }, [location.pathname]);

  useEffect(() => {
    return () => {
      if (previewPdf) {
        URL.revokeObjectURL(previewPdf.url);
      }
    };
  }, [previewPdf]);

  useEffect(() => {
    if (!activeGenerationJobId) {
      return;
    }

    let cancelled = false;

    async function pollGenerationJob() {
      try {
        const data = await requestJson<{ job: GenerationJob }>(
          `/api/jobs/${activeGenerationJobId}`,
        );
        if (cancelled) {
          return;
        }

        if (data.job.status === "queued" || data.job.status === "running") {
          setStatus({ kind: "loading", message: data.job.message });
          return;
        }

        setActiveGenerationJobId(null);
        if (data.job.status === "failed") {
          setStatus({
            kind: "error",
            message: data.job.error || data.job.message || "TOC generation failed"
          });
          return;
        }

        if (data.job.project_id === project?.id) {
          await reloadProject(project.id);
          clearPreviewPdf();
        }
        setStatus({ kind: "success", message: data.job.message });
      } catch (error) {
        if (cancelled) {
          return;
        }
        setActiveGenerationJobId(null);
        setStatus({
          kind: "error",
          message: error instanceof Error ? error.message : "Failed to poll generation job"
        });
      }
    }

    void pollGenerationJob();
    const intervalId = window.setInterval(() => void pollGenerationJob(), 1500);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeGenerationJobId, project?.id]);

  useEffect(() => {
    if (
      !currentProjectId ||
      !project ||
      project.id !== currentProjectId ||
      tocText === lastSavedTocRef.current
    ) {
      return;
    }

    const sequence = tocSaveSequenceRef.current + 1;
    tocSaveSequenceRef.current = sequence;

    const timeoutId = window.setTimeout(() => {
      void autosaveTocJson(project.id, tocText, sequence);
    }, 700);

    return () => window.clearTimeout(timeoutId);
  }, [currentProjectId, project?.id, tocText]);

  useEffect(() => {
    if (
      !currentProjectId ||
      !project ||
      project.id !== currentProjectId ||
      pageOffset === lastSavedOffsetRef.current
    ) {
      return;
    }

    const offset = Number.parseInt(pageOffset, 10);
    if (!Number.isInteger(offset)) {
      setStatus({ kind: "error", message: "Page offset must be an integer" });
      return;
    }

    const sequence = offsetSaveSequenceRef.current + 1;
    offsetSaveSequenceRef.current = sequence;

    const timeoutId = window.setTimeout(() => {
      void autosaveProjectOffset(project.id, offset, sequence);
    }, 500);

    return () => window.clearTimeout(timeoutId);
  }, [currentProjectId, pageOffset, project?.id]);

  const workspaceStyle = {
    "--editor-split": `${splitPercent}%`
  } as CSSProperties;

  const canUseProjectActions = useMemo(
    () => Boolean(project && tocText.trim() && pageOffset.trim() && !isPreviewing && !activeGenerationJobId),
    [activeGenerationJobId, isPreviewing, pageOffset, project, tocText]
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

  function openProject(projectId: string) {
    navigate(`/projects/${encodeURIComponent(projectId)}`);
  }

  async function reloadProject(projectId: string) {
    const [projectData, tocData] = await Promise.all([
      requestJson<{ project: Project }>(`/api/projects/${projectId}`),
      requestJson<{ toc_json: string }>(`/api/projects/${projectId}/toc`)
    ]);
    setProject(projectData.project);
    setTocText(tocData.toc_json);
    setPageOffset(String(projectData.project.page_offset ?? 0));
    lastSavedTocRef.current = tocData.toc_json;
    lastSavedOffsetRef.current = String(projectData.project.page_offset ?? 0);
  }

  function returnHome() {
    navigate("/");
    setProject(null);
    setTocText("");
    lastSavedTocRef.current = "";
    lastSavedOffsetRef.current = "0";
    clearPreviewPdf();
    void loadProjects();
  }

  async function createProject(file: File | null) {
    if (!file) {
      return;
    }

    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      setStatus({ kind: "error", message: "Choose a PDF file to create a project" });
      return;
    }

    const formData = new FormData();
    formData.append("pdf", file);

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
      await loadProjects();
      openProject(data.project.id);
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to create project"
      });
    }
  }

  function createProjectFromInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    void createProject(file);
  }

  async function deleteProject(projectId: string) {
    try {
      await requestJson<{ status: string }>(`/api/projects/${projectId}`, { method: "DELETE" });
      await loadProjects();
      if (currentProjectId === projectId) {
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

  function requestProjectDelete(projectId: string) {
    const nextProject = projects.find((item) => item.id === projectId) ?? null;
    if (nextProject) {
      setProjectPendingDelete(nextProject);
    }
  }

  function updateEditorText(nextText: string) {
    setTocText(nextText);
  }

  async function autosaveTocJson(projectId: string, nextTocText: string, sequence: number) {
    try {
      const data = await requestJson<{ project: Project; toc_json: string }>(
        `/api/projects/${projectId}/toc`,
        {
          method: "PUT",
          body: JSON.stringify({ toc_json: nextTocText })
        }
      );
      if (tocSaveSequenceRef.current !== sequence) {
        return;
      }
      lastSavedTocRef.current = nextTocText;
      setProject(data.project);
      await loadProjects();
    } catch (error) {
      if (tocSaveSequenceRef.current !== sequence) {
        return;
      }
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to autosave TOC JSON"
      });
    }
  }

  async function autosaveProjectOffset(projectId: string, offset: number, sequence: number) {
    try {
      const data = await requestJson<{ project: Project }>(`/api/projects/${projectId}/metadata`, {
        method: "PUT",
        body: JSON.stringify({ page_offset: offset })
      });
      if (offsetSaveSequenceRef.current !== sequence) {
        return;
      }
      lastSavedOffsetRef.current = String(offset);
      setProject(data.project);
      await loadProjects();
    } catch (error) {
      if (offsetSaveSequenceRef.current !== sequence) {
        return;
      }
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to autosave project offset"
      });
    }
  }

  async function flushAutosave() {
    if (!project) {
      return;
    }

    const offset = Number.parseInt(pageOffset, 10);
    if (!Number.isInteger(offset)) {
      throw new Error("Page offset must be an integer");
    }

    const tocSequence = tocSaveSequenceRef.current + 1;
    const offsetSequence = offsetSaveSequenceRef.current + 1;
    tocSaveSequenceRef.current = tocSequence;
    offsetSaveSequenceRef.current = offsetSequence;
    const [tocData, metadataData] = await Promise.all([
      requestJson<{ project: Project; toc_json: string }>(`/api/projects/${project.id}/toc`, {
        method: "PUT",
        body: JSON.stringify({ toc_json: tocText })
      }),
      requestJson<{ project: Project }>(`/api/projects/${project.id}/metadata`, {
        method: "PUT",
        body: JSON.stringify({ page_offset: offset })
      })
    ]);

    if (
      tocSaveSequenceRef.current === tocSequence &&
      offsetSaveSequenceRef.current === offsetSequence
    ) {
      lastSavedTocRef.current = tocText;
      lastSavedOffsetRef.current = String(offset);
      setProject({ ...tocData.project, page_offset: metadataData.project.page_offset });
      await loadProjects();
    }
  }

  async function applyPreview() {
    if (!project) {
      return;
    }

    const offset = Number.parseInt(pageOffset, 10);
    if (!Number.isInteger(offset)) {
      setStatus({ kind: "error", message: "Page offset must be an integer" });
      return;
    }

    setIsPreviewing(true);
    setStatus({ kind: "loading", message: "Applying TOC to PDF" });
    try {
      await flushAutosave();
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
    } finally {
      setIsPreviewing(false);
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
      const data = await requestJson<{ job: GenerationJob }>(
        `/api/projects/${project.id}/generate-toc`,
        {
          method: "POST",
          body: JSON.stringify({ toc_start: start, toc_end: end })
        }
      );
      setActiveGenerationJobId(data.job.id);
      clearPreviewPdf();
      setStatus({ kind: "loading", message: data.job.message });
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
    navigate("/settings", { state: { from: location.pathname } });
  }

  function leaveSettings() {
    const state = location.state as { from?: string } | null;
    if (state?.from && state.from !== "/settings") {
      navigate(state.from);
      return;
    }
    navigate("/");
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

  const deleteProjectDialog = projectPendingDelete ? (
    <ConfirmDialog
      title="Delete project"
      message={`Delete "${projectPendingDelete.name}" and its local PDF/JSON files?`}
      confirmLabel="Delete"
      tone="danger"
      onCancel={() => setProjectPendingDelete(null)}
      onConfirm={() => {
        const projectId = projectPendingDelete.id;
        setProjectPendingDelete(null);
        void deleteProject(projectId);
      }}
    />
  ) : null;

  if (isSettingsRoute) {
    return (
      <SettingsView
        settings={settings}
        settingsDraft={settingsDraft}
        themePreference={themePreference}
        onSettingsDraftChange={setSettingsDraft}
        onThemePreferenceChange={setThemePreference}
        onBack={leaveSettings}
        onOpenHome={returnHome}
        onSave={saveSettings}
      />
    );
  }

  if (location.pathname === "/") {
    return (
      <>
        <HomeView
          projects={projects}
          status={status}
          onCreateProject={createProject}
          onCreateProjectInput={createProjectFromInput}
          onOpenProject={openProject}
          onDeleteProject={requestProjectDelete}
          onOpenSettings={openSettings}
        />
        {deleteProjectDialog}
      </>
    );
  }

  if (!currentProjectId) {
    return <NotFoundView onReturnHome={returnHome} />;
  }

  if (!project || project.id !== currentProjectId) {
    return (
      <ProjectRouteFallback
        projectId={currentProjectId}
        status={status}
        onReturnHome={returnHome}
      />
    );
  }

  return (
    <>
      <WorkspaceView
        project={project}
        tocText={tocText}
        pageOffset={pageOffset}
        status={status}
        theme={resolvedTheme}
        canUseProjectActions={canUseProjectActions}
        isPreviewing={isPreviewing}
        isGenerating={activeGenerationJobId !== null}
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
        onOpenSettings={openSettings}
        onPageOffsetChange={setPageOffset}
        onOpenGenerateDialog={() => setGenerateDialogOpen(true)}
        onApplyPreview={() => void applyPreview()}
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
      {deleteProjectDialog}
    </>
  );
}

type RouteFallbackProps = {
  onReturnHome: () => void;
};

function NotFoundView({ onReturnHome }: RouteFallbackProps) {
  return (
    <main className="app-shell route-fallback-shell">
      <section className="route-fallback">
        <h1>Page not found</h1>
        <p>The route does not exist in this workspace.</p>
        <button className="secondary-action" type="button" onClick={onReturnHome}>
          Home
        </button>
      </section>
    </main>
  );
}

type ProjectRouteFallbackProps = {
  projectId: string;
  status: Status;
  onReturnHome: () => void;
};

function ProjectRouteFallback({ projectId, status, onReturnHome }: ProjectRouteFallbackProps) {
  const isLoading = status.kind === "loading";
  return (
    <main className="app-shell route-fallback-shell">
      <section className="route-fallback">
        <h1>{isLoading ? "Loading project" : "Project unavailable"}</h1>
        <p>
          {isLoading
            ? `Opening ${projectId}.`
            : status.kind === "error"
              ? status.message
              : `Project ${projectId} is not loaded.`}
        </p>
        <button className="secondary-action" type="button" onClick={onReturnHome}>
          Home
        </button>
      </section>
    </main>
  );
}
