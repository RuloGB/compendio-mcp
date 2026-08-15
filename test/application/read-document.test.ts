import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContainer } from "../../src/composition";
import { IndexDocuments } from "../../src/application/index-documents";
import { formatFrontmatter, ReadDocument } from "../../src/application/read-document";
import { createConventionPolicy, type ConventionConfig } from "../../src/domain/convention";
import type { DocumentMeta } from "../../src/domain/model";
import { DEFAULT_CONFIG, NO_CHUNKING } from "../../src/infrastructure/config";
import { FileDocumentSource } from "../../src/infrastructure/fs/file-document-source";
import { RemarkMarkdownParser } from "../../src/infrastructure/markdown/remark-markdown-parser";
import { SqliteIndexStore } from "../../src/infrastructure/sqlite/sqlite-index-store";
import { buildHarness, type TestHarness } from "../helpers/build";
import { FakeEmbeddings } from "../helpers/fake-embeddings";

// es-frozen: cites the real `ejemplos/` corpus name, not a leftover translation.
describe("ReadDocument over the ejemplos corpus", () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = buildHarness(new FakeEmbeddings());
    await harness.index.execute();
  });

  afterAll(() => {
    harness.close();
  });

  it("returns the full document with its H1 restored", () => {
    const result = harness.read.execute({ path: "docs/leadsviewer/validacion-formulario.md" });
    expect(result.type).toBe("document");
    if (result.type !== "document") return;
    expect(result.content.startsWith("# Validación del formulario de alta de leads")).toBe(true);
    expect(result.content).toContain("## Reglas de negocio");
    // Alias-aware `inferModule` (design.md Decision 7, tasks.md Phase 12):
    // the root's own alias ("docs") is stripped before folder inference, so
    // this resolves to the real containing folder, not the root alias.
    expect(result.meta.module).toBe("leadsviewer");
  });

  // es-frozen: "glosario.md"/"Glosario" are the real frozen `ejemplos/` corpus
  // filename and its real H1, not a leftover translation.
  it("does not duplicate the H1 of documents indexed as a single chunk", () => {
    const result = harness.read.execute({ path: "docs/glosario.md" });
    expect(result.type).toBe("document");
    if (result.type !== "document") return;
    expect(result.content.match(/^# Glosario/gm)).toHaveLength(1);
  });

  it("finds a section by partial, accent-insensitive heading", () => {
    const result = harness.read.execute({
      path: "docs/leadsviewer/validacion-formulario.md",
      section: "reglas de duplicidad",
    });
    expect(result.type).toBe("section");
    if (result.type !== "section") return;
    expect(result.content).toContain("Un lead se considera duplicado");
  });

  it("resolves a path that already carries its root's alias directly, as an exact hit", () => {
    // Before root-prefixing, indexed paths were docs-relative and a caller
    // holding the on-disk path ("docs/leadsviewer/x.md") needed the
    // one-leading-segment strip fallback below. Every indexed path now
    // already carries its root's alias, so this on-disk path IS the exact
    // indexed path (design.md Decision 12: "the motivating case becomes the
    // exact branch"). Genuine over-prefixing tolerance is Phase 15 (PR 4).
    const result = harness.read.execute({ path: "docs/leadsviewer/validacion-formulario.md" });
    expect(result.type).toBe("document");
    if (result.type !== "document") return;
    expect(result.meta.path).toBe("docs/leadsviewer/validacion-formulario.md");
  });

  it("tolerates one genuinely over-prefixed leading segment on the path", () => {
    // A caller holding a project-relative path one level deeper than the
    // indexed one ("repo/docs/leadsviewer/x.md") still resolves: the literal
    // match misses, and the one-leading-segment strip fallback recovers it.
    const result = harness.read.execute({ path: "repo/docs/leadsviewer/validacion-formulario.md" });
    expect(result.type).toBe("document");
    if (result.type !== "document") return;
    expect(result.meta.path).toBe("docs/leadsviewer/validacion-formulario.md");
  });

  it("prefers a real document over stripping a segment off the request", () => {
    // Stripping must never shadow an exact hit: only a miss triggers the retry.
    const result = harness.read.execute({ path: "docs/leadsviewer/validacion-formulario.md" });
    expect(result.type).toBe("document");
    if (result.type !== "document") return;
    expect(result.meta.path).toBe("docs/leadsviewer/validacion-formulario.md");
  });

  it("still reports a genuinely unknown path after the prefix retry", () => {
    const result = harness.read.execute({ path: "docs/no/existe.md" });
    expect(result.type).toBe("path-not-found");
  });

  it("suggests the 3 closest paths when the path does not exist", () => {
    const result = harness.read.execute({ path: "leadsviewer/validacion-formulari.md" });
    expect(result.type).toBe("path-not-found");
    if (result.type !== "path-not-found") return;
    expect(result.suggestions).toHaveLength(3);
    expect(result.suggestions[0]).toBe("docs/leadsviewer/validacion-formulario.md");
  });

  it("lists available sections when the requested one does not exist", () => {
    const result = harness.read.execute({
      path: "docs/leadsviewer/validacion-formulario.md",
      section: "made-up section",
    });
    expect(result.type).toBe("section-not-found");
    if (result.type !== "section-not-found") return;
    expect(result.availableSections.length).toBeGreaterThan(0);
  });
});

