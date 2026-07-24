import type { ConvencionPolicy } from "../domain/convencion.js";
import type { IndexedDocument, SearchMode } from "../domain/model.js";
import type {
  ChunkMissingVector,
  DocumentFile,
  DocumentSource,
  EmbeddingsProvider,
  IndexStore,
  MarkdownParser,
  ReadError,
} from "../domain/ports.js";
import type { IndexedFileReport, SkippedFileReport } from "./index-documents.js";
import { computeHash, describeError, transformFile, type PipelineOptions } from "./index-pipeline.js";

export interface SyncReport {
  modo: SearchMode;
  indexados: IndexedFileReport[];
  eliminados: string[];
  omitidos: SkippedFileReport[];
  totalChunks: number;
  duracionMs: number;
  /** Present when embeddings were requested but unavailable for at least one
   * document or reconciliation group during this pass. */
  avisoEmbeddings?: string;
}

/** Mutable accumulator threaded through one pass's three phases. */
interface PassState {
  indexados: IndexedFileReport[];
  omitidos: SkippedFileReport[];
  eliminados: string[];
  /** Rutas whose hash matched the persisted value this pass — the set the
   * vector-coverage reconciliation phase is restricted to. */
  hashMatchRutas: Set<string>;
  avisoEmbeddings?: string;
}

