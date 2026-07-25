import { describe, expect, it } from "vitest";
import { BrokenEmbeddings, FakeEmbeddings } from "../helpers/fake-embeddings";
import { computeHash } from "../../src/application/index-pipeline";
import { SyncIndex } from "../../src/application/sync-index";
import { crearConvencionPolicy, type ConvencionConfig } from "../../src/domain/convencion";
import type { Chunk, DocumentMeta, SearchFilters } from "../../src/domain/model";
import type {
  ChunkEmbedding,
  DiscoverResult,
  DocumentFile,
  DocumentSource,
  EmbeddingsProvider,
  IndexStore,
  ReadError,
  SavedDocument,
} from "../../src/domain/ports";
import { RemarkMarkdownParser } from "../../src/infrastructure/markdown/remark-markdown-parser";
import { SqliteIndexStore } from "../../src/infrastructure/sqlite/sqlite-index-store";

const LIBRE: ConvencionConfig = {
  modo: "libre",
  excludedStatuses: [],
  camposFrontmatter: { type: "tipo", module: "modulo", status: "estado" },
};

const ESTRICTO: ConvencionConfig = {
  modo: "estricto",
  types: ["guia"],
  statuses: ["vigente"],
  excludedStatuses: [],
  camposFrontmatter: { type: "tipo", module: "modulo", status: "estado" },
};

const OPTIONS = { chunking: { minTokens: 10, maxTokens: 800 }, sinChunking: [] };

/** A `DocumentSource` whose `files`/`erroresLectura` can be swapped between
 * `execute()` calls, to simulate consecutive incremental sync passes. */
class MutableSource implements DocumentSource {
  files: DocumentFile[] = [];
  erroresLectura: ReadError[] = [];
  async discover(): Promise<DiscoverResult> {
    return { files: this.files, erroresLectura: this.erroresLectura };
  }
}

interface Harness {
  store: SqliteIndexStore;
  source: MutableSource;
  sync: SyncIndex;
  close(): void;
}

function buildHarness(embeddings: EmbeddingsProvider | null, convencion: ConvencionConfig = LIBRE): Harness {
  const store = new SqliteIndexStore(":memory:");
  const source = new MutableSource();
  const sync = new SyncIndex(
    source,
    new RemarkMarkdownParser(),
    store,
    embeddings,
    crearConvencionPolicy(convencion),
    OPTIONS,
  );
  return { store, source, sync, close: () => store.close() };
}

/** Raw SQL escape hatch (white-box) to simulate an interrupted embed step:
 * removing exactly one chunk's `chunks_vec` row without touching its hash. */
function dropVector(store: SqliteIndexStore, chunkId: number): void {
  const db = (store as unknown as { db: { prepare: (sql: string) => { run: (...a: unknown[]) => unknown } } })
    .db;
  db.prepare(`DELETE FROM chunks_vec WHERE chunk_id = ?`).run(chunkId);
}

/** Records every `embed()` call's input texts, delegating to `inner` for the
 * actual vectors — lets a test assert the provider was (or was NOT) invoked
 * for specific chunk content, not just check the resulting report. */
class RecordingEmbeddings implements EmbeddingsProvider {
  calls: string[][] = [];
  constructor(private readonly inner: EmbeddingsProvider) {}
  async embed(texts: string[]): Promise<Float32Array[]> {
    this.calls.push(texts);
    return this.inner.embed(texts);
  }
}

