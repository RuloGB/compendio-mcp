# Exploration — generalizing the fence drop for `search_docs` excerpts (`~~~` and interior backticks)

**Change**: `excerpt-fence-drop-generalization`
**Date**: 2026-08-16
**Phase**: `sdd-explore`
**Artifact store**: openspec
**Status**: done — ready for proposal

## Origin

Two coupled, previously-recorded open items, both inside the S2 step of `flattenWithMap`
(`src/domain/flatten-map.ts`), the excerpt-building half of `buildExcerpt` (`src/domain/excerpt.ts`):

1. `openspec/changes/archive/2026-08-15-excerpt-fence-aware-flatten/exploration.md`, section 0, row 3
   (MEASURED): S2's `` /```[^`]*```/g `` never recognizes `~~~` fences at all — a tilde-fenced block
   is never dropped from an excerpt, in either `dropFencedBlocks` pass, because the regex only looks
   for backtick runs.
2. That same change's design.md Decision 5 (D5): S2's regex cannot pair a fence whose interior
   contains a literal backtick — normal in documentation *about* markdown (a Python/shell comment
   containing a backtick, an inline-code example inside a fenced block). D5 measured this on this
   repo's own corpus (0 live instances at the time) and deliberately recorded the risk instead of
   fixing it, because fixing it "means designing and CRLF-verifying a second regex for S2" — out of
   scope for that change.

Both items live in `CLAUDE.md`'s `excerpt-fence-aware-flatten` bullet, in the same paragraph, by design
(the previous cycle's own words: "recording it in the same greppable sentence as the S2 follow-up… is
the point").

## Evidence status

The exploration sub-agent ran without a `Bash` tool, so nothing in sections 1-7 was executed — every
claim is static analysis and hand-traced execution against the real source
(`src/domain/flatten-map.ts`, `src/domain/split-text.ts`, `src/domain/excerpt.ts`,
`test/domain/flatten-map.test.ts`, `test/domain/excerpt.test.ts`), and is labeled INFERRED unless
noted. This is the same evidence posture the archived `excerpt-fence-aware-flatten` exploration
started from, before its orchestrator ran a probe against `dist/`.

**Section 8 (Measured addendum) was added by the orchestrator after the sub-agent returned** and
carries the executed results for the recommendation's two load-bearing claims. Read it before trusting
any number in sections 1-7.

---

## 1. Exact blast radius

### 1a. Which excerpt paths are affected

`dropFencedBlocks` is set in exactly one place — `buildExcerpt` (`src/domain/excerpt.ts:61,68`):

```ts
let flat = flattenWithMap(markdown, true);   // always tried first
if (flat.text.length === 0) flat = flattenWithMap(markdown, false); // fallback only
```

There is no other call site of `flattenWithMap` and no other place `dropFencedBlocks` is threaded from.
`buildExcerpt` itself has exactly one production caller, `SearchDocuments.execute`
(`src/application/search-documents.ts:128`):

```ts
excerpt: buildExcerpt(chunk.content, excerptBudget(rank), spans),
```

**Both the lead (rank 0) and every supporting result call the identical `buildExcerpt` with the identical
`dropFencedBlocks: true`-first policy.** Rank only changes `maxChars` (`excerptBudget(rank)`: 1400 for
rank 0, 120 otherwise, `src/domain/excerpt.ts:35-37`) and whether spans are located (`spans` only
non-empty for rank 0, `search-documents.ts:119-123`) — it does **not** change flattening behaviour.
So the defect is not lead-only or supporting-only: it affects every result at every rank, identically,
in whichever of the two flattening passes actually produces the returned text (`true` unless it comes
back empty).

### 1b. What a user sees today — concrete before/after

Take a realistic project doc mixing prose with a tilde-fenced example (this project's own
`compendio.config.json` convention documented with a fenced snippet — plausible content, not
hypothetical):

```markdown
## Ejemplo de configuración

Un proyecto declara sus raíces de documentación así:

~~~json
{
  "docsDir": ["docs", "adr"]
}
~~~

Cada raíz aporta su alias como prefijo del path indexado.
```

Trace through `flattenWithMap(markdown, true)`:

- **S1** (`stripHeadingLines`) drops `## Ejemplo de configuración` (not fence-interior, no `~~~`
  delimiter precedes it), keeps every other line — including the `~~~json` / `~~~` delimiter lines and
  the `{`, `"docsDir": [...]`, `}` lines inside them, joined by single spaces.
- **S2** (the fence drop, gated on `dropFencedBlocks`) runs `` /```[^`]*```/g `` — this string contains
  **zero backticks**, so the regex matches nothing. The tilde fence and everything inside it pass
  through S2 completely untouched.
- **S3** strips `` ` * _ > | `` — none of those characters are present here, so nothing changes.
- **S5/S6** collapse whitespace and trim.

