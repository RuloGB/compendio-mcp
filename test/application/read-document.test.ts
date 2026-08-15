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

// --- headingsIn's fence-aware rewrite (design.md Decision 3/4, Phase 3) ---
//
// Every case here targets the second `||` branch of the match filter and the
// listing fallback (`read-document.ts:76-80`, `:86-92`) — the only branch
// this change touches. Task-level expectations, recorded precisely so a
// green run is not mistaken for a red one:
//   - 3.1, 3.2: guard cases against over-pruning (Gate 2a/2b). Already pass
//     on today's unfixed tree (it has no fence logic to break them at all) —
//     written anyway so the REWRITE cannot regress them.
//   - 3.3: fails on today's unfixed tree (a phantom fenced heading currently
//     resolves) — the requirement's core scenario (Gate 2d).
//   - 3.4: THE LOAD-BEARING CASE (Gate 2c). Green today AND green after
//     Decision 3's guarded fix — the ONLY case in this change that would go
//     red against the naive, unguarded `inFence` toggle the proposal
//     originally specified. Never cut, never weaken, never shrink.
//   - 3.5: fails on today's unfixed tree (nothing is suppressed yet) and
//     passes once 3.6 lands — but the assertion it passes with is that the
//     heading is SUPPRESSED, a documented, ACCEPTED limitation (the
//     parity-hole resolution, tasks.md), not a defect this PR closes.

