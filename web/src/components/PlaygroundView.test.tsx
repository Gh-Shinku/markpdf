import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PlaygroundView } from "./PlaygroundView";
import type { Project, VlmProvider } from "../types";

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverMock;
  HTMLElement.prototype.scrollTo = vi.fn();
});

afterEach(() => cleanup());

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

const provider: VlmProvider = {
  id: "provider-1",
  name: "Vision API",
  base_url: "https://example.test/v1",
  model: "model-a",
  has_api_key: true,
  api_key_hint: "configured",
  verification_status: "verified",
  verification_message: "Vision test passed",
  verified_at: "2026-08-05T00:00:00Z",
};

function renderPlayground(overrides: Partial<Parameters<typeof PlaygroundView>[0]> = {}) {
  const props: Parameters<typeof PlaygroundView>[0] = {
    projects: [project],
    providers: [provider],
    prompt: "Extract TOC entries",
    selectedProjectId: project.id,
    selectedProviderId: provider.id,
    pageNumber: "2",
    pendingAttachments: [],
    sentAttachmentsByMessageId: {},
    isRenderingPage: false,
    isSavingPrompt: false,
    onPromptChange: vi.fn(),
    onSelectedProjectChange: vi.fn(),
    onSelectedProviderChange: vi.fn(),
    onPageNumberChange: vi.fn(),
    onInsertRenderedPage: vi.fn(),
    onRemovePendingAttachment: vi.fn(),
    onSavePrompt: vi.fn(),
    onRestoreDefaultPrompt: vi.fn(),
    onNewChat: vi.fn(),
    onTakePendingAttachments: vi.fn(() => []),
    onOpenHome: vi.fn(),
    onOpenTasks: vi.fn(),
    onOpenDocs: vi.fn(),
    onOpenSettings: vi.fn(),
    onSendChat: vi.fn(async () => "ok"),
    ...overrides,
  };
  render(<PlaygroundView {...props} />);
  return props;
}

describe("PlaygroundView", () => {
  it("renders prompt, provider, project, and page controls", () => {
    renderPlayground();

    expect(screen.getByRole("heading", { name: "Prompt Playground" })).toBeTruthy();
    expect(screen.getByDisplayValue("Extract TOC entries")).toBeTruthy();
    expect(screen.getByDisplayValue("Vision API")).toBeTruthy();
    expect(screen.getByDisplayValue("Book")).toBeTruthy();
    expect(screen.getByDisplayValue("2")).toBeTruthy();
  });

  it("runs prompt and attachment actions", () => {
    const props = renderPlayground();

    fireEvent.click(screen.getByRole("button", { name: "Save as global prompt" }));
    fireEvent.click(screen.getByRole("button", { name: "Insert rendered page" }));

    expect(props.onSavePrompt).toHaveBeenCalledTimes(1);
    expect(props.onInsertRenderedPage).toHaveBeenCalledTimes(1);
  });

  it("injects the prompt into the visible chat input", () => {
    renderPlayground();

    fireEvent.click(screen.getByRole("button", { name: "Inject prompt into chat" }));

    const composerInput = screen.getByPlaceholderText(
      "Type or inject a prompt. Ctrl/Cmd+Enter sends.",
    ) as HTMLTextAreaElement;
    expect(composerInput.value).toBe("Extract TOC entries");
  });

  it("sends a visible chat message without crashing message rendering", async () => {
    const onSendChat = vi.fn(async () => "raw answer");
    renderPlayground({ onSendChat });

    fireEvent.change(
      screen.getByPlaceholderText("Type or inject a prompt. Ctrl/Cmd+Enter sends."),
      {
        target: { value: "Extract this page" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(onSendChat).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("raw answer")).toBeTruthy();
  });
});
