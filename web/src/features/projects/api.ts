import { parseError, requestJson } from "../../api";
import type { GenerationJob, Project } from "../../types";

export const projectKeys = {
  all: ["projects"] as const,
  detail: (projectId: string) => ["projects", projectId] as const,
  toc: (projectId: string) => ["projects", projectId, "toc"] as const,
  generationJobs: (projectId: string) => ["projects", projectId, "generation-jobs"] as const,
  allGenerationJobs: ["generation-jobs", "all"] as const,
  job: (jobId: string) => ["generation-jobs", jobId] as const
};

export async function listProjects(): Promise<Project[]> {
  const data = await requestJson<{ projects: Project[] }>("/api/projects");
  return data.projects;
}

export async function getProject(projectId: string): Promise<Project> {
  const data = await requestJson<{ project: Project }>(`/api/projects/${projectId}`);
  return data.project;
}

export async function getProjectToc(projectId: string): Promise<string> {
  const data = await requestJson<{ toc_json: string }>(`/api/projects/${projectId}/toc`);
  return data.toc_json;
}

export async function createProject(file: File): Promise<Project> {
  const formData = new FormData();
  formData.append("pdf", file);
  const response = await fetch("/api/projects", { method: "POST", body: formData });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  const data = (await response.json()) as { project: Project };
  return data.project;
}

export function deleteProject(projectId: string): Promise<{ status: string }> {
  return requestJson(`/api/projects/${projectId}`, { method: "DELETE" });
}

export async function saveProjectToc(projectId: string, tocJson: string): Promise<Project> {
  const data = await requestJson<{ project: Project }>(`/api/projects/${projectId}/toc`, {
    method: "PUT",
    body: JSON.stringify({ toc_json: tocJson })
  });
  return data.project;
}

export async function saveProjectOffset(projectId: string, pageOffset: number): Promise<Project> {
  const data = await requestJson<{ project: Project }>(`/api/projects/${projectId}/metadata`, {
    method: "PUT",
    body: JSON.stringify({ page_offset: pageOffset })
  });
  return data.project;
}

export async function applyProject(projectId: string, tocJson: string, pageOffset: number): Promise<void> {
  const response = await fetch(`/api/projects/${projectId}/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ toc_json: tocJson, page_offset: pageOffset })
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  await response.blob();
}

export async function generateProjectToc(projectId: string, tocStart: number, tocEnd: number): Promise<GenerationJob> {
  const data = await requestJson<{ job: GenerationJob }>(`/api/projects/${projectId}/generate-toc`, {
    method: "POST",
    body: JSON.stringify({ toc_start: tocStart, toc_end: tocEnd })
  });
  return data.job;
}

export async function listProjectGenerationJobs(projectId: string): Promise<GenerationJob[]> {
  const data = await requestJson<{ jobs: GenerationJob[] }>(`/api/projects/${projectId}/generation-jobs`);
  return data.jobs;
}

export async function listGenerationJobs(status?: GenerationJob["status"]): Promise<GenerationJob[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const data = await requestJson<{ jobs: GenerationJob[] }>(`/api/generation-jobs${query}`);
  return data.jobs;
}

export async function getGenerationJob(jobId: string): Promise<GenerationJob> {
  const data = await requestJson<{ job: GenerationJob }>(`/api/jobs/${jobId}`);
  return data.job;
}
