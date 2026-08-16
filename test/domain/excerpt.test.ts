import { describe, expect, it } from "vitest";
import { flattenWithMap } from "../../src/domain/flatten-map";
import {
  buildExcerpt,
  excerptBudget,
  LEAD_EXCERPT_CHARS,
  SUPPORTING_EXCERPT_CHARS,
} from "../../src/domain/excerpt";
import type { MatchSpan } from "../../src/domain/match-location";

describe("buildExcerpt", () => {
  it("drops heading lines and collapses whitespace", () => {
    const excerpt = buildExcerpt("### Duplicidad\n\nUn lead   se considera\nduplicado.");
    expect(excerpt).toBe("Un lead se considera duplicado.");
  });

  // es-frozen: "glosario.md" is the real frozen `ejemplos/` corpus filename;
  // this asserts the excerpt never leaks it, not a leftover translation.
  it("keeps link text and drops the URL", () => {
    const excerpt = buildExcerpt("Ver [el glosario](../glosario.md) del proyecto.");
    expect(excerpt).toContain("el glosario");
    expect(excerpt).not.toContain("glosario.md");
  });

  it("cuts long content at a word boundary with an ellipsis", () => {
    const excerpt = buildExcerpt(`${"palabra ".repeat(60)}final`, 100);
    expect(excerpt.length).toBeLessThanOrEqual(101);
    expect(excerpt.endsWith("…")).toBe(true);
  });

  it("falls back to the fenced content when stripping would empty the excerpt", () => {
    // A templates/examples section is all code. An empty excerpt would spend
    // the rank's budget on silence and, carrying no "…", would tell the agent
    // the result is complete.
    const excerpt = buildExcerpt("## Templates\n\n```markdown\ntype: functional\n```");
    expect(excerpt.length).toBeGreaterThan(0);
    expect(excerpt).toContain("type: functional");
  });

  it("still prefers prose over fenced content when both are present", () => {
    const excerpt = buildExcerpt("Regla vigente.\n\n```js\nconst ruido = 1;\n```");
    expect(excerpt).toBe("Regla vigente.");
  });

  it("leaves no ellipsis when the content fits, so '…' marks truncation", () => {
    // The tool contract tells agents to treat a trailing "…" as the signal to
    // call read_doc, so an untruncated excerpt must never carry one.
    expect(buildExcerpt("Corto y completo.").endsWith("…")).toBe(false);
  });
});

/**
 * Builds `wordCount` space-separated words (no markdown syntax at all), so
 * `flattenWithMap` is the identity transform aside from the final trim —
 * raw offsets and flattened offsets coincide, which keeps these tests'
 * hand-computed expectations legible.
 */
function words(count: number, word = "filler"): string {
  return Array.from({ length: count }, () => word).join(" ");
}

