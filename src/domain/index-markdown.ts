import type { DocumentMeta } from "./model.js";

/** File name of the generated corpus index, fixed by the documentation convention. */
export const INDEX_FILE = "INDEX.md";

export const MAX_RESUMEN_CHARS = 140;

/** The subset of document metadata the index line needs. */
export type IndexEntry = Pick<DocumentMeta, "ruta" | "titulo" | "resumen" | "tipo" | "estado">;

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
 * Omits the `[tipo]` bracket segment and the `(estado)` parenthesized segment
 * entirely when the corresponding field is absent (never `[undefined]` or an
 * empty placeholder).
 */
export function formatDocLine(doc: {
  tipo: string | undefined;
  ruta: string;
  resumen: string;
  estado: string | undefined;
}): string {
  const tipoSegment = doc.tipo !== undefined ? `[${doc.tipo}] ` : "";
  const estadoSegment = doc.estado !== undefined ? ` (${doc.estado})` : "";
  return `- ${tipoSegment}${doc.ruta} — ${doc.resumen}${estadoSegment}`;
}

/** Default ordering: alphabetical by `ruta` (the zero-config/libre default). */
function compararAlfabetico(a: IndexEntry, b: IndexEntry): number {
  return a.ruta.localeCompare(b.ruta);
}

/**
 * Renders INDEX.md: one line per document. Ordering is delegated to an
 * injectable comparator (default = alphabetical by `ruta`); pass the
 * `estricto` declared-taxonomy comparator from `crearComparadorIndice` to
 * order by the declared `tipos` sequence instead.
 */
export function renderIndexMd(
  docs: IndexEntry[],
  comparar: (a: IndexEntry, b: IndexEntry) => number = compararAlfabetico,
): string {
  const lines = [...docs].sort(comparar).map((doc) =>
    formatDocLine({
      tipo: doc.tipo,
      ruta: doc.ruta,
      resumen: displayResumen(doc),
      estado: doc.estado,
    }),
  );
  const header = `${TITULO_INDICE}\n\n${AVISO_GENERADO}\n`;
  return lines.length === 0 ? header : `${header}\n${lines.join("\n")}\n`;
}
