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
  role: "user" | "assistant" | "system";
  content: string;
  attachments?: PlaygroundAttachment[];
};

export type PlaygroundChatResponse = {
  message: {
    role: "assistant";
    content: string;
  };
};

export const playgroundKeys = {
  renderedPage: (projectId: string, page: number) =>
    ["playground", "rendered-page", projectId, page] as const,
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
