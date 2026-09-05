# Design: Anchor Supporting Excerpts on the Match

## Technical Approach

**The mechanism is one deleted ternary. Everything in this document is about the things a one-line
change still leaves open**: how two deliberate canaries are inverted without being silenced, what
`scripts/supporting-anchor-probe.mjs` must be so its numbers mean something, why `computeWindow` is
frozen at a 120-character budget, which of the ancestor's decisions this actually disturbs, and
which prose stops being true.

```
const spans = rank === 0 ? locateSpans(chunk.content, terms) : [];   // search-documents.ts:123
const spans = locateSpans(chunk.content, terms);                     // after
```

`terms` is already hoisted once per search (`search-documents.ts:108`). No signature changes. No new
domain file, no new port, no new adapter — `src/domain/` is not touched at all by this change, so
`openspec/config.yaml`'s "keep `src/domain/` free of SQLite/transformers.js/filesystem" rule is
satisfied vacuously rather than by argument.

Four properties hold by construction and are verified against the code in Decision 4 rather than
assumed: the flatten map (`flatten-map.ts`, invariants I1-I4) is untouched; `selectMatchCentre` is
untouched; the empty-spans prefix path is untouched and becomes the supporting tier's fallback as
well as the vector-only one; and **no additional flattening work is added at all**, because
`buildExcerpt` already flattens every chunk before it looks at `spans` (`excerpt.ts:61` precedes
`:73`). The measured +0.382 ms/search is `locateSpans` + `selectMatchCentre` + `computeWindow`, not
flattening.

## Dependency on an unproven premise — stated before the decisions that rest on it

The requirement being removed (`openspec/specs/mcp-contract/spec.md:627-641`) carries a quality
rationale, not only the cost rationale the exploration found:

> a supporting fragment routes between results rather than answers, and a prefix stays legible
> against `path`/`section` in a way a stripped-context window would not.

The proposal rebuts it on term coverage (C1 45.1% → 0%, C4 1.84 → 5.29) and records honestly that
this is a **proxy**: nobody has observed an agent routing better or worse with windowed supporting
fragments, and the 84.4% both-ellipsis rate is that rationale's own predicted failure mode with a
number attached. This design inherits that posture and does not restate the rebuttal as settled.

Three decisions below depend on the premise "a fragment that shows the matched terms routes better
than a fragment that shows unrelated opening prose":

| Decision | What it assumes | What happens if the premise is false |
|---|---|---|
| **D5** (accept the both-ellipsis shift, do not soften the truncation signal) | That "more on both sides" is an acceptable price for "shows the match" | The ellipsis contract keeps its weakened discriminator for no gain; the revert restores it |
| **D3** (freeze `computeWindow`; accept 9.1% hard mid-word cuts) | That a hard edge on a matched-term window beats a clean edge on unrelated prose | The 9.1% becomes cost with no benefit — but it is *only* reachable through the window, so the revert removes it too |
| **D1** (accept the destructive spec delta) | The same, at contract level | The spec requirement has to be re-added, which is why the delta is flagged for the archive warning |

**The observable that would falsify the premise**, recorded so it is not reinvented: agent traces
showing supporting hits driving *more* `read_doc` chaining after this change than before. Nothing in
this cycle measures that. The revert is one line plus a spec restore, with no data at risk
(Migration / Rollout below), which is the reason it is acceptable to ship on a proxy — not a reason
to believe the proxy.

## Architecture Decisions

### Decision 1: the guard is removed unconditionally — no rank-parameterized policy, no second branch

**Choice**: `locateSpans` runs for every emitted result. Rejected: (a) a `rank <= 1` variant that
anchors only the first supporting fragment, (b) a policy object threaded from config, (c) a separate
`buildSupportingExcerpt` entry point.

(a) is Lever B's ramp wearing different clothes: exploration §3 measured that a "rank 1 gets more,
rank 2+ stays flat" shape covers 20% of the non-rank-0 cases (2 of 10 / 1 of 2) — a third tier and a
third code path for a fifth of the population. (b) invents a configuration surface for a decision no
project has asked to vary, in a codebase whose config-key policy is an explicit whitelist
(`mergeConfig`, `config.ts`) precisely to keep that surface small. (c) is a second branch where the
ancestor's Decision 7 left one, and its "one branch serves all three" property (lexical, vector-only,
fold-miss) is the part of Decision 7 this change **keeps**.

**What the removal costs, measured rather than argued** (exploration §11.2): +0.382 ms/search on
`ejemplos/` (29 chunks, +42.4%), +0.199 ms on an 888-chunk corpus (+11.8%). The relative penalty is
larger on the *small* corpus — on a large index the FTS5/vector/fusion work dominates. The comment
replacing `search-documents.ts:119-122` must carry those numbers, so the next reader does not
re-litigate Decision 7 from the archive:

```ts
      // Spans are located for EVERY rank. This reverses
      // `2026-08-06-match-centred-excerpt` design.md Decision 7, which
      // computed them for rank 0 only and declined this on cost ("one
      // locator run per search rather than k"). That cost is now measured:
      // +0.382 ms/search on `ejemplos/` (29 chunks), +0.199 ms on an
      // 888-chunk corpus — directionally real, absolutely negligible.
      // Still ONE branch, not two: a chunk with no locatable term —
      // vector-only, fold-miss, or a term that does not survive flattening
      // — falls back to the same empty-spans prefix path it always did.
      const spans = locateSpans(chunk.content, terms);
```

### Decision 2: the two canaries are inverted under a four-part honesty gate, and the inversion is proven by a recorded red run

The named risk is that a red assertion is deleted or weakened rather than inverted. This is the
repository's most-recorded failure class (`MEMORY.md`: eleven defects inside success reports), and it
is invisible in a green suite by definition. The answer is a gate a reviewer can check from the diff
plus the verify report, not a request for care.

**The ritual, per canary — the ancestor's Gate 1 baseline ritual, run in reverse.** Strict TDD
(`openspec/config.yaml: strict_tdd: true`) already forces the order; the ritual exists so the
evidence is *recorded* rather than merely experienced:

1. Rewrite the canary's assertions to the new behaviour, with `src/application/search-documents.ts`
   still unmodified. Vitest runs the TypeScript sources directly, so "the pre-change build" is simply
   the unmodified file — no `npm run build` needed.
2. `npx vitest run test/application/search-documents-spans.test.ts test/application/index-and-search.test.ts`
   **must fail**, and the failure output (test name plus the specific failing assertion) is pasted
   verbatim into `verify-report.md`. A rewritten canary that passes here is not a canary; it is a
   test that stopped asserting the thing.
3. Only then delete the guard. Re-run to green.

**The four-part gate a reviewer applies to the diff:**

| # | Check | Why it catches silencing |
|---|---|---|
| G1 | The `expect(` count inside each rewritten test does not decrease | Silencing shows up as deletion; this is greppable and needs no judgment |
| G2 | The verbatim pre-change failure output for each canary is in `verify-report.md`, naming the assertion | An assertion that never failed against the old code cannot distinguish the two behaviours |
| G3 | The comment naming the ancestor's Decision 7 is **replaced**, not deleted — the new comment states what would break the test in the new direction | The canary keeps its trip-wire role; a future revert to prefixes must fail here loudly |
| G4 | No assertion becomes an unconditional or vacuous form (`toBeDefined()`, `expect(true)`, a bare `length > 0`). Exactly **one** weakening is permitted — the `+ 1` → `+ 2` length bound — and it is compensated by new positive assertions in the same test | Names the single legitimate relaxation up front, so any other one is visibly out of contract |

**Canary #1 — `test/application/search-documents-spans.test.ts:37-68`.** The fixture stays exactly as
it is (`FILLER` ≈ 1600 chars of `"word "`, then `zulu appears only here, deep in the document.`), so
the before/after comparison is on behaviour, not on inputs. Assertions become:

- `expect(supporting!.excerpt).toContain("zulu")` — the literal inversion of today's
  `not.toContain("zulu")`, on the same expression, which is what makes the pair comparable.
- `expect(supporting!.excerpt).toBe(buildExcerpt(supportingContent, SUPPORTING_EXCERPT_CHARS, locateSpans(supportingContent, tokenizeQuery("zulu"))))`
  — the windowed counterpart of today's byte-identity assertion. Assertion *strength* is preserved:
  still byte-identity, against the other reference.
- `expect(supporting!.excerpt).not.toBe(buildExcerpt(supportingContent, SUPPORTING_EXCERPT_CHARS, []))`
  — keeps the old reference alive in the file. A regression back to prefixes fails here.
- `expect(supporting!.excerpt.startsWith("…")).toBe(true)` and
  `expect(supporting!.excerpt.length).toBeLessThanOrEqual(SUPPORTING_EXCERPT_CHARS + 2)`.
  The leading ellipsis is deterministic on this fixture: the only occurrence of `zulu` sits near the
  end of a ~1644-character flattened string, so `computeWindow`'s `start` clamps to `maxStart`
  (`text.length - 120`), which is greater than 0.
- **Deliberately not asserted**: the trailing edge. On this fixture the window ends at
  `text.length`, so there is no trailing `…` — but pinning that here duplicates what
  `excerpt.test.ts`'s Decision-5 unit tests already own, and an edge shape asserted from reasoning
  rather than from observation is how a red test that is not a defect gets created.

The `describe` title and the file's header comment (`:15-19`, "spans are computed for rank 0 only
(Decision 7)") are rewritten to "spans are computed for every rank", citing this change. That is G3
for this file.

**Canary #2 — `test/application/index-and-search.test.ts:185-204`**, integration over the real
`ejemplos/` corpus, query `email duplicado`, k=5. Assertions become:

- `expect(result.excerpt.length).toBeLessThanOrEqual(SUPPORTING_EXCERPT_CHARS + 2)` — the one
  permitted weakening (G4).
- **The compensating strengthening**: `expect(supporting.some((r) => r.excerpt.startsWith("…"))).toBe(true)`.
  Pre-change this is false for every supporting result by construction, so the assertion is red
  before the edit and green after — it is the canary's inverted trip-wire. C3 measured 78.4% on this
  corpus, so at least one of four supporting fragments starting with `…` is near-certain but not
  certain. **If it is observed 0-of-4 on this particular query after the change, the fix is to move
  the test to another goldenset query, never to drop the assertion** — and the substitution must be
  recorded in `verify-report.md` with both queries named.
- The lead bound (`LEAD_EXCERPT_CHARS + 2`) and the gradient assertion
  (`lead.excerpt.length > longest supporting`) are **unchanged**: the 1400/120 split is not being
  re-litigated, and the gradient is the assertion that proves it still reaches the wire.
- The inline comment at `:192-196` is replaced by one recording the inversion, the unchanged
  budgets, and what would break it (G3).

**Rejected**: deleting either canary and covering the behaviour only in the new tests of Decision 6.
The canaries' value is precisely that they were written by the previous cycle to catch this edit;
replacing them with fresh tests written by the cycle that wants the edit to pass destroys the
adversarial property.

### Decision 3: `computeWindow` is unchanged — stated as a decision, not an omission

**Choice**: `src/domain/excerpt.ts` is not modified. `computeWindow`'s clamp, both snaps, and above
all the **snap-revert guard** (`:141` `candidateStart <= clusterStart`, `:150`
`candidateEnd >= clusterEnd`) are frozen for this change. The proposal's answered question round
forbids inventing a softening; it equally forbids altering the guard silently. This decision is the
explicit statement of both halves.

Three separate arguments, so this does not rest on the instruction alone:

1. **The 9.1% hard-cut rate is the guard succeeding, not failing.** The guard reverts a
   word-boundary snap that would push the matched cluster outside the window. Inside 120 characters
   the margin is thin, so it reverts more often than it ever needs to at 1400. Softening it means
   choosing between allowing a snap that hides part of the matched cluster — which destroys the one
   property this change ships — or adding a second, budget-dependent snap policy: a new branch in the
   one function whose behaviour the ancestor's Decision 5 unit tests pin, for a cosmetic gain.
