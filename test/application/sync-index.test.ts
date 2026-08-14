import { describe, expect, it } from "vitest";
import { BrokenEmbeddings, FakeEmbeddings } from "../helpers/fake-embeddings";
import { computeHash } from "../../src/application/index-pipeline";
import { SyncIndex } from "../../src/application/sync-index";
import { createConventionPolicy, type ConventionConfig } from "../../src/domain/convention";
import type { Chunk, DocumentMeta, SearchFilters } from "../../src/domain/model";
import type {
  ChunkEmbedding,
  DiscoverResult,
  DocumentFile,
  DocumentSource,
  EmbeddingsProvider,
  EncodingNotice,
  IndexStore,
  ReadError,
  SavedDocument,
} from "../../src/domain/ports";
import { CompositeDocumentSource, type RootSource } from "../../src/infrastructure/fs/composite-document-source";
import { RemarkMarkdownParser } from "../../src/infrastructure/markdown/remark-markdown-parser";
import { SqliteIndexStore } from "../../src/infrastructure/sqlite/sqlite-index-store";

const LOOSE: ConventionConfig = {
  mode: "loose",
  excludedStatuses: [],
  frontmatterFields: { type: "type", module: "module", status: "status" },
};

const STRICT: ConventionConfig = {
  mode: "strict",
  types: ["guide"],
  statuses: ["current"],
  excludedStatuses: [],
  frontmatterFields: { type: "type", module: "module", status: "status" },
};

const OPTIONS = { chunking: { minTokens: 10, maxTokens: 800 }, noChunking: [] };

/** A `DocumentSource` whose `files`/`readErrors` can be swapped between
 * `execute()` calls, to simulate consecutive incremental sync passes. */
class MutableSource implements DocumentSource {
  files: DocumentFile[] = [];
  readErrors: ReadError[] = [];
  encodingNotices: EncodingNotice[] = [];
  async discover(): Promise<DiscoverResult> {
    return { files: this.files, readErrors: this.readErrors, encodingNotices: this.encodingNotices };
  }
}

interface Harness {
  store: SqliteIndexStore;
  source: MutableSource;
  sync: SyncIndex;
  close(): void;
}

function buildHarness(embeddings: EmbeddingsProvider | null, convention: ConventionConfig = LOOSE): Harness {
  const store = new SqliteIndexStore(":memory:");
  const source = new MutableSource();
  const sync = new SyncIndex(
    source,
    new RemarkMarkdownParser(),
    store,
    embeddings,
    createConventionPolicy(convention),
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
    source.files = [{ path: "a.md", content: "# A\n\nText one, unchanged.\n" }];

    const first = await sync.execute();
    expect(first.indexed.map((d) => d.path)).toEqual(["a.md"]);
    expect(first.deleted).toEqual([]);
    expect(store.getDocumentByPath("a.md")).not.toBeNull();

    const second = await sync.execute();
    expect(second.indexed).toEqual([]);
    expect(second.deleted).toEqual([]);
    close();
  });

  it("re-indexes a changed file (hash differs) and replaces its content", async () => {
    const { store, source, sync, close } = buildHarness(new FakeEmbeddings());
    source.files = [{ path: "a.md", content: "# A\n\nOriginal text.\n" }];
    await sync.execute();

    source.files = [{ path: "a.md", content: "# A\n\nCompletely changed text.\n" }];
    const second = await sync.execute();

    expect(second.indexed.map((d) => d.path)).toEqual(["a.md"]);
    const doc = store.getDocumentByPath("a.md")!;
    expect(doc.hash).toBe(computeHash("# A\n\nCompletely changed text.\n"));
    expect(store.searchLexical("changed", {}, 10)).toHaveLength(1);
    close();
  });

  it("deletes a document whose path disappears from disk", async () => {
    const { store, source, sync, close } = buildHarness(new FakeEmbeddings());
    source.files = [{ path: "a.md", content: "# A\n\nText.\n" }];
    await sync.execute();
    expect(store.getDocumentByPath("a.md")).not.toBeNull();

    source.files = [];
    const second = await sync.execute();

    expect(second.deleted).toEqual(["a.md"]);
    expect(store.getDocumentByPath("a.md")).toBeNull();
    close();
  });

  it("treats a rename as delete-plus-insert, with no lineage preserved", async () => {
    const { store, source, sync, close } = buildHarness(new FakeEmbeddings());
    source.files = [{ path: "old.md", content: "# Doc\n\nSame content.\n" }];
    await sync.execute();

    source.files = [{ path: "new.md", content: "# Doc\n\nSame content.\n" }];
    const second = await sync.execute();

    expect(second.deleted).toEqual(["old.md"]);
    expect(second.indexed.map((d) => d.path)).toEqual(["new.md"]);
    expect(store.getDocumentByPath("old.md")).toBeNull();
    expect(store.getDocumentByPath("new.md")).not.toBeNull();
    close();
  });
});

