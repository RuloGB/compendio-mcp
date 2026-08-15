import type { DocumentMeta, IndexedDocument } from "../domain/model.js";
import type { IndexStore } from "../domain/ports.js";
import { closestMatches, normalize } from "../domain/similarity.js";
import { isFenceDelimiter } from "../domain/split-text.js";

export interface ReadRequest {
  path: string;
  section?: string;
}

export type ReadResult =
  | { type: "document"; meta: DocumentMeta; content: string }
  | { type: "section"; meta: DocumentMeta; section: string; content: string }
  | { type: "path-not-found"; path: string; suggestions: string[] }
  | {
      type: "section-not-found";
      meta: DocumentMeta;
      section: string;
      availableSections: string[];
    }
  | { type: "no-sections"; meta: DocumentMeta; section: string };

const SUGGESTION_LIMIT = 3;

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
      const body = chunks.map((c) => c.content).join("\n\n");
      // Intro chunks exclude the H1 line; restore it unless the body already
      // starts with one (documents indexed without chunking keep theirs).
      const content = body.startsWith("# ") ? body : `# ${doc.title}\n\n${body}`;
      return { type: "document", meta: doc, content };
    }

    // A section may live merged inside a bigger chunk (small sections are
    // fused at indexing time), so match both the chunk heading path and the
    // heading lines inside its content.
    const wanted = normalize(request.section);
    const matching = chunks.filter(
      (c) =>
        normalize(c.heading).includes(wanted) ||
        headingsIn(c.content).some((h) => normalize(h).includes(wanted)),
    );
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
 * `execute` re-attaches it at :68 and the parser routes the first H1 to
 * `outline.title`. Widening to `#{1,6}` would offer every document's own
 * title as a "section" -- a new defect, not a wider fix.
 *
 * **Measured deviation from design.md's literal spec (`/^#{2,6}\s+(.+)$/`,
 * no trailing `\r?`).** design.md's Decision 3 claimed CRLF behaviour would
 * be unchanged -- "`split("\n")` leaves a trailing `\r` inside `(.+)`, and
 * `.trim()` removes it -- exactly what `matchAll(/…/gm)` does today." That
 * claim does not hold: without the `/m` flag, `$` asserts the literal end of
 * the (per-line) string, and `.` never matches `\r`, so on a line like
 * `"## 3. File names\r"` the greedy `(.+)` is stopped one character short by
 * `.`'s exclusion of `\r`, leaving that `\r` unconsumed with nothing left to
 * match `$` against -- the whole match FAILS, silently. Under `/gm` on the
 * FULL string (the pre-fix code path), `$` instead matches immediately
 * before ANY line terminator, including a bare `\r`, so the match succeeded
 * there without ever needing `.trim()` to remove anything. This is not the
 * documented, accepted parity-hole limitation -- it is a genuine regression,
 * reproducible on this repository's OWN CRLF-encoded
 * `docs/documentation-convention.md` ("## 3. File names", "## 10. Glossary",
 * both real, unfenced H2s that stopped resolving). The explicit trailing
 * `\r?` below is the fix: `(.+)` still cannot consume `\r` (unchanged), but
 * an optional literal `\r` is now allowed between the captured text and `$`,
 * which is what design.md's own commentary described but the specified
 * regex did not actually implement. */
const HEADING_LINE = /^#{2,6}\s+(.+)\r?$/;

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
 * Known, documented, accepted limitation: `balanced` cannot distinguish one
 * complete self-contained fence from one stray closer (continuing a fence
 * opened in an earlier chunk) followed by one stray opener (starting a fence
 * that continues into a later chunk) -- both read as 2 delimiters, both
 * "balanced". In that narrow, chunk-local-indistinguishable shape, a real
 * heading between the two stray delimiters is suppressed. Accepted on
 * reachability grounds (tasks.md, "Resolution of the parity-hole open
 * decision"; design.md Decision 4's orchestrator note) rather than fixed --
 * see `mcp-contract/spec.md`'s fourth non-guarantee.
 */
function headingsIn(markdown: string): string[] {
  const lines = markdown.split("\n");
  const balanced = lines.filter(isFenceDelimiter).length % 2 === 0;

  const titles: string[] = [];
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
    if (match !== null) titles.push(match[1]!.trim());
  }
  return titles;
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
