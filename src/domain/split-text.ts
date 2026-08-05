import { estimateTokens } from "./tokens.js";

/**
 * Splitter policy for bounding oversized text: paragraph/line -> sentence ->
 * word -> code point, each level packing greedily (accumulate while the
 * joined candidate still fits, flush when it does not) and recursing only
 * into a single unit that alone still exceeds the bound. Tables and fenced
 * code blocks re-wrap their structural preamble (header+separator, or the
 * opening/closing fence) on every piece; when even that minimal preamble
 * cannot fit alongside the offending row/line, the bound wins and that one
 * unit is handed to the cascade as plain text, with no preamble.
 *
 * `estimateTokens(s) <= maxTokens` holds for every returned string, for any
 * input — the fixed-width code-point level (the cascade's last resort) has
 * no boundary requirement to fall back on, so it cannot fail to produce a
 * bounded piece.
 */
export function splitToBound(text: string, maxTokens: number): string[] {
  if (estimateTokens(text) <= maxTokens) return [text];
  return splitBlocks(text, maxTokens);
}

/** Abbreviations after which a period never ends a sentence, even when
 * followed by whitespace and an uppercase letter. */
const SENTENCE_ABBREVIATIONS = new Set([
  "sr",
  "sra",
  "srta",
  "dr",
  "dra",
  "ud",
  "uds",
  "art",
  "núm",
  "pág",
  "cap",
  "fig",
  "tab",
  "ej",
  "p",
  "etc",
  "vs",
]);

/** Generic greedy packer shared by every boundary-based cascade level:
 * accumulate units while the joined candidate stays within `maxTokens`,
 * flush when it does not, and recurse into a single unit still over the
 * bound via `splitOversized`. */
function packUnits(
  units: string[],
  joiner: string,
  maxTokens: number,
  splitOversized: (unit: string) => string[],
): string[] {
  const pieces: string[] = [];
  let current = "";

  for (const unit of units) {
    const candidate = current === "" ? unit : `${current}${joiner}${unit}`;
    if (estimateTokens(candidate) <= maxTokens) {
      current = candidate;
      continue;
    }
    if (current !== "") {
      pieces.push(current);
      current = "";
    }
    if (estimateTokens(unit) <= maxTokens) {
      current = unit;
    } else {
      pieces.push(...splitOversized(unit));
    }
  }
  if (current !== "") pieces.push(current);
  return pieces;
}

// --- Level 1: blocks (blank-line separated, fence-aware) -------------------

function splitBlocks(text: string, maxTokens: number): string[] {
  const blocks = splitIntoBlocksFenceAware(text);
  return packUnits(blocks, "\n\n", maxTokens, (block) => splitOversizedBlock(block, maxTokens));
}

