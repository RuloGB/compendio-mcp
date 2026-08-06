import { flattenWithMap, toFlatOffset, type FlatText } from "./flatten-map.js";
import { selectMatchCentre, type MatchSpan } from "./match-location.js";

/**
 * Budget for the lead (rank-1) fragment: large enough to answer the question
 * outright, so no `read_doc` round trip is needed. Capped rather than
 * unbounded because a heading with no subheadings is never split, whatever its
 * size (`chunking.ts`), so "the whole chunk" has no useful worst case.
 */
export const LEAD_EXCERPT_CHARS = 1400;

/**
 * Budget for supporting fragments: enough to judge whether the lead is the
 * right one, not enough to answer from. Together with `path` and the section
 * heading, this is the recovery path when rank 1 misses.
 */
export const SUPPORTING_EXCERPT_CHARS = 120;

// es-frozen: cites the real `ejemplos/` corpus name and its measured eval
// score, not a leftover translation.
/**
 * Excerpt budget by 0-based result rank.
 *
 * A uniform cap loses either way: small enough to keep k results affordable,
 * and therefore too small to answer with. Measured over two corpora, the
 * previous flat 240 truncated ~93% of fragments and withheld ~70% of their
 * content — so `search_docs` paid answer prices for router value, and the
 * follow-up `read_doc` stayed mandatory anyway.
 *
 * Grading by rank resolves it: one fragment carries the answer, the rest carry
 * signposts. This is only sound because the lead usually IS the answer —
 * hybrid retrieval scores MRR 0.943 on `ejemplos/` (top-1 correct 20/22). If
 * that ever regresses, this policy is the first thing to revisit.
 */
export function excerptBudget(rank: number): number {
  return rank === 0 ? LEAD_EXCERPT_CHARS : SUPPORTING_EXCERPT_CHARS;
}

/**
 * Builds the excerpt returned by search: strips heading lines and light
 * markdown syntax, collapses whitespace, and slices a window at most
 * `maxChars` long. Defaults to the supporting budget — an unqualified
 * excerpt is the cheap one.
 *
 * `spans` locate where the query matched, in RAW markdown coordinates (the
 * same string `markdown` is). `[]` (the default) is today's prefix path,
 * byte-identical to before this parameter existed (design.md Decision 6) —
 * this is deliberately also the vector-only path, since a chunk the vector
 * leg found alone has no lexical match to locate (design.md Decision 7).
 *
 * Ordering is fixed by design (a correctness constraint, not a preference):
 * locate in raw -> flatten the WHOLE chunk -> map the offsets -> slice the
 * window in flattened space. Slicing a raw window first and flattening the
 * substring would leak half a fenced code block into the excerpt.
 */
export function buildExcerpt(
  markdown: string,
  maxChars: number = SUPPORTING_EXCERPT_CHARS,
  spans: readonly MatchSpan[] = [],
): string {
  let flat = flattenWithMap(markdown, true);
  // A section whose body is entirely fenced blocks — a templates or examples
  // section — strips to nothing. Returning that empty string is worse than
  // returning code: it spends the rank's budget on silence AND carries no
  // trailing "…", so the tool contract reads it as "complete" and the agent
  // is told not to call read_doc. Keeping the fences is the honest fallback.
  // The map belongs to whichever pass actually produced the text.
  if (flat.text.length === 0) flat = flattenWithMap(markdown, false);
  const text = flat.text;

  if (text.length <= maxChars) return text;

  const flatSpans = mapSpansToFlat(flat, spans);
  if (flatSpans.length === 0) return prefixExcerpt(text, maxChars);

  const centre = selectMatchCentre(flatSpans, maxChars);
  if (centre === null) return prefixExcerpt(text, maxChars);

  const { start, end } = computeWindow(text, centre, maxChars, flatSpans);
  const leading = start > 0 ? "…" : "";
  const trailing = end < text.length ? "…" : "";
  return `${leading}${text.slice(start, end)}${trailing}`;
}

/**
 * Maps raw-coordinate spans into flattened coordinates. A span whose text
 * did not survive flattening (e.g. inside a dropped fenced block) collapses
 * to zero width and is discarded — you cannot centre on text the reader
 * will never see.
 */
function mapSpansToFlat(flat: FlatText, spans: readonly MatchSpan[]): MatchSpan[] {
  return spans
    .map((span) => ({
      start: toFlatOffset(flat, span.start),
      end: toFlatOffset(flat, span.end),
      term: span.term,
    }))
    .filter((span) => span.end > span.start);
}

/**
 * Today's prefix behaviour, unchanged: cut at `maxChars`, snap back to the
 * last word boundary if it falls past the halfway point, and append a
 * trailing ellipsis. No leading ellipsis — a prefix always starts at 0.
 */
function prefixExcerpt(text: string, maxChars: number): string {
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > maxChars / 2 ? lastSpace : maxChars)}…`;
}

/**
 * Clamps a `maxChars`-wide window around `centre`, then snaps both edges to
 * a word boundary (design.md Decision 5). Snapping only ever shrinks the
 * window, so `end - start <= maxChars` always holds; ellipses are added on
 * top, so the final length is at most `maxChars + 2`.
 *
 * The snap-revert guard: a snap that would push any span visible in the
 * pre-snap window outside `[start, end)` is reverted — word-boundary
 * snapping can never hide the match it was centred on.
 */
function computeWindow(
  text: string,
  centre: number,
  maxChars: number,
  flatSpans: readonly MatchSpan[],
): { start: number; end: number } {
  const maxStart = Math.max(0, text.length - maxChars);
  let start = clamp(centre - Math.floor(maxChars / 2), 0, maxStart);
  let end = Math.min(start + maxChars, text.length);

  const visible = flatSpans.filter((span) => span.start < end && span.end > start);
  const clusterStart = visible.length > 0 ? Math.min(...visible.map((span) => span.start)) : centre;
  const clusterEnd = visible.length > 0 ? Math.max(...visible.map((span) => span.end)) : centre;

  if (start > 0) {
    const firstSpace = text.indexOf(" ", start);
    const half = start + Math.floor((end - start) / 2);
    if (firstSpace !== -1 && firstSpace < end && firstSpace <= half) {
      const candidateStart = firstSpace + 1;
      if (candidateStart <= clusterStart) start = candidateStart;
    }
  }

  if (end < text.length) {
    const lastSpace = text.lastIndexOf(" ", end - 1);
    const half = start + Math.ceil((end - start) / 2);
    if (lastSpace !== -1 && lastSpace >= start && lastSpace > half) {
      const candidateEnd = lastSpace;
      if (candidateEnd >= clusterEnd) end = candidateEnd;
    }
  }

  return { start, end };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
