import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DocumentMeta } from "../../src/domain/model";
import { SqliteIndexStore, toFtsQuery } from "../../src/infrastructure/sqlite/sqlite-index-store";

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

describe("SqliteIndexStore", () => {
  let store: SqliteIndexStore;

  beforeEach(() => {
    store = new SqliteIndexStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  it("matches Spanish text ignoring diacritics (validacion == validación)", () => {
    store.saveDocument(meta({}), [
      { heading: "Reglas", content: "La validación del teléfono es estricta.", position: 0 },
    ]);
    const ids = store.searchLexical("validacion telefono", {}, 10);
    expect(ids).toHaveLength(1);
  });

  it("applies type, module and tags filters", () => {
    store.saveDocument(meta({ path: "a.md", tags: ["lead"] }), [
      { heading: "A", content: "content comun", position: 0 },
    ]);
    store.saveDocument(meta({ path: "b.md", status: "borrador" }), [
      { heading: "B", content: "content comun", position: 0 },
    ]);
    store.saveDocument(meta({ path: "c.md", type: "adr" }), [
      { heading: "C", content: "content comun", position: 0 },
    ]);

    expect(store.searchLexical("comun", {}, 10)).toHaveLength(3);
    expect(store.searchLexical("comun", { type: "adr" }, 10)).toHaveLength(1);
    expect(store.searchLexical("comun", { tags: ["lead"] }, 10)).toHaveLength(1);
  });

  it("never breaks on FTS5 metacharacters in the query", () => {
    store.saveDocument(meta({}), [{ heading: "A", content: "plain text", position: 0 }]);
    expect(() => store.searchLexical('"(sample AND OR NEAR)*', {}, 10)).not.toThrow();
    expect(store.searchLexical("¿?¡!", {}, 10)).toEqual([]);
  });

  it("stores and searches vectors, nearest first, honoring filters", () => {
    const a = store.saveDocument(meta({ path: "a.md" }), [
      { heading: "A", content: "aaa", position: 0 },
    ]);
    const b = store.saveDocument(meta({ path: "b.md", status: "borrador" }), [
      { heading: "B", content: "bbb", position: 0 },
    ]);
    expect(store.hasVectors()).toBe(false);
    store.saveEmbeddings([
      { chunkId: a.chunkIds[0]!, embedding: new Float32Array([1, 0, 0]) },
      { chunkId: b.chunkIds[0]!, embedding: new Float32Array([0.9, 0.1, 0]) },
    ]);
    expect(store.hasVectors()).toBe(true);

    const nearest = store.searchVector(new Float32Array([0.95, 0.05, 0]), {}, 10);
    expect(nearest).toHaveLength(2);
    const sinBorrador = store.searchVector(
      new Float32Array([0.9, 0.1, 0]),
      { excludedStatuses: ["borrador"] },
      10,
    );
    expect(sinBorrador).toEqual([a.chunkIds[0]]);
  });

  it("reset drops documents, chunks and vectors", () => {
    const saved = store.saveDocument(meta({}), [
      { heading: "A", content: "content", position: 0 },
    ]);
    store.saveEmbeddings([{ chunkId: saved.chunkIds[0]!, embedding: new Float32Array([1, 0]) }]);
    store.reset();
    expect(store.listDocuments()).toEqual([]);
    expect(store.searchLexical("content", {}, 10)).toEqual([]);
    expect(store.hasVectors()).toBe(false);
  });

  it("getChunksByIds preserves the requested order", () => {
    const saved = store.saveDocument(meta({}), [
      { heading: "A", content: "uno", position: 0 },
      { heading: "B", content: "dos", position: 1 },
    ]);
    const reversed = [...saved.chunkIds].reverse();
    const chunks = store.getChunksByIds(reversed);
    expect(chunks.map((c) => c.id)).toEqual(reversed);
  });

  it("round-trips document metadata including tags and owner", () => {
    store.saveDocument(
      meta({ tags: ["lead", "rgpd"], owner: "BA", updated: "2026-07-19" }),
      [{ heading: "A", content: "x", position: 0 }],
    );
    const doc = store.getDocumentByPath("funcional/doc.md");
    expect(doc).not.toBeNull();
    expect(doc!.tags).toEqual(["lead", "rgpd"]);
    expect(doc!.owner).toBe("BA");
    expect(doc!.updated).toBe("2026-07-19");
  });

  it("round-trips absent type/module/status as NULL -> undefined (Optional Persisted Metadata)", () => {
    store.saveDocument(
      { path: "sin-metadata.md", title: "Sin metadata", summary: "r", tags: [], hash: "h" },
      [{ heading: "A", content: "x", position: 0 }],
    );
    const doc = store.getDocumentByPath("sin-metadata.md");
    expect(doc).not.toBeNull();
    expect(doc!.type).toBeUndefined();
    expect(doc!.module).toBeUndefined();
    expect(doc!.status).toBeUndefined();
  });

  it("listDocuments orders alphabetically by path regardless of NULL/non-NULL type", () => {
    store.saveDocument(meta({ path: "z.md", type: "adr" }), [
      { heading: "A", content: "x", position: 0 },
    ]);
    store.saveDocument(
      { path: "a.md", title: "A", summary: "r", tags: [], hash: "h" }, // no type (NULL)
      [{ heading: "A", content: "x", position: 0 }],
    );
    store.saveDocument(meta({ path: "m.md", type: "guia" }), [
      { heading: "A", content: "x", position: 0 },
    ]);

    expect(store.listDocuments().map((d) => d.path)).toEqual(["a.md", "m.md", "z.md"]);
  });

  it("excludedStatuses deny-list: NULL status is never excluded, declared exclusion filters correctly", () => {
    store.saveDocument(meta({ path: "borrador.md", status: "borrador" }), [
      { heading: "A", content: "unico1", position: 0 },
    ]);
    store.saveDocument(meta({ path: "vigente.md", status: "vigente" }), [
      { heading: "A", content: "unico1", position: 0 },
    ]);
    store.saveDocument(
      { path: "sin-status.md", title: "T", summary: "r", tags: [], hash: "h" }, // no status
      [{ heading: "A", content: "unico1", position: 0 }],
    );

    const sinDenyList = store.searchLexical("unico1", {}, 10);
    expect(sinDenyList).toHaveLength(3);

    const conDenyList = store.searchLexical("unico1", { excludedStatuses: ["borrador"] }, 10);
    expect(conDenyList).toHaveLength(2); // vigente.md and sin-status.md remain eligible
  });
});

// Regression guard for design.md Decision 2: toFtsQuery now delegates to
// the shared tokenizeQuery (src/domain/match-location.ts), but the MATCH
// string it emits must be byte-identical to what the old, self-contained
// implementation produced — this is the one place the change can reach
// retrieval, and Gate 4 (compendio eval identity) depends on it staying
// exactly this string, not an equivalent one.
describe("toFtsQuery — emitted MATCH string is byte-identical across the tokenizeQuery extraction", () => {
  const cases: [string, string | null][] = [
    ["email duplicado", '"email" OR "duplicado"'],
    ["¿Cuándo se considera duplicado un lead?", '"Cuándo" OR "se" OR "considera" OR "duplicado" OR "un" OR "lead"'],
    ["", null],
    ["   ", null],
    ["the windvane", '"the" OR "windvane"'],
    ["(sample AND OR NEAR)*", '"sample" OR "AND" OR "OR" OR "NEAR"'],
    ["PostgreSQL vs MongoDB", '"PostgreSQL" OR "vs" OR "MongoDB"'],
    ["hyphen-ated word", '"hyphen" OR "ated" OR "word"'],
    ["número 123 con dígitos", '"número" OR "123" OR "con" OR "dígitos"'],
  ];

  it.each(cases)("toFtsQuery(%j) === %j", (query, expected) => {
    expect(toFtsQuery(query)).toBe(expected);
  });
});

describe("SqliteIndexStore — deleteDocument", () => {
  let store: SqliteIndexStore;

  beforeEach(() => {
    store = new SqliteIndexStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  it("leaves no chunks/chunks_fts/chunks_vec orphans and no stale lexical hits", () => {
    const saved = store.saveDocument(meta({ path: "borrar.md" }), [
      { heading: "A", content: "content unico borrado", position: 0 },
    ]);
    store.saveEmbeddings([{ chunkId: saved.chunkIds[0]!, embedding: new Float32Array([1, 0, 0]) }]);
    expect(store.hasVectors()).toBe(true);

    store.deleteDocument("borrar.md");

    expect(store.getDocumentByPath("borrar.md")).toBeNull();
    expect(store.getChunksByIds(saved.chunkIds)).toEqual([]);
    expect(store.searchLexical("unico borrado", {}, 10)).toEqual([]);
    // Chunk id is gone from chunks_vec too: hasVectors reflects the actual row count.
    expect(store.hasVectors()).toBe(false);
  });

  it("is a no-op when the path does not exist", () => {
    store.saveDocument(meta({ path: "otro.md" }), [
      { heading: "A", content: "algo", position: 0 },
    ]);
    expect(() => store.deleteDocument("no-existe.md")).not.toThrow();
    expect(store.getDocumentByPath("otro.md")).not.toBeNull();
  });
});

describe("SqliteIndexStore — upsertDocument", () => {
  let store: SqliteIndexStore;

  beforeEach(() => {
    store = new SqliteIndexStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  it("re-indexing a changed document replaces content with no duplicates", () => {
    store.upsertDocument(
      meta({ path: "cambia.md", hash: "h1" }),
      [{ heading: "A", content: "content viejo", position: 0 }],
      null,
    );
    const first = store.getDocumentByPath("cambia.md");
    expect(first).not.toBeNull();
    expect(store.searchLexical("viejo", {}, 10)).toHaveLength(1);

    store.upsertDocument(
      meta({ path: "cambia.md", hash: "h2" }),
      [{ heading: "B", content: "content nuevo", position: 0 }],
      null,
    );

    expect(store.listDocuments().filter((d) => d.path === "cambia.md")).toHaveLength(1);
    expect(store.getDocumentByPath("cambia.md")!.hash).toBe("h2");
    expect(store.searchLexical("viejo", {}, 10)).toEqual([]);
    expect(store.searchLexical("nuevo", {}, 10)).toHaveLength(1);
  });

  it("canPersistVectors() is true on a healthy store", () => {
    // The mocked file (test/infrastructure/sqlite-index-store-degraded.test.ts)
    // can only prove the false half; this proves the true half against a real,
    // unmocked sqlite-vec load.
    expect(store.canPersistVectors()).toBe(true);
  });

  it("writes embeddings for a brand-new document even before any compendio index run", () => {
    // Regression guard for the design's write-guard decision: on a project
    // whose chunks_vec table has never been created, upsertDocument must
    // still create it and persist the embedding (vectorsEnabled alone, not
    // deleteDocument's tableExists double guard).
    const result = store.upsertDocument(
      meta({ path: "nuevo.md" }),
      [{ heading: "A", content: "primero", position: 0 }],
      [new Float32Array([1, 0, 0])],
    );
    expect(store.hasVectors()).toBe(true);
    const nearest = store.searchVector(new Float32Array([1, 0, 0]), {}, 10);
    expect(nearest).toEqual([result.chunkIds[0]]);
  });
});

describe("SqliteIndexStore — listChunksMissingVectors", () => {
  let store: SqliteIndexStore;

  beforeEach(() => {
    store = new SqliteIndexStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  it("returns [] when chunks_vec was never created", () => {
    store.saveDocument(meta({ path: "a.md" }), [
      { heading: "A", content: "x", position: 0 },
    ]);
    expect(store.listChunksMissingVectors()).toEqual([]);
  });

  it("returns only the chunks with no chunks_vec row for a partially vectorized document, with defined path/heading/content values", () => {
    const saved = store.saveDocument(meta({ path: "parcial.md" }), [
      { heading: "Uno", content: "primero", position: 0 },
      { heading: "Dos", content: "segundo", position: 1 },
    ]);
    store.saveEmbeddings([{ chunkId: saved.chunkIds[0]!, embedding: new Float32Array([1, 0]) }]);

    const missing = store.listChunksMissingVectors();

    expect(missing).toHaveLength(1);
    // Active proof of the listChunksMissingVectors SQL-alias silent trap
    // (Decision A/G): path/heading/content must be defined, non-undefined
    // values — a stale SQL alias (not renamed alongside the port field) would
    // silently yield undefined here while this assertion still passed on
    // `toEqual` alone.
    expect(missing[0]?.path).toBe("parcial.md");
    expect(missing[0]?.heading).toBe("Dos");
    expect(missing[0]?.content).toBe("segundo");
    expect(missing[0]?.path).not.toBeUndefined();
    expect(missing[0]?.heading).not.toBeUndefined();
    expect(missing[0]?.content).not.toBeUndefined();
    expect(missing[0]).toEqual({
      chunkId: saved.chunkIds[1],
      path: "parcial.md",
      heading: "Dos",
      content: "segundo",
    });
  });
});

describe("SqliteIndexStore — replaceEmbeddings", () => {
  let store: SqliteIndexStore;

  beforeEach(() => {
    store = new SqliteIndexStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  it("re-covers an already-vectorized chunk without a PRIMARY KEY violation or duplicate row", () => {
    const saved = store.saveDocument(meta({ path: "re-embed.md" }), [
      { heading: "A", content: "algo", position: 0 },
    ]);
    store.saveEmbeddings([{ chunkId: saved.chunkIds[0]!, embedding: new Float32Array([1, 0]) }]);

    expect(() =>
      store.replaceEmbeddings([
        { chunkId: saved.chunkIds[0]!, embedding: new Float32Array([0, 1]) },
      ]),
    ).not.toThrow();

    expect(store.listChunksMissingVectors()).toEqual([]);
    const nearest = store.searchVector(new Float32Array([0, 1]), {}, 10);
    expect(nearest).toEqual([saved.chunkIds[0]]);
  });
});

describe("SqliteIndexStore — reset() schema guarantee (Pre-existing NOT NULL schema upgrade)", () => {
  it("upgrades a pre-existing NOT NULL schema in place, without manual deletion", () => {
    const store = new SqliteIndexStore(":memory:");
    // Simulate a database created by a prior version with NOT NULL columns.
    const db = (store as unknown as { db: { exec: (sql: string) => unknown } }).db;
    db.exec(`
      DROP TABLE IF EXISTS documents;
      CREATE TABLE documents (
        id INTEGER PRIMARY KEY,
        path TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        type TEXT NOT NULL,
        module TEXT NOT NULL,
        status TEXT NOT NULL,
        owner TEXT,
        tags TEXT,
        updated TEXT,
        hash TEXT NOT NULL
      );
    `);

    // Pre-reset: inserting a document with no type would violate NOT NULL.
    expect(() =>
      store.saveDocument(
        { path: "sin-type.md", title: "T", summary: "r", tags: [], hash: "h" },
        [{ heading: "A", content: "x", position: 0 }],
      ),
    ).toThrow();

    store.reset();

    // Post-reset: the schema is nullable, no manual .compendio/ deletion needed.
    expect(() =>
      store.saveDocument(
        { path: "sin-type.md", title: "T", summary: "r", tags: [], hash: "h" },
        [{ heading: "A", content: "x", position: 0 }],
      ),
    ).not.toThrow();
    const doc = store.getDocumentByPath("sin-type.md");
    expect(doc!.type).toBeUndefined();

    store.close();
  });
});
