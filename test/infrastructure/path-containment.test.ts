import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isSameOrInsideRealPath, sameRealPath } from "../../src/infrastructure/fs/path-containment";

describe("path-containment helpers", () => {
  it("accepts the root itself and descendants, but rejects siblings with shared prefixes", () => {
    const root = join("C:", "repo", "docs");

    expect(isSameOrInsideRealPath(root, root)).toBe(true);
    expect(isSameOrInsideRealPath(root, join(root, "guide.md"))).toBe(true);
    expect(isSameOrInsideRealPath(root, join("C:", "repo", "docs-old", "guide.md"))).toBe(false);
  });

  it.skipIf(process.platform !== "win32")("compares real paths case-insensitively on Windows", () => {
    expect(sameRealPath("C:\\Repo\\Docs", "c:\\repo\\docs")).toBe(true);
  });

  it.skipIf(process.platform === "win32")("compares real paths case-sensitively off Windows", () => {
    expect(sameRealPath("/Repo/Docs", "/repo/docs")).toBe(false);
  });
});
