import type { DocumentMeta, IndexedChunk, IndexedDocument } from "../domain/model.js";
import type { IndexStore } from "../domain/ports.js";
import { closestMatches, normalize } from "../domain/similarity.js";
import { isFenceDelimiter } from "../domain/split-text.js";
import { tokensForLength } from "../domain/tokens.js";

export interface ReadRequest {
  path: string;
  section?: string;
}

/**
 * One row of a large-document outline (design.md revision 1, "R1"-"R5").
 * `heading` is the exact heading-line text, passed back verbatim as
 * `section` to resolve that row (round-trip guarantee). `tokens` is D2's
 * per-row size: exactly what requesting this heading as `section` would
 * return.
 *
 * `occurrences` is the count of H2/H3 lines, document-wide, sharing this
 * row's normalized title (R1); the `xN` render clause fires iff this is > 1.
 * `includesOtherContent` (R3, renamed from revision 0's `overlapsOtherSection`)
 * is true iff the row's `section` response includes content outside the
 * union of its own pooled heading occurrences' spans. `addressable` (D4) is
 * deliberately absent -- it is an internal gate value used once, while
 * deciding whether the outline replaces the `document` variant at all, and
 * is never exposed to the agent (design.md's explicit non-guarantee).
 */
export interface OutlineSection {
  heading: string;
  tokens: number;
  occurrences: number;
  oversized: boolean;
  includesOtherContent: boolean;
  children: OutlineSection[];
}

/** R4's degradation ladder outcome: which rows had to be left out, and why. */
export type OutlineOmission =
  | { kind: "none" }
  | { kind: "subheadings"; hidden: number }
  | { kind: "truncated"; shown: number; total: number };

export type ReadResult =
  | { type: "document"; meta: DocumentMeta; content: string }
  | { type: "section"; meta: DocumentMeta; section: string; content: string }
  | {
      type: "outline";
      meta: DocumentMeta;
      tokens: number;
      sections: OutlineSection[];
      repeated: OutlineSection[];
      omitted: OutlineOmission;
    }
  | { type: "path-not-found"; path: string; suggestions: string[] }
  | {
      type: "section-not-found";
      meta: DocumentMeta;
      section: string;
      availableSections: string[];
    }
  | { type: "no-sections"; meta: DocumentMeta; section: string };

const SUGGESTION_LIMIT = 3;

/** Above this estimated-token size, a document with 2+ addressable H2/H3
 * headings returns an outline instead of its full body (design.md D5). */
export const OUTLINE_THRESHOLD_TOKENS = 6000;

/** R4's D4 gate cap: the addressable-row gate never evaluates more than this
 * many candidates (in pinned document-position order) before falling back to
 * `document`, bounding worst-case gate cost independently of document size. */
export const MAX_GATE_CANDIDATES = 2000;

/** R4: the rendered outline's rows are bounded to this many characters,
 * regardless of document heading count. Combined with the fixed header,
 * legend and notice text, this yields the ~2,300 estimated-token ceiling
 * (design.md Acceptance budgets). */
export const OUTLINE_ROWS_BUDGET_CHARS = 8000;

/**
 * Reads a full document or a single section from the index. A broken path
 * never returns a bare error: it answers with the 3 closest paths so an agent
 * following a stale link can recover on its own.
 */
export class ReadDocument {
  constructor(private readonly store: IndexStore) {}

  /**
   * Resolves a requested path, tolerating one leading directory segment.
   *
   * Indexed paths are relative to the docs directory (`func/x.md`), but a
   * caller that just saw the file on disk holds the project-relative path
   * (`docs/func/x.md`). Both name exactly one document, so rejecting the second
   * buys nothing: observed agents spend a failed call per document and then
   * retry with the prefix stripped, doubling every read in a session.
   *
   * Only attempted when the literal path misses, and only one segment deep, so
   * a genuine document at `a/b.md` always wins over stripping into `b.md`.
   */
  private resolve(path: string): IndexedDocument | null {
    const exact = this.store.getDocumentByPath(path);
    if (exact !== null) return exact;
    const separator = path.indexOf("/");
    if (separator === -1) return null;
    return this.store.getDocumentByPath(path.slice(separator + 1));
  }

