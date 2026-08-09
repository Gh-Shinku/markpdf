import { describe, expect, it } from "vitest";
import { getDefaultPlaygroundPage } from "./defaults";

describe("getDefaultPlaygroundPage", () => {
  it("uses the configured TOC start page when it is valid", () => {
    expect(getDefaultPlaygroundPage({ toc_start: 4, page_count: 12 })).toBe("4");
  });

  it("falls back to page 1 when the configured TOC start page is invalid", () => {
    expect(getDefaultPlaygroundPage({ toc_start: 0, page_count: 12 })).toBe("1");
    expect(getDefaultPlaygroundPage({ toc_start: 18, page_count: 12 })).toBe("1");
  });
});
