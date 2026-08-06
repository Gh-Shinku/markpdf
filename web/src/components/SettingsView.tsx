import { useState, type Dispatch, type DragEvent, type SetStateAction } from "react";
import {
  ArrowLeft,
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
import type { TocPromptMode, TocPrompts, VlmProvider, VlmProviderDraft } from "../types";
import { AppNavigation } from "./AppNavigation";

type SettingsViewProps = {
  providers: VlmProvider[];
  drafts: VlmProviderDraft[];
  prompts: TocPrompts;
  defaultPrompts: TocPrompts;
  themePreference: ThemePreference;
  testingProviderId: string | null;
  onProvidersChange: Dispatch<SetStateAction<VlmProviderDraft[]>>;
  onPromptsChange: Dispatch<SetStateAction<TocPrompts>>;
  onThemePreferenceChange: (value: ThemePreference) => void;
  onBack: () => void;
  onOpenHome: () => void;
  onOpenTasks: () => void;
  onSave: () => void;
  onTest: (providerId: string) => void;
};

const blankProvider = (): VlmProviderDraft => ({ name: "", baseUrl: "", model: "", apiKey: "" });

export function SettingsView({
  providers,
  drafts,
  prompts,
  defaultPrompts,
  themePreference,
  testingProviderId,
  onProvidersChange,
  onPromptsChange,
  onThemePreferenceChange,
  onBack,
  onOpenHome,
  onOpenTasks,
  onSave,
  onTest,
}: SettingsViewProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [modalDraft, setModalDraft] = useState<VlmProviderDraft | null>(null);

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
  }
  function openEdit(index: number) {
    setEditingIndex(index);
    setModalDraft({ ...drafts[index] });
  }
  function saveModal() {
    if (!modalDraft) return;
    onProvidersChange((current) =>
      editingIndex === null
        ? [...current, modalDraft]
        : current.map((item, index) => (index === editingIndex ? modalDraft : item)),
    );
    setModalDraft(null);
  }
  function restorePrompt(mode: TocPromptMode) {
    onPromptsChange((current) => ({ ...current, [mode]: defaultPrompts[mode] }));
  }
  const promptVariableHint =
    "Available variables: {toc_start}, {toc_end}, {pdf_name}. Leave a template empty to use the built-in default.";

  return (
    <main className="app-shell settings-shell">
      <AppNavigation
        active="settings"
        onHome={onOpenHome}
        onTasks={onOpenTasks}
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
                  <strong className="provider-name">{draft.name || "Untitled API"}</strong>
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
              <strong>Flat page extraction</strong>
              <button
                className="secondary-action"
                type="button"
                onClick={() => restorePrompt("flat")}
              >
                Restore default
              </button>
            </div>
            <textarea
              className="prompt-textarea"
              aria-label="Flat page extraction prompt template"
              rows={12}
              spellCheck={false}
              value={prompts.flat}
              onChange={(event) =>
                onPromptsChange((current) => ({ ...current, flat: event.target.value }))
              }
            />
          </div>
          <div className="prompt-field">
            <div className="prompt-field-header">
              <strong>Tree extraction</strong>
              <button
                className="secondary-action"
                type="button"
                onClick={() => restorePrompt("tree")}
              >
                Restore default
              </button>
            </div>
            <textarea
              className="prompt-textarea"
              aria-label="Tree extraction prompt template"
              rows={12}
              spellCheck={false}
              value={prompts.tree}
              onChange={(event) =>
                onPromptsChange((current) => ({ ...current, tree: event.target.value }))
              }
            />
          </div>
        </section>
      </section>
      {modalDraft ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal"
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
                  onChange={(event) => setModalDraft({ ...modalDraft, model: event.target.value })}
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
                  onChange={(event) => setModalDraft({ ...modalDraft, apiKey: event.target.value })}
                />
              </label>
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
