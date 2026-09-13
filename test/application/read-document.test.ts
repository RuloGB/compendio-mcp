import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContainer } from "../../src/composition";
import { IndexDocuments } from "../../src/application/index-documents";
import {
  formatFrontmatter,
  formatOutlineRow,
  MAX_GATE_CANDIDATES,
  OUTLINE_ROWS_BUDGET_CHARS,
  OUTLINE_THRESHOLD_TOKENS,
  ReadDocument,
  type OutlineOmission,
  type OutlineSection,
} from "../../src/application/read-document";
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

// --- `read_doc` outline for large documents (proposal.md, design.md D1-D9) -
//
// All unit-level cases below seed `SqliteIndexStore(":memory:")` directly
// (same pattern as the "no-sections" describe above), so chunk boundaries and
// heading placement are fully controlled rather than depending on the real
// chunker. Integration-level cases (split section, merged tiny section, the
// spec-delta-shaped fixture, and the `ejemplos/` corpus bound) drive the real
// `IndexDocuments` pipeline further below.

/** Builds a chunk whose stored `content` has exactly `totalLen` characters,
 * so `estimateTokens` (chars/4, rounded up) is fully controllable for the
 * outline threshold boundary test. `prefix` is real markdown (heading lines,
 * etc.); the remainder is inert filler that never itself looks like a
 * heading or fence delimiter. */
function padTo(prefix: string, totalLen: number): string {
  const fillerLen = totalLen - prefix.length;
  if (fillerLen < 0) {
    throw new Error(`prefix (${prefix.length} chars) already exceeds totalLen (${totalLen})`);
  }
  return prefix + "x".repeat(fillerLen);
}

/** Prose of ~32,000 chars (~8,000 estimated tokens), enough on its own to push
 * a real-chunker fixture past the 6,000-token outline threshold. */
function outlinePadding(): string {
  return Array.from(
    { length: 400 },
    (_, i) => `Frase de relleno ${i} con contenido suficiente para acumular tokens de forma constante.`,
  ).join(" ");
}

function seedDoc(store: SqliteIndexStore, path: string, title: string, chunks: { heading: string; content: string }[]) {
  const meta: DocumentMeta = { path, title, summary: "s", tags: [], hash: "h" };
  store.saveDocument(
    meta,
    chunks.map((c, i) => ({ heading: c.heading, content: c.content, position: i })),
  );
}

describe("ReadDocument — outline for large documents: boundary (design.md D5)", () => {
  it("estimateTokens(content) === 6000 stays 'document', 6001 becomes 'outline' (2+ addressable headings)", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      // chunk0: "# T\n\n## A\n\n" (11 chars) + filler; chunk1: "## B\n\n" (6
      // chars) + filler; joined with one "\n\n" separator (2 chars):
      // total = 11 + x + 2 + 6 + y = 19 + x + y.
      const atThreshold = (x: number, y: number) => [
        { heading: "", content: padTo("# T\n\n## A\n\n", 11 + x) },
        { heading: "B", content: padTo("## B\n\n", 6 + y) },
      ];
      // 19 + x + y === 24000 (=> estimateTokens === 6000)
      seedDoc(store, "at.md", "T", atThreshold(20000, 3981));
      const read = new ReadDocument(store);
      const atResult = read.execute({ path: "at.md" });
      expect(atResult.type).toBe("document");

      // 19 + x + y === 24001 (=> estimateTokens === 6001)
      seedDoc(store, "over.md", "T", atThreshold(20000, 3982));
      const overResult = read.execute({ path: "over.md" });
      expect(overResult.type).toBe("outline");
    } finally {
      store.close();
    }
  });
});

describe("ReadDocument — outline row shape (design.md D1)", () => {
  it("lists H2 headings in position order with H3 nested, an orphan H3 top-level, and H4 absent", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      seedDoc(store, "shape.md", "T", [
        { heading: "", content: padTo("# T\n\n### Orphan\n\nintro body.\n\n", 500) },
        {
          heading: "First",
          content: padTo("## First\n\n### Child\n\n#### Deep\n\nsome body content.\n\n", 12000),
        },
        { heading: "Second", content: padTo("## Second\n\nmore body content.\n\n", 12000) },
      ]);
      const read = new ReadDocument(store);
      const result = read.execute({ path: "shape.md" });
      expect(result.type).toBe("outline");
      if (result.type !== "outline") return;

      expect(result.sections.map((s) => s.heading)).toEqual(["Orphan", "First", "Second"]);
      expect(result.sections[0]!.children).toEqual([]);
      expect(result.sections[1]!.children.map((c) => c.heading)).toEqual(["Child"]);
      // H4 ("Deep") is never listed, at any level.
      const allTitles = result.sections.flatMap((s) => [s.heading, ...s.children.map((c) => c.heading)]);
      expect(allTitles).not.toContain("Deep");
    } finally {
      store.close();
    }
  });

  it("excludes a heading inside a balanced fence from the outline, and carries no '\\r' on CRLF titles", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      seedDoc(store, "fence.md", "T", [
        { heading: "", content: padTo("# T\r\n\r\n", 300) },
        {
          heading: "Alpha",
          content: padTo(
            "## Alpha\r\n\r\n```\r\n## Phantom\r\n```\r\n\r\nbody.\r\n\r\n",
            12000,
          ),
        },
        { heading: "Beta", content: padTo("## Beta\r\n\r\nbody.\r\n\r\n", 12000) },
      ]);
      const read = new ReadDocument(store);
      const result = read.execute({ path: "fence.md" });
      expect(result.type).toBe("outline");
      if (result.type !== "outline") return;

      const titles = result.sections.map((s) => s.heading);
      expect(titles).toEqual(["Alpha", "Beta"]);
      expect(titles).not.toContain("Phantom");
      for (const title of titles) expect(title).not.toContain("\r");
    } finally {
      store.close();
    }
  });
});

describe("ReadDocument — outline row size, D2: exactly what `section` returns", () => {
  it("a row's tokens equal estimateTokens of its own `section` response, including a substring pair ('Scope'/'Out of Scope')", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      seedDoc(store, "scope.md", "T", [
        { heading: "", content: padTo("# T\n\n", 300) },
        { heading: "Scope", content: padTo("## Scope\n\nin-scope body.\n\n", 12000) },
        { heading: "Out of Scope", content: padTo("## Out of Scope\n\nexcluded body.\n\n", 12000) },
        { heading: "Other", content: padTo("## Other\n\nmore.\n\n", 12000) },
      ]);
      const read = new ReadDocument(store);
      const result = read.execute({ path: "scope.md" });
      expect(result.type).toBe("outline");
      if (result.type !== "outline") return;

      const scopeRow = result.sections.find((s) => s.heading === "Scope")!;
      const scopeSection = read.execute({ path: "scope.md", section: "Scope" });
      expect(scopeSection.type).toBe("section");
      if (scopeSection.type !== "section") return;
      expect(scopeRow.tokens).toBe(Math.ceil(scopeSection.content.length / 4));
      // "Scope" substring-matches "Out of Scope" too, so its response (and
      // therefore its size) covers both chunks -- not just its own text span.
      expect(scopeSection.content).toContain("excluded body.");
    } finally {
      store.close();
    }
  });
});

