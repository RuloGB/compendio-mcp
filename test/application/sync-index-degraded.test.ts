import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import RealDatabase from "better-sqlite3";
import { FakeEmbeddings } from "../helpers/fake-embeddings";
import { IndexDocuments } from "../../src/application/index-documents";
import { SyncIndex } from "../../src/application/sync-index";
import { createConventionPolicy, type ConventionConfig } from "../../src/domain/convention";
import type {
  DiscoverResult,
  DocumentFile,
  DocumentSource,
  EmbeddingsProvider,
  EncodingNotice,
  ReadError,
} from "../../src/domain/ports";
import { RemarkMarkdownParser } from "../../src/infrastructure/markdown/remark-markdown-parser";

// `vi.mock` is file-scoped: only this file's `SqliteIndexStore` instances are
// degraded. `test/infrastructure/sqlite-index-store.test.ts` and
// `test/application/sync-index.test.ts` are unaffected (design.md
// Decision 6). The real `loadVectorExtension` (`sqlite-index-store.ts:91-98`)
// then takes its real `return false` branch, so every store constructed
// under this mock is genuinely degraded -- not a simulated flag.
vi.mock("sqlite-vec", () => ({
  load: () => {
    throw new Error("simulated: sqlite-vec unavailable on this platform");
  },
}));

const { SqliteIndexStore } = await import("../../src/infrastructure/sqlite/sqlite-index-store");

const LOOSE: ConventionConfig = {
  mode: "loose",
  excludedStatuses: [],
  frontmatterFields: { type: "type", module: "module", status: "status" },
};

const OPTIONS = { chunking: { minTokens: 10, maxTokens: 800 }, noChunking: [] };

/** Mirrors `MutableSource` in `sync-index.test.ts:40-47` -- re-declared here
 * rather than imported, since that class is not exported there. Keeping this
 * file self-contained is the same reasoning `RecordingEmbeddings` below
 * follows (design.md Decision 6): `sync-index.test.ts`'s diff stays
 * additions-only. */
class MutableSource implements DocumentSource {
  files: DocumentFile[] = [];
  readErrors: ReadError[] = [];
  encodingNotices: EncodingNotice[] = [];
  async discover(): Promise<DiscoverResult> {
    return { files: this.files, readErrors: this.readErrors, encodingNotices: this.encodingNotices };
  }
}

/** Mirrors `RecordingEmbeddings` in `sync-index.test.ts:81-88` -- re-declared
 * rather than imported, to keep that file's diff additions-only (design.md
 * Decision 6). */
class RecordingEmbeddings implements EmbeddingsProvider {
  calls: string[][] = [];
  constructor(private readonly inner: EmbeddingsProvider) {}
  async embed(texts: string[]): Promise<Float32Array[]> {
    this.calls.push(texts);
    return this.inner.embed(texts);
  }
}

interface Harness {
  store: InstanceType<typeof SqliteIndexStore>;
  source: MutableSource;
  sync: SyncIndex;
  close(): void;
}

function buildHarness(embeddings: EmbeddingsProvider): Harness {
  const store = new SqliteIndexStore(":memory:");
  const source = new MutableSource();
  const sync = new SyncIndex(
    source,
    new RemarkMarkdownParser(),
    store,
    embeddings,
    createConventionPolicy(LOOSE),
    OPTIONS,
  );
  return { store, source, sync, close: () => store.close() };
}

/** Seeds a real `chunks_vec` table using the ACTUAL (unmocked) sqlite-vec
 * extension, then closes the connection -- so the file on disk genuinely
 * carries the table before it is reopened through the mocked (degraded)
 * loader (same technique as `sqlite-index-store-degraded.test.ts`'s D4/D5).
 * A `:memory:` database cannot be used here: it does not survive `close()`. */
