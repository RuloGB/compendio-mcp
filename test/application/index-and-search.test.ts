import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { ReadDocument } from "../../src/application/read-document";
import { SearchDocuments } from "../../src/application/search-documents";
import { SyncIndex } from "../../src/application/sync-index";
import { crearConvencionPolicy, type ConvencionConfig } from "../../src/domain/convencion";
import type { DiscoverResult, DocumentFile, DocumentSource } from "../../src/domain/ports";
import { FileDocumentSource } from "../../src/infrastructure/fs/file-document-source";
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
    expect(report.mode).toBe("hybrid");
    expect(report.skipped).toEqual([]);
    expect(report.indexed.length).toBeGreaterThan(0);
    expect(report.indexed.map((d) => d.path)).not.toContain("INDEX.md");
  });

  it("indexes the glossary as a single chunk (no heading chunking)", () => {
    const glosario = report.indexed.find((d) => d.path === "glosario.md");
    expect(glosario?.chunks).toBe(1);
  });

  it("zero-config: includeExcluded is a no-op because ejemplos declares no excludedStatuses", async () => {
    // informes/plan-pruebas.md keeps a light `estado: borrador` frontmatter field on purpose,
    // to demonstrate that a declared status alone does not exclude a document from search
    // unless the project also opts into `convencion.excludedStatuses`.
    const porDefecto = await harness.search.execute({ query: "borrador plan de pruebas panel", k: 10 });
    expect(porDefecto.results.map((r) => r.path)).toContain("informes/plan-pruebas.md");

    const conTodos = await harness.search.execute({
      query: "borrador plan de pruebas panel",
      k: 10,
      includeExcluded: true,
    });
    expect(conTodos.results.map((r) => r.path)).toContain("informes/plan-pruebas.md");
  });

  it("bridges the semantic gap: synonyms with zero lexical overlap still retrieve", async () => {
    // "registros clonados" appears nowhere in the corpus; "duplicado" does.
    const lexical = await harness.search.execute({ query: "registros clonados", forceLexical: true });
    expect(lexical.mode).toBe("lexical");
    expect(lexical.results).toEqual([]);

    const hybrid = await harness.search.execute({ query: "registros clonados" });
    expect(hybrid.mode).toBe("hybrid");
    const paths = hybrid.results.slice(0, 3).map((r) => r.path);
    expect(paths).toContain("leadsviewer/validacion-formulario.md");
  });

  it("filters by module (folder-inferred, zero-config)", async () => {
    const soloInformes = await harness.search.execute({
      query: "leads",
      module: "informes",
      k: 10,
    });
    expect(soloInformes.results.length).toBeGreaterThan(0);
    expect(soloInformes.results.every((r) => r.path.startsWith("informes/"))).toBe(true);
  });

  it("filters by tags", async () => {
    const withTag = await harness.search.execute({
      query: "leads fichero",
      tags: ["csv"],
      k: 10,
    });
    expect(withTag.results.length).toBeGreaterThan(0);
    expect(withTag.results.every((r) => r.path === "leadsviewer/importacion-csv.md")).toBe(true);
  });

  it("returns at most 2 chunks per document", async () => {
    const respuesta = await harness.search.execute({
      query: "lead email formulario validación",
      k: 10,
    });
    const porPath = new Map<string, number>();
    for (const item of respuesta.results) {
      porPath.set(item.path, (porPath.get(item.path) ?? 0) + 1);
    }
    for (const [, count] of porPath) {
      expect(count).toBeLessThanOrEqual(2);
    }
  });

  it("returns compact results with path, section, excerpt and status when the document declares one", async () => {
    const respuesta = await harness.search.execute({ query: "borrador plan de pruebas panel de informes" });
    expect(respuesta.results.length).toBeGreaterThan(0);
    const primero = respuesta.results[0]!;
    expect(primero.path).toBe("informes/plan-pruebas.md");
    expect(primero.section.length).toBeGreaterThan(0);
    expect(primero.status).toBe("borrador");
    expect(primero.excerpt.length).toBeLessThanOrEqual(300);
    expect(primero.excerpt).not.toContain("###");
  });

  it("omits status from results when the document declares none (zero-config default)", async () => {
    const respuesta = await harness.search.execute({ query: "email duplicado" });
    expect(respuesta.results.length).toBeGreaterThan(0);
    const primero = respuesta.results[0]!;
    expect(primero.path.length).toBeGreaterThan(0);
    expect(primero.section.length).toBeGreaterThan(0);
    expect(primero.status).toBeUndefined();
    expect(primero.excerpt.length).toBeLessThanOrEqual(300);
    expect(primero.excerpt).not.toContain("###");
  });
});

