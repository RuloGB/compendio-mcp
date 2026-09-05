# Tasks: Anchor Supporting Excerpts on the Match

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 440-480 (implementation only; see driver table) |
| 400-line budget risk | High |
| Chained PRs recommended | No |
| Suggested split | Single PR — **`size:exception` GRANTED** (user, 2026-09-05, with the 440-480 figure in front of them, not the proposal's 285-335) |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: **RESOLVED** — user granted `size:exception` on 2026-09-05.

The alternative offered and declined: split at the seam Phase 1 already has (PR1 = probe + baseline
against unmodified code, ~210 lines; PR2 = production edit + canary inversions + new tests + prose,
~233), both under budget with no exception. Declined in favour of keeping the change and its
falsifying gate in one reviewable unit. Recorded so a reviewer knows the size was a decision, not an
oversight — and so the next forecast comparison has a real number to check against: this project's
actuals have overshot the tasks-phase figure before (`bounded-chunk-size`: 555-695 forecast, 773
actual). Apply MUST report the real diffstat at the end.
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

### Why this number, and why it disagrees with the proposal

This project has a recorded pattern of the forecast growing every phase
(`bounded-chunk-size`: 240-420 explore → 555-695 tasks → 773 actual). This change repeats it:
proposal 285-335 → design ~415 (own admission, "above the proposal's, as this project's pattern
predicts") → this driver-based tasks estimate, below, **440-480**.

| Driver | Lines | Note |
|---|---|---|
| Production edit: `search-documents.ts` guard removal + Decision 1 comment | ~15 | |
| Canary #1 inversion (header, `describe` title, body) | ~25 | |
| Canary #2 inversion (`index-and-search.test.ts`) | ~20 | |
| Canary #1 new `describe` block — 3 spec-scenario tests (Decision 7) | ~110 | |
| `scripts/supporting-anchor-probe.mjs` (new) | ~210 | +20 over design's ~190 for the Review-response ordered-digest amendment (emit, persist, before/after compare, distinct failure message) |
| `src/server.ts:119-121` middle literal | ~4 | |
| `AGENTS.md` (MCP §2 clause, graduated-budget bullet, new Manual gate section, `matchedTerms` deferral bullet) | ~55 | |
| 3 stale `Decision 7` comment-only fixes | ~4 | |
| **Implementation total** | **~443** | midpoint of the 440-480 range |

**Not counted above**: the already-authored `openspec/changes/.../specs/mcp-contract/spec.md` delta
(~148 lines). It merges into `openspec/specs/` at `sdd-archive`, not as part of the `src/`/`test/`
PR a reviewer opens against this repository's code — counting it would conflate two different
review surfaces. If the orchestrator's convention counts it anyway, the full-cycle figure is
~590-630.

**This exceeds the 400-line budget as plainly as the instructions ask.** The proposal's one-PR
decision (Q4, "splitting would ship the production change without its own falsifying gate") was
made against a 285-335 estimate that was inside budget; the estimate has since grown past it twice.
That is new information the original consent did not cover, so `size:exception` needs an explicit
re-confirmation, not an inherited one — hence `Decision needed before apply: Yes` even though the
one-PR shape itself is not being reopened here.

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Phases 1-6, one PR, commits ordered gate-first (probe + canary inversions + new spec tests, all red, before the one-line production fix) | PR 1 | `size:exception` pending; the probe alone (~210 lines) is the single largest driver, same shape this repository's prior fence-drop/vector-reach probes took |

**Why not split**: the probe's own falsifying property (Gate A failing on unmodified code) has to
be visible in the same PR as the fix it gates, or a reviewer never sees the gate fail — the
proposal's own argument for one PR, and it survives the higher estimate.

## Phase 1: Probe Script — Gate A Baseline and Gate B (RED-observable — commits BEFORE the fix)

- [x] 1.1 Create `scripts/supporting-anchor-probe.mjs`, importing only from `dist/`: `createContainer`
      (`dist/composition.js`), `flattenWithMap` (`dist/domain/flatten-map.js`), `tokenizeQuery` +
      `foldForMatch` (`dist/domain/match-location.js`), `parse` from `yaml`. **Do NOT import
      `buildExcerpt` or `locateSpans`** — the probe observes the pipeline's output, never
      recomputes one to compare against itself (design Decision 6).
- [x] 1.2 Implement goldenset reading (`<root>/goldenset.yaml` default, `pregunta` key, `// es-frozen:`
      comment) and a `--query "<text>"` override that, when given at least once, skips the goldenset
      entirely.
- [x] 1.3 Implement **C7** first, before any other measurement: for each supporting fragment (rank ≥
      1), collect every chunk of that document whose `heading === result.section`. Exactly one →
      measure it. Zero or more than one → increment C7, print `(query, path, section,
      candidateCount)`, measure nothing for that fragment. `C7 > 0` is a hard failure with its own
      message, `CANNOT IDENTIFY THE MEASURED CHUNK`, checked before every other self-check.
- [x] 1.4 Implement C1 (zero query terms visible via `foldForMatch` substring check), **C2 computed
      over the flattened chunk text** (`flattenWithMap(content, true)`, with `buildExcerpt`'s exact
      empty-result second pass `flattenWithMap(content, false)`) — **never `chunk.content`** — C3
      (both-ellipsis, over the C2 population), C4 (mean distinct terms visible, C2 population), C5
      (hard mid-word edge per the documented formula), C6 (fragments excluded from C2 because their
      terms exist in `chunk.content` but not the flattened text).
- [x] 1.5 **Binding amendment (Review response)**: emit an ordered digest of `(query, rank, path,
      section)` tuples, in emission order, alongside C1-C7, for every measured result. Write it to a
      file the caller names (or a fixed path per run, e.g. `<root>/.compendio/gate-a.digest`) so two
      separate invocations can be diffed.
- [x] 1.6 Implement the self-checks in this exact order, never conflated: `C7 > 0` →
      `CANNOT IDENTIFY THE MEASURED CHUNK`, exit 1. `C2 === 0` → `GATE IS VACUOUS`, exit 1 (checked
      before the fix condition — a vacuous run's C1 is meaningless). `C1 > 0` →
      `THE FIX DID NOT LAND`, exit 1. Otherwise exit 0.
- [x] 1.7 Confirm the binding parameters are wired correctly: index mode hybrid (`node dist/cli.js
      --root ejemplos index`, never `--lexical`); search mode hybrid (`createContainer` without
      `forceLexical`); `k` is the config default (do not pass `k`); the same database serves both the
      before and after runs (index once, never reindex between them).
- [x] 1.8 `npm run build`, then `node dist/cli.js --root ejemplos index` (hybrid, once — this database
      is reused through Phase 5). Run Gate B first: `node scripts/supporting-anchor-probe.mjs ejemplos
      --query "qwertzuiop plughxyzzy frobnicate" --query "blorptastic wibblefrotz"`. **Require**: exit
      1, `GATE IS VACUOUS`, C2 = 0. Record verbatim in `verify-report.md` — a probe never observed
      failing has not been verified.
- [x] 1.9 Run Gate A baseline on unmodified code: `node scripts/supporting-anchor-probe.mjs ejemplos`.
      **Require**: C2 = 88, C1 = 8 (9.1%), C3 = 0, C4 = 2.40, C5 = 0, C6 = 0, C7 = 0, exit 1,
      `THE FIX DID NOT LAND`. If C1 is already 0 the gate is void and the query set must widen before
      proceeding. Save the emitted digest as `gate-a-before.digest` and record the full output
      verbatim in `verify-report.md`.

## Phase 2: Canary Inversions (RED-observable — commits BEFORE the fix)

- [x] 2.1 In `test/application/search-documents-spans.test.ts`, rewrite the header comment (`:15-19`)
      and the `describe` title (`:19`) from "spans are computed for rank 0 only (Decision 7)" to
      "spans are computed for every rank", citing `supporting-excerpt-anchoring` — this is G3 for this
      file.
- [x] 2.2 Invert the test body (`:37-68`, currently "a supporting (non-rank-0) result's excerpt stays
      a start-anchored prefix, never a window"). New title states the opposite. New assertions:
      `expect(supporting!.excerpt).toContain("zulu")`; byte-identity against
      `buildExcerpt(supportingContent, SUPPORTING_EXCERPT_CHARS, locateSpans(supportingContent,
      tokenizeQuery("zulu")))`; keep `expect(supporting!.excerpt).not.toBe(buildExcerpt(supportingContent,
      SUPPORTING_EXCERPT_CHARS, []))` as the old reference (a regression to prefixes fails here);
      `expect(supporting!.excerpt.startsWith("…")).toBe(true)`; `length <= SUPPORTING_EXCERPT_CHARS +
      2`. **G1**: the `expect(` count in this test must not decrease. **G4**: the only permitted
      weakening anywhere in this change is `+1` → `+2`, and it lands in Phase 2.3, not here.
- [x] 2.3 Invert `test/application/index-and-search.test.ts:185-204` (canary #2). `+1` → `+2` at
      `:190`-equivalent (the one G4-permitted weakening). Replace `startsWith("…") === false` (`:198`)
      with the compensating strengthening `expect(supporting.some((r) =>
      r.excerpt.startsWith("…"))).toBe(true)` — false before this change by construction, true after.
      Keep the lead bound (`LEAD_EXCERPT_CHARS + 2`) and the gradient assertion
      (`lead.excerpt.length > longest supporting`) unchanged. Rewrite the inline comment (`:192-196`)
      to record the inversion, the unchanged 1400/120 budgets, and what would break it (G3). **If
      `some(startsWith("…"))` is observed 0-of-4 on this corpus's `email duplicado` query**, move the
      test to another goldenset query and record both queries in `verify-report.md` — never drop the
      assertion.
- [x] 2.4 Run `npx vitest run test/application/search-documents-spans.test.ts
      test/application/index-and-search.test.ts` against **unmodified**
      `src/application/search-documents.ts`. **Both canaries MUST fail.** Paste the verbatim failure
      output (test name + failing assertion) into `verify-report.md` — this is **G2**, the mandatory
      pre-change red run, and it cannot be produced after the edit. This task is sequenced before
      Phase 4 by construction: `search-documents.ts` is not touched until Phase 4.1.

## Phase 3: New Spec-Scenario Tests (RED-observable — LAST commit before the fix)

- [x] 3.1 Append a **new `describe` block** to `test/application/search-documents-spans.test.ts`
      (same file — keeps the file count and the blast-radius signal at exactly 2 files with changed
      *existing* assertions; this file already drives an in-memory `SqliteIndexStore` via `seedDoc`,
      no corpus fixture needed).
- [x] 3.2 Test: a supporting fragment whose flattened match sits past character 120 and short of the
      chunk's end — assert `excerpt.startsWith("…")`, `excerpt.endsWith("…")`, `length <=
      SUPPORTING_EXCERPT_CHARS + 2`. Traces spec scenario "A supporting fragment centred away from
      both edges carries both ellipses within its own budget." Red pre-change (a prefix never starts
      with `…`).
- [x] 3.3 Test: a chunk with a high-frequency term near the start and a distinctive term clustered
      elsewhere, both candidate windows fitting `SUPPORTING_EXCERPT_CHARS` — assert the supporting
      excerpt centres on the distinctive-term region, not the early high-frequency neighbourhood.
      Traces "The same preference holds for a supporting fragment." Red pre-change (a prefix always
      shows the opening text).
- [x] 3.4 Test pair, built so it can fail (Decision 7): a **control** document whose term occurs in
      body text past character 120 (assert windowed — red pre-change) and a **subject** document
      whose term occurs **only** in its own heading line, seeded in the same search (assert prefix —
      green in both states by design, since it pins the fallback rather than discriminating alone).
      Traces "A term present only in a stripped heading is treated as unreachable."
- [x] 3.5 Run `npx vitest run test/application/search-documents-spans.test.ts` against **unmodified**
      `src/`: 3.2 and 3.3 MUST fail; in 3.4, the control assertion MUST fail while the subject
      assertion passes. Record verbatim in `verify-report.md`.

## Phase 4: Production Fix (GREEN — the one-line change)

> **Commit-order note**: this is the ONLY phase that edits `src/`. Every commit in Phases 1-3 must
> already exist in branch history, red, before this phase's commit — so a reviewer of the single PR
> still watches the gate fail before the fix exists, diff by diff.

- [x] 4.1 Edit `src/application/search-documents.ts:123`: `const spans = rank === 0 ?
      locateSpans(chunk.content, terms) : [];` → `const spans = locateSpans(chunk.content, terms);`.
- [x] 4.2 Replace the comment at `:119-122` with design Decision 1's text verbatim (states the
      reversed ancestor decision `2026-08-06-match-centred-excerpt` Decision 7, the measured cost
      `+0.382 ms/search on ejemplos/ (29 chunks), +0.199 ms on an 888-chunk corpus`, and that it is
      still one branch serving lexical / vector-only / fold-miss).
- [x] 4.3 Run `npx vitest run test/application/search-documents-spans.test.ts
      test/application/index-and-search.test.ts`: both canaries and all 3 new spec-scenario tests now
      green. Nothing else in the suite should move at this point.

## Phase 5: Post-Fix Verification (Gate A after / Gate B again / Gate C)

- [x] 5.1 `npm run build`. **Do NOT reindex** — the `ejemplos/.compendio` database from Phase 1.8 is
      reused; excerpts are query-time, so the same database is valid for both runs.
- [x] 5.2 Re-run `node scripts/supporting-anchor-probe.mjs ejemplos`. **Require**: C1 = 0, C2 = 88
      (identical population), C7 = 0, exit 0. Record C3 ≈ 69 (78.4%), C4 ≈ 4.00, C5 ≈ 8 (9.1%), C6 = 0
      in `verify-report.md`.
- [x] 5.3 **Binding amendment (Review response)**: diff this run's digest against
      `gate-a-before.digest` (Phase 1.9). Identical population is a size match AND a tuple-for-tuple
      match — a swap of which chunk occupies a rank slot while the count holds steady is a distinct
      failure, `POPULATION DRIFTED BETWEEN RUNS`, never conflated with `THE FIX DID NOT LAND`. Record
      the comparison result verbatim; a mismatch stops the change for re-analysis.
- [x] 5.4 Re-run Gate B after the fix (same nonsense-query invocation as 1.8): confirm it still exits
      1 with `GATE IS VACUOUS`, C2 = 0 — the anti-vacuity guard fires identically in both tree states.
- [x] 5.5 Run `node dist/cli.js --root ejemplos eval`. **Require identity, not a tolerance band**:
      hybrid recall@5 = 1.00, MRR = 0.943; lexical 0.95 / 0.856. `evaluate-search.ts` never reads
      `.excerpt`, so any movement means the change breached its own scope (Gate C).
- [x] 5.6 Measure C7's underlying shape directly against `ejemplos/.compendio/compendio.db` (count of
      duplicate `(document_id, heading)` pairs and the largest stored chunk size). Expected 0 pairs,
      confirming the design's CLOSED open question — still report the number, per design ("apply
      still reports the number").

## Phase 6: Prose, Citations, and Full Suite (Gate D / Gate E)

- [x] 6.1 Edit `src/server.ts:119-121`'s **middle string literal only** — replace "the rest carry
      short ones from the start of " + "their section, enough to tell..." with Decision 5's
      replacement ("...the rest carry short ones, centred on their own match, enough to tell whether
      the top result is the right one."). **Do NOT touch `:123-125`'s ellipsis-contract sentence** —
      it is still true and must not be rewritten.
- [x] 6.2 Edit `AGENTS.md`'s MCP tools §2 clause: replace "...the rest get
      `SUPPORTING_EXCERPT_CHARS` (120) as a start-anchored prefix, enough to judge whether rank 1 is
      the right one" with Decision 5's replacement text, naming the fallback conditions (vector-only /
      fold-miss, and a term surviving only in a heading line).
- [x] 6.3 Edit `AGENTS.md`'s "excerpt budget is graduated by rank" bullet: state first what did NOT
      change (1400/120 split untouched, graduated policy not re-litigated), then both accepted costs
      with measured numbers (`ejemplos/`: both-ellipsis 0% → 78.4%, hard mid-word cuts 0% → 9.1%;
      external demo-docs 84.4% / 3.4%, corroborating, not reproducible here), the ellipsis-frequency
      shift and its unproven behavioural effect, and a pointer to the probe.
- [x] 6.4 Add a new "Manual gate (`supporting-excerpt-anchoring`)" section to `AGENTS.md`'s Commands
      area, following the `vector-reach` / `section-lookup` / `excerpt-fence-drop` precedent: the
      exact command sequence from Phases 1.8-5.4, what C1-C7 (plus the digest) count, and the measured
      before/after table.
- [x] 6.5 Add the `matchedTerms` deferred-follow-up bullet to `AGENTS.md` verbatim, per design
      Decision 8 (deferral count: 1, the `isFenceDelimiter` precedent).
- [x] 6.6 Fix exactly 3 stale `Decision 7` comments: `src/domain/excerpt.ts:49`,
      `test/domain/excerpt.test.ts:123`, `test/application/vector-only-excerpt.test.ts:60` — re-cite
      the empty-spans path as the ancestor's Decision 6, and note Decision 7 is reversed by
      `supporting-excerpt-anchoring`. **Comment-only, zero executable change.** **Do NOT touch** any
      of the other 12 `Decision 7` citations in this repository (`src/composition.ts:114`;
      `src/domain/convention.ts:45,165`; `test/domain/convention.test.ts:58,153`;
      `test/application/read-document.test.ts:36`; `test/application/index-and-search.test.ts:331`;
      `test/helpers/build.ts:115`) — those belong to `multiple-doc-roots`'s own Decision 7. A
      grep-and-replace on "Decision 7" corrupts them. `index-and-search.test.ts` carries one citation
      of each kind (`:193`, already rewritten in Phase 2.3; `:331`, untouched) — confirm by reading,
      do not re-touch `:331`.
- [x] 6.7 Run `npm test`, `npm run typecheck`, `npm run build`. **Require**: 911 + 3 passing (914), 1
      skipped, 52 files.
- [x] 6.8 `git diff --stat main..HEAD -- src/domain/flatten-map.ts src/domain/match-location.ts
      src/domain/ports.ts src/domain/fusion.ts src/infrastructure` → empty output, confirming design's
      asserted non-touches.
- [x] 6.9 Confirm and record in `verify-report.md`, as two separate numbers per design Decision 7:
      **files with changed existing assertions** (must be exactly 2 —
      `search-documents-spans.test.ts`, `index-and-search.test.ts`; a third falsifies the blast-radius
      claim and stops the change) and **files with additions only** (unbounded, each new test mapped
      to a named spec scenario).

## Traceability

| Spec scenario | Task(s) |
|---|---|
| Supporting fragment centres on the match, not the opening text | 2.2, 4.1, 4.2, 4.3 |
| No locatable term falls back to the start-anchored prefix | 2.2 (`not.toBe([])` reference), existing `vector-only-excerpt.test.ts` coverage (untouched, Decision 4), 6.6 |
| A term present only in a stripped heading is treated as unreachable | 3.4 |
| A supporting fragment centred away from both edges carries both ellipses within its own budget | 3.2 |
| The same preference holds for a supporting fragment (non-positional selection) | 3.3 |
| Window at the start / end omits the leading / trailing ellipsis; both-edges within budget (rank-1) | Pre-existing coverage, unchanged (Decision 3: `computeWindow` frozen) |
| Gate A (anchoring lands, population identity) | 1.1-1.9, 5.2, 5.3 |
| Gate B (vacuity guard verified) | 1.8, 5.4 |
| Gate C (retrieval scope unmoved) | 5.5 |
| Gate D (blast radius, full suite) | 6.7, 6.8, 6.9 |
| Gate E (contract prose is true) | 6.1, 6.2, 6.3, 6.4 |
| `matchedTerms` deferral recorded as a greppable follow-up | 6.5 |
