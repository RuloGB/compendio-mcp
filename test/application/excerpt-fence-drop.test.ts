import { describe, expect, it } from "vitest";
import { buildHarness, EXAMPLES_CONVENTION, EXCERPT_FENCE_DROP_DOCS } from "../helpers/build";

/**
 * `excerpt-fence-drop-generalization` fixture corpus (design.md D5, D9):
 * drives the fixture through `buildHarness` in-memory, following
 * `test/application/excerpt-window.test.ts`'s precedent — no CLI, no
 * `.compendio/`. The manual probe (`scripts/excerpt-fence-drop-probe.mjs`)
 * is the measurement; this file is what stops the fixture from rotting.
 */
describe("excerpt-fence-drop fixture — self-asserted preconditions", () => {
  it("all 5 documents index to exactly one chunk each", async () => {
    const harness = buildHarness(null, EXAMPLES_CONVENTION, EXCERPT_FENCE_DROP_DOCS);
    try {
      const report = await harness.index.execute();
      expect(report.indexed).toHaveLength(5);
      for (const doc of report.indexed) {
        expect(doc.chunks).toBe(1);
      }
    } finally {
      harness.close();
    }
  });

  it("the two *-crlf.md documents' stored chunk content contains CRLF", async () => {
    const harness = buildHarness(null, EXAMPLES_CONVENTION, EXCERPT_FENCE_DROP_DOCS);
    try {
      await harness.index.execute();
      for (const path of ["docs/tilde-fence-crlf.md", "docs/interior-backtick-fence-crlf.md"]) {
        const doc = harness.store.getDocumentByPath(path);
        expect(doc).not.toBeNull();
        const chunks = harness.store.getChunksByDocument(doc!.id);
        expect(chunks).toHaveLength(1);
        expect(chunks[0]!.content).toContain("\r\n");
      }
    } finally {
      harness.close();
    }
  });

  it("a ~~~ delimiter is present somewhere in the corpus", async () => {
    const harness = buildHarness(null, EXAMPLES_CONVENTION, EXCERPT_FENCE_DROP_DOCS);
    try {
      await harness.index.execute();
      const documents = harness.store.listDocuments();
      const hasTilde = documents.some((doc) =>
        harness.store
          .getChunksByDocument(doc.id)
          .some((chunk) => chunk.content.includes("~~~")),
      );
      expect(hasTilde).toBe(true);
    } finally {
      harness.close();
    }
  });
});

describe("Gate 1/2 end-to-end — search_docs excludes both fence styles from the excerpt", () => {
  it("a tilde-fenced block is absent from both the LF and CRLF documents' excerpts", async () => {
    const harness = buildHarness(null, EXAMPLES_CONVENTION, EXCERPT_FENCE_DROP_DOCS);
    try {
      await harness.index.execute();
      const response = await harness.search.execute({ query: "hypothetical configuration example", k: 5 });
      const tildeResults = response.results.filter((r) => r.path.startsWith("docs/tilde-fence"));
      expect(tildeResults).toHaveLength(2);
      for (const result of tildeResults) {
        expect(result.excerpt).toContain("hypothetical");
        expect(result.excerpt).not.toContain("~~~");
        expect(result.excerpt).not.toContain("docsDir");
      }
    } finally {
      harness.close();
    }
  });

  it("a backtick fence with an interior backtick is absent from both the LF and CRLF documents' excerpts", async () => {
    const harness = buildHarness(null, EXAMPLES_CONVENTION, EXCERPT_FENCE_DROP_DOCS);
    try {
      await harness.index.execute();
      const response = await harness.search.execute({ query: "quotes a backtick character", k: 5 });
      const interiorResults = response.results.filter((r) => r.path.startsWith("docs/interior-backtick-fence"));
      expect(interiorResults).toHaveLength(2);
      for (const result of interiorResults) {
        expect(result.excerpt).toContain("shell script snippet");
        expect(result.excerpt).not.toContain("backtick character on purpose");
        expect(result.excerpt).not.toContain("echo");
      }
    } finally {
      harness.close();
    }
  });

  it("the control fence (no interior backtick, no tilde) is also excluded, unaffected by the fix", async () => {
    const harness = buildHarness(null, EXAMPLES_CONVENTION, EXCERPT_FENCE_DROP_DOCS);
    try {
      await harness.index.execute();
      const response = await harness.search.execute({ query: "ordinary shell script snippet", k: 5 });
      const controlResult = response.results.find((r) => r.path === "docs/control-backtick-fence.md");
      expect(controlResult).toBeDefined();
      expect(controlResult!.excerpt).toContain("Opening prose paragraph");
      expect(controlResult!.excerpt).not.toContain("nothing unusual here");
    } finally {
      harness.close();
    }
  });
});
