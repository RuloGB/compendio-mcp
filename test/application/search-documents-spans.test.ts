import { describe, expect, it } from "vitest";
import { buildExcerpt, SUPPORTING_EXCERPT_CHARS } from "../../src/domain/excerpt";
import { locateSpans, tokenizeQuery } from "../../src/domain/match-location";
import { SearchDocuments } from "../../src/application/search-documents";
import { SqliteIndexStore } from "../../src/infrastructure/sqlite/sqlite-index-store";

function seedDoc(store: SqliteIndexStore, path: string, content: string): void {
  store.saveDocument(
    { path, title: path, summary: "r", tags: [], hash: path },
    [{ heading: "H", content, position: 0 }],
  );
}

const FILLER = "word ".repeat(320); // ~1600 chars, past LEAD_EXCERPT_CHARS (1400)

// supporting-excerpt-anchoring design.md Decision 1: spans are computed for
// EVERY rank, reversing the ancestor `2026-08-06-match-centred-excerpt`
// design.md Decision 7 (rank 0 only). This exercises SearchDocuments' own
// wiring directly (not through buildExcerpt's unit tests), so a regression
// at the call site — spans never passed at all, or passed only for rank 0 —
// fails here even if buildExcerpt itself is correct.
describe("SearchDocuments — spans are computed for every rank", () => {
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

  it("a supporting (non-rank-0) result's excerpt centres on the match, not a start-anchored prefix", async () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      // Short document: always ranks 1 for "zulu" under BM25's length
      // normalization against the much longer supporting.md below.
      seedDoc(store, "lead.md", "zulu appears here in a very short document.");

      // Long document: "zulu" occurs well past SUPPORTING_EXCERPT_CHARS
      // (120). Before this change a non-lead result's excerpt was a
      // start-anchored prefix regardless of where the match sat; after it,
      // this fragment's window centres on "zulu" instead.
      const supportingContent = `${FILLER}zulu appears only here, deep in the document.`;
      seedDoc(store, "supporting.md", supportingContent);

      const search = new SearchDocuments(store, null, { k: 10, excludedStatuses: [] });
      const response = await search.execute({ query: "zulu", k: 10 });

      expect(response.results.length).toBeGreaterThanOrEqual(2);
      const lead = response.results[0]!;
      const supporting = response.results.find((r) => r.path === "supporting.md");
      expect(lead.path).toBe("lead.md");
      expect(supporting).toBeDefined();

      expect(supporting!.excerpt).toContain("zulu");

      // Byte-identical to the windowed path, centred on the same span the
      // production code locates — the inverted counterpart of the old
      // byte-identity-with-prefix assertion.
      const expectedWindow = buildExcerpt(
        supportingContent,
        SUPPORTING_EXCERPT_CHARS,
        locateSpans(supportingContent, tokenizeQuery("zulu")),
      );
      expect(supporting!.excerpt).toBe(expectedWindow);

      // Kept alive as the old reference: a regression back to a
      // start-anchored prefix would make this fail.
      expect(supporting!.excerpt).not.toBe(buildExcerpt(supportingContent, SUPPORTING_EXCERPT_CHARS, []));

      // "zulu" sits near the end of a ~1644-character flattened string, so
      // `computeWindow`'s `start` clamps to `maxStart` (> 0) — the leading
      // ellipsis is deterministic on this fixture. The trailing edge is
      // deliberately not asserted here: on this fixture the window ends at
      // the text's own end, and pinning that would duplicate what
      // `excerpt.test.ts`'s Decision-5 unit tests already own.
      expect(supporting!.excerpt.startsWith("…")).toBe(true);
      expect(supporting!.excerpt.length).toBeLessThanOrEqual(SUPPORTING_EXCERPT_CHARS + 2);
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

// New coverage for `supporting-excerpt-anchoring`'s three ADDED/MODIFIED
// spec scenarios (design.md Decision 7). Placed in a new `describe` inside
// this same file — an in-memory `SqliteIndexStore` via `seedDoc` needs no
// corpus fixture — rather than a new file, so the file count and this
// change's blast-radius signal stay checkable (see design.md Decision 7 /
// tasks.md Gate D amendment: exactly 2 files with CHANGED existing
// assertions; this describe is additions only).
describe("supporting-excerpt-anchoring — new spec scenarios", () => {
  it("a supporting fragment centred away from both edges carries both ellipses within its own budget", async () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      seedDoc(store, "lead.md", "xylophone appears here in a very short document.");

      // "xylophone" sits well past offset 120 (past FILLER), with a long
      // enough tail after it that a centred 120-char window reaches
      // neither edge of the flattened text.
      const supportingContent =
        `${FILLER}xylophone is mentioned exactly once, right here in the middle of a chunk ` +
        "that keeps going for a good while after this point, so a centred window never " +
        "reaches either edge of the flattened text, however it is placed.";
      seedDoc(store, "supporting.md", supportingContent);

      const search = new SearchDocuments(store, null, { k: 10, excludedStatuses: [] });
      const response = await search.execute({ query: "xylophone", k: 10 });

      const supporting = response.results.find((r) => r.path === "supporting.md");
      expect(supporting).toBeDefined();
      // Red pre-change: a start-anchored prefix never carries a leading "…".
      expect(supporting!.excerpt.startsWith("…")).toBe(true);
      expect(supporting!.excerpt.endsWith("…")).toBe(true);
      expect(supporting!.excerpt.length).toBeLessThanOrEqual(SUPPORTING_EXCERPT_CHARS + 2);
    } finally {
      store.close();
    }
  });

  it("the same preference for the distinctive term over an early high-frequency neighbourhood holds for a supporting fragment", async () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      seedDoc(store, "lead.md", "block quetzal both appear here in a very short lead document.");

      // "block" clusters 20 times right at the start (offset 0); "quetzal"
      // occurs exactly once, well past it. Both candidate windows fit
      // within SUPPORTING_EXCERPT_CHARS (120) on their own — the choice
      // between them is the in-chunk-IDF preference `selectMatchCentre`
      // already applies at rank 0 (see excerpt-window.test.ts's Gate 3),
      // now reaching a supporting rank too.
      const supportingContent =
        "block ".repeat(20) + // 120 chars of the high-frequency term
        "word ".repeat(40) + // 200-char neutral gap: wide enough that no window
        // fitting SUPPORTING_EXCERPT_CHARS can straddle both clusters at once
        "quetzal appears exactly once, deep in this chunk. " +
        "word ".repeat(20); // neutral tail
      seedDoc(store, "supporting.md", supportingContent);

      const search = new SearchDocuments(store, null, { k: 10, excludedStatuses: [] });
      const response = await search.execute({ query: "block quetzal", k: 10 });

      const supporting = response.results.find((r) => r.path === "supporting.md");
      expect(supporting).toBeDefined();
      // Red pre-change: a start-anchored prefix always opens on the "block"
      // cluster, never on "quetzal", which sits ~220 chars in.
      expect(supporting!.excerpt).toContain("quetzal");
      expect(supporting!.excerpt).not.toContain("block");
    } finally {
      store.close();
    }
  });

  it("a term present only in a stripped heading is treated as unreachable, even at a supporting rank", async () => {
    const store = new SqliteIndexStore(":memory:");
    const term = "zibbowatt";
    try {
      seedDoc(store, "lead.md", `${term} appears here in a very short lead document.`);

      // Control: the term sits in ordinary body text, past the supporting
      // budget — locatable once flattened, so the excerpt should window on
      // it. Built so THIS assertion can fail: red pre-change, since a
      // start-anchored prefix never reaches past offset 120 either.
      const controlContent = `${FILLER}${term} also appears here, in an ordinary paragraph, past the supporting budget.`;
      seedDoc(store, "control.md", controlContent);

      // Subject: the ONLY occurrence sits on a markdown heading line inside
      // the chunk's raw content, which `stripHeadingLines` removes before
      // any excerpt is built. Present in `chunk.content`, absent from the
      // flattened text `buildExcerpt` actually searches — unreachable, not
      // merely far away. Green in BOTH tree states: this pins the fallback
      // rather than discriminating alone (design.md Decision 7).
      const subjectContent =
        `## Section about ${term}\n${FILLER}The body below this heading never repeats the term.`;
      seedDoc(store, "subject.md", subjectContent);

      const search = new SearchDocuments(store, null, { k: 10, excludedStatuses: [] });
      const response = await search.execute({ query: term, k: 10 });

      const control = response.results.find((r) => r.path === "control.md");
      const subject = response.results.find((r) => r.path === "subject.md");
      expect(control).toBeDefined();
      expect(subject).toBeDefined();

      expect(control!.excerpt).toContain(term);

      expect(subject!.excerpt).not.toContain(term);
      expect(subject!.excerpt.startsWith("…")).toBe(false);
    } finally {
      store.close();
    }
  });
});
