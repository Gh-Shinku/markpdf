import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  unstable_useComposerInput,
  useAuiState,
  useLocalRuntime,
  type ChatModelAdapter,
  type ThreadMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { Copy, ImagePlus, Pencil, Plus, Save, SendHorizontal, Trash2, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { AppNavigation } from "./AppNavigation";
import type { Project, VlmProvider } from "../types";
import type {
  PlaygroundAttachment,
  PlaygroundChatMessage,
  PlaygroundChatSessionSummary,
} from "../features/playground/api";

type ActivePlaygroundPanel = "prompt" | "context" | null;
const PLAYGROUND_MARKDOWN_PLUGINS = [remarkGfm];

type PlaygroundViewProps = {
  projects: Project[];
  providers: VlmProvider[];
  chatSessions: PlaygroundChatSessionSummary[];
  activeChatId: string;
  initialMessages: ThreadMessageLike[];
  prompt: string;
  selectedProjectId: string;
  selectedProviderId: string;
  pageNumber: string;
  pendingAttachments: PlaygroundAttachment[];
  sentAttachmentsByMessageId: Record<string, PlaygroundAttachment[]>;
  isRenderingPage: boolean;
  isSavingPrompt: boolean;
  isCreatingChat: boolean;
  onPromptChange: (value: string) => void;
  onSelectedProjectChange: (value: string) => void;
  onSelectedProviderChange: (value: string) => void;
  onPageNumberChange: (value: string) => void;
  onInsertRenderedPage: () => void;
  onRemovePendingAttachment: (attachmentId: string) => void;
  onSavePrompt: () => void;
  onRestoreDefaultPrompt: () => void;
  onNewChat: () => void;
  onSelectChat: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
  onRenameChat: (chatId: string, title: string) => void;
  onTakePendingAttachments: (messageId: string) => PlaygroundAttachment[];
  onOpenHome: () => void;
  onOpenTasks: () => void;
  onOpenDocs: () => void;
  onOpenSettings: () => void;
  onSendChat: (
    message: PlaygroundChatMessage,
    abortSignal: AbortSignal,
  ) => AsyncGenerator<string, void>;
};

export function PlaygroundView({
  projects,
  providers,
  chatSessions,
  activeChatId,
  initialMessages,
  prompt,
  selectedProjectId,
  selectedProviderId,
  pageNumber,
  pendingAttachments,
  sentAttachmentsByMessageId,
  isRenderingPage,
  isSavingPrompt,
  isCreatingChat,
  onPromptChange,
  onSelectedProjectChange,
  onSelectedProviderChange,
  onPageNumberChange,
  onInsertRenderedPage,
  onRemovePendingAttachment,
  onSavePrompt,
  onRestoreDefaultPrompt,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  onRenameChat,
  onTakePendingAttachments,
  onOpenHome,
  onOpenTasks,
  onOpenDocs,
  onOpenSettings,
  onSendChat,
}: PlaygroundViewProps) {
  const [activePanel, setActivePanel] = useState<ActivePlaygroundPanel>(null);
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? null;
  const chatAdapter = useMemo<ChatModelAdapter>(
    () => ({
      async *run({ messages, abortSignal }) {
        const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");
        const takenAttachments = lastUserMessage
          ? onTakePendingAttachments(lastUserMessage.id)
          : [];
        const nextAttachmentsByMessageId =
          lastUserMessage && takenAttachments.length
            ? { ...sentAttachmentsByMessageId, [lastUserMessage.id]: takenAttachments }
            : sentAttachmentsByMessageId;
        const userMessage = toLastPlaygroundUserMessage(messages, nextAttachmentsByMessageId);
        if (!userMessage) throw new Error("Type a message before sending");
        let assistantText = "";
        for await (const text of onSendChat(userMessage, abortSignal)) {
          assistantText += text;
          yield { content: [{ type: "text", text: assistantText }] };
        }
      },
    }),
    [onSendChat, onTakePendingAttachments, sentAttachmentsByMessageId],
  );
  const runtime = useLocalRuntime(chatAdapter, { initialMessages });
  const closePanel = () => setActivePanel(null);

  useEffect(() => {
    runtime.thread.reset(initialMessages);
  }, [activeChatId, initialMessages, runtime]);

  useEffect(() => {
    if (!activePanel) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePanel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activePanel]);

  return (
    <main className="app-shell playground-shell">
      <AppNavigation
        active="playground"
        onHome={onOpenHome}
        onTasks={onOpenTasks}
        onPlayground={() => undefined}
        onDocs={onOpenDocs}
        onSettings={onOpenSettings}
      />
      <header className="app-header">
        <div>
          <p className="eyebrow">Prompt lab</p>
          <h1>Prompt Playground</h1>
        </div>
      </header>
      <section className="playground-layout">
        <aside className="playground-controls" aria-label="Playground controls">
          <div className="playground-sidebar-actions">
            <button
              className="primary-action playground-new-chat-button"
              type="button"
              disabled={isCreatingChat}
              onClick={onNewChat}
            >
              <Plus size={16} aria-hidden="true" />
              New chat
            </button>
            <div className="playground-panel-actions" aria-label="Playground panels">
              <button
                className={`playground-panel-button ${activePanel === "prompt" ? "active" : ""}`}
                type="button"
                aria-expanded={activePanel === "prompt"}
                onClick={() => setActivePanel((panel) => (panel === "prompt" ? null : "prompt"))}
              >
                Prompt
              </button>
              <button
                className={`playground-panel-button ${activePanel === "context" ? "active" : ""}`}
                type="button"
                aria-expanded={activePanel === "context"}
                onClick={() => setActivePanel((panel) => (panel === "context" ? null : "context"))}
              >
                Context
              </button>
            </div>
          </div>

          <section
            className="playground-chat-history"
            aria-labelledby="playground-sessions-heading"
          >
            <h2 id="playground-sessions-heading">Chats</h2>
            <div className="playground-chat-list">
              {chatSessions.map((chat) => (
                <PlaygroundChatListItem
                  key={chat.id}
                  chat={chat}
                  isActive={chat.id === activeChatId}
                  onSelectChat={onSelectChat}
                  onDeleteChat={onDeleteChat}
                  onRenameChat={onRenameChat}
                />
              ))}
            </div>
          </section>
        </aside>

        {activePanel ? (
          <div className="playground-drawer-backdrop" role="presentation" onClick={closePanel}>
            <aside
              className="playground-drawer"
              role="dialog"
              aria-modal="true"
              aria-labelledby="playground-drawer-heading"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="playground-drawer-header">
                <div>
                  <p className="section-kicker">{activePanel}</p>
                  <h2 id="playground-drawer-heading">
                    {activePanel === "prompt" ? "Page extraction prompt" : "Insert PDF page image"}
                  </h2>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Close panel"
                  onClick={closePanel}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
              {activePanel === "prompt" ? (
                <PromptPanel
                  prompt={prompt}
                  isSavingPrompt={isSavingPrompt}
                  onPromptChange={onPromptChange}
                  onRestoreDefaultPrompt={onRestoreDefaultPrompt}
                  onSavePrompt={onSavePrompt}
                />
              ) : (
                <ContextPanel
                  projects={projects}
                  providers={providers}
                  selectedProject={selectedProject}
                  selectedProvider={selectedProvider}
                  selectedProjectId={selectedProjectId}
                  selectedProviderId={selectedProviderId}
                  pageNumber={pageNumber}
                  isRenderingPage={isRenderingPage}
                  onSelectedProjectChange={onSelectedProjectChange}
                  onSelectedProviderChange={onSelectedProviderChange}
                  onPageNumberChange={onPageNumberChange}
                  onInsertRenderedPage={onInsertRenderedPage}
                />
              )}
            </aside>
          </div>
        ) : null}

        <section className="playground-chat-panel" aria-label="Prompt playground chat">
          <AssistantRuntimeProvider runtime={runtime}>
            <ThreadPrimitive.Root className="playground-thread">
              <ThreadPrimitive.Viewport className="playground-thread-viewport">
                <ThreadPrimitive.Empty>
                  <div className="playground-empty" aria-hidden="true" />
                </ThreadPrimitive.Empty>
                <ThreadPrimitive.Messages
                  components={{
                    Message: () => (
                      <PlaygroundMessage attachmentsByMessageId={sentAttachmentsByMessageId} />
                    ),
                  }}
                />
              </ThreadPrimitive.Viewport>
              <ComposerPrimitive.Root className="playground-composer">
                {pendingAttachments.length ? (
                  <div className="playground-attachments" aria-label="Pending PDF page images">
                    {pendingAttachments.map((attachment) => (
                      <AttachmentChip
                        key={attachment.id}
                        attachment={attachment}
                        onRemove={() => onRemovePendingAttachment(attachment.id)}
                      />
                    ))}
                  </div>
                ) : null}
                <PlaygroundComposer
                  prompt={prompt}
                  disabled={!selectedProviderId || !activeChatId}
                />
              </ComposerPrimitive.Root>
            </ThreadPrimitive.Root>
          </AssistantRuntimeProvider>
        </section>
      </section>
    </main>
  );
}

function PlaygroundComposer({ prompt, disabled }: { prompt: string; disabled: boolean }) {
  const composer = unstable_useComposerInput({ disabled });
  const trimmedPrompt = prompt.trim();
  const completionQuery = composer.value.trim();
  const showInjectCompletion =
    !disabled &&
    Boolean(trimmedPrompt) &&
    completionQuery.startsWith("/") &&
    "/inject".startsWith(completionQuery);
  const completeInjectPrompt = () => {
    if (!trimmedPrompt) return;
    composer.setText(trimmedPrompt);
  };
  const handleComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (!showInjectCompletion) return;
    if (event.key !== "Tab" && event.key !== "Enter") return;
    event.preventDefault();
    completeInjectPrompt();
  };

  return (
    <div className="playground-composer-stack">
      {showInjectCompletion ? (
        <div className="playground-command-completion" role="listbox" aria-label="Prompt shortcuts">
          <div
            className="playground-command-option"
            role="option"
            aria-label="/inject Prompt"
            aria-selected="true"
          >
            <span>/inject</span>
            <span>Prompt</span>
          </div>
        </div>
      ) : null}
      <div className="playground-composer-row">
        <ComposerPrimitive.Input
          className="playground-composer-input"
          placeholder="Type /inject for prompt shortcut. Ctrl/Cmd+Enter sends."
          submitMode="ctrlEnter"
          disabled={disabled}
          onKeyDown={handleComposerKeyDown}
        />
        <ComposerPrimitive.Send
          className="primary-action icon-only"
          title="Send message"
          aria-label="Send message"
          disabled={disabled}
        >
          <SendHorizontal size={16} aria-hidden="true" />
        </ComposerPrimitive.Send>
      </div>
    </div>
  );
}