describe("buildExcerpt — window centred on a matched span (Decision 5/6)", () => {
  it("centres the window on the span, with an ellipsis at both truncated edges", () => {
    const before = words(120); // ~840 chars
    const marker = "TARGETMARKER";
    const after = words(120);
    const text = `${before} ${marker} ${after}`;
    const start = before.length + 1;
    const spans: MatchSpan[] = [{ start, end: start + marker.length, term: "targetmarker" }];

    const excerpt = buildExcerpt(text, 100, spans);

    expect(excerpt).toContain(marker);
    expect(excerpt.startsWith("…")).toBe(true);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(102);
  });

  it("clamps to the start: a match near offset 0 carries no leading ellipsis", () => {
    const marker = "EARLYMARK";
    const text = `${marker} ${words(300)}`;
    const spans: MatchSpan[] = [{ start: 0, end: marker.length, term: "earlymark" }];

    const excerpt = buildExcerpt(text, 100, spans);

    expect(excerpt).toContain(marker);
    expect(excerpt.startsWith("…")).toBe(false);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(101);
  });

  it("clamps to the end: a match near the end carries no trailing ellipsis", () => {
    const marker = "LATEMARK";
    const text = `${words(300)} ${marker}`;
    const start = text.length - marker.length;
    const spans: MatchSpan[] = [{ start, end: text.length, term: "latemark" }];

    const excerpt = buildExcerpt(text, 100, spans);

    expect(excerpt).toContain(marker);
    expect(excerpt.startsWith("…")).toBe(true);
    expect(excerpt.endsWith("…")).toBe(false);
    expect(excerpt.length).toBeLessThanOrEqual(101);
  });

  it("text shorter than the budget carries neither ellipsis, regardless of spans", () => {
    const text = "A short sentence that easily fits the budget.";
    const spans: MatchSpan[] = [{ start: 2, end: 7, term: "short" }];

    const excerpt = buildExcerpt(text, 1400, spans);

    expect(excerpt).toBe(text);
    expect(excerpt.startsWith("…")).toBe(false);
    expect(excerpt.endsWith("…")).toBe(false);
  });

  it("empty spans is byte-identical to the no-spans prefix path", () => {
    const text = `${words(400)} tail`;
    expect(buildExcerpt(text, 200, [])).toBe(buildExcerpt(text, 200));
  });

  // Gate 5: the empty-spans path IS the vector-only path (design.md
  // Decision 7) — a chunk the vector leg found alone has no lexical match
  // to locate, so it must still produce a well-formed prefix excerpt.
  it("Gate 5 unit form: empty spans over long content is a trailing-ellipsis-only prefix", () => {
    const text = `${words(2000)} tail`;
    const excerpt = buildExcerpt(text, LEAD_EXCERPT_CHARS, []);
    expect(excerpt.length).toBeLessThanOrEqual(LEAD_EXCERPT_CHARS + 1);
    expect(excerpt.startsWith("…")).toBe(false);
    expect(excerpt.endsWith("…")).toBe(true);
  });

  it("never exceeds budget + 2 across a spread of marker positions", () => {
    const budget = 150;
    for (const position of [50, 400, 900, 1500, 1900]) {
      const marker = "M".repeat(8);
      const before = words(Math.floor(position / 7));
      const after = words(300);
      const text = `${before} ${marker} ${after}`;
      const start = before.length + 1;
      const spans: MatchSpan[] = [{ start, end: start + marker.length, term: "m" }];

      const excerpt = buildExcerpt(text, budget, spans);
      expect(excerpt.length).toBeLessThanOrEqual(budget + 2);
    }
  });

  it("snap-revert guard: word snapping never cuts into the matched span", () => {
    // A single unbroken 40-character token (no internal spaces) as the
    // match, positioned so the naive clamp window barely contains it plus
    // a few characters of context on each side. If trailing word-snapping
    // ignored the guard, it would retreat past the only nearby space —
    // landing INSIDE the token — and truncate it. The guard must revert
    // that snap instead, keeping the whole token in the excerpt.
    const token = "T".repeat(40);
    const before = words(200);
    const after = words(200);
    const text = `${before} ${token} ${after}`;
    const start = before.length + 1;
    const spans: MatchSpan[] = [{ start, end: start + token.length, term: "t" }];

    const excerpt = buildExcerpt(text, 50, spans);

    expect(excerpt).toContain(token);
  });

  it("matches flattenWithMap's flattened text when the markdown needs stripping", () => {
    const marker = "STRIPMARK";
    const markdown =
      "# Heading one should be dropped\n\n" +
      `${words(150)} \`code\` and *emphasis* before ${marker} and ` +
      `[a link](http://example.test) after ${words(150)}`;
    const flat = flattenWithMap(markdown, true);
    const rawStart = markdown.indexOf(marker);
    const spans: MatchSpan[] = [{ start: rawStart, end: rawStart + marker.length, term: "stripmark" }];

    const excerpt = buildExcerpt(markdown, 100, spans);

    expect(excerpt).toContain(marker);
    // Every character in the excerpt (aside from the ellipses) must come
    // from the flattened text — proof that spans were mapped through
    // flattenWithMap/toFlatOffset rather than sliced from raw markdown.
    const stripped = excerpt.replace(/…/g, "");
    expect(flat.text).toContain(stripped);
  });
});

