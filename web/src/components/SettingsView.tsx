import { useState, type Dispatch, type DragEvent, type SetStateAction } from "react";
import {
  ArrowLeft,
  ChevronDown,
  GripVertical,
  Moon,
  Plus,
  Save,
  Settings2,
  Sun,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import type { ThemePreference } from "../hooks/useThemePreference";
import type { VlmProvider, VlmProviderDraft } from "../types";
import { AppNavigation } from "./AppNavigation";

type SettingsViewProps = {
  providers: VlmProvider[];
  drafts: VlmProviderDraft[];
  prompt: string;
  defaultPrompt: string;
  themePreference: ThemePreference;
  testingProviderId: string | null;
  onProvidersChange: Dispatch<SetStateAction<VlmProviderDraft[]>>;
  onPromptChange: Dispatch<SetStateAction<string>>;
  onThemePreferenceChange: (value: ThemePreference) => void;
  onBack: () => void;
  onOpenHome: () => void;
  onOpenTasks: () => void;
  onOpenPlayground: () => void;
  onOpenDocs: () => void;
  onSave: () => void;
  onProvidersSave?: (drafts: VlmProviderDraft[]) => void;
  onTest: (providerId: string) => void;
};

const blankSampling = (): VlmProviderDraft["sampling"] => ({
  temperature: "0",
  top_p: "",
  max_tokens: "",
  presence_penalty: "",
  frequency_penalty: "",
  seed: "",
});

const blankProvider = (): VlmProviderDraft => ({
  name: "",
  baseUrl: "",
  model: "",
  apiKey: "",
  sampling: blankSampling(),
  thinkingMode: "auto",
  extraBody: "",
});

const isNonDefaultNumber = (value: string, defaultValue?: number): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (defaultValue === undefined) return true;
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) || parsed !== defaultValue;
};

const hasCustomSampling = (sampling: VlmProviderDraft["sampling"]): boolean =>
  isNonDefaultNumber(sampling.temperature, 0) ||
  isNonDefaultNumber(sampling.top_p) ||
  isNonDefaultNumber(sampling.max_tokens) ||
  isNonDefaultNumber(sampling.presence_penalty) ||
  isNonDefaultNumber(sampling.frequency_penalty) ||
  isNonDefaultNumber(sampling.seed);

const getProviderChips = (provider: VlmProviderDraft): string[] => {
  const chips: string[] = [];
  if (provider.thinkingMode !== "auto") {
    chips.push(`thinking:${provider.thinkingMode}`);
  }
  if (hasCustomSampling(provider.sampling)) {
    chips.push("sampling");
  }
  if (provider.extraBody.trim()) {
    chips.push("extra_body");
  }
  return chips;
};

const isValidExtraBody = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return true;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return Boolean(parsed) && typeof parsed === "object" && !Array.isArray(parsed);
  } catch {
    return false;
  }
};

