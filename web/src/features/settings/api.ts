import { requestJson } from "../../api";
import type { SettingsDraft, SettingsState } from "../../types";

export const settingsKey = ["settings", "llm"] as const;

export async function getSettings(): Promise<SettingsState> {
  const data = await requestJson<{ settings: SettingsState }>("/api/settings/llm");
  return data.settings;
}

export async function saveSettings(draft: SettingsDraft): Promise<SettingsState> {
  const payload: { base_url: string; model: string; api_key?: string } = {
    base_url: draft.baseUrl,
    model: draft.model
  };
  if (draft.apiKey.trim()) {
    payload.api_key = draft.apiKey;
  }
  const data = await requestJson<{ settings: SettingsState }>("/api/settings/llm", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  return data.settings;
}
