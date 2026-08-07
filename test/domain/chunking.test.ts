import { describe, expect, it } from "vitest";
import { chunkOutline } from "../../src/domain/chunking";
import type { DocOutline, DocSection } from "../../src/domain/outline";
import { estimateTokens } from "../../src/domain/tokens";

// minTokens 25 = 100 chars; maxTokens 100 = 400 chars (4 chars per token).
const OPTS = { minTokens: 25, maxTokens: 100 };

function section(title: string, chars: number, children: DocSection[] = []): DocSection {
  return { title, text: `## ${title}\n\n${"x".repeat(chars)}`, children };
}

function outline(sections: DocSection[], intro = ""): DocOutline {
  return { title: "Test doc", summary: "Summary.", intro, sections };
}

/**
 * A heading-less outline (`outline.title === ""`) -- the existing `outline()`
 * helper above hardcodes `title: "Test doc"` and cannot express this case.
 * `addressable-chunks` design.md Decision 1/2.
 */
function emptyTitleOutline(sections: DocSection[], intro = ""): DocOutline {
  return { title: "", summary: "Summary.", intro, sections };
}

describe("chunkOutline", () => {
  it("creates one chunk per H2 section when sizes are within limits", () => {
    const chunks = chunkOutline(outline([section("Context", 200), section("Rules", 250)]), OPTS);
    expect(chunks.map((c) => c.heading)).toEqual(["Context", "Rules"]);
    expect(chunks[0]!.content).toContain("## Context");
    expect(chunks.map((c) => c.position)).toEqual([0, 1]);
  });

  it("emits the intro (text between H1 and first H2) under the document title", () => {
    const chunks = chunkOutline(
      outline([section("Context", 200)], "Summary paragraph with enough context."),
      OPTS,
    );
    expect(chunks[0]!.heading).toBe("Test doc");
    expect(chunks[0]!.content).toContain("Summary paragraph");
  });

  it("splits an oversized H2 into its H3 children with full heading paths", () => {
    const big = section("Business rules", 0, [
      { title: "Fields", text: `### Fields\n\n${"a".repeat(300)}`, children: [] },
      { title: "Duplicates", text: `### Duplicates\n\n${"b".repeat(300)}`, children: [] },
    ]);
    big.text = `## Business rules\n\n${"i".repeat(150)}`;
    const chunks = chunkOutline(outline([big]), OPTS);
    expect(chunks.map((c) => c.heading)).toEqual([
      "Business rules",
      "Business rules > Fields",
      "Business rules > Duplicates",
    ]);
  });

  it("keeps an H2 whole when it fits, even if it has H3 children", () => {
    const parent = section("Rules", 0, [
      { title: "Fields", text: "### Fields\n\nshort", children: [] },
    ]);
    parent.text = "## Rules\n\nbrief intro";
    const chunks = chunkOutline(outline([parent]), OPTS);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toContain("### Fields");
  });

  it("merges tiny contiguous sections into the previous chunk", () => {
    const chunks = chunkOutline(
      outline([section("Context", 200), section("References", 20), section("Notes", 20)]),
      OPTS,
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.heading).toBe("Context");
    expect(chunks[0]!.content).toContain("## References");
    expect(chunks[0]!.content).toContain("## Notes");
  });

  it("does not merge when the combination would exceed maxTokens", () => {
    const chunks = chunkOutline(outline([section("Big", 390), section("Mini", 20)]), OPTS);
    expect(chunks).toHaveLength(2);
  });

  it("splits an oversized H3 child section via the size cascade, and every resulting piece keeps the full 'H2 > H3' heading path", () => {
    const big = section("Business rules", 0, [
      { title: "Fields", text: `### Fields\n\n${"a".repeat(1000)}`, children: [] },
    ]);
    big.text = "## Business rules\n\nShort intro.";
    const chunks = chunkOutline(outline([big]), OPTS);

    const fieldsChunks = chunks.filter((c) => c.heading === "Business rules > Fields");
    expect(fieldsChunks.length).toBeGreaterThan(1);
    for (const chunk of fieldsChunks) {
      expect(estimateTokens(chunk.content)).toBeLessThanOrEqual(OPTS.maxTokens);
    }
    for (const chunk of chunks) {
      expect(["Business rules", "Business rules > Fields"]).toContain(chunk.heading);
    }
  });

  it("splits an oversized table via the size cascade, repeating the header and separator on every table piece", () => {
    const header = "| Col A | Col B |";
    const separator = "|---|---|";
    const rows = Array.from({ length: 60 }, (_, i) => `| value-${i} | value-${i} |`);
    const table = `## Table\n\n${header}\n${separator}\n${rows.join("\n")}`;
    const chunks = chunkOutline(
      outline([{ title: "Table", text: table, children: [] }]),
      OPTS,
    );

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.heading).toBe("Table");
      expect(estimateTokens(chunk.content)).toBeLessThanOrEqual(OPTS.maxTokens);
    }
    const tablePieces = chunks.filter((c) => c.content.includes(header));
    expect(tablePieces.length).toBeGreaterThan(1);
    for (const piece of tablePieces) {
      const lines = piece.content.split("\n");
      expect(lines[0]).toBe(header);
      expect(lines[1]).toBe(separator);
      expect(lines.length).toBeGreaterThan(2);
    }
  });

  it("does not merge two pieces whose joined candidate exceeds maxTokens, even though each is under minTokens alone (mergeTinyPieces guard regression)", () => {
    // Two 200-char (50-token) pieces. Both are under minTokens individually,
    // so merge is attempted for the second one, but the JOINED candidate
    // `${a}\n\n${b}` is 402 chars = ceil(402/4) = 101 tokens -- one over
    // maxTokens. The old guard summed the per-piece estimates
    // (50 + 50 = 100 <= 100) and merged anyway, silently emitting a
    // 101-token chunk over the bound this whole change exists to hold.
    const opts = { minTokens: 60, maxTokens: 100 };
    const secA: DocSection = { title: "A", text: "a".repeat(200), children: [] };
    const secB: DocSection = { title: "B", text: "b".repeat(200), children: [] };

    const chunks = chunkOutline(outline([secA, secB]), opts);

    expect(chunks).toHaveLength(2);
    for (const chunk of chunks) {
      expect(estimateTokens(chunk.content)).toBeLessThanOrEqual(opts.maxTokens);
    }
  });
});