describe("buildExcerpt — fence-aware S1 (excerpt-fence-aware-flatten, design.md D1-D5)", () => {
  it("falls back to fenced content that now includes a retained fence-interior heading-pattern line", () => {
    // Traces spec scenario "A fence-interior heading-pattern line is
    // retained when the excluded pass is empty" — the chunk is entirely one
    // fenced block, so the fenced-blocks-excluded pass yields no text and
    // the fallback (excerpt.ts:68) fires.
    const excerpt = buildExcerpt("```python\n# a python comment\nprint('hi')\n```");
    expect(excerpt).toContain("a python comment");
  });

  it("D3: a span on a retained fence-interior heading-pattern line becomes locatable and survives filtering", () => {
    // Uses a tilde fence, which is outside S2's backtick-only regex
    // (exploration.md §0, row 3) — this isolates D3's map-locatability claim
    // from S2's fence-drop behaviour, which the Gate 2 case below covers
    // separately. Before this change, S1 unconditionally stripped every
    // heading-pattern line, so the marker's raw offset never survived
    // flattening: toFlatOffset resolved it forward past the whole fence,
    // collapsing the span to end === start, and it was filtered out at
    // excerpt.ts:98 — the excerpt would fall through to prefixExcerpt and
    // never contain the marker.
    const marker = "TARGETMARKER";
    const before = words(150);
    const after = words(150);
    const markdown = `${before}\n\n~~~\n# ${marker} inside a tilde fence\n~~~\n\n${after}`;
    const rawStart = markdown.indexOf(marker);
    const spans: MatchSpan[] = [{ start: rawStart, end: rawStart + marker.length, term: marker.toLowerCase() }];

    const excerpt = buildExcerpt(markdown, 60, spans);

    expect(excerpt).toContain(marker);
  });

  it("Gate 2: a fence holding a retained heading-pattern line is still recognized and dropped by the excluded pass", () => {
    // Traces spec scenario of the same name. dropFencedBlocks: true must be
    // byte-identical before and after this change — proof that delimiter
    // lines survived S1 for S2 to still recognize and drop the whole fence.
    // dropFencedBlocks: false (S2 skipped) now surfaces the retained line's
    // own text, which used to be silently dropped by S1 regardless of S2.
    const markdown = "Prose before.\n\n```python\n# a python comment\nprint('hi')\n```\n\nProse after.";

    const withFencesExcluded = flattenWithMap(markdown, true).text;
    const withFencesIncluded = flattenWithMap(markdown, false).text;

    expect(withFencesExcluded).toBe("Prose before. Prose after.");
    expect(withFencesIncluded).toContain("a python comment");
  });

  // Gate 4 (measurement-only, design.md D5/M1): a fence-interior
  // heading-pattern line carrying an ODD number of backticks injects a
  // stray backtick into the string S2 scans, which can break
  // `/```[^`]*```/g` where it previously matched cleanly. Decision: measure
  // it, record the outcome, do not fix it (fixing it means designing and
  // CRLF-verifying a second regex for S2, which is out of scope). There is
  // no required pass/fail outcome here — the only failing outcome is not
  // measuring it.
  //
  // Measured verbatim, both directions, on 2026-08-16 (git-stash comparison
  // against the pre-fix `stripHeadingLines`):
  //
  //   BEFORE (fence-blind S1 — the `#` line, and its stray backtick, never
  //   reached S2 at all):
  //     dropFencedBlocks: true  -> "Before text. After text."
  //     dropFencedBlocks: false -> "Before text. js const x = 1; After text."
  //
  //   AFTER (fence-aware S1 — the retained line's lone backtick makes three
  //   backticks appear between the fence's two real delimiters, an odd
  //   count `/```[^`]*```/g` cannot pair, so S2 makes ZERO replacements and
  //   the accepted outcome fires: the whole fence leaks into BOTH passes,
  //   identically):
  //     dropFencedBlocks: true  -> "Before text. js # a comment with an odd backtick const x = 1; After text."
  //     dropFencedBlocks: false -> "Before text. js # a comment with an odd backtick const x = 1; After text."
  //
  //   AFTER `excerpt-fence-drop-generalization` (S2 crosses the interior
  //   backtick and pairs on the nearest real closer):
  //     dropFencedBlocks: true  -> "Before text. After text."
  //     dropFencedBlocks: false -> "Before text. js # a comment with an odd backtick const x = 1; After text."
  //
  // DO NOT "REPAIR" THIS BY REVERTING flatten-map.ts:35. The equality this
  // test used to assert WAS the defect (S2 made zero replacements). Its
  // divergence is the fix working. See excerpt-fence-drop-generalization.
  it("the interior-backtick fence is dropped from the excluded pass (was: the pinned defect)", () => {
    const markdown =
      "Before text.\n\n```js\n# a comment with an odd ` backtick\nconst x = 1;\n```\n\nAfter text.";

    const withFencesExcluded = flattenWithMap(markdown, true).text;
    const withFencesIncluded = flattenWithMap(markdown, false).text;

    expect(withFencesExcluded).toBe("Before text. After text.");
    // The two passes must now DIVERGE. Asserted separately from the toBe
    // above because equality was the defect's signature, and this is the
    // line a future reader is most likely to try to "repair".
    expect(withFencesExcluded).not.toBe(withFencesIncluded);
    for (const leaked of ["js", "# a comment with an odd", "const x = 1;"]) {
      expect(withFencesExcluded).not.toContain(leaked);
    }
  });
});

