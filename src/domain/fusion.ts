export interface FusedResult {
  id: number;
  score: number;
}

/**
 * The RRF damping constant. Lowered from the literature-default 60 to 5 after
 * measurement: at 60 the formula is nearly flat over rank, so a chunk ranked
 * #1 by one leg (worth 1/61) loses to any chunk present in BOTH legs at rank
 * ~10 (worth 2/70) by 1.74x. Fusion was therefore rewarding agreement between
 * the legs rather than the quality of either match, and a best-in-corpus
 * lexical hit whose vector rank fell outside the over-fetch window could not
 * be returned at all.
 *
 * Measured on the query "refund time for customer charged twice duplicate
 * charge" against an 888-chunk corpus: the answering chunk was BM25 #1 and
 * vector #62, fused to #18, and was never returned. At 5 it lands at #3.
 * Raising the over-fetch limit does not fix this (it reaches #12 with the
 * vector leg fully participating), and neither does raising the per-document
 * cap -- the cap is not the binding constraint. Only the damping constant is.
 *
 * Verified not to regress either evaluated corpus: `ejemplos/`'s 22-question
 * goldenset holds at recall@5 1.00 / MRR 0.943 / 0 failures, identical to 60
 * (MRR only degrades at 2 and below), and a 60-query chunk-level goldenset
 * improved from 52/60 to 55/60 answers found with its rank-1 count unchanged.
 *
 * This narrows the both-legs preference; it does not invert it. An id found by
 * both legs still outscores one found by a single leg. What changes is the
 * leverage of rank position: at 60, ranks 1 and 2 differ by 1.6%; at 5, by 17%.
 */
const RRF_K = 5;

/**
 * Reciprocal Rank Fusion: score(id) = Σ 1 / (RRF_K + rank) across every ranked
 * list the id appears in (rank is 1-based). No weights to tune blindly;
 * robust by default. Ties break by the best individual rank to keep the
 * ordering deterministic.
 */
export function reciprocalRankFusion(lists: number[][]): FusedResult[] {
  const scores = new Map<number, number>();
  const bestRank = new Map<number, number>();

  for (const list of lists) {
    list.forEach((id, index) => {
      const rank = index + 1;
      scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank));
      const previous = bestRank.get(id);
      if (previous === undefined || rank < previous) bestRank.set(id, rank);
    });
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || (bestRank.get(a.id) ?? 0) - (bestRank.get(b.id) ?? 0));
}

/**
 * Caps how many chunks a single document can contribute to the final result
 * list (the spec fixes it at 2), preserving the fused order.
 */
export function capPerDocument(
  results: FusedResult[],
  documentOf: (id: number) => number,
  maxPerDocument: number,
): FusedResult[] {
  const seen = new Map<number, number>();
  const capped: FusedResult[] = [];
  for (const result of results) {
    const doc = documentOf(result.id);
    const count = seen.get(doc) ?? 0;
    if (count >= maxPerDocument) continue;
    seen.set(doc, count + 1);
    capped.push(result);
  }
  return capped;
}
