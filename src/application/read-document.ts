import type { DocumentMeta, IndexedDocument } from "../domain/model.js";
import type { IndexStore } from "../domain/ports.js";
import { closestMatches, normalize } from "../domain/similarity.js";

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

/** Titles of the H2-H6 heading lines present in a markdown fragment. */
function headingsIn(markdown: string): string[] {
  const titles: string[] = [];
  for (const match of markdown.matchAll(/^#{2,6}\s+(.+)$/gm)) {
    titles.push(match[1]!.trim());
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
