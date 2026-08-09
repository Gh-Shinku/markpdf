import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsView } from "./SettingsView";

afterEach(cleanup);

describe("SettingsView", () => {
  it("renders the prompt template editor with the current value", () => {
    render(
      <SettingsView
        providers={[]}
        drafts={[]}
        prompt="current prompt"
        defaultPrompt="default prompt"
        themePreference="system"
        testingProviderId={null}
        onProvidersChange={vi.fn()}
        onPromptChange={vi.fn()}
        onThemePreferenceChange={vi.fn()}
        onBack={vi.fn()}
        onOpenHome={vi.fn()}
        onOpenTasks={vi.fn()}
        onOpenPlayground={vi.fn()}
        onOpenDocs={vi.fn()}
        onSave={vi.fn()}
        onTest={vi.fn()}
      />,
    );

    const editor = screen.getByLabelText("Page extraction prompt template");
    expect((editor as HTMLTextAreaElement).value).toBe("current prompt");
    expect(screen.getByText(/Available variables:/)).toBeTruthy();
  });

  it("restores the template to its default value", () => {
    const onPromptChange = vi.fn();
    render(
      <SettingsView
        providers={[]}
        drafts={[]}
        prompt="edited"
        defaultPrompt="default prompt"
        themePreference="system"
        testingProviderId={null}
        onProvidersChange={vi.fn()}
        onPromptChange={onPromptChange}
        onThemePreferenceChange={vi.fn()}
        onBack={vi.fn()}
        onOpenHome={vi.fn()}
        onOpenTasks={vi.fn()}
        onOpenPlayground={vi.fn()}
        onOpenDocs={vi.fn()}
        onSave={vi.fn()}
        onTest={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Restore default" }));

    expect(onPromptChange).toHaveBeenCalledTimes(1);
    expect(onPromptChange).toHaveBeenCalledWith("default prompt");
  });
});
