import { buildExcerpt } from "../domain/excerpt.js";
import { capPerDocument, reciprocalRankFusion } from "../domain/fusion.js";
import {
  ESTADOS,
  type Estado,
  type SearchFilters,
  type SearchResponse,
  type SearchResultItem,
  type Tipo,
} from "../domain/model.js";
import type { EmbeddingsProvider, IndexStore } from "../domain/ports.js";

export interface SearchQuery {
  query: string;
  tipo?: Tipo;
  modulo?: string;
  etiquetas?: string[];
  k?: number;
  /** Include borrador/obsoleto documents (excluded by default). */
  incluirNoVigentes?: boolean;
  /** Skip the vector leg even when embeddings are available. */
  forzarLexico?: boolean;
}

export interface SearchDefaults {
  k: number;
  estadosExcluidos: Estado[];
}

const MAX_CHUNKS_PER_DOCUMENT = 2;
/** Both legs over-fetch so fusion and per-document capping have material. */
const CANDIDATE_FACTOR = 10;
const MIN_CANDIDATES = 50;

/**
 * Hybrid search: the query runs against FTS5 (BM25) and sqlite-vec, both
 * rankings are combined with Reciprocal Rank Fusion, and results are capped
 * at 2 chunks per document. Falls back to lexical-only mode ("modo":
 * "lexico") when embeddings or the vector index are unavailable.
 */
export class SearchDocuments {
  constructor(
    private readonly store: IndexStore,
    private readonly embeddings: EmbeddingsProvider | null,
    private readonly defaults: SearchDefaults,
  ) {}

  async execute(query: SearchQuery): Promise<SearchResponse> {
    const k = query.k ?? this.defaults.k;
    const filters = this.buildFilters(query);
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
    const resultados: SearchResultItem[] = [];
    for (const entry of top) {
      const chunk = chunkById.get(entry.id);
      if (chunk === undefined) continue;
      const doc = documents.get(chunk.documentId);
      if (doc === undefined) continue;
      resultados.push({
        ruta: doc.ruta,
        titulo: doc.titulo,
        seccion: chunk.encabezado,
        extracto: buildExcerpt(chunk.contenido),
        estado: doc.estado,
        score: Number(entry.score.toFixed(4)),
      });
    }

    return { modo: vectorIds === null ? "lexico" : "hibrido", resultados };
  }

  private buildFilters(query: SearchQuery): SearchFilters {
    const filters: SearchFilters = {};
    if (query.tipo !== undefined) filters.tipo = query.tipo;
    if (query.modulo !== undefined) filters.modulo = query.modulo;
    if (query.etiquetas !== undefined && query.etiquetas.length > 0) {
      filters.etiquetas = query.etiquetas.map((e) => e.toLowerCase());
    }
    if (query.incluirNoVigentes !== true) {
      filters.estados = ESTADOS.filter((e) => !this.defaults.estadosExcluidos.includes(e));
    }
    return filters;
  }

  /** Returns ranked chunk ids, or null when running in lexical-only mode. */
  private async vectorLeg(
    query: SearchQuery,
    filters: SearchFilters,
    limit: number,
  ): Promise<number[] | null> {
    if (query.forzarLexico === true) return null;
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
