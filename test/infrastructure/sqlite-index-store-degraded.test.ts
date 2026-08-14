import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RealDatabase from "better-sqlite3";
import type Database from "better-sqlite3";
import type { DocumentMeta } from "../../src/domain/model";

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

function meta(overrides: Partial<DocumentMeta> = {}): DocumentMeta {
  return {
    path: "funcional/doc.md",
    title: "Document",
    summary: "Summary.",
    type: "funcional",
    module: "leadsviewer",
    status: "vigente",
    tags: [],
    hash: "h",
    ...overrides,
  };
}

describe("SqliteIndexStore — degraded (sqlite-vec unavailable), fresh database", () => {
  let store: InstanceType<typeof SqliteIndexStore>;

  beforeEach(() => {
    store = new SqliteIndexStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  it("D1: canPersistVectors() is false, independent of any table's existence", () => {
    expect(store.canPersistVectors()).toBe(false);
  });

  it("D2: upsertDocument with non-null embeddings does not throw; the document commits, is findable, is lexically searchable, and no chunks_vec table is created", () => {
    expect(() =>
      store.upsertDocument(
        meta({ path: "fresh.md" }),
        [{ heading: "A", content: "searchable content", position: 0 }],
        [new Float32Array([1, 0, 0])],
      ),
    ).not.toThrow();

    expect(store.getDocumentByPath("fresh.md")).not.toBeNull();
    expect(store.searchLexical("searchable", {}, 10)).toHaveLength(1);

    // Distinguishes "guard fired" from "guard absent but the table happened
    // to exist" -- the sqlite_master check, not a text-containment check
    // (design.md's "trap this encodes" note). No public API exposes this, so
    // the test reaches into the private `db` handle directly.
    const tables = (store as unknown as { db: Database.Database }).db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chunks_vec'`)
      .all();
    expect(tables).toEqual([]);
  });

  it("D3: the embeddings argument is ignored -- hasVectors() stays false, listChunksMissingVectors() stays []", () => {
    store.upsertDocument(
      meta({ path: "fresh.md" }),
      [{ heading: "A", content: "content", position: 0 }],
      [new Float32Array([1, 0, 0])],
    );

    expect(store.hasVectors()).toBe(false);
    expect(store.listChunksMissingVectors()).toEqual([]);
  });

  it("D6: saveEmbeddings and replaceEmbeddings still throw on a degraded store -- the no-op guard in ensureVectorTable must not become a substitute for their explicit throws", () => {
    expect(() =>
      store.saveEmbeddings([{ chunkId: 1, embedding: new Float32Array([1, 0, 0]) }]),
    ).toThrow("the sqlite-vec extension is not available in this installation");
    expect(() =>
      store.replaceEmbeddings([{ chunkId: 1, embedding: new Float32Array([1, 0, 0]) }]),
    ).toThrow("the sqlite-vec extension is not available in this installation");
  });
});

describe("SqliteIndexStore — degraded (sqlite-vec unavailable), carried-over database", () => {
  let file: string;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "compendio-degraded-"));
    file = join(dir, "carried-over.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Seeds a real `chunks_vec` table using the ACTUAL (unmocked) sqlite-vec
   * extension, then closes the connection -- so the file on disk genuinely
   * carries the table before it is reopened through the mocked (degraded)
   * loader. A `:memory:` database cannot be used here: it does not survive
   * `close()`, so there would be nothing to "carry over" (design.md
   * Decision 6). */
  async function seedCarriedOverVectorTable(): Promise<void> {
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

  it("D4: upsertDocument on a carried-over degraded store does not throw; the document commits, and chunks_vec gains no row", async () => {
    await seedCarriedOverVectorTable();
    const store = new SqliteIndexStore(file);

    expect(() =>
      store.upsertDocument(
        meta({ path: "fresh.md" }),
        [{ heading: "A", content: "content", position: 0 }],
        [new Float32Array([1, 0, 0])],
      ),
    ).not.toThrow();

    expect(store.getDocumentByPath("fresh.md")).not.toBeNull();
    expect(store.hasVectors()).toBe(false);
    store.close();
  });

  it("D5: reset() on a carried-over degraded database succeeds by recreating the file -- the vec0 table an unloadable extension cannot DROP is gone, and the store is usable afterwards", async () => {
    await seedCarriedOverVectorTable();
    const store = new SqliteIndexStore(file);

    expect(() => store.reset()).not.toThrow();

    // The whole point: chunks_vec is gone. `DROP TABLE` could not remove it
    // (it needs the module to call the destructor), so if it is absent the
    // file itself must have been recreated.
    const tables = (store as unknown as { db: RealDatabase.Database }).db
      .prepare(`SELECT name FROM sqlite_master WHERE name LIKE 'chunks_vec%'`)
      .all();
    expect(tables).toEqual([]);

    // Usable afterwards: the reopened connection carries the current schema.
    store.upsertDocument(
      meta({ path: "after-reset.md" }),
      [{ heading: "A", content: "searchable content", position: 0 }],
      null,
    );
    expect(store.getDocumentByPath("after-reset.md")).not.toBeNull();
    expect(store.searchLexical("searchable", {}, 10)).toHaveLength(1);
    // Still degraded -- recreating the file does not make the extension load.
    expect(store.canPersistVectors()).toBe(false);

    store.close();
  });

  it("D7: reset() on a HEALTHY carried-over database does NOT recreate the file -- the in-place drop path is preserved, so an unrelated table added by a future migration is not silently destroyed", async () => {
    const real = await vi.importActual<typeof import("sqlite-vec")>("sqlite-vec");
    const db = new RealDatabase(file);
    real.load(db);
    db.exec(`CREATE TABLE canary (id INTEGER PRIMARY KEY)`);
    db.close();

    // A store whose extension DOES load, against the same file.
    const healthy = new (await vi.importActual<
      typeof import("../../src/infrastructure/sqlite/sqlite-index-store")
    >("../../src/infrastructure/sqlite/sqlite-index-store")).SqliteIndexStore(file);
    healthy.reset();

    const canary = (healthy as unknown as { db: RealDatabase.Database }).db
      .prepare(`SELECT name FROM sqlite_master WHERE name = 'canary'`)
      .all();
    expect(canary).toHaveLength(1);
    healthy.close();
  });
});
