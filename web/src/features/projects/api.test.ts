import { describe, expect, it } from "vitest";
import { projectKeys } from "./api";

describe("project query keys", () => {
  it("keeps project resources scoped to one project", () => {
    expect(projectKeys.detail("a")).toEqual(["projects", "a"]);
    expect(projectKeys.toc("a")).toEqual(["projects", "a", "toc"]);
  });
});
