import { describe, expect, it } from "vitest";
import { formatOverview, GetOverview, toSyncInfo } from "../../src/application/get-overview";
import type { SyncReport } from "../../src/application/sync-index";
import type { DocumentMeta } from "../../src/domain/model";
import { SqliteIndexStore } from "../../src/infrastructure/sqlite/sqlite-index-store";

function fakeReport(overrides: Partial<SyncReport> = {}): SyncReport {
  return {
    mode: "hybrid",
    indexed: [],
    deleted: [],
    skipped: [],
    totalChunks: 0,
    durationMs: 1,
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
  it("omits the 'By type:' and 'By module:' lines when no document defines them", () => {
    const store = new SqliteIndexStore(":memory:");
    seed(store, { path: "a.md" });
    seed(store, { path: "b.md" });

    const overview = new GetOverview(store).execute();
    expect(overview.byType).toEqual({});
    expect(overview.byModule).toEqual({});

    const salida = formatOverview(overview);
    expect(salida).not.toContain("By type:");
    expect(salida).not.toContain("By module:");
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
    expect(overview.totalDocuments).toBe(2);

    const salida = formatOverview(overview);
    expect(salida).toContain("By type: guia (1)");
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
    expect(overview.documents.map((d) => d.path)).toEqual(["a.md", "m.md", "z.md"]);

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
    expect(overview.documents[0]!.summary).toBe("Guía sin resumen");
    expect(formatOverview(overview)).toContain(
      "- [guia] guias/transversal-sin-resumen.md — Guía sin resumen (vigente)",
    );

    store.close();
  });
});

describe("toSyncInfo — content-based omission", () => {
  it("is null when there is no report yet (lastReport is null)", () => {
    expect(toSyncInfo(null)).toBeNull();
  });

  it("is null when the most recent pass had nothing to report (empty skipped, no embeddingsWarning)", () => {
    expect(toSyncInfo(fakeReport())).toBeNull();
  });

  it("surfaces skipped items when the most recent pass skipped a document", () => {
    const report = fakeReport({ skipped: [{ path: "a.md", errors: ["motivo"] }] });
    expect(toSyncInfo(report)).toEqual({ skipped: [{ path: "a.md", errors: ["motivo"] }] });
  });

  it("surfaces embeddingsWarning when the most recent pass degraded to lexical-only", () => {
    const report = fakeReport({ embeddingsWarning: "embeddings unavailable: search runs in lexical mode" });
    expect(toSyncInfo(report)).toEqual({
      skipped: [],
      embeddingsWarning: "embeddings unavailable: search runs in lexical mode",
    });
  });
});

describe("formatOverview — sync block", () => {
  it("omits the block entirely when sync is null or undefined", () => {
    const store = new SqliteIndexStore(":memory:");
    seed(store, { path: "a.md" });
    const overview = new GetOverview(store).execute();

    expect(formatOverview(overview)).not.toContain("Sync");
    expect(formatOverview(overview, null)).not.toContain("Sync");
    expect(formatOverview(overview, undefined)).not.toContain("Sync");
    store.close();
  });

  it("renders skipped items and embeddingsWarning when sync has content", () => {
    const store = new SqliteIndexStore(":memory:");
    seed(store, { path: "a.md" });
    const overview = new GetOverview(store).execute();

    const salida = formatOverview(overview, {
      skipped: [{ path: "roto.md", errors: ["permiso denegado"] }],
      embeddingsWarning: "embeddings unavailable: search runs in lexical mode",
    });

    expect(salida).toContain("Sync");
    expect(salida).toContain("roto.md");
    expect(salida).toContain("permiso denegado");
    expect(salida).toContain("embeddings unavailable: search runs in lexical mode");
    store.close();
  });
});
