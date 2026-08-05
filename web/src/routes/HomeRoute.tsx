import { useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { HomeView } from "../components/HomeView";
import type { Project } from "../types";
import { createProject, deleteProject, listProjects, projectKeys } from "../features/projects/api";

export function HomeRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null);
  const projectsQuery = useQuery({ queryKey: projectKeys.all, queryFn: listProjects });
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
  const deleteMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: projectKeys.all });
      toast.success("Project deleted");
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

  const projects = projectsQuery.data ?? [];
  return (
    <>
      <HomeView
        projects={projects}
        onCreateProjects={importFiles}
        onCreateProjectInput={importFromInput}
        onOpenProject={(projectId) => navigate(`/projects/${encodeURIComponent(projectId)}`)}
        onDeleteProject={(projectId) =>
          setPendingDelete(projects.find((item) => item.id === projectId) ?? null)
        }
        onOpenTasks={() => navigate("/tasks")}
        onOpenSettings={() => navigate("/settings", { state: { from: "/" } })}
      />
      {pendingDelete ? (
        <ConfirmDialog
          title="Delete project"
          message={`Delete "${pendingDelete.name}" and its local PDF/JSON files?`}
          confirmLabel="Delete"
          tone="danger"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            deleteMutation.mutate(pendingDelete.id);
            setPendingDelete(null);
          }}
        />
      ) : null}
    </>
  );
}
