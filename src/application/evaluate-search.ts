import {
  summarizeEval,
  type EvalCase,
  type EvalCaseOutcome,
  type EvalSummary,
} from "../domain/metrics.js";
import type { SearchDocuments } from "./search-documents.js";

export interface EvalReport {
  k: number;
  /** Absent when the index has no vectors (lexical-only corpus). */
  hibrido?: EvalSummary;
  lexico: EvalSummary;
}

/** Chunk over-fetch per question so at least k unique documents surface. */
const CHUNK_FETCH_FACTOR = 3;

/**
 * Runs every goldenset question through search in hybrid AND lexical-only
 * modes and reports recall@k plus MRR side by side. That comparison answers
 * the question that justifies the project: how much does the semantic leg add
 * over plain lexical search?
 */
export class EvaluateSearch {
  constructor(
    private readonly search: SearchDocuments,
    private readonly hasVectors: () => boolean,
  ) {}

  async execute(casos: EvalCase[], k: number): Promise<EvalReport> {
    const lexico = await this.runMode(casos, k, true);
    const report: EvalReport = { k, lexico };
    if (this.hasVectors()) {
      report.hibrido = await this.runMode(casos, k, false);
    }
    return report;
  }

  private async runMode(casos: EvalCase[], k: number, forzarLexico: boolean): Promise<EvalSummary> {
    const outcomes: EvalCaseOutcome[] = [];
    for (const caso of casos) {
      const response = await this.search.execute({
        query: caso.pregunta,
        k: k * CHUNK_FETCH_FACTOR,
        forzarLexico,
      });
      const rankedDocs = uniqueInOrder(response.resultados.map((r) => r.ruta));
      const index = rankedDocs.indexOf(normalizePath(caso.esperado));
      outcomes.push({ ...caso, posicion: index === -1 ? null : index + 1 });
    }
    return summarizeEval(outcomes, k);
  }
}

function uniqueInOrder(rutas: string[]): string[] {
  return [...new Set(rutas.map(normalizePath))];
}

function normalizePath(ruta: string): string {
  return ruta.replaceAll("\\", "/").trim();
}