describe("SyncIndex — fingerprint-based incremental diff", () => {
  it("indexes a new file, then leaves an unchanged file untouched on the next pass", async () => {
    const { store, source, sync, close } = buildHarness(new FakeEmbeddings());
    source.files = [{ path: "a.md", content: "# A\n\nTexto uno sin cambios.\n" }];

    const first = await sync.execute();
    expect(first.indexados.map((d) => d.path)).toEqual(["a.md"]);
    expect(first.eliminados).toEqual([]);
    expect(store.getDocumentByPath("a.md")).not.toBeNull();

    const second = await sync.execute();
    expect(second.indexados).toEqual([]);
    expect(second.eliminados).toEqual([]);
    close();
  });

  it("re-indexes a changed file (hash differs) and replaces its content", async () => {
    const { store, source, sync, close } = buildHarness(new FakeEmbeddings());
    source.files = [{ path: "a.md", content: "# A\n\nTexto original.\n" }];
    await sync.execute();

    source.files = [{ path: "a.md", content: "# A\n\nTexto completamente cambiado.\n" }];
    const second = await sync.execute();

    expect(second.indexados.map((d) => d.path)).toEqual(["a.md"]);
    const doc = store.getDocumentByPath("a.md")!;
    expect(doc.hash).toBe(computeHash("# A\n\nTexto completamente cambiado.\n"));
    expect(store.searchLexical("cambiado", {}, 10)).toHaveLength(1);
    close();
  });

  it("deletes a document whose path disappears from disk", async () => {
    const { store, source, sync, close } = buildHarness(new FakeEmbeddings());
    source.files = [{ path: "a.md", content: "# A\n\nTexto.\n" }];
    await sync.execute();
    expect(store.getDocumentByPath("a.md")).not.toBeNull();

    source.files = [];
    const second = await sync.execute();

    expect(second.eliminados).toEqual(["a.md"]);
    expect(store.getDocumentByPath("a.md")).toBeNull();
    close();
  });

  it("treats a rename as delete-plus-insert, with no lineage preserved", async () => {
    const { store, source, sync, close } = buildHarness(new FakeEmbeddings());
    source.files = [{ path: "viejo.md", content: "# Doc\n\nContenido igual.\n" }];
    await sync.execute();

    source.files = [{ path: "nuevo.md", content: "# Doc\n\nContenido igual.\n" }];
    const second = await sync.execute();

    expect(second.eliminados).toEqual(["viejo.md"]);
    expect(second.indexados.map((d) => d.path)).toEqual(["nuevo.md"]);
    expect(store.getDocumentByPath("viejo.md")).toBeNull();
    expect(store.getDocumentByPath("nuevo.md")).not.toBeNull();
    close();
  });
});