2. **`computeWindow` is shared with rank 0.** Any change to it moves rank-0 excerpts on every
   search, on every corpus — the exact regression surface for which the proposal deferred Lever C,
   and which `compendio eval` is structurally blind to (`evaluate-search.ts` never reads `.excerpt`;
   exploration §7, re-confirmed §11.3). A "cheap softening" would therefore need its own
   excerpt-content gate and its own fixture. It is not cheap; it is Lever C's cost without Lever C's
   motivation.
3. **The costs are asymmetric.** A hard edge truncates at most one word, and the `…` already tells
   the reader that edge is cut. A hidden match costs the fragment its entire routing value. 9.1% of
   88 fragments on `ejemplos/` is 8 fragments with a ragged edge.

**Recorded and not re-derived** (exploration §2b, deductive, refuted before measurement): the window
can never be *narrower* than the chosen cluster. `selectMatchCentre` shrinks its sweep from the left
until `sorted[right].end - sorted[left].start <= budget` (`match-location.ts:132-143`), so the centre
it returns always belongs to a cluster that fits the budget, and `computeWindow` always produces
`min(budget, text.length)` characters before snapping. The "a 120-char window is too small for the
match" concern is unfounded at any budget.

**The revisit trigger, so a future softening is a decision and not a drift**: any change to
`computeWindow`'s snap-revert guard needs its own cycle, its own fixture, and an excerpt-content gate
— `compendio eval` cannot see it.

### Decision 4: the ancestor's Decisions 3-6 are checked against the code, not inherited on assertion

The proposal asserts these are undisturbed. "Inherits the argument for free" is only free if the
check is actually performed, so here it is, decision by decision, against the current tree.

| Ancestor decision | Status | Verified how |
|---|---|---|
| **D3** — `FlatText`, `flattenWithMap`, `toFlatOffset`, invariants I1-I4 | **Untouched** | `search-documents.ts` does not import `flatten-map.js`; `buildExcerpt` calls `flattenWithMap(markdown, true)` (and the empty-text second pass) at `excerpt.ts:61,68` identically for every rank, before it ever looks at `spans` at `:73`. **Consequence worth naming: this change adds zero flatten work.** Supporting fragments already built the full map; D3's "no fast path when there are no spans" note already said so |
| **D4** — `selectMatchCentre`, weighted distinct-term coverage | **Untouched in code, widened in reach** | Not imported by the call site; invoked only from `buildExcerpt:76`, already budget-parameterized (`selectMatchCentre(flatSpans, maxChars)`). At 120 the sweep admits narrower clusters, which is the parameter doing its job. This widening is what the spec delta's renamed "Match Selection Is Not Positional" requirement records |
| **D5** — clamp, dual-edge snapping, ellipses on top of budget | **Untouched mechanism, new operating point** | See Decision 3. `budget + 2` was always the bound; the supporting tier simply starts reaching it |
| **D6** — `buildExcerpt(markdown, maxChars?, spans?)`, `[]` is the byte-identical prefix path | **Untouched, and now load-bearing for a second population** | `prefixExcerpt` (`excerpt.ts:106-110`) unchanged; `mapSpansToFlat`'s zero-width discard (`:98`) unchanged. The empty-spans path is now reached by supporting fragments whose chunk has no locatable term, in addition to vector-only leads. `test/application/vector-only-excerpt.test.ts` exercises a rank-0 vector-only result and stayed green under the throwaway patch (exploration §11.1: exactly two failures, no others) |
| **D7** — rank 0 only | **Reversed.** This change | — |

**One consequence of D6's widened role, which the proposal does not name**: the *only* documented
route into `prefixExcerpt` for a supporting fragment is now "the chunk's flattened content holds no
locatable query term". That is exactly the shape exploration §11.4 caught in the probe (a term
present only in a heading line that `stripHeadingLines` removes), and it is why the spec delta's
third ADDED scenario exists. Decision 6 below gives it a test in the product, not only in the probe.

### Decision 5: the prose inventory — including two files the proposal lists as untouched, and one grep trap

