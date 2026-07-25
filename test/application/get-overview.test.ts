import { describe, expect, it } from "vitest";
import { formatOverview, GetOverview, toSincronizacionInfo } from "../../src/application/get-overview";
import type { SyncReport } from "../../src/application/sync-index";
import type { DocumentMeta } from "../../src/domain/model";
import { SqliteIndexStore } from "../../src/infrastructure/sqlite/sqlite-index-store";

function fakeReport(overrides: Partial<SyncReport> = {}): SyncReport {
  return {
    modo: "hibrido",
    indexados: [],
    eliminados: [],
    omitidos: [],
    totalChunks: 0,
    duracionMs: 1,
    ...overrides,
  };
}

function seed(store: SqliteIndexStore, overrides: Partial<DocumentMeta> & { path: string }): void {
  const meta: DocumentMeta = {
    path: overrides.path,
    title: overrides.title ?? overrides.path,
    summary: overrides.summary ?? "contenido",
    tags: overrides.tags ?? [],
    hash: overrides.hash ?? overrides.path,
    ...(overrides.type !== undefined ? { type: overrides.type } : {}),
    ...(overrides.module !== undefined ? { module: overrides.module } : {}),
    ...(overrides.status !== undefined ? { status: overrides.status } : {}),
  };
  store.saveDocument(meta, [{ heading: "H", content: "contenido", position: 0 }]);
}

describe("GetOverview — empty taxonomy omission", () => {
  it("omits the 'Por tipo:' and 'Por modulo:' lines when no document defines them", () => {
    const store = new SqliteIndexStore(":memory:");
    seed(store, { path: "a.md" });
    seed(store, { path: "b.md" });

    const overview = new GetOverview(store).execute();
    expect(overview.byType).toEqual({});
    expect(overview.byModule).toEqual({});

    const salida = formatOverview(overview);
    expect(salida).not.toContain("Por tipo:");
    expect(salida).not.toContain("Por modulo:");
    store.close();
  });
});

describe("GetOverview — partial type coverage", () => {
  it("counts only documents that define type, with no synthetic bucket", () => {
    const store = new SqliteIndexStore(":memory:");
    seed(store, { path: "a.md", type: "guia" });
    seed(store, { path: "b.md" }); // no type

    const overview = new GetOverview(store).execute();
    expect(overview.byType).toEqual({ guia: 1 });
    expect(overview.totalDocumentos).toBe(2);

    const salida = formatOverview(overview);
    expect(salida).toContain("Por tipo: guia (1)");
    expect(salida).not.toContain("undefined");
    store.close();
  });
});

describe("GetOverview — per-document line ordering and segment omission", () => {
  it("orders lines alphabetically by path and omits absent type/status segments", () => {
    const store = new SqliteIndexStore(":memory:");
    seed(store, { path: "z.md", type: "guia", status: "vigente" });
    seed(store, { path: "a.md" }); // no type, no status
    seed(store, { path: "m.md", type: "adr" }); // type only

    const overview = new GetOverview(store).execute();
    expect(overview.documentos.map((d) => d.path)).toEqual(["a.md", "m.md", "z.md"]);

    const salida = formatOverview(overview);
    const lineas = salida.split("\n").filter((l) => l.startsWith("- "));
    expect(lineas[0]).toBe("- a.md — contenido");
    expect(lineas[1]).toBe("- [adr] m.md — contenido");
    expect(lineas[2]).toBe("- [guia] z.md — contenido (vigente)");
    store.close();
  });
});

describe("GetOverview summary fallback", () => {
  it("shows the title when the document has no intro paragraph", () => {
    const store = new SqliteIndexStore(":memory:");
    const meta: DocumentMeta = {
      path: "guias/transversal-sin-resumen.md",
      title: "Guía sin resumen",
      summary: "",
      type: "guia",
      module: "transversal",
      status: "vigente",
      tags: [],
      hash: "abc",
    };
    store.saveDocument(meta, [{ heading: "Sección", content: "## Sección\n\nTexto.", position: 0 }]);

    const overview = new GetOverview(store).execute();
    expect(overview.documentos[0]!.summary).toBe("Guía sin resumen");
    expect(formatOverview(overview)).toContain(
      "- [guia] guias/transversal-sin-resumen.md — Guía sin resumen (vigente)",
    );

    store.close();
  });
});

describe("toSincronizacionInfo — content-based omission", () => {
  it("is null when there is no report yet (lastReport is null)", () => {
    expect(toSincronizacionInfo(null)).toBeNull();
  });

  it("is null when the most recent pass had nothing to report (empty omitidos, no avisoEmbeddings)", () => {
    expect(toSincronizacionInfo(fakeReport())).toBeNull();
  });

  it("surfaces omitidos when the most recent pass skipped a document", () => {
    const report = fakeReport({ omitidos: [{ path: "a.md", errores: ["motivo"] }] });
    expect(toSincronizacionInfo(report)).toEqual({ omitidos: [{ path: "a.md", errores: ["motivo"] }] });
  });

  it("surfaces avisoEmbeddings when the most recent pass degraded to lexical-only", () => {
    const report = fakeReport({ avisoEmbeddings: "embeddings no disponibles: busqueda en modo lexico" });
    expect(toSincronizacionInfo(report)).toEqual({
      omitidos: [],
      avisoEmbeddings: "embeddings no disponibles: busqueda en modo lexico",
    });
  });
});

describe("formatOverview — sincronizacion block", () => {
  it("omits the block entirely when sincronizacion is null or undefined", () => {
    const store = new SqliteIndexStore(":memory:");
    seed(store, { path: "a.md" });
    const overview = new GetOverview(store).execute();

    expect(formatOverview(overview)).not.toContain("Sincronizacion");
    expect(formatOverview(overview, null)).not.toContain("Sincronizacion");
    expect(formatOverview(overview, undefined)).not.toContain("Sincronizacion");
    store.close();
  });

  it("renders omitidos and avisoEmbeddings when sincronizacion has content", () => {
    const store = new SqliteIndexStore(":memory:");
    seed(store, { path: "a.md" });
    const overview = new GetOverview(store).execute();

    const salida = formatOverview(overview, {
      omitidos: [{ path: "roto.md", errores: ["permiso denegado"] }],
      avisoEmbeddings: "embeddings no disponibles: busqueda en modo lexico",
    });

    expect(salida).toContain("Sincronizacion");
    expect(salida).toContain("roto.md");
    expect(salida).toContain("permiso denegado");
    expect(salida).toContain("embeddings no disponibles: busqueda en modo lexico");
    store.close();
  });
});
