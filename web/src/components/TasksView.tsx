import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, CheckCircle2, CircleDashed, Clock3, Download, ExternalLink, ListChecks, Loader2, Plus } from "lucide-react";
import type { GenerationJob, Project, VlmProvider } from "../types";
import { formatDate } from "../utils";
import { AppNavigation } from "./AppNavigation";
import styles from "./TasksView.module.css";

type TaskFilter = "all" | "active" | "succeeded" | "failed";

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
  onStartBatch: (requests: Array<{ projectId: string; tocStart: number; tocEnd: number; providerId: string }>) => void;
  onApplyJob: (jobId: string) => void;
};

const filters: Array<{ value: TaskFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Running" },
  { value: "succeeded", label: "Completed" },
  { value: "failed", label: "Failed" }
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
  providers,
  isLoading,
  error,
  onOpenHome,
  onOpenTasks,
  onOpenSettings,
  onOpenProject
  , onStartBatch, onApplyJob
}: TasksViewProps) {
  const [filter, setFilter] = useState<TaskFilter>("all");
  const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);
  const visibleJobs = jobs.filter((job) => filter === "all" || filter === "active" ? (filter === "all" || isActive(job)) : job.status === filter);
  const activeCount = jobs.filter(isActive).length;
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [providerId, setProviderId] = useState("");
  const verifiedProviders = providers.filter((provider) => provider.verification_status === "verified");
  const activeProjectIds = new Set(jobs.filter(isActive).map((job) => job.project_id));
  useEffect(() => { if (!verifiedProviders.some((provider) => provider.id === providerId)) setProviderId(verifiedProviders[0]?.id ?? ""); }, [providerId, verifiedProviders]);

  return (
    <main className="app-shell">
      <AppNavigation active="tasks" onHome={onOpenHome} onTasks={onOpenTasks} onSettings={onOpenSettings} />
      <header className="app-header">
        <div>
          <p className="eyebrow">Background work</p>
          <h1>Tasks</h1>
        </div>
        <div className={styles.activeCount} aria-label={`${activeCount} active tasks`}>
          <Clock3 size={16} aria-hidden="true" />
          <span>{activeCount} active</span>
        </div>
      </header>

      <section className={`${styles.content} app-content-panel`} aria-label="Generation tasks">
        <section className={styles.batch} aria-label="Create generation tasks">
          <div className={styles.batchHeader}><div><p className="section-kicker">Batch generation</p><h2>Select PDFs</h2></div><button className="primary-action" type="button" disabled={!selectedProjectIds.length || !providerId} onClick={() => onStartBatch(selectedProjectIds.map((projectId) => { const project = projects.find((item) => item.id === projectId)!; return { projectId, tocStart: 1, tocEnd: project.page_count, providerId }; }))}><Plus size={16} />Queue</button></div>
          <div className={styles.batchControls}><select value={providerId} onChange={(event) => setProviderId(event.target.value)}><option value="">No verified VLM API</option>{verifiedProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} - {provider.model}</option>)}</select></div>
          <div className={styles.projectPicker}>{projects.map((project) => <label key={project.id} className={activeProjectIds.has(project.id) ? styles.unavailable : ""}><input type="checkbox" disabled={activeProjectIds.has(project.id)} checked={selectedProjectIds.includes(project.id)} onChange={(event) => setSelectedProjectIds((current) => event.target.checked ? [...current, project.id] : current.filter((id) => id !== project.id))} /><span>{project.name}</span><small>{project.page_count} pages</small></label>)}</div>
        </section>
        <div className={styles.filters} role="group" aria-label="Filter tasks">
          {filters.map(({ value, label }) => (
            <button key={value} className={filter === value ? styles.selected : ""} type="button" onClick={() => setFilter(value)}>
              {label}
            </button>
          ))}
        </div>

        {isLoading ? <div className={styles.empty}>Loading tasks...</div> : null}
        {error ? <div className={`${styles.empty} ${styles.error}`}>Could not load tasks: {error}</div> : null}
        {!isLoading && !error && visibleJobs.length === 0 ? <EmptyTasks filter={filter} /> : null}
        {!isLoading && !error && visibleJobs.length > 0 ? (
          <div className={styles.list}>
            {visibleJobs.map((job) => {
              const projectName = projectNames.get(job.project_id);
              const progress = job.progress;
              const percent = progress.total_pages > 0
                ? Math.min(100, Math.round((progress.completed_pages / progress.total_pages) * 100))
                : 0;
              return (
                <article className={styles.task} key={job.id}>
                  <div className={`${styles.status} ${styles[job.status]}`} title={statusLabel(job)}>
                    <StatusIcon job={job} />
                  </div>
                  <div className={styles.summary}>
                    <div className={styles.titleRow}>
                      <strong>{projectName ?? "Deleted project"}</strong>
                      <span>{statusLabel(job)}</span>
                    </div>
                    <p>{job.message}</p>
                    {isActive(job) ? (
                      <div className={styles.progress} aria-label={`${percent}% complete`}>
                        <span style={{ width: `${percent}%` }} />
                      </div>
                    ) : null}
                    {job.status === "failed" && job.error ? <p className={styles.errorText}>{job.error}</p> : null}
                  </div>
                  <div className={styles.meta}>
                    <span>TOC pages {job.toc_start}-{job.toc_end}</span>
                    <span>{isActive(job) ? `${progress.completed_pages}/${progress.total_pages} pages` : formatDate(job.finished_at ?? job.updated_at)}</span>
                  </div>
                  {projectName ? (
                    <button className={styles.openProject} type="button" onClick={() => onOpenProject(job.project_id)} title="Open workspace" aria-label={`Open ${projectName}`}>
                      <ExternalLink size={16} aria-hidden="true" />
                    </button>
                  ) : null}
                  {job.status === "succeeded" ? <div className={styles.jobActions}><button className={styles.openProject} type="button" title="Apply generated TOC" aria-label="Apply generated TOC" onClick={() => onApplyJob(job.id)}><Check size={16} /></button><a className={styles.openProject} href={`/api/jobs/${job.id}/download`} title="Download generated PDF" aria-label="Download generated PDF"><Download size={16} /></a></div> : null}
                </article>
              );
            })}
          </div>
        ) : null}
      </section>
    </main>
  );
}

function EmptyTasks({ filter }: { filter: TaskFilter }) {
  const message = filter === "all" ? "No generation tasks yet." : `No ${filter === "active" ? "running" : filter} tasks.`;
  return (
    <div className={styles.empty}>
      <ListChecks size={24} aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
