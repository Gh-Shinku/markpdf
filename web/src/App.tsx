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
  GenerationJob,
  PreviewPdf,
  Project,
  SettingsDraft,
  SettingsState,
  Status,
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
    if (view.kind !== "workspace" || !project || tocText === lastSavedTocRef.current) {
      return;
    }

    const sequence = tocSaveSequenceRef.current + 1;
    tocSaveSequenceRef.current = sequence;
    setStatus({ kind: "loading", message: "Saving TOC JSON" });

    const timeoutId = window.setTimeout(() => {
      void autosaveTocJson(project.id, tocText, sequence);
    }, 700);

    return () => window.clearTimeout(timeoutId);
  }, [project?.id, tocText, view.kind]);

  useEffect(() => {
    if (view.kind !== "workspace" || !project || pageOffset === lastSavedOffsetRef.current) {
      return;
    }

    const offset = Number.parseInt(pageOffset, 10);
    if (!Number.isInteger(offset)) {
      setStatus({ kind: "error", message: "Page offset must be an integer" });
      return;
    }

    const sequence = offsetSaveSequenceRef.current + 1;
    offsetSaveSequenceRef.current = sequence;
    setStatus({ kind: "loading", message: "Saving project offset" });

    const timeoutId = window.setTimeout(() => {
      void autosaveProjectOffset(project.id, offset, sequence);
    }, 500);

    return () => window.clearTimeout(timeoutId);
  }, [pageOffset, project?.id, view.kind]);

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
    setStatus({ kind: "loading", message: "Loading project" });
    clearPreviewPdf();
    try {
      await reloadProject(projectId);
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
    setView({ kind: "home" });
    setProject(null);
    setTocText("");
    lastSavedTocRef.current = "";
    lastSavedOffsetRef.current = "0";
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
      setStatus({ kind: "success", message: "TOC JSON autosaved" });
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
      setStatus({ kind: "success", message: "Project offset autosaved" });
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
    </>
  );
}