describe("SyncIndex — chunk-granular vector-coverage reconciliation", () => {
  it("does not re-embed a fully vectorized hash-match document", async () => {
    const { store, source, sync, close } = buildHarness(new FakeEmbeddings());
    source.files = [
      { path: "a.md", content: "# A\n\nIntro.\n\n## Uno\n\nPrimero.\n\n## Dos\n\nSegundo.\n" },
    ];
    await sync.execute();
    expect(store.listChunksMissingVectors()).toEqual([]);

    const second = await sync.execute();
    expect(second.indexados).toEqual([]);
    expect(store.listChunksMissingVectors()).toEqual([]);
    close();
  });

  it("re-embeds only the chunks missing a vector on a partially vectorized hash-match document", async () => {
    const { store, source, sync, close } = buildHarness(new FakeEmbeddings());
    source.files = [
      {
        path: "a.md",
        content:
          "# A\n\nIntro larga para que no se fusione con nada mas en el chunking.\n\n" +
          "## Uno\n\nPrimero, un parrafo suficientemente largo para superar el minimo de tokens configurado en la prueba.\n\n" +
          "## Dos\n\nSegundo, otro parrafo igual de largo para que tampoco se fusione con el anterior en el chunking.\n",
      },
    ];
    await sync.execute();
    const doc = store.getDocumentByPath("a.md")!;
    const chunks = store.getChunksByDocument(doc.id);
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    const gapChunk = chunks[0]!;
    dropVector(store, gapChunk.id);
    expect(store.listChunksMissingVectors()).toEqual([
      { chunkId: gapChunk.id, path: "a.md", heading: gapChunk.heading, content: gapChunk.content },
    ]);

    const second = await sync.execute();

    expect(second.indexados).toEqual([]); // hash-match: not re-parsed/re-chunked
    expect(store.listChunksMissingVectors()).toEqual([]); // gap closed
    close();
  });

  it("leaves a vector-coverage gap untouched while the provider is unavailable, and reconsiders it once the provider returns", async () => {
    const store = new SqliteIndexStore(":memory:");
    const source = new MutableSource();
    const parser = new RemarkMarkdownParser();
    const policy = crearConvencionPolicy(LIBRE);
    const withEmbeddings = new SyncIndex(source, parser, store, new FakeEmbeddings(), policy, OPTIONS);
    const withoutEmbeddings = new SyncIndex(source, parser, store, null, policy, OPTIONS);

    source.files = [
      {
        path: "a.md",
        content:
          "# A\n\nIntro larga para que no se fusione con nada mas en el chunking.\n\n" +
          "## Uno\n\nPrimero, un parrafo suficientemente largo para superar el minimo de tokens configurado en la prueba.\n\n" +
          "## Dos\n\nSegundo, otro parrafo igual de largo para que tampoco se fusione con el anterior en el chunking.\n",
      },
    ];
    await withEmbeddings.execute();
    const doc = store.getDocumentByPath("a.md")!;
    const gapChunk = store.getChunksByDocument(doc.id)[0]!;
    dropVector(store, gapChunk.id);
    expect(store.listChunksMissingVectors()).toHaveLength(1);

    const reportDown = await withoutEmbeddings.execute();
    expect(reportDown.avisoEmbeddings).toBeUndefined(); // nothing new/changed this pass, no provider to blame for
    expect(store.listChunksMissingVectors()).toHaveLength(1); // gap persists

    const reportUp = await withEmbeddings.execute();
    expect(reportUp.indexados).toEqual([]);
    expect(store.listChunksMissingVectors()).toEqual([]); // reconsidered and closed
    store.close();
  });

  it("does NOT reconcile a vector gap for a document whose path fails to read this pass (never entered the hash-match set)", async () => {
    const store = new SqliteIndexStore(":memory:");
    const source = new MutableSource();
    const parser = new RemarkMarkdownParser();
    const policy = crearConvencionPolicy(LIBRE);
    const recording = new RecordingEmbeddings(new FakeEmbeddings());
    const sync = new SyncIndex(source, parser, store, recording, policy, OPTIONS);

    source.files = [{ path: "a.md", content: "# A\n\nTexto de prueba suficientemente largo para un chunk.\n" }];
    await sync.execute();
    const doc = store.getDocumentByPath("a.md")!;
    const gapChunk = store.getChunksByDocument(doc.id)[0]!;
    dropVector(store, gapChunk.id);
    expect(store.listChunksMissingVectors()).toHaveLength(1);

    recording.calls = []; // reset the call log from the seeding pass above

    // a.md fails to read this pass: absent from `files`, reported in
    // erroresLectura, so it never enters this pass's hash-match set and is
    // protected from deletion by rule 1 — but it must ALSO stay untouched by
    // vector-coverage reconciliation, which is restricted to that same set.
    source.files = [];
    source.erroresLectura = [{ path: "a.md", error: "bloqueo temporal" }];

    const report = await sync.execute();

    expect(report.omitidos).toEqual([{ path: "a.md", errores: ["bloqueo temporal"] }]);
    expect(store.getDocumentByPath("a.md")).not.toBeNull(); // protected from deletion (rule 1)
    expect(store.listChunksMissingVectors()).toHaveLength(1); // gap NOT closed
    expect(recording.calls).toEqual([]); // provider never invoked for this document's chunks
    store.close();
  });
});

