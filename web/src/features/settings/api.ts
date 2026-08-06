import { requestJson } from "../../api";
import type { TocPrompts, VlmProvider, VlmProviderDraft } from "../../types";

export const settingsKey = ["settings", "providers"] as const;

export const promptsKey = ["settings", "prompts"] as const;

export type TocPromptsResponse = {
  prompts: TocPrompts;
  defaults: TocPrompts;
};

export async function getPrompts(): Promise<TocPromptsResponse> {
  return requestJson<TocPromptsResponse>("/api/settings/prompts");
}

export async function savePrompts(prompts: TocPrompts): Promise<TocPromptsResponse> {
  return requestJson<TocPromptsResponse>("/api/settings/prompts", {
    method: "PUT",
    body: JSON.stringify(prompts),
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
