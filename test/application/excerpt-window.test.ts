import { describe, expect, it } from "vitest";
import { LEAD_EXCERPT_CHARS } from "../../src/domain/excerpt";
import { flattenWithMap } from "../../src/domain/flatten-map";
import { buildHarness, EXAMPLES_CONVENTION, EXCERPT_WINDOW_DOCS } from "../helpers/build";

const WINDOW_MARKER = "MERIDIANO-4417";
const WINDOW_QUERY = "moisture sensor firmware";

const TRAP_MARKER = "TRAMONTANA-9182";
const TRAP_QUERY = "the windvane";

describe("excerpt-window fixture — self-asserted preconditions", () => {
  it("window.md: single chunk, marker offset and flattened length inside the designed range", async () => {
    const harness = buildHarness(null, EXAMPLES_CONVENTION, EXCERPT_WINDOW_DOCS);
    try {
      const report = await harness.index.execute();
      const doc = report.indexed.find((d) => d.path === "window.md");
      expect(doc).toBeDefined();
      expect(doc!.chunks).toBe(1);

      const indexed = harness.store.getDocumentByPath("window.md");
      expect(indexed).not.toBeNull();
      const chunks = harness.store.getChunksByDocument(indexed!.id);
      expect(chunks).toHaveLength(1);
      const raw = chunks[0]!.content;

      const flat = flattenWithMap(raw, true);
      const markerOffset = flat.text.indexOf(WINDOW_MARKER);
      expect(markerOffset).toBeGreaterThanOrEqual(1410);
      expect(markerOffset).toBeLessThanOrEqual(1480);
      expect(flat.text.length).toBeGreaterThanOrEqual(1550);
      expect(flat.text.length).toBeLessThanOrEqual(1650);
    } finally {
      harness.close();
    }
  });

  it("stopword-trap.md: 'the' before offset 100 (>= 20 occurrences), 'windvane' past offset 1400 (count 1)", async () => {
    const harness = buildHarness(null, EXAMPLES_CONVENTION, EXCERPT_WINDOW_DOCS);
    try {
      await harness.index.execute();
      const indexed = harness.store.getDocumentByPath("stopword-trap.md");
      expect(indexed).not.toBeNull();
      const chunks = harness.store.getChunksByDocument(indexed!.id);
      expect(chunks).toHaveLength(1);
      const raw = chunks[0]!.content;

      const flat = flattenWithMap(raw, true);
      const lower = flat.text.toLowerCase();
      const theMatches = lower.match(/\bthe\b/g) ?? [];
      expect(theMatches.length).toBeGreaterThanOrEqual(20);
      expect(lower.search(/\bthe\b/)).toBeLessThan(100);

      const windvaneMatches = lower.match(/windvane/g) ?? [];
      expect(windvaneMatches).toHaveLength(1);
      expect(lower.indexOf("windvane")).toBeGreaterThan(1400);

      // Gate 3 asserts the MARKER is present, and the marker sits before
      // "windvane" in the prose — so guarding only windvane's offset guards
      // the wrong string. If the marker itself drifted under
      // LEAD_EXCERPT_CHARS, a plain prefix excerpt would contain it and the
      // gate would pass without discriminating anything.
      expect(lower.indexOf(TRAP_MARKER.toLowerCase())).toBeGreaterThan(LEAD_EXCERPT_CHARS);
    } finally {
      harness.close();
    }
  });
});

// Gate 1 baseline (Phase 7, apply-progress.md): run against unmodified
// excerpt.ts, this exact assertion — marker absent, trailing ellipsis only
// — PASSED, proving the fixture is void-free and the gate can fail. That
// baseline run is what makes the inverted assertion below meaningful.
describe("Gate 1 — the window reaches the answer (inverted; real assertion)", () => {
  it("the rank-1 excerpt contains the marker verbatim, with a leading ellipsis and no trailing one", async () => {
    const harness = buildHarness(null, EXAMPLES_CONVENTION, EXCERPT_WINDOW_DOCS);
    try {
      await harness.index.execute();
      const response = await harness.search.execute({ query: WINDOW_QUERY, k: 5 });
      expect(response.results.length).toBeGreaterThan(0);
      const lead = response.results[0]!;
      expect(lead.path).toBe("window.md");
      expect(lead.excerpt).toContain(WINDOW_MARKER);
      // The window clamps to [200, 1600] on this fixture (design.md task
      // 9.1): a leading ellipsis (start > 0) and no trailing one (end
      // reaches the flattened chunk's end).
      expect(lead.excerpt.startsWith("…")).toBe(true);
      expect(lead.excerpt.endsWith("…")).toBe(false);
    } finally {
      harness.close();
    }
  });
});

describe("Gate 3 — the stopword trap", () => {
  it("the rank-1 excerpt contains the distinctive marker, not the early stopword's neighbourhood", async () => {
    const harness = buildHarness(null, EXAMPLES_CONVENTION, EXCERPT_WINDOW_DOCS);
    try {
      await harness.index.execute();
      const response = await harness.search.execute({ query: TRAP_QUERY, k: 5 });
      expect(response.results.length).toBeGreaterThan(0);
      const lead = response.results[0]!;
      expect(lead.path).toBe("stopword-trap.md");
      expect(lead.excerpt).toContain(TRAP_MARKER);
      // A first-hit implementation would centre on offset 0, where "the"
      // first occurs, and open with the document's opening words.
      expect(lead.excerpt.startsWith("The keeper checks the lamp")).toBe(false);
    } finally {
      harness.close();
    }
  });
});
