import { useMemo, useState, type ChangeEvent, type DragEvent } from "react";
import { Clock3, FileText, FolderOpen, Trash2, Upload } from "lucide-react";
import type { Project } from "../types";
import { AppNavigation } from "./AppNavigation";

type HomeViewProps = {
  projects: Project[];
  onCreateProjects: (files: File[]) => void;
  onCreateProjectInput: (event: ChangeEvent<HTMLInputElement>) => void;
  onOpenProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onOpenTasks: () => void;
  onOpenSettings: () => void;
};

export function HomeView({
  projects,
  onCreateProjects,
  onCreateProjectInput,
  onOpenProject,
  onDeleteProject,
  onOpenTasks,
  onOpenSettings,
}: HomeViewProps) {
  const [isDragging, setIsDragging] = useState(false);
  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [projects],
  );
  const recentProjects = sortedProjects.slice(0, 5);

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDragging(false);
    onCreateProjects(Array.from(event.dataTransfer.files));
  }

  return (
    <main className="app-shell home-shell">
      <AppNavigation
        active="home"
        onHome={() => undefined}
        onTasks={onOpenTasks}
        onSettings={onOpenSettings}
      />
      <header className="app-header">
        <div>
          <p className="eyebrow">PDF Bookmark Manager</p>
          <h1>Your library</h1>
        </div>
      </header>

      <section className="home-content">
        <label
          className={`import-zone${isDragging ? " dragging" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <div className="import-zone-icon">
            <Upload size={20} aria-hidden="true" />
          </div>
          <div>
            <h2>Create a project</h2>
            <p>Drop PDFs here, or choose one or more from your computer.</p>
          </div>
          <input
            id="project-import"
            className="import-file-input"
            type="file"
            accept="application/pdf,.pdf"
            multiple
            onChange={onCreateProjectInput}
          />
        </label>

        <section className="library-section" aria-labelledby="recent-projects">
          <div className="section-heading">
            <div>
              <p className="section-kicker">
                <Clock3 size={14} aria-hidden="true" /> Recent
              </p>
              <h2 id="recent-projects">Continue where you left off</h2>
            </div>
            <span className="item-count">{projects.length} projects</span>
          </div>
          {recentProjects.length ? (
            <div className="project-list recent-project-list">
              {recentProjects.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  onOpen={onOpenProject}
                  onDelete={onDeleteProject}
                />
              ))}
            </div>
          ) : (
            <EmptyState />
          )}
        </section>

        {sortedProjects.length > recentProjects.length ? (
          <section className="library-section all-projects" aria-labelledby="all-projects">
            <div className="section-heading">
              <div>
                <p className="section-kicker">
                  <FolderOpen size={14} aria-hidden="true" /> Library
                </p>
                <h2 id="all-projects">All projects</h2>
              </div>
            </div>
            <div className="project-list">
              {sortedProjects.slice(5).map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  onOpen={onOpenProject}
                  onDelete={onDeleteProject}
                />
              ))}
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}

function ProjectRow({
  project,
  onOpen,
  onDelete,
}: {
  project: Project;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const validation = project.last_validation?.valid
    ? `${project.last_validation.bookmark_count} bookmarks`
    : project.last_validation
      ? "Needs review"
      : "Not previewed";
  return (
    <article className="project-row">
      <button className="project-open" type="button" onClick={() => onOpen(project.id)}>
        <span className="project-file-icon">
          <FileText size={18} aria-hidden="true" />
        </span>
        <span className="project-name">
          <strong>{project.name}</strong>
          <small>{project.pdf_filename}</small>
        </span>
        <span className="project-meta">{project.page_count} pages</span>
        <span className={`project-status${project.last_validation?.valid ? " success" : ""}`}>
          {validation}
        </span>
      </button>
      <button
        className="icon-button danger-icon"
        type="button"
        aria-label={`Delete ${project.name}`}
        title="Delete project"
        onClick={() => onDelete(project.id)}
      >
        <Trash2 size={16} aria-hidden="true" />
      </button>
    </article>
  );
}

function EmptyState() {
  return (
    <div className="empty-manager">
      <FileText size={32} aria-hidden="true" />
      <div>
        <strong>No projects yet</strong>
        <span>Import a PDF to start creating bookmarks.</span>
      </div>
    </div>
  );
}
