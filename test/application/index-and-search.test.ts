import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildHarness,
  STRICT_FIXTURE_CONVENTION,
  STRICT_FIXTURE_DOCS,
  type TestHarness,
} from "../helpers/build";
import { cp1252Bytes } from "../helpers/cp1252";
import { BrokenEmbeddings, FakeEmbeddings } from "../helpers/fake-embeddings";
import { createContainer } from "../../src/composition";
import { IndexDocuments } from "../../src/application/index-documents";
import type { IndexReport } from "../../src/application/index-documents";
import { computeHash } from "../../src/application/index-pipeline";
import { ReadDocument } from "../../src/application/read-document";
import { SearchDocuments } from "../../src/application/search-documents";
import { SyncIndex } from "../../src/application/sync-index";
import { createConventionPolicy, type ConventionConfig } from "../../src/domain/convention";
import { LEAD_EXCERPT_CHARS, SUPPORTING_EXCERPT_CHARS } from "../../src/domain/excerpt";
import type { DiscoverResult, DocumentFile, DocumentSource } from "../../src/domain/ports";
import { FileDocumentSource } from "../../src/infrastructure/fs/file-document-source";
import { RemarkMarkdownParser } from "../../src/infrastructure/markdown/remark-markdown-parser";
import { SqliteIndexStore } from "../../src/infrastructure/sqlite/sqlite-index-store";