**Today's excerpt (the `dropFencedBlocks: true`, "excluded" pass — the one the tool contract implies
means "code stripped, prose kept"):**

```
Un proyecto declara sus raíces de documentación así: ~~~json { "docsDir": ["docs", "adr"] } ~~~ Cada raíz aporta su alias como prefijo del path indexado.
```

That fits under 1400 chars, so there is no truncation ellipsis at all — the agent receives this as a
**complete** result (no `…` signal), literally containing the raw `~~~json` fence markers and JSON
body as visible text, mixed into what should have been clean prose. The `SUPPORTING_EXCERPT_CHARS`
(120-char) case is worse: if the chunk opened with this fence (heading stripped, fence first), the
first-120-char prefix excerpt would be almost entirely `~~~json { "docsDir": ["docs", "adr"...` — near
zero prose signpost, defeating the documented purpose of the supporting budget ("enough to judge
whether the lead is the right one," `excerpt.ts:12-17`).

**After a fix that generalizes S2 to also recognize `~~~`:**

```
Un proyecto declara sus raíces de documentación así: Cada raíz aporta su alias como prefijo del path indexado.
```

— matching exactly how a backtick-fenced version of the same content already behaves today.

**The interior-backtick case (problem 2)** is already measured and committed as a test, not
hypothetical (`test/domain/excerpt.test.ts:259-269`, `flatten-map.test.ts:93-97`): a fence-interior
heading-pattern line with a single stray backtick makes S2 make **zero replacements**, so
`dropFencedBlocks: true` and `dropFencedBlocks: false` produce byte-identical output — the *entire*
fence (open delimiter, content, close delimiter) leaks into the "excluded" excerpt exactly as if fence
exclusion were turned off for that chunk:

```
Before text. js # a comment with an odd ` backtick const x = 1; After text.
```

**One important nuance the fallback obscures**: when a section's body is *entirely* fenced content
(e.g. the `docs/documentation-convention.md` "12. Templates" case the sibling change traced), the
`dropFencedBlocks: true` pass strips it to empty anyway and `excerpt.ts:68`'s fallback takes over —
in that all-fenced shape, fixing S2 changes *nothing visible*, because the fallback (`false` pass)
never calls S2 at all. **The user-visible effect of this change is concentrated in *mixed* chunks** —
prose plus a tilde or interior-backtick fence together — not in chunks that are pure code.

---

## 2. Invariant constraints (I1–I4)

- **I1** `map.length === text.length`, **I2** non-decreasing, **I3** every non-space character copied
  verbatim / every synthesized character is a space. These are enforced generically by `trackedReplace`
  (`flatten-map.ts:141-172`) for **any** match set and **any** replacement shape — the previous cycle's
  design.md D3 already argued this once ("`trackedReplace` preserves I1-I3 for *any* match set:
  unmatched characters carry their own map entry through, replacements carry theirs"). **Any candidate
  that stays inside `trackedReplace` (i.e. only changes which substrings the regex matches, not how
  matches are replaced) inherits this argument for free, with zero new reasoning required.** This is
  true of the regex-generalization candidate (3b) below.
- A candidate that moves fence-dropping into `stripHeadingLines` (candidates 3a/3c) needs **new**
  map-tracking machinery that does not exist there today: today S1 either keeps a whole line (pushing
  every character's own offset) or drops a whole line (`continue`, nothing pushed). Collapsing a
  *multi-line run* (the fence's open delimiter through its close delimiter) into a **single** synthesized
  space — matching what S2's `singleSpaceAt` collapse does today — is a new shape of emission this loop
  has never needed. It's not exotic (same pattern as `trackedReplace`'s match-collapse), but it is new
  code in a function whose current doc comment (`flatten-map.ts:82-97`) explicitly frames its job as
  heading-suppression only.
- **I4** (the golden-reference byte-equality test, `flatten-map.test.ts:18-39,119-128`) is the sharpest
  differentiator between candidates, because `referenceFlatten` hardcodes S2's exact regex source at
  line 32 (`` .replace(/```[^`]*```/g, " ") ``). For the regex-generalization candidate, updating I4 is a
  **one-line, symmetric edit** — change that one line in `flatten-map.ts` and the identical one line in
  `referenceFlatten`, and every existing `GENERATED_INPUTS` fixture (including the odd-backtick one,
  `flatten-map.test.ts:93-97`) stays automatically covered, no new fixtures required for I4 to remain
  meaningful. For the S1-fusion candidates, `referenceFlatten`'s entire heading-suppression loop would
  need a parallel fence-content-dropping branch added by hand — the same order-of-magnitude rewrite the
  previous cycle's D4 already had to do once for the *heading* half of this same file, now needed again
  for the *content* half.

