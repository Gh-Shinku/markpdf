import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HomeView } from "./HomeView";
import type { Project } from "../types";

const project: Project = {
  id: "project-1",
  name: "Book",
  pdf_filename: "book.pdf",
  toc_filename: "toc.json",
  page_offset: 0,
  toc_start: 1,
  toc_end: 10,
  inject_toc_page: true,
  provider_id: "provider-1",
  page_count: 10,
  created_at: "2026-08-05T00:00:00Z",
  updated_at: "2026-08-05T00:00:00Z",
  toc_updated_at: "2026-08-05T00:00:00Z",
  generated_at: null,
  last_validation: null,
};

describe("HomeView", () => {
  it("selects projects and runs batch actions", () => {
    const onQueueProjects = vi.fn();
    render(
      <HomeView
        projects={[project]}
        providers={[
          {
            id: "provider-1",
            name: "Test API",
            base_url: "https://example.test/v1",
            model: "model-a",
            sampling: { temperature: 0 },
            thinking_mode: "auto",
            extra_body: null,
            has_api_key: true,
            api_key_hint: "configured",
            verification_status: "verified",
            verification_message: "Vision test passed",
            verified_at: "2026-08-05T00:00:00Z",
          },
        ]}
        canQueueProjects={true}
        onCreateProjects={vi.fn()}
        onCreateProjectInput={vi.fn()}
        onOpenProject={vi.fn()}
        onQueueProjects={onQueueProjects}
        onDownloadProjects={vi.fn()}
        onDeleteProjects={vi.fn()}
        onSaveProjectGenerationSettings={vi.fn()}
        onOpenTasks={vi.fn()}
        onOpenPlayground={vi.fn()}
        onOpenDocs={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText("Select Book"));
    expect(screen.getByText("1 selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add to queue" }));
    expect(onQueueProjects).toHaveBeenCalledWith([project.id]);
  });
});
