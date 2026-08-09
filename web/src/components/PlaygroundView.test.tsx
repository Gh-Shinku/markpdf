import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PlaygroundView } from "./PlaygroundView";
import type { Project, VlmProvider } from "../types";
import type { PlaygroundAttachment, PlaygroundChatMessage } from "../features/playground/api";

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
  sampling: { temperature: 0 },
  thinking_mode: "auto",
  extra_body: null,
  has_api_key: true,
  api_key_hint: "configured",
  verification_status: "verified",
  verification_message: "Vision test passed",
  verified_at: "2026-08-05T00:00:00Z",
};

const attachment: PlaygroundAttachment = {
  id: "attachment-1",
  type: "pdf_page",
  project_id: project.id,
  page: 1,
  dpi: 220,
  sha256: "hash",
  name: "Book · page 1",
  dataUrl:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
};

function renderPlayground(overrides: Partial<Parameters<typeof PlaygroundView>[0]> = {}) {
  const props: Parameters<typeof PlaygroundView>[0] = {
    projects: [project],
    providers: [provider],
    chatSessions: [
      {
        id: "chat-1",
        title: "Book prompt",
        created_at: "2026-08-05T00:00:00Z",
        updated_at: "2026-08-05T00:00:00Z",
      },
    ],
    activeChatId: "chat-1",
    initialMessages: [],
    prompt: "Extract TOC entries",
    selectedProjectId: project.id,
    selectedProviderId: provider.id,
    pageNumber: "2",
    pendingAttachments: [],
    sentAttachmentsByMessageId: {},
    isRenderingPage: false,
    isSavingPrompt: false,
    isCreatingChat: false,
    onPromptChange: vi.fn(),
    onSelectedProjectChange: vi.fn(),
    onSelectedProviderChange: vi.fn(),
    onPageNumberChange: vi.fn(),
    onInsertRenderedPage: vi.fn(),
    onRemovePendingAttachment: vi.fn(),
    onSavePrompt: vi.fn(),
    onRestoreDefaultPrompt: vi.fn(),
    onNewChat: vi.fn(),
    onSelectChat: vi.fn(),
    onDeleteChat: vi.fn(),
    onRenameChat: vi.fn(),
    onTakePendingAttachments: vi.fn(() => []),
    onOpenHome: vi.fn(),
    onOpenTasks: vi.fn(),
    onOpenDocs: vi.fn(),
    onOpenSettings: vi.fn(),
    onSendChat: vi.fn(async function* () {
      yield "ok";
    }),
    ...overrides,
  };
  render(<PlaygroundView key={props.activeChatId || "pending-chat"} {...props} />);
  return props;
}

