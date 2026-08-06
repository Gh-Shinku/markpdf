import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { GenerateDialog } from "../components/GenerateDialog";
import { WorkspaceView } from "../components/WorkspaceView";
import type { JsonEditorHandle } from "../JsonEditor";
import { getProviders, settingsKey } from "../features/settings/api";
import { useThemePreference } from "../hooks/useThemePreference";
import {
  MIN_SPLIT_PERCENT,
  MAX_SPLIT_PERCENT,
  useWorkspaceSplit,
} from "../hooks/useWorkspaceSplit";
import {
  applyProjectTocFile,
  generateProjectToc,
  getProject,
  getProjectTocFile,
  listProjectGenerationJobs,
  listProjectTocFiles,
  projectKeys,
  saveProjectMetadata,
  saveProjectTocFile,
} from "../features/projects/api";

function tocHistoryKey(projectId: string): string {
  return `bookmark:toc-history:${projectId}`;
}

function readTocHistory(projectId: string): string | null {
  try {
    return localStorage.getItem(tocHistoryKey(projectId));
  } catch {
    return null;
  }
}

function writeTocHistory(projectId: string, tocFileId: string): void {
  try {
    localStorage.setItem(tocHistoryKey(projectId), tocFileId);
  } catch {
    // 存储不可用时忽略历史记录。
  }
}

