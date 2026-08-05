import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PreviewSettingsMenu } from "./PreviewSettingsMenu";

describe("PreviewSettingsMenu", () => {
  it("edits the page offset without invoking preview controls", () => {
    const onPageOffsetChange = vi.fn();
    render(<PreviewSettingsMenu pageOffset="0" onPageOffsetChange={onPageOffsetChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Preview settings" }));
    const input = screen.getByRole("spinbutton", { name: "Page offset" });
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onPageOffsetChange).toHaveBeenCalledWith("12");
    expect(screen.queryByRole("spinbutton", { name: "Page offset" })).toBeNull();
  });
});
