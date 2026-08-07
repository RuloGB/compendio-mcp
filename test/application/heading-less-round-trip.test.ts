import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { IndexDocuments } from "../../src/application/index-documents";
import { ReadDocument } from "../../src/application/read-document";
import { SearchDocuments } from "../../src/application/search-documents";
import { createConventionPolicy } from "../../src/domain/convention";
import { DEFAULT_CONFIG, NO_CHUNKING } from "../../src/infrastructure/config";
import { FileDocumentSource } from "../../src/infrastructure/fs/file-document-source";
import { RemarkMarkdownParser } from "../../src/infrastructure/markdown/remark-markdown-parser";
import { SqliteIndexStore } from "../../src/infrastructure/sqlite/sqlite-index-store";
import { buildHarness, EXAMPLES_CONVENTION, VECTOR_REACH_DOCS, type TestHarness } from "../helpers/build";

/**
 * Gate 1 (defect reproduces, then disappears) and Gate 3 (round trip through
 * the public contract), end to end over the real IndexDocuments ->
 * SearchDocuments -> ReadDocument path -- not only at `chunkOutline` unit
 * level. `addressable-chunks` design.md, "Gate 1 -- red-first".
 *
 * `manual-extenso.md` is one of six committed heading-less documents already
 * reproducing the defect (no new fixture corpus needed). Null embeddings
 * keep the run lexical-only and deterministic, no model download.
 */
describe("Gate 1 / Gate 3 — heading-less document round trip", () => {
  let harness: TestHarness;

  afterEach(() => {
    harness?.close();
  });

  it("Gate 1: every persisted chunk of a heading-less document carries the SAME non-empty heading (the humanized filename); Gate 3: search_docs's section round-trips through read_doc to a resolved section", async () => {
    harness = buildHarness(null, EXAMPLES_CONVENTION, VECTOR_REACH_DOCS);

    const report = await harness.index.execute();
    expect(report.skipped).toEqual([]);

    const doc = harness.store.getDocumentByPath("manual-extenso.md");
    expect(doc).not.toBeNull();
    if (doc === null) return;
    const chunks = harness.store.getChunksByDocument(doc.id);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.heading).toBe("Manual extenso");
    }

    // "QUETZAL-7731" is a marker unique to manual-extenso.md among the six
    // fixture documents (CLAUDE.md's Gate 1b procedure), so a lexical-only
    // search for it identifies this document without ambiguity.
    const response = await harness.search.execute({ query: "QUETZAL-7731" });
    const hit = response.results.find((r) => r.path === "manual-extenso.md");
    expect(hit).toBeDefined();
    expect(hit!.section).toBe("Manual extenso");

    // Gate 3: the exact `section` string search_docs returned, passed back
    // verbatim to read_doc, must resolve -- never section-not-found.
    const read = harness.read.execute({ path: "manual-extenso.md", section: hit!.section });
    expect(read.type).toBe("section");
  });
});

/**
 * Gate 3, the punctuation-hostile case: the path-level fallback (level 2 of
 * design.md Decision 2) is chosen precisely because it round-trips by
 * construction through `normalize` (`similarity.ts:37-42`, which only
 * lowercases and strips diacritics, leaving punctuation intact) -- not
 * because it is convenient. A filename like "-.md" carries a hyphen that
 * survives normalization unchanged, so this exercises that claim against the
 * real matcher rather than assuming it.
 */
describe("Gate 3 — the '-.md' path-fallback value round-trips too", () => {
  it("a heading-less document at '-.md' (humanizes to '') gets heading '-.md', and read_doc resolves that value verbatim", async () => {
    const dir = mkdtempSync(join(tmpdir(), "compendio-heading-fallback-"));
    try {
      const body = "Prose with no heading structure at all, repeated many times over today. ".repeat(
        20,
      );
      writeFileSync(join(dir, "-.md"), body);

      const store = new SqliteIndexStore(":memory:");
      try {
        const indexer = new IndexDocuments(
          new FileDocumentSource(dir, []),
          new RemarkMarkdownParser(),
          store,
          null,
          createConventionPolicy(EXAMPLES_CONVENTION),
          { chunking: DEFAULT_CONFIG.chunk, noChunking: NO_CHUNKING },
        );
        const search = new SearchDocuments(store, null, { k: 5, excludedStatuses: [] });
        const read = new ReadDocument(store);

        const report = await indexer.execute();
        expect(report.skipped).toEqual([]);

        const doc = store.getDocumentByPath("-.md");
        expect(doc).not.toBeNull();
        if (doc === null) return;
        const chunks = store.getChunksByDocument(doc.id);
        expect(chunks.length).toBeGreaterThan(0);
        for (const chunk of chunks) {
          expect(chunk.heading).toBe("-.md");
        }

        const response = await search.execute({ query: "Prose with no heading structure" });
        const hit = response.results.find((r) => r.path === "-.md");
        expect(hit).toBeDefined();
        expect(hit!.section).toBe("-.md");

        const result = read.execute({ path: "-.md", section: hit!.section });
        expect(result.type).toBe("section");
      } finally {
        store.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * `mcp-contract` spec, "A corpus not yet reindexed is not repaired at query
 * time". The non-empty-heading invariant is enforced at index time
 * (`index-pipeline.ts`), and `heading` is persisted, so a corpus written by a
 * pre-fix build keeps its empty headings until a full `compendio index` runs
 * ("Heading-Only Changes Also Require a Full Reindex", `indexing` spec).
 *
 * That requirement is a MUST NOT on live code: `search_docs` must return the
 * stored value as-is rather than substituting a fallback per query. Without
 * this test the rule holds only because `search-documents.ts` happens to have
 * a zero-line diff -- nothing would fail if a later change added query-time
 * repair, which would make the reindex requirement quietly untrue and mask a
 * stale index from its operator. Seeding the store directly is the only way to
 * construct the pre-fix state, since the pipeline can no longer produce it.
 */
describe("mcp-contract — a stale corpus is reported as stored, not repaired at query time", () => {
  it("search_docs returns the empty section of a chunk persisted before the invariant, instead of substituting a fallback", async () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      // The pre-fix on-disk state: a chunk whose stored heading is "".
      // Bypasses transformFile deliberately -- that seam is what now prevents
      // this state from ever being written again.
      store.saveDocument(
        { path: "legacy.md", title: "Legacy", summary: "", tags: [], hash: "stale" },
        [{ heading: "", content: "Contains the marker ZORZAL-4412 for lexical retrieval.", position: 0 }],
      );

      const search = new SearchDocuments(store, null, { k: 5, excludedStatuses: [] });
      const response = await search.execute({ query: "ZORZAL-4412" });

      const hit = response.results.find((r) => r.path === "legacy.md");
      expect(hit).toBeDefined();
      // Returned as stored. A non-empty value here means repair logic was added
      // at query time, which contradicts the reindex requirement.
      expect(hit!.section).toBe("");
    } finally {
      store.close();
    }
  });
});
