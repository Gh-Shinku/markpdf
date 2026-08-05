import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { TasksView } from "../components/TasksView";
import { getProviders, settingsKey } from "../features/settings/api";
import { applyGenerationJob, batchGenerateProjectTocs, listGenerationJobs, listProjects, projectKeys } from "../features/projects/api";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export function TasksRoute() {
  const navigate = useNavigate();
  const jobsQuery = useQuery({
    queryKey: projectKeys.allGenerationJobs,
    queryFn: () => listGenerationJobs(),
    refetchInterval: (query) => query.state.data?.some((job) => job.status === "queued" || job.status === "running") ? 1500 : false
  });
  const projectsQuery = useQuery({ queryKey: projectKeys.all, queryFn: listProjects });
  const providersQuery = useQuery({ queryKey: settingsKey, queryFn: getProviders });
  const queryClient = useQueryClient();
  const batchMutation = useMutation({ mutationFn: batchGenerateProjectTocs, onSuccess: (jobs) => { queryClient.setQueryData(projectKeys.allGenerationJobs, (current: typeof jobsQuery.data) => [...jobs, ...(current ?? [])]); toast.success(`${jobs.length} tasks queued`); }, onError: (error) => toast.error(error.message) });
  const applyMutation = useMutation({ mutationFn: applyGenerationJob, onSuccess: () => { toast.success("TOC applied to PDF"); void queryClient.invalidateQueries({ queryKey: projectKeys.all }); }, onError: (error) => toast.error(error.message) });

  return (
    <TasksView
      jobs={jobsQuery.data ?? []}
      projects={projectsQuery.data ?? []}
      providers={providersQuery.data ?? []}
      isLoading={jobsQuery.isLoading}
      error={jobsQuery.error?.message}
      onOpenHome={() => navigate("/")}
      onOpenTasks={() => undefined}
      onOpenSettings={() => navigate("/settings", { state: { from: "/tasks" } })}
      onOpenProject={(projectId) => navigate(`/projects/${encodeURIComponent(projectId)}`)}
      onStartBatch={(requests) => batchMutation.mutate(requests)}
      onApplyJob={(jobId) => applyMutation.mutate(jobId)}
    />
  );
}
