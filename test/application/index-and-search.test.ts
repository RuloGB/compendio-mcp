import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildHarness, type TestHarness } from "../helpers/build";
import { BrokenEmbeddings, FakeEmbeddings } from "../helpers/fake-embeddings";
import type { IndexReport } from "../../src/application/index-documents";

describe("index + hybrid search over the ejemplos corpus", () => {
  let harness: TestHarness;
  let report: IndexReport;

  beforeAll(async () => {
    harness = buildHarness(new FakeEmbeddings());
    report = await harness.index.execute();
  });

  afterAll(() => {
    harness.close();
  });

  it("indexes every valid document except INDEX.md, in hybrid mode", () => {
    expect(report.modo).toBe("hibrido");
    expect(report.omitidos).toEqual([]);
    expect(report.indexados).toHaveLength(11);
    expect(report.indexados.map((d) => d.ruta)).not.toContain("INDEX.md");
  });

  it("indexes the glossary as a single chunk (no heading chunking)", () => {
    const glosario = report.indexados.find((d) => d.ruta === "glosario.md");
    expect(glosario?.chunks).toBe(1);
  });

  it("excludes borrador and obsoleto documents from search by default", async () => {
    const porDefecto = await harness.search.execute({ query: "panel de métricas KPI", k: 10 });
    expect(porDefecto.resultados.map((r) => r.ruta)).not.toContain("qa/informes-plan-pruebas.md");

    const conTodos = await harness.search.execute({
      query: "panel de métricas KPI",
      k: 10,
      incluirNoVigentes: true,
    });
    expect(conTodos.resultados.map((r) => r.ruta)).toContain("qa/informes-plan-pruebas.md");
  });

  it("bridges the semantic gap: synonyms with zero lexical overlap still retrieve", async () => {
    // "registros clonados" appears nowhere in the corpus; "duplicado" does.
    const lexico = await harness.search.execute({ query: "registros clonados", forzarLexico: true });
    expect(lexico.modo).toBe("lexico");
    expect(lexico.resultados).toEqual([]);

    const hibrido = await harness.search.execute({ query: "registros clonados" });
    expect(hibrido.modo).toBe("hibrido");
    const rutas = hibrido.resultados.slice(0, 3).map((r) => r.ruta);
    expect(rutas).toContain("funcional/leadsviewer-validacion-formulario.md");
  });

  it("filters by tipo and modulo", async () => {
    const soloAdr = await harness.search.execute({ query: "base de datos", tipo: "adr", k: 10 });
    expect(soloAdr.resultados.length).toBeGreaterThan(0);
    expect(soloAdr.resultados.every((r) => r.ruta.startsWith("adr/"))).toBe(true);

    const soloInformes = await harness.search.execute({
      query: "leads",
      modulo: "informes",
      k: 10,
    });
    expect(soloInformes.resultados.every((r) => r.ruta.includes("informes"))).toBe(true);
  });

  it("filters by etiquetas", async () => {
    const conEtiqueta = await harness.search.execute({
      query: "leads fichero",
      etiquetas: ["csv"],
      k: 10,
    });
    expect(conEtiqueta.resultados.length).toBeGreaterThan(0);
    expect(conEtiqueta.resultados.every((r) => r.ruta === "funcional/leadsviewer-importacion-csv.md")).toBe(
      true,
    );
  });

  it("returns at most 2 chunks per document", async () => {
    const respuesta = await harness.search.execute({
      query: "lead email formulario validación",
      k: 10,
    });
    const porRuta = new Map<string, number>();
    for (const resultado of respuesta.resultados) {
      porRuta.set(resultado.ruta, (porRuta.get(resultado.ruta) ?? 0) + 1);
    }
    for (const [, count] of porRuta) {
      expect(count).toBeLessThanOrEqual(2);
    }
  });

  it("returns compact results with ruta, seccion, extracto and estado", async () => {
    const respuesta = await harness.search.execute({ query: "email duplicado" });
    expect(respuesta.resultados.length).toBeGreaterThan(0);
    const primero = respuesta.resultados[0]!;
    expect(primero.ruta.length).toBeGreaterThan(0);
    expect(primero.seccion.length).toBeGreaterThan(0);
    expect(primero.estado).toBe("vigente");
    expect(primero.extracto.length).toBeLessThanOrEqual(300);
    expect(primero.extracto).not.toContain("###");
  });
});

describe("graceful degradation to lexical mode", () => {
  it("indexes without embeddings provider and searches in modo lexico", async () => {
    const harness = buildHarness(null);
    const report = await harness.index.execute();
    expect(report.modo).toBe("lexico");
    expect(report.avisoEmbeddings).toBeDefined();

    const respuesta = await harness.search.execute({ query: "email duplicado" });
    expect(respuesta.modo).toBe("lexico");
    expect(respuesta.resultados.length).toBeGreaterThan(0);
    harness.close();
  });

  it("survives a provider that throws at runtime", async () => {
    const harness = buildHarness(new BrokenEmbeddings());
    const report = await harness.index.execute();
    expect(report.modo).toBe("lexico");
    expect(report.avisoEmbeddings).toContain("roto");
    expect(harness.store.hasVectors()).toBe(false);

    const respuesta = await harness.search.execute({ query: "email duplicado" });
    expect(respuesta.modo).toBe("lexico");
    harness.close();
  });
});