// es-frozen: cites the real `ejemplos/` corpus name, not a leftover translation.
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

  // es-frozen: "glosario.md" is the real frozen `ejemplos/` corpus filename,
  // not a leftover translation.
  it("indexes the glossary as a single chunk (no heading chunking)", () => {
    const glosario = report.indexed.find((d) => d.path === "docs/glosario.md");
    expect(glosario?.chunks).toBe(1);
  });

  // es-frozen: cites the real `ejemplos/` corpus name, not a leftover translation.
  it("zero-config: includeExcluded is a no-op because ejemplos declares no excludedStatuses", async () => {
    // informes/plan-pruebas.md keeps a light `status: borrador` frontmatter field on purpose,
    // to demonstrate that a declared status alone does not exclude a document from search
    // unless the project also opts into `convention.excludedStatuses`.
    const porDefecto = await harness.search.execute({ query: "borrador plan de pruebas panel", k: 10 });
    expect(porDefecto.results.map((r) => r.path)).toContain("docs/informes/plan-pruebas.md");

    const conTodos = await harness.search.execute({
      query: "borrador plan de pruebas panel",
      k: 10,
      includeExcluded: true,
    });
    expect(conTodos.results.map((r) => r.path)).toContain("docs/informes/plan-pruebas.md");
  });

  it("bridges the semantic gap: synonyms with zero lexical overlap still retrieve", async () => {
    // "registros clonados" appears nowhere in the corpus; "duplicado" does.
    const lexical = await harness.search.execute({ query: "registros clonados", forceLexical: true });
    expect(lexical.mode).toBe("lexical");
    expect(lexical.results).toEqual([]);

    const hybrid = await harness.search.execute({ query: "registros clonados" });
    expect(hybrid.mode).toBe("hybrid");
    const paths = hybrid.results.slice(0, 3).map((r) => r.path);
    expect(paths).toContain("docs/leadsviewer/validacion-formulario.md");
  });

  // PR 2 intermediate state (design.md tasks.md Phase 12): `inferModule` is
  // not yet alias-aware, so every top-level-root document's first path
  // segment is now the root's own alias ("docs"), not its real folder. This
  // is the accepted, temporary regression Decision 7 / Phase 12 fixes in
  // PR 3 — folder-based `module` filtering is not honestly testable until
  // then, so this restates today's real (naive) behavior instead of
  // asserting the pre-change one.
  it.skip("filters by module (folder-inferred, zero-config) — restored in PR 3 (alias-aware inferModule)", async () => {
    const soloInformes = await harness.search.execute({
      query: "leads",
      module: "informes",
      k: 10,
    });
    expect(soloInformes.results.length).toBeGreaterThan(0);
    expect(soloInformes.results.every((r) => r.path.startsWith("docs/informes/"))).toBe(true);
  });

  it("filters by tags", async () => {
    const withTag = await harness.search.execute({
      query: "leads fichero",
      tags: ["csv"],
      k: 10,
    });
    expect(withTag.results.length).toBeGreaterThan(0);
    expect(withTag.results.every((r) => r.path === "docs/leadsviewer/importacion-csv.md")).toBe(true);
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
    expect(primero.path).toBe("docs/informes/plan-pruebas.md");
    expect(primero.section.length).toBeGreaterThan(0);
    expect(primero.status).toBe("borrador");
    // +2: the rank-1 excerpt is now a window (match-centred-excerpt), which
    // can carry an ellipsis at BOTH truncated edges, not only a trailing one.
    expect(primero.excerpt.length).toBeLessThanOrEqual(LEAD_EXCERPT_CHARS + 2);
    expect(primero.excerpt).not.toContain("###");
  });

  it("omits status from results when the document declares none (zero-config default)", async () => {
    const respuesta = await harness.search.execute({ query: "email duplicado" });
    expect(respuesta.results.length).toBeGreaterThan(0);
    const primero = respuesta.results[0]!;
    expect(primero.path.length).toBeGreaterThan(0);
    expect(primero.section.length).toBeGreaterThan(0);
    expect(primero.status).toBeUndefined();
    // +2, same reason as above: a rank-1 window can be truncated on both edges.
    expect(primero.excerpt.length).toBeLessThanOrEqual(LEAD_EXCERPT_CHARS + 2);
    expect(primero.excerpt).not.toContain("###");
  });

  // es-frozen: cites the real `ejemplos/` corpus name, not a leftover translation.
  it("drops a filter no document could satisfy and says so, rather than returning zero", async () => {
    // `ejemplos/` declares only `status` in its frontmatter — no `type` on any
    // document — the same shape as a project whose non-English keys were never
    // mapped. An agent inferring `type` from directory names must still get an
    // answer, because a zero here is measurably read as "search harder".
    const respuesta = await harness.search.execute({
      query: "email duplicado",
      type: "uc",
    });
    expect(respuesta.results.length).toBeGreaterThan(0);
    expect(respuesta.filterWarning).toBeDefined();
    expect(respuesta.filterWarning).toContain("type");
    // Dropping a filter must never be silent, and must name the real fix.
    expect(respuesta.filterWarning).toContain("convention.frontmatterFields");
  });

  // es-frozen: cites the real `ejemplos/` corpus name, not a leftover translation.
  it("keeps a filter on a declared field and reports the values that exist", async () => {
    // `status` IS declared in ejemplos/, so an unknown value is an answerable
    // request: the filter stays and the caller gets the real values to correct
    // itself with. Only structurally impossible filters get dropped.
    const respuesta = await harness.search.execute({
      query: "email duplicado",
      tags: ["nonexistent-tag"],
    });
    expect(respuesta.filterWarning).toBeUndefined();
    if (respuesta.results.length === 0) {
      expect(respuesta.noMatchReason).toBeDefined();
    }
  });

  it("omits noMatchReason when the query simply matches nothing", async () => {
    const respuesta = await harness.search.execute({ query: "zzz" });
    if (respuesta.results.length === 0) {
      expect(respuesta.noMatchReason).toBeUndefined();
    }
  });

  it("spends the excerpt budget on the lead result and keeps the rest as signposts", async () => {
    const respuesta = await harness.search.execute({ query: "email duplicado", k: 5 });
    expect(respuesta.results.length).toBeGreaterThan(1);
    const [lead, ...supporting] = respuesta.results;
    // +2: the lead result's excerpt is a window, truncatable on both edges.
    expect(lead!.excerpt.length).toBeLessThanOrEqual(LEAD_EXCERPT_CHARS + 2);
    for (const result of supporting) {
      // Deliberately still +1, not +2: supporting fragments stay
      // start-anchored prefixes (design.md Decision 7) — never a window, so
      // never a leading ellipsis. Asserted explicitly (not left to drift)
      // so a later edit that starts centring supporting fragments too fails
      // loudly here instead of silently.
      expect(result.excerpt.length).toBeLessThanOrEqual(SUPPORTING_EXCERPT_CHARS + 1);
      expect(result.excerpt.startsWith("…")).toBe(false);
    }
    // The lead must actually be allowed to carry more, otherwise the gradient
    // exists in the constants but never reaches the wire.
    const longest = Math.max(...supporting.map((r) => r.excerpt.length));
    expect(lead!.excerpt.length).toBeGreaterThan(longest);
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

// es-frozen: cites the real `ejemplos/` corpus name, not a leftover translation.
// --- Secondary synthetic fixture (D1.3): reproduces the retired,
// pre-migration full-convention (strict) behavior that ejemplos/ used to
// demonstrate before becoming the zero-config corpus. ---------------------

describe("strict synthetic fixture — declared taxonomy, type filtering, deny-list", () => {
  let harness: TestHarness;
  let report: IndexReport;

  beforeAll(async () => {
    harness = buildHarness(new FakeEmbeddings(), STRICT_FIXTURE_CONVENTION, STRICT_FIXTURE_DOCS);
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
    const soloAdr = await harness.search.execute({ query: "architecture decision", type: "adr", k: 10 });
    expect(soloAdr.results.length).toBeGreaterThan(0);
    expect(soloAdr.results.every((r) => r.path === "docs/decision-redis-cache.md")).toBe(true);
  });

  it("excludes the declared draft/deprecated statuses from search by default", async () => {
    const porDefecto = await harness.search.execute({ query: "inventory alerts test plan", k: 10 });
    expect(porDefecto.results.map((r) => r.path)).not.toContain("docs/test-plan-inventory-alerts.md");

    const conTodos = await harness.search.execute({
      query: "inventory alerts test plan",
      k: 10,
      includeExcluded: true,
    });
    expect(conTodos.results.map((r) => r.path)).toContain("docs/test-plan-inventory-alerts.md");
  });
});

// --- IndexDocuments: loose/strict convention modes + resilience -------

const LOOSE: ConventionConfig = {
  mode: "loose",
  excludedStatuses: [],
  frontmatterFields: { type: "type", module: "module", status: "status" },
};

function cfgStrict(overrides: Partial<ConventionConfig> = {}): ConventionConfig {
  return {
    mode: "strict",
    excludedStatuses: [],
    frontmatterFields: { type: "type", module: "module", status: "status" },
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
  convention: ConventionConfig = LOOSE,
): { indexer: IndexDocuments; store: SqliteIndexStore } {
  const store = new SqliteIndexStore(":memory:");
  const indexer = new IndexDocuments(source, new RemarkMarkdownParser(), store, null, createConventionPolicy(convention), {
    chunking: { minTokens: 10, maxTokens: 800 },
    noChunking: [],
  });
  return { indexer, store };
}

describe("IndexDocuments — loose mode never skips for metadata reasons", () => {
  it("indexes a document with no frontmatter at all, with type/module/status absent", async () => {
    const { indexer, store } = buildIndexer(
      new StaticSource([{ path: "no-frontmatter.md", content: "# No frontmatter\n\nLoose text.\n" }]),
    );
    const report = await indexer.execute();
    expect(report.skipped).toEqual([]);
    expect(report.indexed).toHaveLength(1);

    const doc = store.getDocumentByPath("no-frontmatter.md");
    expect(doc).not.toBeNull();
    expect(doc!.type).toBeUndefined();
    expect(doc!.status).toBeUndefined();
    store.close();
  });
});

describe("IndexDocuments — strict mode validates declared taxonomies", () => {
  it("accepts a document whose type/status match the declared taxonomies", async () => {
    const { indexer, store } = buildIndexer(
      new StaticSource([
        {
          path: "auth/login.md",
          content: "---\ntype: guide\nmodule: auth\nstatus: current\n---\n\n# Login\n\nSummary.\n",
        },
      ]),
      cfgStrict({ types: ["guide"], statuses: ["current"] }),
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
          content: "---\ntype: not-declared\nmodule: auth\nstatus: current\n---\n\n# Login\n\nSummary.\n",
        },
      ]),
      cfgStrict({ types: ["guide"] }),
    );
    const report = await indexer.execute();
    expect(report.indexed).toEqual([]);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0]!.path).toBe("auth/login.md");
    store.close();
  });
});

