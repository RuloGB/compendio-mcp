import { buildExcerpt, excerptBudget } from "../domain/excerpt.js";
import { capPerDocument, reciprocalRankFusion } from "../domain/fusion.js";
import type { SearchFilters, SearchResponse, SearchResultItem } from "../domain/model.js";
import {
  collectFacets,
  describeDroppedFilters,
  dropImpossibleFilters,
  explainEmptyResult,
} from "../domain/search-diagnostics.js";
import type { EmbeddingsProvider, IndexStore } from "../domain/ports.js";

export interface SearchQuery {
  query: string;
  /** Open string, project-defined; empty/whitespace-only is treated as absent. */
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

  async execute(query: SearchQuery): Promise<SearchResponse> {
    const k = query.k ?? this.defaults.k;
    const requested = this.buildFilters(query);
    const first = await this.runSearch(query, requested, k);
    if (first.results.length > 0) return first;

    // Nothing came back. Before reporting a zero — which observed agents read
    // as "search harder" — check whether a filter targeted a field this corpus
    // does not declare at all, and if so retry without it.
    const facets = collectFacets(this.store.listDocuments());
    const { filters: viable, droppedFields } = dropImpossibleFilters(requested, facets);
    if (droppedFields.length > 0) {
      const retry = await this.runSearch(query, viable, k);
      retry.filterWarning = describeDroppedFilters(droppedFields);
      if (retry.results.length === 0) {
        const reason = explainEmptyResult(viable, facets);
        if (reason !== undefined) retry.noMatchReason = reason;
      }
      return retry;
    }

    const reason = explainEmptyResult(requested, facets);
    if (reason !== undefined) first.noMatchReason = reason;
    return first;
  }

  private async runSearch(
    query: SearchQuery,
    filters: SearchFilters,
    k: number,
  ): Promise<SearchResponse> {
    const limit = Math.max(MIN_CANDIDATES, k * CANDIDATE_FACTOR);

    const lexicalIds = this.store.searchLexical(query.query, filters, limit);
    const vectorIds = await this.vectorLeg(query, filters, limit);

    const lists = vectorIds === null ? [lexicalIds] : [lexicalIds, vectorIds];
    const fused = reciprocalRankFusion(lists);

    const chunks = this.store.getChunksByIds(fused.map((f) => f.id));
    const chunkById = new Map(chunks.map((c) => [c.id, c]));
    const top = capPerDocument(
      fused,
      (id) => chunkById.get(id)?.documentId ?? -1,
      MAX_CHUNKS_PER_DOCUMENT,
    ).slice(0, k);

    const documents = this.store.getDocumentsByIds(chunks.map((c) => c.documentId));
    const results: SearchResultItem[] = [];
    for (const entry of top) {
      const chunk = chunkById.get(entry.id);
      if (chunk === undefined) continue;
      const doc = documents.get(chunk.documentId);
      if (doc === undefined) continue;
      const item: SearchResultItem = {
        path: doc.path,
        title: doc.title,
        section: chunk.heading,
        // `results.length` is this item's 0-based rank among emitted results,
        // which is what the caller sees — not its index in `top`, where a
        // dropped chunk would leave a hole.
        excerpt: buildExcerpt(chunk.content, excerptBudget(results.length)),
        score: Number(entry.score.toFixed(4)),
      };
      if (doc.status !== undefined) item.status = doc.status;
      results.push(item);
    }

    return { mode: vectorIds === null ? "lexical" : "hybrid", results };
  }

  private buildFilters(query: SearchQuery): SearchFilters {
    const filters: SearchFilters = {};
    const type = query.type?.trim();
    if (type !== undefined && type.length > 0) filters.type = type;
    if (query.module !== undefined) filters.module = query.module;
    if (query.tags !== undefined && query.tags.length > 0) {
      filters.tags = query.tags.map((e) => e.toLowerCase());
    }
    if (query.includeExcluded !== true && this.defaults.excludedStatuses.length > 0) {
      filters.excludedStatuses = this.defaults.excludedStatuses;
    }
    return filters;
  }

  /** Returns ranked chunk ids, or null when running in lexical-only mode. */
  private async vectorLeg(
    query: SearchQuery,
    filters: SearchFilters,
    limit: number,
  ): Promise<number[] | null> {
    if (query.forceLexical === true) return null;
    if (this.embeddings === null || !this.store.hasVectors()) return null;
    try {
      // "query: " prefix is required by the E5 embedding family.
      const [vector] = await this.embeddings.embed([`query: ${query.query}`]);
      if (vector === undefined) return null;
      return this.store.searchVector(vector, filters, limit);
    } catch {
      // Graceful degradation: a broken embeddings runtime must never take
      // search down with it.
      return null;
    }
  }
}
