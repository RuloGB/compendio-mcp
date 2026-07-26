import { describe, expect, it } from "vitest";
import type { DocumentMeta } from "../../src/domain/model";
import {
  applyOptionalFields,
  isNonEmptyString,
  resolveTags,
} from "../../src/domain/frontmatter";

describe("isNonEmptyString", () => {
  it("accepts a non-empty string", () => {
    expect(isNonEmptyString("hola")).toBe(true);
  });

  it("rejects an empty or whitespace-only string", () => {
    expect(isNonEmptyString("")).toBe(false);
    expect(isNonEmptyString("   ")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isNonEmptyString(undefined)).toBe(false);
    expect(isNonEmptyString(null)).toBe(false);
    expect(isNonEmptyString(42)).toBe(false);
  });
});

describe("resolveTags", () => {
  it("normalizes a list of strings: trimmed and lowercased", () => {
    const result = resolveTags({ tags: ["Lead", " validacion  "] });
    expect(result.tags).toEqual(["lead", "validacion"]);
    expect(result.error).toBeUndefined();
  });

  it("drops empty entries after trimming", () => {
    const result = resolveTags({ tags: ["lead", "   "] });
    expect(result.tags).toEqual(["lead"]);
  });

  it("returns an empty list when the field is absent", () => {
    expect(resolveTags({})).toEqual({ tags: [] });
  });

  it("reports an error when tags is not a list of strings", () => {
    const result = resolveTags({ tags: "lead" });
    expect(result.tags).toEqual([]);
    expect(result.error).toContain("must be a list of strings");
  });
});

describe("applyOptionalFields", () => {
  function baseMeta(): DocumentMeta {
    return { path: "a.md", title: "A", summary: "R", tags: [], hash: "h" };
  }

  it("attaches a trimmed propietario when present", () => {
    const meta = baseMeta();
    applyOptionalFields(meta, { owner: " BA " });
    expect(meta.owner).toBe("BA");
  });

  it("normalizes a YAML date (gray-matter parses dates into Date objects)", () => {
    const meta = baseMeta();
    applyOptionalFields(meta, { updated: new Date("2026-07-19T00:00:00Z") });
    expect(meta.updated).toBe("2026-07-19");
  });

  it("keeps a string actualizado trimmed as-is", () => {
    const meta = baseMeta();
    applyOptionalFields(meta, { updated: " 2026-07-19 " });
    expect(meta.updated).toBe("2026-07-19");
  });

  it("leaves both fields absent when neither is present", () => {
    const meta = baseMeta();
    applyOptionalFields(meta, {});
    expect(meta.owner).toBeUndefined();
    expect(meta.updated).toBeUndefined();
  });
});