export function SettingsView({
  providers,
  drafts,
  prompt,
  defaultPrompt,
  themePreference,
  testingProviderId,
  onProvidersChange,
  onPromptChange,
  onThemePreferenceChange,
  onBack,
  onOpenHome,
  onOpenTasks,
  onOpenPlayground,
  onOpenDocs,
  onSave,
  onProvidersSave,
  onTest,
}: SettingsViewProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [modalDraft, setModalDraft] = useState<VlmProviderDraft | null>(null);
  const [modalError, setModalError] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  function reorder(from: number, to: number) {
    if (from === to) return;
    onProvidersChange((current) => {
      const next = [...current];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  function onDragStart(event: DragEvent<HTMLButtonElement>, index: number) {
    event.dataTransfer.setData("text/plain", String(index));
    event.dataTransfer.effectAllowed = "move";
  }
  function openAdd() {
    setEditingIndex(null);
    setModalDraft(blankProvider());
    setModalError("");
    setAdvancedOpen(false);
  }
  function openEdit(index: number) {
    setEditingIndex(index);
    setModalDraft({ ...drafts[index], sampling: { ...drafts[index].sampling } });
    setModalError("");
    setAdvancedOpen(false);
  }
  function saveModal() {
    if (!modalDraft) return;
    if (!isValidExtraBody(modalDraft.extraBody)) {
      setModalError("Extra body must be a JSON object");
      setAdvancedOpen(true);
      return;
    }
    const nextDrafts =
      editingIndex === null
        ? [...drafts, modalDraft]
        : drafts.map((item, index) => (index === editingIndex ? modalDraft : item));
    onProvidersChange(nextDrafts);
    onProvidersSave?.(nextDrafts);
    setModalDraft(null);
  }
  function restorePrompt() {
    onPromptChange(defaultPrompt);
  }
  const promptVariableHint =
    "Available variables: {toc_start}, {toc_end}, {pdf_name}. Leave the template empty to use the built-in default.";

  return (
    <main className="app-shell settings-shell">
      <AppNavigation
        active="settings"
        onHome={onOpenHome}
        onTasks={onOpenTasks}
        onPlayground={onOpenPlayground}
        onDocs={onOpenDocs}
        onSettings={() => undefined}
      />
      <header className="app-header">
        <div>
          <p className="eyebrow">Preferences</p>
          <h1>Settings</h1>
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
            <button
              className={themePreference === "system" ? "active" : ""}
              type="button"
              onClick={() => onThemePreferenceChange("system")}
            >
              System
            </button>
            <button
              className={themePreference === "light" ? "active" : ""}
              type="button"
              onClick={() => onThemePreferenceChange("light")}
            >
              <Sun size={15} />
              Light
            </button>
            <button
              className={themePreference === "dark" ? "active" : ""}
              type="button"
              onClick={() => onThemePreferenceChange("dark")}
            >
              <Moon size={15} />
              Dark
            </button>
          </div>
        </section>
        <section className="settings-group" aria-labelledby="providers-heading">
          <div className="settings-group-header">
            <div>
              <p className="section-kicker">Generation</p>
              <h2 id="providers-heading">VLM APIs</h2>
            </div>
            <button className="secondary-action" type="button" onClick={openAdd}>
              <Plus size={16} />
              Add API
            </button>
          </div>
          <div className="provider-list">
            {drafts.map((draft, index) => {
              const provider = draft.id ? providers.find((item) => item.id === draft.id) : null;
              const chips = getProviderChips(draft);
              return (
                <article
                  className="provider-row"
                  key={draft.id ?? `new-${index}`}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) =>
                    reorder(Number(event.dataTransfer.getData("text/plain")), index)
                  }
                >
                  <button
                    className="provider-grip"
                    type="button"
                    draggable
                    onDragStart={(event) => onDragStart(event, index)}
                    title="Drag to reorder"
                    aria-label="Drag to reorder"
                  >
                    <GripVertical size={17} />
                  </button>
                  <div className="provider-main">
                    <strong className="provider-name">{draft.name || "Untitled API"}</strong>
                    {chips.length ? (
                      <div className="provider-chips" aria-label="API options">
                        {chips.map((chip) => (
                          <span className="provider-chip" key={chip}>
                            {chip}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="provider-actions">
                    <span
                      className={`provider-status ${provider?.verification_status ?? "unverified"}`}
                    >
                      {provider?.verification_status ?? "Unsaved"}
                    </span>
                    {provider?.id ? (
                      <button
                        className="icon-button"
                        type="button"
                        disabled={testingProviderId === provider.id}
                        title="Test VLM API"
                        aria-label="Test VLM API"
                        onClick={() => onTest(provider.id)}
                      >
                        <Zap size={16} />
                      </button>
                    ) : null}
                    <button
                      className="icon-button"
                      type="button"
                      title="Edit API"
                      aria-label="Edit API"
                      onClick={() => openEdit(index)}
                    >
                      <Settings2 size={16} />
                    </button>
                    <button
                      className="icon-button danger-icon"
                      type="button"
                      title="Delete API"
                      aria-label="Delete API"
                      onClick={() =>
                        onProvidersChange((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
        <section className="settings-group" aria-labelledby="prompts-heading">
          <div className="settings-group-header">
            <div>
              <p className="section-kicker">Generation</p>
              <h2 id="prompts-heading">Prompt templates</h2>
            </div>
          </div>
          <p className="prompt-hint">{promptVariableHint}</p>
          <div className="prompt-field">
            <div className="prompt-field-header">
              <strong>Page extraction prompt</strong>
              <button className="secondary-action" type="button" onClick={restorePrompt}>
                Restore default
              </button>
            </div>
            <textarea
              className="prompt-textarea"
              aria-label="Page extraction prompt template"
              rows={12}
              spellCheck={false}
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
            />
          </div>
        </section>
      </section>
      {modalDraft ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal provider-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="provider-title"
          >
            <div className="modal-header">
              <h2 id="provider-title">{editingIndex === null ? "Add API" : "Edit API"}</h2>
              <button
                className="secondary-action icon-only"
                type="button"
                aria-label="Close"
                onClick={() => setModalDraft(null)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="settings-form">
              <div className="settings-form-basic">
                <label>
                  <span>API name</span>
                  <input
                    value={modalDraft.name}
                    onChange={(event) => setModalDraft({ ...modalDraft, name: event.target.value })}
                  />
                </label>
                <label>
                  <span>Base URL</span>
                  <input
                    value={modalDraft.baseUrl}
                    onChange={(event) =>
                      setModalDraft({ ...modalDraft, baseUrl: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>Model</span>
                  <input
                    value={modalDraft.model}
                    onChange={(event) =>
                      setModalDraft({ ...modalDraft, model: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>API key</span>
                  <input
                    type="password"
                    value={modalDraft.apiKey}
                    placeholder={
                      editingIndex !== null &&
                      providers.find((item) => item.id === drafts[editingIndex]?.id)?.has_api_key
                        ? "Configured"
                        : "API key"
                    }
                    onChange={(event) =>
                      setModalDraft({ ...modalDraft, apiKey: event.target.value })
                    }
                  />
                </label>
                <label className="settings-form-wide">
                  <span>Thinking mode</span>
                  <select
                    value={modalDraft.thinkingMode}
                    onChange={(event) =>
                      setModalDraft({
                        ...modalDraft,
                        thinkingMode: event.target.value as VlmProviderDraft["thinkingMode"],
                      })
                    }
                  >
                    <option value="auto">Auto</option>
                    <option value="on">On</option>
                    <option value="off">Off</option>
                  </select>
                </label>
              </div>
              <div className="settings-form-section">
                <button
                  className="settings-advanced-toggle"
                  type="button"
                  aria-expanded={advancedOpen}
                  aria-controls="provider-advanced-options"
                  onClick={() => setAdvancedOpen((current) => !current)}
                >
                  <span>Advanced</span>
                  <ChevronDown size={16} aria-hidden="true" />
                </button>
                {advancedOpen ? (
                  <div className="settings-advanced" id="provider-advanced-options">
                    <div className="settings-form-compact-grid">
                      <ProviderNumberField
                        label="Temperature"
                        value={modalDraft.sampling.temperature}
                        onChange={(value) =>
                          setModalDraft({
                            ...modalDraft,
                            sampling: { ...modalDraft.sampling, temperature: value },
                          })
                        }
                      />
                      <ProviderNumberField
                        label="Top P"
                        value={modalDraft.sampling.top_p}
                        onChange={(value) =>
                          setModalDraft({
                            ...modalDraft,
                            sampling: { ...modalDraft.sampling, top_p: value },
                          })
                        }
                      />
                      <ProviderNumberField
                        label="Max tokens"
                        value={modalDraft.sampling.max_tokens}
                        step="1"
                        onChange={(value) =>
                          setModalDraft({
                            ...modalDraft,
                            sampling: { ...modalDraft.sampling, max_tokens: value },
                          })
                        }
                      />
                      <ProviderNumberField
                        label="Presence penalty"
                        value={modalDraft.sampling.presence_penalty}
                        onChange={(value) =>
                          setModalDraft({
                            ...modalDraft,
                            sampling: { ...modalDraft.sampling, presence_penalty: value },
                          })
                        }
                      />
                      <ProviderNumberField
                        label="Frequency penalty"
                        value={modalDraft.sampling.frequency_penalty}
                        onChange={(value) =>
                          setModalDraft({
                            ...modalDraft,
                            sampling: { ...modalDraft.sampling, frequency_penalty: value },
                          })
                        }
                      />
                      <ProviderNumberField
                        label="Seed"
                        value={modalDraft.sampling.seed}
                        step="1"
                        onChange={(value) =>
                          setModalDraft({
                            ...modalDraft,
                            sampling: { ...modalDraft.sampling, seed: value },
                          })
                        }
                      />
                    </div>
                    <label className="settings-form-wide">
                      <span>Extra body</span>
                      <textarea
                        aria-invalid={Boolean(modalError)}
                        value={modalDraft.extraBody}
                        onChange={(event) => {
                          setModalDraft({ ...modalDraft, extraBody: event.target.value });
                          setModalError("");
                        }}
                      />
                    </label>
                    {modalError ? <div className="settings-form-error">{modalError}</div> : null}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="modal-actions">
              <button
                className="secondary-action"
                type="button"
                onClick={() => setModalDraft(null)}
              >
                Cancel
              </button>
              <button
                className="primary-action"
                type="button"
                disabled={
                  !modalDraft.name.trim() || !modalDraft.baseUrl.trim() || !modalDraft.model.trim()
                }
                onClick={saveModal}
              >
                Save
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function ProviderNumberField({
  label,
  value,
  step = "0.1",
  onChange,
}: {
  label: string;
  value: string;
  step?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
