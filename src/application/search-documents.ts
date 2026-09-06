import { buildExcerpt, excerptBudget } from "../domain/excerpt.js";
import { capPerDocument, reciprocalRankFusion } from "../domain/fusion.js";
import { locateSpans, tokenizeQuery } from "../domain/match-location.js";
import type { SearchFilters, SearchMode, SearchResponse, SearchResultItem } from "../domain/model.js";
import { normalizeTags } from "../domain/tags.js";
import {
  collectFacets,
  describeDroppedFilters,
  dropImpossibleFilters,
  explainEmptyResult,
} from "../domain/search-diagnostics.js";
import type { EmbeddingsProvider, IndexStore } from "../domain/ports.js";
import type {
  SearchTrace,
  SearchTraceAttempt,
  SearchTraceObserver,
  VectorLegTrace,
} from "./search-trace.js";

export interface SearchQuery {
  query: string;
  /**
   * `type`, `module` and `tags` are open strings, project-defined. A blank
   * value — empty or whitespace-only, and per-entry for `tags` — is treated as
   * absent: the filter is not applied, and nothing is reported about it. `type`
   * and `module` match verbatim and case-sensitively; `tags` match in canonical
   * form (see `normalizeTags`).
   */
  type?: string;
  module?: string;
  tags?: string[];
  k?: number;
  /** Include documents whose status is in the config deny-list (excluded by default). */
  includeExcluded?: boolean;
  /** Skip the vector leg even when embeddings are available. */
  forceLexical?: boolean;
}

export interface SearchDefaults {
  k: number;
  /** Deny-list applied unless `includeExcluded` is requested; default []. */
  excludedStatuses: string[];
}

const MAX_CHUNKS_PER_DOCUMENT = 2;
/** Both legs over-fetch so fusion and per-document capping have material. */
const CANDIDATE_FACTOR = 10;
const MIN_CANDIDATES = 50;

/**
 * Hybrid search: the query runs against FTS5 (BM25) and sqlite-vec, both
 * rankings are combined with Reciprocal Rank Fusion, and results are capped
 * at 2 chunks per document. Falls back to lexical-only mode ("mode":
 * "lexical") when embeddings or the vector index are unavailable.
 */
export class SearchDocuments {
  constructor(
    private readonly store: IndexStore,
    private readonly embeddings: EmbeddingsProvider | null,
    private readonly defaults: SearchDefaults,
  ) {}

  async execute(query: SearchQuery, observer?: SearchTraceObserver): Promise<SearchResponse> {
    const k = query.k ?? this.defaults.k;
    const requested = this.buildFilters(query);
    // Building trace attempts costs nothing beyond copying arrays `runSearch`
    // already computed — but that copy IS work, so it happens only when an
    // observer was actually given (design.md: "no extra inference").
    const attempts: SearchTraceAttempt[] | undefined = observer ? [] : undefined;
    const first = await this.runSearch(query, requested, k, attempts);
    if (first.results.length > 0) {
      this.notify(observer, attempts);
      return first;
    }

    // Nothing came back. Before reporting a zero — which observed agents read
    // as "search harder" — check whether a filter targeted a field this corpus
    // does not declare at all, and if so retry without it.
    const facets = collectFacets(this.store.listDocuments());
    const { filters: viable, droppedFields } = dropImpossibleFilters(requested, facets);
    if (droppedFields.length > 0) {
      const retry = await this.runSearch(query, viable, k, attempts);
      retry.filterWarning = describeDroppedFilters(droppedFields);
      if (retry.results.length === 0) {
        const reason = explainEmptyResult(viable, facets);
        if (reason !== undefined) retry.noMatchReason = reason;
      }
      this.notify(observer, attempts, retry.filterWarning, retry.noMatchReason);
      return retry;
    }

    const reason = explainEmptyResult(requested, facets);
    if (reason !== undefined) first.noMatchReason = reason;
    this.notify(observer, attempts, undefined, first.noMatchReason);
    return first;
  }

  /** Isolated so a throwing observer can never affect the response already
   * built and about to be returned. */
  private notify(
    observer: SearchTraceObserver | undefined,
    attempts: SearchTraceAttempt[] | undefined,
    filterWarning?: string,
    noMatchReason?: string,
  ): void {
    if (observer === undefined || attempts === undefined) return;
    const trace: SearchTrace = { attempts };
    if (filterWarning !== undefined) trace.filterWarning = filterWarning;
    if (noMatchReason !== undefined) trace.noMatchReason = noMatchReason;
    try {
      observer.onComplete(trace);
    } catch {
      // Deliberately swallowed: a measurement callback's own failure must
      // never surface through production search.
    }
  }

