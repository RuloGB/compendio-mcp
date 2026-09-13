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

  it("[7.12] renders the 'outline' variant with the literal header, instructions, legend, nested flagged rows and the repeated group", () => {
    const result: ReadResult = {
      type: "outline",
      meta: meta({ status: "active", path: "docs/CHANGELOG.md" }),
      tokens: 27865,
      sections: [
        { heading: "1.0.0", tokens: 165, occurrences: 1, oversized: false, includesOtherContent: false, children: [] },
        { heading: "1.1.0", tokens: 165, occurrences: 1, oversized: false, includesOtherContent: false, children: [] },
      ],
      repeated: [
        { heading: "Added", tokens: 27861, occurrences: 167, oversized: true, includesOtherContent: true, children: [] },
      ],
      omitted: { kind: "none" },
    };
    const text = formatReadResult(result);
    expect(text).toBe(
      "---\n" +
        "status: active\n" +
        "---\n" +
        "\n" +
        'Document "docs/CHANGELOG.md" is too large to return whole (~27865 tokens; limit 6000).\n' +
        "Call read_doc again with one of these headings, verbatim, as section. " +
        "(~N) is the estimated size in tokens of that response.\n" +
        'Flags: "xN" = the heading occurs N times and the response contains all of them; ' +
        '"too large" = still over 6000 tokens, request a narrower heading or use your own file-reading tool; ' +
        '"+other" = the response also contains text from other headings.\n' +
        "- 1.0.0 (~165)\n" +
        "- 1.1.0 (~165)\n" +
        "Repeated under several headings (listed once):\n" +
        "- Added (~27861, x167, too large, +other)",
    );
    assertNoEmptyBullet(text);
  });

  it("[7.12] renders the 'outline' variant with no frontmatter fields present, and no legend when no listed row uses any flag", () => {
    const result: ReadResult = {
      type: "outline",
      meta: meta(),
      tokens: 6500,
      sections: [{ heading: "Intro", tokens: 6500, occurrences: 1, oversized: false, includesOtherContent: false, children: [] }],
      repeated: [],
      omitted: { kind: "none" },
    };
    const text = formatReadResult(result);
    expect(text).toBe(
      "---\n" +
        "---\n" +
        "\n" +
        'Document "a.md" is too large to return whole (~6500 tokens; limit 6000).\n' +
        "Call read_doc again with one of these headings, verbatim, as section. " +
        "(~N) is the estimated size in tokens of that response.\n" +
        "- Intro (~6500)",
    );
  });

  it("[7.12] renders the 'subheadings' omission notice, with only the 'too large' flag legend when only that flag is in use", () => {
    const result: ReadResult = {
      type: "outline",
      meta: meta(),
      tokens: 9000,
      sections: [
        {
          heading: "Big",
          tokens: 7000,
          occurrences: 1,
          oversized: true,
          includesOtherContent: false,
          children: [{ heading: "Small child", tokens: 100, occurrences: 1, oversized: false, includesOtherContent: false, children: [] }],
        },
      ],
      repeated: [],
      omitted: { kind: "subheadings", hidden: 12 },
    };
    const text = formatReadResult(result);
    expect(text).toBe(
      "---\n" +
        "---\n" +
        "\n" +
        'Document "a.md" is too large to return whole (~9000 tokens; limit 6000).\n' +
        "Call read_doc again with one of these headings, verbatim, as section. " +
        "(~N) is the estimated size in tokens of that response.\n" +
        'Flags: "too large" = still over 6000 tokens, request a narrower heading or use your own file-reading tool.\n' +
        "12 subheadings and repeated headings are not listed (outline limit). " +
        "Request a listed heading, or find a subsection with search_docs and pass its section value.\n" +
        "- Big (~7000, too large)\n" +
        "  - Small child (~100)",
    );
  });

  it("[7.12] renders the 'truncated' omission notice, with no children and no repeated group", () => {
    const result: ReadResult = {
      type: "outline",
      meta: meta(),
      tokens: 50000,
      sections: [{ heading: "First", tokens: 50, occurrences: 1, oversized: false, includesOtherContent: false, children: [] }],
      repeated: [],
      omitted: { kind: "truncated", shown: 1, total: 500 },
    };
    const text = formatReadResult(result);
    expect(text).toBe(
      "---\n" +
        "---\n" +
        "\n" +
        'Document "a.md" is too large to return whole (~50000 tokens; limit 6000).\n' +
        "Call read_doc again with one of these headings, verbatim, as section. " +
        "(~N) is the estimated size in tokens of that response.\n" +
        "Only the first 1 of 500 top-level headings are listed, without subheadings (outline limit). " +
        "For the others, find the section with search_docs and pass its section value, or use your own file-reading tool.\n" +
        "- First (~50)",
    );
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
