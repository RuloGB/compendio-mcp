import type { DocumentMeta } from "../domain/model.js";
import type { IndexStore } from "../domain/ports.js";
import { closestMatches, normalize } from "../domain/similarity.js";

export interface ReadRequest {
  ruta: string;
  seccion?: string;
}

export type ReadResult =
  | { tipo: "documento"; meta: DocumentMeta; contenido: string }
  | { tipo: "seccion"; meta: DocumentMeta; seccion: string; contenido: string }
  | { tipo: "ruta-no-encontrada"; ruta: string; sugerencias: string[] }
  | {
      tipo: "seccion-no-encontrada";
      meta: DocumentMeta;
      seccion: string;
      seccionesDisponibles: string[];
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
    const doc = this.store.getDocumentByRuta(request.ruta);
    if (doc === null) {
      const rutas = this.store.listDocuments().map((d) => d.ruta);
      return {
        tipo: "ruta-no-encontrada",
        ruta: request.ruta,
        sugerencias: closestMatches(request.ruta, rutas, SUGGESTION_LIMIT),
      };
    }

    const chunks = this.store.getChunksByDocument(doc.id);
    if (request.seccion === undefined || request.seccion.trim().length === 0) {
      const body = chunks.map((c) => c.contenido).join("\n\n");
      // Intro chunks exclude the H1 line; restore it unless the body already
      // starts with one (documents indexed without chunking keep theirs).
      const contenido = body.startsWith("# ") ? body : `# ${doc.titulo}\n\n${body}`;
      return { tipo: "documento", meta: doc, contenido };
    }

    // A section may live merged inside a bigger chunk (small sections are
    // fused at indexing time), so match both the chunk heading path and the
    // heading lines inside its content.
    const wanted = normalize(request.seccion);
    const matching = chunks.filter(
      (c) =>
        normalize(c.encabezado).includes(wanted) ||
        headingsIn(c.contenido).some((h) => normalize(h).includes(wanted)),
    );
    if (matching.length === 0) {
      const disponibles = new Set<string>();
      for (const chunk of chunks) {
        disponibles.add(chunk.encabezado);
        for (const heading of headingsIn(chunk.contenido)) disponibles.add(heading);
      }
      return {
        tipo: "seccion-no-encontrada",
        meta: doc,
        seccion: request.seccion,
        seccionesDisponibles: [...disponibles],
      };
    }
    return {
      tipo: "seccion",
      meta: doc,
      seccion: request.seccion,
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
  if (meta.tipo !== undefined) lines.push(`tipo: ${meta.tipo}`);
  if (meta.modulo !== undefined) lines.push(`modulo: ${meta.modulo}`);
  if (meta.estado !== undefined) lines.push(`estado: ${meta.estado}`);
  if (meta.propietario !== undefined) lines.push(`propietario: ${meta.propietario}`);
  if (meta.etiquetas.length > 0) lines.push(`etiquetas: [${meta.etiquetas.join(", ")}]`);
  if (meta.actualizado !== undefined) lines.push(`actualizado: ${meta.actualizado}`);
  lines.push("---");
  return lines.join("\n");
}
