import type { ConventionPolicy } from "../domain/convention.js";
import type { IndexedDocument, SearchMode } from "../domain/model.js";
import type {
  ChunkMissingVector,
  DocumentFile,
  DocumentSource,
  EmbeddingsProvider,
  EncodingNotice,
  IndexStore,
  MarkdownParser,
  ReadError,
} from "../domain/ports.js";
import type { IndexedFileReport, SkippedFileReport } from "./index-documents.js";
import { computeHash, describeError, transformFile, type PipelineOptions } from "./index-pipeline.js";

export interface SyncReport {
  mode: SearchMode;
  indexed: IndexedFileReport[];
  deleted: string[];
  skipped: SkippedFileReport[];
  totalChunks: number;
  durationMs: number;
  /** Present when embeddings were requested but unavailable for at least one
   * document or reconciliation group during this pass. */
  embeddingsWarning?: string;
  /** Present, and non-empty, when at least one currently-discovered document
   * decodes under a non-UTF-8 encoding -- surfaced every pass, even when the
   * document's hash is unchanged, since `discover()` decodes every file on
   * every pass regardless of whether it ends up re-indexed. */
  encodingNotices?: EncodingNotice[];
}

/** Mutable accumulator threaded through one pass's three phases. */
interface PassState {
  indexed: IndexedFileReport[];
  skipped: SkippedFileReport[];
  deleted: string[];
  /** Paths whose hash matched the persisted value this pass — the set the
   * vector-coverage reconciliation phase is restricted to. */
  hashMatchPaths: Set<string>;
  encodingNotices: EncodingNotice[];
  embeddingsWarning?: string;
}

/**
 * Incremental sync pass: diffs the discovered corpus against the persisted
 * index by `path`+`hash` (`IndexStore.listDocuments()`), so only new,
 * changed, or deleted documents do work. Three augmentation rules, all owned
 * here (see design.md's "SyncIndex" decisions):
 *
 * 1. Read failures (`readErrors`) exclude both the reported `path` and
 *    every indexed `path` beneath it from the delete-candidate set.
 * 2. Under `strict`, a resolver rejection on an already-indexed `path`
 *    deletes that stale row; on a brand-new `path` it is a plain skip.
 * 3. Vector-coverage reconciliation is chunk-granular
 *    (`listChunksMissingVectors()`), restricted to this pass's hash-match
 *    set, and written with the idempotent `replaceEmbeddings`.
 *
 * Each new/changed document embeds its own chunks BEFORE `upsertDocument`
 * commits them, so an interruption never leaves a hash-current row without
 * its vectors (see design.md's per-document embedding decision).
 */
export class SyncIndex {
  constructor(
    private readonly source: DocumentSource,
    private readonly parser: MarkdownParser,
    private readonly store: IndexStore,
    private readonly embeddings: EmbeddingsProvider | null,
    private readonly policy: ConventionPolicy,
    private readonly options: PipelineOptions,
  ) {}

  async execute(): Promise<SyncReport> {
    const start = Date.now();
    const { files, readErrors, encodingNotices } = await this.source.discover();
    const existing = this.store.listDocuments();

    const state: PassState = {
      indexed: [],
      skipped: readErrors.map((e) => ({ path: e.path, errors: [e.error] })),
      deleted: [],
      hashMatchPaths: new Set(),
      encodingNotices: [],
    };

    await this.processNewAndChanged(files, existing, encodingNotices ?? [], state);
    this.deleteMissingDocuments(files, existing, readErrors, state);
    await this.reconcileVectors(state);

    const totalChunks = state.indexed.reduce((sum, doc) => sum + doc.chunks, 0);
    const report: SyncReport = {
      mode: state.embeddingsWarning === undefined && this.embeddings !== null ? "hybrid" : "lexical",
      indexed: state.indexed,
      deleted: state.deleted,
      skipped: state.skipped,
      totalChunks,
      durationMs: Date.now() - start,
    };
    if (state.embeddingsWarning !== undefined) report.embeddingsWarning = state.embeddingsWarning;
    if (state.encodingNotices.length > 0) report.encodingNotices = state.encodingNotices;
    return report;
  }

