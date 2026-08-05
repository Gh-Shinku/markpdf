import type { Dispatch, SetStateAction } from "react";
import { ArrowLeft, Moon, Save, Sun } from "lucide-react";
import type { ThemePreference } from "../hooks/useThemePreference";
import type { SettingsDraft, SettingsState } from "../types";
import { AppNavigation } from "./AppNavigation";

type SettingsViewProps = {
  settings: SettingsState | null;
  settingsDraft: SettingsDraft;
  themePreference: ThemePreference;
  onSettingsDraftChange: Dispatch<SetStateAction<SettingsDraft>>;
  onThemePreferenceChange: (value: ThemePreference) => void;
  onBack: () => void;
  onOpenHome: () => void;
  onSave: () => void;
};

export function SettingsView({
  settings,
  settingsDraft,
  themePreference,
  onSettingsDraftChange,
  onThemePreferenceChange,
  onBack,
  onOpenHome,
  onSave
}: SettingsViewProps) {
  return (
    <main className="app-shell settings-shell">
      <AppNavigation active="settings" onHome={onOpenHome} onSettings={() => undefined} />
      <header className="app-header">
        <div>
          <p className="eyebrow">Preferences</p>
          <div>
            <h1>Settings</h1>
          </div>
        </div>
        <div className="header-actions">
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

      <section className="settings-panel app-content-panel">
        <section className="settings-group" aria-labelledby="appearance-heading">
          <div className="settings-group-header">
            <div>
              <p className="section-kicker">Appearance</p>
              <h2 id="appearance-heading">Theme</h2>
            </div>
          </div>
          <div className="theme-segmented" role="group" aria-label="Color theme">
            <button className={themePreference === "system" ? "active" : ""} type="button" onClick={() => onThemePreferenceChange("system")}>System</button>
            <button className={themePreference === "light" ? "active" : ""} type="button" onClick={() => onThemePreferenceChange("light")}><Sun size={15} /> Light</button>
            <button className={themePreference === "dark" ? "active" : ""} type="button" onClick={() => onThemePreferenceChange("dark")}><Moon size={15} /> Dark</button>
          </div>
        </section>
        <section className="settings-group" aria-labelledby="connection-heading">
          <div className="settings-group-header">
            <div>
              <p className="section-kicker">Generation</p>
              <h2 id="connection-heading">LLM connection</h2>
            </div>
          </div>
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
        </section>
      </section>
    </main>
  );
}
