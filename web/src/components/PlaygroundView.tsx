import { useMemo } from "react";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePartPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  unstable_useComposerInput,
  useAuiState,
  useLocalRuntime,
  type ChatModelAdapter,
  type ThreadMessage,
} from "@assistant-ui/react";
import { ImagePlus, RotateCcw, Save, SendHorizontal, X } from "lucide-react";
import { AppNavigation } from "./AppNavigation";
import type { Project, VlmProvider } from "../types";
import type { PlaygroundAttachment, PlaygroundChatMessage } from "../features/playground/api";

type PlaygroundViewProps = {
  projects: Project[];
  providers: VlmProvider[];
  prompt: string;
  selectedProjectId: string;
  selectedProviderId: string;
  pageNumber: string;
  pendingAttachments: PlaygroundAttachment[];
  sentAttachmentsByMessageId: Record<string, PlaygroundAttachment[]>;
  isRenderingPage: boolean;
  isSavingPrompt: boolean;
  onPromptChange: (value: string) => void;
  onSelectedProjectChange: (value: string) => void;
  onSelectedProviderChange: (value: string) => void;
  onPageNumberChange: (value: string) => void;
  onInsertRenderedPage: () => void;
  onRemovePendingAttachment: (attachmentId: string) => void;
  onSavePrompt: () => void;
  onRestoreDefaultPrompt: () => void;
  onNewChat: () => void;
  onTakePendingAttachments: (messageId: string) => PlaygroundAttachment[];
  onOpenHome: () => void;
  onOpenTasks: () => void;
  onOpenDocs: () => void;
  onOpenSettings: () => void;
  onSendChat: (messages: PlaygroundChatMessage[]) => Promise<string>;
};

export function PlaygroundView({
  projects,
  providers,
  prompt,
  selectedProjectId,
  selectedProviderId,
  pageNumber,
  pendingAttachments,
  sentAttachmentsByMessageId,
  isRenderingPage,
  isSavingPrompt,
  onPromptChange,
  onSelectedProjectChange,
  onSelectedProviderChange,
  onPageNumberChange,
  onInsertRenderedPage,
  onRemovePendingAttachment,
  onSavePrompt,
  onRestoreDefaultPrompt,
  onNewChat,
  onTakePendingAttachments,
  onOpenHome,
  onOpenTasks,
  onOpenDocs,
  onOpenSettings,
  onSendChat,
}: PlaygroundViewProps) {
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? null;
  const chatAdapter = useMemo<ChatModelAdapter>(
    () => ({
      async run({ messages }) {
        const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");
        const takenAttachments = lastUserMessage
          ? onTakePendingAttachments(lastUserMessage.id)
          : [];
        const nextAttachmentsByMessageId =
          lastUserMessage && takenAttachments.length
            ? { ...sentAttachmentsByMessageId, [lastUserMessage.id]: takenAttachments }
            : sentAttachmentsByMessageId;
        const response = await onSendChat(
          toPlaygroundMessages(messages, nextAttachmentsByMessageId),
        );
        return { content: [{ type: "text", text: response }] };
      },
    }),
    [onSendChat, onTakePendingAttachments, sentAttachmentsByMessageId],
  );
  const runtime = useLocalRuntime(chatAdapter);

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
        <div className="header-actions">
          <button className="secondary-action" type="button" onClick={onNewChat}>
            <RotateCcw size={16} aria-hidden="true" />
            New chat
          </button>
        </div>
      </header>
      <section className="playground-layout">
        <aside className="playground-controls" aria-label="Playground controls">
          <section className="playground-card" aria-labelledby="playground-prompt-heading">
            <div className="playground-card-header">
              <div>
                <p className="section-kicker">Prompt</p>
                <h2 id="playground-prompt-heading">Page extraction prompt</h2>
              </div>
              <button className="secondary-action" type="button" onClick={onRestoreDefaultPrompt}>
                Restore default
              </button>
            </div>
            <textarea
              className="prompt-textarea playground-prompt"
              aria-label="Playground prompt"
              spellCheck={false}
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
            />
            <button
              className="primary-action"
              type="button"
              disabled={isSavingPrompt}
              onClick={onSavePrompt}
            >
              <Save size={16} aria-hidden="true" />
              Save as global prompt
            </button>
          </section>

          <section className="playground-card" aria-labelledby="playground-context-heading">
            <div className="playground-card-header">
              <div>
                <p className="section-kicker">Context</p>
                <h2 id="playground-context-heading">Insert PDF page image</h2>
              </div>
            </div>
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
            {!selectedProvider ? (
              <p className="warning-text">No verified VLM API selected.</p>
            ) : null}
          </section>
        </aside>

        <section className="playground-chat-panel" aria-label="Prompt playground chat">
          <AssistantRuntimeProvider runtime={runtime}>
            <ThreadPrimitive.Root className="playground-thread">
              <ThreadPrimitive.Viewport className="playground-thread-viewport">
                <ThreadPrimitive.Empty>
                  <div className="playground-empty">
                    Insert a PDF page image, write a prompt, and send it to the selected VLM API.
                  </div>
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
                <PlaygroundComposer prompt={prompt} disabled={!selectedProviderId} />
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
  const handleInjectPrompt = () => {
    if (!trimmedPrompt) return;
    const currentText = composer.value.trimEnd();
    composer.setText(currentText ? `${currentText}\n\n${trimmedPrompt}` : trimmedPrompt);
  };

  return (
    <>
      <div className="playground-composer-tools">
        <button
          className="secondary-action"
          type="button"
          disabled={disabled || !trimmedPrompt}
          onClick={handleInjectPrompt}
        >
          Inject prompt into chat
        </button>
      </div>
      <div className="playground-composer-row">
        <ComposerPrimitive.Input
          className="playground-composer-input"
          placeholder="Type or inject a prompt. Ctrl/Cmd+Enter sends."
          submitMode="ctrlEnter"
          disabled={disabled}
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
    </>
  );
}