describe("graceful degradation to lexical mode", () => {
  it("indexes without embeddings provider and searches in lexical mode", async () => {
    const harness = buildHarness(null);
    const report = await harness.index.execute();
    expect(report.mode).toBe("lexical");
    expect(report.embeddingsWarning).toBeDefined();

    const respuesta = await harness.search.execute({ query: "email duplicado" });
    expect(respuesta.mode).toBe("lexical");
    expect(respuesta.results.length).toBeGreaterThan(0);
    harness.close();
  });

  it("survives a provider that throws at runtime", async () => {
    const harness = buildHarness(new BrokenEmbeddings());
    const report = await harness.index.execute();
    expect(report.mode).toBe("lexical");
    expect(report.embeddingsWarning).toContain("roto");
    expect(harness.store.hasVectors()).toBe(false);

    const respuesta = await harness.search.execute({ query: "email duplicado" });
    expect(respuesta.mode).toBe("lexical");
    harness.close();
  });
});

// --- Secondary synthetic fixture (D1.3): reproduces the retired,
// pre-migration full-convention (estricto) behavior that ejemplos/ used to
// demonstrate before becoming the zero-config corpus. ---------------------

describe("estricto synthetic fixture — declared taxonomy, type filtering, deny-list", () => {
  let harness: TestHarness;
  let report: IndexReport;

  beforeAll(async () => {
    harness = buildHarness(new FakeEmbeddings(), ESTRICTO_FIXTURE_CONVENCION, ESTRICTO_FIXTURE_DOCS);
    report = await harness.index.execute();
  });

  afterAll(() => {
    harness.close();
  });

  it("indexes every fixture document with zero skipped", () => {
    expect(report.skipped).toEqual([]);
    expect(report.indexed).toHaveLength(5);
  });

  it("filters by a declared type from the reproduced taxonomy", async () => {
    const soloAdr = await harness.search.execute({ query: "decisión arquitectura", type: "adr", k: 10 });
    expect(soloAdr.results.length).toBeGreaterThan(0);
    expect(soloAdr.results.every((r) => r.path === "decision-cache-redis.md")).toBe(true);
  });

  it("excludes the declared borrador/obsoleto statuses from search by default", async () => {
    const porDefecto = await harness.search.execute({ query: "alertas de inventario plan de pruebas", k: 10 });
    expect(porDefecto.results.map((r) => r.path)).not.toContain("plan-pruebas-alertas.md");

    const conTodos = await harness.search.execute({
      query: "alertas de inventario plan de pruebas",
      k: 10,
      includeExcluded: true,
    });
    expect(conTodos.results.map((r) => r.path)).toContain("plan-pruebas-alertas.md");
  });
});

// --- IndexDocuments: libre/estricto convention modes + resilience -------

const LIBRE: ConvencionConfig = {
  modo: "libre",
  excludedStatuses: [],
  camposFrontmatter: { type: "tipo", module: "modulo", status: "estado" },
};

function cfgEstricto(overrides: Partial<ConvencionConfig> = {}): ConvencionConfig {
  return {
    modo: "estricto",
    excludedStatuses: [],
    camposFrontmatter: { type: "tipo", module: "modulo", status: "estado" },
    ...overrides,
  };
}

