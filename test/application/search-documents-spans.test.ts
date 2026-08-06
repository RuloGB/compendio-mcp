import { describe, expect, it } from "vitest";
import { buildExcerpt, SUPPORTING_EXCERPT_CHARS } from "../../src/domain/excerpt";
import { SearchDocuments } from "../../src/application/search-documents";
import { SqliteIndexStore } from "../../src/infrastructure/sqlite/sqlite-index-store";

function seedDoc(store: SqliteIndexStore, path: string, content: string): void {
  store.saveDocument(
    { path, title: path, summary: "r", tags: [], hash: path },
    [{ heading: "H", content, position: 0 }],
  );
}

const FILLER = "word ".repeat(320); // ~1600 chars, past LEAD_EXCERPT_CHARS (1400)

// design.md Decision 7: spans are computed for rank 0 only. This exercises
// SearchDocuments' own wiring directly (not through buildExcerpt's unit
// tests), so a regression at the call site — spans never passed at all, or
// passed for every rank — fails here even if buildExcerpt itself is correct.
describe("SearchDocuments — spans are computed for rank 0 only (Decision 7)", () => {
  it("the lead result's excerpt centres on a match past its own budget", async () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      seedDoc(store, "lead.md", `${FILLER}gribblewhorten appears only here, deep in the document.`);

      const search = new SearchDocuments(store, null, { k: 10, excludedStatuses: [] });
      const response = await search.execute({ query: "gribblewhorten", k: 10 });

      expect(response.results.length).toBe(1);
      const lead = response.results[0]!;
      expect(lead.path).toBe("lead.md");
      expect(lead.excerpt).toContain("gribblewhorten");
    } finally {
      store.close();
    }
  });

  it("a supporting (non-rank-0) result's excerpt stays a start-anchored prefix, never a window", async () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      // Short document: always ranks 1 for "zulu" under BM25's length
      // normalization against the much longer supporting.md below.
      seedDoc(store, "lead.md", "zulu appears here in a very short document.");

      // Long document: "zulu" occurs well past SUPPORTING_EXCERPT_CHARS
      // (120). If spans were (incorrectly) computed for this non-lead
      // result too, its excerpt would centre on "zulu" instead of staying
      // a start-anchored prefix.
      const supportingContent = `${FILLER}zulu appears only here, deep in the document.`;
      seedDoc(store, "supporting.md", supportingContent);

      const search = new SearchDocuments(store, null, { k: 10, excludedStatuses: [] });
      const response = await search.execute({ query: "zulu", k: 10 });

      expect(response.results.length).toBeGreaterThanOrEqual(2);
      const lead = response.results[0]!;
      const supporting = response.results.find((r) => r.path === "supporting.md");
      expect(lead.path).toBe("lead.md");
      expect(supporting).toBeDefined();

      // Byte-identical to the empty-spans prefix path — proof no window
      // was computed for a non-lead result.
      const expectedPrefix = buildExcerpt(supportingContent, SUPPORTING_EXCERPT_CHARS, []);
      expect(supporting!.excerpt).toBe(expectedPrefix);
      expect(supporting!.excerpt).not.toContain("zulu");
    } finally {
      store.close();
    }
  });

  // `tokenizeQuery` hoisted once per search rather than once per result is a
  // performance property, not an observable-behaviour one — tokenizeQuery is
  // pure, so hoisting changes call count, not results. That is verified by
  // reading `search-documents.ts` (one `tokenizeQuery(query.query)` call
  // outside the `for` loop), not by a runtime assertion here; a test
  // asserting a call count would need to widen SearchDocuments' surface
  // just to make an implementation detail spyable, which this codebase does
  // not do for other pure-function call sites either.
});
