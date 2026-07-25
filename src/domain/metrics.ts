export interface EvalCase {
  question: string;
  expected: string;
}

export interface EvalCaseOutcome extends EvalCase {
  /** 1-based position of the expected document among the ranked unique
   * documents returned for the question; null if it did not appear. */
  rank: number | null;
}

export interface EvalSummary {
  cases: number;
  /** Fraction of questions whose expected document appeared in the top k. */
  recallAtK: number;
  /** Mean Reciprocal Rank over all questions (0 when never found). */
  mrr: number;
  failures: EvalCaseOutcome[];
}

export function summarizeEval(outcomes: EvalCaseOutcome[], k: number): EvalSummary {
  const cases = outcomes.length;
  if (cases === 0) {
    return { cases: 0, recallAtK: 0, mrr: 0, failures: [] };
  }
  let hits = 0;
  let reciprocalSum = 0;
  const failures: EvalCaseOutcome[] = [];
  for (const outcome of outcomes) {
    if (outcome.rank !== null && outcome.rank <= k) {
      hits += 1;
    } else {
      failures.push(outcome);
    }
    if (outcome.rank !== null) {
      reciprocalSum += 1 / outcome.rank;
    }
  }
  return {
    cases,
    recallAtK: hits / cases,
    mrr: reciprocalSum / cases,
    failures,
  };
}