// --- Non-empty-heading invariant: Gate 1/2 unit-level baselines ------------
//
// Case A (no H1, no H2) has zero coverage before this describe block: no test
// in this file constructs an outline with `title: ""`. These are BASELINEs,
// run and recorded on unmodified `src/` first (addressable-chunks design.md,
// "Gate 1 — red-first"); task 3.5 inverts 2.2(b) only, once
// `withNonEmptyHeadings` exists at the seam -- see that task's comment for
// why 2.1 and 2.2(a) stay asserting `heading === ""` here even after the
// domain-level fix lands.

describe("chunkOutline — non-empty-heading invariant (Gate 1/2 unit half)", () => {
  it("BASELINE (2.1, to be inverted at the seam, not here): a heading-less intro yields several chunks, every one with an empty heading", () => {
    const intro = "Prose with no heading structure at all, repeated many times over today. ".repeat(
      20,
    );
    const chunks = chunkOutline(emptyTitleOutline([], intro), OPTS);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.heading).toBe("");
    }
  });

  it("BASELINE (2.2a, to be inverted at the seam, not here): a top-level empty '##' section among real ones yields an empty heading for that section's chunk", () => {
    // Sized above minTokens (25 tokens / 100 chars) so mergeTinyPieces does
    // not fold the empty-heading piece into its neighbor -- a silently
    // merged fixture would pass this assertion for the wrong reason.
    const chunks = chunkOutline(
      outline([section("Context", 150), section("", 150), section("Rules", 150)]),
      OPTS,
    );

    expect(chunks.length).toBeGreaterThan(1);
    const emptyHeadingChunk = chunks.find((c) => c.content.includes("x".repeat(150)) && c.position === 1);
    expect(emptyHeadingChunk).toBeDefined();
    expect(emptyHeadingChunk!.heading).toBe("");
  });

  it("INVERTED (2.2b): the join filters the empty child segment before joining, so an empty '###' child under a good H2 now yields the well-formed 'Parent' rather than the malformed 'Parent > '", () => {
    // Parent oversized enough (with its child) to force the split-into-children
    // branch; the child's own body (300 chars = 75 tokens) is sized above
    // minTokens so it survives mergeTinyPieces intact and is not silently
    // folded into the parent piece.
    const big = section("Parent", 0, [section("", 300)]);
    big.text = `## Parent\n\n${"i".repeat(150)}`;
    const chunks = chunkOutline(outline([big]), OPTS);

    expect(chunks.length).toBeGreaterThan(1);
    const childChunk = chunks.find((c) => c.content.includes("x".repeat(300)));
    expect(childChunk).toBeDefined();
    expect(childChunk!.heading).toBe("Parent");
  });
});

// --- Coverage invariant: no path may silently drop content -----------------
//
// The bound invariant (every chunk <= maxTokens) is necessary but not
// sufficient: emitting fewer characters than the source also "satisfies" the
// bound trivially. These adversarial cases assert the spec's own scenario
// wording ("together the chunks cover the full body") at the chunkOutline
// level, feeding inputs hostile to the cascade rather than tidy prose.

function nonWhitespace(s: string): string {
  return s.replace(/\s+/g, "");
}

