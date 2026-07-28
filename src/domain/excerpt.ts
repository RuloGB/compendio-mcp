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
 * markdown syntax, collapses whitespace, and cuts at a word boundary.
 * Defaults to the supporting budget — an unqualified excerpt is the cheap one.
 */
export function buildExcerpt(markdown: string, maxChars: number = SUPPORTING_EXCERPT_CHARS): string {
  const dense = flatten(markdown, true);
  // A section whose body is entirely fenced blocks — a templates or examples
  // section — strips to nothing. Returning that empty string is worse than
  // returning code: it spends the rank's budget on silence AND carries no
  // trailing "…", so the tool contract reads it as "complete" and the agent
  // is told not to call read_doc. Keeping the fences is the honest fallback.
  const text = dense.length > 0 ? dense : flatten(markdown, false);

  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > maxChars / 2 ? lastSpace : maxChars)}…`;
}

/**
 * Collapses markdown to a single plain-text line. Heading lines always go;
 * fenced blocks go only when `dropFencedBlocks` is set, so the caller can
 * retry without that rule when it strips a section down to nothing.
 */
function flatten(markdown: string, dropFencedBlocks: boolean): string {
  const withoutHeadings = markdown
    .split("\n")
    .filter((line) => !/^\s*#{1,6}\s/.test(line))
    .join(" ");
  const body = dropFencedBlocks
    ? withoutHeadings.replace(/```[^`]*```/g, " ")
    : withoutHeadings;
  return body
    .replace(/[`*_>|]/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
