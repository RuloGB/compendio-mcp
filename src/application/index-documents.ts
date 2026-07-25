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
  errors: string[];
}

export interface IndexReport {
  mode: SearchMode;
  indexed: IndexedFileReport[];
  skipped: SkippedFileReport[];
  totalChunks: number;
  durationMs: number;
  /** Present when embeddings were requested but unavailable (degraded mode). */
  embeddingsWarning?: string;
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
 * persist. A file is skipped and reported in `skipped` for any resilience
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
    const { files, readErrors } = await this.source.discover();

    const indexed: IndexedFileReport[] = [];
    const skipped: SkippedFileReport[] = readErrors.map((e) => ({
      path: e.path,
      errors: [e.error],
    }));
    const pending: { chunkId: number; text: string }[] = [];

    this.store.reset();

    for (const file of files) {
      const hash = computeHash(file.content);
      const result = transformFile(this.parser, this.policy, this.options, file, hash);

      if (!result.ok) {
        skipped.push({ path: file.path, errors: result.errors });
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
      indexed.push({ path: file.path, title: meta.title, chunks: chunks.length });
    }

    const warning = await this.embedPending(pending);

    const report: IndexReport = {
      mode: warning === null && this.embeddings !== null ? "hybrid" : "lexical",
      indexed,
      skipped,
      totalChunks: pending.length,
      durationMs: Date.now() - start,
    };
    if (warning !== null) report.embeddingsWarning = warning;
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
