import { displayResumen, formatDocLine } from "../domain/index-markdown.js";
import type { IndexStore } from "../domain/ports.js";
import type { SkippedFileReport } from "./index-documents.js";
import type { SyncReport } from "./sync-index.js";

export interface OverviewLine {
  tipo?: string;
  path: string;
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
        const line: OverviewLine = { path: doc.path, resumen: displayResumen(doc) };
        if (doc.tipo !== undefined) line.tipo = doc.tipo;
        if (doc.estado !== undefined) line.estado = doc.estado;
        return line;
      }),
    };
  }
}

/** Sync-status surfaced in `docs_overview`: what the most recent incremental
 * sync pass had to report, if anything. */
export interface SincronizacionInfo {
  omitidos: SkippedFileReport[];
  avisoEmbeddings?: string;
}

/**
 * Maps `SyncScheduler.lastReport` to `SincronizacionInfo`. The omission rule
 * is CONTENT-based, not presence-based: `null` both when there is no report
 * yet, AND when the most recent pass had nothing to report (empty `omitidos`
 * and no `avisoEmbeddings`) — `runTracked()` sets `lastReport` after every
 * completed pass, including a fully clean one, so a presence-only rule would
 * render an empty block forever after the first successful pass.
 */
export function toSincronizacionInfo(report: SyncReport | null): SincronizacionInfo | null {
  if (report === null) return null;
  if (report.omitidos.length === 0 && report.avisoEmbeddings === undefined) return null;
  const info: SincronizacionInfo = { omitidos: report.omitidos };
  if (report.avisoEmbeddings !== undefined) info.avisoEmbeddings = report.avisoEmbeddings;
  return info;
}

export function formatOverview(
  overview: Overview,
  sincronizacion?: SincronizacionInfo | null,
): string {
  const lines: string[] = [];
  lines.push(`Documentos indexados: ${overview.totalDocumentos}`);
  const porTipoLine = formatCounts(overview.porTipo);
  if (porTipoLine !== null) lines.push(`Por tipo: ${porTipoLine}`);
  const porModuloLine = formatCounts(overview.porModulo);
  if (porModuloLine !== null) lines.push(`Por modulo: ${porModuloLine}`);
  lines.push("");
  for (const doc of overview.documentos) {
    lines.push(formatDocLine({ tipo: doc.tipo, path: doc.path, resumen: doc.resumen, estado: doc.estado }));
  }
  if (sincronizacion !== null && sincronizacion !== undefined) {
    lines.push("");
    lines.push("Sincronizacion:");
    for (const omitido of sincronizacion.omitidos) {
      lines.push(`AVISO ${omitido.path}: ${omitido.errores.join("; ")}`);
    }
    if (sincronizacion.avisoEmbeddings !== undefined) {
      lines.push(`AVISO ${sincronizacion.avisoEmbeddings}`);
    }
  }
  return lines.join("\n");
}

/** Returns null (line omitted entirely) when the bucket has nothing to report. */
function formatCounts(counts: Record<string, number>): string | null {
  const entries = Object.entries(counts);
  if (entries.length === 0) return null;
  return entries.map(([key, count]) => `${key} (${count})`).join(", ");
}