  private async runSearch(
    query: SearchQuery,
    filters: SearchFilters,
    k: number,
    attempts?: SearchTraceAttempt[],
  ): Promise<SearchResponse> {
    const limit = Math.max(MIN_CANDIDATES, k * CANDIDATE_FACTOR);

    const lexicalIds = this.store.searchLexical(query.query, filters, limit);
    const vector = await this.vectorLeg(query, filters, limit);

    const lists = vector.ids === null ? [lexicalIds] : [lexicalIds, vector.ids];
    const fused = reciprocalRankFusion(lists);

    const chunks = this.store.getChunksByIds(fused.map((f) => f.id));
    const chunkById = new Map(chunks.map((c) => [c.id, c]));
    const capped = capPerDocument(
      fused,
      (id) => chunkById.get(id)?.documentId ?? -1,
      MAX_CHUNKS_PER_DOCUMENT,
    );
    const top = capped.slice(0, k);

    const documents = this.store.getDocumentsByIds(chunks.map((c) => c.documentId));
    // Hoisted once per search, not once per result — the same terms
    // `searchLexical`'s `toFtsQuery` used, since both now share
    // `tokenizeQuery` (design.md Decision 2).
    const terms = tokenizeQuery(query.query);
    const results: SearchResultItem[] = [];
    const finalIds: number[] = [];
    for (const entry of top) {
      const chunk = chunkById.get(entry.id);
      if (chunk === undefined) continue;
      const doc = documents.get(chunk.documentId);
      if (doc === undefined) continue;
      // `results.length` is this item's 0-based rank among emitted results,
      // which is what the caller sees — not its index in `top`, where a
      // dropped chunk would leave a hole.
      const rank = results.length;
      // Spans are located for EVERY rank. This reverses
      // `2026-08-06-match-centred-excerpt` design.md Decision 7, which
      // computed them for rank 0 only and declined this on cost ("one
      // locator run per search rather than k"). That cost is now measured:
      // +0.382 ms/search on `ejemplos/` (29 chunks), +0.199 ms on an
      // 888-chunk corpus — directionally real, absolutely negligible.
      // Still ONE branch, not two: a chunk with no locatable term —
      // vector-only, fold-miss, or a term that does not survive flattening
      // — falls back to the same empty-spans prefix path it always did.
      const spans = locateSpans(chunk.content, terms);
      const item: SearchResultItem = {
        path: doc.path,
        title: doc.title,
        section: chunk.heading,
        excerpt: buildExcerpt(chunk.content, excerptBudget(rank), spans),
        score: Number(entry.score.toFixed(4)),
      };
      if (doc.status !== undefined) item.status = doc.status;
      results.push(item);
      finalIds.push(entry.id);
    }

    const mode: SearchMode = vector.ids === null ? "lexical" : "hybrid";

    if (attempts !== undefined) {
      const cappedIdSet = new Set(capped.map((c) => c.id));
      const capRemovals = fused
        .filter((f) => !cappedIdSet.has(f.id))
        .map((f) => ({ id: f.id, documentId: chunkById.get(f.id)?.documentId ?? -1 }));
      attempts.push({
        attemptNumber: attempts.length + 1,
        filters: { ...filters },
        limit,
        lexicalIds: [...lexicalIds],
        vector: vector.trace,
        union: [...new Set(lists.flat())],
        fused: fused.map((f) => ({ id: f.id, score: f.score })),
        cappedIds: capped.map((c) => c.id),
        capRemovals,
        finalIds,
        mode,
      });
    }

    return { mode, results };
  }

  private buildFilters(query: SearchQuery): SearchFilters {
    const filters: SearchFilters = {};
    const type = query.type?.trim();
    if (type !== undefined && type.length > 0) filters.type = type;
    const module = query.module?.trim();
    if (module !== undefined && module.length > 0) filters.module = module;
    const tags = query.tags === undefined ? [] : normalizeTags(query.tags);
    if (tags.length > 0) filters.tags = tags;
    if (query.includeExcluded !== true && this.defaults.excludedStatuses.length > 0) {
      filters.excludedStatuses = this.defaults.excludedStatuses;
    }
    return filters;
  }

  /**
   * Runs the vector leg (or doesn't). `ids: null` means lexical-only mode,
   * exactly as before; `trace` names WHY, for `search-trace.ts` — never
   * inferred after the fact, since "no provider" and "provider threw" are
   * different facts that collapse to the same `null` for production
   * behavior on purpose.
   */
  private async vectorLeg(
    query: SearchQuery,
    filters: SearchFilters,
    limit: number,
  ): Promise<{ ids: number[] | null; trace: VectorLegTrace }> {
    if (query.forceLexical === true) {
      return { ids: null, trace: { available: false, reason: "forced-lexical" } };
    }
    if (this.embeddings === null) {
      return { ids: null, trace: { available: false, reason: "no-provider" } };
    }
    if (!this.store.hasVectors()) {
      return { ids: null, trace: { available: false, reason: "no-vectors" } };
    }
    try {
      // "query: " prefix is required by the E5 embedding family.
      const [vector] = await this.embeddings.embed([`query: ${query.query}`]);
      if (vector === undefined) {
        return { ids: null, trace: { available: false, reason: "empty-embedding" } };
      }
      const ids = this.store.searchVector(vector, filters, limit);
      return { ids, trace: { available: true, ids: [...ids] } };
    } catch {
      // Graceful degradation: a broken embeddings runtime must never take
      // search down with it.
      return { ids: null, trace: { available: false, reason: "embed-failed" } };
    }
  }
}