---

## 3. Candidate approaches

### (a) Generalize the fence drop to an `isFenceDelimiter`-driven, line-based removal, as a separate step

**Not implementable as scoped, and that is itself a finding.** `isFenceDelimiter` is a line-anchored
predicate (`/^\s*(```|~~~)/`) — it needs to see where a line *starts*. But S1 already ran and already
collapsed every `"\n"` into a single synthesized `" "` (`stripHeadingLines`, `flatten-map.ts:98-134`):
by the time S2 would run, the entire chunk is one line with no `"\n"` characters left in it at all.
`isFenceDelimiter` applied to that string can only ever test the very start of the whole string, never
"is this a fence delimiter *line*" for any of the original lines. **A separate, post-S1 step cannot use
this predicate meaningfully — it can only be applied while line structure still exists, which means
fusing it into S1.** So candidate (a), corrected, is identical in implementation location to candidate
(c); it is treated as one candidate below (3a/c).

### (3a/c) — Fuse the fence drop into S1 (`stripHeadingLines`), reusing `isFenceDelimiter` + the `balanced` gate

S1 would gain a `dropFencedBlocks` parameter. When `true` and inside a balanced fence, lines are
consumed (mapped to nothing) except for one synthesized space marking the collapsed run, mirroring
today's S2 collapse; delimiter lines themselves would still need to be emitted or dropped depending on
the exact chosen shape (there is a real sub-decision here design would have to make: does the whole
fence — delimiters included — collapse to one space, or do delimiters survive as today and only the
*interior* collapses? The former is simpler and matches "drop this whole fence" semantics; the latter
keeps parity with the prior change's D2 rule that delimiter lines are content for a *later* step to see
— but there is no later step left once S1 itself does the dropping, so D2's rationale doesn't transfer
here and delimiters can just be dropped too).

- **Fixes both problems?** Yes — `isFenceDelimiter` already recognizes `~~~`, and since this operates
  on a per-line, per-character basis rather than regex substring matching, an interior backtick or tilde
  inside the fence body is just ordinary "content between the toggle points," never something the
  detection mechanism needs to "see" as a delimiter-like substring. No pairing failure mode exists here
  the way it does for a character-class regex.
- **Map-tracking risk**: medium — new multi-line-collapse emission shape in S1 (see §2), plus S1's two
  call sites (`flattenWithMap`'s `true`/`false` invocations, `flatten-map.ts:31`) both need updating to
  pass the flag through, and the existing single unconditional `stripHeadingLines(markdown)` call becomes
  conditional on a parameter it never had.
- **Four non-guarantees**: converges to the *same* shapes S1 already has for heading suppression,
  applied now to content removal too — unterminated (odd count) fence: `balanced=false`, nothing is
  treated as a fence at all, so *no* content gets dropped for that whole chunk (today's S2 also fails to
  drop an unterminated fence, so this is not a regression, but see the divergence noted for 3b below:
  this candidate is *more conservative* than 3b in the odd-count case, not more correct). Chunk-crossing:
  same. 4-space indented block: unaffected, no delimiter exists. Misaligned-even: same inverted/milder
  shape already documented for headings — a real heading gets treated as fence-interior and (now) its
  surrounding content gets *collapsed* rather than merely retained-as-prose, a stronger effect than
  today's S1-only mechanism has for that shape.
- **`dropFencedBlocks: false` pass**: this candidate *must* explicitly special-case the `false` call to
  behave exactly as today (keep all fence content, only suppress headings) — since S1 becomes the single
  place both jobs happen, the two jobs need to be cleanly separable inside one function, which is exactly
  the kind of "one function doing two things" shape design review tends to push back on.
- **Effort**: Medium-High. Threads a new parameter through a function with an established, narrowly-scoped
  doc comment; requires a substantial `referenceFlatten` rewrite (§2); is the only candidate requiring
  design decisions not already answered by precedent (the delimiter-line-survives-or-not question above).

### (3b) — Extend the S2 regex, keeping its current shape, generalized to `[\s\S]*?` plus a `~~~` alternative

```ts
/```[\s\S]*?```|~~~[\s\S]*?~~~/g
```

replacing today's `` /```[^`]*```/g ``, still passed to the same `trackedReplace(flat, regex, (m) =>
singleSpaceAt(flat, m.index))` call at `flatten-map.ts:35` — **zero change to the surrounding
architecture**, S1 and everything else stays untouched.

- **Fixes both problems?** Yes, in one regex. The `~~~` alternative fixes problem 1 directly. Switching
  the negated character class `[^`]*` to the non-greedy any-character `[\s\S]*?` fixes problem 2: the
  original class *excludes any backtick at all*, so a single interior backtick makes the match
  impossible to complete; `[\s\S]*?` matches any character (including backticks) and simply looks for
  the *nearest* literal closing run — a single interior backtick no longer prevents the regex from
  finding the real closer three characters later. **For the common case with zero interior same-character
  content, the match boundaries are identical to today** — same start, same end, same replacement — so
  every currently-passing fence-drop test that has no interior backtick is byte-identical before and
  after (re-derived by hand against `flatten-map.test.ts`'s existing fixtures; executed in §8).
- **Map-tracking risk**: none beyond what `trackedReplace` already provides generically (§2) — this is
  the cheapest candidate on this axis by a wide margin.
- **Four non-guarantees**: shapes 3 (4-space indented, no delimiter) and — for a *genuinely* unterminated
  fence with no matching closer anywhere in the chunk — shape 1/2 behave identically to today (the regex
  still fails to find a closer, so nothing is dropped). **One genuine divergence from the "chunk-local
  balanced" convention used everywhere else** (worth flagging explicitly for design, not a defect): this
  candidate does not consult `isFenceDelimiter`'s `balanced` parity check at all — it just looks for the
  nearest literal opener/closer pair. Consider a chunk with **three** delimiters: `D1` (open), `D2`
  (close, forming a genuinely complete, well-formed fence), and a **third, stray** `D3` (an opener with
  no closer in this chunk, continuing into a later one). `isFenceDelimiter`'s balanced-count gate sees an
  *odd* total (3) and — per the sibling components' documented rule — treats the *whole chunk* as
  "uncertain, don't touch anything." The regex candidate has no such whole-chunk gate: it will still find
  and correctly drop the well-formed `D1`–`D2` pair, leaving only the dangling `D3` marker as leftover
  text. This is not a content-safety regression (nothing that should survive gets deleted; if anything
  more genuinely-fenced content gets correctly dropped than today), but it is a **behavioral divergence**
  from the "all mechanisms in this codebase evaluate chunk-local fence state via the same balanced-count
  rule" pattern the last two cycles established as a value (CLAUDE.md's `isFenceDelimiter`-sharing
  bullets). Name this explicitly in design; it is a defensible, arguably-*better* outcome, but it means
  S2 and S1 can now disagree on whether "this chunk has fence state we trust" for the same chunk.
- **CommonMark closing-length rule, info-string fences, indented fences**: all behave exactly as today
  (§5 below) — this candidate changes nothing about *which* substrings are recognized as delimiters, only
  how far the *content-matching* portion of the regex is willing to scan and which delimiter characters
  it accepts.
- **`dropFencedBlocks: false` pass**: completely unaffected — S2 is only ever invoked inside the `if
  (dropFencedBlocks)` branch (`flatten-map.ts:34-36`); the `false` call never reaches this regex at all,
  exactly as today.
- **Effort**: Low. One regex literal changed in production, the identical one-line change mirrored in
  `referenceFlatten`, plus the existing Gate 4 test's asserted equality needs a deliberate update (see
  Risks).

**Info-string fences, indented fences, CommonMark closing-length rule** — checked against all three
candidates:

- **Info-string fence** (```` ```ts ````): `isFenceDelimiter`'s regex already ignores anything after the
  marker (`/^\s*(```|~~~)/`, no `$` anchor), and (3b)'s literal-substring match doesn't care about the
  info string either — it's simply part of the "content" the non-greedy scan consumes up to the closer,
  same as it always has been for the pre-existing backtick-only regex. No candidate needs new handling.
- **Indented fence** (e.g. inside a list item, `` ```js `` with leading spaces): `isFenceDelimiter`
  tolerates leading whitespace already; (3b)'s substring match doesn't anchor on line position at all, so
  indentation is irrelevant to it. No candidate needs new handling.