class StaticSource implements DocumentSource {
  constructor(
    private readonly files: DocumentFile[],
    private readonly readErrors: { path: string; error: string }[] = [],
  ) {}
  async discover(): Promise<DiscoverResult> {
    return { files: this.files, readErrors: this.readErrors };
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
  it("indexes a document with no frontmatter at all, with type/module/status absent", async () => {
    const { indexer, store } = buildIndexer(
      new StaticSource([{ path: "sin-frontmatter.md", content: "# Sin frontmatter\n\nTexto suelto.\n" }]),
    );
    const report = await indexer.execute();
    expect(report.skipped).toEqual([]);
    expect(report.indexed).toHaveLength(1);

    const doc = store.getDocumentByPath("sin-frontmatter.md");
    expect(doc).not.toBeNull();
    expect(doc!.type).toBeUndefined();
    expect(doc!.status).toBeUndefined();
    store.close();
  });
});

describe("IndexDocuments — estricto mode validates declared taxonomies", () => {
  it("accepts a document whose type/status match the declared taxonomies", async () => {
    const { indexer, store } = buildIndexer(
      new StaticSource([
        {
          path: "auth/login.md",
          content: "---\ntipo: guia\nmodulo: auth\nestado: vigente\n---\n\n# Login\n\nResumen.\n",
        },
      ]),
      cfgEstricto({ types: ["guia"], statuses: ["vigente"] }),
    );
    const report = await indexer.execute();
    expect(report.skipped).toEqual([]);
    expect(report.indexed).toHaveLength(1);
    store.close();
  });

  it("rejects and reports a document with a type outside the declared taxonomy", async () => {
    const { indexer, store } = buildIndexer(
      new StaticSource([
        {
          path: "auth/login.md",
          content: "---\ntipo: no-declarado\nmodulo: auth\nestado: vigente\n---\n\n# Login\n\nResumen.\n",
        },
      ]),
      cfgEstricto({ types: ["guia"] }),
    );
    const report = await indexer.execute();
    expect(report.indexed).toEqual([]);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0]!.path).toBe("auth/login.md");
    store.close();
  });
});

describe("IndexDocuments — resilience skip reasons (mode-independent)", () => {
  it("folds an unreadable file into skipped and continues indexing the rest, under libre", async () => {
    const { indexer, store } = buildIndexer(
      new StaticSource(
        [{ path: "ok.md", content: "# OK\n\nTexto.\n" }],
        [{ path: "roto.md", error: "permiso denegado" }],
      ),
    );
    const report = await indexer.execute();
    expect(report.indexed).toHaveLength(1);
    expect(report.skipped).toEqual([{ path: "roto.md", errors: ["permiso denegado"] }]);
    store.close();
  });

  it("folds an unreadable file into skipped and continues indexing the rest, under estricto", async () => {
    const { indexer, store } = buildIndexer(
      new StaticSource(
        [
          {
            path: "ok.md",
            content: "---\ntipo: guia\nmodulo: m\nestado: vigente\n---\n\n# OK\n\nTexto.\n",
          },
        ],
        [{ path: "roto.md", error: "permiso denegado" }],
      ),
      cfgEstricto(),
    );
    const report = await indexer.execute();
    expect(report.indexed).toHaveLength(1);
    expect(report.skipped).toEqual([{ path: "roto.md", errors: ["permiso denegado"] }]);
    store.close();
  });

  it("skips a document with malformed YAML frontmatter and continues, under libre", async () => {
    const { indexer, store } = buildIndexer(
      new StaticSource([
        { path: "ok.md", content: "# OK\n\nTexto.\n" },
        { path: "malformado.md", content: "---\ntipo: [sin-cerrar\n---\n\n# X\n" },
      ]),
    );
    const report = await indexer.execute();
    expect(report.indexed).toHaveLength(1);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0]!.path).toBe("malformado.md");
    store.close();
  });

  it("skips a document with malformed YAML frontmatter and continues, under estricto", async () => {
    const { indexer, store } = buildIndexer(
      new StaticSource([
        {
          path: "ok.md",
          content: "---\ntipo: guia\nmodulo: m\nestado: vigente\n---\n\n# OK\n\nTexto.\n",
        },
        { path: "malformado.md", content: "---\ntipo: [sin-cerrar\n---\n\n# X\n" },
      ]),
      cfgEstricto(),
    );
    const report = await indexer.execute();
    expect(report.indexed).toHaveLength(1);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0]!.path).toBe("malformado.md");
    store.close();
  });

  it("skips a document with no indexable content", async () => {
    const { indexer, store } = buildIndexer(
      new StaticSource([{ path: "vacio.md", content: "# Solo título\n\n" }]),
    );
    const report = await indexer.execute();
    expect(report.indexed).toEqual([]);
    expect(report.skipped).toEqual([
      { path: "vacio.md", errors: ["el documento no tiene contenido indexable"] },
    ]);
    store.close();
  });
});