describe("SyncIndex — read failures protect the affected path subtree from deletion", () => {
  it("excludes a directory-level failed path and every indexed path beneath it from delete candidates", async () => {
    const { store, source, sync, close } = buildHarness(new FakeEmbeddings());
    source.files = [
      { path: "guias/a.md", content: "# A\n\nTexto uno.\n" },
      { path: "guias/b.md", content: "# B\n\nTexto dos.\n" },
      { path: "raiz.md", content: "# Raiz\n\nTexto tres.\n" },
    ];
    await sync.execute();

    source.files = [{ path: "raiz.md", content: "# Raiz\n\nTexto tres.\n" }];
    source.erroresLectura = [{ path: "guias", error: "permiso denegado" }];
    const second = await sync.execute();

    expect(second.eliminados).toEqual([]);
    expect(second.omitidos).toEqual([{ path: "guias", errores: ["permiso denegado"] }]);
    expect(store.getDocumentByPath("guias/a.md")).not.toBeNull();
    expect(store.getDocumentByPath("guias/b.md")).not.toBeNull();
    close();
  });

  it("excludes a directly-failed file path from delete candidates", async () => {
    const { store, source, sync, close } = buildHarness(new FakeEmbeddings());
    source.files = [{ path: "a.md", content: "# A\n\nTexto.\n" }];
    await sync.execute();

    source.files = [];
    source.erroresLectura = [{ path: "a.md", error: "bloqueo del editor" }];
    const second = await sync.execute();

    expect(second.eliminados).toEqual([]);
    expect(second.omitidos).toEqual([{ path: "a.md", errores: ["bloqueo del editor"] }]);
    expect(store.getDocumentByPath("a.md")).not.toBeNull();
    close();
  });
});

describe("SyncIndex — resolver rejection on a changed known document deletes the stale row", () => {
  it("deletes the stale row when a known path's changed content fails policy.resolver() under estricto", async () => {
    const { store, source, sync, close } = buildHarness(new FakeEmbeddings(), ESTRICTO);
    source.files = [
      { path: "a.md", content: "---\ntipo: guia\nmodulo: m\nestado: vigente\n---\n\n# A\n\nTexto.\n" },
    ];
    await sync.execute();
    expect(store.getDocumentByPath("a.md")).not.toBeNull();

    source.files = [
      { path: "a.md", content: "---\ntipo: invalido\n---\n\n# A cambiado\n\nOtro texto.\n" },
    ];
    const second = await sync.execute();

    expect(second.omitidos.map((o) => o.path)).toEqual(["a.md"]);
    expect(second.eliminados).toEqual([]); // resolver-rejection deletion, not a disk-absence deletion
    expect(store.getDocumentByPath("a.md")).toBeNull();
    close();
  });

  it("is a plain skip, with nothing to delete, when a NEW path fails policy.resolver() under estricto", async () => {
    const { store, source, sync, close } = buildHarness(new FakeEmbeddings(), ESTRICTO);
    source.files = [{ path: "b.md", content: "---\ntipo: invalido\n---\n\n# B\n\nTexto.\n" }];

    const report = await sync.execute();

    expect(report.omitidos.map((o) => o.path)).toEqual(["b.md"]);
    expect(report.eliminados).toEqual([]);
    expect(store.getDocumentByPath("b.md")).toBeNull();
    close();
  });
});

describe("SyncIndex — per-document embedding ordering and graceful degradation", () => {
  it("commits lexical-only with avisoEmbeddings when the provider throws for this pass", async () => {
    const { store, source, sync, close } = buildHarness(new BrokenEmbeddings());
    source.files = [{ path: "a.md", content: "# A\n\nTexto.\n" }];

    const report = await sync.execute();

    expect(report.indexados.map((d) => d.path)).toEqual(["a.md"]);
    expect(report.avisoEmbeddings).toContain("roto");
    expect(store.hasVectors()).toBe(false);
    close();
  });

  it("commits lexical-only with avisoEmbeddings when no provider is configured", async () => {
    const { store, source, sync, close } = buildHarness(null);
    source.files = [{ path: "a.md", content: "# A\n\nTexto.\n" }];

    const report = await sync.execute();

    expect(report.indexados.map((d) => d.path)).toEqual(["a.md"]);
    expect(report.avisoEmbeddings).toBeDefined();
    expect(store.hasVectors()).toBe(false);
    close();
  });
});

