import type { Chunk } from "./model.js";
import type { DocOutline, DocSection } from "./outline.js";
import { estimateTokens } from "./tokens.js";

export interface ChunkingOptions {
  minTokens: number;
  maxTokens: number;
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
 * exceeds `maxTokens`, then merge contiguous tiny pieces (< minTokens).
 *
 * Splitting only ever happens at heading boundaries, so tables are never cut
 * in half: a section holding a large table stays whole even if it exceeds the
 * maximum. Every chunk carries its full heading path ("H2 > H3").
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

  return mergeTinyPieces(pieces, opts).map((piece, position) => ({
    heading: piece.path.join(" > "),
    content: piece.text,
    position,
  }));
}

/**
 * Merges a piece smaller than `minTokens` into the previous one when the
 * combination stays within `maxTokens`. The merged chunk keeps the first
 * heading path; the swallowed section keeps its heading line inside the text,
 * so lexical search still matches it.
 */
function mergeTinyPieces(pieces: Piece[], opts: ChunkingOptions): Piece[] {
  const merged: Piece[] = [];
  for (const piece of pieces) {
    const previous = merged[merged.length - 1];
    const tokens = estimateTokens(piece.text);
    if (
      previous !== undefined &&
      tokens < opts.minTokens &&
      estimateTokens(previous.text) + tokens <= opts.maxTokens
    ) {
      previous.text = `${previous.text}\n\n${piece.text}`;
    } else {
      merged.push({ ...piece });
    }
  }
  return merged;
}