**The ellipsis contract text is NOT rewritten.** `server.ts:123-125` ("A '…' at either end of an
excerpt marks content omitted there") and `AGENTS.md`'s "A `…` at either edge is the documented
truncation signal" were written for the lead window and are already honest about both edges. Only
their *frequency* changes. Rewriting text that is still true would put churn in the diff exactly
where a reviewer needs to see that nothing changed.

**`src/server.ts:119-121` — the grep trap.** The phrase *"the rest carry short ones from the start of
their section"* is split across concatenated string literals, so it does not exist as a contiguous
substring and a naive grep reports the citation as hallucinated. It already did, once, during
exploration. The replacement keeps the split shape and touches the middle literal only:

```ts
        "The top result carries a full-length excerpt, centred on the part of the document that " +
        "matched, which usually answers outright; the rest carry short ones, centred on their own " +
        "match, enough to tell whether the top result is the right one. Each result has " +
```

Rejected wording: *"…short ones, also centred on the match"* — "the match" reads as the top result's
match. And any sentence naming character counts: the tool description states behaviour, not
constants, everywhere else in this file.

**`AGENTS.md`, MCP tools §2** — the clause *"the rest get `SUPPORTING_EXCERPT_CHARS` (120) as a
start-anchored prefix, enough to judge whether rank 1 is the right one"* becomes:

> …the rest get `SUPPORTING_EXCERPT_CHARS` (120), spent the same way — a window centred on their own
> matched span — enough to judge whether rank 1 is the right one. A supporting fragment falls back to
> a start-anchored prefix only when its chunk's **flattened** content holds no locatable query term
> (the vector-only / fold-miss path, and a term that survives only in a heading line).

**`AGENTS.md`, the graduated-budget bullet** gains a recorded paragraph that states what did *not*
change first, because that is what a reader will otherwise have to re-derive: the 1400/120 split is
untouched and the graduated policy is not re-litigated; only the anchoring inside the 120 changed.
Then the two accepted costs with their measured numbers (`ejemplos/`: both-ellipsis 0% → 78.4%,
hard mid-word cuts 0% → 9.1%; external demo-docs 84.4% / 3.4%, corroborating and **not reproducible
in this repository**), the ellipsis-frequency shift and its explicitly unproven behavioural effect,
and a pointer to the probe.

**`AGENTS.md` also gains a "Manual gate (`supporting-excerpt-anchoring`)" section**, following the
`vector-reach` / `section-lookup` / `excerpt-fence-drop` precedent: the command sequence, what each
criterion counts, and the measured before/after table. Every other probe in this repository is
documented there; one that is not documented is one that is not re-run.

**Three stale citations, in files the proposal lists as untouched.** Each is a comment-only diff with
zero executable change, listed here exhaustively so apply does not discover them ad hoc and so
Gate D's file-count criterion is read correctly (see Decision 7):

| Location | Text | Fix |
|---|---|---|
| `src/domain/excerpt.ts:49` | "…has no lexical match to locate (design.md Decision 7)" | Re-cite: the empty-spans path is the ancestor's Decision 6; Decision 7 is reversed by `supporting-excerpt-anchoring` |
| `test/domain/excerpt.test.ts:123` | same citation in a test comment | Same |
| `test/application/vector-only-excerpt.test.ts:60` | "empty spans -> today's prefix path (Decision 7)" | Same |

**The trap that makes this list necessary**: `"Decision 7"` is an overloaded citation across changes.
`src/composition.ts:114`, `src/domain/convention.ts:45,165`, `test/domain/convention.test.ts:58,153`,
`test/application/read-document.test.ts:36`, `test/application/index-and-search.test.ts:331` and
`test/helpers/build.ts:115` all cite **`multiple-doc-roots`'s** Decision 7 and MUST NOT be touched. A
grep-and-replace on "Decision 7" corrupts seven correct citations to fix three stale ones.

**Not changed**: `scripts/excerpt-offset-distribution.mjs`'s header ("a fraction a 120-char
start-anchored prefix could never show, however it were centred"). It describes what that script
measured about the *pre-change* policy and remains an accurate record of it; it is a completed
observation from the ancestor cycle, not a live claim about current behaviour.

### Decision 6: `scripts/supporting-anchor-probe.mjs` drives the real pipeline through `createContainer` — no replication, and a falsifiable escalation if that fails

**Choice**: the probe imports `createContainer` from `dist/composition.js` and calls
`container.searchDocuments.execute(...)`, then resolves each returned result back to its stored
chunk. Rejected: reimplementing `runSearch` (lexical + vector + RRF + `capPerDocument`) inside the
probe and self-checking a "replication drift" counter against the real pipeline.

The orchestrator's throwaway probe replicated, which is why exploration §11.4's table carries a
`replication drift (must be 0)` row. Replication is the weaker design: drift measured at 0 today
becomes drift discovered later, and it is ~40 lines of fusion logic copied out of a file that
changes. **Driving the real use case makes drift impossible rather than measured**, and it follows
this repository's own sibling script `scripts/excerpt-offset-distribution.mjs:42,58,64-66`, which
already drives `SearchDocuments` from `dist/` and resolves result → chunk by path and heading.

**The one thing replication bought, and how it is replaced.** `SearchResultItem` carries no chunk
id, so a non-replicating probe must resolve `(path, section)` back to a chunk. `capPerDocument`
allows 2 chunks per document, and `splitToBound` gives every piece of a split section the *same*
heading — so `(path, section)` is not guaranteed unique, and the sibling script's `.find(...)`
silently takes the first. The probe must not do that:

> **C7 — ambiguous chunk resolution.** For each supporting fragment, collect *every* chunk of that
> document whose `heading === result.section`. Exactly one → measure it. Zero or more than one →
> increment C7, print `(query, path, section, candidateCount)`, and measure nothing for that
> fragment.

C7 > 0 is a **hard failure with its own message** (`CANNOT IDENTIFY THE MEASURED CHUNK`), checked
before every other self-check: a probe that cannot say which chunk it measured is not measuring
anything. **The escalation if it fires** (recorded now so apply does not improvise): fall back to the
replication shape — reimplement `runSearch` to hold chunk ids directly, and add back the drift
self-check comparing the replicated `(path, section, excerpt)` tuples against
`container.searchDocuments.execute(...)`, which must be 0. Everything else in this decision is
unchanged by that escalation.

**Binding parameters** — each one changes every number if it is wrong:

| Parameter | Value | Why |
|---|---|---|
| Index mode | **hybrid** (`node dist/cli.js --root ejemplos index`, no `--lexical`) | Lexical-only changes which chunks occupy ranks 1-4 and makes the table non-comparable to the measured baseline (proposal, second implementation constraint) |
| Search mode | **hybrid** — a real embeddings provider, i.e. `createContainer` without `forceLexical` | An embeddings-free probe over a hybrid index still searches lexical-only and produces a different rank population. This is the one place the probe deviates from `excerpt-flatten-probe.mjs`'s "no model" property: with a warm cache it is a model **load**, not a download. Documented in the script header and in AGENTS.md |
| `k` | the config default, **5** (do not pass `k`) | `EvaluateSearch` uses `k * 3`; using 15 here would change the population. 22 queries × 4 supporting = 88, which is exactly the measured C2 |
| Database reuse | index **once**; do **not** reindex between the before and after runs | Excerpts are query-time, so the same database is valid for both runs, and reusing it removes a variable from the comparison |
| C2 denominator | the **flattened** chunk text, via `flattenWithMap(content, true)` with `buildExcerpt`'s exact empty-result second pass (`flattenWithMap(content, false)`) — never `chunk.content` | The defect exploration §11.4 caught. C6 keeps the correction visible |
| Population for every rate and mean | the **C2 population**, in both runs | C1/C3/C5 percentages and C4's mean are over the same set before and after, which is what makes the columns comparable. Confirmed against §11.4: 8/88 = 9.1%, 69/88 = 78.4%, 8/88 = 9.1% |

**The criteria, each with its exact computation:**

| # | Counts | Gate |
|---|---|---|
| **C1** | Supporting fragments (rank ≥ 1) whose `excerpt` shows **zero** query terms: no `foldForMatch(term)` is a substring of `foldForMatch(excerpt)` | Baseline > 0 (expected 8); **after: must be 0** |
| **C2** | Supporting fragments whose **flattened** chunk text contains ≥ 1 folded query term — the anti-vacuity denominator | **> 0** in every run (expected 88) |
| **C3** | Of the C2 population, fragments whose excerpt both starts and ends with `…` | Reported (expected 0 → 69, 78.4%) |
| **C4** | Mean number of distinct query terms visible in the excerpt, over the C2 population | Reported (expected 2.40 → 4.00) |
| **C5** | Fragments with a hard mid-word edge: strip the ellipses to get `body`, take `idx = flat.indexOf(body)`; a leading cut is `excerpt` starting with `…` and `flat[idx - 1] !== " "`, a trailing cut is `excerpt` ending with `…` and `flat[idx + body.length] !== " "` | Reported (expected 0 → 8, 9.1%). `idx === -1` is impossible in principle and counted separately rather than silently skipped |
| **C6** | Fragments excluded from C2 because their query terms exist in `chunk.content` but not in the flattened text | Reported (expected 0 on `ejemplos/`, 1 on demo-docs) — keeps §11.4's correction visible |
| **C7** | Fragments whose `(path, section)` did not resolve to exactly one chunk | **Must be 0** |

**Self-checks and their messages, checked in this order and never conflated** — the precedent is
`excerpt-fence-drop-probe.mjs:117-141`:

1. `C7 > 0` → `CANNOT IDENTIFY THE MEASURED CHUNK`, exit 1.
2. `C2 === 0` → `GATE IS VACUOUS`, exit 1. Vacuity is checked before the fix condition because a
   vacuous run's C1 is meaningless.
3. `C1 > 0` → `THE FIX DID NOT LAND`, exit 1.

**The baseline run is expected to exit 1 with `THE FIX DID NOT LAND` and C1 = 8.** That is not a
problem to be worked around — it is the gate demonstrating it can fail, and the fence-drop gate's
recorded table has exactly this shape. Both exit codes belong in `verify-report.md`.

**Invocation, and how Gate B is served without a new fixture:**

```
node scripts/supporting-anchor-probe.mjs <root> [goldenset] [--query "<text>" ...]
```

`goldenset` defaults to `<root>/goldenset.yaml`. When at least one `--query` is given the goldenset
is **not read at all**, which is how Gate B runs a known-vacuous query set
(`--query "qwertzuiop plughxyzzy frobnicate" --query "blorptastic wibblefrotz"`) without committing a
nonsense fixture — the proposal's "no new fixtures" holds. The goldenset reader indexes `pregunta`,
which is Spanish and frozen; it carries an `// es-frozen:` comment exactly as `cli.ts:315,321,323`
does, so the archive phase's Spanish-vocabulary check reads it as intentional.

**Imports**, all from `dist/` (no production surface widened, following
`excerpt-fence-drop-probe.mjs`'s header note): `createContainer` (`dist/composition.js`),
`flattenWithMap` (`dist/domain/flatten-map.js`), `tokenizeQuery` + `foldForMatch`
(`dist/domain/match-location.js`), and `parse` from `yaml`, a runtime dependency the CLI already
uses. **Deliberately NOT imported**: `buildExcerpt` and `locateSpans` — the probe must observe the
excerpt the pipeline produced, never recompute one and compare it to itself.

### Decision 7: new coverage lives in a new `describe` inside an existing canary file, and "blast radius" is counted on edits, not on additions

The spec delta (already authored) adds three scenarios with no existing test: a supporting fragment
carrying both ellipses within its own budget, non-positional selection at a supporting rank, and a
term surviving only in a stripped heading falling back to the prefix. New requirement scenarios need
coverage; this repository does not ship an uncovered scenario.

That collides with the proposal's Gate D, which reads *"exactly two test files changed"* and *"911
passing"*. **The distinction that resolves it, and which apply must report as two separate numbers:**

- **Files whose existing assertions changed** — the blast-radius signal, and the thing Gate D
  actually protects. **Must be exactly 2.** A third falsifies exploration §1b/§11.1 and stops the
  change.
- **Files with additions only** — deliberate new coverage, unbounded, but each added test must map to
  a named spec scenario.

**Placement**: the three new tests go into a **new `describe` block appended to
`test/application/search-documents-spans.test.ts`**, not into a new file. Two reasons: the file count
stays 52, so Gate D's other criteria stay literally checkable; and that file is already the home of
"which ranks get spans" behaviour, driven by an in-memory `SqliteIndexStore` with the existing
`seedDoc` helper — no corpus fixture, consistent with the proposal's "no new fixtures". The canary
`describe` above it keeps a pure-inversion diff that a reviewer can read in isolation.

**The heading-only test must be built so it can fail.** A naive version — seed a chunk whose only
occurrence of the term is in its heading line, assert the supporting excerpt is the prefix — passes
**before and after** the change, since supporting fragments are prefixes today. It would be
coverage that discriminates nothing. The test therefore seeds **two** supporting documents in one
search: a control whose term occurs in body text past character 120 (asserted windowed, red before
the change) and the subject whose term occurs only in its heading line (asserted prefix, green in
both states). Together they assert what the requirement actually says: spans *are* computed at this
rank, and this fragment still fell back.

Gate D's count therefore becomes: **911 + (number of added tests, expected 3) passing, 1 skipped, 52
files**, with the two canary files' own test counts unchanged. Any *decrease* falsifies. This is a
deliberate amendment to the proposal's literal figure, recorded rather than smoothed.

### Decision 8: `matchedTerms` is deferred as a greppable named follow-up in `AGENTS.md`

Per the answered question round (#3), on the `isFenceDelimiter` precedent — a deferral that survives
only inside an archived report has to be rediscovered by a whole new SDD cycle, which is exactly what
happened to `isFenceDelimiter` twice. The precedent's shape is a bullet whose first sentence is a
greppable claim, which then records the trigger, the deferral count, and the identified candidate.
The bullet to add:

> - **`matchedTerms` is a NAMED, DEFERRED follow-up, not an unrecorded idea** (`supporting-excerpt-anchoring`,
>   explicit user decision 2026-09-05). Surfacing which query terms a result's chunk contains — a
>   `matchedTerms: string[]` per `search_docs` result, built from the `terms` already hoisted once per
>   search (`search-documents.ts:108`) and, **since this change, from spans that now exist at every
>   rank** — is estimated at ~25-30 tokens per response, against the +274 tokens per response a
>   400-character supporting budget was measured to cost. It is deferred because it is **unmeasured**
>   and because it widens the MCP response contract, and this change deliberately rests on complete
>   measured evidence. **What should fire it**: agent traces showing supporting hits driving excess
>   `read_doc` chaining — the same observation that would reopen the both-ellipsis trade — or the next
>   change that widens `SearchResultItem` for any other reason. Deferral count: 1.

Recording "deferral count: 1" is deliberate: the `isFenceDelimiter` bullet's usefulness comes from
being able to say "three deferrals is the point at which 'cheap later' stops being an argument".

## Flow notes

Per `rules.design`. Line numbers are current, pre-change.

```
SearchDocuments.runSearch (search-documents.ts:83)
  │
  ├─ lexicalIds / vectorIds / reciprocalRankFusion / capPerDocument   :90-102  ── UNCHANGED (Gate C)
  ├─ terms = tokenizeQuery(query.query)                               :108     ── UNCHANGED (hoisted)
  │
  └─ for entry of top:                                                :110
        rank  = results.length                                        :118
        spans = locateSpans(chunk.content, terms)                     :123  ← the whole change
        excerpt = buildExcerpt(chunk.content, excerptBudget(rank), spans)   :128
                                             └─ 1400 | 120, UNCHANGED
```

Inside `buildExcerpt` at a **120-character** budget — the same code, a new population reaching it:

```
flat = flattenWithMap(raw, true)  [+ second pass if empty]      :61,68   ── ALREADY ran for every
   │                                                                        rank; adds no work
   ├─ flat.text.length <= 120        → whole text, no ellipsis   :71     ── short chunks, unchanged
   ├─ flatSpans = mapSpansToFlat(...)                            :73
   │     └─ zero-width spans discarded — a term that did not survive
   │        flattening (heading line, dropped fence) is NOT locatable
   ├─ flatSpans is empty             → prefixExcerpt              :74     ── vector-only, fold-miss,
   │                                                                        heading-only. THE FALLBACK
   ├─ centre = selectMatchCentre(flatSpans, 120)                  :76     ── UNCHANGED; the sweep
   │                                                                        admits narrower clusters
   └─ computeWindow → clamp → snap → ellipses                     :79-82  ── UNCHANGED (Decision 3)
```

Measured population split on `ejemplos/` (22 goldenset queries, k=5, hybrid): 88 supporting
fragments have a locatable term in flattened text and take the window branch — after the change,
**0** of them show zero query terms, against 8 before. Fragments without a locatable term take the
prefix branch, unchanged and byte-identical.

## Interfaces / Contracts

No TypeScript signature changes anywhere. The full public-surface diff of this change is:

```ts
// src/application/search-documents.ts:123
- const spans = rank === 0 ? locateSpans(chunk.content, terms) : [];
+ const spans = locateSpans(chunk.content, terms);
```

The observable contract change is in `SearchResultItem.excerpt` for ranks ≥ 1, and it is specified
in `openspec/changes/2026-09-05-supporting-excerpt-anchoring/specs/mcp-contract/spec.md` (authored by
`sdd-spec`, not re-derived here): one ADDED requirement with three scenarios, one MODIFIED
requirement gaining a supporting-tier scenario, one REMOVED requirement, one RENAMED requirement.
Two destructive deltas — the removal, and the rename of `Lead Match Selection Is Not Positional` —
both flagged for `rules.archive`'s warning.

The probe's own contract:

```
node scripts/supporting-anchor-probe.mjs <root> [goldenset] [--query "<text>" ...]
  exit 0  — C7 === 0, C2 > 0, C1 === 0
  exit 1  — CANNOT IDENTIFY THE MEASURED CHUNK | GATE IS VACUOUS | THE FIX DID NOT LAND
```

## The gates, made mechanically checkable

Gates A-E are the proposal's. What this section adds is the exact command sequence and the two
amendments Decision 7 and Decision 2 introduce.

```
# once, before anything — the database both probe runs share
npm run build
node dist/cli.js --root ejemplos index          # hybrid, NOT --lexical

# Gate A, baseline (pre-change src, pre-change dist)
node scripts/supporting-anchor-probe.mjs ejemplos
#   expect: C2 = 88, C1 = 8 (9.1%), C3 = 0, C4 = 2.40, C5 = 0, C6 = 0, C7 = 0
#   expect: exit 1, "THE FIX DID NOT LAND"   ← the gate proving it can fail

# Gate B, on the same build, and again after the change
node scripts/supporting-anchor-probe.mjs ejemplos --query "qwertzuiop plughxyzzy frobnicate" --query "blorptastic wibblefrotz"
#   expect: C2 = 0, exit 1, "GATE IS VACUOUS"

# ... TDD the canaries red, make the production edit, go green ...
npm run build                                    # do NOT reindex

# Gate A, after
node scripts/supporting-anchor-probe.mjs ejemplos
#   require: C1 = 0, C2 = 88 (identical population), C7 = 0, exit 0
#   record:  C3 ≈ 69 (78.4%), C4 ≈ 4.00, C5 ≈ 8 (9.1%), C6 = 0

# Gate C — identity, not a tolerance band
node dist/cli.js --root ejemplos eval
#   require: hybrid 1.00 / 0.943, lexical 0.95 / 0.856

# Gate D
npm test && npm run typecheck && npm run build
```

**A C2 that is not identical before and after is a signal, not noise.** C2 depends only on which
chunks reach ranks ≥ 1, and ranking is untouched; a moved C2 means either the ranking moved (which
Gate C would also catch) or the database was reindexed between runs. Print it, compare it, and if it
moved, stop.

**Amendment to Gate D** (Decision 7): `911 + 3` passing, 1 skipped, 52 files; exactly **2** files
with changed existing assertions; the added tests each named against a spec scenario.

**Amendment to Gate D's last bullet** (Decision 2): "each inverted canary demonstrated failing
against the pre-change build" is satisfied by the recorded step-2 red run, pasted verbatim, not by a
claim that it was seen.

## File Changes

| File | Action | Description |
|---|---|---|
| `src/application/search-documents.ts` | Modify | `:123` guard removed; `:119-122` comment replaced with Decision 1's text, carrying the measured cost |
| `test/application/search-documents-spans.test.ts` | **Invert + add** | Canary #1 inverted per Decision 2; header comment and `describe` title rewritten; a second `describe` adds the three spec-scenario tests (Decision 7) |
| `test/application/index-and-search.test.ts` | **Invert** | Canary #2 per Decision 2: `+ 1` → `+ 2`, `startsWith("…") === false` replaced by the compensating `some(startsWith("…"))`, comment rewritten. Lead bound and gradient assertion untouched |
| `scripts/supporting-anchor-probe.mjs` | **Create** | Decision 6. ~190 lines including the header contract |
| `src/server.ts` | Modify | `:120-121` middle literal only (Decision 5). Ellipsis sentence untouched |
| `AGENTS.md` | Modify | MCP tools §2 clause; graduated-budget bullet; new "Manual gate (`supporting-excerpt-anchoring`)" section; the `matchedTerms` deferral bullet (Decision 8) |
| `src/domain/excerpt.ts` | **Comment only** | `:49` stale Decision 7 citation. Zero executable change |
| `test/domain/excerpt.test.ts` | **Comment only** | `:123` same |
| `test/application/vector-only-excerpt.test.ts` | **Comment only** | `:60` same |
| `src/domain/flatten-map.ts`, `src/domain/match-location.ts`, `src/domain/ports.ts`, `src/domain/fusion.ts`, `src/infrastructure/**` | **Unchanged** | Stated so a reviewer does not have to check |
| `openspec/specs/mcp-contract/spec.md` | Modify | Via the already-authored delta; `sdd-archive`'s work, with two destructive-delta warnings |

**Delivery size — a design-phase forecast, above the proposal's, as this project's pattern predicts.**
Production ~12, canary inversions ~45, new scenario tests ~110, probe ~190, `server.ts` ~4,
`AGENTS.md` ~50, citations ~4 → **~415 changed lines**, against the proposal's 285-335. The growth is
Decision 7's new tests and the AGENTS.md gate section, both discovered at design. Counting the
already-written spec delta (~148 lines) puts the cycle near 560. One PR, per the answered question
round (#4).

## Testing Strategy

`strict_tdd: true`. Phase order is forced by Gate A's baseline-first requirement (the probe must
exist and run against unmodified code before the edit) and by Decision 2's red-run evidence.

| Phase | Unit of work | The failing test / falsifying run that comes first |
|---|---|---|
| 1 | Probe script | No unit test — the probe is verified by **Gate B**, run against a known-vacuous query set on this same build and required to exit 1 with `GATE IS VACUOUS`. A probe never observed failing has not been verified |
| 1 | Gate A baseline | The probe's own exit 1 / `THE FIX DID NOT LAND` with C1 = 8, recorded. If C1 is already 0 the gate is void and the query set must be widened before proceeding |
| 2 | Canary #1 inversion | Rewritten assertions run against unmodified `src/` — MUST fail on `toContain("zulu")` and on the byte-identity-with-window assertion. Output recorded verbatim |
| 3 | Canary #2 inversion | Rewritten assertions run against unmodified `src/` — MUST fail on `some(startsWith("…"))`. Output recorded verbatim |
| 4 | Spec scenario: supporting fragment both ellipses within `SUPPORTING_EXCERPT_CHARS + 2` | Red pre-change (a prefix never starts with `…`) |
| 5 | Spec scenario: non-positional selection at a supporting rank | Red pre-change (a prefix always shows the opening text). Fixture shape: a frequent term early, a distinctive term later, both windows fitting 120 |
| 6 | Spec scenario: term only in a stripped heading falls back | Control + subject in one search (Decision 7). The **control** assertion is red pre-change; the subject assertion is green in both states by design and is there to pin the fallback |
| 7 | Production edit | All of phases 2-6 go green. Nothing else in the suite moves |
| 8 | Gate A after / Gate B again / Gate C | C1 = 0, C2 unchanged at 88, exit 0; vacuity guard still fires; `eval` identical to four decimals |
| 9 | Prose and citations | Gate E, checked by reading — plus the `server.ts` split-literal trap, which no grep will confirm |

**Not tested, deliberately**: the both-ellipsis and hard-cut rates. They are measured by the probe
and recorded in `verify-report.md`, never asserted — a test pinning "78.4%" would fail on any corpus
edit and would encode an accepted cost as a requirement.

## Migration / Rollout

**No migration, no schema marker, no shim, no reindex — in either direction.** The excerpt is
computed at query time from `chunk.content` (`search-documents.ts:128`) and is never persisted;
`AGENTS.md`'s "a `chunk.maxTokens` change needs a full `compendio index`" rule is about *persisted*
values and does not apply here. A running `compendio serve` picks the change up on restart, with no
cache invalidation and no fingerprint churn. Beta, no installed users
(`openspec/config.yaml`, `rules.proposal`).

Rollback is `git revert` plus `npm run build`, and it restores the removed spec requirement with the
same commit. This is the cheapest rollback profile available — which is the argument for shipping on
a measured proxy and observing real use, and is not an argument that the proxy is proof.

## Open Questions

- [x] **Whether C7 fires on `ejemplos/`. ANSWERED: no.** Measured at the review gate — 29 chunks, **0**
      duplicate `(document_id, heading)` pairs, largest chunk 1332 chars against a ~1920-char
      (480-token) split threshold, so `splitToBound` never splits a section on this corpus and the
      shape C7 guards against cannot occur. Decision 6's escalation stays as contingency for another
      corpus; it is no longer a live unknown. See "Review response" below. Apply still reports the
      number.
- [ ] **Whether canary #2's `some(startsWith("…"))` holds on the `email duplicado` query.** C3 = 78.4%
      corpus-wide makes it near-certain across four supporting fragments; it is not certain. The
      documented response is to move the test to another goldenset query and record both, never to
      drop the assertion.
- [ ] **Whether the probe's model load is acceptable in practice.** With a warm cache it is seconds;
      on a cold cache it is a ~129 MB download that `excerpt-flatten-probe.mjs` never needed. The
      alternative (search lexical-only) is cheaper and produces numbers that cannot be compared to the
      measured baseline, so it was rejected — but if the download cost proves prohibitive on CI, the
      honest fix is to document the gate as local-only, not to change its search mode.
- [ ] **Residual, stated not fixed**: `locateSpans` matches folded substrings, so a query term can
      match inside a longer word (`the` inside `theory`). Carried forward verbatim from the ancestor's
      Open Questions. This change makes it reach the supporting tier as well, at a budget where the
      in-chunk IDF has less material to de-weight with. No measured instance; recorded so the next
      cycle that touches the locator has the pointer.

---

## Review response (orchestrator, fresh-context reliability review, 2026-09-05)

`review-reliability` reviewed this design in fresh context, verifying against the tree and by
executing `dist/domain/excerpt.js` and `dist/domain/match-location.js` directly. It found **no
blocker**. Four items; two are closed here, two are recorded as accepted.

**Verified sound and left alone** (re-checked by the orchestrator where cheap): Decision 5's
citation inventory is complete and correct — an independent enumeration of all 15 "Decision 7"
occurrences classified identically, including the `index-and-search.test.ts` both-kinds trap.
Decision 7's arithmetic matches the tree (52 files / 911 passed / 1 skipped), and no third
excerpt-related test file is at risk — `excerpt-window.test.ts` asserts only on `results[0]`.
Canary #1's proposed assertions were executed against the unmodified `buildExcerpt`/`locateSpans`
and every claim holds verbatim. Every line-number claim in Decisions 1, 3 and 5 matches.

### CLOSED — C7 does not fire on `ejemplos/`. The Open Question is answered, not carried.

Measured directly against `ejemplos/.compendio/compendio.db` (orchestrator, independently of the
reviewer):

```
chunks: 29 | duplicate (document_id, heading) pairs: 0 | largest chunk: 1332 chars
```

The largest chunk is 1332 characters, well under the ~1920 (480-token) threshold at which
`splitToBound` would split a section and hand two pieces the same heading. **The shape C7 guards
against cannot occur on this corpus.** Decision 6's escalation stays in the design — it is the right
thing to have if the gate is ever pointed at another corpus — but it is contingency, not a live
unknown entering apply. Apply still reports the number.

### CLOSED — Gate A's self-check must compare the population's IDENTITY, not only its size

Decision 6's stated safeguard is "if C2 moved, stop". The reviewer found the hole, and it is real:
**a run-to-run swap of *which* chunk occupies a rank slot, holding the population size constant,
passes an unchanged C2 while corrupting C1/C3/C4/C5**, which are all computed over that population.
Counting is not identity.

**Binding amendment to Decision 6**: the probe MUST emit, alongside C1-C7, an ordered digest of the
population it measured — the `(query, rank, path, section)` tuples, in emission order. Gate A
compares that digest between the before and after runs and **fails on any difference**, not merely
on a changed count. A digest mismatch means the two runs measured different populations and the
before/after table is meaningless; that must be a hard failure with its own message, distinct from
`THE FIX DID NOT LAND`.

Determinism itself was checked and holds on this environment: two separate `node` processes running
`createContainer(...).searchDocuments.execute({ query: "email duplicado", k: 5 })` against the built
`ejemplos/` index returned byte-identical results, excerpts included. That is evidence the
assumption is true here, not a reason to omit the check — this project's standing rule is that a
mechanism never observed failing has not been verified, and the digest is what makes a future
violation observable.

### ACCEPTED, RECORDED — G4's vacuousness blocklist is a named list, not a closed definition

G4 forbids specific literal forms. It cannot forbid every "technically present, practically vacuous"
assertion — a deliberately loose numeric bound would satisfy both G1 (expect-count does not
decrease) and G4 (not on the list) while discarding the substance.

The real backstop is **G2**, the mandatory pre-change red run pasted verbatim into
`verify-report.md`: a vacuous assertion would pass against the OLD code too, so it cannot produce a
genuine red run. Defeating G2 requires fabricating a plausible failure log by hand — higher effort
and higher risk than the deletion the gate exists to catch, but not something the gate mechanically
prevents. The reviewer executed this design's *actual* proposed replacement assertions and confirmed
they discriminate correctly, so this is a limit of the gate's general robustness, not a defect in
this change. Recorded as a known limit rather than hardened, because hardening it means enumerating
vacuity, which has no closed form.

### ACCEPTED, RECORDED — this design overloads "Decision 8" the way the repo already overloads "Decision 7"

Decision 8 (the `matchedTerms` deferral) becomes another meaning for a label already carrying at
least three live, distinct citations in `src/`, each pointing at a different archived design:

- `src/cli.ts:82` — *"`index` -- is absent from this command (design.md Decision 8)."*
- `src/infrastructure/config.ts:242`
- `src/domain/match-location.ts:4` — cites `match-centred-excerpt`'s own Decision 8, the direct
  ancestor of this change

Plus at least five archived `design.md` files with their own Decision 8. **Nothing is at risk in
this cycle** — none of those citations live in a file this change edits, so Decision 5's
find-and-replace trap does not extend to them. But it is the same class of problem this design
itself documents, and a future grep for "Decision 8" will land on unrelated code.

Recorded, not fixed, and the reason is worth stating plainly: fixing it means a repo-wide convention
for citing archived design decisions by change slug rather than bare number — real work, unrelated
to excerpt anchoring, and exactly the kind of scope creep this cycle has otherwise refused. **The
next change that has to disambiguate a bare `Decision N` citation should do it**, and this paragraph
is the greppable pointer, on the `isFenceDelimiter` precedent this design already invokes.