function isFenceDelimiter(line: string): boolean {
  return /^\s*(```|~~~)/.test(line);
}

/** Splits on blank lines like a normal paragraph splitter, except a blank
 * line encountered while inside a fenced code block is content, not a block
 * boundary — a fence is always kept as one unit. */
function splitIntoBlocksFenceAware(text: string): string[] {
  const lines = text.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;

  for (const line of lines) {
    if (isFenceDelimiter(line)) inFence = !inFence;
    if (line.trim() === "" && !inFence) {
      if (current.length > 0) {
        blocks.push(current.join("\n"));
        current = [];
      }
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) blocks.push(current.join("\n"));
  return blocks;
}

// --- Level 2: structural rows (table / fenced code) -----------------------

function splitOversizedBlock(block: string, maxTokens: number): string[] {
  if (isFencedCodeBlock(block)) return splitFence(block, maxTokens);
  if (isMarkdownTable(block)) return splitTable(block, maxTokens);
  return splitLines(block, maxTokens);
}

/** True only for a genuinely terminated fence: the block's first AND last
 * line both look like a fence delimiter. An opening delimiter with no
 * matching closer (a common shape in hand-edited or generated markdown)
 * cannot be re-wrapped by `splitFence` — its last "line" would just be
 * arbitrary content, not a real closing fence — so it is treated as
 * ordinary text instead (`splitLines`), which is lossless. */
function isFencedCodeBlock(block: string): boolean {
  const lines = block.split("\n");
  if (lines.length < 2) return false;
  return isFenceDelimiter(lines[0]!) && isFenceDelimiter(lines[lines.length - 1]!);
}

function isMarkdownTable(block: string): boolean {
  const lines = block.split("\n");
  if (lines.length < 2) return false;
  return lines[0]!.trimStart().startsWith("|") && isSeparatorRow(lines[1]!);
}

function isSeparatorRow(line: string): boolean {
  return line.includes("-") && /^\s*\|?[\s:|-]+\|?\s*$/.test(line);
}

/** Splits a markdown table across row boundaries, re-emitting the header and
 * separator on every piece (the preamble, charged against the bound like any
 * other content). When even header+separator+one row cannot fit, the bound
 * wins: that row is handed to the cascade as ordinary text, with no
 * preamble, while the table's other rows keep theirs. The header and
 * separator are themselves content, though — if NO row ever ends up sharing
 * them (every row overflows the preamble individually, or the preamble
 * alone already exceeds the bound, as with an oversized header column),
 * they must still be emitted, split further by the cascade if needed,
 * rather than silently vanishing. */
function splitTable(block: string, maxTokens: number): string[] {
  const lines = block.split("\n");
  const header = lines[0]!;
  const separator = lines[1]!;
  const rows = lines.slice(2);
  const preamble = `${header}\n${separator}`;

  const pieces: string[] = [];
  let current: string[] = [];
  let preambleEmitted = false;

  const flush = () => {
    if (current.length === 0) return;
    pieces.push(`${preamble}\n${current.join("\n")}`);
    preambleEmitted = true;
    current = [];
  };

  for (const row of rows) {
    const candidateRows = [...current, row];
    const candidate = `${preamble}\n${candidateRows.join("\n")}`;
    if (estimateTokens(candidate) <= maxTokens) {
      current = candidateRows;
      continue;
    }
    flush();
    const soloCandidate = `${preamble}\n${row}`;
    if (estimateTokens(soloCandidate) <= maxTokens) {
      current = [row];
    } else {
      pieces.push(...splitLines(row, maxTokens));
    }
  }
  flush();

  if (!preambleEmitted) {
    return [...splitLines(preamble, maxTokens), ...pieces];
  }
  return pieces;
}

/** Splits a fenced code block across line boundaries, re-emitting the
 * opening fence (with its info string) and the closing fence on every
 * piece. Same bound-wins precedence as the table rule when a single line
 * cannot fit alongside the fence wrapper — and the same anti-vanishing
 * guarantee: if no line ever ends up sharing the wrapper, the fence markers
 * are still emitted (split further if needed) instead of disappearing. */
function splitFence(block: string, maxTokens: number): string[] {
  const lines = block.split("\n");
  const openFence = lines[0]!;
  const closeFence = lines[lines.length - 1]!;
  const innerLines = lines.slice(1, -1);

  const pieces: string[] = [];
  let current: string[] = [];
  let preambleEmitted = false;

  const flush = () => {
    if (current.length === 0) return;
    pieces.push([openFence, ...current, closeFence].join("\n"));
    preambleEmitted = true;
    current = [];
  };

  for (const line of innerLines) {
    const candidateLines = [...current, line];
    const candidate = [openFence, ...candidateLines, closeFence].join("\n");
    if (estimateTokens(candidate) <= maxTokens) {
      current = candidateLines;
      continue;
    }
    flush();
    const soloCandidate = [openFence, line, closeFence].join("\n");
    if (estimateTokens(soloCandidate) <= maxTokens) {
      current = [line];
    } else {
      pieces.push(...splitLines(line, maxTokens));
    }
  }
  flush();

  if (!preambleEmitted) {
    // Unlike a table's header+separator (which always precede every row),
    // a fence's wrapper spans BOTH ends of the content — the opening fence
    // before it, the closing fence after. Emitting them as one combined
    // unit up front (as the table branch does) would bunch both markers
    // before the content and corrupt source order; they must be emitted
    // as separate pieces, open first and close last.
    return [...splitLines(openFence, maxTokens), ...pieces, ...splitLines(closeFence, maxTokens)];
  }
  return pieces;
}

// --- Level 3: lines ---------------------------------------------------------

function splitLines(text: string, maxTokens: number): string[] {
  const lines = text.split("\n");
  return packUnits(lines, "\n", maxTokens, (line) => splitSentences(line, maxTokens));
}

// --- Level 4: sentences (Spanish-aware) ------------------------------------

const UPPERCASE_RE = /\p{Lu}/u;

function isSentenceStart(char: string): boolean {
  return char === "¿" || char === "¡" || UPPERCASE_RE.test(char);
}

/** True when the word immediately before the period at `periodIndex` is a
 * single letter (an initial, e.g. "J.") or one of the declared Spanish
 * abbreviations — either case means the period does not end a sentence. */
function isAbbreviation(text: string, periodIndex: number): boolean {
  const before = text.slice(0, periodIndex);
  const wordMatch = /(\p{L}+)\s*$/u.exec(before);
  if (!wordMatch) return false;
  const word = wordMatch[1]!;
  if (word.length === 1) return true;
  return SENTENCE_ABBREVIATIONS.has(word.toLowerCase());
}

/** Sentence boundary: [.!?…], optionally followed by a closer, then
 * whitespace, then an uppercase letter, ¿, or ¡ — with the abbreviation
 * guard above suppressing false positives. */
function extractSentences(text: string): string[] {
  const boundaryRegex = /[.!?…]+["'»)]?(?=\s)/gu;
  const sentences: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = boundaryRegex.exec(text)) !== null) {
    const punctuationEnd = match.index + match[0].length;
    const rest = text.slice(punctuationEnd);
    const followerWhitespace = /^\s+/.exec(rest);
    if (!followerWhitespace) continue;
    const followerChar = rest[followerWhitespace[0].length];
    if (followerChar === undefined || !isSentenceStart(followerChar)) continue;
    if (isAbbreviation(text, match.index)) continue;

    sentences.push(text.slice(lastIndex, punctuationEnd));
    lastIndex = punctuationEnd + followerWhitespace[0].length;
  }
  sentences.push(text.slice(lastIndex));
  return sentences.filter((s) => s.length > 0);
}

function splitSentences(text: string, maxTokens: number): string[] {
  const sentences = extractSentences(text);
  return packUnits(sentences, " ", maxTokens, (s) => splitWords(s, maxTokens));
}

// --- Level 5: words ----------------------------------------------------------

function splitWords(text: string, maxTokens: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  return packUnits(words, " ", maxTokens, (word) => splitCodePoints(word, maxTokens));
}

// --- Level 6: code points (terminal, surrogate-safe) -----------------------

/** Fixed-width code-point packing: the last, unconditional level. Iterating
 * via the string's code-point iterator (not `.split("")`, which is a UTF-16
 * code-unit split) guarantees a surrogate pair is never torn apart. Packing
 * is measured the same way as every other level (`estimateTokens`), so the
 * bound holds exactly even when astral characters are present. */
function splitCodePoints(text: string, maxTokens: number): string[] {
  const pieces: string[] = [];
  let current = "";

  for (const codePoint of text) {
    const candidate = current + codePoint;
    if (estimateTokens(candidate) <= maxTokens) {
      current = candidate;
    } else {
      if (current !== "") pieces.push(current);
      current = codePoint;
    }
  }
  if (current !== "") pieces.push(current);
  return pieces;
}
