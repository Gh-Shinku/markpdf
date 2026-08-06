import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewSettingsMenu } from "./PreviewSettingsMenu";

afterEach(cleanup);

describe("PreviewSettingsMenu", () => {
  it("edits the page offset without invoking preview controls", () => {
    const onPageOffsetChange = vi.fn();
    render(
      <PreviewSettingsMenu
        pageOffset="0"
        injectTocPage={true}
        onPageOffsetChange={onPageOffsetChange}
        onInjectTocPageChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview settings" }));
    const input = screen.getByRole("spinbutton", { name: "Page offset" });
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onPageOffsetChange).toHaveBeenCalledWith("12");
    expect(screen.queryByRole("spinbutton", { name: "Page offset" })).toBeNull();
  });

  it("toggles the toc page injection option", () => {
    const onInjectTocPageChange = vi.fn();
    render(
      <PreviewSettingsMenu
        pageOffset="0"
        injectTocPage={true}
        onPageOffsetChange={vi.fn()}
        onInjectTocPageChange={onInjectTocPageChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview settings" }));
    const checkbox = screen.getByRole("checkbox", { name: "注入目录 page" });
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    fireEvent.click(checkbox);
    expect(onInjectTocPageChange).toHaveBeenCalledWith(false);
  });
});