/** Code-point-safe subsequence check: every character of `needle`, in
 * order, must appear somewhere in `haystack` (extra characters -- re-emitted
 * heading lines, table/fence preambles -- may be interspersed). Iterates by
 * code point so a surrogate pair is never compared against half of
 * another one. */
function isSubsequence(needle: string, haystack: string): boolean {
  const needleCodePoints = Array.from(needle);
  let i = 0;
  for (const ch of haystack) {
    if (i >= needleCodePoints.length) break;
    if (ch === needleCodePoints[i]) i++;
  }
  return i === needleCodePoints.length;
}

function expectCoverage(contents: string[], original: string): void {
  const reconstructed = nonWhitespace(contents.join(""));
  const expected = nonWhitespace(original);
  expect(isSubsequence(expected, reconstructed)).toBe(true);
}

describe("chunkOutline coverage invariant (no content may be silently dropped)", () => {
  it("covers a heading-less 50 KB intro without losing any content, staying within the bound", () => {
    const intro = "Prose with no heading structure at all, repeated many times over today. ".repeat(
      650,
    ); // ~50,000 chars
    const chunks = chunkOutline(outline([], intro), OPTS);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(estimateTokens(chunk.content)).toBeLessThanOrEqual(OPTS.maxTokens);
    }
    expectCoverage(
      chunks.map((c) => c.content),
      intro,
    );
  });

  it("covers a section that is one large unterminated fenced code block, without losing content", () => {
    const fenceBody =
      "```js\n" + Array.from({ length: 300 }, (_, i) => `const x${i} = ${i};`).join("\n");
    const sec: DocSection = { title: "Snippet", text: `## Snippet\n\n${fenceBody}`, children: [] };
    const chunks = chunkOutline(outline([sec]), OPTS);

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(estimateTokens(chunk.content)).toBeLessThanOrEqual(OPTS.maxTokens);
    }
    expectCoverage(
      chunks.map((c) => c.content),
      sec.text,
    );
  });

  it("covers a section that is one large oversized markdown table, without losing content", () => {
    const header = "| Col A | Col B |";
    const separator = "|---|---|";
    const rows = Array.from({ length: 200 }, (_, i) => `| value-${i} | value-${i} |`);
    const table = `## Table\n\n${header}\n${separator}\n${rows.join("\n")}`;
    const sec: DocSection = { title: "Table", text: table, children: [] };
    const chunks = chunkOutline(outline([sec]), OPTS);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(estimateTokens(chunk.content)).toBeLessThanOrEqual(OPTS.maxTokens);
    }
    expectCoverage(
      chunks.map((c) => c.content),
      table,
    );
  });

  it("covers a section that is a single unbroken 20,000-character line, without losing content", () => {
    const line = "z".repeat(20_000);
    const sec: DocSection = { title: "Blob", text: `## Blob\n\n${line}`, children: [] };
    const chunks = chunkOutline(outline([sec]), OPTS);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(estimateTokens(chunk.content)).toBeLessThanOrEqual(OPTS.maxTokens);
    }
    expectCoverage(
      chunks.map((c) => c.content),
      sec.text,
    );
  });

  it("covers a single unbroken 50 KB paragraph (no sentence punctuation, no blank lines) without losing content, staying within the bound", () => {
    // No periods anywhere, so sentence-level splitting finds no boundary and
    // the cascade falls through to word-level packing -- distinct from both
    // the heading-less intro above (sentence-punctuated) and the 20,000-char
    // unbroken line above (no whitespace at all, falls to code points).
    const words = Array.from({ length: 7000 }, (_, i) => `word${i}`);
    const paragraph = words.join(" "); // ~50,000 chars, one block, one "paragraph"
    const sec: DocSection = { title: "Wall", text: `## Wall\n\n${paragraph}`, children: [] };
    const chunks = chunkOutline(outline([sec]), OPTS);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(estimateTokens(chunk.content)).toBeLessThanOrEqual(OPTS.maxTokens);
    }
    expectCoverage(
      chunks.map((c) => c.content),
      sec.text,
    );
  });

  it("covers a section that is one large well-formed (terminated) fenced code block, without losing content", () => {
    // Contrasts with the unterminated-fence case above: a genuine opening
    // AND closing fence, with a blank line inside the fence body that must
    // NOT be treated as a block boundary.
    const inner = [
      ...Array.from({ length: 150 }, (_, i) => `const x${i} = ${i};`),
      "",
      ...Array.from({ length: 150 }, (_, i) => `const y${i} = ${i};`),
    ].join("\n");
    const fenceBody = "```js\n" + inner + "\n```";
    const sec: DocSection = { title: "Snippet", text: `## Snippet\n\n${fenceBody}`, children: [] };
    const chunks = chunkOutline(outline([sec]), OPTS);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(estimateTokens(chunk.content)).toBeLessThanOrEqual(OPTS.maxTokens);
    }
    expectCoverage(
      chunks.map((c) => c.content),
      sec.text,
    );
  });
});