/**
 * Incremental sync pass: diffs the discovered corpus against the persisted
 * index by `ruta`+`hash` (`IndexStore.listDocuments()`), so only new,
 * changed, or deleted documents do work. Three augmentation rules, all owned
 * here (see design.md's "SyncIndex" decisions):
 *
 * 1. Read failures (`erroresLectura`) exclude both the reported `ruta` and
 *    every indexed `ruta` beneath it from the delete-candidate set.
 * 2. Under `estricto`, a resolver rejection on an already-indexed `ruta`
 *    deletes that stale row; on a brand-new `ruta` it is a plain skip.
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
    private readonly policy: ConvencionPolicy,
    private readonly options: PipelineOptions,
  ) {}

  async execute(): Promise<SyncReport> {
    const start = Date.now();
    const { files, erroresLectura } = await this.source.discover();
    const existing = this.store.listDocuments();

    const state: PassState = {
      indexados: [],
      omitidos: erroresLectura.map((e) => ({ ruta: e.ruta, errores: [e.error] })),
      eliminados: [],
      hashMatchRutas: new Set(),
    };

    await this.processNewAndChanged(files, existing, state);
    this.deleteMissingDocuments(files, existing, erroresLectura, state);
    await this.reconcileVectors(state);

    const totalChunks = state.indexados.reduce((sum, doc) => sum + doc.chunks, 0);
    const report: SyncReport = {
      modo: state.avisoEmbeddings === undefined && this.embeddings !== null ? "hibrido" : "lexico",
      indexados: state.indexados,
      eliminados: state.eliminados,
      omitidos: state.omitidos,
      totalChunks,
      duracionMs: Date.now() - start,
    };
    if (state.avisoEmbeddings !== undefined) report.avisoEmbeddings = state.avisoEmbeddings;
    return report;
  }

  /** New/changed documents: embeds each document's own chunks first, then
   * commits via `upsertDocument` (documents+chunks+fts+vectors together, one
   * transaction). A resolver rejection on a known ruta deletes the stale
   * row; on a new ruta it is a plain skip. */
  private async processNewAndChanged(
    files: DocumentFile[],
    existing: IndexedDocument[],
    state: PassState,
  ): Promise<void> {
    const existingByRuta = new Map(existing.map((doc) => [doc.ruta, doc]));

    for (const file of files) {
      const hash = computeHash(file.contenido);
      const existingDoc = existingByRuta.get(file.ruta);

      if (existingDoc !== undefined && existingDoc.hash === hash) {
        state.hashMatchRutas.add(file.ruta);
        continue;
      }

      const result = transformFile(this.parser, this.policy, this.options, file, hash);
      if (!result.ok) {
        state.omitidos.push({ ruta: file.ruta, errores: result.errores });
        if (existingDoc !== undefined) {
          this.tryDelete(file.ruta, state, false);
        }
        continue;
      }

      const { meta, chunks } = result;
      let chunkEmbeddings: Float32Array[] | null = null;
      if (this.embeddings === null) {
        state.avisoEmbeddings = "indexado sin embeddings (proveedor no disponible): busqueda en modo lexico";
      } else {
        try {
          const texts = chunks.map((c) => `passage: ${c.encabezado}\n${c.contenido}`);
          chunkEmbeddings = await this.embeddings.embed(texts);
        } catch (error) {
          state.avisoEmbeddings = `embeddings no disponibles (${describeError(error)}): busqueda en modo lexico`;
        }
      }

      try {
        this.store.upsertDocument(meta, chunks, chunkEmbeddings);
        state.indexados.push({ ruta: file.ruta, titulo: meta.titulo, chunks: chunks.length });
      } catch (error) {
        state.omitidos.push({ ruta: file.ruta, errores: [describeError(error)] });
      }
    }
  }

  /** A ruta present in the index but absent from disk is deleted — unless
   * protected by this pass's erroresLectura (rule 1: exact ruta or subtree
   * prefix). */
  private deleteMissingDocuments(
    files: DocumentFile[],
    existing: IndexedDocument[],
    erroresLectura: ReadError[],
    state: PassState,
  ): void {
    const discoveredRutas = new Set(files.map((f) => f.ruta));
    const protectedRutas = erroresLectura.map((e) => e.ruta);
    for (const doc of existing) {
      if (discoveredRutas.has(doc.ruta)) continue;
      if (isProtected(doc.ruta, protectedRutas)) continue;
      this.tryDelete(doc.ruta, state, true);
    }
  }

  /** Chunk-granular vector-coverage reconciliation, restricted to this
   * pass's hash-match set (rule 3). A no-op when there is no embeddings
   * provider or `listChunksMissingVectors()` finds nothing to do. */
  private async reconcileVectors(state: PassState): Promise<void> {
    if (this.embeddings === null) return;
    const missing = this.store
      .listChunksMissingVectors()
      .filter((chunk) => state.hashMatchRutas.has(chunk.ruta));

    for (const [ruta, chunksMissing] of groupByRuta(missing)) {
      let vectors: Float32Array[];
      try {
        vectors = await this.embeddings.embed(
          chunksMissing.map((c) => `passage: ${c.encabezado}\n${c.contenido}`),
        );
      } catch (error) {
        state.avisoEmbeddings = `embeddings no disponibles (${describeError(error)}): busqueda en modo lexico`;
        continue; // leave as-is (lexical-only), reconsidered on a future pass
      }
      try {
        this.store.replaceEmbeddings(
          chunksMissing.map((c, i) => ({ chunkId: c.chunkId, embedding: vectors[i]! })),
        );
      } catch (error) {
        state.omitidos.push({ ruta, errores: [describeError(error)] });
      }
    }
  }

  /** Deletes a document, reporting `ruta` in `eliminados` only for a
   * disk-absence deletion (never for a resolver-rejection deletion). A
   * store-level failure is a per-document skip, reported in `omitidos`
   * instead of aborting the pass. */
  private tryDelete(ruta: string, state: PassState, reportAsEliminado: boolean): void {
    try {
      this.store.deleteDocument(ruta);
      if (reportAsEliminado) state.eliminados.push(ruta);
    } catch (error) {
      state.omitidos.push({ ruta, errores: [describeError(error)] });
    }
  }
}

/** True when `ruta` is exactly a failed ruta, or lies beneath one (the
 * `<ruta>/` prefix rule that protects an entire failed subtree). */
function isProtected(ruta: string, failedRutas: string[]): boolean {
  return failedRutas.some((failed) => ruta === failed || ruta.startsWith(`${failed}/`));
}

function groupByRuta(chunks: ChunkMissingVector[]): Map<string, ChunkMissingVector[]> {
  const byRuta = new Map<string, ChunkMissingVector[]>();
  for (const chunk of chunks) {
    const list = byRuta.get(chunk.ruta) ?? [];
    list.push(chunk);
    byRuta.set(chunk.ruta, list);
  }
  return byRuta;
}