describe("ReadDocument — outline addressable-gate fallbacks to 'document' (design.md D4)", () => {
  function bigSingleChunkDoc(store: SqliteIndexStore, path: string, body: string) {
    seedDoc(store, path, "T", [{ heading: "", content: body }]);
  }

  it("a heading-less large document returns in full", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      bigSingleChunkDoc(store, "headingless.md", padTo("# T\n\n", 25000));
      const result = new ReadDocument(store).execute({ path: "headingless.md" });
      expect(result.type).toBe("document");
    } finally {
      store.close();
    }
  });

  it("a large document with a single H2 (no other addressable heading) returns in full", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      bigSingleChunkDoc(store, "singleh2.md", padTo("# T\n\n## Only\n\n", 25000));
      const result = new ReadDocument(store).execute({ path: "singleh2.md" });
      expect(result.type).toBe("document");
    } finally {
      store.close();
    }
  });

  it("a large NO_CHUNKING-shaped single chunk with many H2 lines returns in full (glosario.md-shaped)", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      bigSingleChunkDoc(
        store,
        "glosario.md",
        padTo("# T\n\n## Term A\n\ndef.\n\n## Term B\n\ndef.\n\n## Term C\n\ndef.\n\n", 25000),
      );
      const result = new ReadDocument(store).execute({ path: "glosario.md" });
      // Every heading request returns the whole (single) chunk: 0 addressable.
      expect(result.type).toBe("document");
    } finally {
      store.close();
    }
  });

  it("one H2 plus ten H4s returns in full (H4 is never addressable, at most 1 candidate)", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      const h4s = Array.from({ length: 10 }, (_, i) => `#### Detail ${i}\n\nbody.\n\n`).join("");
      bigSingleChunkDoc(store, "manyh4.md", padTo(`# T\n\n## Only\n\n${h4s}`, 25000));
      const result = new ReadDocument(store).execute({ path: "manyh4.md" });
      expect(result.type).toBe("document");
    } finally {
      store.close();
    }
  });

  it("a single wrapping H2 with exactly one H3 child, stored as one chunk, returns in full", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      bigSingleChunkDoc(store, "wrapper.md", padTo("## Wrapper\n\n### Only child\n\n", 25000));
      const result = new ReadDocument(store).execute({ path: "wrapper.md" });
      // The H2 is not addressable (its `section` response is the whole
      // document); the H3 is addressable -- 1 addressable heading, below the
      // >=2 gate.
      expect(result.type).toBe("document");
    } finally {
      store.close();
    }
  });
});

describe("ReadDocument — R1 occurrence table and row classification (design.md R1)", () => {
  it("[4.1] an H2 and an H3 sharing the same normalized title become one top-level row", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      seedDoc(store, "sametitle.md", "T", [
        { heading: "", content: padTo("# T\n\n### Notes\n\nintro notes.\n\n", 300) },
        { heading: "Notes", content: padTo("## Notes\n\nmore notes.\n\n", 12000) },
        { heading: "Other", content: padTo("## Other\n\nbody.\n\n", 12000) },
      ]);
      const result = new ReadDocument(store).execute({ path: "sametitle.md" });
      expect(result.type).toBe("outline");
      if (result.type !== "outline") return;

      expect(result.sections.filter((s) => s.heading === "Notes")).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("[4.1] no two rows share a normalized title across an H2, a same-titled orphan H3, and a same-titled nested H3 under a different parent", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      seedDoc(store, "onenorm.md", "T", [
        { heading: "", content: padTo("# T\n\n### Dup\n\norphan.\n\n", 300) },
        { heading: "Dup", content: padTo("## Dup\n\ntop.\n\n", 6000) },
        { heading: "Parent", content: padTo("## Parent\n\n### Dup\n\nchild.\n\n", 6000) },
        // "Other" is unrelated to "Dup" and matches only its own chunk, so the
        // >=2-addressable gate passes independent of whether "Dup" itself
        // happens to be addressable (it substring-matches every other chunk
        // here, since its own text is embedded in all three).
        { heading: "Other", content: padTo("## Other\n\nbody.\n\n", 12000) },
      ]);
      const result = new ReadDocument(store).execute({ path: "onenorm.md" });
      expect(result.type).toBe("outline");
      if (result.type !== "outline") return;

      function flatten(sections: OutlineSection[]): OutlineSection[] {
        return sections.flatMap((s) => [s, ...flatten(s.children)]);
      }
      const norms = [...flatten(result.sections), ...result.repeated].map((s) => s.heading.toLowerCase());
      expect(new Set(norms).size).toBe(norms.length);
    } finally {
      store.close();
    }
  });

  it("[4.2] the same H3 title occurring under 2+ different H2 parents, with no top-level occurrence, becomes one `repeated` entry apart from every parent's children", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      seedDoc(store, "repeatedgroup.md", "T", [
        { heading: "", content: padTo("# T\n\n", 300) },
        { heading: "Parent A", content: padTo("## Parent A\n\n### Shared\n\na.\n\n", 12000) },
        { heading: "Parent B", content: padTo("## Parent B\n\n### Shared\n\nb.\n\n", 12000) },
        { heading: "Parent C", content: padTo("## Parent C\n\n### Shared\n\nc.\n\n", 12000) },
      ]);
      const result = new ReadDocument(store).execute({ path: "repeatedgroup.md" });
      expect(result.type).toBe("outline");
      if (result.type !== "outline") return;

      expect(result.repeated.map((r) => r.heading)).toEqual(["Shared"]);
      expect(result.repeated[0]!.occurrences).toBe(3);
      for (const parent of result.sections) {
        expect(parent.children.map((c) => c.heading)).not.toContain("Shared");
      }
    } finally {
      store.close();
    }
  });

  it("[4.3] a title with an early child occurrence and a single later top-level occurrence is one top-level row, positioned at the later occurrence", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      seedDoc(store, "promoted.md", "T", [
        { heading: "", content: padTo("# T\n\n", 300) },
        { heading: "Parent", content: padTo("## Parent\n\n### Shared\n\nchild body.\n\n", 12000) },
        { heading: "Between", content: padTo("## Between\n\nbody.\n\n", 300) },
        { heading: "Shared", content: padTo("## Shared\n\ntop body.\n\n", 12000) },
      ]);
      const result = new ReadDocument(store).execute({ path: "promoted.md" });
      expect(result.type).toBe("outline");
      if (result.type !== "outline") return;

      expect(result.sections.map((s) => s.heading)).toEqual(["Parent", "Between", "Shared"]);
      const parent = result.sections.find((s) => s.heading === "Parent")!;
      expect(parent.children.map((c) => c.heading)).not.toContain("Shared");
      const shared = result.sections.find((s) => s.heading === "Shared")!;
      expect(shared.occurrences).toBe(2);
      expect(result.repeated).toEqual([]);
    } finally {
      store.close();
    }
  });

  it("[4.4] a title that is both an H3 under 2+ different H2 parents AND an H2 itself is classified top-level, excluded from the repeated group", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      seedDoc(store, "precedence.md", "T", [
        { heading: "", content: padTo("# T\n\n", 300) },
        { heading: "P1", content: padTo("## P1\n\n### Notes\n\na.\n\n", 12000) },
        { heading: "P2", content: padTo("## P2\n\n### Notes\n\nb.\n\n", 12000) },
        { heading: "Notes", content: padTo("## Notes\n\ntop body.\n\n", 12000) },
      ]);
      const result = new ReadDocument(store).execute({ path: "precedence.md" });
      expect(result.type).toBe("outline");
      if (result.type !== "outline") return;

      expect(result.sections.map((s) => s.heading)).toEqual(["P1", "P2", "Notes"]);
      expect(result.repeated).toEqual([]);
      const notes = result.sections.find((s) => s.heading === "Notes")!;
      expect(notes.occurrences).toBe(3);
    } finally {
      store.close();
    }
  });

  it("[4.5] two identically-titled H2 rows collapse into one at the first position, with pooled/deduplicated children and an occurrence count", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      seedDoc(store, "dup.md", "T", [
        { heading: "", content: padTo("# T\n\n", 300) },
        { heading: "Repeated", content: padTo("## Repeated\n\n### Child A\n\nbody.\n\n", 12000) },
        { heading: "Repeated", content: padTo("## Repeated\n\n### Child B\n\nbody.\n\n", 12000) },
      ]);
      const result = new ReadDocument(store).execute({ path: "dup.md" });
      expect(result.type).toBe("outline");
      if (result.type !== "outline") return;

      const repeatedRows = result.sections.filter((s) => s.heading === "Repeated");
      expect(repeatedRows).toHaveLength(1);
      expect(repeatedRows[0]!.occurrences).toBe(2);
      expect(repeatedRows[0]!.children.map((c) => c.heading).sort()).toEqual(["Child A", "Child B"]);
    } finally {
      store.close();
    }
  });

  it("[4.5] two identically-titled H3 rows under the same H2 parent collapse into one", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      seedDoc(store, "dupchild.md", "T", [
        { heading: "", content: padTo("# T\n\n", 300) },
        {
          heading: "Parent",
          content: padTo("## Parent\n\n### Same\n\na.\n\n### Same\n\nb.\n\n### Other\n\nc.\n\n", 25000),
        },
        { heading: "Sibling", content: padTo("## Sibling\n\nmore.\n\n", 300) },
      ]);
      const result = new ReadDocument(store).execute({ path: "dupchild.md" });
      expect(result.type).toBe("outline");
      if (result.type !== "outline") return;

      const parent = result.sections.find((s) => s.heading === "Parent")!;
      // Both "### Same" occurrences live inside the SAME physical chunk as
      // "Parent" itself, so requesting either resolves the whole chunk --
      // one collapsed row, not two, and "Other" survives alongside it.
      const same = parent.children.filter((c) => c.heading === "Same");
      expect(same).toHaveLength(1);
      expect(same[0]!.occurrences).toBe(2);
      expect(parent.children.map((c) => c.heading)).toContain("Other");
    } finally {
      store.close();
    }
  });

  it("[4.6] gate ordering: two identically-titled H2s as the only candidates collapse first, so the >=2 gate is not met", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      seedDoc(store, "onlydup.md", "T", [
        { heading: "", content: padTo("# T\n\n", 300) },
        { heading: "Same", content: padTo("## Same\n\nfirst body.\n\n", 12000) },
        { heading: "Same", content: padTo("## Same\n\nsecond body.\n\n", 12000) },
      ]);
      const result = new ReadDocument(store).execute({ path: "onlydup.md" });
      // Collapse runs first, leaving a single candidate row (which, worse,
      // matches every "Same" chunk and so isn't addressable either) -- the
      // >=2-addressable gate is not met, so this returns in full.
      expect(result.type).toBe("document");
    } finally {
      store.close();
    }
  });
});

