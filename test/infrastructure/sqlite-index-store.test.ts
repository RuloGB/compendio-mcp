import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DocumentMeta } from "../../src/domain/model";
import { SqliteIndexStore } from "../../src/infrastructure/sqlite/sqlite-index-store";

function meta(overrides: Partial<DocumentMeta> = {}): DocumentMeta {
  return {
    path: "funcional/doc.md",
    titulo: "Documento",
    resumen: "Resumen.",
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
      { heading: "Reglas", contenido: "La validación del teléfono es estricta.", orden: 0 },
    ]);
    const ids = store.searchLexical("validacion telefono", {}, 10);
    expect(ids).toHaveLength(1);
  });

  it("applies type, module and tags filters", () => {
    store.saveDocument(meta({ path: "a.md", tags: ["lead"] }), [
      { heading: "A", contenido: "contenido comun", orden: 0 },
    ]);
    store.saveDocument(meta({ path: "b.md", status: "borrador" }), [
      { heading: "B", contenido: "contenido comun", orden: 0 },
    ]);
    store.saveDocument(meta({ path: "c.md", type: "adr" }), [
      { heading: "C", contenido: "contenido comun", orden: 0 },
    ]);

    expect(store.searchLexical("comun", {}, 10)).toHaveLength(3);
    expect(store.searchLexical("comun", { type: "adr" }, 10)).toHaveLength(1);
    expect(store.searchLexical("comun", { tags: ["lead"] }, 10)).toHaveLength(1);
  });

  it("never breaks on FTS5 metacharacters in the query", () => {
    store.saveDocument(meta({}), [{ heading: "A", contenido: "texto normal", orden: 0 }]);
    expect(() => store.searchLexical('"(texto AND OR NEAR)*', {}, 10)).not.toThrow();
    expect(store.searchLexical("¿?¡!", {}, 10)).toEqual([]);
  });

  it("stores and searches vectors, nearest first, honoring filters", () => {
    const a = store.saveDocument(meta({ path: "a.md" }), [
      { heading: "A", contenido: "aaa", orden: 0 },
    ]);
    const b = store.saveDocument(meta({ path: "b.md", status: "borrador" }), [
      { heading: "B", contenido: "bbb", orden: 0 },
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
      { heading: "A", contenido: "contenido", orden: 0 },
    ]);
    store.saveEmbeddings([{ chunkId: saved.chunkIds[0]!, embedding: new Float32Array([1, 0]) }]);
    store.reset();
    expect(store.listDocuments()).toEqual([]);
    expect(store.searchLexical("contenido", {}, 10)).toEqual([]);
    expect(store.hasVectors()).toBe(false);
  });

  it("getChunksByIds preserves the requested order", () => {
    const saved = store.saveDocument(meta({}), [
      { heading: "A", contenido: "uno", orden: 0 },
      { heading: "B", contenido: "dos", orden: 1 },
    ]);
    const reversed = [...saved.chunkIds].reverse();
    const chunks = store.getChunksByIds(reversed);
    expect(chunks.map((c) => c.id)).toEqual(reversed);
  });

  it("round-trips document metadata including tags and owner", () => {
    store.saveDocument(
      meta({ tags: ["lead", "rgpd"], owner: "BA", updated: "2026-07-19" }),
      [{ heading: "A", contenido: "x", orden: 0 }],
    );
    const doc = store.getDocumentByPath("funcional/doc.md");
    expect(doc).not.toBeNull();
    expect(doc!.tags).toEqual(["lead", "rgpd"]);
    expect(doc!.owner).toBe("BA");
    expect(doc!.updated).toBe("2026-07-19");
  });

  it("round-trips absent type/module/status as NULL -> undefined (Optional Persisted Metadata)", () => {
    store.saveDocument(
      { path: "sin-metadata.md", titulo: "Sin metadata", resumen: "r", tags: [], hash: "h" },
      [{ heading: "A", contenido: "x", orden: 0 }],
    );
    const doc = store.getDocumentByPath("sin-metadata.md");
    expect(doc).not.toBeNull();
    expect(doc!.type).toBeUndefined();
    expect(doc!.module).toBeUndefined();
    expect(doc!.status).toBeUndefined();
  });

  it("listDocuments orders alphabetically by path regardless of NULL/non-NULL type", () => {
    store.saveDocument(meta({ path: "z.md", type: "adr" }), [
      { heading: "A", contenido: "x", orden: 0 },
    ]);
    store.saveDocument(
      { path: "a.md", titulo: "A", resumen: "r", tags: [], hash: "h" }, // no type (NULL)
      [{ heading: "A", contenido: "x", orden: 0 }],
    );
    store.saveDocument(meta({ path: "m.md", type: "guia" }), [
      { heading: "A", contenido: "x", orden: 0 },
    ]);

    expect(store.listDocuments().map((d) => d.path)).toEqual(["a.md", "m.md", "z.md"]);
  });

  it("excludedStatuses deny-list: NULL status is never excluded, declared exclusion filters correctly", () => {
    store.saveDocument(meta({ path: "borrador.md", status: "borrador" }), [
      { heading: "A", contenido: "unico1", orden: 0 },
    ]);
    store.saveDocument(meta({ path: "vigente.md", status: "vigente" }), [
      { heading: "A", contenido: "unico1", orden: 0 },
    ]);
    store.saveDocument(
      { path: "sin-status.md", titulo: "T", resumen: "r", tags: [], hash: "h" }, // no status
      [{ heading: "A", contenido: "unico1", orden: 0 }],
    );

    const sinDenyList = store.searchLexical("unico1", {}, 10);
    expect(sinDenyList).toHaveLength(3);

    const conDenyList = store.searchLexical("unico1", { excludedStatuses: ["borrador"] }, 10);
    expect(conDenyList).toHaveLength(2); // vigente.md and sin-status.md remain eligible
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
      { heading: "A", contenido: "contenido unico borrado", orden: 0 },
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
      { heading: "A", contenido: "algo", orden: 0 },
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
      [{ heading: "A", contenido: "contenido viejo", orden: 0 }],
      null,
    );
    const first = store.getDocumentByPath("cambia.md");
    expect(first).not.toBeNull();
    expect(store.searchLexical("viejo", {}, 10)).toHaveLength(1);

    store.upsertDocument(
      meta({ path: "cambia.md", hash: "h2" }),
      [{ heading: "B", contenido: "contenido nuevo", orden: 0 }],
      null,
    );

    expect(store.listDocuments().filter((d) => d.path === "cambia.md")).toHaveLength(1);
    expect(store.getDocumentByPath("cambia.md")!.hash).toBe("h2");
    expect(store.searchLexical("viejo", {}, 10)).toEqual([]);
    expect(store.searchLexical("nuevo", {}, 10)).toHaveLength(1);
  });

  it("writes embeddings for a brand-new document even before any compendio index run", () => {
    // Regression guard for the design's write-guard decision: on a project
    // whose chunks_vec table has never been created, upsertDocument must
    // still create it and persist the embedding (vectorsEnabled alone, not
    // deleteDocument's tableExists double guard).
    const result = store.upsertDocument(
      meta({ path: "nuevo.md" }),
      [{ heading: "A", contenido: "primero", orden: 0 }],
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
      { heading: "A", contenido: "x", orden: 0 },
    ]);
    expect(store.listChunksMissingVectors()).toEqual([]);
  });

  it("returns only the chunks with no chunks_vec row for a partially vectorized document, with defined path/heading values", () => {
    const saved = store.saveDocument(meta({ path: "parcial.md" }), [
      { heading: "Uno", contenido: "primero", orden: 0 },
      { heading: "Dos", contenido: "segundo", orden: 1 },
    ]);
    store.saveEmbeddings([{ chunkId: saved.chunkIds[0]!, embedding: new Float32Array([1, 0]) }]);

    const missing = store.listChunksMissingVectors();

    expect(missing).toHaveLength(1);
    // Active proof of the listChunksMissingVectors SQL-alias silent trap
    // (Decision A/G): path/heading must be defined, non-undefined values —
    // a stale SQL alias (not renamed alongside the port field) would
    // silently yield undefined here while this assertion still passed on
    // `toEqual` alone.
    expect(missing[0]?.path).toBe("parcial.md");
    expect(missing[0]?.heading).toBe("Dos");
    expect(missing[0]?.path).not.toBeUndefined();
    expect(missing[0]?.heading).not.toBeUndefined();
    expect(missing[0]).toEqual({
      chunkId: saved.chunkIds[1],
      path: "parcial.md",
      heading: "Dos",
      contenido: "segundo",
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
      { heading: "A", contenido: "algo", orden: 0 },
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
        ruta TEXT UNIQUE NOT NULL,
        titulo TEXT NOT NULL,
        resumen TEXT NOT NULL,
        tipo TEXT NOT NULL,
        modulo TEXT NOT NULL,
        estado TEXT NOT NULL,
        propietario TEXT,
        etiquetas TEXT,
        actualizado TEXT,
        hash TEXT NOT NULL
      );
    `);

    // Pre-reset: inserting a document with no type would violate NOT NULL.
    expect(() =>
      store.saveDocument(
        { path: "sin-type.md", titulo: "T", resumen: "r", tags: [], hash: "h" },
        [{ heading: "A", contenido: "x", orden: 0 }],
      ),
    ).toThrow();

    store.reset();

    // Post-reset: the schema is nullable, no manual .compendio/ deletion needed.
    expect(() =>
      store.saveDocument(
        { path: "sin-type.md", titulo: "T", resumen: "r", tags: [], hash: "h" },
        [{ heading: "A", contenido: "x", orden: 0 }],
      ),
    ).not.toThrow();
    const doc = store.getDocumentByPath("sin-type.md");
    expect(doc!.type).toBeUndefined();

    store.close();
  });
});
