import { displayResumen, formatDocLine } from "../domain/index-markdown.js";
import type { IndexStore } from "../domain/ports.js";

export interface OverviewLine {
  tipo?: string;
  ruta: string;
  resumen: string;
  estado?: string;
}

export interface Overview {
  totalDocumentos: number;
  porTipo: Record<string, number>;
  porModulo: Record<string, number>;
  documentos: OverviewLine[];
}

/**
 * Corpus map for agents: counts by tipo and modulo plus one line per document.
 * Budget: ~10 tokens per document, so summaries are truncated hard. Documents
 * with an absent tipo/modulo are not counted into any bucket (no synthetic
 * "sin tipo"/"sin modulo" catch-all).
 */
export class GetOverview {
  constructor(private readonly store: IndexStore) {}

  execute(): Overview {
    const documents = this.store.listDocuments();
    const porTipo: Record<string, number> = {};
    const porModulo: Record<string, number> = {};
    for (const doc of documents) {
      if (doc.tipo !== undefined) porTipo[doc.tipo] = (porTipo[doc.tipo] ?? 0) + 1;
      if (doc.modulo !== undefined) porModulo[doc.modulo] = (porModulo[doc.modulo] ?? 0) + 1;
    }
    return {
      totalDocumentos: documents.length,
      porTipo,
      porModulo,
      documentos: documents.map((doc) => {
        const line: OverviewLine = { ruta: doc.ruta, resumen: displayResumen(doc) };
        if (doc.tipo !== undefined) line.tipo = doc.tipo;
        if (doc.estado !== undefined) line.estado = doc.estado;
        return line;
      }),
    };
  }
}

export function formatOverview(overview: Overview): string {
  const lines: string[] = [];
  lines.push(`Documentos indexados: ${overview.totalDocumentos}`);
  const porTipoLine = formatCounts(overview.porTipo);
  if (porTipoLine !== null) lines.push(`Por tipo: ${porTipoLine}`);
  const porModuloLine = formatCounts(overview.porModulo);
  if (porModuloLine !== null) lines.push(`Por modulo: ${porModuloLine}`);
  lines.push("");
  for (const doc of overview.documentos) {
    lines.push(formatDocLine({ tipo: doc.tipo, ruta: doc.ruta, resumen: doc.resumen, estado: doc.estado }));
  }
  return lines.join("\n");
}

/** Returns null (line omitted entirely) when the bucket has nothing to report. */
function formatCounts(counts: Record<string, number>): string | null {
  const entries = Object.entries(counts);
  if (entries.length === 0) return null;
  return entries.map(([key, count]) => `${key} (${count})`).join(", ");
}
