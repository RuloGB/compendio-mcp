import { TIPOS, type DocumentMeta } from "./model.js";

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

/** One document per line — the format shared by INDEX.md and docs_overview. */
export function formatDocLine(doc: {
  tipo: string;
  ruta: string;
  resumen: string;
  estado: string;
}): string {
  return `- [${doc.tipo}] ${doc.ruta} — ${doc.resumen} (${doc.estado})`;
}

/**
 * Renders INDEX.md per the documentation convention: one line per document,
 * root-level documents first (the glossary), then grouped by tipo in
 * convention order, alphabetically within each group.
 */
export function renderIndexMd(docs: IndexEntry[]): string {
  const lines = [...docs].sort(compareEntries).map((doc) =>
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

function compareEntries(a: IndexEntry, b: IndexEntry): number {
  const nivelA = a.ruta.includes("/") ? 1 : 0;
  const nivelB = b.ruta.includes("/") ? 1 : 0;
  if (nivelA !== nivelB) return nivelA - nivelB;
  const tipoDiff = TIPOS.indexOf(a.tipo) - TIPOS.indexOf(b.tipo);
  if (tipoDiff !== 0) return tipoDiff;
  return a.ruta.localeCompare(b.ruta);
}
