import { describe, expect, it } from "vitest";
import {
  foldForMatch,
  locateSpans,
  selectMatchCentre,
  tokenizeQuery,
  type MatchSpan,
} from "../../src/domain/match-location";

describe("tokenizeQuery", () => {
  // Carries `toFtsQuery`'s regex verbatim (sqlite-index-store.ts:430-433):
  // split on runs of non-letter/non-number, trim, drop empties. No
  // lowercasing, no folding — the FTS5 MATCH string must not change.
  function referenceTokenize(query: string): string[] {
    return query
      .split(/[^\p{L}\p{N}]+/u)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  }

  const cases = [
    "email duplicado",
    "¿Cuándo se considera duplicado un lead?",
    "PostgreSQL vs MongoDB",
    "   leading and trailing   spaces   ",
    "hyphen-ated word",
    "",
    "   ",
    "one",
    "número 123 con dígitos",
    "the windvane",
  ];

  it.each(cases)("matches toFtsQuery's tokenization for %j", (query) => {
    expect(tokenizeQuery(query)).toEqual(referenceTokenize(query));
  });

  it("does not lowercase", () => {
    expect(tokenizeQuery("PostgreSQL MongoDB")).toEqual(["PostgreSQL", "MongoDB"]);
  });

  it("does not fold diacritics", () => {
    expect(tokenizeQuery("café")).toEqual(["café"]);
  });
});

describe("foldForMatch", () => {
  it("lowercases", () => {
    expect(foldForMatch("PostgreSQL")).toBe("postgresql");
  });

  it("strips diacritics from the ejemplos/ corpus alphabet", () => {
    const cases: [string, string][] = [
      ["café", "cafe"],
      ["dirección", "direccion"],
      ["duplicación", "duplicacion"],
      ["número", "numero"],
      ["mañana", "manana"],
      ["área", "area"],
    ];
    for (const [input, expected] of cases) {
      expect(foldForMatch(input)).toBe(expected);
    }
  });

  it("is idempotent on already-folded text", () => {
    expect(foldForMatch("cafe")).toBe("cafe");
  });
});

describe("locateSpans", () => {
  it("returns no spans for an empty term list", () => {
    expect(locateSpans("some raw text", [])).toEqual([]);
  });

  it("returns no spans when nothing matches", () => {
    expect(locateSpans("some raw text", ["absent"])).toEqual([]);
  });

  it("finds a single occurrence in raw coordinates", () => {
    const raw = "the quick brown fox";
    const spans = locateSpans(raw, ["quick"]);
    expect(spans).toEqual([{ start: 4, end: 9, term: "quick" }]);
    expect(raw.slice(spans[0]!.start, spans[0]!.end)).toBe("quick");
  });

  it("finds repeated occurrences of the same term, ascending", () => {
    const raw = "the the the fox";
    const spans = locateSpans(raw, ["the"]);
    expect(spans.map((s) => s.start)).toEqual([0, 4, 8]);
    for (const span of spans) {
      expect(raw.slice(span.start, span.end)).toBe("the");
    }
  });

  it("finds overlapping terms from different query terms", () => {
    // "theta" contains "the" as a substring — both should be found and
    // returned in ascending raw-offset order.
    const raw = "theta value";
    const spans = locateSpans(raw, ["the", "theta"]);
    expect(spans.sort((a, b) => a.start - b.start || a.end - b.end)).toEqual(
      [
        { start: 0, end: 3, term: "the" },
        { start: 0, end: 5, term: "theta" },
      ].sort((a, b) => a.start - b.start || a.end - b.end),
    );
  });

  it("locates a term under a case- and diacritic-fold", () => {
    const raw = "El correo es DUPLICADO cuando coincide.";
    const spans = locateSpans(raw, ["duplicado"]);
    expect(spans).toHaveLength(1);
    expect(raw.slice(spans[0]!.start, spans[0]!.end)).toBe("DUPLICADO");
  });

  it("locates an accented raw occurrence via an unaccented term", () => {
    const raw = "La dirección de correo es obligatoria.";
    const spans = locateSpans(raw, ["direccion"]);
    expect(spans).toHaveLength(1);
    expect(raw.slice(spans[0]!.start, spans[0]!.end)).toBe("dirección");
  });

  it("locates every distinct term across the text, ascending overall", () => {
    const raw = "alpha beta gamma alpha";
    const spans = locateSpans(raw, ["gamma", "alpha"]);
    expect(spans.map((s) => `${s.term}@${s.start}`)).toEqual([
      "alpha@0",
      "gamma@11",
      "alpha@17",
    ]);
  });
});

describe("selectMatchCentre", () => {
  it("returns null when there are no spans", () => {
    expect(selectMatchCentre([], 1400)).toBeNull();
  });

  // Gate 3's minimal form: a high-frequency term occurs early, a rare
  // distinctive term occurs once, late. A first-hit implementation would
  // centre on offset 0; weighted distinct-term coverage must not.
  it("prefers a single rare late term over a frequent early term (stopword trap, minimal form)", () => {
    const spans: MatchSpan[] = [
      { start: 0, end: 3, term: "the" },
      { start: 10, end: 13, term: "the" },
      { start: 500, end: 504, term: "rare" },
    ];
    expect(selectMatchCentre(spans, 100)).toBe(502);
  });

  it("prefers a cluster of two distinct late terms over one distinct early term", () => {
    const spans: MatchSpan[] = [
      { start: 0, end: 5, term: "alpha" },
      { start: 500, end: 504, term: "beta" },
      { start: 520, end: 525, term: "gamma" },
    ];
    expect(selectMatchCentre(spans, 200)).toBe(512);
  });

  it("scattered singletons: the rarest term (by in-chunk frequency) wins", () => {
    const spans: MatchSpan[] = [
      { start: 0, end: 1, term: "a" },
      { start: 200, end: 201, term: "a" },
      { start: 400, end: 401, term: "a" },
      { start: 600, end: 601, term: "a" },
      { start: 800, end: 801, term: "a" },
      { start: 1000, end: 1001, term: "b" },
    ];
    expect(selectMatchCentre(spans, 50)).toBe(1000);
  });

  it("tie-break 1: equal weight, longer distinct term wins", () => {
    const spans: MatchSpan[] = [
      { start: 100, end: 103, term: "cat" },
      { start: 500, end: 508, term: "elephant" },
    ];
    expect(selectMatchCentre(spans, 50)).toBe(504);
  });

  it("tie-break 2: equal weight and equal length, earliest start wins", () => {
    const spans: MatchSpan[] = [
      { start: 900, end: 905, term: "fghij" },
      { start: 50, end: 55, term: "abcde" },
    ];
    expect(selectMatchCentre(spans, 50)).toBe(52);
  });

  it("is deterministic across input order (sorts internally by start)", () => {
    const forward: MatchSpan[] = [
      { start: 0, end: 3, term: "the" },
      { start: 10, end: 13, term: "the" },
      { start: 500, end: 504, term: "rare" },
    ];
    const reversed = [...forward].reverse();
    expect(selectMatchCentre(reversed, 100)).toBe(selectMatchCentre(forward, 100));
  });
});
