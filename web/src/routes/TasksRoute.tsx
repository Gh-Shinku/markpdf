import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { TasksView } from "../components/TasksView";
import { listGenerationJobs, listProjects, projectKeys } from "../features/projects/api";

export function TasksRoute() {
  const navigate = useNavigate();
  const jobsQuery = useQuery({
    queryKey: projectKeys.allGenerationJobs,
    queryFn: () => listGenerationJobs(),
    refetchInterval: (query) => query.state.data?.some((job) => job.status === "queued" || job.status === "running") ? 1500 : false
  });
  const projectsQuery = useQuery({ queryKey: projectKeys.all, queryFn: listProjects });

  return (
    <TasksView
      jobs={jobsQuery.data ?? []}
      projects={projectsQuery.data ?? []}
      isLoading={jobsQuery.isLoading}
      error={jobsQuery.error?.message}
      onOpenHome={() => navigate("/")}
      onOpenTasks={() => undefined}
      onOpenSettings={() => navigate("/settings", { state: { from: "/tasks" } })}
      onOpenProject={(projectId) => navigate(`/projects/${encodeURIComponent(projectId)}`)}
    />
  );
}