describe("ReadDocument — D4 gate: lazy evaluation with a bounded candidate cap (design.md R4)", () => {
  it("[5.1] a document with >=2000 candidate rows, none addressable within the first 2000 evaluated, falls back to 'document'", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      // Every heading has a distinct, short, highly generic title so its
      // `sectionMatcher` match set is exactly one chunk (itself alone) --
      // which makes it addressable and would defeat this test's premise --
      // UNLESS every heading's raw line ALSO appears, verbatim, inside every
      // other heading's own chunk, so each one's match set is the WHOLE
      // document. Simplest fixture that guarantees non-addressability for
      // 2000 candidates without relying on substring collisions between
      // titles themselves: one giant single chunk holding 2001 H2 lines (the
      // NO_CHUNKING shape), each request for any of them resolves to that
      // one chunk -- i.e. the entire document -- so none is addressable.
      const headings = Array.from({ length: 2001 }, (_, i) => `## Item ${i}\n\nbody ${i}.\n\n`).join("");
      seedDoc(store, "manycandidates.md", "T", [{ heading: "", content: `# T\n\n${headings}` }]);
      const result = new ReadDocument(store).execute({ path: "manycandidates.md" });
      expect(result.type).toBe("document");
    } finally {
      store.close();
    }
  });

  it("[5.2] a document with exactly 2 addressable rows located early in position order still returns 'outline' (the cap must not short-circuit ordinary documents)", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      seedDoc(store, "early.md", "T", [
        { heading: "", content: padTo("# T\n\n", 300) },
        { heading: "First", content: padTo("## First\n\nbody.\n\n", 12000) },
        { heading: "Second", content: padTo("## Second\n\nbody.\n\n", 12000) },
      ]);
      const result = new ReadDocument(store).execute({ path: "early.md" });
      expect(result.type).toBe("outline");
    } finally {
      store.close();
    }
  });
});

describe("formatOutlineRow — R2 flags and R4's exact per-row cost bound (design.md R2/R4)", () => {
  it("[7.3] for every flag combination, the formatted row length + 1 is exactly the R4 pessimistic cost bound", () => {
    const combos: { oversized: boolean; includesOtherContent: boolean; occurrences: number }[] = [
      { oversized: false, includesOtherContent: false, occurrences: 1 },
      { oversized: false, includesOtherContent: false, occurrences: 3 },
      { oversized: true, includesOtherContent: false, occurrences: 1 },
      { oversized: false, includesOtherContent: true, occurrences: 1 },
      { oversized: true, includesOtherContent: true, occurrences: 5 },
    ];
    const docTokens = 12345;
    for (const combo of combos) {
      const row: Omit<OutlineSection, "children"> = { heading: "Some heading", tokens: docTokens, ...combo };
      const cost = formatOutlineRow(row, 0).length + 1;
      // R4's exact upper bound: sizing this row with tokens = docTokens and
      // both flags forced on can only ever be >= this row's own real cost.
      const worstCase = { ...row, tokens: docTokens, oversized: true, includesOtherContent: true };
      expect(formatOutlineRow(worstCase, 0).length + 1).toBeGreaterThanOrEqual(cost);
    }
  });

  it("[7.4] flag clauses render in the fixed order xN, too large, +other; xN only when occurrences > 1", () => {
    const all: Omit<OutlineSection, "children"> = {
      heading: "H",
      tokens: 10,
      occurrences: 3,
      oversized: true,
      includesOtherContent: true,
    };
    expect(formatOutlineRow(all, 0)).toBe("- H (~10, x3, too large, +other)");

    const noXn: Omit<OutlineSection, "children"> = { ...all, occurrences: 1 };
    expect(formatOutlineRow(noXn, 0)).toBe("- H (~10, too large, +other)");

    const onlyOccurrences: Omit<OutlineSection, "children"> = {
      heading: "H",
      tokens: 10,
      occurrences: 4,
      oversized: false,
      includesOtherContent: false,
    };
    expect(formatOutlineRow(onlyOccurrences, 0)).toBe("- H (~10, x4)");

    const none: Omit<OutlineSection, "children"> = {
      heading: "H",
      tokens: 10,
      occurrences: 1,
      oversized: false,
      includesOtherContent: false,
    };
    expect(formatOutlineRow(none, 0)).toBe("- H (~10)");
    expect(formatOutlineRow(none, 1)).toBe("  - H (~10)");
  });
});

