import { describe, expect, it } from "vitest";
import { documentHeading, UNTITLED_HEADING, withNonEmptyHeadings } from "../../src/domain/chunking";
import type { Chunk } from "../../src/domain/model";

describe("documentHeading — the fallback chain (design.md Decision 2)", () => {
  it("a non-empty title wins over the path", () => {
    expect(documentHeading("Manual extenso", "manual-extenso.md")).toBe("Manual extenso");
  });

  it("an empty title falls back to a non-empty path", () => {
    expect(documentHeading("", "-.md")).toBe("-.md");
  });

  it("both empty falls to the totality terminator, exactly UNTITLED_HEADING", () => {
    expect(documentHeading("", "")).toBe(UNTITLED_HEADING);
    expect(UNTITLED_HEADING).toBe("Untitled document");
  });

  it("a whitespace-only title is treated as empty, falling back to the path", () => {
    expect(documentHeading("   ", "doc.md")).toBe("doc.md");
  });
});

describe("withNonEmptyHeadings — postconditions (design.md Decision 1/3)", () => {
  function chunk(heading: string, content: string, position: number): Chunk {
    return { heading, content, position };
  }

  it("replaces an empty heading with the fallback", () => {
    const chunks = [chunk("", "body one", 0)];
    const result = withNonEmptyHeadings(chunks, "Fallback title");
    expect(result[0]!.heading).toBe("Fallback title");
  });

  it("preserves a non-empty heading unchanged", () => {
    const chunks = [chunk("Real heading", "body one", 0)];
    const result = withNonEmptyHeadings(chunks, "Fallback title");
    expect(result[0]!.heading).toBe("Real heading");
  });

  it("applies the SAME fallback value uniformly across every chunk of one batch that needed it", () => {
    const chunks = [chunk("", "a", 0), chunk("", "b", 1), chunk("", "c", 2)];
    const result = withNonEmptyHeadings(chunks, "Shared fallback");
    expect(result.map((c) => c.heading)).toEqual([
      "Shared fallback",
      "Shared fallback",
      "Shared fallback",
    ]);
  });

  it("leaves content and position untouched, for both replaced and preserved chunks", () => {
    const chunks = [chunk("", "body one", 0), chunk("Real", "body two", 1)];
    const result = withNonEmptyHeadings(chunks, "Fallback");
    expect(result[0]!.content).toBe("body one");
    expect(result[0]!.position).toBe(0);
    expect(result[1]!.content).toBe("body two");
    expect(result[1]!.position).toBe(1);
  });

  it("mixes replaced and preserved headings within the same batch correctly", () => {
    const chunks = [chunk("", "a", 0), chunk("Real heading", "b", 1), chunk("", "c", 2)];
    const result = withNonEmptyHeadings(chunks, "Fallback");
    expect(result.map((c) => c.heading)).toEqual(["Fallback", "Real heading", "Fallback"]);
  });
});