- **CommonMark's closer-length ≥ opener-length, same-character rule**: none of the three candidates
  enforce it, and **this is deliberately out of scope, not a gap** — it is the same judgment call
  `isFenceDelimiter`'s own doc comment already makes explicit ("a deliberate CommonMark *approximation*…
  does not check fence-character run length… one shared, imperfect definition… keeps every consumer
  agreeing with the chunker, which matters more than any one of them being independently more correct,"
  `split-text.ts:88-96`). Implementing the precise rule here would make this file *more* correct than the
  chunker it must stay consistent with — exactly the trap the project's own stated philosophy warns
  against. Not in scope for any candidate.

### Recommendation

**Candidate 3b** (generalize the S2 regex to `` /```[\s\S]*?```|~~~[\s\S]*?~~~/g ``, no architecture
change). Reasons, in order of weight:

1. It is the only candidate that fixes both stated problems in one change with **zero** new map-tracking
   machinery (§2) — `trackedReplace`'s existing invariant argument applies unmodified.
2. The I4 golden-reference maintenance cost is a one-line, symmetric edit versus a multi-line loop
   rewrite for the S1-fusion candidates — directly comparable to how expensive the *previous* cycle's D4
   rewrite already was, and this candidate avoids paying that cost again.
3. It keeps `split-text.ts` and `read-document.ts` at a zero-line diff (matching this repo's established
   pattern of scoping a fix to exactly the file the defect lives in — both archived sibling changes did
   this deliberately).