describe("ReadDocument — R4 row budget ladder", () => {
  it("[7.5] step 1: every candidate row fits, so nothing is omitted", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      seedDoc(store, "ladder-fit.md", "T", [
        { heading: "", content: padTo("# T\n\n", 300) },
        { heading: "First", content: padTo("## First\n\n### Child\n\nbody.\n\n", 12000) },
        { heading: "Second", content: padTo("## Second\n\nbody.\n\n", 12000) },
      ]);
      const result = new ReadDocument(store).execute({ path: "ladder-fit.md" });
      expect(result.type).toBe("outline");
      if (result.type !== "outline") return;
      expect(result.omitted).toEqual({ kind: "none" });
      expect(result.sections.map((s) => s.heading)).toEqual(["First", "Second"]);
    } finally {
      store.close();
    }
  });

  it("[7.6] step 2: top-level rows all fit, but the full candidate set does not -- children of too-large parents render as a document-order prefix, and hidden counts both unshown children and any repeated group", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      const chunks: { heading: string; content: string }[] = [{ heading: "", content: padTo("# T\n\n", 300) }];
      const parentCount = 3;
      const childrenPerParent = 200;
      let globalChild = 0;
      for (let p = 0; p < parentCount; p++) {
        chunks.push({ heading: `Parent ${p}`, content: padTo(`## Parent ${p}\n\nintro.\n\n`, 25000) });
        for (let c = 0; c < childrenPerParent; c++) {
          const num = String(globalChild).padStart(4, "0");
          chunks.push({
            heading: `Parent ${p} > Child ${num}`,
            content: `### Child ${num}\n\ntiny.\n\n`,
          });
          globalChild++;
        }
      }
      seedDoc(store, "ladder-subheadings.md", "T", chunks);
      const result = new ReadDocument(store).execute({ path: "ladder-subheadings.md" });
      expect(result.type).toBe("outline");
      if (result.type !== "outline") return;

      expect(result.sections).toHaveLength(parentCount);
      expect(result.omitted.kind).toBe("subheadings");
      if (result.omitted.kind !== "subheadings") return;

      const renderedNums = result.sections.flatMap((s) =>
        s.children.map((c) => Number(c.heading.replace("Child ", ""))),
      );
      const totalChildren = parentCount * childrenPerParent;
      expect(renderedNums.length).toBeGreaterThan(0);
      expect(renderedNums.length).toBeLessThan(totalChildren);
      // Rendered children are an exact, contiguous document-order prefix.
      expect(renderedNums).toEqual(Array.from({ length: renderedNums.length }, (_, i) => i));
      expect(result.omitted.hidden).toBe(totalChildren - renderedNums.length + result.repeated.length);
    } finally {
      store.close();
    }
  });

  it("[7.7] step 3: even the top-level rows alone do not fit -- only the longest document-order prefix renders, with no children and no repeated group", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      const chunks: { heading: string; content: string }[] = [{ heading: "", content: padTo("# T\n\n", 300) }];
      const rowCount = 50;
      for (let i = 0; i < rowCount; i++) {
        const num = String(i).padStart(4, "0");
        // A long title dominates a row's rendered cost regardless of flags,
        // forcing this fixture past even the top-level-only budget quickly.
        chunks.push({ heading: `Row ${num}`, content: padTo(`## Row ${num}${"z".repeat(400)}\n\nbody.\n\n`, 1000) });
      }
      seedDoc(store, "ladder-truncated.md", "T", chunks);
      const result = new ReadDocument(store).execute({ path: "ladder-truncated.md" });
      expect(result.type).toBe("outline");
      if (result.type !== "outline") return;

      expect(result.omitted.kind).toBe("truncated");
      if (result.omitted.kind !== "truncated") return;
      expect(result.omitted.total).toBe(rowCount);
      expect(result.omitted.shown).toBeGreaterThan(0);
      expect(result.omitted.shown).toBeLessThan(rowCount);
      expect(result.sections).toHaveLength(result.omitted.shown);
      expect(result.sections.every((s) => s.children.length === 0)).toBe(true);
      expect(result.repeated).toEqual([]);
      const shownNums = result.sections.map((s) => Number(s.heading.replace(/^Row 0*(\d+)z*$/, "$1")));
      expect(shownNums).toEqual(Array.from({ length: result.omitted.shown }, (_, i) => i));
    } finally {
      store.close();
    }
  });

  it("[7.8] truncation never revisits the addressable-row gate: even reduced to 1 visible row, the response is still an outline", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      const chunks: { heading: string; content: string }[] = [{ heading: "", content: padTo("# T\n\n", 300) }];
      // Each heading's own title is long enough that a single rendered row
      // costs close to half the row budget -- two of them together exceed it.
      for (let i = 0; i < 8; i++) {
        const title = `${"X".repeat(4480)} ${String(i)}`;
        chunks.push({ heading: title, content: `## ${title}\n\nbody content for this section.\n\n` });
      }
      seedDoc(store, "ladder-min-visible.md", "T", chunks);
      const result = new ReadDocument(store).execute({ path: "ladder-min-visible.md" });
      expect(result.type).toBe("outline");
      if (result.type !== "outline") return;
      expect(result.omitted.kind).toBe("truncated");
      if (result.omitted.kind !== "truncated") return;
      expect(result.omitted.shown).toBe(1);
      expect(result.sections).toHaveLength(1);
    } finally {
      store.close();
    }
  });
});

