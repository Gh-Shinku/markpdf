import type { ChangeEvent } from "react";
import { BookMarked, FileJson, FileText, FolderOpen, Settings, Trash2, Upload, X } from "lucide-react";
import type { Project, Status } from "../types";
import { StatusLine } from "./StatusLine";

type HomeViewProps = {
  projects: Project[];
  pendingTocFile: File | null;
  status: Status;
  onPendingTocFileChange: (file: File | null) => void;
  onCreateProject: (event: ChangeEvent<HTMLInputElement>) => void;
  onOpenProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onOpenSettings: () => void;
};

export function HomeView({
  projects,
  pendingTocFile,
  status,
  onPendingTocFileChange,
  onCreateProject,
  onOpenProject,
  onDeleteProject,
  onOpenSettings
}: HomeViewProps) {
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
              onChange={(event) => onPendingTocFileChange(event.target.files?.[0] ?? null)}
            />
          </label>
          {pendingTocFile ? (
            <button
              className="secondary-action icon-only"
              type="button"
              onClick={() => onPendingTocFileChange(null)}
            >
              <X size={16} />
            </button>
          ) : null}
          <label className="primary-action upload-control">
            <Upload size={16} />
            <span>New Project</span>
            <input type="file" accept="application/pdf,.pdf" onChange={onCreateProject} />
          </label>
          <button className="secondary-action" type="button" onClick={onOpenSettings}>
            <Settings size={16} />
            Settings
          </button>
        </div>
      </header>

      <section className="manager">
        <div className="manager-header">
          <div>
            <h2>Projects</h2>
            <p>
              {projects.length} local project{projects.length === 1 ? "" : "s"}
            </p>
          </div>
          <StatusLine status={status} />
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
                onClick={() => onOpenProject(item.id)}
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
                      onDeleteProject(item.id);
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
