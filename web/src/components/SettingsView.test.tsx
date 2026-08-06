import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsView } from "./SettingsView";

afterEach(cleanup);

describe("SettingsView", () => {
  it("renders prompt template editors with current values", () => {
    render(
      <SettingsView
        providers={[]}
        drafts={[]}
        prompts={{ flat: "flat prompt text", tree: "tree prompt text" }}
        defaultPrompts={{ flat: "default flat", tree: "default tree" }}
        themePreference="system"
        testingProviderId={null}
        onProvidersChange={vi.fn()}
        onPromptsChange={vi.fn()}
        onThemePreferenceChange={vi.fn()}
        onBack={vi.fn()}
        onOpenHome={vi.fn()}
        onOpenTasks={vi.fn()}
        onSave={vi.fn()}
        onTest={vi.fn()}
      />,
    );

    const flatEditor = screen.getByLabelText("Flat page extraction prompt template");
    const treeEditor = screen.getByLabelText("Tree extraction prompt template");
    expect((flatEditor as HTMLTextAreaElement).value).toBe("flat prompt text");
    expect((treeEditor as HTMLTextAreaElement).value).toBe("tree prompt text");
    expect(screen.getByText(/Available variables:/)).toBeTruthy();
  });

  it("restores a template to its default value", () => {
    const onPromptsChange = vi.fn();
    render(
      <SettingsView
        providers={[]}
        drafts={[]}
        prompts={{ flat: "edited", tree: "" }}
        defaultPrompts={{ flat: "default flat", tree: "default tree" }}
        themePreference="system"
        testingProviderId={null}
        onProvidersChange={vi.fn()}
        onPromptsChange={onPromptsChange}
        onThemePreferenceChange={vi.fn()}
        onBack={vi.fn()}
        onOpenHome={vi.fn()}
        onOpenTasks={vi.fn()}
        onSave={vi.fn()}
        onTest={vi.fn()}
      />,
    );

    const restoreButtons = screen.getAllByRole("button", { name: "Restore default" });
    fireEvent.click(restoreButtons[0]);

    expect(onPromptsChange).toHaveBeenCalledTimes(1);
    const updater = onPromptsChange.mock.calls[0][0];
    expect(updater({ flat: "edited", tree: "other" })).toEqual({
      flat: "default flat",
      tree: "other",
    });
  });
});
