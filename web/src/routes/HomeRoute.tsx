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
    mutationFn: createProject,
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: projectKeys.all });
      toast.success("Project created");
      navigate(`/projects/${encodeURIComponent(project.id)}`);
    },
    onError: (error) => toast.error(error.message)
  });
  const deleteMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: projectKeys.all });
      toast.success("Project deleted");
    },
    onError: (error) => toast.error(error.message)
  });

  function importFile(file: File | null) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      toast.error("Choose a PDF file to create a project");
      return;
    }
    createMutation.mutate(file);
  }

  function importFromInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    importFile(file);
  }

  const projects = projectsQuery.data ?? [];
  return (
    <>
      <HomeView
        projects={projects}
        onCreateProject={async (file) => importFile(file)}
        onCreateProjectInput={importFromInput}
        onOpenProject={(projectId) => navigate(`/projects/${encodeURIComponent(projectId)}`)}
        onDeleteProject={(projectId) => setPendingDelete(projects.find((item) => item.id === projectId) ?? null)}
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
