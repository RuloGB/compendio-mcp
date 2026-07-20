import { displayResumen, formatDocLine } from "../domain/index-markdown.js";
import type { IndexStore } from "../domain/ports.js";

export interface OverviewLine {
  tipo: string;
  ruta: string;
  resumen: string;
  estado: string;
}

export interface Overview {
  totalDocumentos: number;
  porTipo: Record<string, number>;
  porModulo: Record<string, number>;
  documentos: OverviewLine[];
}

/**
 * Corpus map for agents: counts by tipo and modulo plus one line per document.
 * Budget: ~10 tokens per document, so summaries are truncated hard.
 */
export class GetOverview {
  constructor(private readonly store: IndexStore) {}

  execute(): Overview {
    const documents = this.store.listDocuments();
    const porTipo: Record<string, number> = {};
    const porModulo: Record<string, number> = {};
    for (const doc of documents) {
      porTipo[doc.tipo] = (porTipo[doc.tipo] ?? 0) + 1;
      porModulo[doc.modulo] = (porModulo[doc.modulo] ?? 0) + 1;
    }
    return {
      totalDocumentos: documents.length,
      porTipo,
      porModulo,
      documentos: documents.map((doc) => ({
        tipo: doc.tipo,
        ruta: doc.ruta,
        resumen: displayResumen(doc),
        estado: doc.estado,
      })),
    };
  }
}

export function formatOverview(overview: Overview): string {
  const lines: string[] = [];
  lines.push(`Documentos indexados: ${overview.totalDocumentos}`);
  lines.push(`Por tipo: ${formatCounts(overview.porTipo)}`);
  lines.push(`Por modulo: ${formatCounts(overview.porModulo)}`);
  lines.push("");
  for (const doc of overview.documentos) {
    lines.push(formatDocLine(doc));
  }
  return lines.join("\n");
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts);
  if (entries.length === 0) return "—";
  return entries.map(([key, count]) => `${key} (${count})`).join(", ");
}
