import { describe, expect, it } from "vitest";
import { formatOverview, GetOverview } from "../../src/application/get-overview";
import type { DocumentMeta } from "../../src/domain/model";
import { SqliteIndexStore } from "../../src/infrastructure/sqlite/sqlite-index-store";

function seed(store: SqliteIndexStore, overrides: Partial<DocumentMeta> & { ruta: string }): void {
  const meta: DocumentMeta = {
    ruta: overrides.ruta,
    titulo: overrides.titulo ?? overrides.ruta,
    resumen: overrides.resumen ?? "contenido",
    etiquetas: overrides.etiquetas ?? [],
    hash: overrides.hash ?? overrides.ruta,
    ...(overrides.tipo !== undefined ? { tipo: overrides.tipo } : {}),
    ...(overrides.modulo !== undefined ? { modulo: overrides.modulo } : {}),
    ...(overrides.estado !== undefined ? { estado: overrides.estado } : {}),
  };
  store.saveDocument(meta, [{ encabezado: "H", contenido: "contenido", orden: 0 }]);
}

describe("GetOverview — empty taxonomy omission", () => {
  it("omits the 'Por tipo:' and 'Por modulo:' lines when no document defines them", () => {
    const store = new SqliteIndexStore(":memory:");
    seed(store, { ruta: "a.md" });
    seed(store, { ruta: "b.md" });

    const overview = new GetOverview(store).execute();
    expect(overview.porTipo).toEqual({});
    expect(overview.porModulo).toEqual({});

    const salida = formatOverview(overview);
    expect(salida).not.toContain("Por tipo:");
    expect(salida).not.toContain("Por modulo:");
    store.close();
  });
});

describe("GetOverview — partial tipo coverage", () => {
  it("counts only documents that define tipo, with no synthetic bucket", () => {
    const store = new SqliteIndexStore(":memory:");
    seed(store, { ruta: "a.md", tipo: "guia" });
    seed(store, { ruta: "b.md" }); // no tipo

    const overview = new GetOverview(store).execute();
    expect(overview.porTipo).toEqual({ guia: 1 });
    expect(overview.totalDocumentos).toBe(2);

    const salida = formatOverview(overview);
    expect(salida).toContain("Por tipo: guia (1)");
    expect(salida).not.toContain("undefined");
    store.close();
  });
});

describe("GetOverview — per-document line ordering and segment omission", () => {
  it("orders lines alphabetically by ruta and omits absent tipo/estado segments", () => {
    const store = new SqliteIndexStore(":memory:");
    seed(store, { ruta: "z.md", tipo: "guia", estado: "vigente" });
    seed(store, { ruta: "a.md" }); // no tipo, no estado
    seed(store, { ruta: "m.md", tipo: "adr" }); // tipo only

    const overview = new GetOverview(store).execute();
    expect(overview.documentos.map((d) => d.ruta)).toEqual(["a.md", "m.md", "z.md"]);

    const salida = formatOverview(overview);
    const lineas = salida.split("\n").filter((l) => l.startsWith("- "));
    expect(lineas[0]).toBe("- a.md — contenido");
    expect(lineas[1]).toBe("- [adr] m.md — contenido");
    expect(lineas[2]).toBe("- [guia] z.md — contenido (vigente)");
    store.close();
  });
});

describe("GetOverview resumen fallback", () => {
  it("shows the title when the document has no intro paragraph", () => {
    const store = new SqliteIndexStore(":memory:");
    const meta: DocumentMeta = {
      ruta: "guias/transversal-sin-resumen.md",
      titulo: "Guía sin resumen",
      resumen: "",
      tipo: "guia",
      modulo: "transversal",
      estado: "vigente",
      etiquetas: [],
      hash: "abc",
    };
    store.saveDocument(meta, [{ encabezado: "Sección", contenido: "## Sección\n\nTexto.", orden: 0 }]);

    const overview = new GetOverview(store).execute();
    expect(overview.documentos[0]!.resumen).toBe("Guía sin resumen");
    expect(formatOverview(overview)).toContain(
      "- [guia] guias/transversal-sin-resumen.md — Guía sin resumen (vigente)",
    );

    store.close();
  });
});
