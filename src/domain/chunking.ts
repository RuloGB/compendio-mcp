import type { Chunk } from "./model.js";
import type { DocOutline, DocSection } from "./outline.js";
import { splitToBound } from "./split-text.js";
import { estimateTokens } from "./tokens.js";

export interface ChunkingOptions {
  minTokens: number;
  maxTokens: number;
}

/**
 * Last-resort chunk heading. Reached only when a document has neither a
 * resolved title nor a path -- unreachable through `FileDocumentSource`, kept
 * so `documentHeading` is total over its type rather than over its current
 * callers.
 */
export const UNTITLED_HEADING = "Untitled document";

/**
 * The heading every chunk of a document falls back to when its own heading
 * path is empty. `title` is the convention-resolved `DocumentMeta.title` (the
 * humanized filename under `loose`); `path` is the docs-relative file path.
 * Enforced once, at the `index-pipeline` seam, via `withNonEmptyHeadings` --
 * not inside `chunkOutline` (design.md Decision 1).
 */
export function documentHeading(title: string, path: string): string {
  return title.trim() || path.trim() || UNTITLED_HEADING;
}

/**
 * Guarantees the invariant: no returned chunk has an empty heading, and every
 * chunk of one document that needed the fallback carries the SAME value --
 * the shared-heading shape `read_doc({ section })` reassembles from
 * (design.md Decision 1/3). A pure post-hoc map, applied once at
 * `transformFile` to the output of both `Chunk[]` producers.
 */
export function withNonEmptyHeadings(chunks: Chunk[], fallback: string): Chunk[] {
  return chunks.map((chunk) => (chunk.heading === "" ? { ...chunk, heading: fallback } : chunk));
}

interface Piece {
  path: string[];
  text: string;
}

function sectionFullText(section: DocSection): string {
  const parts = [section.text, ...section.children.map((c) => sectionFullText(c))];
  return parts.filter((p) => p.trim().length > 0).join("\n\n");
}

/**
 * Chunking policy: split by H2, descend to H3 only when the H2 section
 * exceeds `maxTokens`, then bound every resulting piece via `splitToBound`
 * before merging contiguous tiny pieces (< minTokens).
 *
 * Heading-based descent decides WHERE the coarse cuts land; `splitToBound`
 * guarantees the SIZE bound afterward, on every piece regardless of source
 * (intro, leaf section, or oversized child) -- a table or fenced code block
 * is split across rows/lines, re-wrapping its header/separator or fence
 * markers, rather than staying whole past `maxTokens`. Every chunk carries
 * its full heading path ("H2 > H3"), including split pieces.
 */
export function chunkOutline(outline: DocOutline, opts: ChunkingOptions): Chunk[] {
  const pieces: Piece[] = [];

  if (outline.intro.trim().length > 0) {
    pieces.push({ path: [outline.title], text: outline.intro.trim() });
  }

  for (const section of outline.sections) {
    const full = sectionFullText(section);
    if (estimateTokens(full) <= opts.maxTokens || section.children.length === 0) {
      pieces.push({ path: [section.title], text: full });
      continue;
    }
    if (section.text.trim().length > 0) {
      pieces.push({ path: [section.title], text: section.text.trim() });
    }
    for (const child of section.children) {
      pieces.push({ path: [section.title, child.title], text: sectionFullText(child) });
    }
  }

  const bounded = pieces.flatMap((p) =>
    splitToBound(p.text, opts.maxTokens).map((text) => ({ path: p.path, text })),
  );

  return mergeTinyPieces(bounded, opts).map((piece, position) => ({
    // Empty path segments are dropped before joining: an empty ATX heading
    // (`##`/`###` with no text) is valid CommonMark and reaches here as
    // `title: ""`. Without the filter, ["Parent", ""].join(" > ") yields the
    // malformed but non-empty "Parent > " -- non-empty, so a plain emptiness
    // check at the seam would pass while the value is garbage (design.md
    // Decision 1). A single empty segment ([""]) still collapses to "" here;
    // closing that last mile is `withNonEmptyHeadings`'s job, at the seam.
    heading: piece.path.filter((s) => s.trim().length > 0).join(" > "),
    content: piece.text,
    position,
  }));
}

/**
 * Merges a piece smaller than `minTokens` into the previous one when the
 * combination stays within `maxTokens`. The merged chunk keeps the first
 * heading path; the swallowed section keeps its heading line inside the text,
 * so lexical search still matches it.
 *
 * The guard measures the CANDIDATE joined string, not the sum of the two
 * pieces' individual token estimates: `estimateTokens` is `ceil(len / 4)`,
 * and the merge itself adds two characters (`\n\n`), so `ceil(la/4) +
 * ceil(lb/4)` can be strictly less than `ceil((la + lb + 2) / 4)` -- summing
 * the estimates could pass the guard while the actual merged text lands one
 * token over `maxTokens`.
 */
function mergeTinyPieces(pieces: Piece[], opts: ChunkingOptions): Piece[] {
  const merged: Piece[] = [];
  for (const piece of pieces) {
    const previous = merged[merged.length - 1];
    const tokens = estimateTokens(piece.text);
    if (previous !== undefined && tokens < opts.minTokens) {
      const candidate = `${previous.text}\n\n${piece.text}`;
      if (estimateTokens(candidate) <= opts.maxTokens) {
        previous.text = candidate;
        continue;
      }
    }
    merged.push({ ...piece });
  }
  return merged;
}
