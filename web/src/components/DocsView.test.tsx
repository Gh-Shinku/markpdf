import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocsView } from "./DocsView";

class IntersectionObserverStub {
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds: ReadonlyArray<number> = [];
  observe = () => {};
  unobserve = () => {};
  disconnect = () => {};
  takeRecords = () => [];
}

vi.stubGlobal(
  "IntersectionObserver",
  IntersectionObserverStub as unknown as typeof IntersectionObserver,
);

afterEach(cleanup);

function renderDocs() {
  return render(<DocsView onOpenHome={vi.fn()} onOpenTasks={vi.fn()} onOpenSettings={vi.fn()} />);
}

describe("DocsView", () => {
  it("renders the usage guide heading and section navigation", () => {
    renderDocs();

    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s.some((el) => el.textContent?.includes("PDF Bookmark Workspace — User Guide"))).toBe(
      true,
    );
    const sectionNames = ["Overview", "Getting Started", "Projects", "TOC JSON Format", "Tasks"];
    const nav = document.querySelector(".docs-nav");
    for (const name of sectionNames) {
      expect(nav?.textContent).toContain(name);
    }
  });

  it("renders markdown content: headings, code block, and table", () => {
    renderDocs();

    expect(screen.getByRole("heading", { name: "AI Generation" })).toBeTruthy();
    // fenced code block renders inside <pre>
    const pre = document.querySelector(".doc-pre");
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain('"indent": 0');
    // GFM table renders
    expect(screen.getAllByRole("table").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("columnheader", { name: "Field" })).toBeTruthy();
  });

  it("links sidebar entries to heading anchors with matching ids", () => {
    renderDocs();

    const heading = screen.getByRole("heading", { name: "AI Generation" });
    expect(heading.id).toBe("ai-generation");
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    const navButton = screen.getByRole("button", { name: "AI Generation" });
    fireEvent.click(navButton);
    expect(scrollSpy).toHaveBeenCalled();
  });
});
