import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Download,
  ExternalLink,
  ListChecks,
  Loader2,
  Plus,
} from "lucide-react";
import type { GenerationJob, Project, VlmProvider } from "../types";
import { formatDate } from "../utils";
import { AppNavigation } from "./AppNavigation";
import styles from "./TasksView.module.css";

type TaskFilter = "all" | "active" | "succeeded" | "failed";
type BatchProjectMeta = {
  tocStart: string;
  tocEnd: string;
  pageOffset: string;
};

type TasksViewProps = {
  jobs: GenerationJob[];
  projects: Project[];
  providers: VlmProvider[];
  isLoading: boolean;
  error?: string;
  onOpenHome: () => void;
  onOpenTasks: () => void;
  onOpenSettings: () => void;
  onOpenProject: (projectId: string) => void;
  onStartBatch: (
    requests: Array<{
      projectId: string;
      tocStart: number;
      tocEnd: number;
      pageOffset: number;
      providerId: string;
    }>,
  ) => void;
  onApplyJob: (jobId: string) => void;
};

const filters: Array<{ value: TaskFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Running" },
  { value: "succeeded", label: "Completed" },
  { value: "failed", label: "Failed" },
];

function isActive(job: GenerationJob): boolean {
  return job.status === "queued" || job.status === "running";
}

function statusLabel(job: GenerationJob): string {
  if (job.status === "queued") return "Queued";
  if (job.status === "running") return "Generating";
  if (job.status === "succeeded") return "Completed";
  return "Failed";
}

function StatusIcon({ job }: { job: GenerationJob }) {
  if (job.status === "queued") return <CircleDashed size={17} aria-hidden="true" />;
  if (job.status === "running") return <Loader2 className="spin" size={17} aria-hidden="true" />;
  if (job.status === "succeeded") return <CheckCircle2 size={17} aria-hidden="true" />;
  return <AlertCircle size={17} aria-hidden="true" />;
}

function defaultBatchMeta(project: Project): BatchProjectMeta {
  return {
    tocStart: String(project.toc_start ?? 1),
    tocEnd: String(project.toc_end ?? project.page_count),
    pageOffset: String(project.page_offset ?? 0),
  };
}

function parseBatchMeta(project: Project, meta: BatchProjectMeta | undefined) {
  const values = meta ?? defaultBatchMeta(project);
  const tocStart = Number.parseInt(values.tocStart, 10);
  const tocEnd = Number.parseInt(values.tocEnd, 10);
  const pageOffset = Number.parseInt(values.pageOffset, 10);
  const valid =
    Number.isInteger(tocStart) &&
    Number.isInteger(tocEnd) &&
    Number.isInteger(pageOffset) &&
    tocStart >= 1 &&
    tocEnd >= tocStart &&
    tocEnd <= project.page_count;
  return { tocStart, tocEnd, pageOffset, valid };
}