describe("ReadDocument — R3 own-sections and the +other flag (design.md R3)", () => {
  it("[6.1] a substring overlap flags only the row whose response includes the other ('Scope'/'Out of Scope')", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      seedDoc(store, "overlap-scope.md", "T", [
        { heading: "", content: padTo("# T\n\n", 300) },
        { heading: "Scope", content: padTo("## Scope\n\nin-scope body.\n\n", 12000) },
        { heading: "Out of Scope", content: padTo("## Out of Scope\n\nexcluded body.\n\n", 12000) },
      ]);
      const result = new ReadDocument(store).execute({ path: "overlap-scope.md" });
      expect(result.type).toBe("outline");
      if (result.type !== "outline") return;

      const scope = result.sections.find((s) => s.heading === "Scope")!;
      const outOfScope = result.sections.find((s) => s.heading === "Out of Scope")!;
      expect(scope.includesOtherContent).toBe(true);
      expect(outOfScope.includesOtherContent).toBe(false);
    } finally {
      store.close();
    }
  });

  it("[6.2] worked example (a): an ordinary, non-terse changelog version is NOT flagged", async () => {
    const dir = mkdtempSync(join(tmpdir(), "compendio-outline-changelog-a-"));
    try {
      const body = "Detalle de la version. ".repeat(20);
      const content = [
        "# Changelog",
        "",
        "## 1.0.0",
        "",
        "### Added",
        "",
        body,
        "",
        "### Fixed",
        "",
        body,
        "",
        "## 1.1.0",
        "",
        "### Added",
        "",
        body,
        "",
        "### Fixed",
        "",
        body,
        "",
        // Pads the document past the outline threshold without touching the
        // versions under test: one oversized H2, split into bounded chunks.
        "## Appendix",
        "",
        outlinePadding(),
        "",
      ].join("\n");
      writeFileSync(join(dir, "CHANGELOG.md"), content);

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
        await indexer.execute();
        const doc = store.getDocumentByPath("CHANGELOG.md");
        expect(doc).not.toBeNull();
        if (doc === null) return;
        const chunks = store.getChunksByDocument(doc.id);
        // Confirm the fixture actually fuses "## 1.0.0" and its H3 children
        // into one physical chunk (chunkOutline's non-descend rule) --
        // otherwise this test would not exercise worked example (a) at all.
        const versionChunk = chunks.find((c) => c.content.includes("## 1.0.0") && c.content.includes("### Added"));
        expect(versionChunk).toBeDefined();

        const result = read.execute({ path: "CHANGELOG.md" });
        expect(result.type).toBe("outline");
        if (result.type !== "outline") return;
        const version = result.sections.find((s) => s.heading === "1.0.0");
        expect(version).toBeDefined();
        if (version === undefined) return;
        expect(version.includesOtherContent).toBe(false);
      } finally {
        store.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("[6.3] worked example (b): a split oversized childless H2 (only the first physical piece keeps the heading line) is NOT flagged", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      seedDoc(store, "split-childless.md", "T", [
        { heading: "", content: padTo("# T\n\n", 300) },
        // Two physical chunks sharing one heading -- only the first carries
        // the literal "## Huge" line, exactly as `splitToBound` produces for
        // an oversized H2 with no H3 children.
        { heading: "Huge", content: padTo("## Huge\n\nfirst half.\n\n", 12000) },
        { heading: "Huge", content: padTo("second half, no heading line here.\n\n", 12000) },
        { heading: "Other", content: padTo("## Other\n\nbody.\n\n", 300) },
      ]);
      const result = new ReadDocument(store).execute({ path: "split-childless.md" });
      expect(result.type).toBe("outline");
      if (result.type !== "outline") return;

      const huge = result.sections.find((s) => s.heading === "Huge")!;
      expect(huge.includesOtherContent).toBe(false);
    } finally {
      store.close();
    }
  });

  it("[6.4] two sections fused at index time into one stored chunk both carry the flag; an ordinary H2 with only its own H3 children is not flagged", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      seedDoc(store, "fused-and-ordinary.md", "T", [
        { heading: "", content: padTo("# T\n\n", 300) },
        { heading: "Big", content: padTo("## Big\n\nbig body.\n\n## Tiny\n\ntiny body.\n\n", 12000) },
        { heading: "Other", content: padTo("## Other\n\nmore.\n\n", 12000) },
        { heading: "Parent", content: padTo("## Parent\n\n### Child\n\nbody.\n\n", 12000) },
        { heading: "Sibling", content: padTo("## Sibling\n\nmore.\n\n", 12000) },
      ]);
      const result = new ReadDocument(store).execute({ path: "fused-and-ordinary.md" });
      expect(result.type).toBe("outline");
      if (result.type !== "outline") return;

      const big = result.sections.find((s) => s.heading === "Big")!;
      const tiny = result.sections.find((s) => s.heading === "Tiny")!;
      expect(big.includesOtherContent).toBe(true);
      expect(tiny.includesOtherContent).toBe(true);
      expect(big.tokens).toBe(tiny.tokens);

      const parent = result.sections.find((s) => s.heading === "Parent")!;
      expect(parent.includesOtherContent).toBe(false);
    } finally {
      store.close();
    }
  });

  it("[6.5] a parent whose own section holds repeated child titles is not flagged", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      seedDoc(store, "repeated-children.md", "T", [
        { heading: "", content: padTo("# T\n\n", 300) },
        {
          heading: "Parent",
          content: padTo("## Parent\n\n### Same\n\na.\n\n### Same\n\nb.\n\n", 12000),
        },
        { heading: "Sibling", content: padTo("## Sibling\n\nmore.\n\n", 12000) },
      ]);
      const result = new ReadDocument(store).execute({ path: "repeated-children.md" });
      expect(result.type).toBe("outline");
      if (result.type !== "outline") return;

      const parent = result.sections.find((s) => s.heading === "Parent")!;
      expect(parent.includesOtherContent).toBe(false);
    } finally {
      store.close();
    }
  });

  it("[6.6] a `repeated` row fused with its parent's heading is flagged; the same shape with a dedicated chunk per occurrence is not", () => {
    const fusedStore = new SqliteIndexStore(":memory:");
    try {
      seedDoc(fusedStore, "repeated-fused.md", "T", [
        { heading: "", content: padTo("# T\n\n", 300) },
        // Each version's own H2 line is fused in the same chunk as its
        // "### Added" child, ahead of it -- ordinary chunkOutline shape.
        { heading: "1.0.0", content: padTo("## 1.0.0\n\n### Added\n\na.\n\n", 12000) },
        { heading: "1.1.0", content: padTo("## 1.1.0\n\n### Added\n\nb.\n\n", 12000) },
        { heading: "1.2.0", content: padTo("## 1.2.0\n\n### Added\n\nc.\n\n", 12000) },
      ]);
      const fusedResult = new ReadDocument(fusedStore).execute({ path: "repeated-fused.md" });
      expect(fusedResult.type).toBe("outline");
      if (fusedResult.type === "outline") {
        const added = fusedResult.repeated.find((r) => r.heading === "Added")!;
        expect(added.includesOtherContent).toBe(true);
      }
    } finally {
      fusedStore.close();
    }

    const dedicatedStore = new SqliteIndexStore(":memory:");
    try {
      seedDoc(dedicatedStore, "repeated-dedicated.md", "T", [
        { heading: "", content: padTo("# T\n\n", 300) },
        // Each "### Added" occurrence gets its OWN chunk, with no preceding
        // parent heading line -- the descend-branch shape.
        { heading: "1.0.0", content: padTo("## 1.0.0\n\nintro.\n\n", 300) },
        { heading: "1.0.0 > Added", content: padTo("### Added\n\na.\n\n", 12000) },
        { heading: "1.1.0", content: padTo("## 1.1.0\n\nintro.\n\n", 300) },
        { heading: "1.1.0 > Added", content: padTo("### Added\n\nb.\n\n", 12000) },
        { heading: "1.2.0", content: padTo("## 1.2.0\n\nintro.\n\n", 300) },
        { heading: "1.2.0 > Added", content: padTo("### Added\n\nc.\n\n", 12000) },
      ]);
      const dedicatedResult = new ReadDocument(dedicatedStore).execute({ path: "repeated-dedicated.md" });
      expect(dedicatedResult.type).toBe("outline");
      if (dedicatedResult.type === "outline") {
        const added = dedicatedResult.repeated.find((r) => r.heading === "Added")!;
        expect(added.includesOtherContent).toBe(false);
      }
    } finally {
      dedicatedStore.close();
    }
  });

  it("[6.7] worked example (c): a `repeated` H3 occurring once under each of two different, self-contained H2 parents is NOT flagged (union, not intersection)", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      seedDoc(store, "union-not-intersection.md", "T", [
        { heading: "", content: padTo("# T\n\n", 300) },
        { heading: "P1", content: padTo("## P1\n\nintro.\n\n", 300) },
        { heading: "P1 > Configuration", content: padTo("### Configuration\n\na.\n\n", 12000) },
        { heading: "P2", content: padTo("## P2\n\nintro.\n\n", 300) },
        { heading: "P2 > Configuration", content: padTo("### Configuration\n\nb.\n\n", 12000) },
      ]);
      const result = new ReadDocument(store).execute({ path: "union-not-intersection.md" });
      expect(result.type).toBe("outline");
      if (result.type !== "outline") return;

      const configuration = result.repeated.find((r) => r.heading === "Configuration")!;
      expect(configuration.includesOtherContent).toBe(false);
    } finally {
      store.close();
    }
  });

  it("[6.7] the surviving D2-exceeds-parent invariant, re-fixtured as a single-parent child pulled wider by a substring match", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      seedDoc(store, "exceeds-parent.md", "T", [
        { heading: "", content: padTo("# T\n\n", 300) },
        // "Zeta" (the parent) never appears inside "Notes Extended"'s text or
        // heading path, so only "Notes" -- not "Zeta" -- gets pulled wider.
        { heading: "Zeta", content: padTo("## Zeta\n\n### Notes\n\nbody.\n\n", 500) },
        { heading: "Notes Extended", content: padTo("## Notes Extended\n\nmore.\n\n", 25000) },
      ]);
      const result = new ReadDocument(store).execute({ path: "exceeds-parent.md" });
      expect(result.type).toBe("outline");
      if (result.type !== "outline") return;

      const zeta = result.sections.find((s) => s.heading === "Zeta")!;
      const notes = zeta.children.find((c) => c.heading === "Notes")!;
      // "Notes" substring-matches "Notes Extended" too, so its response is
      // pulled wider than its own parent's -- flagged, and its tokens exceed
      // its listed parent's.
      expect(notes.includesOtherContent).toBe(true);
      expect(notes.tokens).toBeGreaterThan(zeta.tokens);
    } finally {
      store.close();
    }
  });

  it("[6.8] worked example (d): a title that is a substring of the document title always flags its row", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      seedDoc(store, "doctitle.md", "Configuration Guide", [
        // The real indexer never persists an empty `heading` (AGENTS.md "no
        // chunk has an empty heading"): a heading-less intro chunk's `heading`
        // falls back to the document title -- exactly the substring-collision
        // vector design.md's worked example (d) describes.
        { heading: "Configuration Guide", content: padTo("# Configuration Guide\n\nintro.\n\n", 300) },
        { heading: "Guide", content: padTo("## Guide\n\nbody.\n\n", 12000) },
        { heading: "Other", content: padTo("## Other\n\nmore.\n\n", 12000) },
      ]);
      const result = new ReadDocument(store).execute({ path: "doctitle.md" });
      expect(result.type).toBe("outline");
      if (result.type !== "outline") return;

      const guide = result.sections.find((s) => s.heading === "Guide")!;
      expect(guide.includesOtherContent).toBe(true);
    } finally {
      store.close();
    }
  });

  it("[6.9] D8+D9 combined: a row that is both oversized and +other-flagged carries both booleans", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      seedDoc(store, "both2.md", "T", [
        { heading: "", content: padTo("# T\n\n", 300) },
        {
          heading: "Wrapper",
          content: padTo("## Wrapper\n\nintro.\n\n## Fused\n\nfused body.\n\n", 25000),
        },
        { heading: "Other", content: padTo("## Other\n\nbody.\n\n", 500) },
      ]);
      const result = new ReadDocument(store).execute({ path: "both2.md" });
      expect(result.type).toBe("outline");
      if (result.type !== "outline") return;

      const wrapper = result.sections.find((s) => s.heading === "Wrapper")!;
      expect(wrapper.oversized).toBe(true);
      expect(wrapper.includesOtherContent).toBe(true);
    } finally {
      store.close();
    }
  });
});