// --- SearchDocuments: open type + excludedStatuses deny-list -------------

function seedDoc(
  store: SqliteIndexStore,
  overrides: { path: string; type?: string; status?: string; content: string },
): void {
  const meta = {
    path: overrides.path,
    title: overrides.path,
    summary: "r",
    tags: [],
    hash: overrides.path,
    ...(overrides.type !== undefined ? { type: overrides.type } : {}),
    ...(overrides.status !== undefined ? { status: overrides.status } : {}),
  };
  store.saveDocument(meta, [{ heading: "H", content: overrides.content, position: 0 }]);
}

describe("SearchDocuments — open type filtering", () => {
  it("filters by a project-specific type value not in any hardcoded list", async () => {
    const store = new SqliteIndexStore(":memory:");
    seedDoc(store, { path: "a.md", type: "runbook", content: "contenido unico alfa" });
    seedDoc(store, { path: "b.md", type: "otro", content: "contenido unico alfa" });
    const search = new SearchDocuments(store, null, { k: 10, excludedStatuses: [] });

    const response = await search.execute({ query: "contenido unico alfa", type: "runbook" });
    expect(response.results.map((r) => r.path)).toEqual(["a.md"]);
    store.close();
  });

  it("treats an empty or whitespace-only type as absent (no filtering applied)", async () => {
    const store = new SqliteIndexStore(":memory:");
    seedDoc(store, { path: "a.md", type: "runbook", content: "contenido unico beta" });
    seedDoc(store, { path: "b.md", type: "otro", content: "contenido unico beta" });
    const search = new SearchDocuments(store, null, { k: 10, excludedStatuses: [] });

    const response = await search.execute({ query: "contenido unico beta", type: "   " });
    expect(response.results.map((r) => r.path).sort()).toEqual(["a.md", "b.md"]);
    store.close();
  });
});

describe("SearchDocuments — config-driven excludedStatuses deny-list", () => {
  it("excludes nothing when excludedStatuses is not declared", async () => {
    const store = new SqliteIndexStore(":memory:");
    seedDoc(store, { path: "a.md", status: "borrador", content: "contenido unico gamma" });
    const search = new SearchDocuments(store, null, { k: 10, excludedStatuses: [] });

    const response = await search.execute({ query: "contenido unico gamma" });
    expect(response.results.map((r) => r.path)).toContain("a.md");
    store.close();
  });

  it("excludes declared statuses by default, includes them with includeExcluded", async () => {
    const store = new SqliteIndexStore(":memory:");
    seedDoc(store, { path: "a.md", status: "borrador", content: "contenido unico delta" });
    const search = new SearchDocuments(store, null, { k: 10, excludedStatuses: ["borrador"] });

    const excluded = await search.execute({ query: "contenido unico delta" });
    expect(excluded.results.map((r) => r.path)).not.toContain("a.md");

    const included = await search.execute({ query: "contenido unico delta", includeExcluded: true });
    expect(included.results.map((r) => r.path)).toContain("a.md");
    store.close();
  });

  it("is a true no-op when excludedStatuses is not declared, regardless of includeExcluded", async () => {
    const store = new SqliteIndexStore(":memory:");
    seedDoc(store, { path: "a.md", status: "borrador", content: "contenido unico epsilon" });
    const search = new SearchDocuments(store, null, { k: 10, excludedStatuses: [] });

    const sinFlag = await search.execute({ query: "contenido unico epsilon" });
    const conFlag = await search.execute({ query: "contenido unico epsilon", includeExcluded: true });
    expect(sinFlag.results.map((r) => r.path)).toEqual(conFlag.results.map((r) => r.path));
    store.close();
  });

  it("a document with no status remains eligible under a declared deny-list", async () => {
    const store = new SqliteIndexStore(":memory:");
    seedDoc(store, { path: "a.md", content: "contenido unico zeta" }); // no status at all
    const search = new SearchDocuments(store, null, { k: 10, excludedStatuses: ["borrador"] });

    const response = await search.execute({ query: "contenido unico zeta" });
    expect(response.results.map((r) => r.path)).toContain("a.md");
    store.close();
  });

  it("omits status from the result item when the document has none", async () => {
    const store = new SqliteIndexStore(":memory:");
    seedDoc(store, { path: "a.md", content: "contenido unico eta" }); // no status
    const search = new SearchDocuments(store, null, { k: 10, excludedStatuses: [] });

    const response = await search.execute({ query: "contenido unico eta" });
    expect(response.results).toHaveLength(1);
    expect(response.results[0]!.status).toBeUndefined();
    expect("status" in response.results[0]!).toBe(false);
    store.close();
  });
});

