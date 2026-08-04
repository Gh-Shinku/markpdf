import type { Dispatch, SetStateAction } from "react";
import { ArrowLeft, Save, Settings } from "lucide-react";
import type { SettingsDraft, SettingsState, Status } from "../types";
import { StatusLine } from "./StatusLine";

type SettingsViewProps = {
  settings: SettingsState | null;
  settingsDraft: SettingsDraft;
  status: Status;
  onSettingsDraftChange: Dispatch<SetStateAction<SettingsDraft>>;
  onBack: () => void;
  onSave: () => void;
};

export function SettingsView({
  settings,
  settingsDraft,
  status,
  onSettingsDraftChange,
  onBack,
  onSave
}: SettingsViewProps) {
  return (
    <main className="app-shell settings-shell">
      <header className="topbar">
        <div className="brand">
          <Settings size={22} aria-hidden="true" />
          <div>
            <h1>LLM Settings</h1>
            <p>OpenAI-compatible API configuration for local generation.</p>
          </div>
        </div>
        <div className="toolbar">
          <button className="secondary-action" type="button" onClick={onBack}>
            <ArrowLeft size={16} />
            Back
          </button>
          <button className="primary-action" type="button" onClick={onSave}>
            <Save size={16} />
            Save
          </button>
        </div>
      </header>

      <section className="settings-panel">
        <div className="settings-form">
          <label>
            <span>Base URL</span>
            <input
              value={settingsDraft.baseUrl}
              onChange={(event) =>
                onSettingsDraftChange((draft) => ({ ...draft, baseUrl: event.target.value }))
              }
            />
          </label>
          <label>
            <span>Model</span>
            <input
              value={settingsDraft.model}
              onChange={(event) =>
                onSettingsDraftChange((draft) => ({ ...draft, model: event.target.value }))
              }
            />
          </label>
          <label>
            <span>API key</span>
            <input
              type="password"
              placeholder={
                settings?.has_api_key
                  ? `Configured (${settings.api_key_hint})`
                  : "Paste an API key"
              }
              value={settingsDraft.apiKey}
              onChange={(event) =>
                onSettingsDraftChange((draft) => ({ ...draft, apiKey: event.target.value }))
              }
            />
          </label>
          <p className="settings-note">
            The key is stored in a local server config file in plain text. Use this only for a
            trusted local workspace.
          </p>
        </div>
        <StatusLine status={status} />
      </section>
    </main>
  );
}