describe("ReadDocument — oversized-row annotation (design.md D8)", () => {
  it("a wrapper H2 whose H3 subtree alone exceeds the threshold is annotated; its H3 children are not", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      seedDoc(store, "oversized-wrapper.md", "T", [
        { heading: "", content: padTo("# T\n\n", 300) },
        // Real chunking stores an H3 child as its OWN chunk, keyed by its
        // full heading PATH ("Wrapper > Child"): `sectionMatcher` matches by
        // substring, so a request for "Wrapper" pulls in both this chunk and
        // the intro chunk below (their paths both contain "wrapper"), while
        // a request for "Child" pulls in only this one.
        { heading: "Wrapper", content: padTo("## Wrapper\n\nintro.\n\n", 1200) },
        { heading: "Wrapper > Child", content: padTo("### Child\n\nbody.\n\n", 23000) },
        { heading: "Small", content: padTo("## Small\n\nbody.\n\n", 300) },
      ]);
      const result = new ReadDocument(store).execute({ path: "oversized-wrapper.md" });
      expect(result.type).toBe("outline");
      if (result.type !== "outline") return;

      const wrapper = result.sections.find((s) => s.heading === "Wrapper")!;
      expect(wrapper.oversized).toBe(true);
      expect(wrapper.children.map((c) => c.heading)).toContain("Child");
      const child = wrapper.children.find((c) => c.heading === "Child")!;
      expect(child.oversized).toBe(false);
    } finally {
      store.close();
    }
  });

  it("a flat H2 with no H3 children that exceeds the threshold is annotated, with no children to offer", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      seedDoc(store, "oversized-flat.md", "T", [
        { heading: "", content: padTo("# T\n\n", 300) },
        { heading: "Huge", content: padTo("## Huge\n\nbody.\n\n", 25000) },
        { heading: "Small", content: padTo("## Small\n\nbody.\n\n", 300) },
      ]);
      const result = new ReadDocument(store).execute({ path: "oversized-flat.md" });
      expect(result.type).toBe("outline");
      if (result.type !== "outline") return;

      const huge = result.sections.find((s) => s.heading === "Huge")!;
      expect(huge.oversized).toBe(true);
      expect(huge.children).toEqual([]);
    } finally {
      store.close();
    }
  });
});

