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
import type { ProgressEvent, ProgressReporter } from "../domain/progress.js";
import type { IndexedFileReport, SkippedFileReport } from "./index-documents.js";
import { computeHash, describeError, transformFile, type PipelineOptions } from "./index-pipeline.js";

export interface SyncIndexOptions extends PipelineOptions {
  /** Optional progress observability hook; a no-op by default. Left unset by
   * `serve`, which constructs its container with no `onProgress`
   * (`cli.ts:160`) — so every emission added here is inert under `serve` by
   * construction, not by care. */
  onProgress?: ProgressReporter;
}

/** One document whose missing chunk vectors were filled AND COMMITTED during
 * this pass's vector-coverage reconciliation. Never records an attempt: a
 * group whose embed throws, or whose `replaceEmbeddings` throws, contributes
 * nothing here (see `reconcileOne`). */
export interface ReconciledFileReport {
  path: string;
  /** Chunk vectors written for this document — `replaceEmbeddings` commits
   * the whole group in one transaction, so this is exact, never a partial
   * count. */
  chunks: number;
}

export interface SyncReport {
  mode: SearchMode;
  indexed: IndexedFileReport[];
  deleted: string[];
  skipped: SkippedFileReport[];
  totalChunks: number;
  durationMs: number;
  /** Documents whose vector-coverage gaps were filled this pass. Empty on
   * the overwhelmingly common pass; never absent. */
  reconciled: ReconciledFileReport[];
  /** Present when embeddings were requested but unavailable for at least one
   * document or reconciliation group during this pass. */
  embeddingsWarning?: string;
  /** Present, and non-empty, when at least one currently-discovered document
   * decodes under a non-UTF-8 encoding -- surfaced every pass, even when the
   * document's hash is unchanged, since `discover()` decodes every file on
   * every pass regardless of whether it ends up re-indexed. */
  encodingNotices?: EncodingNotice[];
}

/** One discovered file whose hash did not match the persisted value (or has
 * no persisted value at all) -- the output of `diff`, and the input `
 * applyChanged`/`applyOne` consume instead of re-deriving. `known` is
 * `existingDoc !== undefined`, the boolean the resolver-rejection-deletes-
 * the-stale-row rule actually needs; the rest of `IndexedDocument` has no
 * use downstream. */
