import { useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { HomeView, type ProjectGenerationSettings } from "../components/HomeView";
import type { GenerationJob, Project } from "../types";
import { getProviders, settingsKey } from "../features/settings/api";
import {
  batchGenerateProjectTocs,
  createProject,
  deleteProject,
  listProjects,
  projectKeys,
  saveProjectMetadata,
} from "../features/projects/api";
import { makeBookmarkedFilename } from "../utils";

export function HomeRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<Project[]>([]);
  const projectsQuery = useQuery({ queryKey: projectKeys.all, queryFn: listProjects });
  const providersQuery = useQuery({ queryKey: settingsKey, queryFn: getProviders });
  const createMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const results = await Promise.allSettled(
        files.map(async (file) => ({ fileName: file.name, project: await createProject(file) })),
      );
      return {
        created: results
          .filter(
            (result): result is PromiseFulfilledResult<{ fileName: string; project: Project }> =>
              result.status === "fulfilled",
          )
          .map((result) => result.value.project),
        failed: results
          .filter((result): result is PromiseRejectedResult => result.status === "rejected")
          .map((result) =>
            result.reason instanceof Error ? result.reason.message : "Import failed",
          ),
      };
    },
    onSuccess: async ({ created, failed }, files) => {
      if (created.length) await queryClient.invalidateQueries({ queryKey: projectKeys.all });
      if (created.length === 1 && files.length === 1 && failed.length === 0) {
        toast.success("Project created");
        navigate(`/projects/${encodeURIComponent(created[0].id)}`);
        return;
      }
      if (created.length) toast.success(`${created.length} projects created`);
      if (failed.length)
        toast.error(`${failed.length} PDF${failed.length > 1 ? "s" : ""} failed to import`);
      if (!created.length && failed.length) toast.error(failed[0]);
    },
    onError: (error) => toast.error(error.message),
  });
  const batchQueueMutation = useMutation({
    mutationFn: batchGenerateProjectTocs,
    onSuccess: async (jobs) => {
      queryClient.setQueryData(
        projectKeys.allGenerationJobs,
        (current: GenerationJob[] | undefined) => [...jobs, ...(current ?? [])],
      );
      await queryClient.invalidateQueries({ queryKey: projectKeys.allGenerationJobs });
      await queryClient.invalidateQueries({ queryKey: projectKeys.all });
      toast.success(`${jobs.length} tasks queued`, {
        action: {
          label: "View tasks",
          onClick: () => navigate("/tasks"),
        },
      });
    },
    onError: (error) => toast.error(error.message),
  });
  const metadataMutation = useMutation({
    mutationFn: async (settings: ProjectGenerationSettings[]) => {
      const results = await Promise.allSettled(
        settings.map((item) =>
          saveProjectMetadata(item.projectId, {
            tocStart: item.tocStart,
            tocEnd: item.tocEnd,
            pageOffset: item.pageOffset,
            providerId: item.providerId,
          }),
        ),
      );
      const failed = results.filter((result) => result.status === "rejected").length;
      if (failed) throw new Error(`${failed} project${failed > 1 ? "s" : ""} failed to save`);
      return results
        .filter(
          (result): result is PromiseFulfilledResult<Project> => result.status === "fulfilled",
        )
        .map((result) => result.value);
    },
    onSuccess: async (updatedProjects) => {
      queryClient.setQueryData(projectKeys.all, (current: Project[] | undefined) =>
        current?.map(
          (project) =>
            updatedProjects.find((updatedProject) => updatedProject.id === project.id) ?? project,
        ),
      );
      await queryClient.invalidateQueries({ queryKey: projectKeys.all });
      toast.success(
        updatedProjects.length === 1
          ? "Generation settings saved"
          : `${updatedProjects.length} project settings saved`,
      );
    },
    onError: (error) => toast.error(error.message),
  });
  const deleteMutation = useMutation({
    mutationFn: async (projectIds: string[]) => {
      const results = await Promise.allSettled(
        projectIds.map((projectId) => deleteProject(projectId)),
      );
      return {
        deletedCount: results.filter((result) => result.status === "fulfilled").length,
        failedCount: results.filter((result) => result.status === "rejected").length,
      };
    },
    onSuccess: async ({ deletedCount, failedCount }) => {
      await queryClient.invalidateQueries({ queryKey: projectKeys.all });
      if (deletedCount)
        toast.success(`${deletedCount} project${deletedCount > 1 ? "s" : ""} deleted`);
      if (failedCount)
        toast.error(`${failedCount} project${failedCount > 1 ? "s" : ""} failed to delete`);
    },
    onError: (error) => toast.error(error.message),
  });

  function importFiles(files: File[]) {
    if (!files.length) return;
    const pdfFiles = files.filter(
      (file) => file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf",
    );
    const skippedCount = files.length - pdfFiles.length;
    if (!pdfFiles.length) {
      toast.error("Choose PDF files to create projects");
      return;
    }
    if (skippedCount)
      toast.error(`${skippedCount} non-PDF file${skippedCount > 1 ? "s" : ""} skipped`);
    createMutation.mutate(pdfFiles);
  }

  function importFromInput(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    importFiles(files);
  }

  function queueProjects(projectIds: string[]) {
    const verifiedProviders = (providersQuery.data ?? []).filter(
      (item) => item.verification_status === "verified",
    );
    if (!verifiedProviders.length) {
      toast.error("No verified VLM API available");
      return;
    }
    const selectedProjects = projectIds
      .map((projectId) => projects.find((project) => project.id === projectId))
      .filter((project): project is Project => Boolean(project));
    if (!selectedProjects.length) return;
    if (
      selectedProjects.some(
        (project) => !verifiedProviders.some((provider) => provider.id === project.provider_id),
      )
    ) {
      toast.error("Configure a VLM API for each selected project");
      return;
    }
    batchQueueMutation.mutate(
      selectedProjects.map((project) => ({
        projectId: project.id,
        tocStart: project.toc_start,
        tocEnd: project.toc_end,
        pageOffset: project.page_offset,
        providerId: project.provider_id ?? "",
      })),
    );
  }

  function downloadProjects(projectIds: string[]) {
    projectIds
      .map((projectId) => projects.find((project) => project.id === projectId))
      .filter((project): project is Project => Boolean(project))
      .forEach((project) => {
        const link = document.createElement("a");
        link.href = `/api/projects/${encodeURIComponent(project.id)}/pdf`;
        link.download = makeBookmarkedFilename(project);
        document.body.append(link);
        link.click();
        link.remove();
      });
  }

  const projects = projectsQuery.data ?? [];
  const hasVerifiedProvider = Boolean(
    (providersQuery.data ?? []).some((provider) => provider.verification_status === "verified"),
  );
  const verifiedProviders = (providersQuery.data ?? []).filter(
    (provider) => provider.verification_status === "verified",
  );
  return (
    <>
      <HomeView
        projects={projects}
        providers={verifiedProviders}
        canQueueProjects={hasVerifiedProvider}
        onCreateProjects={importFiles}
        onCreateProjectInput={importFromInput}
        onOpenProject={(projectId) => navigate(`/projects/${encodeURIComponent(projectId)}`)}
        onQueueProjects={queueProjects}
        onDownloadProjects={downloadProjects}
        onSaveProjectGenerationSettings={(settings) => metadataMutation.mutate(settings)}
        onDeleteProjects={(projectIds) =>
          setPendingDelete(
            projectIds
              .map((projectId) => projects.find((project) => project.id === projectId))
              .filter((project): project is Project => Boolean(project)),
          )
        }
        onOpenTasks={() => navigate("/tasks")}
        onOpenSettings={() => navigate("/settings", { state: { from: "/" } })}
      />
      {pendingDelete.length ? (
        <ConfirmDialog
          title={pendingDelete.length > 1 ? "Delete projects" : "Delete project"}
          message={
            pendingDelete.length > 1
              ? `Delete ${pendingDelete.length} projects and their local PDF/JSON files?`
              : `Delete "${pendingDelete[0].name}" and its local PDF/JSON files?`
          }
          confirmLabel="Delete"
          tone="danger"
          onCancel={() => setPendingDelete([])}
          onConfirm={() => {
            deleteMutation.mutate(pendingDelete.map((project) => project.id));
            setPendingDelete([]);
          }}
        />
      ) : null}
    </>
  );
}
