import { parseError, requestJson } from "../../api";
import type { VlmThinkingMode } from "../../types";

export type RenderedPdfPage = {
  project_id: string;
  page: number;
  dpi: number;
  mime_type: "image/png";
  width: number;
  height: number;
  sha256: string;
  data_url: string;
};

export type PlaygroundAttachment = {
  id: string;
  type: "pdf_page";
  project_id: string;
  page: number;
  dpi: number;
  sha256: string;
  name: string;
  dataUrl: string;
};

export type PlaygroundChatMessage = {
  id?: string;
  role: "user" | "assistant" | "system";
  content: string;
  attachments?: PlaygroundAttachment[];
  created_at?: string;
};

export type PlaygroundChatResponse = {
  message: {
    id?: string;
    role: "assistant";
    content: string;
    created_at?: string;
  };
};

export type PlaygroundChatSessionSummary = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type PlaygroundChatSession = PlaygroundChatSessionSummary & {
  provider_id: string | null;
  thinking_mode: VlmThinkingMode;
  messages: PlaygroundChatMessage[];
};

export type PlaygroundChatListResponse = {
  chats: PlaygroundChatSessionSummary[];
  active_chat_id: string | null;
};

export type PlaygroundChatSessionResponse = PlaygroundChatListResponse & {
  chat: PlaygroundChatSession;
};

export type PlaygroundChatSendResponse = PlaygroundChatSessionResponse & {
  message: {
    id?: string;
    role: "assistant";
    content: string;
    created_at?: string;
  };
  warnings?: string[];
};

export type PlaygroundChatStreamEvent =
  | { type: "delta"; text: string }
  | { type: "thinking"; text: string }
  | { type: "warning"; detail: string }
  | { type: "final"; response: PlaygroundChatSendResponse };

export const playgroundKeys = {
  renderedPage: (projectId: string, page: number) =>
    ["playground", "rendered-page", projectId, page] as const,
  chats: ["playground", "chats"] as const,
  chat: (chatId: string) => ["playground", "chats", chatId] as const,
};

export function getRenderedPdfPage(projectId: string, page: number): Promise<RenderedPdfPage> {
  return requestJson<RenderedPdfPage>(
    `/api/projects/${projectId}/rendered-pages/${encodeURIComponent(String(page))}`,
  );
}

export function makePlaygroundAttachment(
  renderedPage: RenderedPdfPage,
  projectName: string,
): PlaygroundAttachment {
  return {
    id: crypto.randomUUID(),
    type: "pdf_page",
    project_id: renderedPage.project_id,
    page: renderedPage.page,
    dpi: renderedPage.dpi,
    sha256: renderedPage.sha256,
    name: `${projectName} · page ${renderedPage.page}`,
    dataUrl: renderedPage.data_url,
  };
}

export function sendPlaygroundChat(
  providerId: string,
  messages: PlaygroundChatMessage[],
): Promise<PlaygroundChatResponse> {
  return requestJson<PlaygroundChatResponse>("/api/playground/chat", {
    method: "POST",
    body: JSON.stringify({
      provider_id: providerId,
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        attachments:
          message.attachments?.map((attachment) => ({
            type: attachment.type,
            project_id: attachment.project_id,
            page: attachment.page,
            dpi: attachment.dpi,
            sha256: attachment.sha256,
          })) ?? [],
      })),
    }),
  });
}

export function listPlaygroundChats(): Promise<PlaygroundChatListResponse> {
  return requestJson<PlaygroundChatListResponse>("/api/playground/chats");
}

export function createPlaygroundChat(
  providerId?: string | null,
  thinkingMode: VlmThinkingMode = "auto",
): Promise<PlaygroundChatSessionResponse> {
  return requestJson<PlaygroundChatSessionResponse>("/api/playground/chats", {
    method: "POST",
    body: JSON.stringify({ provider_id: providerId ?? null, thinking_mode: thinkingMode }),
  }).then(normalizeChatSessionResponse);
}

export function getPlaygroundChat(chatId: string): Promise<{ chat: PlaygroundChatSession }> {
  return requestJson<{ chat: PlaygroundChatSession }>(
    `/api/playground/chats/${encodeURIComponent(chatId)}`,
  ).then((response) => ({ chat: normalizeChatSession(response.chat) }));
}

export function setActivePlaygroundChat(chatId: string): Promise<PlaygroundChatListResponse> {
  return requestJson<PlaygroundChatListResponse>(
    `/api/playground/chats/${encodeURIComponent(chatId)}/active`,
    { method: "PUT" },
  );
}