export function WorkspaceRoute() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { theme } = useThemePreference();
  const workspaceRef = useRef<HTMLElement | null>(null);
  const editorRef = useRef<JsonEditorHandle | null>(null);
  const {
    splitPercent,
    isResizing,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onKeyDown,
  } = useWorkspaceSplit(workspaceRef);
  const [selectedTocFileId, setSelectedTocFileId] = useState(
    () => readTocHistory(projectId) ?? "main",
  );
  const [tocText, setTocText] = useState("");
  const [pageOffset, setPageOffset] = useState("0");
  const [injectTocPage, setInjectTocPage] = useState(true);
  const [pdfVersion, setPdfVersion] = useState(0);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [tocStart, setTocStart] = useState("1");
  const [tocEnd, setTocEnd] = useState("1");
  const [providerId, setProviderId] = useState("");
  const [isStartingGeneration, setIsStartingGeneration] = useState(false);
  const savedTocRef = useRef("");
  const savedOffsetRef = useRef("0");
  const savedInjectTocPageRef = useRef(true);
  const savedTocStartRef = useRef("1");
  const savedTocEndRef = useRef("1");
  const tocSaveSequenceRef = useRef(0);
  const metadataSaveSequenceRef = useRef(0);
  const handledJobsRef = useRef(new Set<string>());
  const handledJobsProjectRef = useRef("");
  const projectQuery = useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => getProject(projectId),
    enabled: Boolean(projectId),
  });
  const tocFilesQuery = useQuery({
    queryKey: projectKeys.tocFiles(projectId),
    queryFn: () => listProjectTocFiles(projectId),
    enabled: Boolean(projectId),
  });
  const tocQuery = useQuery({
    queryKey: projectKeys.tocFile(projectId, selectedTocFileId),
    queryFn: () => getProjectTocFile(projectId, selectedTocFileId),
    enabled: Boolean(projectId),
  });
  const providersQuery = useQuery({ queryKey: settingsKey, queryFn: getProviders });
  const generationJobsQuery = useQuery({
    queryKey: projectKeys.generationJobs(projectId),
    queryFn: () => listProjectGenerationJobs(projectId),
    enabled: Boolean(projectId),
    refetchInterval: (query) =>
      query.state.data?.some((job) => job.status === "queued" || job.status === "running")
        ? 1500
        : false,
  });
  const generationJobs = useMemo(() => generationJobsQuery.data ?? [], [generationJobsQuery.data]);
  const isGenerating =
    generationJobs.some((job) => job.status === "queued" || job.status === "running") ||
    isStartingGeneration;
  const verifiedProviders = useMemo(
    () =>
      (providersQuery.data ?? []).filter((provider) => provider.verification_status === "verified"),
    [providersQuery.data],
  );

  const { mutate: mutateToc, mutateAsync: mutateTocAsync } = useMutation({
    mutationFn: ({ value }: { value: string; sequence: number }) =>
      saveProjectTocFile(projectId, selectedTocFileId, value),
    onSuccess: (project, variables) => {
      if (variables.sequence !== tocSaveSequenceRef.current) return;
      savedTocRef.current = variables.value;
      queryClient.setQueryData(projectKeys.detail(projectId), project);
      queryClient.setQueryData(projectKeys.tocFile(projectId, selectedTocFileId), variables.value);
    },
    onError: (error) => toast.error(`Could not save TOC JSON: ${error.message}`),
  });
  const { mutate: mutateMetadata, mutateAsync: mutateMetadataAsync } = useMutation({
    mutationFn: ({
      pageOffset,
      tocStart,
      tocEnd,
      injectTocPage,
    }: {
      pageOffset: number;
      tocStart: number;
      tocEnd: number;
      injectTocPage: boolean;
      sequence: number;
    }) => saveProjectMetadata(projectId, { pageOffset, tocStart, tocEnd, injectTocPage }),
    onSuccess: (project, variables) => {
      if (variables.sequence !== metadataSaveSequenceRef.current) return;
      savedOffsetRef.current = String(variables.pageOffset);
      savedTocStartRef.current = String(variables.tocStart);
      savedTocEndRef.current = String(variables.tocEnd);
      savedInjectTocPageRef.current = variables.injectTocPage;
      queryClient.setQueryData(projectKeys.detail(projectId), project);
    },
    onError: (error) => toast.error(error.message),
  });

  useEffect(() => {
    setSelectedTocFileId(readTocHistory(projectId) ?? "main");
    setTocText("");
    savedTocRef.current = "";
    setPdfVersion(0);
  }, [projectId]);
  useEffect(() => {
    // 记住上次打开的文件,下次进入该 project 时恢复。
    if (projectId) writeTocHistory(projectId, selectedTocFileId);
  }, [projectId, selectedTocFileId]);
  useEffect(() => {
    // 历史记录指向的文件可能已不存在,回退到主 toc 文件。
    const files = tocFilesQuery.data;
    if (!files) return;
    if (selectedTocFileId !== "main" && !files.some((file) => file.id === selectedTocFileId)) {
      setSelectedTocFileId("main");
    }
  }, [tocFilesQuery.data, selectedTocFileId]);
  useEffect(() => {
    const toc = tocQuery.data;
    if (toc === undefined) return;
    setTocText(toc);
    savedTocRef.current = toc;
  }, [projectId, selectedTocFileId, tocQuery.data]);
  useEffect(() => {
    const project = projectQuery.data;
    if (!project) return;
    setPageOffset(String(project.page_offset ?? 0));
    savedOffsetRef.current = String(project.page_offset ?? 0);
    setTocStart(String(project.toc_start ?? 1));
    savedTocStartRef.current = String(project.toc_start ?? 1);
    setTocEnd(String(project.toc_end ?? project.page_count));
    savedTocEndRef.current = String(project.toc_end ?? project.page_count);
    setInjectTocPage(project.inject_toc_page ?? true);
    savedInjectTocPageRef.current = project.inject_toc_page ?? true;
  }, [projectId, projectQuery.data]);
  useEffect(() => {
    if (!verifiedProviders.some((provider) => provider.id === providerId))
      setProviderId(verifiedProviders[0]?.id ?? "");
  }, [providerId, verifiedProviders]);
  useEffect(() => {
    if (!projectId || !projectQuery.data || tocText === savedTocRef.current) return;
    const sequence = ++tocSaveSequenceRef.current;
    const timer = window.setTimeout(() => mutateToc({ value: tocText, sequence }), 700);
    return () => window.clearTimeout(timer);
  }, [projectId, projectQuery.data, mutateToc, tocText, selectedTocFileId]);
  useEffect(() => {
    if (!projectId || !projectQuery.data) return;
    if (
      pageOffset === savedOffsetRef.current &&
      tocStart === savedTocStartRef.current &&
      tocEnd === savedTocEndRef.current &&
      injectTocPage === savedInjectTocPageRef.current
    )
      return;
    const parsedOffset = Number.parseInt(pageOffset, 10);
    const parsedStart = Number.parseInt(tocStart, 10);
    const parsedEnd = Number.parseInt(tocEnd, 10);
    if (
      !Number.isInteger(parsedOffset) ||
      !Number.isInteger(parsedStart) ||
      !Number.isInteger(parsedEnd)
    )
      return;
    if (
      parsedStart < 1 ||
      parsedEnd < parsedStart ||
      parsedEnd > Number(projectQuery.data.page_count)
    )
      return;
    const sequence = ++metadataSaveSequenceRef.current;
    const timer = window.setTimeout(
      () =>
        mutateMetadata({
          pageOffset: parsedOffset,
          tocStart: parsedStart,
          tocEnd: parsedEnd,
          injectTocPage,
          sequence,
        }),
      500,
    );
    return () => window.clearTimeout(timer);
  }, [injectTocPage, mutateMetadata, pageOffset, projectId, projectQuery.data, tocEnd, tocStart]);
  useEffect(() => {
    const openFind = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        editorRef.current?.openFind();
      }
    };
    window.addEventListener("keydown", openFind, true);
    return () => window.removeEventListener("keydown", openFind, true);
  }, []);
  useEffect(() => {
    if (!projectId || !generationJobsQuery.isSuccess) return;
    if (handledJobsProjectRef.current !== projectId) {
      handledJobsProjectRef.current = projectId;
      handledJobsRef.current = new Set(generationJobs.map((job) => `${job.id}:${job.updated_at}`));
      return;
    }
    generationJobs
      .filter((job) => job.status === "succeeded" || job.status === "failed")
      .forEach((job) => {
        const version = `${job.id}:${job.updated_at}`;
        if (handledJobsRef.current.has(version)) return;
        handledJobsRef.current.add(version);
        void queryClient.invalidateQueries({ queryKey: projectKeys.tocFiles(projectId) });
        void queryClient.invalidateQueries({ queryKey: projectKeys.allGenerationJobs });
        if (job.status === "succeeded") toast.success(job.message);
      });
  }, [generationJobs, generationJobsQuery.isSuccess, projectId, queryClient]);

  async function flushAutosave() {
    const offset = Number.parseInt(pageOffset, 10);
    const start = Number.parseInt(tocStart, 10);
    const end = Number.parseInt(tocEnd, 10);
    if (!Number.isInteger(offset)) throw new Error("Page offset must be an integer");
    if (!Number.isInteger(start) || !Number.isInteger(end))
      throw new Error("TOC page range must be valid");
    if (start < 1 || end < start || end > Number(projectQuery.data?.page_count ?? 0))
      throw new Error("TOC page range is outside the PDF page count");
    const pending: Promise<unknown>[] = [];
    if (tocText !== savedTocRef.current) {
      const sequence = ++tocSaveSequenceRef.current;
      pending.push(mutateTocAsync({ value: tocText, sequence }));
    }
    if (
      pageOffset !== savedOffsetRef.current ||
      tocStart !== savedTocStartRef.current ||
      tocEnd !== savedTocEndRef.current ||
      injectTocPage !== savedInjectTocPageRef.current
    ) {
      const sequence = ++metadataSaveSequenceRef.current;
      pending.push(
        mutateMetadataAsync({
          pageOffset: offset,
          tocStart: start,
          tocEnd: end,
          injectTocPage,
          sequence,
        }),
      );
    }
    await Promise.all(pending);
    return offset;
  }
  async function applySelectedToc() {
    const project = projectQuery.data;
    if (!project) return;
    setIsPreviewing(true);
    try {
      const offset = await flushAutosave();
      await applyProjectTocFile(project.id, selectedTocFileId, offset);
      // 注入的目录书签已写入 toc 文件,刷新编辑器与文件列表以保持一致。
      void queryClient.invalidateQueries({
        queryKey: projectKeys.tocFile(projectId, selectedTocFileId),
      });
      void queryClient.invalidateQueries({ queryKey: projectKeys.tocFiles(projectId) });
      setPdfVersion((value) => value + 1);
      toast.success("TOC applied to PDF");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to apply TOC");
    } finally {
      setIsPreviewing(false);
    }
  }
  async function startGeneration() {
    const start = Number.parseInt(tocStart, 10);
    const end = Number.parseInt(tocEnd, 10);
    if (!Number.isInteger(start) || !Number.isInteger(end) || !providerId) {
      toast.error("Select a verified VLM API and valid page range");
      return;
    }
    setIsStartingGeneration(true);
    try {
      const offset = await flushAutosave();
      const job = await generateProjectToc(projectId, start, end, providerId, offset);
      queryClient.setQueryData(
        projectKeys.generationJobs(projectId),
        (current: typeof generationJobs | undefined) => [job, ...(current ?? [])],
      );
      queryClient.setQueryData(
        projectKeys.allGenerationJobs,
        (current: typeof generationJobs | undefined) => [job, ...(current ?? [])],
      );
      setGenerateDialogOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start TOC generation");
    } finally {
      setIsStartingGeneration(false);
    }
  }
  const workspaceStyle = useMemo(
    () => ({ "--editor-split": `${splitPercent}%` }) as React.CSSProperties,
    [splitPercent],
  );
  const isInitialWorkspaceLoading =
    projectQuery.isLoading ||
    tocFilesQuery.isLoading ||
    (!tocText && selectedTocFileId === "main" && tocQuery.isLoading);
  const isTocFileLoading = tocQuery.isLoading || (!tocQuery.data && tocQuery.isFetching);
  if (isInitialWorkspaceLoading)
    return (
      <RouteMessage
        title="Loading project"
        message="Opening project workspace."
        onBack={() => navigate("/")}
      />
    );
  if (!projectQuery.data || projectQuery.isError || tocQuery.isError)
    return (
      <RouteMessage
        title="Project unavailable"
        message={
          (projectQuery.error ?? tocQuery.error)?.message ?? "This project could not be loaded."
        }
        onBack={() => navigate("/")}
      />
    );
  return (
    <>
      <WorkspaceView
        project={projectQuery.data}
        tocText={tocText}
        editorModelKey={`${projectId}:${selectedTocFileId}`}
        isEditorLoading={isTocFileLoading}
        tocFiles={tocFilesQuery.data ?? []}
        selectedTocFileId={selectedTocFileId}
        pageOffset={pageOffset}
        injectTocPage={injectTocPage}
        theme={theme}
        canUseProjectActions={Boolean(tocText.trim() && pageOffset.trim() && !isPreviewing)}
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
        onOpenDocs={() => navigate("/docs")}
        onOpenSettings={() => navigate("/settings", { state: { from: `/projects/${projectId}` } })}
        onPageOffsetChange={setPageOffset}
        onInjectTocPageChange={setInjectTocPage}
        onOpenGenerateDialog={() => setGenerateDialogOpen(true)}
        onApplyPreview={() => void applySelectedToc()}
        onEditorChange={setTocText}
        onSelectTocFile={(id) => {
          void flushAutosave()
            .then(() => setSelectedTocFileId(id))
            .catch((error) => toast.error(error.message));
        }}
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
          providers={verifiedProviders}
          providerId={providerId}
          onTocStartChange={setTocStart}
          onTocEndChange={setTocEnd}
          onProviderChange={setProviderId}
          onCancel={() => setGenerateDialogOpen(false)}
          onGenerate={() => void startGeneration()}
        />
      ) : null}
    </>
  );
}

function RouteMessage({
  title,
  message,
  onBack,
}: {
  title: string;
  message: string;
  onBack: () => void;
}) {
  return (
    <main className="app-shell route-fallback-shell">
      <section className="route-fallback">
        <h1>{title}</h1>
        <p>{message}</p>
        <button className="secondary-action" type="button" onClick={onBack}>
          Projects
        </button>
      </section>
    </main>
  );
}