describe("IndexDocuments — resilience skip reasons (mode-independent)", () => {
  it("folds an unreadable file into skipped and continues indexing the rest, under loose", async () => {
    const { indexer, store } = buildIndexer(
      new StaticSource(
        [{ path: "ok.md", content: "# OK\n\nText.\n" }],
        [{ path: "broken.md", error: "permission denied" }],
      ),
    );
    const report = await indexer.execute();
    expect(report.indexed).toHaveLength(1);
    expect(report.skipped).toEqual([{ path: "broken.md", errors: ["permission denied"] }]);
    store.close();
  });

  it("folds an unreadable file into skipped and continues indexing the rest, under strict", async () => {
    const { indexer, store } = buildIndexer(
      new StaticSource(
        [
          {
            path: "ok.md",
            content: "---\ntype: guide\nmodule: m\nstatus: current\n---\n\n# OK\n\nText.\n",
          },
        ],
        [{ path: "broken.md", error: "permission denied" }],
      ),
      cfgStrict(),
    );
    const report = await indexer.execute();
    expect(report.indexed).toHaveLength(1);
    expect(report.skipped).toEqual([{ path: "broken.md", errors: ["permission denied"] }]);
    store.close();
  });

  it("skips a document with malformed YAML frontmatter and continues, under loose", async () => {
    const { indexer, store } = buildIndexer(
      new StaticSource([
        { path: "ok.md", content: "# OK\n\nText.\n" },
        { path: "malformed.md", content: "---\ntype: [unclosed\n---\n\n# X\n" },
      ]),
    );
    const report = await indexer.execute();
    expect(report.indexed).toHaveLength(1);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0]!.path).toBe("malformed.md");
    store.close();
  });

  it("skips a document with malformed YAML frontmatter and continues, under strict", async () => {
    const { indexer, store } = buildIndexer(
      new StaticSource([
        {
          path: "ok.md",
          content: "---\ntype: guide\nmodule: m\nstatus: current\n---\n\n# OK\n\nText.\n",
        },
        { path: "malformed.md", content: "---\ntype: [unclosed\n---\n\n# X\n" },
      ]),
      cfgStrict(),
    );
    const report = await indexer.execute();
    expect(report.indexed).toHaveLength(1);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0]!.path).toBe("malformed.md");
    store.close();
  });

  it("skips a document with no indexable content", async () => {
    const { indexer, store } = buildIndexer(
      new StaticSource([{ path: "empty.md", content: "# Only title\n\n" }]),
    );
    const report = await indexer.execute();
    expect(report.indexed).toEqual([]);
    expect(report.skipped).toEqual([
      { path: "empty.md", errors: ["the document has no indexable content"] },
    ]);
    store.close();
  });
});