describe("SyncIndex — chunk-granular vector-coverage reconciliation", () => {
  it("does not re-embed a fully vectorized hash-match document", async () => {
    const { store, source, sync, close } = buildHarness(new FakeEmbeddings());
    source.files = [
      { path: "a.md", content: "# A\n\nIntro.\n\n## One\n\nFirst.\n\n## Two\n\nSecond.\n" },
    ];
    await sync.execute();
    expect(store.listChunksMissingVectors()).toEqual([]);

    const second = await sync.execute();
    expect(second.indexed).toEqual([]);
    expect(store.listChunksMissingVectors()).toEqual([]);
    close();
  });

  it("re-embeds only the chunks missing a vector on a partially vectorized hash-match document", async () => {
    const { store, source, sync, close } = buildHarness(new FakeEmbeddings());
    source.files = [
      {
        path: "a.md",
        content:
          "# A\n\nLong intro so it doesn't merge with anything else during chunking.\n\n" +
          "## One\n\nFirst, a paragraph long enough to exceed the minimum token count configured for the test.\n\n" +
          "## Two\n\nSecond, another paragraph just as long so it doesn't merge with the previous one during chunking.\n",
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

    expect(second.indexed).toEqual([]); // hash-match: not re-parsed/re-chunked
    expect(store.listChunksMissingVectors()).toEqual([]); // gap closed
    close();
  });

  it("leaves a vector-coverage gap untouched while the provider is unavailable, and reconsiders it once the provider returns", async () => {
    const store = new SqliteIndexStore(":memory:");
    const source = new MutableSource();
    const parser = new RemarkMarkdownParser();
    const policy = createConventionPolicy(LOOSE);
    const withEmbeddings = new SyncIndex(source, parser, store, new FakeEmbeddings(), policy, OPTIONS);
    const withoutEmbeddings = new SyncIndex(source, parser, store, null, policy, OPTIONS);

    source.files = [
      {
        path: "a.md",
        content:
          "# A\n\nLong intro so it doesn't merge with anything else during chunking.\n\n" +
          "## One\n\nFirst, a paragraph long enough to exceed the minimum token count configured for the test.\n\n" +
          "## Two\n\nSecond, another paragraph just as long so it doesn't merge with the previous one during chunking.\n",
      },
    ];
    await withEmbeddings.execute();
    const doc = store.getDocumentByPath("a.md")!;
    const gapChunk = store.getChunksByDocument(doc.id)[0]!;
    dropVector(store, gapChunk.id);
    expect(store.listChunksMissingVectors()).toHaveLength(1);

    const reportDown = await withoutEmbeddings.execute();
    expect(reportDown.embeddingsWarning).toBeUndefined(); // nothing new/changed this pass, no provider to blame for
    expect(store.listChunksMissingVectors()).toHaveLength(1); // gap persists

    const reportUp = await withEmbeddings.execute();
    expect(reportUp.indexed).toEqual([]);
    expect(store.listChunksMissingVectors()).toEqual([]); // reconsidered and closed
    store.close();
  });

  it("does NOT reconcile a vector gap for a document whose path fails to read this pass (never entered the hash-match set)", async () => {
    const store = new SqliteIndexStore(":memory:");
    const source = new MutableSource();
    const parser = new RemarkMarkdownParser();
    const policy = createConventionPolicy(LOOSE);
    const recording = new RecordingEmbeddings(new FakeEmbeddings());
    const sync = new SyncIndex(source, parser, store, recording, policy, OPTIONS);

    source.files = [{ path: "a.md", content: "# A\n\nTest text long enough for a chunk.\n" }];
    await sync.execute();
    const doc = store.getDocumentByPath("a.md")!;
    const gapChunk = store.getChunksByDocument(doc.id)[0]!;
    dropVector(store, gapChunk.id);
    expect(store.listChunksMissingVectors()).toHaveLength(1);

    recording.calls = []; // reset the call log from the seeding pass above

    // a.md fails to read this pass: absent from `files`, reported in
    // readErrors, so it never enters this pass's hash-match set and is
    // protected from deletion by rule 1 — but it must ALSO stay untouched by
    // vector-coverage reconciliation, which is restricted to that same set.
    source.files = [];
    source.readErrors = [{ path: "a.md", error: "temporary lock" }];

    const report = await sync.execute();

    expect(report.skipped).toEqual([{ path: "a.md", errors: ["temporary lock"] }]);
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
      { path: "guides/a.md", content: "# A\n\nText one.\n" },
      { path: "guides/b.md", content: "# B\n\nText two.\n" },
      { path: "root.md", content: "# Root\n\nText three.\n" },
    ];
    await sync.execute();

    source.files = [{ path: "root.md", content: "# Root\n\nText three.\n" }];
    source.readErrors = [{ path: "guides", error: "permission denied" }];
    const second = await sync.execute();

    expect(second.deleted).toEqual([]);
    expect(second.skipped).toEqual([{ path: "guides", errors: ["permission denied"] }]);
    expect(store.getDocumentByPath("guides/a.md")).not.toBeNull();
    expect(store.getDocumentByPath("guides/b.md")).not.toBeNull();
    close();
  });

  it("excludes a directly-failed file path from delete candidates", async () => {
    const { store, source, sync, close } = buildHarness(new FakeEmbeddings());
    source.files = [{ path: "a.md", content: "# A\n\nText.\n" }];
    await sync.execute();

    source.files = [];
    source.readErrors = [{ path: "a.md", error: "editor lock" }];
    const second = await sync.execute();

    expect(second.deleted).toEqual([]);
    expect(second.skipped).toEqual([{ path: "a.md", errors: ["editor lock"] }]);
    expect(store.getDocumentByPath("a.md")).not.toBeNull();
    close();
  });
});

// --- Gate 4b: a failed root's alias-prefixed ReadError protects its whole ---
// --- subtree from deletion (design.md Decision 4, tasks.md Phase 11). ------
//
// `isProtected` (sync-index.ts, unchanged by this change) matches a
// `ReadError.path` against persisted `path` values via exact-equality or a
// `<path>/` prefix. Persisted paths always carry a root's ALIAS, never its
// declared string, so `ReadError.path` MUST carry the alias too, or
// protection silently never fires. This is the single most load-bearing
// property in this PR — kept as its own describe block, not folded into any
// other test.
describe("SyncIndex — Gate 4b: a failed root's alias-prefixed ReadError protects its subtree from deletion", () => {
  it("protects an existing subtree when readErrors carries the alias (the value CompositeDocumentSource actually pushes)", async () => {
    const { store, source, sync, close } = buildHarness(new FakeEmbeddings());
    source.files = [
      { path: "openspec/specs/indexing/spec.md", content: "# Indexing\n\nText.\n" },
      { path: "openspec/specs/configuration/spec.md", content: "# Configuration\n\nText.\n" },
    ];
    await sync.execute();
    expect(store.getDocumentByPath("openspec/specs/indexing/spec.md")).not.toBeNull();

    // The root fails to read this pass: no files, one ReadError carrying the
    // ALIAS "openspec" -- exactly what CompositeDocumentSource pushes as
    // ReadError.path (Decision 4), never the declared root string.
    source.files = [];
    source.readErrors = [
      { path: "openspec", error: 'declared documentation root "openspec" (/abs/openspec) could not be read: ENOENT' },
    ];
    const second = await sync.execute();

    expect(second.deleted).toEqual([]);
    expect(store.getDocumentByPath("openspec/specs/indexing/spec.md")).not.toBeNull();
    expect(store.getDocumentByPath("openspec/specs/configuration/spec.md")).not.toBeNull();
    close();
  });

  it("the inverse: a ReadError.path carrying the DECLARED string instead of the alias fails to protect and purges the subtree", async () => {
    const { store, source, sync, close } = buildHarness(new FakeEmbeddings());
    source.files = [{ path: "docs/a.md", content: "# A\n\nText.\n" }];
    await sync.execute();
    expect(store.getDocumentByPath("docs/a.md")).not.toBeNull();

    // Simulates what a WRONG implementation of CompositeDocumentSource would
    // push -- root.declared ("packages/app/docs") instead of root.prefix
    // ("docs") -- as ReadError.path. It matches no persisted path (persisted
    // paths are alias-prefixed "docs/..."), so isProtected returns false and
    // the whole subtree is purged: exactly the silent-data-loss failure mode
    // Decision 4 exists to prevent.
    source.files = [];
    source.readErrors = [{ path: "packages/app/docs", error: "unreadable" }];
    const second = await sync.execute();

    expect(second.deleted).toEqual(["docs/a.md"]);
    expect(store.getDocumentByPath("docs/a.md")).toBeNull();
    close();
  });

  it("end to end through the real CompositeDocumentSource over a nested, differently-aliased root — fails if composite-document-source.ts pushed root.declared instead of root.prefix", async () => {
    const store = new SqliteIndexStore(":memory:");
    const parser = new RemarkMarkdownParser();
    const policy = createConventionPolicy(LOOSE);

    // A per-root fake whose failure is toggled between SyncIndex passes,
    // mirroring FileDocumentSource's real root-unreadable throw.
    class MutableRootSource implements DocumentSource {
      files: DocumentFile[] = [];
      shouldFail = false;
      async discover(): Promise<DiscoverResult> {
        if (this.shouldFail) throw new Error("EACCES: permission denied");
        return { files: this.files, readErrors: [] };
      }
    }

    const nestedRoot = new MutableRootSource();
    nestedRoot.files = [
      { path: "docs/a.md", content: "# A\n\nText one.\n" },
      { path: "docs/nested/b.md", content: "# B\n\nText two.\n" },
    ];
    const otherRoot = new MutableRootSource();
    otherRoot.files = [{ path: "openspec/c.md", content: "# C\n\nText three.\n" }];
    // Two roots, so the nested root's later failure is tolerated (N=1
    // degenerates to "all fail" and throws -- not what this test is about).
    const roots: RootSource[] = [
      { declared: "packages/app/docs", dir: "/abs/packages/app/docs", prefix: "docs", source: nestedRoot },
      { declared: "openspec", dir: "/abs/openspec", prefix: "openspec", source: otherRoot },
    ];
    const composite = new CompositeDocumentSource(roots);
    const sync = new SyncIndex(composite, parser, store, new FakeEmbeddings(), policy, OPTIONS);

    await sync.execute();
    expect(store.getDocumentByPath("docs/a.md")).not.toBeNull();
    expect(store.getDocumentByPath("docs/nested/b.md")).not.toBeNull();

    nestedRoot.shouldFail = true;
    const second = await sync.execute();

    expect(second.deleted).toEqual([]);
    expect(store.getDocumentByPath("docs/a.md")).not.toBeNull();
    expect(store.getDocumentByPath("docs/nested/b.md")).not.toBeNull();
    store.close();
  });
});

describe("SyncIndex — resolver rejection on a changed known document deletes the stale row", () => {
  it("deletes the stale row when a known path's changed content fails policy.resolver() under strict", async () => {
    const { store, source, sync, close } = buildHarness(new FakeEmbeddings(), STRICT);
    source.files = [
      { path: "a.md", content: "---\ntype: guide\nmodule: m\nstatus: current\n---\n\n# A\n\nText.\n" },
    ];
    await sync.execute();
    expect(store.getDocumentByPath("a.md")).not.toBeNull();

    source.files = [
      { path: "a.md", content: "---\ntype: invalid\n---\n\n# A changed\n\nOther text.\n" },
    ];
    const second = await sync.execute();

    expect(second.skipped.map((o) => o.path)).toEqual(["a.md"]);
    expect(second.deleted).toEqual([]); // resolver-rejection deletion, not a disk-absence deletion
    expect(store.getDocumentByPath("a.md")).toBeNull();
    close();
  });

  it("is a plain skip, with nothing to delete, when a NEW path fails policy.resolver() under strict", async () => {
    const { store, source, sync, close } = buildHarness(new FakeEmbeddings(), STRICT);
    source.files = [{ path: "b.md", content: "---\ntype: invalid\n---\n\n# B\n\nText.\n" }];

    const report = await sync.execute();

    expect(report.skipped.map((o) => o.path)).toEqual(["b.md"]);
    expect(report.deleted).toEqual([]);
    expect(store.getDocumentByPath("b.md")).toBeNull();
    close();
  });
});

describe("SyncIndex — per-document embedding ordering and graceful degradation", () => {
  it("commits lexical-only with embeddingsWarning when the provider throws for this pass", async () => {
    const { store, source, sync, close } = buildHarness(new BrokenEmbeddings());
    source.files = [{ path: "a.md", content: "# A\n\nText.\n" }];

    const report = await sync.execute();

    expect(report.indexed.map((d) => d.path)).toEqual(["a.md"]);
    expect(report.embeddingsWarning).toContain("roto");
    expect(store.hasVectors()).toBe(false);
    close();
  });

  it("commits lexical-only with embeddingsWarning when no provider is configured", async () => {
    const { store, source, sync, close } = buildHarness(null);
    source.files = [{ path: "a.md", content: "# A\n\nText.\n" }];

    const report = await sync.execute();

    expect(report.indexed.map((d) => d.path)).toEqual(["a.md"]);
    expect(report.embeddingsWarning).toBeDefined();
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
    canPersistVectors(): boolean {
      return this.inner.canPersistVectors();
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
      createConventionPolicy(LOOSE),
      OPTIONS,
    );

    source.files = [
      { path: "a.md", content: "# A\n\nText long enough to produce a real chunk.\n" },
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
      if (path === this.failDeletePath) throw new Error("simulated delete failure");
      this.inner.deleteDocument(path);
    }
    upsertDocument(meta: DocumentMeta, chunks: Chunk[], embeddings: Float32Array[] | null): SavedDocument {
      if (meta.path === this.failUpsertPath) throw new Error("simulated upsert failure");
      return this.inner.upsertDocument(meta, chunks, embeddings);
    }
    canPersistVectors(): boolean {
      return this.inner.canPersistVectors();
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
      { path: "to-delete.md", title: "To delete", summary: "r", tags: [], hash: "old-hash" },
      [{ heading: "H", content: "old content", position: 0 }],
    );
    const store = new ThrowingStore(inner, "fails-upsert.md", "to-delete.md");
    const source = new MutableSource();
    const sync = new SyncIndex(
      source,
      new RemarkMarkdownParser(),
      store,
      new FakeEmbeddings(),
      createConventionPolicy(LOOSE),
      OPTIONS,
    );

    source.files = [
      { path: "ok.md", content: "# OK\n\nGood text.\n" },
      { path: "fails-upsert.md", content: "# Fails\n\nText that isn't saved.\n" },
    ];
    // to-delete.md is indexed in `inner` but absent from this pass's disk listing.

    const report = await sync.execute();

    expect(report.indexed.map((d) => d.path)).toEqual(["ok.md"]);
    expect(report.skipped.map((o) => o.path).sort()).toEqual(["fails-upsert.md", "to-delete.md"]);
    expect(inner.getDocumentByPath("ok.md")).not.toBeNull();
    expect(inner.getDocumentByPath("to-delete.md")).not.toBeNull(); // delete failed: row survives, not orphaned
    inner.close();
  });
});

// --- Gate 4: a transcoded-but-unchanged document is still reported on -----
// --- EVERY pass, not only when its content changes (design.md Decision 1). -
//
// This is an approval test as much as a regression guard: it must hold both
// before and after the diff/applyChanged split (tasks.md Phase 2/3), because
// the notice push belongs in the sub-pass that iterates ALL discovered
// files, not the sub-pass restricted to the changed set. The "natural,
// wrong-looking-right" refactor moves it into the latter and silently drops
// this exact case -- zero coverage existed for it before this change.
describe("SyncIndex — Gate 4: a transcoded-but-unchanged document is reported every pass", () => {
  it("reports encodingNotices for a hash-matched document, and does NOT re-index it", async () => {
    const { store, source, sync, close } = buildHarness(new FakeEmbeddings());
    source.files = [{ path: "cp1252.md", content: "# CP1252\n\nSome text.\n" }];
    await sync.execute();
    expect(store.getDocumentByPath("cp1252.md")).not.toBeNull();

    // Second pass: IDENTICAL content (hash matches), but discover() reports
    // this pass's decode as non-UTF-8 -- the case a two-pass implementation
    // that moves the notice push into the changed-only loop would drop.
    source.encodingNotices = [{ path: "cp1252.md", encoding: "windows-1252" }];
    const second = await sync.execute();

    expect(second.indexed).toEqual([]); // hash matched: nothing re-indexed
    expect(second.encodingNotices).toEqual([{ path: "cp1252.md", encoding: "windows-1252" }]);
    close();
  });
});

// --- Gate 7: SyncReport.reconciled reports WRITTEN vector-coverage-gap ------
// --- work, never ATTEMPTED work (design.md Decision 9, tasks.md Phase 5). --
describe("SyncIndex — Gate 7: SyncReport.reconciled reports written, never attempted, reconciliation work", () => {
  it("R1: a filled vector-coverage gap is reported in reconciled, separately from indexed/totalChunks", async () => {
    const { store, source, sync, close } = buildHarness(new FakeEmbeddings());
    source.files = [
      { path: "a.md", content: "# A\n\nText long enough to produce a real chunk for this test.\n" },
    ];
    await sync.execute();
    const doc = store.getDocumentByPath("a.md")!;
    const gapChunk = store.getChunksByDocument(doc.id)[0]!;
    dropVector(store, gapChunk.id);
    expect(store.listChunksMissingVectors()).toHaveLength(1);

    const second = await sync.execute();

    expect(second.reconciled).toEqual([{ path: "a.md", chunks: 1 }]);
    expect(second.indexed).toEqual([]);
    expect(second.totalChunks).toBe(0);
    close();
  });

  it("R2: an embed failure during reconciliation counts nothing (attempted, not written)", async () => {
    const store = new SqliteIndexStore(":memory:");
    const source = new MutableSource();
    const parser = new RemarkMarkdownParser();
    const policy = createConventionPolicy(LOOSE);
    const withEmbeddings = new SyncIndex(source, parser, store, new FakeEmbeddings(), policy, OPTIONS);
    const withBroken = new SyncIndex(source, parser, store, new BrokenEmbeddings(), policy, OPTIONS);

    source.files = [{ path: "a.md", content: "# A\n\nText long enough for a real chunk.\n" }];
    await withEmbeddings.execute();
    const doc = store.getDocumentByPath("a.md")!;
    const gapChunk = store.getChunksByDocument(doc.id)[0]!;
    dropVector(store, gapChunk.id);

    const report = await withBroken.execute();

    expect(report.reconciled).toEqual([]);
    expect(report.embeddingsWarning).toBeDefined();
    store.close();
  });

  it("R3: a rolled-back replaceEmbeddings write counts nothing, and the document lands in skipped", async () => {
    class ReplaceThrowsStore implements IndexStore {
      constructor(private readonly inner: IndexStore) {}
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
      upsertDocument(meta: DocumentMeta, chunks: Chunk[], embeddings: Float32Array[] | null): SavedDocument {
        return this.inner.upsertDocument(meta, chunks, embeddings);
      }
      canPersistVectors(): boolean {
        return this.inner.canPersistVectors();
      }
      listChunksMissingVectors() {
        return this.inner.listChunksMissingVectors();
      }
      replaceEmbeddings(): void {
        throw new Error("simulated replaceEmbeddings failure");
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

    const inner = new SqliteIndexStore(":memory:");
    const source = new MutableSource();
    const parser = new RemarkMarkdownParser();
    const policy = createConventionPolicy(LOOSE);
    const seedSync = new SyncIndex(source, parser, inner, new FakeEmbeddings(), policy, OPTIONS);

    source.files = [{ path: "a.md", content: "# A\n\nText long enough for a real chunk.\n" }];
    await seedSync.execute();
    const doc = inner.getDocumentByPath("a.md")!;
    const gapChunk = inner.getChunksByDocument(doc.id)[0]!;
    dropVector(inner, gapChunk.id);

    const throwingStore = new ReplaceThrowsStore(inner);
    const sync = new SyncIndex(source, parser, throwingStore, new FakeEmbeddings(), policy, OPTIONS);
    const report = await sync.execute();

    expect(report.reconciled).toEqual([]);
    expect(report.skipped.map((s) => s.path)).toEqual(["a.md"]);
    inner.close();
  });

  it("R4: a changed document and, independently, a hash-matched document with a gap are both reported, never conflated", async () => {
    const { store, source, sync, close } = buildHarness(new FakeEmbeddings());
    source.files = [
      { path: "a.md", content: "# A\n\nText long enough for a real chunk.\n" },
      { path: "b.md", content: "# B\n\nAnother text long enough for a real chunk.\n" },
    ];
    await sync.execute();
    const docB = store.getDocumentByPath("b.md")!;
    const gapChunk = store.getChunksByDocument(docB.id)[0]!;
    dropVector(store, gapChunk.id);

    source.files = [
      { path: "a.md", content: "# A\n\nEDITED text long enough for a real chunk.\n" },
      { path: "b.md", content: "# B\n\nAnother text long enough for a real chunk.\n" },
    ];
    const second = await sync.execute();

    expect(second.indexed.map((d) => d.path)).toEqual(["a.md"]);
    expect(second.reconciled).toEqual([{ path: "b.md", chunks: 1 }]);
    close();
  });
});
