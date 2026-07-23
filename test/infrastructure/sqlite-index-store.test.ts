import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DocumentMeta } from "../../src/domain/model";
import { SqliteIndexStore } from "../../src/infrastructure/sqlite/sqlite-index-store";

function meta(overrides: Partial<DocumentMeta> & { ruta?: string } = {}): DocumentMeta {
  return {
    ruta: "funcional/doc.md",
    titulo: "Documento",
    resumen: "Resumen.",
    tipo: "funcional",
    modulo: "leadsviewer",
    estado: "vigente",
    etiquetas: [],
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
      { encabezado: "Reglas", contenido: "La validación del teléfono es estricta.", orden: 0 },
    ]);
    const ids = store.searchLexical("validacion telefono", {}, 10);
    expect(ids).toHaveLength(1);
  });

  it("applies tipo, modulo and etiquetas filters", () => {
    store.saveDocument(meta({ ruta: "a.md", etiquetas: ["lead"] }), [
      { encabezado: "A", contenido: "contenido comun", orden: 0 },
    ]);
    store.saveDocument(meta({ ruta: "b.md", estado: "borrador" }), [
      { encabezado: "B", contenido: "contenido comun", orden: 0 },
    ]);
    store.saveDocument(meta({ ruta: "c.md", tipo: "adr" }), [
      { encabezado: "C", contenido: "contenido comun", orden: 0 },
    ]);

    expect(store.searchLexical("comun", {}, 10)).toHaveLength(3);
    expect(store.searchLexical("comun", { tipo: "adr" }, 10)).toHaveLength(1);
    expect(store.searchLexical("comun", { etiquetas: ["lead"] }, 10)).toHaveLength(1);
  });

  it("never breaks on FTS5 metacharacters in the query", () => {
    store.saveDocument(meta({}), [{ encabezado: "A", contenido: "texto normal", orden: 0 }]);
    expect(() => store.searchLexical('"(texto AND OR NEAR)*', {}, 10)).not.toThrow();
    expect(store.searchLexical("¿?¡!", {}, 10)).toEqual([]);
  });

  it("stores and searches vectors, nearest first, honoring filters", () => {
    const a = store.saveDocument(meta({ ruta: "a.md" }), [
      { encabezado: "A", contenido: "aaa", orden: 0 },
    ]);
    const b = store.saveDocument(meta({ ruta: "b.md", estado: "borrador" }), [
      { encabezado: "B", contenido: "bbb", orden: 0 },
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
      { estadosExcluidos: ["borrador"] },
      10,
    );
    expect(sinBorrador).toEqual([a.chunkIds[0]]);
  });

  it("reset drops documents, chunks and vectors", () => {
    const saved = store.saveDocument(meta({}), [
      { encabezado: "A", contenido: "contenido", orden: 0 },
    ]);
    store.saveEmbeddings([{ chunkId: saved.chunkIds[0]!, embedding: new Float32Array([1, 0]) }]);
    store.reset();
    expect(store.listDocuments()).toEqual([]);
    expect(store.searchLexical("contenido", {}, 10)).toEqual([]);
    expect(store.hasVectors()).toBe(false);
  });

  it("getChunksByIds preserves the requested order", () => {
    const saved = store.saveDocument(meta({}), [
      { encabezado: "A", contenido: "uno", orden: 0 },
      { encabezado: "B", contenido: "dos", orden: 1 },
    ]);
    const reversed = [...saved.chunkIds].reverse();
    const chunks = store.getChunksByIds(reversed);
    expect(chunks.map((c) => c.id)).toEqual(reversed);
  });

  it("round-trips document metadata including etiquetas and propietario", () => {
    store.saveDocument(
      meta({ etiquetas: ["lead", "rgpd"], propietario: "BA", actualizado: "2026-07-19" }),
      [{ encabezado: "A", contenido: "x", orden: 0 }],
    );
    const doc = store.getDocumentByRuta("funcional/doc.md");
    expect(doc).not.toBeNull();
    expect(doc!.etiquetas).toEqual(["lead", "rgpd"]);
    expect(doc!.propietario).toBe("BA");
    expect(doc!.actualizado).toBe("2026-07-19");
  });

  it("round-trips absent tipo/modulo/estado as NULL -> undefined (Optional Persisted Metadata)", () => {
    store.saveDocument(
      { ruta: "sin-metadata.md", titulo: "Sin metadata", resumen: "r", etiquetas: [], hash: "h" },
      [{ encabezado: "A", contenido: "x", orden: 0 }],
    );
    const doc = store.getDocumentByRuta("sin-metadata.md");
    expect(doc).not.toBeNull();
    expect(doc!.tipo).toBeUndefined();
    expect(doc!.modulo).toBeUndefined();
    expect(doc!.estado).toBeUndefined();
  });

  it("listDocuments orders alphabetically by ruta regardless of NULL/non-NULL tipo", () => {
    store.saveDocument(meta({ ruta: "z.md", tipo: "adr" }), [
      { encabezado: "A", contenido: "x", orden: 0 },
    ]);
    store.saveDocument(
      { ruta: "a.md", titulo: "A", resumen: "r", etiquetas: [], hash: "h" }, // no tipo (NULL)
      [{ encabezado: "A", contenido: "x", orden: 0 }],
    );
    store.saveDocument(meta({ ruta: "m.md", tipo: "guia" }), [
      { encabezado: "A", contenido: "x", orden: 0 },
    ]);

    expect(store.listDocuments().map((d) => d.ruta)).toEqual(["a.md", "m.md", "z.md"]);
  });

  it("estadosExcluidos deny-list: NULL estado is never excluded, declared exclusion filters correctly", () => {
    store.saveDocument(meta({ ruta: "borrador.md", estado: "borrador" }), [
      { encabezado: "A", contenido: "unico1", orden: 0 },
    ]);
    store.saveDocument(meta({ ruta: "vigente.md", estado: "vigente" }), [
      { encabezado: "A", contenido: "unico1", orden: 0 },
    ]);
    store.saveDocument(
      { ruta: "sin-estado.md", titulo: "T", resumen: "r", etiquetas: [], hash: "h" }, // no estado
      [{ encabezado: "A", contenido: "unico1", orden: 0 }],
    );

    const sinDenyList = store.searchLexical("unico1", {}, 10);
    expect(sinDenyList).toHaveLength(3);

    const conDenyList = store.searchLexical("unico1", { estadosExcluidos: ["borrador"] }, 10);
    expect(conDenyList).toHaveLength(2); // vigente.md and sin-estado.md remain eligible
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

    // Pre-reset: inserting a document with no tipo would violate NOT NULL.
    expect(() =>
      store.saveDocument(
        { ruta: "sin-tipo.md", titulo: "T", resumen: "r", etiquetas: [], hash: "h" },
        [{ encabezado: "A", contenido: "x", orden: 0 }],
      ),
    ).toThrow();

    store.reset();

    // Post-reset: the schema is nullable, no manual .compendio/ deletion needed.
    expect(() =>
      store.saveDocument(
        { ruta: "sin-tipo.md", titulo: "T", resumen: "r", etiquetas: [], hash: "h" },
        [{ encabezado: "A", contenido: "x", orden: 0 }],
      ),
    ).not.toThrow();
    const doc = store.getDocumentByRuta("sin-tipo.md");
    expect(doc!.tipo).toBeUndefined();

    store.close();
  });
});
