import type { DocumentMeta } from "./model.js";

/** File name of the generated corpus index, fixed by the documentation convention. */
export const INDEX_FILE = "INDEX.md";

export const MAX_RESUMEN_CHARS = 140;

/** The subset of document metadata the index line needs. */
export type IndexEntry = Pick<DocumentMeta, "path" | "titulo" | "resumen" | "type" | "status">;

const TITULO_INDICE = "# Índice de la documentación";
const AVISO_GENERADO =
  '<!-- Generado con "compendio index-md"; los cambios manuales se sobrescriben. -->';

/** Collapses whitespace and truncates, so each document stays on one short line. */
export function condenseResumen(text: string, maxChars: number = MAX_RESUMEN_CHARS): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length <= maxChars ? collapsed : `${collapsed.slice(0, maxChars - 1)}…`;
}

/** Resumen shown on a document line; falls back to the title when the
 * document has no intro paragraph after the H1. */
export function displayResumen(doc: { resumen: string; titulo: string }): string {
  return condenseResumen(doc.resumen.trim().length > 0 ? doc.resumen : doc.titulo);
}

/**
 * One document per line — the format shared by INDEX.md and docs_overview.
 * Omits the `[type]` bracket segment and the `(status)` parenthesized segment
 * entirely when the corresponding field is absent (never `[undefined]` or an
 * empty placeholder).
 */
export function formatDocLine(doc: {
  type: string | undefined;
  path: string;
  resumen: string;
  status: string | undefined;
}): string {
  const typeSegment = doc.type !== undefined ? `[${doc.type}] ` : "";
  const statusSegment = doc.status !== undefined ? ` (${doc.status})` : "";
  return `- ${typeSegment}${doc.path} — ${doc.resumen}${statusSegment}`;
}

/** Default ordering: alphabetical by `path` (the zero-config/libre default). */
function compararAlfabetico(a: IndexEntry, b: IndexEntry): number {
  return a.path.localeCompare(b.path);
}

/**
 * Renders INDEX.md: one line per document. Ordering is delegated to an
 * injectable comparator (default = alphabetical by `path`); pass the
 * `estricto` declared-taxonomy comparator from `crearComparadorIndice` to
 * order by the declared `types` sequence instead.
 */
export function renderIndexMd(
  docs: IndexEntry[],
  comparar: (a: IndexEntry, b: IndexEntry) => number = compararAlfabetico,
): string {
  const lines = [...docs].sort(comparar).map((doc) =>
    formatDocLine({
      type: doc.type,
      path: doc.path,
      resumen: displayResumen(doc),
      status: doc.status,
    }),
  );
  const header = `${TITULO_INDICE}\n\n${AVISO_GENERADO}\n`;
  return lines.length === 0 ? header : `${header}\n${lines.join("\n")}\n`;
}