describe("ReadDocument — every listed outline row round-trips through `section` (design.md, property)", () => {
  function flatten(sections: OutlineSection[]): OutlineSection[] {
    return sections.flatMap((s) => [s, ...flatten(s.children)]);
  }

  it("every row resolves to a 'section' result whose content size matches the row's own tokens", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      seedDoc(store, "roundtrip.md", "T", [
        { heading: "", content: padTo("# T\n\n### Orphan\n\nintro.\n\n", 300) },
        {
          heading: "First",
          content: padTo("## First\n\n### Child A\n\na.\n\n### Child B\n\nb.\n\n", 12000),
        },
        { heading: "Second", content: padTo("## Second\n\nc.\n\n", 12000) },
      ]);
      const read = new ReadDocument(store);
      const result = read.execute({ path: "roundtrip.md" });
      expect(result.type).toBe("outline");
      if (result.type !== "outline") return;

      const rows = flatten(result.sections);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const sectionResult = read.execute({ path: "roundtrip.md", section: row.heading });
        expect(sectionResult.type).toBe("section");
        if (sectionResult.type !== "section") continue;
        expect(Math.ceil(sectionResult.content.length / 4)).toBe(row.tokens);
      }
    } finally {
      store.close();
    }
  });

  it("[9.1] a `repeated` group entry also round-trips through `section`", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      seedDoc(store, "roundtrip-repeated.md", "T", [
        { heading: "", content: padTo("# T\n\n", 300) },
        { heading: "P1", content: padTo("## P1\n\n### Shared\n\na.\n\n", 12000) },
        { heading: "P2", content: padTo("## P2\n\n### Shared\n\nb.\n\n", 12000) },
      ]);
      const read = new ReadDocument(store);
      const result = read.execute({ path: "roundtrip-repeated.md" });
      expect(result.type).toBe("outline");
      if (result.type !== "outline") return;

      expect(result.repeated.length).toBeGreaterThan(0);
      for (const row of result.repeated) {
        const sectionResult = read.execute({ path: "roundtrip-repeated.md", section: row.heading });
        expect(sectionResult.type).toBe("section");
        if (sectionResult.type !== "section") continue;
        expect(Math.ceil(sectionResult.content.length / 4)).toBe(row.tokens);
      }
    } finally {
      store.close();
    }
  });
});

// --- Integration: real chunker (IndexDocuments), spec-delta fixture and the -
// --- `ejemplos/` golden-set threshold bound. -------------------------------

