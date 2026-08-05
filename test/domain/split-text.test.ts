import { afterEach, describe, expect, it, vi } from "vitest";
import { splitToBound } from "../../src/domain/split-text";
import * as tokensModule from "../../src/domain/tokens";
import { estimateTokens } from "../../src/domain/tokens";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("splitToBound", () => {
  it("returns the text unchanged, with a single estimateTokens call, when it already fits", () => {
    const spy = vi.spyOn(tokensModule, "estimateTokens");
    const text = "A short paragraph that comfortably fits within the token bound.";
    const maxTokens = 100;

    const result = splitToBound(text, maxTokens);

    expect(result).toEqual([text]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("splits a multi-paragraph section at paragraph boundaries only", () => {
    // Each paragraph fits alone (30 tokens); any two joined (61 tokens) do not.
    const p1 = `P1-${"x".repeat(117)}`;
    const p2 = `P2-${"x".repeat(117)}`;
    const p3 = `P3-${"x".repeat(117)}`;
    const text = [p1, p2, p3].join("\n\n");
    const maxTokens = 50;

    const pieces = splitToBound(text, maxTokens);

    expect(pieces).toEqual([p1, p2, p3]);
    for (const piece of pieces) {
      expect(estimateTokens(piece)).toBeLessThanOrEqual(maxTokens);
    }
  });

  it("falls through to sentence-level splitting for a single oversized paragraph", () => {
    const s1 =
      "The first sentence contains enough padding words to approach the configured token boundary today.";
    const s2 =
      "The second sentence also contains enough padding words to approach the same configured boundary now.";
    const s3 =
      "The third sentence again contains enough padding words to approach the boundary one more time here.";
    // One paragraph, one line: no blank lines, no newlines, so blocks/lines
    // cannot split it — only sentence boundaries can.
    const text = `${s1} ${s2} ${s3}`;
    const maxTokens = Math.max(estimateTokens(s1), estimateTokens(s2), estimateTokens(s3));

    const pieces = splitToBound(text, maxTokens);

    expect(pieces).toEqual([s1, s2, s3]);
    for (const piece of pieces) {
      expect(estimateTokens(piece)).toBeLessThanOrEqual(maxTokens);
    }
  });

  it("falls through to word-level splitting for a single oversized line with no sentence boundary", () => {
    // No punctuation anywhere, so the sentence level cannot find a boundary.
    const words = Array<string>(40).fill("abcd");
    const text = words.join(" ");
    const maxTokens = 10; // 40-char bound; 8 four-char words + 7 spaces = 39 chars fits, 9 does not

    const pieces = splitToBound(text, maxTokens);

    expect(pieces).toHaveLength(5);
    for (const piece of pieces) {
      expect(estimateTokens(piece)).toBeLessThanOrEqual(maxTokens);
      expect(piece.split(" ")).toHaveLength(8);
    }
    expect(pieces.join(" ")).toBe(text);
  });

  it("falls through to fixed-width code-point splitting on a whitespace-free run, never splitting a surrogate pair", () => {
    const emoji = "\u{1F600}"; // astral code point — a UTF-16 surrogate pair
    const prefix = "a".repeat(3999);
    const suffix = "b".repeat(999);
    const text = prefix + emoji + suffix; // 5000 chars, no whitespace anywhere
    const maxTokens = 1000; // 4000-char bound

    const pieces = splitToBound(text, maxTokens);

    expect(pieces).toEqual([prefix, emoji + suffix]);
    for (const piece of pieces) {
      expect(estimateTokens(piece)).toBeLessThanOrEqual(maxTokens);
    }
    // The emoji survives intact as a single code point in the second piece,
    // rather than being torn into a lone high/low surrogate.
    expect([...pieces[1]!][0]).toBe(emoji);
  });

  it("does not create false sentence boundaries at Spanish punctuation, decimals, or abbreviations", () => {
    const s1 = "¿Cuánto cuesta el envío urgente para el pedido completo hoy mismo?";
    const s2 = "¡Es increíble que el pedido llegue tan rápido a pesar del mal tiempo de hoy!";
    const s3 =
      "Según el art. 12 y el art. Único transitorio del reglamento, firmado por J. García, el plazo vence mañana sin excepción.";
    const s4 =
      "El peso máximo permitido por paquete es de 3.5 kilos según la normativa interna del servicio de mensajería.";
    const text = [s1, s2, s3, s4].join(" ");
    const maxTokens = 40; // comfortably above any single sentence's own token count

    const pieces = splitToBound(text, maxTokens);

    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.some((p) => p.includes(s1))).toBe(true);
    expect(pieces.some((p) => p.includes(s2))).toBe(true);
    expect(pieces.some((p) => p.includes("art. 12"))).toBe(true);
    expect(pieces.some((p) => p.includes("art. Único"))).toBe(true);
    expect(pieces.some((p) => p.includes("J. García"))).toBe(true);
    expect(pieces.some((p) => p.includes("3.5 kilos"))).toBe(true);
    for (const piece of pieces) {
      expect(estimateTokens(piece)).toBeLessThanOrEqual(maxTokens);
    }
  });

  it("splits an oversized markdown table, repeating the header and separator on every piece", () => {
    const header = "| Col A | Col B |";
    const separator = "|---|---|";
    const rows = Array.from({ length: 40 }, (_, i) => `| value-${i} | value-${i} |`);
    const text = [header, separator, ...rows].join("\n");
    const maxTokens = 30;

    const pieces = splitToBound(text, maxTokens);

    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) {
      const lines = piece.split("\n");
      expect(lines[0]).toBe(header);
      expect(lines[1]).toBe(separator);
      expect(lines.length).toBeGreaterThan(2);
      expect(estimateTokens(piece)).toBeLessThanOrEqual(maxTokens);
    }
    const reconstructedRows = pieces.flatMap((p) => p.split("\n").slice(2));
    expect(reconstructedRows).toEqual(rows);
  });

  it("never splits a fenced code block at an internal blank line, and re-wraps it when oversized", () => {
    const fenceOpen = "```js";
    const fenceClose = "```";
    const codeLines = Array.from({ length: 50 }, (_, i) => `const x${i} = ${i};`);
    codeLines.splice(10, 0, ""); // blank line inside the fence — must stay content, not a boundary
    const text = [fenceOpen, ...codeLines, fenceClose].join("\n");
    const maxTokens = 20;

    const pieces = splitToBound(text, maxTokens);

    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) {
      const lines = piece.split("\n");
      expect(lines[0]).toBe(fenceOpen);
      expect(lines[lines.length - 1]).toBe(fenceClose);
      expect(estimateTokens(piece)).toBeLessThanOrEqual(maxTokens);
    }
    const reconstructedContentLines = pieces.flatMap((p) => p.split("\n").slice(1, -1));
    expect(reconstructedContentLines).toEqual(codeLines);
  });

  it("keeps the bound over table validity for a row that cannot fit even with its own preamble", () => {
    const header = "| Col |";
    const separator = "|---|";
    const normalRow1 = "| short-1 |";
    const normalRow2 = "| short-2 |";
    const hugeCell = "x".repeat(300);
    const hugeRow = `| ${hugeCell} |`;
    const text = [header, separator, normalRow1, hugeRow, normalRow2].join("\n");
    const maxTokens = 20;

    const pieces = splitToBound(text, maxTokens);

    // The unconditional bound holds for every piece, including fragments of
    // the row that cannot fit alongside its own table preamble.
    for (const piece of pieces) {
      expect(estimateTokens(piece)).toBeLessThanOrEqual(maxTokens);
    }

    // Fragments carrying the huge row's content carry no header/separator preamble.
    const hugeRowPieces = pieces.filter((p) => p.includes("x"));
    expect(hugeRowPieces.length).toBeGreaterThan(0);
    for (const p of hugeRowPieces) {
      expect(p).not.toContain(header);
      expect(p).not.toContain(separator);
    }

    // The table's other rows keep their header/separator preamble.
    const normalRowPieces = pieces.filter(
      (p) => p.includes(normalRow1) || p.includes(normalRow2),
    );
    expect(normalRowPieces.length).toBeGreaterThan(0);
    for (const p of normalRowPieces) {
      expect(p.startsWith(header)).toBe(true);
      expect(p.split("\n")[1]).toBe(separator);
    }

    // Nothing from the source is lost.
    expect(pieces.join("")).toContain(hugeCell);
  });
});

