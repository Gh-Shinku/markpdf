import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TasksView } from "./TasksView";
import type { GenerationJob, Project } from "../types";

const project: Project = {
  id: "project-1", name: "Book", pdf_filename: "book.pdf", toc_filename: "toc.json", page_offset: 0,
  page_count: 10, created_at: "2026-08-05T00:00:00Z", updated_at: "2026-08-05T00:00:00Z",
  toc_updated_at: "2026-08-05T00:00:00Z", generated_at: null, last_validation: null
};

function job(status: GenerationJob["status"]): GenerationJob {
  return {
    id: `${status}-job`, type: "generate_toc", project_id: project.id, status,
    message: `${status} message`, toc_start: 1, toc_end: 2,
    created_at: "2026-08-05T00:00:00Z", updated_at: "2026-08-05T00:01:00Z",
    started_at: null, finished_at: status === "succeeded" ? "2026-08-05T00:01:00Z" : null,
    error: status === "failed" ? "Request failed" : null, result: null, provider: null,
    progress: { phase: status === "succeeded" ? "completed" : status === "failed" ? "failed" : "queued", current_page: 1, completed_pages: 1, total_pages: 2, source: null, entries: null }
  };
}

describe("TasksView", () => {
  it("filters tasks and opens the matching workspace", () => {
    const onOpenProject = vi.fn();
    render(<TasksView jobs={[job("running"), job("succeeded")]} projects={[project]} providers={[]} isLoading={false} onOpenHome={vi.fn()} onOpenTasks={vi.fn()} onOpenSettings={vi.fn()} onOpenProject={onOpenProject} onStartBatch={vi.fn()} onApplyJob={vi.fn()} />);

    expect(screen.getByText("running message")).toBeTruthy();
    expect(screen.getByText("succeeded message")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Completed" }));
    expect(screen.queryByText("running message")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open Book" }));
    expect(onOpenProject).toHaveBeenCalledWith(project.id);
  });
});