describe("ReadDocument — outline integration with the real chunker (IndexDocuments)", () => {
  it("a section split by the size bound and a merged tiny H2 each produce exactly one row", async () => {
    const dir = mkdtempSync(join(tmpdir(), "compendio-outline-integration-"));
    try {
      const sentences = Array.from(
        { length: 400 },
        (_, i) => `Oracion numero ${i} con contenido suficiente para acumular tokens de forma constante.`,
      ).join(" ");
      const bigSection = "Contenido amplio de la seccion principal repetido varias veces. ".repeat(20);
      const content = [
        "# Documento grande",
        "",
        "## Seccion extensa",
        "",
        sentences,
        "",
        "## Big section",
        "",
        bigSection,
        "",
        "## Tiny section",
        "",
        "Un detalle breve.",
        "",
      ].join("\n");
      writeFileSync(join(dir, "grande.md"), content);

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

        // Confirm the fixture actually exercises both shapes before trusting
        // the outline's row count.
        const rawChunks = store.getChunksByDocument(doc.id);
        expect(rawChunks.filter((c) => c.heading === "Seccion extensa").length).toBeGreaterThan(1);
        expect(rawChunks.some((c) => c.heading === "Tiny section")).toBe(false);

        const result = read.execute({ path: "grande.md" });
        expect(result.type).toBe("outline");
        if (result.type !== "outline") return;

        expect(result.sections.filter((s) => s.heading === "Seccion extensa")).toHaveLength(1);
        expect(result.sections.filter((s) => s.heading === "Tiny section")).toHaveLength(1);
      } finally {
        store.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a spec-delta-shaped fixture (one wrapping H2, many H3 requirement children) lists the wrapper as too-large and each H3 as addressable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "compendio-outline-spec-delta-"));
    try {
      const requirements = Array.from(
        { length: 25 },
        (_, i) =>
          `### Requirement: Item ${i}\n\n` +
          `The system MUST do something about item ${i}, described at enough length that this ` +
          "requirement carries real content of its own, not just a heading line repeated many times. ".repeat(
            25,
          ) +
          "\n",
      ).join("\n");
      writeFileSync(join(dir, "delta.md"), `# Delta\n\n## ADDED Requirements\n\n${requirements}\n`);

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

        const result = read.execute({ path: "delta.md" });
        expect(result.type).toBe("outline");
        if (result.type !== "outline") return;

        const wrapper = result.sections.find((s) => s.heading === "ADDED Requirements");
        expect(wrapper).toBeDefined();
        if (wrapper === undefined) return;
        expect(wrapper.oversized).toBe(true);
        expect(formatOutlineRow(wrapper, 0)).toContain("too large");
        expect(wrapper.children.length).toBeGreaterThan(0);

        // The very first child is fused, in the same physical chunk, right
        // after the wrapper's own "## ADDED Requirements" heading line
        // (chunkOutline's non-descend rule for the first piece) -- it is
        // correctly flagged `+other` by R3 (consequence (b)'s shape), unlike
        // every later child, which gets its own dedicated chunk once the
        // section has grown past `maxTokens`.
        const laterChild = wrapper.children[wrapper.children.length - 1]!;
        expect(laterChild.includesOtherContent).toBe(false);
        const childSection = read.execute({ path: "delta.md", section: laterChild.heading });
        const wrapperSection = read.execute({ path: "delta.md", section: "ADDED Requirements" });
        expect(childSection.type).toBe("section");
        expect(wrapperSection.type).toBe("section");
        if (childSection.type !== "section" || wrapperSection.type !== "section") return;
        expect(childSection.content.length).toBeLessThan(wrapperSection.content.length);
      } finally {
        store.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("[8.3] terse changelog: mergeTinyPieces fuses 2+ versions into one physical chunk, and each fused version's row is flagged +other", async () => {
    const dir = mkdtempSync(join(tmpdir(), "compendio-outline-terse-changelog-"));
    try {
      const versions = Array.from({ length: 6 }, (_, v) => `## 1.${v}.0\n\n### Added\n\n- tiny fix.\n`).join("\n");
      // The appendix pads the document past the outline threshold; the terse
      // versions before it still fuse on their own.
      writeFileSync(join(dir, "TERSE.md"), `# Terse changelog\n\n${versions}\n## Appendix\n\n${outlinePadding()}\n`);

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
        await indexer.execute();
        const doc = store.getDocumentByPath("TERSE.md");
        expect(doc).not.toBeNull();
        if (doc === null) return;
        const chunks = store.getChunksByDocument(doc.id);
        // Confirm the fixture actually fuses 2+ versions into one physical
        // chunk before trusting the flag assertion below.
        const fusedChunk = chunks.find(
          (c) => (c.content.match(/^## 1\.\d+\.0$/gm) ?? []).length >= 2,
        );
        expect(fusedChunk).toBeDefined();

        const result = read.execute({ path: "TERSE.md" });
        expect(result.type).toBe("outline");
        if (result.type !== "outline") return;
        const versionRows = result.sections.filter((s) => s.heading.startsWith("1."));
        expect(versionRows.length).toBeGreaterThanOrEqual(2);
        for (const version of versionRows) {
          expect(version.includesOtherContent).toBe(true);
        }
      } finally {
        store.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("[8.4] an oversized childless H2 split by the real chunker into 2+ stored chunks is one row, not flagged +other", async () => {
    const dir = mkdtempSync(join(tmpdir(), "compendio-outline-split-childless-"));
    try {
      const sentences = Array.from(
        { length: 400 },
        (_, i) => `Oracion numero ${i} con contenido suficiente para acumular tokens de forma constante.`,
      ).join(" ");
      // A second H2 is required: with a single addressable row the document is
      // returned in full, never as an outline (mcp-contract spec). It must stay
      // above chunk.minTokens, or the chunker merges it into the last piece of
      // "Only section" and neither row is addressable on its own.
      const closing = "Parrafo de cierre con contenido propio. ".repeat(20);
      writeFileSync(
        join(dir, "SPLIT.md"),
        `# Split\n\n## Only section\n\n${sentences}\n\n## Second part\n\n${closing}\n`,
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
        const doc = store.getDocumentByPath("SPLIT.md");
        expect(doc).not.toBeNull();
        if (doc === null) return;
        const rawChunks = store.getChunksByDocument(doc.id).filter((c) => c.heading === "Only section");
        expect(rawChunks.length).toBeGreaterThan(1);

        const result = read.execute({ path: "SPLIT.md" });
        expect(result.type).toBe("outline");
        if (result.type !== "outline") return;
        const only = result.sections.find((s) => s.heading === "Only section");
        expect(only).toBeDefined();
        if (only === undefined) return;
        expect(only.includesOtherContent).toBe(false);
      } finally {
        store.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- Scale, no-OOM (design.md R6, Acceptance budgets) ---------------------
//
// Seeded directly against SqliteIndexStore(":memory:") (one chunk per
// heading, same construction the unit-level fixtures above use) rather than
// through the real chunker/IndexDocuments pipeline: at 2000-5000 headings the
// point is to exercise buildOutline's own bounded-cost math fast and
// deterministically, not to re-measure chunkOutline (already covered by
// Phase 8's integration tests).

const PARA =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore.";

function apiRefChunks(n: number): { heading: string; content: string }[] {
  const chunks: { heading: string; content: string }[] = [{ heading: "", content: `# API reference\n\n${PARA}\n\n` }];
  const perGroup = Math.ceil(n / 20);
  for (let i = 0; i < n; i++) {
    if (i % perGroup === 0) {
      chunks.push({ heading: `Module ${i / perGroup}`, content: `## Module ${i / perGroup}\n\n${PARA}\n\n` });
    }
    chunks.push({
      heading: `Module ${Math.floor(i / perGroup)} > function_${i}()`,
      content: `### function_${i}()\n\n${PARA} ${PARA}\n\n`,
    });
  }
  return chunks;
}

function flatChunks(n: number): { heading: string; content: string }[] {
  const chunks: { heading: string; content: string }[] = [{ heading: "", content: `# Flat\n\n${PARA}\n\n` }];
  for (let i = 0; i < n; i++) {
    chunks.push({ heading: `Entry number ${i}`, content: `## Entry number ${i}\n\n${PARA} ${PARA}\n\n` });
  }
  return chunks;
}

function changelogChunks(n: number): { heading: string; content: string }[] {
  const chunks: { heading: string; content: string }[] = [{ heading: "", content: `# Changelog\n\n${PARA}\n\n` }];
  const versions = Math.ceil(n / 3);
  for (let v = 0; v < versions; v++) {
    const lines = [`## 1.${v}.0`, ""];
    for (const t of ["Added", "Fixed", "Changed"]) lines.push(`### ${t}`, "", `- ${PARA}`, `- ${PARA}`, "");
    chunks.push({ heading: `1.${v}.0`, content: lines.join("\n") });
  }
  return chunks;
}

describe("ReadDocument — scale and the no-OOM guard (design.md R6, Acceptance budgets)", () => {
  it.each([
    ["apiRef", apiRefChunks],
    ["flat", flatChunks],
    ["changelog", changelogChunks],
  ] as const)("[9.2-9.4] %s/2000: rendered outline stays within the 2300 estimated-token ceiling", (_name, gen) => {
    const store = new SqliteIndexStore(":memory:");
    try {
      seedDoc(store, "scale.md", "T", gen(2000));
      const result = new ReadDocument(store).execute({ path: "scale.md" });
      expect(result.type).toBe("outline");
      if (result.type !== "outline") return;

      const rowsText = [
        ...result.sections.flatMap((s) => [formatOutlineRow(s, 0), ...s.children.map((c) => formatOutlineRow(c, 1))]),
        ...result.repeated.map((r) => formatOutlineRow(r, 0)),
      ].join("\n");
      // Excludes the header/legend/notice's own path-independent text and
      // frontmatter, per the spec's exact budget definition -- the rows
      // block alone is bounded to OUTLINE_ROWS_BUDGET_CHARS characters by
      // construction, well under the 2300-token ceiling on its own.
      expect(Math.ceil(rowsText.length / 4)).toBeLessThanOrEqual(2300);
      expect(rowsText.length).toBeLessThanOrEqual(OUTLINE_ROWS_BUDGET_CHARS);
    } finally {
      store.close();
    }
  });

  it("[9.5] changelog/5000 completes and returns 'outline' without throwing (no-OOM guard)", () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      seedDoc(store, "big-changelog.md", "T", changelogChunks(5000));
      const result = new ReadDocument(store).execute({ path: "big-changelog.md" });
      expect(result.type).toBe("outline");
    } finally {
      store.close();
    }
  }, 10000);
});

describe("ReadDocument — the ejemplos/ golden-set corpus stays below the outline threshold", () => {
  it("every ejemplos/ document returns 'document' (never 'outline') without section", async () => {
    const harness = buildHarness(new FakeEmbeddings());
    try {
      await harness.index.execute();
      const overview = harness.overview.execute();
      expect(overview.documents.length).toBeGreaterThan(0);
      for (const doc of overview.documents) {
        const result = harness.read.execute({ path: doc.path });
        expect(result.type).toBe("document");
      }
    } finally {
      harness.close();
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