4. Its one real cost — the divergence from the shared "chunk-local balanced" convention noted above for
   the three-delimiter odd-count case — is narrow, does not create a content-safety issue, and is exactly
   the kind of thing this project's CLAUDE.md already has a template for recording as a named, accepted
   non-guarantee rather than silently absorbing.

**What is explicitly NOT in scope**: enforcing CommonMark's closer-length/same-character rule (a
deliberate trap per the project's own stated philosophy, see above); touching S3's unconditional
backtick/asterisk/underscore/pipe stripping (pre-existing, orthogonal); moving `isFenceDelimiter` to its
own module (§4); any change to `read_doc`'s `headingsIn` or `split-text.ts`'s chunker-facing
`isFenceDelimiter` itself — this candidate never imports or touches that predicate at all.

---

## 4. `isFenceDelimiter` relocation

The revisit trigger from `read-doc-fence-aware-sections`'s Decision 1 ("move it to its own domain module
when a third consumer appears") already fired once, and `excerpt-fence-aware-flatten`'s D6 recorded that
firing without acting on it. **The recommended candidate (3b) does not touch `isFenceDelimiter` at all**
— it never imports it, so the consumer count stays exactly where it already is (three: `split-text.ts`
itself, `flatten-map.ts`'s S1, `read-document.ts`'s `headingsIn`). No new trigger fires under this
recommendation.

