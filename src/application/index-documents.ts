import type { ChunkingOptions } from "../domain/chunking.js";
import type { ConventionPolicy } from "../domain/convention.js";
import type { SearchMode } from "../domain/model.js";
import type {
  DocumentSource,
  EmbeddingsProvider,
  EncodingNotice,
  IndexStore,
  MarkdownParser,
} from "../domain/ports.js";
import type { ProgressEvent, ProgressReporter } from "../domain/progress.js";
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
  /** Present, and non-empty, when at least one document was decoded under a
   * non-UTF-8 encoding during this run -- a reportable event, not a failure:
   * the document is indexed normally. */
  encodingNotices?: EncodingNotice[];
}

/** `${path}: not UTF-8 — decoded as ${encoding} and indexed; re-save as UTF-8
 * to silence this` -- one renderer shared by `index`/`index-md`'s CLI warn
 * loops and `docs_overview`'s `Sync:` block, so the remediation message
 * cannot drift between the three call sites. */
export function formatEncodingNotice(notice: EncodingNotice): string {
  return `${notice.path}: not UTF-8 — decoded as ${notice.encoding} and indexed; re-save as UTF-8 to silence this`;
}

export interface IndexDocumentsOptions {
  chunking: ChunkingOptions;
  /** File names (relative path or basename) exempt from heading-based
   * chunking -- split by size only, via `splitToBound`, never by internal
   * headings. Still emits a single chunk when the body fits within
   * `maxTokens`; splits into several bounded chunks otherwise. The glossary
   * is the canonical case. */
  noChunking: string[];
  embeddingBatchSize?: number;
  /** Optional progress observability hook; a no-op by default. */
  onProgress?: ProgressReporter;
}

const DEFAULT_BATCH_SIZE = 16;

/**
 * Full reindex pipeline: discover -> parse & resolve -> chunk -> embed ->
 * persist. A file is skipped and reported in `skipped` for any resilience
 * reason (unreadable, unparseable, no indexable content) or, under the
 * injected `ConventionPolicy`, for a metadata reason. If the embeddings
 * provider is missing or fails, indexing completes in lexical-only mode
 * instead of crashing (graceful degradation).
 */
export class IndexDocuments {
  constructor(
    private readonly source: DocumentSource,
    private readonly parser: MarkdownParser,
    private readonly store: IndexStore,
    private readonly embeddings: EmbeddingsProvider | null,
    private readonly policy: ConventionPolicy,
    private readonly options: IndexDocumentsOptions,
  ) {}

  async execute(): Promise<IndexReport> {
    const start = Date.now();
    this.report({ phase: "discovery", kind: "start" });
    const { files, readErrors, encodingNotices } = await this.source.discover();

    const indexed: IndexedFileReport[] = [];
    const skipped: SkippedFileReport[] = readErrors.map((e) => ({
      path: e.path,
      errors: [e.error],
    }));
    const pending: { chunkId: number; text: string }[] = [];

    this.store.reset();
    this.report({ phase: "files", kind: "start", total: files.length });

    for (const [i, file] of files.entries()) {
      this.report({ phase: "files", kind: "tick", current: i + 1, total: files.length, path: file.path });
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
    if (encodingNotices !== undefined && encodingNotices.length > 0) report.encodingNotices = encodingNotices;
    return report;
  }

  /** Returns a warning message when embeddings could not be generated. */
  private async embedPending(pending: { chunkId: number; text: string }[]): Promise<string | null> {
    if (this.embeddings === null) {
      return "indexed without embeddings (provider unavailable): search runs in lexical mode";
    }
    const batchSize = this.options.embeddingBatchSize ?? DEFAULT_BATCH_SIZE;
    const batches = Math.ceil(pending.length / batchSize);
    this.report({ phase: "embedding", kind: "start", batches, chunks: pending.length });
    try {
      let batchIndex = 0;
      for (let i = 0; i < pending.length; i += batchSize) {
        const batch = pending.slice(i, i + batchSize);
        // "passage: " prefix is required by the E5 embedding family.
        const vectors = await this.embeddings.embed(batch.map((p) => `passage: ${p.text}`));
        this.store.saveEmbeddings(
          batch.map((p, j) => ({ chunkId: p.chunkId, embedding: vectors[j]! })),
        );
        batchIndex += 1;
        // Reported AFTER the batch is embedded and persisted, so `current`
        // counts completed work. Reporting it before the await made the bar
        // read 100% (N/N) at the exact moment the last — and by far the most
        // expensive — batch was about to start, which is what a user reads as
        // "it finished, then it hung". `embedding/start` already renders the
        // 0/N frame, so nothing is lost by not announcing a batch up front.
        this.report({ phase: "embedding", kind: "tick", current: batchIndex, total: batches });
      }
      return null;
    } catch (error) {
      const reason = describeError(error);
      this.report({ phase: "embedding", kind: "failed", reason });
      return `embeddings unavailable (${reason}): search runs in lexical mode`;
    }
  }

  private report(event: ProgressEvent): void {
    this.options.onProgress?.(event);
  }
}