describe("buildExcerpt — S2 fence drop generalization (excerpt-fence-drop-generalization, design.md D2-D7)", () => {
  // Traces spec scenario "A tilde-fenced block is excluded from the lead
  // excerpt": before this change S2's regex was spelled entirely in
  // backticks, so a `~~~`-delimited fence was never recognized in either
  // pass.
  it("drops a tilde-delimited fence from the excluded pass, keeping the prose", () => {
    const markdown =
      "Opening prose paragraph.\n\n~~~json\n{ \"docsDir\": [\"docs\"] }\n~~~\n\nClosing prose paragraph.";

    const withFencesExcluded = flattenWithMap(markdown, true).text;

    expect(withFencesExcluded).toBe("Opening prose paragraph. Closing prose paragraph.");
    expect(withFencesExcluded).not.toContain("~~~");
    expect(withFencesExcluded).not.toContain("docsDir");
  });

  // Traces spec scenario "A CRLF-encoded tilde fence is excluded identically
  // to an LF-encoded one" — neither S1's line-splitting nor S2's new regex
  // carries an anchor, so a `\r` left on a kept line is harmless (CLAUDE.md's
  // HEADING_LINE house rule: anchor-free and prefix-only, always).
  it("drops a CRLF-encoded tilde-delimited fence identically to the LF case", () => {
    const markdown =
      "Opening prose paragraph.\r\n\r\n~~~json\r\n{ \"docsDir\": [\"docs\"] }\r\n~~~\r\n\r\nClosing prose paragraph.";

    const withFencesExcluded = flattenWithMap(markdown, true).text;

    expect(withFencesExcluded).toBe("Opening prose paragraph. Closing prose paragraph.");
    expect(withFencesExcluded).not.toContain("~~~");
    expect(withFencesExcluded).not.toContain("docsDir");
  });
});

describe("excerptBudget", () => {
  it("gives the lead fragment room to answer and the rest room to signpost", () => {
    expect(excerptBudget(0)).toBe(LEAD_EXCERPT_CHARS);
    expect(excerptBudget(1)).toBe(SUPPORTING_EXCERPT_CHARS);
    expect(excerptBudget(4)).toBe(SUPPORTING_EXCERPT_CHARS);
  });

  it("keeps the lead budget well clear of the supporting one", () => {
    // The whole point of grading is that one fragment can carry an answer.
    // If these ever converge, the policy has silently become a uniform cap.
    expect(LEAD_EXCERPT_CHARS).toBeGreaterThan(SUPPORTING_EXCERPT_CHARS * 5);
  });
});