  execute(request: ReadRequest): ReadResult {
    const doc = this.resolve(request.path);
    if (doc === null) {
      const paths = this.store.listDocuments().map((d) => d.path);
      return {
        type: "path-not-found",
        path: request.path,
        suggestions: closestMatches(request.path, paths, SUGGESTION_LIMIT),
      };
    }

    const chunks = this.store.getChunksByDocument(doc.id);
    if (request.section === undefined || request.section.trim().length === 0) {
      // Position order is pinned once here and reused by every downstream
      // step (occurrence table, matcher, R3's ownership walk) -- design.md
      // Technical Approach: "one pinned order, never store order".
      const sorted = [...chunks].sort((a, b) => a.position - b.position);
      const chunkLengths = sorted.map((c) => c.content.length);

      // Arithmetic length of the `document` variant's content, without
      // building the string (design.md Data Flow, R5): sum of chunk lengths,
      // "\n\n" separators between them, and a restored "# title" line only
      // when the joined text would not already start with one.
      const needsTitle = !(sorted[0]?.content.startsWith("# ") ?? false);
      const joinLen = chunkLengths.reduce((a, b) => a + b, 0) + Math.max(0, sorted.length - 1) * 2;
      const docLen = joinLen + (needsTitle ? doc.title.length + 4 : 0);
      const tokens = tokensForLength(docLen);

      if (tokens > OUTLINE_THRESHOLD_TOKENS) {
        const outline = buildOutline(sorted, chunkLengths, tokens);
        if (outline !== null) {
          return {
            type: "outline",
            meta: doc,
            tokens,
            sections: outline.sections,
            repeated: outline.repeated,
            omitted: outline.omitted,
          };
        }
      }

      const body = sorted.map((c) => c.content).join("\n\n");
      const content = body.startsWith("# ") ? body : `# ${doc.title}\n\n${body}`;
      return { type: "document", meta: doc, content };
    }

    // A section may live merged inside a bigger chunk (small sections are
    // fused at indexing time), so match both the chunk heading path and the
    // heading lines inside its content. `sectionMatcher` is the single
    // source of this predicate: the outline builder (buildOutline) calls the
    // exact same function, so a row's D2 size and its round-trip resolution
    // can never diverge from what this branch itself would return.
    const matching = sectionMatcher(chunks).match(request.section);
    if (matching.length === 0) {
      // Empty members are excluded on the way in: a stored `heading: ""`
      // (an unreindexed, pre-fix corpus -- design.md Decision 4) must never
      // surface as an "available" section to request. When that leaves
      // nothing at all, there is genuinely nothing to list.
      const available = new Set<string>();
      for (const chunk of chunks) {
        if (chunk.heading !== "") available.add(chunk.heading);
        for (const heading of headingsIn(chunk.content)) {
          if (heading !== "") available.add(heading);
        }
      }
      if (available.size === 0) {
        return { type: "no-sections", meta: doc, section: request.section };
      }
      return {
        type: "section-not-found",
        meta: doc,
        section: request.section,
        availableSections: [...available],
      };
    }
    return {
      type: "section",
      meta: doc,
      section: request.section,
      content: matching.map((c) => c.content).join("\n\n"),
    };
  }
}

/** H2-H6 only. H1 is the document TITLE, not an addressable section:
 * `execute` re-attaches it above and the parser routes the first H1 to
 * `outline.title`. Widening to `#{1,6}` would offer every document's own
 * title as a "section" -- a new defect, not a wider fix.
 *
 * **Measured deviation from design.md's literal spec (`/^#{2,6}\s+(.+)$/`,
 * no trailing `\r?`).** `\r?` before `$` is load-bearing on CRLF documents
 * (AGENTS.md "DO NOT CHANGE": without it, `(.+)` (which never matches `\r`)
 * leaves a trailing `\r` unconsumed and the whole line fails to match).
 */
const HEADING_LINE = /^#{2,6}\s+(.+)\r?$/;

/** One scanned H2-H6 heading line: `level` (2-6) and `title` (trimmed, no
 * trailing `\r`). */
interface HeadingLine {
  level: number;
  title: string;
}