describe("PlaygroundView", () => {
  it("renders chat sidebar actions and hides forms until a panel is opened", () => {
    renderPlayground();

    expect(screen.getByRole("heading", { name: "Prompt Playground" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New chat" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Prompt" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Context" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Book prompt" })).toBeTruthy();
    expect(screen.queryByDisplayValue("Extract TOC entries")).toBeNull();
  });

  it("opens prompt and context panels from the sidebar", () => {
    renderPlayground();

    fireEvent.click(screen.getByRole("button", { name: "Prompt" }));

    expect(screen.getByDisplayValue("Extract TOC entries")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Page extraction prompt" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close panel" }));
    expect(screen.queryByDisplayValue("Extract TOC entries")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Context" }));

    expect(screen.getByDisplayValue("Vision API")).toBeTruthy();
    expect(screen.getByDisplayValue("Book")).toBeTruthy();
    expect(screen.getByDisplayValue("2")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Insert PDF page image" })).toBeTruthy();
  });

  it("runs prompt and attachment actions", () => {
    const props = renderPlayground();

    fireEvent.click(screen.getByRole("button", { name: "Prompt" }));
    fireEvent.click(screen.getByRole("button", { name: "Save as global prompt" }));
    fireEvent.click(screen.getByRole("button", { name: "Context" }));
    fireEvent.click(screen.getByRole("button", { name: "Insert rendered page" }));
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Book prompt" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Book prompt" }));

    expect(props.onSavePrompt).toHaveBeenCalledTimes(1);
    expect(props.onInsertRenderedPage).toHaveBeenCalledTimes(1);
    expect(props.onNewChat).toHaveBeenCalledTimes(1);
    expect(props.onSelectChat).toHaveBeenCalledWith("chat-1");
    expect(props.onDeleteChat).toHaveBeenCalledWith("chat-1");
  });

  it("renames a chat item from the sidebar", () => {
    const props = renderPlayground();

    fireEvent.click(screen.getByRole("button", { name: "Rename Book prompt" }));
    fireEvent.change(screen.getByLabelText("Rename Book prompt"), {
      target: { value: "New title" },
    });
    fireEvent.keyDown(screen.getByLabelText("Rename Book prompt"), { key: "Enter" });

    expect(props.onRenameChat).toHaveBeenCalledWith("chat-1", "New title");
  });

  it("completes the inject shortcut into the visible chat input", () => {
    renderPlayground();

    const composerInput = screen.getByPlaceholderText(
      "Type /inject for prompt shortcut. Ctrl/Cmd+Enter sends.",
    ) as HTMLTextAreaElement;
    fireEvent.change(composerInput, { target: { value: "/inject" } });

    expect(screen.getByRole("option", { name: "/inject Prompt" })).toBeTruthy();
    fireEvent.keyDown(composerInput, { key: "Tab" });

    expect(composerInput.value).toBe("Extract TOC entries");
  });

  it("streams a visible chat message without crashing message rendering", async () => {
    const onSendChat = vi.fn(async function* (message: PlaygroundChatMessage) {
      void message;
      yield "raw ";
      yield "answer";
    });
    renderPlayground({ onSendChat });

    fireEvent.change(
      screen.getByPlaceholderText("Type /inject for prompt shortcut. Ctrl/Cmd+Enter sends."),
      {
        target: { value: "Extract this page" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(onSendChat).toHaveBeenCalledTimes(1));
    expect(onSendChat.mock.calls[0][0]).toMatchObject({
      role: "user",
      content: "Extract this page",
    });
    expect(await screen.findByText("raw answer")).toBeTruthy();
  });

  it("renders markdown and copies raw message text", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderPlayground({
      initialMessages: [
        {
          id: "message-1",
          role: "assistant",
          content: "## Result\n\n- item\n\n`code`",
          createdAt: new Date("2026-08-05T00:00:00Z"),
        },
      ],
    });

    expect(await screen.findByRole("heading", { name: "Result" })).toBeTruthy();
    expect(await screen.findByText("item")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Copy assistant message" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("## Result\n\n- item\n\n`code`"));
  });

  it("renders bare JSON responses as code blocks", async () => {
    const json = '{\n  "chapters": []\n}';
    renderPlayground({
      initialMessages: [
        {
          id: "message-1",
          role: "assistant",
          content: json,
          createdAt: new Date("2026-08-05T00:00:00Z"),
        },
      ],
    });

    await waitFor(() => {
      expect(document.querySelector(".playground-markdown pre code")?.textContent).toBe(json);
    });
  });

  it("opens a pending attachment image preview before sending", () => {
    renderPlayground({ pendingAttachments: [attachment] });

    fireEvent.click(screen.getByRole("button", { name: "Preview Book · page 1" }));

    expect(screen.getByRole("dialog", { name: "Book · page 1" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close image preview" }));
    expect(screen.queryByRole("dialog", { name: "Book · page 1" })).toBeNull();
  });

  it("opens a clicked message image preview", async () => {
    renderPlayground({
      initialMessages: [
        {
          id: "message-1",
          role: "user",
          content: "Use this page.",
          createdAt: new Date("2026-08-05T00:00:00Z"),
        },
      ],
      sentAttachmentsByMessageId: { "message-1": [attachment] },
    });

    fireEvent.click(await screen.findByRole("button", { name: /Book · page 1/ }));

    expect(screen.getByRole("dialog", { name: "Book · page 1" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close image preview" }));
    expect(screen.queryByRole("dialog", { name: "Book · page 1" })).toBeNull();
  });
});
