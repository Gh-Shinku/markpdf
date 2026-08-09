import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

  it("edits provider request options in the API modal", () => {
    const onProvidersChange = vi.fn();
    const onProvidersSave = vi.fn();
    render(
      <SettingsView
        providers={[]}
        drafts={[]}
        prompt="prompt"
        defaultPrompt="default prompt"
        themePreference="system"
        testingProviderId={null}
        onProvidersChange={onProvidersChange}
        onPromptChange={vi.fn()}
        onThemePreferenceChange={vi.fn()}
        onBack={vi.fn()}
        onOpenHome={vi.fn()}
        onOpenTasks={vi.fn()}
        onOpenPlayground={vi.fn()}
        onOpenDocs={vi.fn()}
        onSave={vi.fn()}
        onProvidersSave={onProvidersSave}
        onTest={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add API" }));
    expect(screen.queryByLabelText("Temperature")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    fireEvent.change(screen.getByLabelText("API name"), { target: { value: "Qwen" } });
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
    });
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "qwen3-vl-flash" } });
    fireEvent.change(screen.getByLabelText("Thinking mode"), { target: { value: "on" } });
    fireEvent.change(screen.getByLabelText("Temperature"), { target: { value: "0.3" } });
    fireEvent.change(screen.getByLabelText("Top P"), { target: { value: "0.8" } });
    fireEvent.change(screen.getByLabelText("Extra body"), {
      target: { value: '{ "trace_id": "abc" }' },
    });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));

    expect(onProvidersChange).toHaveBeenCalledTimes(1);
    expect(onProvidersSave).toHaveBeenCalledTimes(1);
    expect(onProvidersChange.mock.calls[0][0][0]).toMatchObject({
      name: "Qwen",
      thinkingMode: "on",
      sampling: { temperature: "0.3", top_p: "0.8" },
      extraBody: '{ "trace_id": "abc" }',
    });
    expect(onProvidersSave.mock.calls[0][0][0]).toMatchObject({
      name: "Qwen",
      thinkingMode: "on",
      sampling: { temperature: "0.3", top_p: "0.8" },
      extraBody: '{ "trace_id": "abc" }',
    });
  });

  it("summarizes non-default provider options in the API list", () => {
    expect(() =>
      render(
        <SettingsView
          providers={[]}
          drafts={[
            {
              name: "Qwen",
              baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
              model: "qwen3-vl-flash",
              apiKey: "",
              sampling: {
                temperature: "0.3",
                top_p: "",
                max_tokens: "",
                presence_penalty: "",
                frequency_penalty: "",
                seed: "",
              },
              thinkingMode: "off",
              extraBody: '{ "trace_id": "abc" }',
            },
          ]}
          prompt="prompt"
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
      ),
    ).not.toThrow();

    expect(screen.getByText("thinking:off")).toBeTruthy();
    expect(screen.getByText("sampling")).toBeTruthy();
    expect(screen.getByText("extra_body")).toBeTruthy();
  });
});