describe("SyncIndex — embed-before-upsert atomicity (load-bearing: a hash-current row must never lack its vectors)", () => {
  /** Delegates every call to `inner`, except `upsertDocument`, which pushes
   * `upsert:<path>` onto the SHARED `order` log (also used by the
   * embeddings stub below) and records the exact `embeddings` argument it
   * received — one shared log is what makes "embed happened before upsert"
   * a meaningful, directly comparable assertion. */
  class RecordingStore implements IndexStore {
    upsertEmbeddingsAtCallTime: (Float32Array[] | null)[] = [];

    constructor(
      private readonly inner: IndexStore,
      private readonly order: string[],
    ) {}

    upsertDocument(meta: DocumentMeta, chunks: Chunk[], embeddings: Float32Array[] | null): SavedDocument {
      this.order.push(`upsert:${meta.path}`);
      this.upsertEmbeddingsAtCallTime.push(embeddings);
      return this.inner.upsertDocument(meta, chunks, embeddings);
    }
    reset(): void {
      this.inner.reset();
    }
    saveDocument(meta: DocumentMeta, chunks: Chunk[]): SavedDocument {
      return this.inner.saveDocument(meta, chunks);
    }
    saveEmbeddings(items: ChunkEmbedding[]): void {
      this.inner.saveEmbeddings(items);
    }
    deleteDocument(path: string): void {
      this.inner.deleteDocument(path);
    }
    listChunksMissingVectors() {
      return this.inner.listChunksMissingVectors();
    }
    replaceEmbeddings(items: ChunkEmbedding[]): void {
      this.order.push("replaceEmbeddings");
      this.inner.replaceEmbeddings(items);
    }
    listDocuments() {
      return this.inner.listDocuments();
    }
    getDocumentByPath(path: string) {
      return this.inner.getDocumentByPath(path);
    }
    getChunksByDocument(documentId: number) {
      return this.inner.getChunksByDocument(documentId);
    }
    getChunksByIds(ids: number[]) {
      return this.inner.getChunksByIds(ids);
    }
    getDocumentsByIds(ids: number[]) {
      return this.inner.getDocumentsByIds(ids);
    }
    searchLexical(query: string, filters: SearchFilters, limit: number) {
      return this.inner.searchLexical(query, filters, limit);
    }
    searchVector(embedding: Float32Array, filters: SearchFilters, limit: number) {
      return this.inner.searchVector(embedding, filters, limit);
    }
    hasVectors(): boolean {
      return this.inner.hasVectors();
    }
    close(): void {
      this.inner.close();
    }
  }

  it("commits a new/changed document's vectors together with its content in ONE upsertDocument call — never a hash-current row lacking its vectors", async () => {
    const inner = new SqliteIndexStore(":memory:");
    const order: string[] = []; // shared log: embed() and upsertDocument() both push here
    const store = new RecordingStore(inner, order);
    const source = new MutableSource();
    const recordingEmbeddings: EmbeddingsProvider = {
      async embed(texts: string[]): Promise<Float32Array[]> {
        order.push("embed:a.md");
        return new FakeEmbeddings().embed(texts);
      },
    };
    const sync = new SyncIndex(
      source,
      new RemarkMarkdownParser(),
      store,
      recordingEmbeddings,
      crearConvencionPolicy(LIBRE),
      OPTIONS,
    );

    source.files = [
      { path: "a.md", content: "# A\n\nTexto suficientemente largo para producir un chunk real.\n" },
    ];

    await sync.execute();

    // Exactly one write for this document, and it already carries vectors —
    // proves embed-then-upsert as a single atomic commit, not two separate
    // writes an interruption could split apart.
    expect(order.filter((c) => c === "upsert:a.md")).toHaveLength(1);
    expect(store.upsertEmbeddingsAtCallTime).toHaveLength(1);
    expect(store.upsertEmbeddingsAtCallTime[0]).not.toBeNull();

    // The provider's embed() call for this path happened strictly BEFORE the
    // store commit for the same path — one shared log makes this a direct,
    // meaningful index comparison rather than two independently-timed spies.
    expect(order).toEqual(["embed:a.md", "upsert:a.md"]);

    inner.close();
  });
});

