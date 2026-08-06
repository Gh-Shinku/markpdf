import { requestJson } from "../../api";
import type { VlmProvider, VlmProviderDraft } from "../../types";

export const settingsKey = ["settings", "providers"] as const;

export const promptsKey = ["settings", "prompts"] as const;

export type TocPromptResponse = {
  prompt: string;
  default: string;
};

export async function getPrompts(): Promise<TocPromptResponse> {
  return requestJson<TocPromptResponse>("/api/settings/prompts");
}

export async function savePrompts(prompt: string): Promise<TocPromptResponse> {
  return requestJson<TocPromptResponse>("/api/settings/prompts", {
    method: "PUT",
    body: JSON.stringify({ prompt }),
  });
}

export async function getProviders(): Promise<VlmProvider[]> {
  const data = await requestJson<{ providers: VlmProvider[] }>("/api/settings/providers");
  return data.providers;
}

export async function saveProviders(drafts: VlmProviderDraft[]): Promise<VlmProvider[]> {
  const providers = drafts.map((draft) => ({
    ...(draft.id ? { id: draft.id } : {}),
    name: draft.name,
    base_url: draft.baseUrl,
    model: draft.model,
    ...(draft.apiKey.trim() ? { api_key: draft.apiKey } : {}),
  }));
  const data = await requestJson<{ providers: VlmProvider[] }>("/api/settings/providers", {
    method: "PUT",
    body: JSON.stringify({ providers }),
  });
  return data.providers;
}

export async function testProvider(providerId: string): Promise<VlmProvider> {
  const data = await requestJson<{ provider: VlmProvider }>(
    `/api/settings/providers/${providerId}/test`,
    { method: "POST" },
  );
  return data.provider;
}
