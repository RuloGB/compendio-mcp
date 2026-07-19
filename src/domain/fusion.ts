export interface FusedResult {
  id: number;
  score: number;
}

const RRF_K = 60;

/**
 * Reciprocal Rank Fusion: score(id) = Σ 1 / (60 + rank) across every ranked
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