export function renamePlaygroundChat(
  chatId: string,
  title: string,
): Promise<PlaygroundChatSessionResponse> {
  return requestJson<PlaygroundChatSessionResponse>(
    `/api/playground/chats/${encodeURIComponent(chatId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ title }),
    },
  ).then(normalizeChatSessionResponse);
}

export function updatePlaygroundChatSettings(
  chatId: string,
  providerId: string,
  thinkingMode: VlmThinkingMode,
): Promise<PlaygroundChatSessionResponse> {
  return requestJson<PlaygroundChatSessionResponse>(
    `/api/playground/chats/${encodeURIComponent(chatId)}/settings`,
    {
      method: "PUT",
      body: JSON.stringify({ provider_id: providerId, thinking_mode: thinkingMode }),
    },
  ).then(normalizeChatSessionResponse);
}

export function deletePlaygroundChat(chatId: string): Promise<PlaygroundChatListResponse> {
  return requestJson<PlaygroundChatListResponse>(
    `/api/playground/chats/${encodeURIComponent(chatId)}`,
    { method: "DELETE" },
  );
}

export function sendPlaygroundChatMessage(
  chatId: string,
  providerId: string,
  thinkingMode: VlmThinkingMode,
  message: PlaygroundChatMessage,
): Promise<PlaygroundChatSendResponse> {
  return requestJson<PlaygroundChatSendResponse>(
    `/api/playground/chats/${encodeURIComponent(chatId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        provider_id: providerId,
        thinking_mode: thinkingMode,
        message: {
          id: message.id,
          role: message.role,
          content: message.content,
          attachments:
            message.attachments?.map((attachment) => ({
              type: attachment.type,
              project_id: attachment.project_id,
              page: attachment.page,
              dpi: attachment.dpi,
              sha256: attachment.sha256,
            })) ?? [],
        },
      }),
    },
  ).then((response) => ({ ...normalizeChatSessionResponse(response), message: response.message }));
}

export async function* streamPlaygroundChatMessage(
  chatId: string,
  providerId: string,
  thinkingMode: VlmThinkingMode,
  message: PlaygroundChatMessage,
  signal?: AbortSignal,
): AsyncGenerator<PlaygroundChatStreamEvent, void> {
  const response = await fetch(
    `/api/playground/chats/${encodeURIComponent(chatId)}/messages/stream`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        provider_id: providerId,
        thinking_mode: thinkingMode,
        message: {
          id: message.id,
          role: message.role,
          content: message.content,
          attachments:
            message.attachments?.map((attachment) => ({
              type: attachment.type,
              project_id: attachment.project_id,
              page: attachment.page,
              dpi: attachment.dpi,
              sha256: attachment.sha256,
            })) ?? [],
        },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  if (!response.body) {
    throw new Error("Streaming response did not include a body");
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = consumeSseEvents(buffer);
      buffer = events.remainder;
      for (const event of events.items) {
        yield normalizePlaygroundStreamEvent(event);
      }
    }
    buffer += decoder.decode();
    const events = consumeSseEvents(`${buffer}\n\n`);
    for (const event of events.items) {
      yield normalizePlaygroundStreamEvent(event);
    }
  } finally {
    reader.releaseLock();
  }
}

function normalizeChatSessionResponse(
  response: PlaygroundChatSessionResponse,
): PlaygroundChatSessionResponse {
  return { ...response, chat: normalizeChatSession(response.chat) };
}

function normalizeChatSession(chat: PlaygroundChatSession): PlaygroundChatSession {
  return {
    ...chat,
    thinking_mode: chat.thinking_mode ?? "auto",
    messages: chat.messages.map((message) => ({
      ...message,
      attachments:
        message.attachments?.map((attachment) => ({
          ...attachment,
          dataUrl:
            attachment.dataUrl ??
            (attachment as PlaygroundAttachment & { data_url?: string; url?: string }).data_url ??
            (attachment as PlaygroundAttachment & { url?: string }).url ??
            "",
        })) ?? [],
    })),
  };
}

type RawSseEvent = {
  event: string;
  data: string;
};

function consumeSseEvents(input: string): { items: RawSseEvent[]; remainder: string } {
  const normalized = input.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const remainder = parts.pop() ?? "";
  return {
    remainder,
    items: parts.map(parseSseEvent).filter((event) => event.data),
  };
}

function parseSseEvent(block: string): RawSseEvent {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }
  return { event, data: dataLines.join("\n") };
}

function normalizePlaygroundStreamEvent(event: RawSseEvent): PlaygroundChatStreamEvent {
  const data = JSON.parse(event.data) as Record<string, unknown>;
  if (event.event === "delta") {
    return { type: "delta", text: String(data.text ?? "") };
  }
  if (event.event === "thinking") {
    return { type: "thinking", text: String(data.text ?? "") };
  }
  if (event.event === "warning") {
    return { type: "warning", detail: String(data.detail ?? "") };
  }
  if (event.event === "final") {
    return {
      type: "final",
      response: {
        ...normalizeChatSessionResponse(data as PlaygroundChatSessionResponse),
        message: (data as PlaygroundChatSendResponse).message,
        warnings: (data as PlaygroundChatSendResponse).warnings,
      },
    };
  }
  if (event.event === "error") {
    throw new Error(String(data.detail ?? "Streaming request failed"));
  }
  throw new Error(`Unsupported playground stream event: ${event.event}`);
}
