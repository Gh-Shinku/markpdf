import { requestJson } from "../../api";
import type { VlmProvider, VlmProviderDraft, VlmSampling } from "../../types";

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
    sampling: parseSamplingDraft(draft.sampling),
    thinking_mode: draft.thinkingMode,
    extra_body: parseExtraBodyDraft(draft.extraBody),
  }));
  const data = await requestJson<{ providers: VlmProvider[] }>("/api/settings/providers", {
    method: "PUT",
    body: JSON.stringify({ providers }),
  });
  return data.providers;
}

function parseSamplingDraft(draft: VlmProviderDraft["sampling"]): VlmSampling {
  return Object.fromEntries(
    Object.entries(draft)
      .map(([key, value]) => [key, value.trim()])
      .filter(([, value]) => value !== "")
      .map(([key, value]) => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) throw new Error(`${key} must be a number`);
        return [key, parsed];
      }),
  ) as VlmSampling;
}

function parseExtraBodyDraft(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Extra body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export async function testProvider(providerId: string): Promise<VlmProvider> {
  const data = await requestJson<{ provider: VlmProvider }>(
    `/api/settings/providers/${providerId}/test`,
    { method: "POST" },
  );
  return data.provider;
}
