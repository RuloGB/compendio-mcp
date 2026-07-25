import type { DocumentMeta } from "../domain/model.js";
import type { IndexStore } from "../domain/ports.js";
import { closestMatches, normalize } from "../domain/similarity.js";

export interface ReadRequest {
  path: string;
  section?: string;
}

export type ReadResult =
  | { type: "documento"; meta: DocumentMeta; contenido: string }
  | { type: "seccion"; meta: DocumentMeta; section: string; contenido: string }
  | { type: "ruta-no-encontrada"; path: string; sugerencias: string[] }
  | {
      type: "seccion-no-encontrada";
      meta: DocumentMeta;
      section: string;
      availableSections: string[];
    };

const SUGGESTION_LIMIT = 3;

/**
 * Reads a full document or a single section from the index. A broken path
 * never returns a bare error: it answers with the 3 closest paths so an agent
 * following a stale link can recover on its own.
 */
export class ReadDocument {
  constructor(private readonly store: IndexStore) {}

  execute(request: ReadRequest): ReadResult {
    const doc = this.store.getDocumentByPath(request.path);
    if (doc === null) {
      const paths = this.store.listDocuments().map((d) => d.path);
      return {
        type: "ruta-no-encontrada",
        path: request.path,
        sugerencias: closestMatches(request.path, paths, SUGGESTION_LIMIT),
      };
    }

    const chunks = this.store.getChunksByDocument(doc.id);
    if (request.section === undefined || request.section.trim().length === 0) {
      const body = chunks.map((c) => c.contenido).join("\n\n");
      // Intro chunks exclude the H1 line; restore it unless the body already
      // starts with one (documents indexed without chunking keep theirs).
      const contenido = body.startsWith("# ") ? body : `# ${doc.titulo}\n\n${body}`;
      return { type: "documento", meta: doc, contenido };
    }

    // A section may live merged inside a bigger chunk (small sections are
    // fused at indexing time), so match both the chunk heading path and the
    // heading lines inside its content.
    const wanted = normalize(request.section);
    const matching = chunks.filter(
      (c) =>
        normalize(c.heading).includes(wanted) ||
        headingsIn(c.contenido).some((h) => normalize(h).includes(wanted)),
    );
    if (matching.length === 0) {
      const disponibles = new Set<string>();
      for (const chunk of chunks) {
        disponibles.add(chunk.heading);
        for (const heading of headingsIn(chunk.contenido)) disponibles.add(heading);
      }
      return {
        type: "seccion-no-encontrada",
        meta: doc,
        section: request.section,
        availableSections: [...disponibles],
      };
    }
    return {
      type: "seccion",
      meta: doc,
      section: request.section,
      contenido: matching.map((c) => c.contenido).join("\n\n"),
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
 * `tipo`/`modulo`/`estado` is rendered only when present on the document —
 * an absent field is omitted entirely, never shown as empty/placeholder.
 */
export function formatFrontmatter(meta: DocumentMeta): string {
  const lines = ["---"];
  if (meta.type !== undefined) lines.push(`tipo: ${meta.type}`);
  if (meta.module !== undefined) lines.push(`modulo: ${meta.module}`);
  if (meta.status !== undefined) lines.push(`estado: ${meta.status}`);
  if (meta.owner !== undefined) lines.push(`propietario: ${meta.owner}`);
  if (meta.tags.length > 0) lines.push(`etiquetas: [${meta.tags.join(", ")}]`);
  if (meta.updated !== undefined) lines.push(`actualizado: ${meta.updated}`);
  lines.push("---");
  return lines.join("\n");
}
