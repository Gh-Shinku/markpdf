import { requestJson } from "../../api";

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
};

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
): Promise<PlaygroundChatSessionResponse> {
  return requestJson<PlaygroundChatSessionResponse>("/api/playground/chats", {
    method: "POST",
    body: JSON.stringify({ provider_id: providerId ?? null }),
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

export function deletePlaygroundChat(chatId: string): Promise<PlaygroundChatListResponse> {
  return requestJson<PlaygroundChatListResponse>(
    `/api/playground/chats/${encodeURIComponent(chatId)}`,
    { method: "DELETE" },
  );
}

export function sendPlaygroundChatMessage(
  chatId: string,
  providerId: string,
  message: PlaygroundChatMessage,
): Promise<PlaygroundChatSendResponse> {
  return requestJson<PlaygroundChatSendResponse>(
    `/api/playground/chats/${encodeURIComponent(chatId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        provider_id: providerId,
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

function normalizeChatSessionResponse(
  response: PlaygroundChatSessionResponse,
): PlaygroundChatSessionResponse {
  return { ...response, chat: normalizeChatSession(response.chat) };
}

function normalizeChatSession(chat: PlaygroundChatSession): PlaygroundChatSession {
  return {
    ...chat,
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