describe("SyncIndex — per-document write-failure resilience", () => {
  class ThrowingStore implements IndexStore {
    constructor(
      private readonly inner: IndexStore,
      private readonly failUpsertPath: string,
      private readonly failDeletePath: string,
    ) {}
    reset(): void {
      this.inner.reset();
    }
    saveDocument(meta: DocumentMeta, chunks: Chunk[]): SavedDocument {
      return this.inner.saveDocument(meta, chunks);
    }
    saveEmbeddings(items: ChunkEmbedding[]): void {
      this.inner.saveEmbeddings(items);
    }
    deleteDocument(path: string): void {
      if (path === this.failDeletePath) throw new Error("fallo simulado de borrado");
      this.inner.deleteDocument(path);
    }
    upsertDocument(meta: DocumentMeta, chunks: Chunk[], embeddings: Float32Array[] | null): SavedDocument {
      if (meta.path === this.failUpsertPath) throw new Error("fallo simulado de upsert");
      return this.inner.upsertDocument(meta, chunks, embeddings);
    }
    listChunksMissingVectors() {
      return this.inner.listChunksMissingVectors();
    }
    replaceEmbeddings(items: ChunkEmbedding[]): void {
      this.inner.replaceEmbeddings(items);
    }
    listDocuments() {
      return this.inner.listDocuments();
    }
    getDocumentByPath(path: string) {
      return this.inner.getDocumentByPath(path);
    }
    getChunksByDocument(documentId: number) {
      return this.inner.getChunksByDocument(documentId);
    }
    getChunksByIds(ids: number[]) {
      return this.inner.getChunksByIds(ids);
    }
    getDocumentsByIds(ids: number[]) {
      return this.inner.getDocumentsByIds(ids);
    }
    searchLexical(query: string, filters: SearchFilters, limit: number) {
      return this.inner.searchLexical(query, filters, limit);
    }
    searchVector(embedding: Float32Array, filters: SearchFilters, limit: number) {
      return this.inner.searchVector(embedding, filters, limit);
    }
    hasVectors(): boolean {
      return this.inner.hasVectors();
    }
    close(): void {
      this.inner.close();
    }
  }

  it("skips a document whose upsertDocument throws and one whose deleteDocument throws, completing the rest of the pass", async () => {
    const inner = new SqliteIndexStore(":memory:");
    inner.saveDocument(
      { path: "a-borrar.md", title: "A borrar", summary: "r", tags: [], hash: "hash-antiguo" },
      [{ heading: "H", content: "contenido viejo", position: 0 }],
    );
    const store = new ThrowingStore(inner, "falla-upsert.md", "a-borrar.md");
    const source = new MutableSource();
    const sync = new SyncIndex(
      source,
      new RemarkMarkdownParser(),
      store,
      new FakeEmbeddings(),
      crearConvencionPolicy(LIBRE),
      OPTIONS,
    );

    source.files = [
      { path: "ok.md", content: "# OK\n\nTexto bien.\n" },
      { path: "falla-upsert.md", content: "# Falla\n\nTexto que no se guarda.\n" },
    ];
    // a-borrar.md is indexed in `inner` but absent from this pass's disk listing.

    const report = await sync.execute();

    expect(report.indexados.map((d) => d.path)).toEqual(["ok.md"]);
    expect(report.omitidos.map((o) => o.path).sort()).toEqual(["a-borrar.md", "falla-upsert.md"]);
    expect(inner.getDocumentByPath("ok.md")).not.toBeNull();
    expect(inner.getDocumentByPath("a-borrar.md")).not.toBeNull(); // delete failed: row survives, not orphaned
    inner.close();
  });
});
