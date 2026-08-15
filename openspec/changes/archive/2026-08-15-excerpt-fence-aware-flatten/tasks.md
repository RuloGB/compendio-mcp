# Tasks: A Fence-Aware `stripHeadingLines` for `search_docs` Excerpts

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 252-440 (design.md Delivery size) |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR — no natural cut (one function, one requirement per design.md) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: **RESOLVED — see "Delivery decision" below**
Chained PRs recommended: No
Chain strategy: n/a (single PR)
400-line budget risk: Medium

### Delivery decision (user, 2026-08-16)

**Single PR, `size:exception` accepted.** Recorded here rather than in `openspec/config.yaml`, which
carries no standing size exception; this is a fresh, change-scoped decision, not the continuation of
one taken for the sibling change.

Rationale for accepting over splitting: the only defensible boundary — production (Phases 1-2) versus
tests, probe script and docs (Phases 3-5) — would send the behaviour change to review without the
measurements that prove it reaches the live case, which is the opposite of what a review budget is
for. Trimming test breadth was also rejected: Gate 1 needs the probe script to read the **stored**
chunk, so cutting there removes the check on the motivating case itself.

`sdd-apply` proceeds on all five phases as one unit. If the actual diff overruns 440 lines, that is
information to record in `apply-progress`, not a trigger to re-open the split.

Rationale: the estimate's upper bound (440) sits above the 400-line budget even though the midpoint
does not, and this repo's forecasts have landed 1.3x-4x low for several cycles running (design.md).
`ask-on-risk` means the orchestrator confirms with the user before `sdd-apply` rather than silently
proceeding on the design's own "No" recommendation. If a split were forced despite no natural cut, the
only defensible boundary is **production (Phase 1-2) vs. tests+script+docs (Phase 3-5)** — but this
still ships one behavior across two PRs reviewed independently of its own test evidence, which is why
the design rejects it and this forecast does not recommend it.

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Phases 1-5, all in one PR | PR 1 | No split unless the user overrides after seeing this forecast |

## Phase 1: Fixtures and Golden Reference (RED first — strict_tdd)

- [x] 1.1 Add 4 fixtures to `GENERATED_INPUTS` in `test/domain/flatten-map.test.ts` (design D4): backtick fence containing `# a python comment`; fence-interior `#`-line with an odd backtick count; unterminated (odd-count) fence with a `#`-line inside; misaligned-even (stray closer, real `## Heading`, stray opener).
- [x] 1.2 Rewrite `referenceFlatten` (`:10-23`) per design D4's balanced/`inFence` loop, importing `isFenceDelimiter` from `../../src/domain/split-text`, with a dated comment on why the golden reference moved.
- [x] 1.3 Run `npm test`. Record verbatim: the I4 suite fails on the new fence-interior fixture(s); the I1-I3 suite passes in this same (unfixed) state. Do not proceed until this red result is captured.

## Phase 2: Production Fix (GREEN)

- [x] 2.1 Edit `stripHeadingLines` in `src/domain/flatten-map.ts:78-105`: import `isFenceDelimiter` from `./split-text.js`; hoist `HEADING_LINE_PREFIX = /^\s*#{1,6}\s/` with its CRLF why-comment (design D1); compute `balanced` before the loop; add `inFence` toggle with an `else if` branch — delimiter lines are emitted with map entries, never `continue`d (D2 trap).
- [x] 2.2 Update `stripHeadingLines`' doc comment to state the fence rule and its chunk-locality.
- [x] 2.3 Run `npm test`. Confirm I4 is now green for every fixture including the new ones, and I1-I3 stay green (Gate 3, first bullet).

## Phase 3: Additional Unit Coverage

