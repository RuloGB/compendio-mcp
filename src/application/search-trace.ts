import type { SearchFilters, SearchMode } from "../domain/model.js";

/**
 * Internal trace types for `SearchDocuments.execute`'s optional observer
 * (`retrieval-ranking-robustness`). These are NOT part of the MCP contract —
 * they exist so a local measurement runner can watch production search work
 * without re-implementing any of it. Passing no observer costs nothing: no
 * extra store call, no extra embedding call, no extra object built beyond
 * what `execute` already computes for the response it returns anyway.
 */

/**
 * Why the vector leg did or did not run, and what it returned when it did.
 * Every branch `SearchDocuments.vectorLeg` can take, named — never a
 * fabricated rank for an unavailable leg.
 */
export type VectorLegTrace =
  | { available: true; ids: readonly number[] }
  | {
      available: false;
      reason: "forced-lexical" | "no-provider" | "no-vectors" | "empty-embedding" | "embed-failed";
    };

/** A fused candidate removed by the per-document cap, before the final
 * `k`-slice — identifiable independently of whether it would have survived
 * the slice anyway. */
export interface CapRemoval {
  id: number;
  documentId: number;
}

/**
 * One `runSearch` execution. `SearchDocuments.execute` may run this twice:
 * once with the caller's filters, and once more — a second attempt — when a
 * structurally impossible filter is dropped and the search retried.
 */
export interface SearchTraceAttempt {
  /** 1-based; the caller's filters produce attempt 1, a filter-drop retry
   * produces attempt 2. There is never a third. */
  attemptNumber: number;
  /** The filters this attempt actually ran with (post-drop, on a retry). */
  filters: SearchFilters;
  /** The per-leg candidate limit (`max(MIN_CANDIDATES, k * CANDIDATE_FACTOR)`). */
  limit: number;
  /** BM25-ranked chunk ids, best first, exactly as `IndexStore.searchLexical`
   * returned them — a defensive copy, immune to later mutation of the
   * store's own array. */
  lexicalIds: readonly number[];
  vector: VectorLegTrace;
  /** Distinct ids from the union of the ranked lists actually fused (one
   * list when lexical-only, two when hybrid). */
  union: readonly number[];
  /** Every fused candidate with its exact, unrounded RRF score — the
   * response only ever reports a rounded `toFixed(4)` score for the ids that
   * survive the cap and the `k`-slice. */
  fused: ReadonlyArray<{ id: number; score: number }>;
  /** Fused ids that survived the per-document cap, in fused order, before
   * the `k`-slice. */
  cappedIds: readonly number[];
  /** Fused ids the per-document cap removed — never inferred from
   * `fused`/`cappedIds` alone, since a genuinely absent id and a
   * cap-removed id are different facts. */
  capRemovals: ReadonlyArray<CapRemoval>;
  /** Chunk ids actually emitted as results, in emission order. Shorter than
   * `cappedIds.slice(0, k)` when a capped id had no resolvable chunk/document
   * row (see the "missing rows" scenario). */
  finalIds: readonly number[];
  mode: SearchMode;
}

/** The full record of one `execute()` call: every attempt it ran, plus the
 * same `filterWarning`/`noMatchReason` the returned `SearchResponse` carries
 * (never a second, independently-derived copy). */
export interface SearchTrace {
  attempts: readonly SearchTraceAttempt[];
  filterWarning?: string;
  noMatchReason?: string;
}

/**
 * Opt-in observer. `execute(query, observer)` calls `onComplete` exactly
 * once, after the response it is about to return is fully built. A throwing
 * observer cannot affect the response — the call is isolated so a broken
 * measurement tool can never take production search down with it.
 */
export interface SearchTraceObserver {
  onComplete(trace: SearchTrace): void;
}