// W3 (verify-report.md): "genuinely undecodable, distinct message, never
// transcoded" was tested at the FileDocumentSource layer and under `loose`
// at the IndexDocuments layer, but never with a `strict` ConventionPolicy
// wired in. `StaticSource` above hands IndexDocuments already-decoded
// strings, so it cannot exercise decodeText's rejection at all -- this uses
// a real FileDocumentSource over actual on-disk bytes instead.
describe("IndexDocuments — undecodable content is skipped under strict mode too (mode-independent resilience)", () => {
  it("skips a binary file with the distinct encoding-rejection message under strict, and still indexes the valid document", async () => {
    const dir = mkdtempSync(join(tmpdir(), "compendio-strict-undecodable-"));
    writeFileSync(join(dir, "ok.md"), "---\ntype: guide\nmodule: m\nstatus: current\n---\n\n# OK\n\nText.\n");
    // JPEG magic header: contains 0x00, which rules out both UTF-8 and CP1252.
    writeFileSync(
      join(dir, "binary.md"),
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]),
    );

    const store = new SqliteIndexStore(":memory:");
    const source = new FileDocumentSource(dir, []);
    const indexer = new IndexDocuments(
      source,
      new RemarkMarkdownParser(),
      store,
      null,
      createConventionPolicy(cfgStrict({ types: ["guide"], statuses: ["current"] })),
      { chunking: { minTokens: 10, maxTokens: 800 }, noChunking: [] },
    );

    try {
      const report = await indexer.execute();

      expect(report.indexed.map((d) => d.path)).toEqual(["ok.md"]);
      expect(report.skipped).toHaveLength(1);
      expect(report.skipped[0]!.path).toBe("binary.md");
      // Distinguishable from a generic I/O error, and mode-independent: this
      // resilience reason is collected in discover(), ahead of and outside
      // ConventionPolicy entirely, before strict's own taxonomy checks run.
      expect(report.skipped[0]!.errors[0]).not.toMatch(/EACCES|ENOENT|permission denied/);
      expect(report.skipped[0]!.errors[0]).toContain("windows-1252");
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
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
    seedDoc(store, { path: "a.md", type: "runbook", content: "unique content alpha" });
    seedDoc(store, { path: "b.md", type: "other", content: "unique content alpha" });
    const search = new SearchDocuments(store, null, { k: 10, excludedStatuses: [] });

    const response = await search.execute({ query: "unique content alpha", type: "runbook" });
    expect(response.results.map((r) => r.path)).toEqual(["a.md"]);
    store.close();
  });

  it("treats an empty or whitespace-only type as absent (no filtering applied)", async () => {
    const store = new SqliteIndexStore(":memory:");
    seedDoc(store, { path: "a.md", type: "runbook", content: "unique content beta" });
    seedDoc(store, { path: "b.md", type: "other", content: "unique content beta" });
    const search = new SearchDocuments(store, null, { k: 10, excludedStatuses: [] });

    const response = await search.execute({ query: "unique content beta", type: "   " });
    expect(response.results.map((r) => r.path).sort()).toEqual(["a.md", "b.md"]);
    store.close();
  });
});

