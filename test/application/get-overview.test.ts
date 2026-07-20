import { describe, expect, it } from "vitest";
import { formatOverview, GetOverview } from "../../src/application/get-overview";
import type { DocumentMeta } from "../../src/domain/model";
import { SqliteIndexStore } from "../../src/infrastructure/sqlite/sqlite-index-store";
import { buildHarness } from "../helpers/build";

describe("GetOverview over the ejemplos corpus", () => {
  it("counts by tipo/modulo and renders one convention line per document", async () => {
    const harness = buildHarness(null);
    await harness.index.execute();

    const overview = harness.overview.execute();
    expect(overview.totalDocumentos).toBe(11);
    expect(overview.porTipo).toEqual({ funcional: 3, adr: 3, api: 1, qa: 2, guia: 2 });
    expect(overview.porModulo["leadsviewer"]).toBeGreaterThan(0);

    const salida = formatOverview(overview);
    expect(salida).toContain("Documentos indexados: 11");
    expect(salida).toMatch(/^- \[guia\] glosario\.md — .+ \(vigente\)$/m);

    harness.close();
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