// design.md Decision 12 / tasks.md Phase 15: `ReadDocument.resolve` needs no
// edit here — its exact-then-strip-fallback order already covers both cases
// below by construction (`read-document.ts:44-50`, unchanged by this PR, see
// 15.2). These two tests pin what the design predicted rather than change
// anything: the aliased-collision residual case (a miss whose stripped form
// happens to name a real document under a different root) and the
// bare-basename miss (a single-segment request the strip cannot reduce any
// further). The other two cases Phase 15 lists — exact prefixed-path hit and
// genuine over-prefixed hit — are already covered above ("resolves a path
// that already carries its root's alias directly" / "tolerates one genuinely
// over-prefixed leading segment").
describe("ReadDocument — the one-leading-segment tolerance's edge cases under multiple declared roots (design.md Decision 12)", () => {
  let bareBasenameHarness: TestHarness;

  beforeAll(async () => {
    bareBasenameHarness = buildHarness(new FakeEmbeddings());
    await bareBasenameHarness.index.execute();
  });

  afterAll(() => {
    bareBasenameHarness.close();
  });

  it("a miss whose stripped form names another root's document resolves to that document, never as a false negative", async () => {
    // docsDir: ["docs", "adr"] — "docs" has no adr/ subfolder at all, so no
    // document is ever indexed as "docs/adr/x.md". The literal request
    // therefore misses, the one-segment strip yields "adr/x.md", and that
    // IS a real document — the mechanism cannot distinguish this from the
    // over-prefixed case it exists to serve (mcp-contract delta, documented
    // non-guarantee).
    const projectDir = mkdtempSync(join(tmpdir(), "compendio-read-collision-"));
    try {
      mkdirSync(join(projectDir, "docs"));
      mkdirSync(join(projectDir, "adr"));
      writeFileSync(join(projectDir, "docs", "unrelated.md"), "# Unrelated\n\nNothing to do with adr.\n");
      writeFileSync(join(projectDir, "adr", "x.md"), "# ADR X\n\nThe real top-of-root document.\n");
      writeFileSync(
        join(projectDir, "compendio.config.json"),
        JSON.stringify({ docsDir: ["docs", "adr"] }),
        "utf8",
      );

      const container = createContainer({ root: projectDir, forceLexical: true });
      try {
        const report = await container.indexDocuments.execute();
        expect(report.indexed.map((d) => d.path).sort()).toEqual(["adr/x.md", "docs/unrelated.md"]);

        const result = container.readDocument.execute({ path: "docs/adr/x.md" });
        expect(result.type).toBe("document");
        if (result.type !== "document") return;
        expect(result.meta.path).toBe("adr/x.md");
        expect(result.content).toContain("The real top-of-root document.");
      } finally {
        container.close();
      }
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("a bare basename does not recover a root prefix — the tolerance never adds a segment", () => {
    // The tolerance only ever strips; it cannot turn "x.md" into "docs/x.md".
    // A single-segment path has no "/" to strip in the first place
    // (`separator === -1` at read-document.ts:47-48), so the literal miss
    // falls straight through to path-not-found with the closest matches.
    const result = bareBasenameHarness.read.execute({ path: "glosario.md" });
    expect(result.type).toBe("path-not-found");
    if (result.type !== "path-not-found") return;
    expect(result.suggestions).toHaveLength(3);
    expect(result.suggestions).toContain("docs/glosario.md");
  });
});

// --- A section that splitToBound divides into several chunks must still ---
// --- read back whole and in order (design.md Decision 3, "load-bearing"). --
//
// No section in ejemplos/ is large enough to exceed the new 480-token bound
// on its own (measured: the corpus's chunk-count increase at 480 comes
// entirely from mergeTinyPieces' narrower headroom, not from any single
// section being split -- see apply-progress.md Phase 8). This exercises the
// real production default end to end through the full IndexDocuments ->
// SqliteIndexStore -> ReadDocument pipeline against a synthetic document
// sized to actually trigger a split, which the ejemplos corpus cannot.

const LOOSE: ConventionConfig = {
  mode: "loose",
  excludedStatuses: [],
  frontmatterFields: { type: "type", module: "module", status: "status" },
};

describe("ReadDocument — a section split by the size bound reads back whole and in order", () => {
  it("reassembles a section that splitToBound divided into multiple same-heading chunks, in position order", async () => {
    const dir = mkdtempSync(join(tmpdir(), "compendio-read-split-"));
    try {
      const sentences = Array.from(
        { length: 120 },
        (_, i) => `Oración número ${i} con contenido suficiente para acumular tokens de forma constante.`,
      ).join(" ");
      writeFileSync(join(dir, "grande.md"), `# Documento grande\n\n## Sección extensa\n\n${sentences}\n`);

      const store = new SqliteIndexStore(":memory:");
      const indexer = new IndexDocuments(
        new FileDocumentSource(dir, []),
        new RemarkMarkdownParser(),
        store,
        null,
        createConventionPolicy(LOOSE),
        { chunking: DEFAULT_CONFIG.chunk, noChunking: NO_CHUNKING },
      );
      const read = new ReadDocument(store);

      try {
        const report = await indexer.execute();
        expect(report.skipped).toEqual([]);

        const doc = store.getDocumentByPath("grande.md");
        expect(doc).not.toBeNull();
        if (doc === null) return;
        const rawChunks = store
          .getChunksByDocument(doc.id)
          .filter((c) => c.heading === "Sección extensa");
        // The section alone is well over 480 tokens -- it must have been
        // divided into more than one chunk, all sharing the same heading.
        expect(rawChunks.length).toBeGreaterThan(1);

        const result = read.execute({ path: "grande.md", section: "sección extensa" });
        expect(result.type).toBe("section");
        if (result.type !== "section") return;
        // Whole: both the first and last sentence survive the split.
        expect(result.content).toContain("Oración número 0 ");
        expect(result.content).toContain("Oración número 119 ");
        // In order: sentence 0 precedes sentence 119 in the reassembled text.
        expect(result.content.indexOf("Oración número 0 ")).toBeLessThan(
          result.content.indexOf("Oración número 119 "),
        );
      } finally {
        store.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- The "no-sections" ReadResult variant (design.md Decision 4) ----------
//
// Reachable without any pipeline trickery: a corpus indexed by a pre-fix
// build (heading: "" persisted, content-hash fingerprint unchanged) stays in
// that state until a full `compendio index` runs (Gate 6). Seeded directly
// against SqliteIndexStore(":memory:") -- exactly that stale-corpus state.

describe("ReadDocument — the 'no-sections' variant (Decision 4, the stale-corpus read path)", () => {
  it("[RED->GREEN] returns 'no-sections' when every stored chunk has an empty heading and no content-embedded heading either", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      const meta: DocumentMeta = { path: "stale.md", title: "Stale", summary: "s", tags: [], hash: "h" };
      store.saveDocument(meta, [
        { heading: "", content: "plain body, no markdown headings inside", position: 0 },
      ]);
      const read = new ReadDocument(store);

      const result = read.execute({ path: "stale.md", section: "anything" });

      expect(result.type).toBe("no-sections");
      if (result.type !== "no-sections") return;
      expect(result.meta.path).toBe("stale.md");
      expect(result.section).toBe("anything");
    } finally {
      store.close();
    }
  });

  it("[RED->GREEN] section-not-found's availableSections never contains an empty member, even when some stored chunks have an empty heading and others do not", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      const meta: DocumentMeta = { path: "mixed.md", title: "Mixed", summary: "s", tags: [], hash: "h" };
      store.saveDocument(meta, [
        { heading: "", content: "plain body", position: 0 },
        { heading: "Real section", content: "## Real section\n\nbody", position: 1 },
      ]);
      const read = new ReadDocument(store);

      const result = read.execute({ path: "mixed.md", section: "made-up section" });

      expect(result.type).toBe("section-not-found");
      if (result.type !== "section-not-found") return;
      expect(result.availableSections).not.toContain("");
      expect(result.availableSections).toEqual(["Real section"]);
    } finally {
      store.close();
    }
  });
});

describe("formatFrontmatter — conditional rendering of absent fields", () => {
  function baseMeta(overrides: Partial<DocumentMeta> = {}): DocumentMeta {
    return { path: "a.md", title: "A", summary: "r", tags: [], hash: "h", ...overrides };
  }

  it("renders all three lines when type/module/status are present", () => {
    const output = formatFrontmatter(baseMeta({ type: "guia", module: "auth", status: "vigente" }));
    expect(output).toContain("type: guia");
    expect(output).toContain("module: auth");
    expect(output).toContain("status: vigente");
  });

  it("omits only the module line when module is absent", () => {
    const output = formatFrontmatter(baseMeta({ type: "guia", status: "vigente" }));
    expect(output).toContain("type: guia");
    expect(output).not.toContain("module:");
    expect(output).toContain("status: vigente");
  });

  it("omits type and status when only module is present", () => {
    const output = formatFrontmatter(baseMeta({ module: "auth" }));
    expect(output).not.toContain("type:");
    expect(output).toContain("module: auth");
    expect(output).not.toContain("status:");
  });

  it("omits all three lines when none of type/module/status are present", () => {
    const output = formatFrontmatter(baseMeta());
    expect(output).not.toContain("type:");
    expect(output).not.toContain("module:");
    expect(output).not.toContain("status:");
  });
});