export function TasksView({
  jobs,
  projects,
  providers,
  isLoading,
  error,
  onOpenHome,
  onOpenTasks,
  onOpenSettings,
  onOpenProject,
  onStartBatch,
  onApplyJob,
}: TasksViewProps) {
  const [filter, setFilter] = useState<TaskFilter>("all");
  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const visibleJobs = jobs.filter((job) =>
    filter === "all" || filter === "active"
      ? filter === "all" || isActive(job)
      : job.status === filter,
  );
  const activeCount = jobs.filter(isActive).length;
  const completedCount = jobs.filter((job) => job.status === "succeeded").length;
  const failedCount = jobs.filter((job) => job.status === "failed").length;
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [projectMeta, setProjectMeta] = useState<Record<string, BatchProjectMeta>>({});
  const [providerId, setProviderId] = useState("");
  const verifiedProviders = providers.filter(
    (provider) => provider.verification_status === "verified",
  );
  const activeProjectIds = new Set(jobs.filter(isActive).map((job) => job.project_id));
  const selectedProjects = selectedProjectIds
    .map((projectId) => projects.find((project) => project.id === projectId))
    .filter((project): project is Project => Boolean(project));
  const canQueue =
    Boolean(selectedProjects.length && providerId) &&
    selectedProjects.every((project) => parseBatchMeta(project, projectMeta[project.id]).valid);
  useEffect(() => {
    if (!verifiedProviders.some((provider) => provider.id === providerId))
      setProviderId(verifiedProviders[0]?.id ?? "");
  }, [providerId, verifiedProviders]);

  function updateProjectMeta(project: Project, patch: Partial<BatchProjectMeta>) {
    setProjectMeta((current) => ({
      ...current,
      [project.id]: { ...defaultBatchMeta(project), ...current[project.id], ...patch },
    }));
  }

  return (
    <main className="app-shell">
      <AppNavigation
        active="tasks"
        onHome={onOpenHome}
        onTasks={onOpenTasks}
        onSettings={onOpenSettings}
      />
      <header className="app-header">
        <div>
          <p className="eyebrow">Background work</p>
          <h1>Tasks</h1>
        </div>
        <div className={styles.headerStats} aria-label="Task status summary">
          <span className={styles.headerStat}>
            <Clock3 size={16} aria-hidden="true" />
            {activeCount} active
          </span>
          <span>{completedCount} completed</span>
          <span>{failedCount} failed</span>
        </div>
      </header>

      <section className={`${styles.content} app-content-panel`} aria-label="Generation tasks">
        <section className={styles.batch} aria-label="Create generation tasks">
          <div className={styles.batchTop}>
            <div>
              <p className="section-kicker">Batch generation</p>
              <h2>Select PDFs</h2>
            </div>
            <div className={styles.batchActions}>
              <label className={styles.providerField}>
                <span>VLM API</span>
                <select value={providerId} onChange={(event) => setProviderId(event.target.value)}>
                  <option value="">No verified VLM API</option>
                  {verifiedProviders.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="primary-action"
                type="button"
                disabled={!canQueue}
                onClick={() =>
                  onStartBatch(
                    selectedProjects.map((project) => {
                      const meta = parseBatchMeta(project, projectMeta[project.id]);
                      return {
                        projectId: project.id,
                        tocStart: meta.tocStart,
                        tocEnd: meta.tocEnd,
                        pageOffset: meta.pageOffset,
                        providerId,
                      };
                    }),
                  )
                }
              >
                <Plus size={16} />
                Queue
              </button>
            </div>
          </div>
          <div className={styles.pickerHeader}>
            <span>PDFs</span>
            <small>
              {selectedProjectIds.length} selected · {projects.length} total
            </small>
          </div>
          <div className={styles.projectPicker}>
            {projects.map((project) => (
              <label
                key={project.id}
                className={activeProjectIds.has(project.id) ? styles.unavailable : ""}
              >
                <input
                  type="checkbox"
                  disabled={activeProjectIds.has(project.id)}
                  checked={selectedProjectIds.includes(project.id)}
                  onChange={(event) =>
                    setSelectedProjectIds((current) => {
                      if (!event.target.checked) return current.filter((id) => id !== project.id);
                      setProjectMeta((meta) => ({
                        ...meta,
                        [project.id]: meta[project.id] ?? defaultBatchMeta(project),
                      }));
                      return [...current, project.id];
                    })
                  }
                />
                <span>{project.name}</span>
                <small>{project.page_count} pages</small>
              </label>
            ))}
          </div>
          {selectedProjects.length ? (
            <div className={styles.metaEditor} aria-label="Selected project metainfo">
              <div className={styles.metaEditorHeader}>
                <span>Project</span>
                <span>TOC start</span>
                <span>TOC end</span>
                <span>Offset</span>
              </div>
              {selectedProjects.map((project) => {
                const meta = projectMeta[project.id] ?? defaultBatchMeta(project);
                const parsed = parseBatchMeta(project, meta);
                return (
                  <div
                    className={`${styles.metaEditorRow}${parsed.valid ? "" : ` ${styles.invalid}`}`}
                    key={project.id}
                  >
                    <span title={project.name}>{project.name}</span>
                    <input
                      type="number"
                      min={1}
                      max={project.page_count}
                      value={meta.tocStart}
                      aria-label={`${project.name} TOC start`}
                      onChange={(event) =>
                        updateProjectMeta(project, { tocStart: event.target.value })
                      }
                    />
                    <input
                      type="number"
                      min={1}
                      max={project.page_count}
                      value={meta.tocEnd}
                      aria-label={`${project.name} TOC end`}
                      onChange={(event) =>
                        updateProjectMeta(project, { tocEnd: event.target.value })
                      }
                    />
                    <input
                      type="number"
                      value={meta.pageOffset}
                      aria-label={`${project.name} page offset`}
                      onChange={(event) =>
                        updateProjectMeta(project, { pageOffset: event.target.value })
                      }
                    />
                  </div>
                );
              })}
            </div>
          ) : null}
        </section>

        <section className={styles.taskPanel} aria-label="Task history">
          <div className={styles.listToolbar}>
            <div className={styles.listHeading}>
              <h2>Generation jobs</h2>
              <span>{visibleJobs.length} shown</span>
            </div>
            <div className={styles.filters} role="group" aria-label="Filter tasks">
              {filters.map(({ value, label }) => (
                <button
                  key={value}
                  className={filter === value ? styles.selected : ""}
                  type="button"
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {isLoading ? <div className={styles.empty}>Loading tasks...</div> : null}
          {error ? (
            <div className={`${styles.empty} ${styles.error}`}>Could not load tasks: {error}</div>
          ) : null}
          {!isLoading && !error && visibleJobs.length === 0 ? <EmptyTasks filter={filter} /> : null}
          {!isLoading && !error && visibleJobs.length > 0 ? (
            <div className={styles.list}>
              {visibleJobs.map((job) => {
                const projectName = projectNames.get(job.project_id);
                const progress = job.progress;
                const percent =
                  progress.total_pages > 0
                    ? Math.min(
                        100,
                        Math.round((progress.completed_pages / progress.total_pages) * 100),
                      )
                    : 0;
                const hasActions = Boolean(projectName) || job.status === "succeeded";
                return (
                  <article className={styles.task} key={job.id}>
                    <div
                      className={`${styles.status} ${styles[job.status]}`}
                      title={statusLabel(job)}
                    >
                      <StatusIcon job={job} />
                    </div>
                    <div className={styles.summary}>
                      <div className={styles.titleRow}>
                        <strong>{projectName ?? "Deleted project"}</strong>
                        <span className={`${styles.statusBadge} ${styles[job.status]}`}>
                          {statusLabel(job)}
                        </span>
                      </div>
                      <p>{job.message}</p>
                      {isActive(job) ? (
                        <div className={styles.progress} aria-label={`${percent}% complete`}>
                          <span style={{ width: `${percent}%` }} />
                        </div>
                      ) : null}
                      {job.status === "failed" && job.error ? (
                        <p className={styles.errorText}>{job.error}</p>
                      ) : null}
                    </div>
                    <div className={styles.meta}>
                      <span>
                        TOC pages {job.toc_start}-{job.toc_end}
                      </span>
                      <span>
                        {isActive(job)
                          ? `${progress.completed_pages}/${progress.total_pages} pages`
                          : formatDate(job.finished_at ?? job.updated_at)}
                      </span>
                    </div>
                    {hasActions ? (
                      <div className={styles.jobActions}>
                        {projectName ? (
                          <button
                            className={styles.taskAction}
                            type="button"
                            onClick={() => onOpenProject(job.project_id)}
                            title="Open workspace"
                            aria-label={`Open ${projectName}`}
                          >
                            <ExternalLink size={16} aria-hidden="true" />
                          </button>
                        ) : null}
                        {job.status === "succeeded" ? (
                          <>
                            <button
                              className={styles.taskAction}
                              type="button"
                              title="Apply generated TOC"
                              aria-label="Apply generated TOC"
                              onClick={() => onApplyJob(job.id)}
                            >
                              <Check size={16} />
                            </button>
                            <a
                              className={styles.taskAction}
                              href={`/api/jobs/${job.id}/download`}
                              title="Download generated PDF"
                              aria-label="Download generated PDF"
                            >
                              <Download size={16} />
                            </a>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}

function EmptyTasks({ filter }: { filter: TaskFilter }) {
  const message =
    filter === "all"
      ? "No generation tasks yet."
      : `No ${filter === "active" ? "running" : filter} tasks.`;
  return (
    <div className={styles.empty}>
      <ListChecks size={24} aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
