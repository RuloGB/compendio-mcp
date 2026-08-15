/**
 * Reimplements `excerpt.ts`'s markdown-to-plain-text flatten chain as six
 * tracked transforms, each carrying forward a per-character map back to the
 * raw markdown that produced the flattened text (design.md Decision 3).
 *
 * This is the highest-risk logic in the change: a silent off-by-N here
 * centres an excerpt on the wrong text and no test fails by default. The
 * invariants below (I1-I4) make that failure mode mechanically checkable
 * instead of something that has to be argued.
 */

import { isFenceDelimiter } from "./split-text.js";

export interface FlatText {
  text: string;
  /**
   * map[i] = offset in the raw markdown of the character that produced
   * text[i]. Length equals text.length (I1); non-decreasing (I2); every
   * emitted non-space character was copied verbatim from raw at that offset,
   * and every synthesized character is a space (I3).
   */
  map: readonly number[];
}

/**
 * Reimplements today's `flatten()` chain (`excerpt.ts:61-74`) in the same
 * order, tracking a raw-offset map alongside the text at every step.
 */
export function flattenWithMap(markdown: string, dropFencedBlocks: boolean): FlatText {
  // S1: split("\n").filter(heading).join(" ")
  let flat = stripHeadingLines(markdown);

  // S2: .replace(/```[^`]*```/g, " ") — conditional
  if (dropFencedBlocks) {
    flat = trackedReplace(flat, /```[^`]*```/g, (m) => singleSpaceAt(flat, m.index));
  }

  // S3: .replace(/[`*_>|]/g, " ") — 1:1, offsets unchanged
  flat = trackedReplace(flat, /[`*_>|]/g, (m) => singleSpaceAt(flat, m.index));

  // S4: .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") — replacement carries its
  // own raw offsets, a contiguous slice of the match's capture group 1.
  flat = trackedReplace(flat, /\[([^\]]*)\]\([^)]*\)/g, (m) => linkTextReplacement(flat, m));

  // S5: .replace(/\s+/g, " ") — each run collapses to one space mapped to
  // the run's first offset.
  flat = trackedReplace(flat, /\s+/g, (m) => singleSpaceAt(flat, m.index));

  // S6: .trim() — drop leading/trailing whitespace, slicing map identically.
  return trimFlat(flat);
}

/**
 * Least i with map[i] >= rawOffset, or text.length when none exists. map is
 * non-decreasing (I2), so binary search applies. A raw position that was
 * destroyed by flattening (e.g. inside a stripped heading line) resolves to
 * the nearest surviving position after it.
 */
export function toFlatOffset(flat: FlatText, rawOffset: number): number {
  const map = flat.map;
  let lo = 0;
  let hi = map.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (map[mid]! >= rawOffset) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return lo;
}

/** Anchor-free and prefix-only, deliberately: `split("\n")` leaves a trailing
 * `\r` on every line of a CRLF document, and `.` never matches it. Adding a
 * `$` here would silently stop matching every heading on
 * `docs/documentation-convention.md`. See read-document.ts:120-138. Stateless
 * (no `g` flag), so module scope is safe — unlike trackedReplace's regexes,
 * which are cloned at :117-118 precisely because they carry `lastIndex`. */
const HEADING_LINE_PREFIX = /^\s*#{1,6}\s/;

/**
 * S1: drops heading lines (`HEADING_LINE_PREFIX`) OUTSIDE any fenced code
 * block, joining the kept lines with a single space. A heading-pattern line
 * INSIDE a balanced fence (chunk-local fence-delimiter-line count is even —
 * design.md Decision 1) is author-written content, not a real heading, so it
 * is kept. An unbalanced (odd-count) chunk means the fence begins or ends
 * mid-chunk; fence state cannot be trusted there, so every heading-pattern
 * line is still stripped, exactly as before this fence-awareness existed.
 *
 * Fence delimiter lines themselves are ALWAYS kept, never dropped — S2 (the
 * caller's next step) needs both delimiters of a pair present in this
 * function's OWN output to recognize and drop a fence at all (design.md
 * Decision 2). Every kept line character keeps its own raw offset; the
 * separator space between two consecutive kept lines maps to the raw offset
 * of the line that FOLLOWS it, per design.md's S1 row.
 */
function stripHeadingLines(markdown: string): FlatText {
  const lines = markdown.split("\n");
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1; // +1 accounts for the removed "\n"
  }

  // Chunk-local fence state, trusted only when the delimiter count is even.
  const balanced = lines.filter(isFenceDelimiter).length % 2 === 0;

  const chars: string[] = [];
  const map: number[] = [];
  let emittedAnyLine = false;
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (isFenceDelimiter(line)) {
      if (balanced) inFence = !inFence;
      // NO `continue` — a delimiter line is CONTENT here. See D2.
    } else if (!inFence && HEADING_LINE_PREFIX.test(line)) {
      continue;
    }
    if (emittedAnyLine) {
      chars.push(" ");
      map.push(lineStarts[i]!);
    }
    const lineStart = lineStarts[i]!;
    for (let j = 0; j < line.length; j++) {
      chars.push(line[j]!);
      map.push(lineStart + j);
    }
    emittedAnyLine = true;
  }
  return { text: chars.join(""), map };
}

/**
 * Shared helper for S2/S3/S5: runs `regex` (global) over `flat.text`,
 * replacing each match with the `replacement`'s tracked text+map, and
 * copying every unmatched character through with its original map entry.
 */
function trackedReplace(
  flat: FlatText,
  regex: RegExp,
  replacement: (match: RegExpExecArray) => { text: string; map: readonly number[] },
): FlatText {
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  const re = new RegExp(regex.source, flags);
  const chars: string[] = [];
  const map: number[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(flat.text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    for (let i = lastIndex; i < start; i++) {
      chars.push(flat.text[i]!);
      map.push(flat.map[i]!);
    }
    const rep = replacement(match);
    for (let i = 0; i < rep.text.length; i++) {
      chars.push(rep.text[i]!);
      map.push(rep.map[i]!);
    }
    lastIndex = end;
    if (match[0].length === 0) re.lastIndex++;
  }
  for (let i = lastIndex; i < flat.text.length; i++) {
    chars.push(flat.text[i]!);
    map.push(flat.map[i]!);
  }
  return { text: chars.join(""), map };
}

/** A matched run collapses to one space, mapped to the match's first raw offset. */
function singleSpaceAt(flat: FlatText, matchIndex: number): { text: string; map: readonly number[] } {
  return { text: " ", map: [flat.map[matchIndex]!] };
}

/**
 * S4's replacement: capture group 1 (the link text), carried with its own
 * raw offsets — a contiguous slice of `flat.map` at the capture group's
 * position within `flat.text`. Capture group 1 starts exactly one character
 * after the match ("[" is a single literal character in the regex).
 */
function linkTextReplacement(
  flat: FlatText,
  match: RegExpExecArray,
): { text: string; map: readonly number[] } {
  const capture = match[1] ?? "";
  const captureStart = match.index + 1;
  return { text: capture, map: flat.map.slice(captureStart, captureStart + capture.length) };
}

/** S6: `.trim()`, slicing `map` identically to the text. */
function trimFlat(flat: FlatText): FlatText {
  let start = 0;
  let end = flat.text.length;
  while (start < end && isWhitespace(flat.text[start]!)) start++;
  while (end > start && isWhitespace(flat.text[end - 1]!)) end--;
  return { text: flat.text.slice(start, end), map: flat.map.slice(start, end) };
}

function isWhitespace(ch: string): boolean {
  return /\s/.test(ch);
}
