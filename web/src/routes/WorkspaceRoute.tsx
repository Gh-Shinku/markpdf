import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { GenerateDialog } from "../components/GenerateDialog";
import { WorkspaceView } from "../components/WorkspaceView";
import type { JsonEditorHandle } from "../JsonEditor";
import { useThemePreference } from "../hooks/useThemePreference";
import { MIN_SPLIT_PERCENT, MAX_SPLIT_PERCENT, useWorkspaceSplit } from "../hooks/useWorkspaceSplit";
import {
  applyProject,
  generateProjectToc,
  getProject,
  getProjectToc,
  listProjectGenerationJobs,
  projectKeys,
  saveProjectOffset,
  saveProjectToc
} from "../features/projects/api";

export function WorkspaceRoute() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { theme } = useThemePreference();
  const workspaceRef = useRef<HTMLElement | null>(null);
  const editorRef = useRef<JsonEditorHandle | null>(null);
  const { splitPercent, isResizing, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onKeyDown } = useWorkspaceSplit(workspaceRef);
  const projectQuery = useQuery({ queryKey: projectKeys.detail(projectId), queryFn: () => getProject(projectId), enabled: Boolean(projectId) });
  const tocQuery = useQuery({ queryKey: projectKeys.toc(projectId), queryFn: () => getProjectToc(projectId), enabled: Boolean(projectId) });
  const [tocText, setTocText] = useState("");
  const [pageOffset, setPageOffset] = useState("0");
  const [pdfVersion, setPdfVersion] = useState(0);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [tocStart, setTocStart] = useState("1");
  const [tocEnd, setTocEnd] = useState("1");
  const [submittedGenerationJobId, setSubmittedGenerationJobId] = useState<string | null>(null);
  const [isStartingGeneration, setIsStartingGeneration] = useState(false);
  const savedTocRef = useRef("");
  const savedOffsetRef = useRef("0");
  const tocSaveSequenceRef = useRef(0);
  const offsetSaveSequenceRef = useRef(0);
  const handledTerminalJobsRef = useRef(new Set<string>());

  const tocMutation = useMutation({
    mutationFn: ({ value }: { value: string; sequence: number }) => saveProjectToc(projectId, value),
    onSuccess: (project, { value, sequence }) => {
      if (sequence !== tocSaveSequenceRef.current) return;
      savedTocRef.current = value;
      queryClient.setQueryData(projectKeys.detail(projectId), project);
      queryClient.setQueryData(projectKeys.toc(projectId), value);
      void queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
    onError: (error) => toast.error(`Could not save TOC JSON: ${error.message}`)
  });
  const offsetMutation = useMutation({
    mutationFn: ({ value }: { value: number; sequence: number }) => saveProjectOffset(projectId, value),
    onSuccess: (project, { value, sequence }) => {
      if (sequence !== offsetSaveSequenceRef.current) return;
      savedOffsetRef.current = String(value);
      queryClient.setQueryData(projectKeys.detail(projectId), project);
      void queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
    onError: (error) => toast.error(`Could not save project offset: ${error.message}`)
  });

  useEffect(() => {
    const project = projectQuery.data;
    const toc = tocQuery.data;
    if (!project || toc === undefined) return;
    setTocText(toc);
    setPageOffset(String(project.page_offset ?? 0));
    savedTocRef.current = toc;
    savedOffsetRef.current = String(project.page_offset ?? 0);
    setTocStart("1");
    setTocEnd(String(project.page_count));
  }, [projectId, projectQuery.data, tocQuery.data]);

  useEffect(() => {
    setPdfVersion(0);
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !projectQuery.data || tocText === savedTocRef.current) return;
    const sequence = tocSaveSequenceRef.current + 1;
    tocSaveSequenceRef.current = sequence;
    const timer = window.setTimeout(() => tocMutation.mutate({ value: tocText, sequence }), 700);
    return () => window.clearTimeout(timer);
  }, [projectId, projectQuery.data, tocText]);

  useEffect(() => {
    if (!projectId || !projectQuery.data || pageOffset === savedOffsetRef.current) return;
    const value = Number.parseInt(pageOffset, 10);
    if (!Number.isInteger(value)) return;
    const sequence = offsetSaveSequenceRef.current + 1;
    offsetSaveSequenceRef.current = sequence;
    const timer = window.setTimeout(() => offsetMutation.mutate({ value, sequence }), 500);
    return () => window.clearTimeout(timer);
  }, [pageOffset, projectId, projectQuery.data]);

  useEffect(() => {
    function openFind(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        editorRef.current?.openFind();
      }
    }
    window.addEventListener("keydown", openFind, true);
    return () => window.removeEventListener("keydown", openFind, true);
  }, []);

  const generationJobsQuery = useQuery({
    queryKey: projectKeys.generationJobs(projectId),
    queryFn: () => listProjectGenerationJobs(projectId),
    enabled: Boolean(projectId),
    refetchInterval: (query) => query.state.data?.some((job) => job.status === "queued" || job.status === "running") ? 1500 : false
  });
  const generationJobs = generationJobsQuery.data ?? [];
  const activeGenerationJob = generationJobs.find((job) => job.status === "queued" || job.status === "running");

  useEffect(() => {
    const job = generationJobs[0];
    if (!job || job.status === "queued" || job.status === "running") return;
    const version = `${job.id}:${job.updated_at}`;
    if (handledTerminalJobsRef.current.has(version)) return;
    handledTerminalJobsRef.current.add(version);
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) }),
      queryClient.invalidateQueries({ queryKey: projectKeys.toc(projectId) }),
      queryClient.invalidateQueries({ queryKey: projectKeys.all }),
      queryClient.invalidateQueries({ queryKey: projectKeys.allGenerationJobs })
    ]);
    if (job.id !== submittedGenerationJobId) return;
    setSubmittedGenerationJobId(null);
    if (job.status === "failed") {
      toast.error(job.error || job.message || "TOC generation failed");
    } else {
      toast.success(job.message);
    }
  }, [generationJobs, projectId, queryClient, submittedGenerationJobId]);

  async function flushAutosave() {
    const offset = Number.parseInt(pageOffset, 10);
    if (!Number.isInteger(offset)) throw new Error("Page offset must be an integer");
    const pending: Promise<unknown>[] = [];
    if (tocText !== savedTocRef.current) {
      const sequence = tocSaveSequenceRef.current + 1;
      tocSaveSequenceRef.current = sequence;
      pending.push(tocMutation.mutateAsync({ value: tocText, sequence }));
    }
    if (pageOffset !== savedOffsetRef.current) {
      const sequence = offsetSaveSequenceRef.current + 1;
      offsetSaveSequenceRef.current = sequence;
      pending.push(offsetMutation.mutateAsync({ value: offset, sequence }));
    }
    await Promise.all(pending);
    return offset;
  }

  async function preview() {
    const project = projectQuery.data;
    if (!project) return;
    setIsPreviewing(true);
    try {
      const offset = await flushAutosave();
      await applyProject(project.id, tocText, offset);
      setPdfVersion((version) => version + 1);
      toast.success("Preview PDF updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to apply TOC");
    } finally {
      setIsPreviewing(false);
    }
  }

  async function startGeneration() {
    const start = Number.parseInt(tocStart, 10);
    const end = Number.parseInt(tocEnd, 10);
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      toast.error("TOC page range must be integer page numbers");
      return;
    }

    setIsStartingGeneration(true);
    try {
      const job = await generateProjectToc(projectId, start, end);
      setSubmittedGenerationJobId(job.id);
      queryClient.setQueryData(projectKeys.generationJobs(projectId), (current: typeof generationJobs | undefined) => [job, ...(current ?? [])]);
      queryClient.setQueryData(projectKeys.allGenerationJobs, (current: typeof generationJobs | undefined) => [job, ...(current ?? [])]);
      setGenerateDialogOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start TOC generation");
    } finally {
      setIsStartingGeneration(false);
    }
  }

  const isGenerating = Boolean(activeGenerationJob) || isStartingGeneration;
  const canUseProjectActions = Boolean(projectQuery.data && tocText.trim() && pageOffset.trim() && !isPreviewing && !isGenerating);
  const workspaceStyle = useMemo(() => ({ "--editor-split": `${splitPercent}%` }) as React.CSSProperties, [splitPercent]);

  if (projectQuery.isLoading || tocQuery.isLoading) return <RouteMessage title="Loading project" message="Opening project workspace." onBack={() => navigate("/")} />;
  if (!projectQuery.data || projectQuery.isError || tocQuery.isError) return <RouteMessage title="Project unavailable" message={(projectQuery.error ?? tocQuery.error)?.message ?? "This project could not be loaded."} onBack={() => navigate("/")} />;

  return (
    <>
      <WorkspaceView
        project={projectQuery.data}
        tocText={tocText}
        pageOffset={pageOffset}
        theme={theme}
        canUseProjectActions={canUseProjectActions}
        isPreviewing={isPreviewing}
        isGenerating={isGenerating}
        pdfVersion={pdfVersion}
        isResizing={isResizing}
        workspaceStyle={workspaceStyle}
        workspaceRef={workspaceRef}
        editorRef={editorRef}
        splitPercent={splitPercent}
        minSplitPercent={MIN_SPLIT_PERCENT}
        maxSplitPercent={MAX_SPLIT_PERCENT}
        onReturnHome={() => navigate("/")}
        onOpenTasks={() => navigate("/tasks")}
        onOpenSettings={() => navigate("/settings", { state: { from: `/projects/${projectId}` } })}
        onPageOffsetChange={setPageOffset}
        onOpenGenerateDialog={() => setGenerateDialogOpen(true)}
        onApplyPreview={() => void preview()}
        onEditorChange={setTocText}
        onSplitterKeyDown={onKeyDown}
        onSplitterPointerDown={onPointerDown}
        onSplitterPointerMove={onPointerMove}
        onSplitterPointerUp={onPointerUp}
        onSplitterPointerCancel={onPointerCancel}
      />
      {generateDialogOpen ? (
        <GenerateDialog
          project={projectQuery.data}
          tocStart={tocStart}
          tocEnd={tocEnd}
          onTocStartChange={setTocStart}
          onTocEndChange={setTocEnd}
          onCancel={() => setGenerateDialogOpen(false)}
          onGenerate={() => void startGeneration()}
        />
      ) : null}
    </>
  );
}

function RouteMessage({ title, message, onBack }: { title: string; message: string; onBack: () => void }) {
  return <main className="app-shell route-fallback-shell"><section className="route-fallback"><h1>{title}</h1><p>{message}</p><button className="secondary-action" type="button" onClick={onBack}>Projects</button></section></main>;
}
