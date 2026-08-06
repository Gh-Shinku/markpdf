import { useMemo, useState } from "react";
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
} from "lucide-react";
import type { GenerationJob, Project } from "../types";
import { formatDate } from "../utils";
import { AppNavigation } from "./AppNavigation";
import styles from "./TasksView.module.css";

type TaskFilter = "all" | "active" | "succeeded" | "failed";

type TasksViewProps = {
  jobs: GenerationJob[];
  projects: Project[];
  isLoading: boolean;
  error?: string;
  onOpenHome: () => void;
  onOpenTasks: () => void;
  onOpenDocs: () => void;
  onOpenSettings: () => void;
  onOpenProject: (projectId: string) => void;
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

export function TasksView({
  jobs,
  projects,
  isLoading,
  error,
  onOpenHome,
  onOpenTasks,
  onOpenDocs,
  onOpenSettings,
  onOpenProject,
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

  return (
    <main className="app-shell">
      <AppNavigation
        active="tasks"
        onHome={onOpenHome}
        onTasks={onOpenTasks}
        onDocs={onOpenDocs}
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