function PlaygroundMessage({
  attachmentsByMessageId,
}: {
  attachmentsByMessageId: Record<string, PlaygroundAttachment[]>;
}) {
  const id = useAuiState((state) => state.message.id);
  const role = useAuiState((state) => state.message.role);
  const attachments = role === "user" ? (attachmentsByMessageId[id] ?? []) : [];
  return (
    <MessagePrimitive.Root className={`playground-message ${role}`}>
      <div className="playground-message-role">{role}</div>
      {attachments.length ? (
        <div className="playground-message-attachments">
          {attachments.map((attachment) => (
            <AttachmentPreview key={attachment.id} attachment={attachment} />
          ))}
        </div>
      ) : null}
      <MessagePrimitive.Parts components={{ Text: RawTextPart }} />
    </MessagePrimitive.Root>
  );
}

function RawTextPart() {
  return <MessagePartPrimitive.Text smooth={false} component="span" className="playground-raw" />;
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: PlaygroundAttachment;
  onRemove: () => void;
}) {
  return (
    <div className="playground-attachment-chip">
      <img src={attachment.dataUrl} alt="" />
      <span>{attachment.name}</span>
      <button type="button" aria-label={`Remove ${attachment.name}`} onClick={onRemove}>
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  );
}

function AttachmentPreview({ attachment }: { attachment: PlaygroundAttachment }) {
  return (
    <figure className="playground-attachment-preview">
      <img src={attachment.dataUrl} alt={attachment.name} />
      <figcaption>{attachment.name}</figcaption>
    </figure>
  );
}

function toPlaygroundMessages(
  messages: readonly ThreadMessage[],
  attachmentsByMessageId: Record<string, PlaygroundAttachment[]>,
): PlaygroundChatMessage[] {
  return messages
    .filter(
      (message) =>
        message.role === "user" || message.role === "assistant" || message.role === "system",
    )
    .map((message) => ({
      role: message.role,
      content: message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n"),
      attachments: message.role === "user" ? (attachmentsByMessageId[message.id] ?? []) : [],
    }));
}