function headingLinesIn(markdown: string): HeadingLine[] {
  const lines = markdown.split("\n");
  const balanced = lines.filter(isFenceDelimiter).length % 2 === 0;

  const result: HeadingLine[] = [];
  let inFence = false;
  for (const line of lines) {
    if (isFenceDelimiter(line)) {
      // A delimiter line is neither content nor a heading: toggle, then skip
      // it. HEADING_LINE and isFenceDelimiter are disjoint patterns, so this
      // ordering is observationally identical to the chunker's toggle-then-
      // test one (design.md, findings table).
      if (balanced) inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = HEADING_LINE.exec(line);
    if (match !== null) {
      const level = /^#+/.exec(line)![0].length;
      result.push({ level, title: match[1]!.trim() });
    }
  }
  return result;
}

/**
 * Titles of the H2-H6 heading lines a markdown fragment declares, excluding
 * any that sit inside a fenced code block.
 *
 * Fence state is CHUNK-LOCAL -- this receives one chunk's content, never the
 * document -- so suppression applies only when the fragment's delimiters are
 * BALANCED. An odd count means the fragment begins or ends mid-fence and its
 * state cannot be reconstructed from the fragment alone; toggling on a guess
 * inverts it after a stray CLOSING delimiter and hides a REAL heading. Not
 * suppressing merely reproduces the pre-fix behaviour for that fragment,
 * which is recoverable. design.md Decision 3/4.
 *
 * `isFenceDelimiter` is the chunker's own predicate (`domain/split-text.ts`)
 * and NOT a stricter CommonMark scanner, on purpose: `read_doc` agreeing with
 * the boundaries the indexer produced matters more than either being
 * individually more correct. design.md Decision 1.
 *
 * Deliberately returns EVERY H2-H6 title (not filtered to H2/H3): section
 * lookup and `section-not-found`'s listing both rely on H4+ titles too. Only
 * the outline builder (`buildOutline`) filters to H2/H3 rows (design.md D1).
 */
function headingsIn(markdown: string): string[] {
  return headingLinesIn(markdown).map((h) => h.title);
}

/**
 * Single predicate shared by the `section` branch of `execute` and the
 * outline builder (design.md D3): normalizes each chunk's heading path and
 * content-embedded heading lines once, then matches a requested section
 * against either. `matchIndices` is R5's index-returning form: the outline
 * builder consumes chunk indices and precomputed `chunkLengths` directly,
 * never a joined content string.
 */
function sectionMatcher(chunks: IndexedChunk[]): {
  match(section: string): IndexedChunk[];
  matchIndices(section: string): number[];
} {
  const normalizedHeadings = chunks.map((c) => normalize(c.heading));
  const headingLinesPerChunk = chunks.map((c) => headingsIn(c.content).map(normalize));

  function matchIndices(section: string): number[] {
    const wanted = normalize(section);
    const result: number[] = [];
    for (let i = 0; i < chunks.length; i++) {
      if (normalizedHeadings[i]!.includes(wanted) || headingLinesPerChunk[i]!.some((h) => h.includes(wanted))) {
        result.push(i);
      }
    }
    return result;
  }

  return {
    matchIndices,
    match: (section) => matchIndices(section).map((i) => chunks[i]!),
  };
}

// --- R1: occurrence table -------------------------------------------------

/** One H2/H3 heading line, document-wide, in the pinned `position`-then-scan
 * order (design.md R3). `k` is this occurrence's global ordinal -- the unit
 * R3's ownership math uses, since `IndexedChunk` carries no source line
 * number. `parentNorm` is the normalized title of the nearest preceding H2
 * (document-wide, across chunks); `null` for an H2 itself or an orphan H3
 * before any H2. */
interface Occurrence {
  k: number;
  level: 2 | 3;
  title: string;
  norm: string;
  chunkIndex: number;
  parentNorm: string | null;
}

interface OccurrenceTable {
  occurrences: Occurrence[];
  /** Per chunk index: the occurrence `k` this chunk's content starts with
   * (its own first heading line), or -- for a heading-less chunk -- the
   * nearest preceding occurrence inherited from an earlier chunk.
   * `undefined` only for a chunk that precedes every occurrence in the walk
   * (design.md R3 worked example (d)). */
  firstOwner: (number | undefined)[];
  /** Same as `firstOwner`, but this chunk's own LAST heading line (or the
   * same inherited/undefined value). */
  lastOwner: (number | undefined)[];
  /** `endOf[k]`: the first occurrence index `> k` whose level is `<= level[k]`
   * (design.md R3), or `occurrences.length` (open-ended) if none exists. An
   * H3's own span always ends at the very next occurrence, of any level. */
  endOf: number[];
}

function buildOccurrenceTable(sorted: IndexedChunk[]): OccurrenceTable {
  const occurrences: Occurrence[] = [];
  const perChunkOccurrences: number[][] = sorted.map(() => []);
  let currentH2Norm: string | null = null;

  sorted.forEach((chunk, chunkIndex) => {
    for (const h of headingLinesIn(chunk.content)) {
      if (h.level !== 2 && h.level !== 3) continue;
      if (h.title === "") continue;
      const level = h.level as 2 | 3;
      const norm = normalize(h.title);
      const parentNorm = level === 2 ? null : currentH2Norm;
      const k = occurrences.length;
      occurrences.push({ k, level, title: h.title, norm, chunkIndex, parentNorm });
      perChunkOccurrences[chunkIndex]!.push(k);
      if (level === 2) currentH2Norm = norm;
    }
  });

  const firstOwner: (number | undefined)[] = new Array(sorted.length);
  const lastOwner: (number | undefined)[] = new Array(sorted.length);
  let carry: number | undefined;
  for (let ci = 0; ci < sorted.length; ci++) {
    const idxs = perChunkOccurrences[ci]!;
    if (idxs.length > 0) {
      firstOwner[ci] = idxs[0];
      lastOwner[ci] = idxs[idxs.length - 1];
      carry = lastOwner[ci];
    } else {
      firstOwner[ci] = carry;
      lastOwner[ci] = carry;
    }
  }

  const endOf: number[] = new Array(occurrences.length);
  let lastH2At = occurrences.length;
  for (let k = occurrences.length - 1; k >= 0; k--) {
    const occ = occurrences[k]!;
    if (occ.level === 3) {
      endOf[k] = k + 1;
    } else {
      endOf[k] = lastH2At;
      lastH2At = k;
    }
  }

  return { occurrences, firstOwner, lastOwner, endOf };
}

/** R3's single-occurrence containment test, generalized to a set of pooled
 * occurrences by the caller (`some k_i`, never `every`). */
function ownsChunk(table: OccurrenceTable, chunkIndex: number, k: number): boolean {
  const first = table.firstOwner[chunkIndex];
  const last = table.lastOwner[chunkIndex];
  if (first === undefined || last === undefined) return false;
  return first >= k && last < table.endOf[k]!;
}

function includesOtherContent(table: OccurrenceTable, occurrenceKs: number[], matchedIndices: number[]): boolean {
  return matchedIndices.some((ci) => !occurrenceKs.some((k) => ownsChunk(table, ci, k)));
}

// --- R1: two-pass row classification --------------------------------------

interface ClassifiedRow {
  norm: string;
  title: string;
  position: number;
  occurrenceKs: number[];
  occurrenceCount: number;
}

interface TopRow extends ClassifiedRow {
  children: ClassifiedRow[];
}

interface Classification {
  top: TopRow[];
  repeated: ClassifiedRow[];
  /** Flat, position-ordered list of every distinct candidate (top rows,
   * their children, and `repeated` entries) -- the exact set D4's gate is
   * evaluated over (design.md, "Row identity and collapsing"). */
  gateCandidates: ClassifiedRow[];
}

function classifyRows(table: OccurrenceTable): Classification {
  const groups = new Map<string, Occurrence[]>();
  for (const occ of table.occurrences) {
    const group = groups.get(occ.norm);
    if (group) group.push(occ);
    else groups.set(occ.norm, [occ]);
  }

  const topByNorm = new Map<string, TopRow>();
  const repeated: ClassifiedRow[] = [];
  const childrenPending: { parentNorm: string; row: ClassifiedRow }[] = [];

  for (const [norm, list] of groups) {
    const topOccurrences = list.filter((o) => o.level === 2 || o.parentNorm === null);
    const occurrenceKs = list.map((o) => o.k);
    const occurrenceCount = list.length;

    if (topOccurrences.length > 0) {
      const first = topOccurrences.reduce((a, b) => (a.k < b.k ? a : b));
      topByNorm.set(norm, { norm, title: first.title, position: first.k, occurrenceKs, occurrenceCount, children: [] });
      continue;
    }

    const parents = new Set(list.map((o) => o.parentNorm!));
    const first = list.reduce((a, b) => (a.k < b.k ? a : b));
    const row: ClassifiedRow = { norm, title: first.title, position: first.k, occurrenceKs, occurrenceCount };
    if (parents.size >= 2) {
      repeated.push(row);
    } else {
      childrenPending.push({ parentNorm: [...parents][0]!, row });
    }
  }

  for (const { parentNorm, row } of childrenPending) {
    // Every H2 occurrence's own normalized title is always classified
    // top-level (its `topOccurrences` is non-empty by construction), so the
    // parent lookup below always succeeds.
    const parent = topByNorm.get(parentNorm);
    if (parent) parent.children.push(row);
  }

  const top = [...topByNorm.values()].sort((a, b) => a.position - b.position);
  for (const t of top) t.children.sort((a, b) => a.position - b.position);
  repeated.sort((a, b) => a.position - b.position);

  const gateCandidates = [...top, ...top.flatMap((t) => t.children), ...repeated].sort(
    (a, b) => a.position - b.position,
  );

  return { top, repeated, gateCandidates };
}

// --- D4 gate: lazy, capped -------------------------------------------------

function evaluateGate(
  candidates: ClassifiedRow[],
  matchIndices: (section: string) => number[],
  totalChunks: number,
): boolean {
  let found = 0;
  const limit = Math.min(candidates.length, MAX_GATE_CANDIDATES);
  for (let i = 0; i < limit; i++) {
    const idx = matchIndices(candidates[i]!.title);
    if (idx.length < totalChunks) found++;
    if (found >= 2) return true;
  }
  return false;
}

// --- R4/R5: rendering ------------------------------------------------------

function tokensForIndices(chunkLengths: number[], indices: number[]): number {
  if (indices.length === 0) return 0;
  const sum = indices.reduce((s, i) => s + chunkLengths[i]!, 0) + 2 * (indices.length - 1);
  return tokensForLength(sum);
}

/** Renders one outline row (design.md's literal `formatReadResult` example,
 * moved here from `server.ts` per D5 so R4's budget ladder and the actual
 * rendering share one function -- a row's ladder cost is never allowed to
 * diverge from its rendered length). Flag clauses appear, when present, in
 * the fixed order `xN`, `too large`, `+other` (R2). */
export function formatOutlineRow(row: Omit<OutlineSection, "children">, depth: 0 | 1): string {
  const prefix = depth === 0 ? "- " : "  - ";
  const flags: string[] = [];
  if (row.occurrences > 1) flags.push(`x${String(row.occurrences)}`);
  if (row.oversized) flags.push("too large");
  if (row.includesOtherContent) flags.push("+other");
  const suffix = flags.length > 0 ? `, ${flags.join(", ")}` : "";
  return `${prefix}${row.heading} (~${String(row.tokens)}${suffix})`;
}

function pessimisticCost(row: ClassifiedRow, docTokens: number, depth: 0 | 1): number {
  const worstCase: Omit<OutlineSection, "children"> = {
    heading: row.title,
    tokens: docTokens,
    occurrences: row.occurrenceCount,
    oversized: true,
    includesOtherContent: true,
  };
  return formatOutlineRow(worstCase, depth).length + 1;
}

function realRow(
  row: ClassifiedRow,
  table: OccurrenceTable,
  matchIndices: (section: string) => number[],
  chunkLengths: number[],
): Omit<OutlineSection, "children"> {
  const idx = matchIndices(row.title);
  const tokens = tokensForIndices(chunkLengths, idx);
  return {
    heading: row.title,
    tokens,
    occurrences: row.occurrenceCount,
    oversized: tokens > OUTLINE_THRESHOLD_TOKENS,
    includesOtherContent: includesOtherContent(table, row.occurrenceKs, idx),
  };
}

interface BuiltOutline {
  sections: OutlineSection[];
  repeated: OutlineSection[];
  omitted: OutlineOmission;
}

/**
 * Builds the H2/H3 outline for a document's chunks (design.md revision 1,
 * R1-R5). Returns `null` when D4's addressable-row gate is not met (fewer
 * than 2 addressable candidates, evaluated lazily and capped at
 * `MAX_GATE_CANDIDATES`) -- the caller falls back to the plain `document`
 * response in that case.
 */
function buildOutline(sorted: IndexedChunk[], chunkLengths: number[], docTokens: number): BuiltOutline | null {
  const table = buildOccurrenceTable(sorted);
  const { top, repeated, gateCandidates } = classifyRows(table);

  const matcher = sectionMatcher(sorted);
  if (!evaluateGate(gateCandidates, matcher.matchIndices, sorted.length)) return null;

  const allChildren = top.flatMap((t) => t.children);
  const allSum =
    top.reduce((s, t) => s + pessimisticCost(t, docTokens, 0), 0) +
    allChildren.reduce((s, c) => s + pessimisticCost(c, docTokens, 1), 0) +
    repeated.reduce((s, r) => s + pessimisticCost(r, docTokens, 0), 0);

  if (allSum <= OUTLINE_ROWS_BUDGET_CHARS) {
    const sections = top.map((t) => ({
      ...realRow(t, table, matcher.matchIndices, chunkLengths),
      children: t.children.map((c) => ({ ...realRow(c, table, matcher.matchIndices, chunkLengths), children: [] })),
    }));
    const repeatedSections = repeated.map((r) => ({
      ...realRow(r, table, matcher.matchIndices, chunkLengths),
      children: [],
    }));
    return { sections, repeated: repeatedSections, omitted: { kind: "none" } };
  }

  const topSum = top.reduce((s, t) => s + pessimisticCost(t, docTokens, 0), 0);

  if (topSum <= OUTLINE_ROWS_BUDGET_CHARS) {
    const topReal = top.map((t) => realRow(t, table, matcher.matchIndices, chunkLengths));
    let used = topReal.reduce((s, r) => s + formatOutlineRow(r, 0).length + 1, 0);

    const oversizedParentNorms = new Set(top.filter((_, i) => topReal[i]!.oversized).map((t) => t.norm));
    const candidateChildren = top
      .filter((t) => oversizedParentNorms.has(t.norm))
      .flatMap((t) => t.children.map((c) => ({ ...c, parentNorm: t.norm })))
      .sort((a, b) => a.position - b.position);

    const renderedChildrenByParent = new Map<string, OutlineSection[]>();
    let renderedChildCount = 0;
    for (const child of candidateChildren) {
      const real = realRow(child, table, matcher.matchIndices, chunkLengths);
      const cost = formatOutlineRow(real, 1).length + 1;
      if (used + cost > OUTLINE_ROWS_BUDGET_CHARS) break;
      used += cost;
      renderedChildCount++;
      const arr = renderedChildrenByParent.get(child.parentNorm) ?? [];
      arr.push({ ...real, children: [] });
      renderedChildrenByParent.set(child.parentNorm, arr);
    }

    const sections = top.map((t, i) => ({
      ...topReal[i]!,
      children: renderedChildrenByParent.get(t.norm) ?? [],
    }));

    const totalChildren = allChildren.length;
    const hidden = totalChildren - renderedChildCount + repeated.length;
    const omitted: OutlineOmission = hidden > 0 ? { kind: "subheadings", hidden } : { kind: "none" };
    return { sections, repeated: [], omitted };
  }

  let used = 0;
  const rendered: OutlineSection[] = [];
  for (const t of top) {
    const real = realRow(t, table, matcher.matchIndices, chunkLengths);
    const cost = formatOutlineRow(real, 0).length + 1;
    if (used + cost > OUTLINE_ROWS_BUDGET_CHARS) break;
    used += cost;
    rendered.push({ ...real, children: [] });
  }
  return { sections: rendered, repeated: [], omitted: { kind: "truncated", shown: rendered.length, total: top.length } };
}

/**
 * Renders the frontmatter of a document as a YAML block. Each of
 * `type`/`module`/`status` is rendered only when present on the document —
 * an absent field is omitted entirely, never shown as empty/placeholder.
 */
export function formatFrontmatter(meta: DocumentMeta): string {
  const lines = ["---"];
  if (meta.type !== undefined) lines.push(`type: ${meta.type}`);
  if (meta.module !== undefined) lines.push(`module: ${meta.module}`);
  if (meta.status !== undefined) lines.push(`status: ${meta.status}`);
  if (meta.owner !== undefined) lines.push(`owner: ${meta.owner}`);
  if (meta.tags.length > 0) lines.push(`tags: [${meta.tags.join(", ")}]`);
  if (meta.updated !== undefined) lines.push(`updated: ${meta.updated}`);
  lines.push("---");
  return lines.join("\n");
}
