export interface EvalCase {
  pregunta: string;
  esperado: string;
}

export interface EvalCaseOutcome extends EvalCase {
  /** 1-based position of the expected document among the ranked unique
   * documents returned for the question; null if it did not appear. */
  posicion: number | null;
}

export interface EvalSummary {
  casos: number;
  /** Fraction of questions whose expected document appeared in the top k. */
  recallAtK: number;
  /** Mean Reciprocal Rank over all questions (0 when never found). */
  mrr: number;
  fallos: EvalCaseOutcome[];
}

export function summarizeEval(outcomes: EvalCaseOutcome[], k: number): EvalSummary {
  const casos = outcomes.length;
  if (casos === 0) {
    return { casos: 0, recallAtK: 0, mrr: 0, fallos: [] };
  }
  let hits = 0;
  let reciprocalSum = 0;
  const fallos: EvalCaseOutcome[] = [];
  for (const outcome of outcomes) {
    if (outcome.posicion !== null && outcome.posicion <= k) {
      hits += 1;
    } else {
      fallos.push(outcome);
    }
    if (outcome.posicion !== null) {
      reciprocalSum += 1 / outcome.posicion;
    }
  }
  return {
    casos,
    recallAtK: hits / casos,
    mrr: reciprocalSum / casos,
    fallos,
  };
}