  /** New/changed documents: embeds each document's own chunks first, then
   * commits via `upsertDocument` (documents+chunks+fts+vectors together, one
   * transaction). A resolver rejection on a known path deletes the stale
   * row; on a new path it is a plain skip. Also carries `discover()`'s
   * per-file encoding notices onto the pass state for every currently
   * discovered file, whether hash-matched or re-indexed this pass. */
  private async processNewAndChanged(
    files: DocumentFile[],
    existing: IndexedDocument[],
    encodingNotices: EncodingNotice[],
    state: PassState,
  ): Promise<void> {
    const existingByPath = new Map(existing.map((doc) => [doc.path, doc]));
    const noticeByPath = new Map(encodingNotices.map((n) => [n.path, n]));

    for (const file of files) {
      const notice = noticeByPath.get(file.path);
      if (notice !== undefined) state.encodingNotices.push(notice);

      const hash = computeHash(file.content);
      const existingDoc = existingByPath.get(file.path);

      if (existingDoc !== undefined && existingDoc.hash === hash) {
        state.hashMatchPaths.add(file.path);
        continue;
      }

      const result = transformFile(this.parser, this.policy, this.options, file, hash);
      if (!result.ok) {
        state.skipped.push({ path: file.path, errors: result.errors });
        if (existingDoc !== undefined) {
          this.tryDelete(file.path, state, false);
        }
        continue;
      }

      const { meta, chunks } = result;
      let chunkEmbeddings: Float32Array[] | null = null;
      if (this.embeddings === null) {
        state.embeddingsWarning = "indexed without embeddings (provider unavailable): search runs in lexical mode";
      } else {
        try {
          const texts = chunks.map((c) => `passage: ${c.heading}\n${c.content}`);
          chunkEmbeddings = await this.embeddings.embed(texts);
        } catch (error) {
          state.embeddingsWarning = `embeddings unavailable (${describeError(error)}): search runs in lexical mode`;
        }
      }

      try {
        this.store.upsertDocument(meta, chunks, chunkEmbeddings);
        state.indexed.push({ path: file.path, title: meta.title, chunks: chunks.length });
      } catch (error) {
        state.skipped.push({ path: file.path, errors: [describeError(error)] });
      }
    }
  }

  /** A path present in the index but absent from disk is deleted — unless
   * protected by this pass's readErrors (rule 1: exact path or subtree
   * prefix). */
  private deleteMissingDocuments(
    files: DocumentFile[],
    existing: IndexedDocument[],
    readErrors: ReadError[],
    state: PassState,
  ): void {
    const discoveredPaths = new Set(files.map((f) => f.path));
    const protectedPaths = readErrors.map((e) => e.path);
    for (const doc of existing) {
      if (discoveredPaths.has(doc.path)) continue;
      if (isProtected(doc.path, protectedPaths)) continue;
      this.tryDelete(doc.path, state, true);
    }
  }

  /** Chunk-granular vector-coverage reconciliation, restricted to this
   * pass's hash-match set (rule 3). A no-op when there is no embeddings
   * provider or `listChunksMissingVectors()` finds nothing to do. */
  private async reconcileVectors(state: PassState): Promise<void> {
    if (this.embeddings === null) return;
    const missing = this.store
      .listChunksMissingVectors()
      .filter((chunk) => state.hashMatchPaths.has(chunk.path));

    for (const [path, chunksMissing] of groupByPath(missing)) {
      let vectors: Float32Array[];
      try {
        vectors = await this.embeddings.embed(
          chunksMissing.map((c) => `passage: ${c.heading}\n${c.content}`),
        );
      } catch (error) {
        state.embeddingsWarning = `embeddings unavailable (${describeError(error)}): search runs in lexical mode`;
        continue; // leave as-is (lexical-only), reconsidered on a future pass
      }
      try {
        this.store.replaceEmbeddings(
          chunksMissing.map((c, i) => ({ chunkId: c.chunkId, embedding: vectors[i]! })),
        );
      } catch (error) {
        state.skipped.push({ path, errors: [describeError(error)] });
      }
    }
  }

  /** Deletes a document, reporting `path` in `deleted` only for a
   * disk-absence deletion (never for a resolver-rejection deletion). A
   * store-level failure is a per-document skip, reported in `skipped`
   * instead of aborting the pass. */
  private tryDelete(path: string, state: PassState, reportAsDeleted: boolean): void {
    try {
      this.store.deleteDocument(path);
      if (reportAsDeleted) state.deleted.push(path);
    } catch (error) {
      state.skipped.push({ path, errors: [describeError(error)] });
    }
  }
}

/** True when `path` is exactly a failed path, or lies beneath one (the
 * `<path>/` prefix rule that protects an entire failed subtree). */
function isProtected(path: string, failedPaths: string[]): boolean {
  return failedPaths.some((failed) => path === failed || path.startsWith(`${failed}/`));
}

function groupByPath(chunks: ChunkMissingVector[]): Map<string, ChunkMissingVector[]> {
  const byPath = new Map<string, ChunkMissingVector[]>();
  for (const chunk of chunks) {
    const list = byPath.get(chunk.path) ?? [];
    list.push(chunk);
    byPath.set(chunk.path, list);
  }
  return byPath;
}
