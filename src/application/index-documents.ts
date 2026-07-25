import type { ChunkingOptions } from "../domain/chunking.js";
import type { ConvencionPolicy } from "../domain/convencion.js";
import type { SearchMode } from "../domain/model.js";
import type {
  DocumentSource,
  EmbeddingsProvider,
  IndexStore,
  MarkdownParser,
} from "../domain/ports.js";
import { computeHash, describeError, transformFile } from "./index-pipeline.js";

export interface IndexedFileReport {
  path: string;
  title: string;
  chunks: number;
}

export interface SkippedFileReport {
  path: string;
  errores: string[];
}

export interface IndexReport {
  modo: SearchMode;
  indexados: IndexedFileReport[];
  omitidos: SkippedFileReport[];
  totalChunks: number;
  duracionMs: number;
  /** Present when embeddings were requested but unavailable (degraded mode). */
  avisoEmbeddings?: string;
}

export interface IndexDocumentsOptions {
  chunking: ChunkingOptions;
  /** File names (relative path or basename) indexed as a single chunk,
   * without heading-based chunking. The glossary is the canonical case. */
  sinChunking: string[];
  embeddingBatchSize?: number;
}

const DEFAULT_BATCH_SIZE = 16;

/**
 * Full reindex pipeline: discover -> parse & resolve -> chunk -> embed ->
 * persist. A file is skipped and reported in `omitidos` for any resilience
 * reason (unreadable, unparseable, no indexable content) or, under the
 * injected `ConvencionPolicy`, for a metadata reason. If the embeddings
 * provider is missing or fails, indexing completes in lexical-only mode
 * instead of crashing (graceful degradation).
 */
export class IndexDocuments {
  constructor(
    private readonly source: DocumentSource,
    private readonly parser: MarkdownParser,
    private readonly store: IndexStore,
    private readonly embeddings: EmbeddingsProvider | null,
    private readonly policy: ConvencionPolicy,
    private readonly options: IndexDocumentsOptions,
  ) {}

  async execute(): Promise<IndexReport> {
    const start = Date.now();
    const { files, erroresLectura } = await this.source.discover();

    const indexados: IndexedFileReport[] = [];
    const omitidos: SkippedFileReport[] = erroresLectura.map((e) => ({
      path: e.path,
      errores: [e.error],
    }));
    const pending: { chunkId: number; text: string }[] = [];

    this.store.reset();

    for (const file of files) {
      const hash = computeHash(file.content);
      const result = transformFile(this.parser, this.policy, this.options, file, hash);

      if (!result.ok) {
        omitidos.push({ path: file.path, errores: result.errores });
        continue;
      }

      const { meta, chunks } = result;
      const saved = this.store.saveDocument(meta, chunks);
      chunks.forEach((chunk, i) => {
        pending.push({
          chunkId: saved.chunkIds[i]!,
          text: `${chunk.heading}\n${chunk.content}`,
        });
      });
      indexados.push({ path: file.path, title: meta.title, chunks: chunks.length });
    }

    const aviso = await this.embedPending(pending);

    const report: IndexReport = {
      modo: aviso === null && this.embeddings !== null ? "hibrido" : "lexico",
      indexados,
      omitidos,
      totalChunks: pending.length,
      duracionMs: Date.now() - start,
    };
    if (aviso !== null) report.avisoEmbeddings = aviso;
    return report;
  }

  /** Returns a warning message when embeddings could not be generated. */
  private async embedPending(pending: { chunkId: number; text: string }[]): Promise<string | null> {
    if (this.embeddings === null) {
      return "indexado sin embeddings (proveedor no disponible): busqueda en modo lexico";
    }
    const batchSize = this.options.embeddingBatchSize ?? DEFAULT_BATCH_SIZE;
    try {
      for (let i = 0; i < pending.length; i += batchSize) {
        const batch = pending.slice(i, i + batchSize);
        // "passage: " prefix is required by the E5 embedding family.
        const vectors = await this.embeddings.embed(batch.map((p) => `passage: ${p.text}`));
        this.store.saveEmbeddings(
          batch.map((p, j) => ({ chunkId: p.chunkId, embedding: vectors[j]! })),
        );
      }
      return null;
    } catch (error) {
      return `embeddings no disponibles (${describeError(error)}): busqueda en modo lexico`;
    }
  }

}
