import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type DragEvent,
  type MouseEvent,
} from "react";
import {
  CheckSquare,
  ChevronDown,
  Download,
  FileText,
  ListPlus,
  MoreHorizontal,
  Settings2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { Project, VlmProvider } from "../types";
import { formatDate } from "../utils";
import { AppNavigation } from "./AppNavigation";

export type ProjectGenerationSettings = {
  projectId: string;
  tocStart: number;
  tocEnd: number;
  pageOffset: number;
  providerId: string;
  injectTocPage: boolean;
};

type GenerationSettingsForm = {
  tocStart: string;
  tocEnd: string;
  pageOffset: string;
  providerId: string;
  injectTocPage: boolean;
};

type HomeViewProps = {
  projects: Project[];
  providers: VlmProvider[];
  canQueueProjects: boolean;
  onCreateProjects: (files: File[]) => void;
  onCreateProjectInput: (event: ChangeEvent<HTMLInputElement>) => void;
  onOpenProject: (projectId: string) => void;
  onQueueProjects: (projectIds: string[]) => void;
  onDownloadProjects: (projectIds: string[]) => void;
  onDeleteProjects: (projectIds: string[]) => void;
  onSaveProjectGenerationSettings: (settings: ProjectGenerationSettings[]) => void;
  onOpenTasks: () => void;
  onOpenPlayground: () => void;
  onOpenDocs: () => void;
  onOpenSettings: () => void;
};

export function HomeView({
  projects,
  providers,
  canQueueProjects,
  onCreateProjects,
  onCreateProjectInput,
  onOpenProject,
  onQueueProjects,
  onDownloadProjects,
  onDeleteProjects,
  onSaveProjectGenerationSettings,
  onOpenTasks,
  onOpenPlayground,
  onOpenDocs,
  onOpenSettings,
}: HomeViewProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [openMenuProjectId, setOpenMenuProjectId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [configuringProjectIds, setConfiguringProjectIds] = useState<string[]>([]);
  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [projects],
  );
  const selectedProjects = sortedProjects.filter((project) =>
    selectedProjectIds.includes(project.id),
  );
  const isSelecting = selectedProjectIds.length > 0;
  const allSelected =
    sortedProjects.length > 0 && selectedProjectIds.length === sortedProjects.length;

  useEffect(() => {
    setSelectedProjectIds((current) =>
      current.filter((projectId) => projects.some((project) => project.id === projectId)),
    );
  }, [projects]);

  useEffect(() => {
    function clearSelection(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedProjectIds([]);
    }
    window.addEventListener("keydown", clearSelection);
    return () => window.removeEventListener("keydown", clearSelection);
  }, []);

  useEffect(() => {
    if (!openMenuProjectId) return;
    function closeMenu(event: PointerEvent) {
      if (!(event.target as Element | null)?.closest(".project-actions-cell"))
        setOpenMenuProjectId(null);
    }
    document.addEventListener("pointerdown", closeMenu);
    return () => document.removeEventListener("pointerdown", closeMenu);
  }, [openMenuProjectId]);

  useEffect(() => {
    if (!openMenuProjectId) return;
    function closeMenu() {
      setOpenMenuProjectId(null);
    }
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [openMenuProjectId]);

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDragging(false);
    onCreateProjects(Array.from(event.dataTransfer.files));
  }

  function toggleProject(projectId: string) {
    setSelectedProjectIds((current) =>
      current.includes(projectId)
        ? current.filter((selectedId) => selectedId !== projectId)
        : [...current, projectId],
    );
  }

  function toggleAllProjects() {
    setSelectedProjectIds(allSelected ? [] : sortedProjects.map((project) => project.id));
  }

  function clearSelection() {
    setSelectedProjectIds([]);
  }

  function runBatchAction(action: (projectIds: string[]) => void) {
    if (!selectedProjectIds.length) return;
    action(selectedProjectIds);
    clearSelection();
  }

  function queueConfiguredProjects(projectIds: string[]) {
    const selected = projectIds
      .map((projectId) => projects.find((project) => project.id === projectId))
      .filter((project): project is Project => Boolean(project));
    if (!selected.length) return;
    if (selected.some((project) => !canQueueProject(project, providers))) {
      setConfiguringProjectIds(selected.map((project) => project.id));
      return;
    }
    onQueueProjects(selected.map((project) => project.id));
    clearSelection();
  }

  function toggleProjectMenu(projectId: string, anchor: HTMLElement) {
    setOpenMenuProjectId((current) => {
      if (current === projectId) {
        setMenuPosition(null);
        return null;
      }
      const rect = anchor.getBoundingClientRect();
      const menuWidth = 190;
      const menuHeight = 146;
      setMenuPosition({
        left: Math.max(12, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 12)),
        top:
          rect.bottom + menuHeight + 8 > window.innerHeight
            ? Math.max(12, rect.top - menuHeight - 4)
            : rect.bottom + 4,
      });
      return projectId;
    });
  }

  const configuringProjects = configuringProjectIds
    .map((projectId) => projects.find((project) => project.id === projectId))
    .filter((project): project is Project => Boolean(project));

  return (
    <main className={`app-shell home-shell${isSelecting ? " selecting" : ""}`}>
      <AppNavigation
        active="home"
        onHome={() => undefined}
        onTasks={onOpenTasks}
        onPlayground={onOpenPlayground}
        onDocs={onOpenDocs}
        onSettings={onOpenSettings}
      />
      <header className="app-header">
        <div>
          <p className="eyebrow">PDF Bookmark Manager</p>
          <h1>Your library</h1>
        </div>
      </header>

      <section className="home-content">
        <div className="library-toolbar">
          <div>
            <p className="section-kicker">Cloud library</p>
            <h2>Projects</h2>
          </div>
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
            <span className="import-zone-icon">
              <Upload size={18} aria-hidden="true" />
            </span>
            <span className="import-zone-copy">
              <strong>Upload PDFs</strong>
              <small>Drop here or choose files</small>
            </span>
            <input
              id="project-import"
              className="import-file-input"
              type="file"
              accept="application/pdf,.pdf"
              multiple
              onChange={onCreateProjectInput}
            />
          </label>
        </div>

        <section className="library-section" aria-labelledby="project-library">
          <div className="section-heading">
            <div>
              <h2 id="project-library">All projects</h2>
              <p>{projects.length} projects in your library</p>
            </div>
          </div>
          {sortedProjects.length ? (
            <div className="project-table" role="table" aria-label="Projects">
              <div className="project-table-header" role="row">
                <label className="project-select-cell">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    aria-label={allSelected ? "Deselect all projects" : "Select all projects"}
                    onChange={toggleAllProjects}
                  />
                </label>
                <span>Name</span>
                <span>Pages</span>
                <span>TOC range</span>
                <span>Offset</span>
                <span>Status</span>
                <span>Modified</span>
                <span aria-label="Actions" />
              </div>
              <div className="project-list">
                {sortedProjects.map((project) => (
                  <ProjectRow
                    key={project.id}
                    project={project}
                    selected={selectedProjectIds.includes(project.id)}
                    selecting={isSelecting}
                    onOpen={onOpenProject}
                    onToggle={toggleProject}
                    onConfigure={(projectId) => {
                      setOpenMenuProjectId(null);
                      setConfiguringProjectIds([projectId]);
                    }}
                    onQueue={(projectId) => {
                      setOpenMenuProjectId(null);
                      queueConfiguredProjects([projectId]);
                    }}
                    onDownload={(projectId) => {
                      setOpenMenuProjectId(null);
                      onDownloadProjects([projectId]);
                    }}
                    onDelete={(projectId) => {
                      setOpenMenuProjectId(null);
                      onDeleteProjects([projectId]);
                    }}
                    menuOpen={openMenuProjectId === project.id}
                    menuPosition={menuPosition}
                    onToggleMenu={toggleProjectMenu}
                  />
                ))}
              </div>
            </div>
          ) : (
            <EmptyState />
          )}
        </section>
      </section>

      {isSelecting ? (
        <div className="selection-bar" role="region" aria-label="Selected project actions">
          <div className="selection-summary">
            <CheckSquare size={18} aria-hidden="true" />
            <span>{selectedProjects.length} selected</span>
          </div>
          <div className="selection-actions">
            <button
              className="secondary-action"
              type="button"
              disabled={!canQueueProjects}
              title={canQueueProjects ? "Add selected projects to queue" : "No verified VLM API"}
              onClick={() => queueConfiguredProjects(selectedProjectIds)}
            >
              <ListPlus size={16} aria-hidden="true" />
              Add to queue
            </button>
            <button
              className="secondary-action"
              type="button"
              onClick={() => runBatchAction(onDownloadProjects)}
            >
              <Download size={16} aria-hidden="true" />
              Download PDF
            </button>
            <button
              className="danger-action"
              type="button"
              onClick={() => runBatchAction(onDeleteProjects)}
            >
              <Trash2 size={16} aria-hidden="true" />
              Delete
            </button>
            <button className="secondary-action icon-only" type="button" onClick={clearSelection}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
      {configuringProjects.length ? (
        <GenerationSettingsDialog
          projects={configuringProjects}
          providers={providers}
          onCancel={() => setConfiguringProjectIds([])}
          onSave={(settings) => {
            onSaveProjectGenerationSettings(settings);
            setConfiguringProjectIds([]);
          }}
        />
      ) : null}
    </main>
  );
}

function ProjectRow({
  project,
  selected,
  selecting,
  onOpen,
  onToggle,
  onConfigure,
  onQueue,
  onDownload,
  onDelete,
  menuOpen,
  menuPosition,
  onToggleMenu,
}: {
  project: Project;
  selected: boolean;
  selecting: boolean;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onConfigure: (id: string) => void;
  onQueue: (id: string) => void;
  onDownload: (id: string) => void;
  onDelete: (id: string) => void;
  menuOpen: boolean;
  menuPosition: { top: number; left: number } | null;
  onToggleMenu: (id: string, anchor: HTMLElement) => void;
}) {
  const validation = project.last_validation?.valid
    ? `${project.last_validation.bookmark_count} bookmarks`
    : project.last_validation
      ? "Needs review"
      : "Not previewed";
  return (
    <article className={`project-row${selected ? " selected" : ""}`} role="row">
      <label className={`project-select-cell${selecting ? " visible" : ""}`}>
        <input
          type="checkbox"
          checked={selected}
          aria-label={`Select ${project.name}`}
          onChange={() => onToggle(project.id)}
        />
      </label>
      <button className="project-open" type="button" onClick={() => onOpen(project.id)}>
        <span className="project-file-icon">
          <FileText size={18} aria-hidden="true" />
        </span>
        <span className="project-name">
          <strong>{project.name}</strong>
          <small>{project.pdf_filename}</small>
        </span>
      </button>
      <span className="project-meta">{project.page_count} pages</span>
      <span className="project-meta">
        {project.toc_start}-{project.toc_end}
      </span>
      <span className="project-meta">{project.page_offset}</span>
      <span className={`project-status${project.last_validation?.valid ? " success" : ""}`}>
        {validation}
      </span>
      <span className="project-meta">{formatDate(project.updated_at)}</span>
      <div className="project-actions-cell">
        <button
          className="project-more"
          type="button"
          aria-label={`Actions for ${project.name}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="Project actions"
          onClick={(event: MouseEvent<HTMLButtonElement>) =>
            onToggleMenu(project.id, event.currentTarget)
          }
        >
          <MoreHorizontal size={16} aria-hidden="true" />
        </button>
        {menuOpen ? (
          <div className="project-menu" role="menu" style={menuPosition ?? undefined}>
            <button type="button" role="menuitem" onClick={() => onConfigure(project.id)}>
              <Settings2 size={15} aria-hidden="true" />
              Configure generation
            </button>
            <button type="button" role="menuitem" onClick={() => onQueue(project.id)}>
              <ListPlus size={15} aria-hidden="true" />
              Add to queue
            </button>
            <button type="button" role="menuitem" onClick={() => onDownload(project.id)}>
              <Download size={15} aria-hidden="true" />
              Download PDF
            </button>
            <button
              className="danger"
              type="button"
              role="menuitem"
              onClick={() => onDelete(project.id)}
            >
              <Trash2 size={15} aria-hidden="true" />
              Delete
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function GenerationSettingsDialog({
  projects,
  providers,
  onCancel,
  onSave,
}: {
  projects: Project[];
  providers: VlmProvider[];
  onCancel: () => void;
  onSave: (settings: ProjectGenerationSettings[]) => void;
}) {
  const [forms, setForms] = useState<Record<string, GenerationSettingsForm>>(() =>
    Object.fromEntries(
      projects.map((project) => [
        project.id,
        {
          tocStart: String(project.toc_start ?? 1),
          tocEnd: String(project.toc_end ?? project.page_count),
          pageOffset: String(project.page_offset ?? 0),
          providerId: project.provider_id ?? providers[0]?.id ?? "",
          injectTocPage: project.inject_toc_page ?? false,
        },
      ]),
    ),
  );
  const parsedSettings = projects.map((project) => ({
    project,
    settings: parseGenerationSettings(project, forms[project.id], providers),
  }));
  const canSave = parsedSettings.length > 0 && parsedSettings.every((item) => item.settings.valid);

  function updateForm(projectId: string, patch: Partial<GenerationSettingsForm>) {
    setForms((current) => ({
      ...current,
      [projectId]: { ...current[projectId], ...patch },
    }));
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal generation-settings-modal" role="dialog" aria-modal="true">
        <div className="modal-header">
          <div>
            <p className="section-kicker">Generation settings</p>
            <h2>{projects.length === 1 ? "Configure project" : "Configure selected projects"}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close" onClick={onCancel}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        {providers.length ? null : (
          <p className="warning-text">No verified VLM API is available. Verify an API first.</p>
        )}
        <div className="generation-settings-grid">
          <div className="generation-settings-header">
            <span>Project</span>
            <span>TOC start</span>
            <span>TOC end</span>
            <span>Offset</span>
            <span>VLM API</span>
            <span>目录</span>
          </div>
          {parsedSettings.map(({ project, settings }) => {
            const form = forms[project.id];
            return (
              <div
                key={project.id}
                className={`generation-settings-row${settings.valid ? "" : " invalid"}`}
              >
                <span className="generation-project-name" title={project.name}>
                  {project.name}
                </span>
                <input
                  type="number"
                  min={1}
                  max={project.page_count}
                  value={form.tocStart}
                  aria-label={`${project.name} TOC start`}
                  onChange={(event) => updateForm(project.id, { tocStart: event.target.value })}
                />
                <input
                  type="number"
                  min={1}
                  max={project.page_count}
                  value={form.tocEnd}
                  aria-label={`${project.name} TOC end`}
                  onChange={(event) => updateForm(project.id, { tocEnd: event.target.value })}
                />
                <input
                  type="number"
                  value={form.pageOffset}
                  aria-label={`${project.name} page offset`}
                  onChange={(event) => updateForm(project.id, { pageOffset: event.target.value })}
                />
                <label className="generation-provider-field">
                  <span>VLM API</span>
                  <select
                    value={form.providerId}
                    aria-label={`${project.name} VLM API`}
                    onChange={(event) => updateForm(project.id, { providerId: event.target.value })}
                  >
                    <option value="">Select API</option>
                    {providers.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="generation-inject-field" title="注入目录 page">
                  <input
                    type="checkbox"
                    checked={form.injectTocPage}
                    aria-label={`${project.name} 注入目录 page`}
                    onChange={(event) =>
                      updateForm(project.id, { injectTocPage: event.target.checked })
                    }
                  />
                </label>
              </div>
            );
          })}
        </div>
        <div className="modal-actions">
          <button className="secondary-action" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="primary-action"
            type="button"
            disabled={!canSave}
            onClick={() =>
              onSave(
                parsedSettings.map(({ project, settings }) => ({
                  projectId: project.id,
                  tocStart: settings.tocStart,
                  tocEnd: settings.tocEnd,
                  pageOffset: settings.pageOffset,
                  providerId: settings.providerId,
                  injectTocPage: settings.injectTocPage,
                })),
              )
            }
          >
            <ChevronDown size={16} aria-hidden="true" />
            Save settings
          </button>
        </div>
      </div>
    </div>
  );
}

function canQueueProject(project: Project, providers: VlmProvider[]): boolean {
  return parseGenerationSettings(project, undefined, providers).valid;
}

function parseGenerationSettings(
  project: Project,
  form: GenerationSettingsForm | undefined,
  providers: VlmProvider[],
) {
  const tocStart = Number.parseInt(form?.tocStart ?? String(project.toc_start ?? 1), 10);
  const tocEnd = Number.parseInt(form?.tocEnd ?? String(project.toc_end ?? project.page_count), 10);
  const pageOffset = Number.parseInt(form?.pageOffset ?? String(project.page_offset ?? 0), 10);
  const providerId = form?.providerId ?? project.provider_id ?? "";
  const injectTocPage = form?.injectTocPage ?? project.inject_toc_page ?? false;
  const valid =
    Number.isInteger(tocStart) &&
    Number.isInteger(tocEnd) &&
    Number.isInteger(pageOffset) &&
    tocStart >= 1 &&
    tocEnd >= tocStart &&
    tocEnd <= project.page_count &&
    providers.some((provider) => provider.id === providerId);
  return { tocStart, tocEnd, pageOffset, providerId, injectTocPage, valid };
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