- [x] 3.1 `test/domain/excerpt.test.ts`: add the fallback-path case — chunk is entirely one fenced block with a heading-pattern line inside; `dropFencedBlocks: true` empty, fallback fires, excerpt contains that line's text. Traces spec scenario "A fence-interior heading-pattern line is retained when the excluded pass is empty."
- [x] 3.2 Add the locatable-span case: a span on a retained fence-interior heading-pattern line yields `end > start` and survives filtering (D3, Gate 3 second bullet).
- [x] 3.3 Add the Gate 2 case: backtick fence + `# a python comment` — `dropFencedBlocks: false` gains `a python comment`; `dropFencedBlocks: true` stays byte-identical to `"Prose before. Prose after."`. Traces spec scenario "A fence holding a retained heading-pattern line is still recognized and dropped by the excluded pass."
- [x] 3.4 Add the Gate 4 measurement-only case: odd-backtick fence-interior `#`-line; record the `dropFencedBlocks: true` output verbatim before and after in a comment — no required outcome (D5/M1).
- [x] 3.5 Run `npm test`. Confirm all green and that the only modified existing assertion anywhere in the suite is `referenceFlatten` (Gate 5 last bullet) — existing cases at `excerpt.test.ts:31-43` and `flatten-map.test.ts`'s pre-existing fixtures stay untouched.

## Phase 4: Live Measurement — Probe Script

- [x] 4.1 Create `scripts/excerpt-flatten-probe.mjs`, following `scripts/section-lookup.mjs`/`vector-reach.mjs`: import `flattenWithMap`/`buildExcerpt` and `isFenceDelimiter` from `dist/`, `SqliteIndexStore` to read the stored `12. Templates` chunk directly — no model download.
- [x] 4.2 Implement Gate 1: both passes over the stored chunk; self-check exits non-zero unless `Business rules`/`Use cases`/`Out of scope` are present in pass 2 **and** pass 1 is still 0 chars.
- [x] 4.3 Implement D5's M2 scan: over every stored chunk, count fence-interior (balanced, via `isFenceDelimiter`) `#`-lines carrying an odd backtick count — explicitly excluding non-fence-interior `#`-lines with a backtick (the 4-false-hit trap, exploration §0b). Print the count; measurement only, no pass/fail.
- [x] 4.4 Run `node dist/cli.js --root . index --lexical`, then `node scripts/excerpt-flatten-probe.mjs .`. Record Gate 1's before/after and M2's count in the verify report (expect to reproduce §0b: 0 chars → tokens present, 21 fence-interior lines, 0 with backticks).
- [x] 4.5 Run `node dist/cli.js --root . search --lexical "business rules"`. Confirm the three tokens appear in the live CLI excerpt (Gate 1's end-to-end bullet).

## Phase 5: Docs and Full Suite

- [x] 5.1 Update `CLAUDE.md`'s *Non-obvious decisions*: excerpt flattening is fence-aware/chunk-local/balanced-only and shares the chunker's predicate; the four non-guarantees with shape 4's inverted consequence; the S2 `~~~`/interior-backtick follow-up; D6's fired-but-deferred `isFenceDelimiter`-module-move trigger; the probe script beside `section-lookup.mjs`.
- [x] 5.2 Run `npm test`, `npm run typecheck`, `npm run build` — all green (Gate 5).
- [x] 5.3 Run `node dist/cli.js --root ejemplos eval`. Confirm MRR ≥ 0.943, recall@5 = 1.00, top-1 ≥ 20/22 (unchanged).
- [x] 5.4 `git diff --stat` — confirm zero-line diffs on `src/domain/split-text.ts`, `src/domain/excerpt.ts`, `src/application/read-document.ts`.
- [x] 5.5 `git diff test/` — confirm `referenceFlatten` is the only modified existing test assertion in the whole change.

## Traceability

| Spec scenario | Task(s) |
|---|---|
| Fence-interior heading retained when excluded pass is empty | 3.1, 4.2 |
| Real heading outside a fence still dropped | existing `excerpt.test.ts` case, unmodified (5.5) |
| Odd delimiter count leaves behavior unchanged | 1.1, 2.3 (unterminated fixture) |
| Fence holding a retained line still recognized and dropped | 3.3 |
| Simple balanced fence still fully dropped | existing fixtures, unmodified (5.5) |
| Live case — `docs/documentation-convention.md` §12 | 4.2, 4.4, 4.5 |