function PlaygroundChatListItem({
  chat,
  isActive,
  onSelectChat,
  onDeleteChat,
  onRenameChat,
}: {
  chat: PlaygroundChatSessionSummary;
  isActive: boolean;
  onSelectChat: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
  onRenameChat: (chatId: string, title: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(chat.title);
  const renameFinishedRef = useRef(false);

  useEffect(() => {
    if (!isEditing) setTitleDraft(chat.title);
  }, [chat.title, isEditing]);

  const startEditing = () => {
    renameFinishedRef.current = false;
    setTitleDraft(chat.title);
    setIsEditing(true);
  };
  const commitRename = () => {
    if (renameFinishedRef.current) return;
    renameFinishedRef.current = true;
    const nextTitle = titleDraft.trim();
    setIsEditing(false);
    if (!nextTitle || nextTitle === chat.title) {
      setTitleDraft(chat.title);
      return;
    }
    onRenameChat(chat.id, nextTitle);
  };
  const cancelRename = () => {
    if (renameFinishedRef.current) return;
    renameFinishedRef.current = true;
    setTitleDraft(chat.title);
    setIsEditing(false);
  };

  return (
    <div className={`playground-chat-list-item ${isActive ? "active" : ""}`}>
      {isEditing ? (
        <input
          className="playground-chat-title-input"
          aria-label={`Rename ${chat.title}`}
          autoFocus
          value={titleDraft}
          onChange={(event) => setTitleDraft(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitRename();
            if (event.key === "Escape") cancelRename();
          }}
        />
      ) : (
        <button type="button" onClick={() => onSelectChat(chat.id)} onDoubleClick={startEditing}>
          {chat.title}
        </button>
      )}
      {isEditing ? null : (
        <button
          className="icon-button"
          type="button"
          aria-label={`Rename ${chat.title}`}
          onClick={startEditing}
        >
          <Pencil size={14} aria-hidden="true" />
        </button>
      )}
      <button
        className="icon-button"
        type="button"
        aria-label={`Delete ${chat.title}`}
        onClick={() => onDeleteChat(chat.id)}
      >
        <Trash2 size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

function PromptPanel({
  prompt,
  isSavingPrompt,
  onPromptChange,
  onRestoreDefaultPrompt,
  onSavePrompt,
}: {
  prompt: string;
  isSavingPrompt: boolean;
  onPromptChange: (value: string) => void;
  onRestoreDefaultPrompt: () => void;
  onSavePrompt: () => void;
}) {
  return (
    <div className="playground-drawer-body">
      <textarea
        className="prompt-textarea playground-prompt"
        aria-label="Playground prompt"
        spellCheck={false}
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
      />
      <div className="playground-drawer-actions">
        <button className="secondary-action" type="button" onClick={onRestoreDefaultPrompt}>
          Restore default
        </button>
        <button
          className="primary-action"
          type="button"
          disabled={isSavingPrompt}
          onClick={onSavePrompt}
        >
          <Save size={16} aria-hidden="true" />
          Save as global prompt
        </button>
      </div>
    </div>
  );
}

function ContextPanel({
  projects,
  providers,
  selectedProject,
  selectedProvider,
  selectedProjectId,
  selectedProviderId,
  pageNumber,
  isRenderingPage,
  onSelectedProjectChange,
  onSelectedProviderChange,
  onPageNumberChange,
  onInsertRenderedPage,
}: {
  projects: Project[];
  providers: VlmProvider[];
  selectedProject: Project | null;
  selectedProvider: VlmProvider | null;
  selectedProjectId: string;
  selectedProviderId: string;
  pageNumber: string;
  isRenderingPage: boolean;
  onSelectedProjectChange: (value: string) => void;
  onSelectedProviderChange: (value: string) => void;
  onPageNumberChange: (value: string) => void;
  onInsertRenderedPage: () => void;
}) {
  return (
    <div className="playground-drawer-body">
      <label className="playground-field">
        <span>VLM API</span>
        <select
          value={selectedProviderId}
          onChange={(event) => onSelectedProviderChange(event.target.value)}
        >
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </select>
      </label>
      <label className="playground-field">
        <span>Project PDF</span>
        <select
          value={selectedProjectId}
          onChange={(event) => onSelectedProjectChange(event.target.value)}
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      <label className="playground-field">
        <span>PDF page</span>
        <input
          type="number"
          min={1}
          max={selectedProject?.page_count ?? undefined}
          value={pageNumber}
          onChange={(event) => onPageNumberChange(event.target.value)}
        />
      </label>
      <button
        className="secondary-action"
        type="button"
        disabled={!selectedProject || isRenderingPage}
        onClick={onInsertRenderedPage}
      >
        <ImagePlus size={16} aria-hidden="true" />
        Insert rendered page
      </button>
      {!selectedProvider ? <p className="warning-text">No verified VLM API selected.</p> : null}
    </div>
  );
}

function PlaygroundMessage({
  attachmentsByMessageId,
}: {
  attachmentsByMessageId: Record<string, PlaygroundAttachment[]>;
}) {
  const id = useAuiState((state) => state.message.id);
  const role = useAuiState((state) => state.message.role);
  const rawText = useAuiState((state) =>
    state.message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join(""),
  );
  const attachments = role === "user" ? (attachmentsByMessageId[id] ?? []) : [];
  const handleCopyMessage = async () => {
    await navigator.clipboard.writeText(rawText);
    toast.success("Message copied");
  };

  return (
    <MessagePrimitive.Root className={`playground-message ${role}`}>
      <div className="playground-message-header">
        <div className="playground-message-role">{role}</div>
        <button
          className="playground-message-copy"
          type="button"
          disabled={!rawText}
          aria-label={`Copy ${role} message`}
          onClick={handleCopyMessage}
        >
          <Copy size={13} aria-hidden="true" />
          Copy
        </button>
      </div>
      {attachments.length ? (
        <div className="playground-message-attachments">
          {attachments.map((attachment) => (
            <AttachmentPreview key={attachment.id} attachment={attachment} />
          ))}
        </div>
      ) : null}
      {rawText ? <PlaygroundMarkdown text={rawText} /> : null}
    </MessagePrimitive.Root>
  );
}

function PlaygroundMarkdown({ text }: { text: string }) {
  return (
    <div className="playground-markdown">
      <ReactMarkdown
        remarkPlugins={PLAYGROUND_MARKDOWN_PLUGINS}
        components={{
          a: ({ children, href }: { children?: ReactNode; href?: string }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: PlaygroundAttachment;
  onRemove: () => void;
}) {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  return (
    <>
      <div className="playground-attachment-chip">
        <button
          className="playground-attachment-chip-preview"
          type="button"
          aria-label={`Preview ${attachment.name}`}
          onClick={() => setIsPreviewOpen(true)}
        >
          <img src={attachment.dataUrl} alt="" />
          <span>{attachment.name}</span>
        </button>
        <button type="button" aria-label={`Remove ${attachment.name}`} onClick={onRemove}>
          <X size={13} aria-hidden="true" />
        </button>
      </div>
      {isPreviewOpen ? (
        <AttachmentPreviewModal attachment={attachment} onClose={() => setIsPreviewOpen(false)} />
      ) : null}
    </>
  );
}

function AttachmentPreview({ attachment }: { attachment: PlaygroundAttachment }) {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  return (
    <>
      <button
        className="playground-attachment-preview"
        type="button"
        onClick={() => setIsPreviewOpen(true)}
      >
        <img src={attachment.dataUrl} alt={attachment.name} />
        <span>{attachment.name}</span>
      </button>
      {isPreviewOpen ? (
        <AttachmentPreviewModal attachment={attachment} onClose={() => setIsPreviewOpen(false)} />
      ) : null}
    </>
  );
}

function AttachmentPreviewModal({
  attachment,
  onClose,
}: {
  attachment: PlaygroundAttachment;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="playground-image-preview-modal"
        role="dialog"
        aria-modal="true"
        aria-label={attachment.name}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="icon-button"
          type="button"
          aria-label="Close image preview"
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
        <img src={attachment.dataUrl} alt={attachment.name} />
      </div>
    </div>
  );
}

function toLastPlaygroundUserMessage(
  messages: readonly ThreadMessage[],
  attachmentsByMessageId: Record<string, PlaygroundAttachment[]>,
): PlaygroundChatMessage | null {
  const message = [...messages].reverse().find((item) => item.role === "user");
  if (!message) return null;
  return {
    id: message.id,
    role: "user",
    content: message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n"),
    attachments: attachmentsByMessageId[message.id] ?? [],
  };
}
