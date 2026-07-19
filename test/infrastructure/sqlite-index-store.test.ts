import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DocumentMeta } from "../../src/domain/model";
import { SqliteIndexStore } from "../../src/infrastructure/sqlite/sqlite-index-store";

function meta(overrides: Partial<DocumentMeta>): DocumentMeta {
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

  it("applies estado, tipo and etiquetas filters", () => {
    store.saveDocument(meta({ ruta: "a.md", estado: "vigente", etiquetas: ["lead"] }), [
      { encabezado: "A", contenido: "contenido comun", orden: 0 },
    ]);
    store.saveDocument(meta({ ruta: "b.md", estado: "borrador" }), [
      { encabezado: "B", contenido: "contenido comun", orden: 0 },
    ]);
    store.saveDocument(meta({ ruta: "c.md", tipo: "adr" }), [
      { encabezado: "C", contenido: "contenido comun", orden: 0 },
    ]);

    expect(store.searchLexical("comun", {}, 10)).toHaveLength(3);
    expect(store.searchLexical("comun", { estados: ["vigente"] }, 10)).toHaveLength(2);
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
    const onlyVigente = store.searchVector(
      new Float32Array([0.9, 0.1, 0]),
      { estados: ["vigente"] },
      10,
    );
    expect(onlyVigente).toEqual([a.chunkIds[0]]);
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
});