// --- Coverage invariant: no path may silently drop content -----------------
//
// The bound invariant (every piece <= maxTokens) is necessary but not
// sufficient: a cascade level that returns FEWER characters than it was
// given also "satisfies" the bound trivially. This section asserts the
// second half of the spec's own scenario wording ("together the chunks
// cover the full body") independently of the bound.

function nonWhitespace(s: string): string {
  return s.replace(/\s+/g, "");
}

/** Code-point-safe subsequence check: every character of `needle`, in
 * order, must appear somewhere in `haystack` (extra characters — re-emitted
 * preambles, re-wrapped fences — may be interspersed). Iterates both sides
 * by code point so a surrogate pair is never compared against half of
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

function expectCoverage(pieces: string[], original: string): void {
  const reconstructed = nonWhitespace(pieces.join(""));
  const expected = nonWhitespace(original);
  expect(isSubsequence(expected, reconstructed)).toBe(true);
}

describe("splitToBound coverage invariant (no content may be silently dropped)", () => {
  it("preserves all content of an oversized, unterminated fenced code block instead of discarding it", () => {
    // No closing fence anywhere — a common shape in hand-edited or
    // generated markdown, not an exotic input.
    const text = "```js\n" + "const alpha = 1; ".repeat(40);
    const maxTokens = 60;

    const pieces = splitToBound(text, maxTokens);

    expect(pieces.length).toBeGreaterThan(0);
    for (const piece of pieces) {
      expect(estimateTokens(piece)).toBeLessThanOrEqual(maxTokens);
    }
    expectCoverage(pieces, text);
  });

  it("preserves an oversized table header's content instead of discarding it when no row can share it", () => {
    // The header column alone already exceeds maxTokens, so no row can ever
    // be packed alongside it — the header must still be emitted somewhere.
    const text = `| ${"h".repeat(200)} | b |\n|---|---|\n| p | q |\n| r | s |`;
    const maxTokens = 30;

    const pieces = splitToBound(text, maxTokens);

    expect(pieces.length).toBeGreaterThan(0);
    for (const piece of pieces) {
      expect(estimateTokens(piece)).toBeLessThanOrEqual(maxTokens);
    }
    expectCoverage(pieces, text);
    // The header's h-run must survive somewhere, not just the two data rows.
    expect(pieces.some((p) => p.includes("h".repeat(50)))).toBe(true);
  });

  it("preserves the fence markers when no single line can fit alongside the fence wrapper", () => {
    // The wrapper alone (9 chars) fits easily, but no single line of the
    // body can fit alongside it — a smaller instance of the same defect
    // family as the unterminated-fence and oversized-header cases above.
    const openFence = "```ts";
    const closeFence = "```";
    const line = "x".repeat(100);
    const text = `${openFence}\n${line}\n${closeFence}`;
    const maxTokens = 20;

    const pieces = splitToBound(text, maxTokens);

    expect(pieces.length).toBeGreaterThan(0);
    for (const piece of pieces) {
      expect(estimateTokens(piece)).toBeLessThanOrEqual(maxTokens);
    }
    expectCoverage(pieces, text);
    expect(pieces.join("")).toContain(openFence);
    expect(pieces.join("")).toContain(closeFence);
  });

  interface CoverageCase {
    name: string;
    text: string;
  }

  const COVERAGE_CASES: CoverageCase[] = [
    { name: "empty", text: "" },
    { name: "whitespace-only (short)", text: "   \n\n\t  \n   " },
    { name: "whitespace-only (large, no newlines)", text: " ".repeat(1000) },
    { name: "no-whitespace 50,000-char run", text: "z".repeat(50_000) },
    { name: "surrogates only", text: "\u{1F600}".repeat(2000) },
    {
      name: "unterminated fence",
      text: "```js\n" + "const alpha = 1; ".repeat(40),
    },
    {
      name: "nested fences without a blank-line separator",
      text: "```js\nfoo();\n```\n```py\nbar()\n```",
    },
    {
      name: "oversized table header",
      text: `| ${"h".repeat(200)} | b |\n|---|---|\n| p | q |\n| r | s |`,
    },
    {
      name: "oversized single table row",
      text:
        "| Col |\n|---|\n| short-1 |\n" +
        `| ${"x".repeat(300)} |\n` +
        "| short-2 |",
    },
    {
      name: "CRLF prose",
      text:
        "First paragraph line one.\r\nFirst paragraph line two.\r\n\r\n" +
        "Second paragraph line one.\r\nSecond paragraph line two.\r\n\r\n" +
        "Third paragraph line one.\r\nThird paragraph line two.\r\n",
    },
    {
      name: "mixed content (heading, prose, table, fence)",
      text:
        "# Heading\n\n" +
        "An introductory paragraph with a reasonable amount of prose in it today.\n\n" +
        "| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\n" +
        "```ts\nconst z = 1;\nconst y = 2;\n```\n\n" +
        "A closing paragraph that wraps up the mixed-content document nicely today.",
    },
  ];

  const COVERAGE_MAX_TOKENS = [5, 20, 60, 200];

  for (const { name, text } of COVERAGE_CASES) {
    for (const maxTokens of COVERAGE_MAX_TOKENS) {
      it(`holds the bound and coverage invariants for "${name}" at maxTokens=${maxTokens}`, () => {
        const pieces = splitToBound(text, maxTokens);
        for (const piece of pieces) {
          expect(estimateTokens(piece)).toBeLessThanOrEqual(maxTokens);
        }
        expectCoverage(pieces, text);
      });
    }
  }
});
