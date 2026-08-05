import { describe, expect, it } from "vitest";
import { transformFile, type PipelineOptions } from "../../src/application/index-pipeline";
import { createConventionPolicy, type ConventionConfig } from "../../src/domain/convention";
import type { DocumentFile } from "../../src/domain/ports";
import { estimateTokens } from "../../src/domain/tokens";
import { RemarkMarkdownParser } from "../../src/infrastructure/markdown/remark-markdown-parser";

const LOOSE: ConventionConfig = {
  mode: "loose",
  excludedStatuses: [],
  frontmatterFields: { type: "type", module: "module", status: "status" },
};

const parser = new RemarkMarkdownParser();
const policy = createConventionPolicy(LOOSE);

function run(content: string, options: PipelineOptions, path = "doc.md") {
  const file: DocumentFile = { path, content };
  const result = transformFile(parser, policy, options, file, "hash");
  if (!result.ok) {
    throw new Error(`transformFile failed unexpectedly: ${result.errors.join(", ")}`);
  }
  return result;
}

// --- coverage helpers (self-contained, mirrors test/domain/split-text.test.ts) ---

function nonWhitespace(s: string): string {
  return s.replace(/\s+/g, "");
}

/** Code-point-safe subsequence check: every character of `needle`, in order,
 * must appear somewhere in `haystack` (extra characters may be interspersed).
 * Iterates by code point so a surrogate pair is never compared against half
 * of another one. */
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

describe("transformFile — NO_CHUNKING respects the size bound", () => {
  it("emits exactly one chunk for a NO_CHUNKING file within maxTokens, unchanged from current behavior", () => {
    const options: PipelineOptions = {
      chunking: { minTokens: 25, maxTokens: 100 },
      noChunking: ["doc.md"],
    };
    const content = "# Glossary\n\nA short body, well within the configured token bound.\n";

    const result = run(content, options);

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]!.position).toBe(0);
    expect(result.chunks[0]!.heading).toBe("Glossary");
  });

  it("splits a NO_CHUNKING file above maxTokens via the size cascade, NOT by its internal headings", () => {
    const options: PipelineOptions = {
      chunking: { minTokens: 25, maxTokens: 100 },
      noChunking: ["doc.md"],
    };
    // Internal ## headings that a heading-aware splitter (chunkOutline) would
    // use as cut points -- NO_CHUNKING must ignore them entirely and split on
    // size alone via splitToBound.
    const paragraphs = Array.from(
      { length: 20 },
      (_, i) => `Paragraph ${i} carries enough padding text to matter for the token bound today.`,
    );
    const body = [
      "## Internal Heading One",
      paragraphs.slice(0, 10).join("\n\n"),
      "## Internal Heading Two",
      paragraphs.slice(10).join("\n\n"),
    ].join("\n\n");
    const content = `# Glossary\n\n${body}\n`;

    const result = run(content, options);

    expect(result.chunks.length).toBeGreaterThan(1);
    for (const chunk of result.chunks) {
      expect(estimateTokens(chunk.content)).toBeLessThanOrEqual(options.chunking.maxTokens);
    }
    // Every piece carries the document title as its heading, never one of
    // the internal "## Internal Heading" lines -- proof splitting is by
    // size, not by heading structure (a heading-derived split would produce
    // per-section headings here instead).
    for (const chunk of result.chunks) {
      expect(chunk.heading).toBe("Glossary");
    }
    expect(result.chunks.map((c) => c.position)).toEqual(result.chunks.map((_, i) => i));
    expectCoverage(
      result.chunks.map((c) => c.content),
      content,
    );
  });
});

describe("transformFile — NO_CHUNKING coverage invariant (no content may be silently dropped)", () => {
  it("bounds and covers a NO_CHUNKING body made of a table, a fenced code block, and an unbroken paragraph, above maxTokens", () => {
    // Structurally hostile content routed through wholeDocumentChunk's
    // splitToBound, distinct from the plain headings+paragraphs case above:
    // proves the table/fence re-wrap machinery holds through the
    // NO_CHUNKING path, not only through chunkOutline.
    const header = "| Col A | Col B |";
    const separator = "|---|---|";
    const rows = Array.from({ length: 60 }, (_, i) => `| value-${i} | value-${i} |`);
    const table = `${header}\n${separator}\n${rows.join("\n")}`;

    const fenceInner = Array.from({ length: 80 }, (_, i) => `const z${i} = ${i};`).join("\n");
    const fence = "```js\n" + fenceInner + "\n```";

    const words = Array.from({ length: 2000 }, (_, i) => `palabra${i}`);
    const paragraph = words.join(" "); // no sentence punctuation

    const options: PipelineOptions = {
      chunking: { minTokens: 25, maxTokens: 100 },
      noChunking: ["doc.md"],
    };
    const content = `# Glossary\n\n${table}\n\n${fence}\n\n${paragraph}\n`;

    const result = run(content, options);

    expect(result.chunks.length).toBeGreaterThan(1);
    for (const chunk of result.chunks) {
      expect(estimateTokens(chunk.content)).toBeLessThanOrEqual(options.chunking.maxTokens);
    }
    for (const chunk of result.chunks) {
      expect(chunk.heading).toBe("Glossary");
    }
    expect(result.chunks.map((c) => c.position)).toEqual(result.chunks.map((_, i) => i));
    expectCoverage(
      result.chunks.map((c) => c.content),
      content,
    );
  });
});