describe("SearchDocuments — config-driven excludedStatuses deny-list", () => {
  it("excludes nothing when excludedStatuses is not declared", async () => {
    const store = new SqliteIndexStore(":memory:");
    seedDoc(store, { path: "a.md", status: "borrador", content: "unique content gamma" });
    const search = new SearchDocuments(store, null, { k: 10, excludedStatuses: [] });

    const response = await search.execute({ query: "unique content gamma" });
    expect(response.results.map((r) => r.path)).toContain("a.md");
    store.close();
  });

  it("excludes declared statuses by default, includes them with includeExcluded", async () => {
    const store = new SqliteIndexStore(":memory:");
    seedDoc(store, { path: "a.md", status: "borrador", content: "unique content delta" });
    const search = new SearchDocuments(store, null, { k: 10, excludedStatuses: ["borrador"] });

    const excluded = await search.execute({ query: "unique content delta" });
    expect(excluded.results.map((r) => r.path)).not.toContain("a.md");

    const included = await search.execute({ query: "unique content delta", includeExcluded: true });
    expect(included.results.map((r) => r.path)).toContain("a.md");
    store.close();
  });

  it("is a true no-op when excludedStatuses is not declared, regardless of includeExcluded", async () => {
    const store = new SqliteIndexStore(":memory:");
    seedDoc(store, { path: "a.md", status: "borrador", content: "unique content epsilon" });
    const search = new SearchDocuments(store, null, { k: 10, excludedStatuses: [] });

    const withoutFlag = await search.execute({ query: "unique content epsilon" });
    const withFlag = await search.execute({ query: "unique content epsilon", includeExcluded: true });
    expect(withoutFlag.results.map((r) => r.path)).toEqual(withFlag.results.map((r) => r.path));
    store.close();
  });

  it("a document with no status remains eligible under a declared deny-list", async () => {
    const store = new SqliteIndexStore(":memory:");
    seedDoc(store, { path: "a.md", content: "unique content zeta" }); // no status at all
    const search = new SearchDocuments(store, null, { k: 10, excludedStatuses: ["borrador"] });

    const response = await search.execute({ query: "unique content zeta" });
    expect(response.results.map((r) => r.path)).toContain("a.md");
    store.close();
  });

  it("omits status from the result item when the document has none", async () => {
    const store = new SqliteIndexStore(":memory:");
    seedDoc(store, { path: "a.md", content: "unique content eta" }); // no status
    const search = new SearchDocuments(store, null, { k: 10, excludedStatuses: [] });

    const response = await search.execute({ query: "unique content eta" });
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
    writeFileSync(join(dir, "a.md"), "# A\n\nTextalphaoriginaluniqueunrepeatable.\n");

    const store = new SqliteIndexStore(":memory:");
    const source = new FileDocumentSource(dir, []);
    const parser = new RemarkMarkdownParser();
    const policy = createConventionPolicy(LOOSE);
    const embeddings = new FakeEmbeddings();
    const sync = new SyncIndex(source, parser, store, embeddings, policy, {
      chunking: { minTokens: 10, maxTokens: 800 },
      noChunking: [],
    });
    const search = new SearchDocuments(store, embeddings, { k: 10, excludedStatuses: [] });
    const read = new ReadDocument(store);

    try {
      // 1. Add: first pass indexes the new file.
      await sync.execute();
      const initial = await search.execute({
        query: "textalphaoriginaluniqueunrepeatable",
        forceLexical: true,
      });
      expect(initial.results.map((r) => r.path)).toContain("a.md");

      // 2. Edit: content changes (hash differs) -> re-indexed, old content gone.
      writeFileSync(join(dir, "a.md"), "# A\n\nTextbetaeditedcompletelydifferent.\n");
      await sync.execute();
      const edited = await search.execute({
        query: "textbetaeditedcompletelydifferent",
        forceLexical: true,
      });
      expect(edited.results.map((r) => r.path)).toContain("a.md");
      const stale = await search.execute({
        query: "textalphaoriginaluniqueunrepeatable",
        forceLexical: true,
      });
      expect(stale.results.map((r) => r.path)).not.toContain("a.md");

      // Add a second file alongside the edited one.
      writeFileSync(join(dir, "b.md"), "# B\n\nTextgammanewseparateaddition.\n");
      await sync.execute();
      const added = await search.execute({
        query: "textgammanewseparateaddition",
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
        query: "textgammanewseparateaddition",
        forceLexical: true,
      });
      expect(stillThere.results.map((r) => r.path)).toContain("b.md");
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- IndexDocuments — CP1252 encoding notices, end to end -----------------

describe("IndexDocuments — CP1252 documents are transcoded, indexed, and reported (Gates 1+2)", () => {
  it("indexes a CP1252 document cleanly: zero U+FFFD, exact code points, notice present, not skipped", async () => {
    const dir = mkdtempSync(join(tmpdir(), "compendio-cp1252-e2e-"));
    // Every character this change exists for: curly quotes, en dash,
    // ellipsis (all overridden CP1252 bytes) plus an accented vowel (the
    // identity-mapped 0xA0-0xFF range).
    const original =
      "# Titulo\n\n" +
      "“Cita” con guion – y puntos suspensivos… vocal acentuada: ó.\n";
    writeFileSync(join(dir, "cp1252.md"), cp1252Bytes(original));

    const store = new SqliteIndexStore(":memory:");
    const source = new FileDocumentSource(dir, []);
    const indexer = new IndexDocuments(
      source,
      new RemarkMarkdownParser(),
      store,
      null,
      createConventionPolicy(LOOSE),
      { chunking: { minTokens: 10, maxTokens: 800 }, noChunking: [] },
    );

    try {
      const report = await indexer.execute();

      expect(report.skipped).toEqual([]);
      expect(report.encodingNotices).toEqual([{ path: "cp1252.md", encoding: "windows-1252" }]);

      const doc = store.getDocumentByPath("cp1252.md");
      expect(doc).not.toBeNull();
      const chunks = store.getChunksByDocument(doc!.id);
      const allContent = chunks.map((c) => c.content).join("\n");
      expect(allContent).not.toContain("�");
      expect(allContent).toContain("“"); // left curly quote
      expect(allContent).toContain("”"); // right curly quote
      expect(allContent).toContain("–"); // en dash
      expect(allContent).toContain("…"); // ellipsis
      expect(allContent).toContain("ó"); // accented o
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves encodingNotices undefined for a UTF-8-only corpus (no warning noise on a healthy corpus)", async () => {
    const harness = buildHarness(new FakeEmbeddings());
    try {
      const report = await harness.index.execute();
      expect(report.encodingNotices).toBeUndefined();
    } finally {
      harness.close();
    }
  });
});

describe("SyncIndex — CP1252 encoding notices persist across passes, even with an unchanged hash", () => {
  it("reports the transcoded document on the indexing pass and again on a hash-match no-op pass", async () => {
    const dir = mkdtempSync(join(tmpdir(), "compendio-cp1252-sync-"));
    const original = "# Titulo\n\nTexto con “comillas” y guion – acentuado: ó.\n";
    writeFileSync(join(dir, "cp1252.md"), cp1252Bytes(original));

    const store = new SqliteIndexStore(":memory:");
    const source = new FileDocumentSource(dir, []);
    const sync = new SyncIndex(source, new RemarkMarkdownParser(), store, null, createConventionPolicy(LOOSE), {
      chunking: { minTokens: 10, maxTokens: 800 },
      noChunking: [],
    });

    try {
      const first = await sync.execute();
      expect(first.skipped).toEqual([]);
      expect(first.indexed.map((d) => d.path)).toContain("cp1252.md");
      expect(first.encodingNotices).toEqual([{ path: "cp1252.md", encoding: "windows-1252" }]);

      // Second pass: the file on disk is unchanged (same hash), so it takes
      // the hash-match no-op path -- but `discover()` still decodes and
      // reports it every pass, per design.md's "even when the transcode was
      // exact" requirement.
      const second = await sync.execute();
      expect(second.indexed).toEqual([]);
      expect(second.encodingNotices).toEqual([{ path: "cp1252.md", encoding: "windows-1252" }]);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// W2 (verify-report.md): the indexing spec's "Corrected Decoding Self-Heals
// via Incremental Sync" ADDED requirement had zero automated coverage. This
// seeds the index the way a pre-fix `compendio index` run would have left
// it -- content and hash both computed over the OLD UTF-8-only decoder's
// U+FFFD-corrupted output -- then proves the fix reaches that document
// through nothing but an ordinary incremental sync pass, with the on-disk
// bytes never touched.
describe("SyncIndex — self-heals a previously mis-decoded document via incremental sync", () => {
  it("re-indexes and cleans a document whose stored hash was computed over the old decoder's U+FFFD-corrupted content", async () => {
    const dir = mkdtempSync(join(tmpdir(), "compendio-selfheal-"));
    const original = "# Titulo\n\nTexto con “comillas” y guion – acentuado: ó.\n";
    const bytes = cp1252Bytes(original);
    writeFileSync(join(dir, "cp1252.md"), bytes);

    // What the pre-fix, UTF-8-only decoder produced from these exact bytes:
    // every byte outside the valid-UTF-8 grammar becomes U+FFFD. Sanity
    // check makes the simulated defect explicit rather than assumed.
    const corrupted = bytes.toString("utf8");
    expect(corrupted).toContain("�");

    const store = new SqliteIndexStore(":memory:");
    // Seed the index exactly as a pre-fix `compendio index` run would have
    // left it: stored content AND its hash both derive from the corrupted
    // string, not from the real CP1252 bytes still sitting on disk.
    store.saveDocument(
      { path: "cp1252.md", title: "Titulo", summary: "r", tags: [], hash: computeHash(corrupted) },
      [{ heading: "Titulo", content: corrupted, position: 0 }],
    );
    expect(store.getDocumentByPath("cp1252.md")).not.toBeNull();

    const source = new FileDocumentSource(dir, []);
    const sync = new SyncIndex(source, new RemarkMarkdownParser(), store, null, createConventionPolicy(LOOSE), {
      chunking: { minTokens: 10, maxTokens: 800 },
      noChunking: [],
    });

    try {
      const report = await sync.execute();

      // The bytes on disk never changed, but the fixed decoder's output
      // differs from the corrupted string that was hashed and stored, so
      // the fingerprint differs and the pass re-indexes it unassisted -- no
      // full `compendio index` required (the requirement under test).
      expect(report.indexed.map((d) => d.path)).toContain("cp1252.md");

      const doc = store.getDocumentByPath("cp1252.md")!;
      const chunks = store.getChunksByDocument(doc.id);
      const allContent = chunks.map((c) => c.content).join("\n");
      expect(allContent).not.toContain("�");
      expect(allContent).toContain("“"); // left curly quote
      expect(allContent).toContain("”"); // right curly quote
      expect(allContent).toContain("–"); // en dash
      expect(allContent).toContain("ó"); // accented o
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- Multi-root integration: two declared roots, through real createContainer wiring ---

describe("multi-root integration — two declared roots, index -> search -> read_doc round trip", () => {
  it("indexes both roots under their own alias prefix, searches across both, and round-trips a second-root path through read_doc", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "compendio-multiroot-"));
    try {
      await mkdir(join(projectDir, "alpha"), { recursive: true });
      await mkdir(join(projectDir, "beta"), { recursive: true });
      await writeFile(
        join(projectDir, "alpha", "one.md"),
        "# Alpha One\n\nContenido exclusivo de la raiz alpha: PALABRAALFA.\n",
        "utf8",
      );
      await writeFile(
        join(projectDir, "beta", "two.md"),
        "# Beta Two\n\nContenido exclusivo de la raiz beta: PALABRABETA.\n",
        "utf8",
      );
      await writeFile(
        join(projectDir, "compendio.config.json"),
        JSON.stringify({ docsDir: ["alpha", "beta"] }),
        "utf8",
      );

      const container = createContainer({ root: projectDir, forceLexical: true });
      try {
        const report = await container.indexDocuments.execute();
        expect(report.skipped).toEqual([]);
        expect(report.indexed.map((d) => d.path).sort()).toEqual(["alpha/one.md", "beta/two.md"]);

        const hit = await container.searchDocuments.execute({ query: "PALABRABETA" });
        expect(hit.results.map((r) => r.path)).toContain("beta/two.md");

        const read = container.readDocument.execute({ path: "beta/two.md" });
        expect(read.type).toBe("document");
        if (read.type !== "document") return;
        expect(read.content).toContain("PALABRABETA");
      } finally {
        container.close();
      }
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});
