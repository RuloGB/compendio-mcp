import { describe, expect, it } from "vitest";
import type { ReadResult } from "../../src/application/read-document";
import type { DocumentMeta } from "../../src/domain/model";
import { formatReadResult } from "../../src/server";

function meta(overrides: Partial<DocumentMeta> = {}): DocumentMeta {
  return { path: "a.md", title: "A", summary: "s", tags: [], hash: "h", ...overrides };
}

/**
 * Gate 4: no rendered line is a bullet with an empty label, for ANY input --
 * a property of `formatReadResult` itself, not of a well-behaved caller
 * (design.md Decision 5).
 */
function assertNoEmptyBullet(text: string): void {
  for (const line of text.split("\n")) {
    expect(line).not.toBe("- ");
    expect(line).not.toMatch(/^- \s*$/);
  }
}

describe("formatReadResult — Gate 4: never an empty-labeled bullet, for any input", () => {
  it("renders a 'document' result with frontmatter and content", () => {
    const result: ReadResult = { type: "document", meta: meta(), content: "# A\n\nbody" };
    const text = formatReadResult(result);
    expect(text).toContain("# A");
    expect(text).toContain("body");
  });

  it("renders a 'section' result with frontmatter and content", () => {
    const result: ReadResult = { type: "section", meta: meta(), section: "Intro", content: "body" };
    const text = formatReadResult(result);
    expect(text).toContain("body");
  });

  it("renders a 'path-not-found' result with the closest suggestions as bullets", () => {
    const result: ReadResult = {
      type: "path-not-found",
      path: "missing.md",
      suggestions: ["a.md", "b.md", "c.md"],
    };
    const text = formatReadResult(result);
    expect(text).toContain('No indexed document exists at path "missing.md".');
    expect(text).toContain("- a.md");
    expect(text).toContain("- b.md");
    expect(text).toContain("- c.md");
    assertNoEmptyBullet(text);
  });

  it("renders a 'section-not-found' result whose availableSections is a normal non-empty list", () => {
    const result: ReadResult = {
      type: "section-not-found",
      meta: meta(),
      section: "missing",
      availableSections: ["Intro", "Rules"],
    };
    const text = formatReadResult(result);
    expect(text).toContain("- Intro");
    expect(text).toContain("- Rules");
    assertNoEmptyBullet(text);
  });

  it("[RED->GREEN] filters a lone empty member out of availableSections === [''], falling through to the no-sections prose", () => {
    // ReadDocument itself should never produce this shape (it filters on the
    // way in) -- Gate 4 requires the guarantee to hold as a property of
    // formatReadResult ALONE, for any input, not conditional on its caller.
    const result: ReadResult = {
      type: "section-not-found",
      meta: meta(),
      section: "missing",
      availableSections: [""],
    };
    const text = formatReadResult(result);
    assertNoEmptyBullet(text);
    expect(text).toContain('Document "a.md" has no addressable sections.');
    expect(text).toContain('Read it whole with read_doc({ path: "a.md" }).');
  });

  it("[RED->GREEN] filters empty members out of a mixed availableSections === ['', 'A'], keeping only the real one", () => {
    const result: ReadResult = {
      type: "section-not-found",
      meta: meta(),
      section: "missing",
      availableSections: ["", "A"],
    };
    const text = formatReadResult(result);
    assertNoEmptyBullet(text);
    expect(text).toContain("- A");
    expect(text).not.toContain("Document \"a.md\" has no addressable sections.");
  });

  it("[RED->GREEN] an already-empty availableSections === [] also falls through to the no-sections prose", () => {
    const result: ReadResult = {
      type: "section-not-found",
      meta: meta(),
      section: "missing",
      availableSections: [],
    };
    const text = formatReadResult(result);
    assertNoEmptyBullet(text);
    expect(text).toContain('Document "a.md" has no addressable sections.');
  });

  it("[RED->GREEN] renders the 'no-sections' variant with the exact contract prose, verbatim", () => {
    const result: ReadResult = {
      type: "no-sections",
      meta: meta({ path: "manual.md" }),
      section: "anything",
    };
    const text = formatReadResult(result);
    expect(text).toBe(
      'Document "manual.md" has no addressable sections.\n' +
        'Read it whole with read_doc({ path: "manual.md" }).',
    );
    assertNoEmptyBullet(text);
  });
});
