import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildHarness,
  ESTRICTO_FIXTURE_CONVENCION,
  ESTRICTO_FIXTURE_DOCS,
  type TestHarness,
} from "../helpers/build";
import { BrokenEmbeddings, FakeEmbeddings } from "../helpers/fake-embeddings";
import { IndexDocuments } from "../../src/application/index-documents";
import type { IndexReport } from "../../src/application/index-documents";
import { SearchDocuments } from "../../src/application/search-documents";
import { crearConvencionPolicy, type ConvencionConfig } from "../../src/domain/convencion";
import type { DiscoverResult, DocumentFile, DocumentSource } from "../../src/domain/ports";
import { RemarkMarkdownParser } from "../../src/infrastructure/markdown/remark-markdown-parser";
import { SqliteIndexStore } from "../../src/infrastructure/sqlite/sqlite-index-store";

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
    expect(report.indexados.length).toBeGreaterThan(0);
    expect(report.indexados.map((d) => d.ruta)).not.toContain("INDEX.md");
  });

  it("indexes the glossary as a single chunk (no heading chunking)", () => {
    const glosario = report.indexados.find((d) => d.ruta === "glosario.md");
    expect(glosario?.chunks).toBe(1);
  });

  it("zero-config: incluirNoVigentes is a no-op because ejemplos declares no estadosExcluidos", async () => {
    // informes/plan-pruebas.md keeps a light `estado: borrador` frontmatter field on purpose,
    // to demonstrate that a declared estado alone does not exclude a document from search
    // unless the project also opts into `convencion.estadosExcluidos`.
    const porDefecto = await harness.search.execute({ query: "borrador plan de pruebas panel", k: 10 });
    expect(porDefecto.resultados.map((r) => r.ruta)).toContain("informes/plan-pruebas.md");

    const conTodos = await harness.search.execute({
      query: "borrador plan de pruebas panel",
      k: 10,
      incluirNoVigentes: true,
    });
    expect(conTodos.resultados.map((r) => r.ruta)).toContain("informes/plan-pruebas.md");
  });

  it("bridges the semantic gap: synonyms with zero lexical overlap still retrieve", async () => {
    // "registros clonados" appears nowhere in the corpus; "duplicado" does.
    const lexico = await harness.search.execute({ query: "registros clonados", forzarLexico: true });
    expect(lexico.modo).toBe("lexico");
    expect(lexico.resultados).toEqual([]);

    const hibrido = await harness.search.execute({ query: "registros clonados" });
    expect(hibrido.modo).toBe("hibrido");
    const rutas = hibrido.resultados.slice(0, 3).map((r) => r.ruta);
    expect(rutas).toContain("leadsviewer/validacion-formulario.md");
  });

  it("filters by modulo (folder-inferred, zero-config)", async () => {
    const soloInformes = await harness.search.execute({
      query: "leads",
      modulo: "informes",
      k: 10,
    });
    expect(soloInformes.resultados.length).toBeGreaterThan(0);
    expect(soloInformes.resultados.every((r) => r.ruta.startsWith("informes/"))).toBe(true);
  });

  it("filters by etiquetas", async () => {
    const conEtiqueta = await harness.search.execute({
      query: "leads fichero",
      etiquetas: ["csv"],
      k: 10,
    });
    expect(conEtiqueta.resultados.length).toBeGreaterThan(0);
    expect(conEtiqueta.resultados.every((r) => r.ruta === "leadsviewer/importacion-csv.md")).toBe(true);
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

  it("returns compact results with ruta, seccion, extracto and estado when the document declares one", async () => {
    const respuesta = await harness.search.execute({ query: "borrador plan de pruebas panel de informes" });
    expect(respuesta.resultados.length).toBeGreaterThan(0);
    const primero = respuesta.resultados[0]!;
    expect(primero.ruta).toBe("informes/plan-pruebas.md");
    expect(primero.seccion.length).toBeGreaterThan(0);
    expect(primero.estado).toBe("borrador");
    expect(primero.extracto.length).toBeLessThanOrEqual(300);
    expect(primero.extracto).not.toContain("###");
  });

  it("omits estado from results when the document declares none (zero-config default)", async () => {
    const respuesta = await harness.search.execute({ query: "email duplicado" });
    expect(respuesta.resultados.length).toBeGreaterThan(0);
    const primero = respuesta.resultados[0]!;
    expect(primero.ruta.length).toBeGreaterThan(0);
    expect(primero.seccion.length).toBeGreaterThan(0);
    expect(primero.estado).toBeUndefined();
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

// --- Secondary synthetic fixture (D1.3): reproduces the retired,
// pre-migration full-convention (estricto) behavior that ejemplos/ used to
// demonstrate before becoming the zero-config corpus. ---------------------

describe("estricto synthetic fixture — declared taxonomy, tipo filtering, deny-list", () => {
  let harness: TestHarness;
  let report: IndexReport;

  beforeAll(async () => {
    harness = buildHarness(new FakeEmbeddings(), ESTRICTO_FIXTURE_CONVENCION, ESTRICTO_FIXTURE_DOCS);
    report = await harness.index.execute();
  });

  afterAll(() => {
    harness.close();
  });

  it("indexes every fixture document with zero omitidos", () => {
    expect(report.omitidos).toEqual([]);
    expect(report.indexados).toHaveLength(5);
  });

  it("filters by a declared tipo from the reproduced taxonomy", async () => {
    const soloAdr = await harness.search.execute({ query: "decisión arquitectura", tipo: "adr", k: 10 });
    expect(soloAdr.resultados.length).toBeGreaterThan(0);
    expect(soloAdr.resultados.every((r) => r.ruta === "decision-cache-redis.md")).toBe(true);
  });

  it("excludes the declared borrador/obsoleto estados from search by default", async () => {
    const porDefecto = await harness.search.execute({ query: "alertas de inventario plan de pruebas", k: 10 });
    expect(porDefecto.resultados.map((r) => r.ruta)).not.toContain("plan-pruebas-alertas.md");

    const conTodos = await harness.search.execute({
      query: "alertas de inventario plan de pruebas",
      k: 10,
      incluirNoVigentes: true,
    });
    expect(conTodos.resultados.map((r) => r.ruta)).toContain("plan-pruebas-alertas.md");
  });
});

// --- IndexDocuments: libre/estricto convention modes + resilience -------

const LIBRE: ConvencionConfig = {
  modo: "libre",
  estadosExcluidos: [],
  camposFrontmatter: { tipo: "tipo", modulo: "modulo", estado: "estado" },
};

function cfgEstricto(overrides: Partial<ConvencionConfig> = {}): ConvencionConfig {
  return {
    modo: "estricto",
    estadosExcluidos: [],
    camposFrontmatter: { tipo: "tipo", modulo: "modulo", estado: "estado" },
    ...overrides,
  };
}

class StaticSource implements DocumentSource {
  constructor(
    private readonly files: DocumentFile[],
    private readonly erroresLectura: { ruta: string; error: string }[] = [],
  ) {}
  async discover(): Promise<DiscoverResult> {
    return { files: this.files, erroresLectura: this.erroresLectura };
  }
}

function buildIndexer(
  source: DocumentSource,
  convencion: ConvencionConfig = LIBRE,
): { indexer: IndexDocuments; store: SqliteIndexStore } {
  const store = new SqliteIndexStore(":memory:");
  const indexer = new IndexDocuments(source, new RemarkMarkdownParser(), store, null, crearConvencionPolicy(convencion), {
    chunking: { minTokens: 10, maxTokens: 800 },
    sinChunking: [],
  });
  return { indexer, store };
}

describe("IndexDocuments — libre mode never skips for metadata reasons", () => {
  it("indexes a document with no frontmatter at all, with tipo/modulo/estado absent", async () => {
    const { indexer, store } = buildIndexer(
      new StaticSource([{ ruta: "sin-frontmatter.md", contenido: "# Sin frontmatter\n\nTexto suelto.\n" }]),
    );
    const report = await indexer.execute();
    expect(report.omitidos).toEqual([]);
    expect(report.indexados).toHaveLength(1);

    const doc = store.getDocumentByRuta("sin-frontmatter.md");
    expect(doc).not.toBeNull();
    expect(doc!.tipo).toBeUndefined();
    expect(doc!.estado).toBeUndefined();
    store.close();
  });
});

describe("IndexDocuments — estricto mode validates declared taxonomies", () => {
  it("accepts a document whose tipo/estado match the declared taxonomies", async () => {
    const { indexer, store } = buildIndexer(
      new StaticSource([
        {
          ruta: "auth/login.md",
          contenido: "---\ntipo: guia\nmodulo: auth\nestado: vigente\n---\n\n# Login\n\nResumen.\n",
        },
      ]),
      cfgEstricto({ tipos: ["guia"], estados: ["vigente"] }),
    );
    const report = await indexer.execute();
    expect(report.omitidos).toEqual([]);
    expect(report.indexados).toHaveLength(1);
    store.close();
  });

  it("rejects and reports a document with a tipo outside the declared taxonomy", async () => {
    const { indexer, store } = buildIndexer(
      new StaticSource([
        {
          ruta: "auth/login.md",
          contenido: "---\ntipo: no-declarado\nmodulo: auth\nestado: vigente\n---\n\n# Login\n\nResumen.\n",
        },
      ]),
      cfgEstricto({ tipos: ["guia"] }),
    );
    const report = await indexer.execute();
    expect(report.indexados).toEqual([]);
    expect(report.omitidos).toHaveLength(1);
    expect(report.omitidos[0]!.ruta).toBe("auth/login.md");
    store.close();
  });
});

describe("IndexDocuments — resilience skip reasons (mode-independent)", () => {
  it("folds an unreadable file into omitidos and continues indexing the rest, under libre", async () => {
    const { indexer, store } = buildIndexer(
      new StaticSource(
        [{ ruta: "ok.md", contenido: "# OK\n\nTexto.\n" }],
        [{ ruta: "roto.md", error: "permiso denegado" }],
      ),
    );
    const report = await indexer.execute();
    expect(report.indexados).toHaveLength(1);
    expect(report.omitidos).toEqual([{ ruta: "roto.md", errores: ["permiso denegado"] }]);
    store.close();
  });

  it("folds an unreadable file into omitidos and continues indexing the rest, under estricto", async () => {
    const { indexer, store } = buildIndexer(
      new StaticSource(
        [
          {
            ruta: "ok.md",
            contenido: "---\ntipo: guia\nmodulo: m\nestado: vigente\n---\n\n# OK\n\nTexto.\n",
          },
        ],
        [{ ruta: "roto.md", error: "permiso denegado" }],
      ),
      cfgEstricto(),
    );
    const report = await indexer.execute();
    expect(report.indexados).toHaveLength(1);
    expect(report.omitidos).toEqual([{ ruta: "roto.md", errores: ["permiso denegado"] }]);
    store.close();
  });

  it("skips a document with malformed YAML frontmatter and continues, under libre", async () => {
    const { indexer, store } = buildIndexer(
      new StaticSource([
        { ruta: "ok.md", contenido: "# OK\n\nTexto.\n" },
        { ruta: "malformado.md", contenido: "---\ntipo: [sin-cerrar\n---\n\n# X\n" },
      ]),
    );
    const report = await indexer.execute();
    expect(report.indexados).toHaveLength(1);
    expect(report.omitidos).toHaveLength(1);
    expect(report.omitidos[0]!.ruta).toBe("malformado.md");
    store.close();
  });

  it("skips a document with malformed YAML frontmatter and continues, under estricto", async () => {
    const { indexer, store } = buildIndexer(
      new StaticSource([
        {
          ruta: "ok.md",
          contenido: "---\ntipo: guia\nmodulo: m\nestado: vigente\n---\n\n# OK\n\nTexto.\n",
        },
        { ruta: "malformado.md", contenido: "---\ntipo: [sin-cerrar\n---\n\n# X\n" },
      ]),
      cfgEstricto(),
    );
    const report = await indexer.execute();
    expect(report.indexados).toHaveLength(1);
    expect(report.omitidos).toHaveLength(1);
    expect(report.omitidos[0]!.ruta).toBe("malformado.md");
    store.close();
  });

  it("skips a document with no indexable content", async () => {
    const { indexer, store } = buildIndexer(
      new StaticSource([{ ruta: "vacio.md", contenido: "# Solo título\n\n" }]),
    );
    const report = await indexer.execute();
    expect(report.indexados).toEqual([]);
    expect(report.omitidos).toEqual([
      { ruta: "vacio.md", errores: ["el documento no tiene contenido indexable"] },
    ]);
    store.close();
  });
});

// --- SearchDocuments: open tipo + estadosExcluidos deny-list -------------

function seedDoc(
  store: SqliteIndexStore,
  overrides: { ruta: string; tipo?: string; estado?: string; contenido: string },
): void {
  const meta = {
    ruta: overrides.ruta,
    titulo: overrides.ruta,
    resumen: "r",
    etiquetas: [],
    hash: overrides.ruta,
    ...(overrides.tipo !== undefined ? { tipo: overrides.tipo } : {}),
    ...(overrides.estado !== undefined ? { estado: overrides.estado } : {}),
  };
  store.saveDocument(meta, [{ encabezado: "H", contenido: overrides.contenido, orden: 0 }]);
}

describe("SearchDocuments — open tipo filtering", () => {
  it("filters by a project-specific tipo value not in any hardcoded list", async () => {
    const store = new SqliteIndexStore(":memory:");
    seedDoc(store, { ruta: "a.md", tipo: "runbook", contenido: "contenido unico alfa" });
    seedDoc(store, { ruta: "b.md", tipo: "otro", contenido: "contenido unico alfa" });
    const search = new SearchDocuments(store, null, { k: 10, estadosExcluidos: [] });

    const response = await search.execute({ query: "contenido unico alfa", tipo: "runbook" });
    expect(response.resultados.map((r) => r.ruta)).toEqual(["a.md"]);
    store.close();
  });

  it("treats an empty or whitespace-only tipo as absent (no filtering applied)", async () => {
    const store = new SqliteIndexStore(":memory:");
    seedDoc(store, { ruta: "a.md", tipo: "runbook", contenido: "contenido unico beta" });
    seedDoc(store, { ruta: "b.md", tipo: "otro", contenido: "contenido unico beta" });
    const search = new SearchDocuments(store, null, { k: 10, estadosExcluidos: [] });

    const response = await search.execute({ query: "contenido unico beta", tipo: "   " });
    expect(response.resultados.map((r) => r.ruta).sort()).toEqual(["a.md", "b.md"]);
    store.close();
  });
});

describe("SearchDocuments — config-driven estadosExcluidos deny-list", () => {
  it("excludes nothing when estadosExcluidos is not declared", async () => {
    const store = new SqliteIndexStore(":memory:");
    seedDoc(store, { ruta: "a.md", estado: "borrador", contenido: "contenido unico gamma" });
    const search = new SearchDocuments(store, null, { k: 10, estadosExcluidos: [] });

    const response = await search.execute({ query: "contenido unico gamma" });
    expect(response.resultados.map((r) => r.ruta)).toContain("a.md");
    store.close();
  });

  it("excludes declared estados by default, includes them with incluirNoVigentes", async () => {
    const store = new SqliteIndexStore(":memory:");
    seedDoc(store, { ruta: "a.md", estado: "borrador", contenido: "contenido unico delta" });
    const search = new SearchDocuments(store, null, { k: 10, estadosExcluidos: ["borrador"] });

    const excluded = await search.execute({ query: "contenido unico delta" });
    expect(excluded.resultados.map((r) => r.ruta)).not.toContain("a.md");

    const included = await search.execute({ query: "contenido unico delta", incluirNoVigentes: true });
    expect(included.resultados.map((r) => r.ruta)).toContain("a.md");
    store.close();
  });

  it("is a true no-op when estadosExcluidos is not declared, regardless of incluirNoVigentes", async () => {
    const store = new SqliteIndexStore(":memory:");
    seedDoc(store, { ruta: "a.md", estado: "borrador", contenido: "contenido unico epsilon" });
    const search = new SearchDocuments(store, null, { k: 10, estadosExcluidos: [] });

    const sinFlag = await search.execute({ query: "contenido unico epsilon" });
    const conFlag = await search.execute({ query: "contenido unico epsilon", incluirNoVigentes: true });
    expect(sinFlag.resultados.map((r) => r.ruta)).toEqual(conFlag.resultados.map((r) => r.ruta));
    store.close();
  });

  it("a document with no estado remains eligible under a declared deny-list", async () => {
    const store = new SqliteIndexStore(":memory:");
    seedDoc(store, { ruta: "a.md", contenido: "contenido unico zeta" }); // no estado at all
    const search = new SearchDocuments(store, null, { k: 10, estadosExcluidos: ["borrador"] });

    const response = await search.execute({ query: "contenido unico zeta" });
    expect(response.resultados.map((r) => r.ruta)).toContain("a.md");
    store.close();
  });

  it("omits estado from the result item when the document has none", async () => {
    const store = new SqliteIndexStore(":memory:");
    seedDoc(store, { ruta: "a.md", contenido: "contenido unico eta" }); // no estado
    const search = new SearchDocuments(store, null, { k: 10, estadosExcluidos: [] });

    const response = await search.execute({ query: "contenido unico eta" });
    expect(response.resultados).toHaveLength(1);
    expect(response.resultados[0]!.estado).toBeUndefined();
    expect("estado" in response.resultados[0]!).toBe(false);
    store.close();
  });
});