describe("ReadDocument — headingsIn's fence-aware rewrite (design.md Decision 3/4)", () => {
  it("[3.1 / Gate 2a] resolves a real H4-H6 heading that exists only inside chunk content, outside any fence", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      const meta: DocumentMeta = { path: "deep.md", title: "Deep", summary: "s", tags: [], hash: "h" };
      store.saveDocument(meta, [
        {
          heading: "Parent section",
          content: "## Parent section\n\nSome intro text.\n\n#### Deep subheading\n\nDetail body.",
          position: 0,
        },
      ]);
      const read = new ReadDocument(store);

      const result = read.execute({ path: "deep.md", section: "deep subheading" });

      expect(result.type).toBe("section");
      if (result.type !== "section") return;
      expect(result.content).toContain("Detail body.");
    } finally {
      store.close();
    }
  });

  it("[found during apply, not in tasks.md — a genuine regression, not the documented parity hole] a real heading found only inside chunk content still resolves on CRLF-encoded documents", () => {
    // Discovered while running Gate 1 against this repository's own
    // CRLF-encoded docs/documentation-convention.md: split("\n") leaves a
    // trailing "\r" on every line, and without the "/m" flag (now applied
    // per-line rather than via matchAll(/…/gm) on the whole string) "$"
    // asserts the literal end of the line string. "." never matches "\r", so
    // "(.+)$" (design.md's literal specified pattern) fails to match ANY
    // heading line on a CRLF document -- not only fenced ones. This is
    // unrelated to fences: it silently broke the second `||` branch for
    // every CRLF document, contradicting design.md's own claim that CRLF
    // behaviour would be unchanged (measured, not assumed -- that claim did
    // not hold). HEADING_LINE gained an explicit `\r?` before `$` to fix it.
    const store = new SqliteIndexStore(":memory:");
    try {
      const meta: DocumentMeta = { path: "crlf.md", title: "CRLF", summary: "s", tags: [], hash: "h" };
      store.saveDocument(meta, [
        {
          heading: "Parent section",
          content: "## Parent section\r\n\r\nIntro text.\r\n\r\n#### Deep subheading\r\n\r\nDetail body.",
          position: 0,
        },
      ]);
      const read = new ReadDocument(store);

      const result = read.execute({ path: "crlf.md", section: "deep subheading" });

      expect(result.type).toBe("section");
      if (result.type !== "section") return;
      expect(result.content).toContain("Detail body.");
    } finally {
      store.close();
    }
  });

  it("[3.2 / Gate 2b] resolves a tiny section that survives only merged inside a bigger chunk by mergeTinyPieces", async () => {
    const dir = mkdtempSync(join(tmpdir(), "compendio-read-merge-"));
    try {
      const bigSection = "Contenido amplio de la seccion principal repetido varias veces. ".repeat(10);
      writeFileSync(
        join(dir, "merge.md"),
        `# Documento con fusion\n\n## Big section\n\n${bigSection}\n\n## Tiny section\n\nUn detalle breve.\n`,
      );

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

        const doc = store.getDocumentByPath("merge.md");
        expect(doc).not.toBeNull();
        if (doc === null) return;
        const chunks = store.getChunksByDocument(doc.id);
        // Confirm the tiny section was actually merged into a bigger chunk,
        // not kept as its own -- otherwise this case would not exercise the
        // second `||` branch at all.
        expect(chunks.some((c) => c.heading === "Tiny section")).toBe(false);
        expect(chunks.some((c) => c.content.includes("## Tiny section"))).toBe(true);

        const result = read.execute({ path: "merge.md", section: "tiny section" });
        expect(result.type).toBe("section");
        if (result.type !== "section") return;
        expect(result.content).toContain("Un detalle breve.");
      } finally {
        store.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("[3.3 / Gate 2d] a phantom heading inside a balanced backtick fence is not resolvable or listed; a real heading after it still is", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      const meta: DocumentMeta = { path: "fenced.md", title: "Fenced", summary: "s", tags: [], hash: "h" };
      store.saveDocument(meta, [
        {
          heading: "Section",
          content: "```\n## Phantom\n```\n\n## Real\n\nReal content here.",
          position: 0,
        },
      ]);
      const read = new ReadDocument(store);

      const phantomResult = read.execute({ path: "fenced.md", section: "phantom" });
      expect(phantomResult.type).toBe("section-not-found");
      if (phantomResult.type === "section-not-found") {
        expect(phantomResult.availableSections).not.toContain("Phantom");
      }

      const realResult = read.execute({ path: "fenced.md", section: "real" });
      expect(realResult.type).toBe("section");
      if (realResult.type !== "section") return;
      expect(realResult.content).toContain("Real content here.");
    } finally {
      store.close();
    }
  });

  it("[3.3 sibling] both fence marker styles suppress the phantom heading: a tilde fence behaves identically to backticks", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      const meta: DocumentMeta = { path: "tilde.md", title: "Tilde", summary: "s", tags: [], hash: "h" };
      store.saveDocument(meta, [
        {
          heading: "Section",
          content: "~~~\n## Phantom\n~~~\n\n## Real\n\nReal content here.",
          position: 0,
        },
      ]);
      const read = new ReadDocument(store);

      const phantomResult = read.execute({ path: "tilde.md", section: "phantom" });
      expect(phantomResult.type).toBe("section-not-found");

      const realResult = read.execute({ path: "tilde.md", section: "real" });
      expect(realResult.type).toBe("section");
    } finally {
      store.close();
    }
  });

  it("[3.4 / Gate 2c — THE LOAD-BEARING CASE, never cut, never weaken] a lone unbalanced fence delimiter must not suppress a real heading after it", () => {
    // Exactly ONE delimiter line (odd, unbalanced): a chunk that begins
    // mid-fence, as if a fence opened in a preceding chunk and this chunk
    // only carries its closer. This is green on today's unfixed tree AND
    // green after Decision 3's guarded fix -- it is the ONLY case in this
    // change that would go red against the naive, unguarded `inFence` toggle
    // the proposal originally specified: that toggle would set `inFence =
    // true` at the lone closer and suppress everything after it in the
    // chunk, including "Real". This case exists to prove the balanced-
    // delimiter guard is present, not to prove the fix "works" in general.
    // Do not shrink this fixture or substitute an assertion that would also
    // pass under the naive toggle.
    const store = new SqliteIndexStore(":memory:");
    try {
      const meta: DocumentMeta = { path: "midfence.md", title: "Midfence", summary: "s", tags: [], hash: "h" };
      store.saveDocument(meta, [
        {
          heading: "Section",
          content: "const x = 1;\n```\nprose\n\n#### Real\n\nReal body content.",
          position: 0,
        },
      ]);
      const read = new ReadDocument(store);

      const result = read.execute({ path: "midfence.md", section: "real" });
      expect(result.type).toBe("section");
      if (result.type !== "section") return;
      expect(result.content).toContain("Real body content.");

      const notFound = read.execute({ path: "midfence.md", section: "made-up section" });
      expect(notFound.type).toBe("section-not-found");
      if (notFound.type !== "section-not-found") return;
      expect(notFound.availableSections).toContain("Real");
    } finally {
      store.close();
    }
  });

  it("[3.5 — pins KNOWN-WRONG, documented, accepted behaviour; do not silently delete] the misaligned-even parity hole suppresses a real heading between a stray closer and a stray opener", () => {
    // This is a DOCUMENTED, ACCEPTED limitation (design.md Decision 4's
    // orchestrator note, resolved in tasks.md's "Resolution of the
    // parity-hole open decision" section) -- NOT a defect this PR closes. The
    // balanced-delimiter guard is `count(isFenceDelimiter) % 2 === 0`, which
    // cannot distinguish one complete, self-contained fence from one stray
    // closer (continuing a fence opened in an earlier chunk) followed by one
    // stray opener (starting a fence that continues into a later chunk) --
    // both read as "balanced" (2 delimiters). This fixture is exactly that
    // shape: chunk-locally indistinguishable from a genuine self-contained
    // fence, so the guard suppresses a heading that a document-wide view
    // would have kept addressable. This test PINS that behaviour so a future
    // change cannot silently regress it further, or "fix" it, without a
    // deliberate decision. If this fixture does NOT reproduce suppression,
    // that is a STOP condition -- the reachability reasoning behind accepting
    // the hole must be re-opened and reported, not silently dropped here.
    const store = new SqliteIndexStore(":memory:");
    try {
      const meta: DocumentMeta = { path: "parityhole.md", title: "Parity hole", summary: "s", tags: [], hash: "h" };
      store.saveDocument(meta, [
        {
          heading: "Section",
          content:
            "```\nReal prose leading into a heading\n#### Real subheading between stray delimiters\n\nbody\n```",
          position: 0,
        },
      ]);
      const read = new ReadDocument(store);

      const result = read.execute({ path: "parityhole.md", section: "real subheading between stray delimiters" });
      expect(result.type).toBe("section-not-found");
      if (result.type !== "section-not-found") return;
      expect(result.availableSections).not.toContain("Real subheading between stray delimiters");
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