// --- SyncIndex end-to-end: a temp docs directory on real disk -----------

describe("SyncIndex — end-to-end incremental sync over a temp docs directory", () => {
  it("reflects an added, edited, and deleted file across successive sync passes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "compendio-sync-e2e-"));
    // Deliberately disjoint vocabulary across original/edited/added content —
    // a shared word (even "content") would make the lexical assertions
    // below pass for the wrong reason.
    writeFileSync(join(dir, "a.md"), "# A\n\nTextoalfaoriginalunicoirrepetible.\n");

    const store = new SqliteIndexStore(":memory:");
    const source = new FileDocumentSource(dir, []);
    const parser = new RemarkMarkdownParser();
    const policy = crearConvencionPolicy(LIBRE);
    const embeddings = new FakeEmbeddings();
    const sync = new SyncIndex(source, parser, store, embeddings, policy, {
      chunking: { minTokens: 10, maxTokens: 800 },
      sinChunking: [],
    });
    const search = new SearchDocuments(store, embeddings, { k: 10, excludedStatuses: [] });
    const read = new ReadDocument(store);

    try {
      // 1. Add: first pass indexes the new file.
      await sync.execute();
      const initial = await search.execute({
        query: "textoalfaoriginalunicoirrepetible",
        forceLexical: true,
      });
      expect(initial.results.map((r) => r.path)).toContain("a.md");

      // 2. Edit: content changes (hash differs) -> re-indexed, old content gone.
      writeFileSync(join(dir, "a.md"), "# A\n\nTextobetaeditadodistintototalmente.\n");
      await sync.execute();
      const edited = await search.execute({
        query: "textobetaeditadodistintototalmente",
        forceLexical: true,
      });
      expect(edited.results.map((r) => r.path)).toContain("a.md");
      const stale = await search.execute({
        query: "textoalfaoriginalunicoirrepetible",
        forceLexical: true,
      });
      expect(stale.results.map((r) => r.path)).not.toContain("a.md");

      // Add a second file alongside the edited one.
      writeFileSync(join(dir, "b.md"), "# B\n\nTextogammanuevodiferenteaparte.\n");
      await sync.execute();
      const added = await search.execute({
        query: "textogammanuevodiferenteaparte",
        forceLexical: true,
      });
      expect(added.results.map((r) => r.path)).toContain("b.md");

      // 3. Delete: a.md removed from disk -> removed from the index, read
      // falls back to closest-match suggestions instead of erroring.
      rmSync(join(dir, "a.md"));
      await sync.execute();
      const afterDelete = read.execute({ path: "a.md" });
      expect(afterDelete.type).toBe("path-not-found");
      const stillThere = await search.execute({
        query: "textogammanuevodiferenteaparte",
        forceLexical: true,
      });
      expect(stillThere.results.map((r) => r.path)).toContain("b.md");
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