interface ChangedFile {
  file: DocumentFile;
  hash: string;
  known: boolean;
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
  reconciled: ReconciledFileReport[];
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
    private readonly options: SyncIndexOptions,
  ) {}

  private report(event: ProgressEvent): void {
    this.options.onProgress?.(event);
  }

  async execute(): Promise<SyncReport> {
    const start = Date.now();
    this.report({ phase: "discovery", kind: "start" });
    const { files, readErrors, encodingNotices } = await this.source.discover();
    const existing = this.store.listDocuments();

    const state: PassState = {
      indexed: [],
      skipped: readErrors.map((e) => ({ path: e.path, errors: [e.error] })),
      deleted: [],
      hashMatchPaths: new Set(),
      encodingNotices: [],
      reconciled: [],
    };

    const changed = this.diff(files, existing, encodingNotices ?? [], state);
    this.report({ phase: "files", kind: "start", total: changed.length });
    await this.applyChanged(changed, state);
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
      reconciled: state.reconciled,
    };
    if (state.embeddingsWarning !== undefined) report.embeddingsWarning = state.embeddingsWarning;
    if (state.encodingNotices.length > 0) report.encodingNotices = state.encodingNotices;
    return report;
  }

  /** Synchronous, silent diff over EVERY discovered file: computes each
   * file's fingerprint against the persisted index and decides new/changed
   * vs. hash-match. Carries `discover()`'s per-file encoding notices onto the
   * pass state here -- and only here -- because this is the sub-pass that
   * iterates all discovered files, not just the changed set (design.md
   * Decision 1). Zero `await`s: the changed count is known in full before
   * `files/start` is reported. */
  private diff(
    files: DocumentFile[],
    existing: IndexedDocument[],
    encodingNotices: EncodingNotice[],
    state: PassState,
  ): ChangedFile[] {
    const existingByPath = new Map(existing.map((doc) => [doc.path, doc]));
    const noticeByPath = new Map(encodingNotices.map((n) => [n.path, n]));
    const changed: ChangedFile[] = [];

    for (const file of files) {
      const notice = noticeByPath.get(file.path);
      if (notice !== undefined) state.encodingNotices.push(notice);

      const hash = computeHash(file.content);
      const existingDoc = existingByPath.get(file.path);

      if (existingDoc !== undefined && existingDoc.hash === hash) {
        state.hashMatchPaths.add(file.path);
        continue;
      }

      changed.push({ file, hash, known: existingDoc !== undefined });
    }
    return changed;
  }

  /** Awaiting sub-pass over `diff`'s output only. One `files/tick` call site,
   * hoisted above `applyOne`'s branching, fired AFTER the unit of work
   * commits -- so `current` reaches `total` on every pass, including one
   * where every document fails (design.md Decision 2). */
  private async applyChanged(changed: ChangedFile[], state: PassState): Promise<void> {
    const total = changed.length;
    for (const [i, entry] of changed.entries()) {
      await this.applyOne(entry, state);
      this.report({ phase: "files", kind: "tick", current: i + 1, total, path: entry.file.path });
    }
  }

  /** Today's per-document body, verbatim except its two `continue`
   * statements become `return`: embeds a document's own chunks first, then
   * commits via `upsertDocument` (documents+chunks+fts+vectors together, one
   * transaction). A resolver rejection on a known path deletes the stale
   * row; on a new path it is a plain skip. */
  private async applyOne(entry: ChangedFile, state: PassState): Promise<void> {
    const { file, hash, known } = entry;
    const result = transformFile(this.parser, this.policy, this.options, file, hash);
    if (!result.ok) {
      state.skipped.push({ path: file.path, errors: result.errors });
      if (known) {
        this.tryDelete(file.path, state, false);
      }
      return;
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
   * provider or `listChunksMissingVectors()` finds nothing to do. Reports the
   * `embedding` phase only when there is at least one group to reconcile
   * (design.md Decision 4) -- `batches`/`chunks` are what is ATTEMPTED, known
   * before the first group starts; `reconcileOne` records what is WRITTEN. */
  private async reconcileVectors(state: PassState): Promise<void> {
    if (this.embeddings === null) return;
    const embeddings = this.embeddings; // narrowed once here; passed as a parameter below
    const missing = this.store
      .listChunksMissingVectors()
      .filter((chunk) => state.hashMatchPaths.has(chunk.path));
    const groups = [...groupByPath(missing)];
    if (groups.length === 0) return;

    this.report({ phase: "embedding", kind: "start", batches: groups.length, chunks: missing.length });
    for (const [i, [path, chunksMissing]] of groups.entries()) {
      await this.reconcileOne(embeddings, path, chunksMissing, state);
      this.report({ phase: "embedding", kind: "tick", current: i + 1, total: groups.length });
    }
  }

  /** One reconciliation group's body: embeds the missing chunks, then writes
   * them with `replaceEmbeddings` (one transaction, atomic per group).
   * Records WRITTEN work only, never attempted work (design.md Decision 9):
   * an embed failure sets `embeddingsWarning` and leaves the gap for a future
   * pass; a write failure is a per-document skip. Neither push reaches
   * `state.reconciled`. */
  private async reconcileOne(
    embeddings: EmbeddingsProvider,
    path: string,
    chunksMissing: ChunkMissingVector[],
    state: PassState,
  ): Promise<void> {
    let vectors: Float32Array[];
    try {
      vectors = await embeddings.embed(chunksMissing.map((c) => `passage: ${c.heading}\n${c.content}`));
    } catch (error) {
      state.embeddingsWarning = `embeddings unavailable (${describeError(error)}): search runs in lexical mode`;
      return; // leave as-is (lexical-only), reconsidered on a future pass -- nothing embedded, nothing counted
    }
    try {
      this.store.replaceEmbeddings(
        chunksMissing.map((c, i) => ({ chunkId: c.chunkId, embedding: vectors[i]! })),
      );
      state.reconciled.push({ path, chunks: chunksMissing.length }); // ONLY after the write returns
    } catch (error) {
      state.skipped.push({ path, errors: [describeError(error)] }); // nothing written -> nothing counted
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
