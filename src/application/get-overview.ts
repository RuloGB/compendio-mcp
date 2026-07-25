import { displaySummary, formatDocLine } from "../domain/index-markdown.js";
import type { IndexStore } from "../domain/ports.js";
import type { SkippedFileReport } from "./index-documents.js";
import type { SyncReport } from "./sync-index.js";

export interface OverviewLine {
  type?: string;
  path: string;
  summary: string;
  status?: string;
}

export interface Overview {
  totalDocumentos: number;
  byType: Record<string, number>;
  byModule: Record<string, number>;
  documentos: OverviewLine[];
}

/**
 * Corpus map for agents: counts by type and module plus one line per document.
 * Budget: ~10 tokens per document, so summaries are truncated hard. Documents
 * with an absent type/module are not counted into any bucket (no synthetic
 * no-type/no-module catch-all).
 */
export class GetOverview {
  constructor(private readonly store: IndexStore) {}

  execute(): Overview {
    const documents = this.store.listDocuments();
    const byType: Record<string, number> = {};
    const byModule: Record<string, number> = {};
    for (const doc of documents) {
      if (doc.type !== undefined) byType[doc.type] = (byType[doc.type] ?? 0) + 1;
      if (doc.module !== undefined) byModule[doc.module] = (byModule[doc.module] ?? 0) + 1;
    }
    return {
      totalDocumentos: documents.length,
      byType,
      byModule,
      documentos: documents.map((doc) => {
        const line: OverviewLine = { path: doc.path, summary: displaySummary(doc) };
        if (doc.type !== undefined) line.type = doc.type;
        if (doc.status !== undefined) line.status = doc.status;
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
  const byTypeLine = formatCounts(overview.byType);
  if (byTypeLine !== null) lines.push(`Por tipo: ${byTypeLine}`);
  const byModuleLine = formatCounts(overview.byModule);
  if (byModuleLine !== null) lines.push(`Por modulo: ${byModuleLine}`);
  lines.push("");
  for (const doc of overview.documentos) {
    lines.push(formatDocLine({ type: doc.type, path: doc.path, summary: doc.summary, status: doc.status }));
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