async function seedCarriedOverVectorTable(file: string): Promise<void> {
  const real = await vi.importActual<typeof import("sqlite-vec")>("sqlite-vec");
  const db = new RealDatabase(file);
  real.load(db);
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
      chunk_id INTEGER PRIMARY KEY,
      embedding FLOAT[3]
    );
  `);
  db.close();
}

// Every store in this file is degraded by construction (the `vi.mock` above).
// No case here may assert `report.mode === "hybrid"` -- that would mean the
// mock silently failed to take effect, the one way this file could go green
// while proving nothing (design.md, "Do not assert report.mode === 'hybrid'
// anywhere in this file"). G1's `lexical` assertion doubles as the mock's
// own liveness check; D1 (sqlite-index-store-degraded.test.ts) pins it
// independently at the adapter.
describe("SyncIndex — degraded (sqlite-vec unavailable): vectors not persisted, still reported and still searchable", () => {
  it("G1: one new document, working provider, degraded store -> lexical mode, warning names vector storage not the provider", async () => {
    const { source, sync, close } = buildHarness(new FakeEmbeddings());
    source.files = [{ path: "a.md", content: "# A\n\nText long enough for a real chunk.\n" }];

    const report = await sync.execute();

    expect(report.mode).toBe("lexical");
    expect(report.embeddingsWarning).toBeDefined();
    expect(report.embeddingsWarning).toContain("vector storage");
    expect(report.embeddingsWarning).not.toContain("provider unavailable");
    close();
  });

  it("G2: the same pass -- the document is indexed, not skipped, and lexically searchable", async () => {
    const { store, source, sync, close } = buildHarness(new FakeEmbeddings());
    source.files = [
      { path: "a.md", content: "# A\n\nSearchable content long enough for a real chunk.\n" },
    ];

    const report = await sync.execute();

    expect(report.indexed.map((d) => d.path)).toEqual(["a.md"]);
    expect(report.skipped).toEqual([]);
    expect(store.searchLexical("searchable", {}, 10)).toHaveLength(1);
    close();
  });

  it("G3: the embeddings provider is never invoked -- zero embed() calls when vectors cannot be persisted", async () => {
    const recording = new RecordingEmbeddings(new FakeEmbeddings());
    const { source, sync, close } = buildHarness(recording);
    source.files = [{ path: "a.md", content: "# A\n\nText long enough for a real chunk.\n" }];

    await sync.execute();

    expect(recording.calls).toEqual([]);
    close();
  });

  it("G4: a second pass over identical content still reports lexical mode with the warning, even though nothing changed", async () => {
    const { source, sync, close } = buildHarness(new FakeEmbeddings());
    source.files = [{ path: "a.md", content: "# A\n\nText long enough for a real chunk.\n" }];
    await sync.execute();

    const second = await sync.execute();

    expect(second.indexed).toEqual([]);
    expect(second.mode).toBe("lexical");
    expect(second.embeddingsWarning).toBeDefined();
    expect(second.embeddingsWarning).toContain("vector storage");
    close();
  });

  it("G5: IndexDocuments over the same corpus and a fresh degraded store also reports lexical mode with a warning", async () => {
    const store = new SqliteIndexStore(":memory:");
    const source = new MutableSource();
    source.files = [{ path: "a.md", content: "# A\n\nText long enough for a real chunk.\n" }];
    const indexDocuments = new IndexDocuments(
      source,
      new RemarkMarkdownParser(),
      store,
      new FakeEmbeddings(),
      createConventionPolicy(LOOSE),
      OPTIONS,
    );

    const report = await indexDocuments.execute();

    expect(report.mode).toBe("lexical");
    expect(report.embeddingsWarning).toBeDefined();
    store.close();
  });

  it("G6: the carried-over fixture, driven through a full SyncIndex pass, reaches the identical outcome as G1+G2", async () => {
    const dir = mkdtempSync(join(tmpdir(), "compendio-sync-degraded-"));
    const file = join(dir, "carried-over.db");
    await seedCarriedOverVectorTable(file);
    const store = new SqliteIndexStore(file);
    // `store.close()` must run before `rmSync` regardless of whether the
    // assertions below throw -- otherwise a failing assertion leaves the
    // SQLite file handle open and `rmSync` fails with EBUSY on Windows,
    // masking the real assertion failure.
    try {
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
        { path: "a.md", content: "# A\n\nSearchable content long enough for a real chunk.\n" },
      ];

      const report = await sync.execute();

      expect(report.mode).toBe("lexical");
      expect(report.embeddingsWarning).toContain("vector storage");
      expect(report.indexed.map((d) => d.path)).toEqual(["a.md"]);
      expect(report.skipped).toEqual([]);
      expect(store.searchLexical("searchable", {}, 10)).toHaveLength(1);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