If design instead chose the S1-fusion candidate (3a/c), that candidate still would not add a *new*
consumer either — it deepens an *existing* consumer's (S1's) use of the same import it already has, not
a new file importing it for the first time. Either way, the mechanical "third consumer" trigger condition
from the sibling change's Decision 1 is not re-fired by this change. Whether to finally move it anyway is
a judgment call about diff bundling, not a forced consequence of this change — and per the twice-recorded
precedent (D6's own reasoning: "reversible, cheap later, avoid bundling a refactor into a behavior fix"),
deferring again is consistent, not negligent, **provided it is recorded again**, in the same
greppable location in `CLAUDE.md` this cycle already uses for exactly this purpose.

---

## 5. CRLF behaviour

- **Candidate 3b is CRLF-safe by the same reasoning already established for the existing regex, not new
  reasoning.** Neither the current `` /```[^`]*```/g `` nor the proposed
  `` /```[\s\S]*?```|~~~[\s\S]*?~~~/g `` has any `^`/`$` anchor — both are pure substring searches over
  `flat.text`. By the time S2 runs, S1 has already turned every original line break into a single
  synthesized space (§1a's trace), but any `\r` characters that trailed each *kept* line on a CRLF
  document survive as literal characters inside `flat.text` (S1 copies `line[j]` verbatim for every
  character of a kept line, and CRLF's trailing `\r` is part of that line's string — `split("\n")` only
  removes `\n`). Neither regex candidate cares where a `\r` sits, because neither regex ever asserts "end
  of line" or "start of line" — `[\s\S]` explicitly matches `\r` like any other character, and the
  literal fence markers are found by substring position alone, never by line boundary. **This is the same
  class of immunity the sibling exploration already established for the current S2 regex**
  (`excerpt-fence-aware-flatten` exploration.md §6) — the change here widens the character class, it does
  not add an anchor, so it inherits that immunity unmodified. Executed confirmation in §8.
- **Candidate 3a/c (S1-fusion) would also be CRLF-safe, but only if built correctly** — it must reuse
  `isFenceDelimiter` exactly as-is (already anchor-free, prefix-only, proven immune) and must not
  introduce any new `$`-anchored pattern for detecting where a fence's content *ends* on a per-line basis.
  This is achievable, but it is new code with a new failure surface, unlike 3b which reuses the existing,
  already-CRLF-verified pattern shape unchanged in kind.
- A candidate not reasoned about under CRLF here is marked as such rather than guessed: no alternative
  regex shape beyond `[\s\S]*?` plus the `~~~` alternative was designed or evaluated (e.g. a
  backreference-based `` /(```+|~~~+)[\s\S]*?\1/g `` unifying both alternatives into one capture group)
  — that shape is plausible but untested against CRLF or against mixed-fence-type content here, and
  should not be assumed safe without the same verbatim-trace treatment given to the two-alternative form
  above.

---

## 6. Measurement plan / probe

Following the `scripts/excerpt-flatten-probe.mjs` / `scripts/section-lookup.mjs` precedent — a script
that imports compiled production code from `dist/`, no model download, one asserted self-check:

**Command sequence** (mirrors the sibling change's Gate 1):

```bash
npm run build
node dist/cli.js --root . index --lexical
node scripts/excerpt-fence-drop-probe.mjs .
```

**What it should count**, extending the existing `excerpt-flatten-probe.mjs` M2 pattern:

1. Over every stored chunk: count of `~~~`-delimited fences present in `dropFencedBlocks: true` output
   (before the fix: > 0 whenever the corpus has any tilde fence at all; after: must be 0 — the falsifying
   condition).
2. Over every stored chunk: count of fence-interior lines carrying an odd backtick count whose enclosing
   `dropFencedBlocks: true` output is byte-identical to the `false`-pass output (the M1/M2 signature of
   problem 2, already partly measured by the existing probe script for the *heading-line* subset — this
   extends it to all fence-interior content, not just heading-pattern lines).
3. A direct fixture-based check (no corpus dependency) analogous to the sibling change's Gate 2/Gate 4:
   run `flattenWithMap` on a hand-built tilde-fence fixture and an interior-backtick fixture, both
   `dropFencedBlocks: true` and `false`, and assert the `true` pass excludes the fence content in both
   cases post-fix.

**What number falsifies the premise**: if, after the fix, any corpus-wide count in item 1 remains > 0
(a tilde fence's content still appears in a `dropFencedBlocks: true` excerpt), or item 3's fixture-based
check shows the interior-backtick fence still leaking identically into both passes, the change did not
do what it claims.

**This repo's own corpus currently has zero tilde fences** — see §8 for the executed count, which is
stronger than the sub-agent's inferred claim — **and zero live interior-backtick-in-fence instances**
(consistent with the prior cycle's M2 measurement of 0/21). **A count of 0 today is not evidence the gate
is meaningful — it means there is nothing yet to falsify.** Two ways to fix this, either consistent with
this project's established precedent:

- **Add a small, dedicated fixture directory** (`test/fixtures/excerpt-fence-drop/docs/` or similar),
  matching `test/fixtures/excerpt-window/docs/`'s precedent — cheap, isolated, no risk to the live corpus.
- **Extend `docs/documentation-convention.md` itself** with one tilde-fenced example (and, if natural, one
  interior-backtick example), continuing the exact pattern the last two cycles used to keep the "live case
  on this repository's own corpus" self-referential proof intact. This is the stronger choice if the goal
  is another `search --lexical`-driven manual gate like the sibling changes' Gate 1/Scenario 6 — but it is
  a corpus-editing decision, which belongs to the design/apply phase, not to this exploration.

---

## 7. Recommendation and scope statement

**Recommended**: candidate 3b — generalize the S2 regex to
`` /```[\s\S]*?```|~~~[\s\S]*?~~~/g ``, keeping the existing `trackedReplace`/`singleSpaceAt` machinery
unchanged, no changes to `stripHeadingLines`, `isFenceDelimiter`, or `read-document.ts`. Argument
summarized: it is the only candidate that solves both problems in one place with no new invariant
reasoning, the cheapest golden-reference maintenance cost by a wide margin, and it stays inside the
established "scope the fix to exactly the file the defect lives in" pattern the last two cycles both
demonstrated. Its one accepted cost — divergence from the shared "chunk-local balanced" convention on a
narrow, non-content-losing odd-delimiter-count shape — should be named explicitly in design and recorded
in `CLAUDE.md`, matching how every other non-guarantee in this pipeline has been handled.

**Explicitly NOT in scope**: enforcing CommonMark's fence closing-length/character-match rule (a
deliberate trap given this project's stated preference for agreeing with the chunker's own imprecise
predicate); any change to S3's unconditional character stripping; any change to `read_doc`'s
`headingsIn` or the chunker's own `isFenceDelimiter`; moving `isFenceDelimiter` to its own module (no new
trigger fires under the recommended candidate); enforcing consistency between S1's balanced-count gate
and S2's pairwise-nearest-match behavior for the multi-delimiter divergence case named in §3 — recording
it as a documented non-guarantee is in scope, closing it is not (closing it would require S2 to consult
whole-chunk delimiter parity before matching, effectively re-introducing the architecture-change
candidate this recommendation is choosing to avoid).

---

## 8. Measured addendum (orchestrator, executed)

Sections 1-7 were produced without a `Bash` tool and are INFERRED. The two load-bearing claims of the
recommendation were executed before this exploration was persisted. Both hold.

### M1 — Old vs proposed regex, direct comparison

`node -e` replacing each pattern with `" "` on seven hand-built inputs, on this repo's Node floor:

| Input shape | Old `` /```[^`]*```/g `` | Proposed `` /```[\s\S]*?```\|~~~[\s\S]*?~~~/g `` | Verdict |
|---|---|---|---|
| Plain backtick fence (LF) | dropped | dropped | **unchanged** |
| Plain backtick fence (CRLF) | dropped | dropped | **unchanged** |
| Two fences + an inline-code span between them | both dropped, inline span kept | both dropped, inline span kept | **unchanged** |
| Unterminated fence (no closer) | not dropped | not dropped | **unchanged** |
| Interior-backtick fence | **not dropped** (leaks whole fence) | dropped | **fixed (problem 2)** |
| Tilde fence (LF) | **not dropped** | dropped | **fixed (problem 1)** |
| Tilde fence (CRLF) | **not dropped** | dropped | **fixed, CRLF-safe** |

This confirms §3's "identical match boundaries for the common case" claim and §5's CRLF-immunity
claim as MEASURED rather than argued. It does **not** yet exercise `trackedReplace`'s map invariants
(I1-I4) — that is `sdd-verify`'s job against the real test suite, not this probe's.

### M2 — Live tilde-fence count on this repository

```bash
grep -rn '^\s*~~~' docs/
grep -rln '^\s*~~~' --exclude-dir=node_modules --exclude-dir=.git .
```

Result: **zero matches in `docs/`, and zero matches anywhere in the repository** — including
`test/fixtures/`, `openspec/specs/`, and source. Every `~~~` occurrence found by an unanchored grep is
prose *about* fences inside SDD artifacts and doc comments (`split-text.ts:86`, archived change files),
never a real fence delimiter.

This is **stronger than §6's inferred claim**, which said tilde fences "appear in test fixtures, specs,
and `split-text.ts`'s own doc comment." They do not appear as fences anywhere. The operational
consequence is unchanged and reinforced: **the corpus-driven half of the gate (§6 items 1-2) cannot
falsify anything on this repository today.** The fixture decision in §6 is therefore not optional
polish — without it the change ships with a gate that passes vacuously.
