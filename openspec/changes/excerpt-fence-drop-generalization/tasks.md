# Tasks: One Regex Literal, and the Corpus That Makes It Falsifiable

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 465-720 (design.md D9) |
| 400-line budget risk | High |
| Chained PRs recommended | No (user override — see Delivery decision) |
| Suggested split | Single PR — `size:exception` accepted |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: No — resolved below
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

### Delivery decision (user, pre-tasks)

**Single PR, `size:exception` accepted.** Design D9 forecast 465-720 lines, recommended chaining
(gate-first PR #1, fix-only PR #2), and named the natural cut (`test/application/excerpt-fence-drop.test.ts`
+ `build.ts` constant, ~80-120 lines) as the trim lever if one PR was preferred. The user reviewed
both options and chose one PR over chaining. `sdd-apply` proceeds on all phases as one unit; if the
diff overruns, that is information for `apply-progress`, not a trigger to re-open the split.

**Why the gate must still land in earlier commits, even inside one PR**: chaining would have let a
reviewer watch Gate 1 fail on the unmodified tree before the fix existed. One PR only loses that
property if the commits are unordered. So this task list orders every gate artifact (fixture corpus,
`.gitattributes`, probe script, D4's inverted assertion) into commits that precede the one-line
production regex change. **The commit boundary between Phase 3 and Phase 4 below is the "gate is red
here" point** — see the note at the top of Phase 4.

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Phases 1-6, one PR, commits ordered gate-first | PR 1 | `size:exception`; no split |

## Phase 1: Gate Corpus (RED-observable — commits BEFORE the fix)

- [x] 1.1 Create `test/fixtures/excerpt-fence-drop/docs/tilde-fence.md` (LF): mixed prose + a `~~~json`
      fenced config example + closing prose, one chunk, no config file (zero-config `loose` mode).
- [x] 1.2 Create `test/fixtures/excerpt-fence-drop/docs/tilde-fence-crlf.md` — byte-identical content to
      1.1 but every line ending is CRLF (`\r\n`) on disk.
- [x] 1.3 Create `test/fixtures/excerpt-fence-drop/docs/interior-backtick-fence.md` (LF): mixed prose + a
      `` ```sh `` fence whose body contains one stray interior backtick (e.g. a comment quoting a
      backtick) + closing prose, one chunk.
- [x] 1.4 Create `test/fixtures/excerpt-fence-drop/docs/interior-backtick-fence-crlf.md` — byte-identical
      content to 1.3, CRLF line endings on disk.
- [x] 1.5 Create `test/fixtures/excerpt-fence-drop/docs/control-backtick-fence.md` (LF): a plain backtick
      fence with no interior backtick, no tilde — the byte-identical-before-and-after control case.
- [x] 1.6 Append two rules to `.gitattributes` (last-match-wins), with the why-comment from design D5:
      `test/fixtures/excerpt-fence-drop/** text eol=lf` then
      `test/fixtures/excerpt-fence-drop/docs/*-crlf.md text eol=crlf`. **Blocking, not optional**: this
      machine's `core.autocrlf=true` and the repo's current single-rule `.gitattributes` would otherwise
      normalize the two `*-crlf.md` fixtures to LF on checkout, silently degrading the CRLF half of Gate
      1 to LF-only.
- [x] 1.7 Verify on disk (`git show :test/fixtures/excerpt-fence-drop/docs/tilde-fence-crlf.md | file -`
      or equivalent) that the two `*-crlf.md` files carry `\r\n` after staging, proving 1.6 took effect
      before relying on it in later phases.

## Phase 2: Anti-Vacuity Probe (RED-observable — commits BEFORE the fix)

- [x] 2.1 Create `scripts/excerpt-fence-drop-probe.mjs`, importing only
      `flattenWithMap` from `dist/domain/flatten-map.js` and `SqliteIndexStore` from
      `dist/infrastructure/sqlite/sqlite-index-store.js` (design D6 — no `isFenceDelimiter` import).
- [x] 2.2 Implement C1 (chunks whose `flattenWithMap(content, true).text` still contains `~~~`) and C2
      (chunks whose raw content contains a `~~~` line at all — the anti-vacuity denominator) over every
      chunk in `<root>/.compendio/compendio.db`.
- [x] 2.3 Implement C3 (chunks with ≥ 2 fence delimiter runs whose `true` output is byte-identical to
      their `false` output) and C4 (the two `*-crlf.md` documents' stored chunk content contains `\r\n`).
- [x] 2.4 Implement C5: print `control-backtick-fence.md`'s `true` output verbatim (reported, not gated).
- [x] 2.5 Implement the self-check: exit non-zero unless `C2 > 0 && C4 holds && C1 === 0 && C3 === 0`.
      Two distinct failure messages — a C2/C4 failure prints `GATE IS VACUOUS — fix the corpus, do not
      touch the regex`; a C1/C3 failure prints a separate `the fix did not land` message. Do not conflate
      them (design D6).
- [x] 2.6 Run `npm run build`, `node dist/cli.js --root test/fixtures/excerpt-fence-drop index --lexical`,
      then `node scripts/excerpt-fence-drop-probe.mjs test/fixtures/excerpt-fence-drop`. **Record the
      exit code and C1-C5 verbatim in `verify-report.md`.** Expected: non-zero exit, C1 > 0, C3 > 0,
      C2 > 0, C4 true. Recorded verbatim in `apply-progress.md` (see Phase 2).
- [x] 2.7 Prove the anti-vacuity guard can itself fail: run
      `node dist/cli.js --root test/fixtures/excerpt-window index --lexical`, then
      `node scripts/excerpt-fence-drop-probe.mjs test/fixtures/excerpt-window`. **Record verbatim.**
      Expected: non-zero exit, `GATE IS VACUOUS` message, C2 === 0. A probe never seen failing on a
      known-empty corpus has not been verified (design D6). Recorded verbatim in `apply-progress.md`.

## Phase 3: D4's Inverted Assertion and I1-I4 Fixtures (RED-observable — LAST commit before the fix)

- [x] 3.1 In `test/domain/excerpt.test.ts`, invert the assertion at `:259-269` per design D4: new `it`
      title `"the interior-backtick fence is dropped from the excluded pass (was: the pinned defect)"`;
      assert `withFencesExcluded` equals `"Before text. After text."`, asserts
      `withFencesExcluded !== withFencesIncluded`, and asserts none of `["js", "# a comment with an odd",
      "const x = 1;"]` is contained. This is one of the **three** permitted existing-assertion changes in
      the whole diff (the others are `flatten-map.test.ts:32` and `excerpt.test.ts:198-218`'s D3 rewrite
      — see the note below task 4.3; the D3 rewrite was not anticipated at task-list authoring time and
      was added mid-apply with explicit user sign-off after `sdd-apply` stopped and reported it).
- [x] 3.2 Extend the 15-line comment block at `:235-258` to a third recorded state (append, do not
      delete the prior two), including the literal warning: `DO NOT "REPAIR" THIS BY REVERTING
      flatten-map.ts:35. The equality this test used to assert WAS the defect (S2 made zero
      replacements). Its divergence is the fix working.`
- [x] 3.3 Add a tilde-fence case to `test/domain/excerpt.test.ts` (mixed prose + `~~~json` fence): the
      excluded-pass excerpt contains none of the fence's delimiter lines or interior content, and
      contains the prose. Traces spec scenario "A tilde-fenced block is excluded from the lead excerpt."
- [x] 3.4 Add a CRLF-tilde case: the same fence content with `\r\n` line endings produces an
      excluded-pass output identical in kind to the LF case. Traces spec scenario "A CRLF-encoded tilde
      fence is excluded identically to an LF-encoded one."
- [x] 3.5 Add Gate 3b to `test/domain/flatten-map.test.ts` (design D2/D3, **additive**, direct `toBe`,
      NOT routed through `referenceFlatten`): two adjacent same-kind fences with prose between them —
      assert the prose survives and both fences are dropped. This is the one assertion that a symmetric
      greedy-regex typo in both literals would not be caught by I4 (which shares the literal).
- [x] 3.6 Add 5 fixtures to `GENERATED_INPUTS` in `test/domain/flatten-map.test.ts`: tilde fence (LF),
      tilde fence (CRLF), backtick-fence-nested-in-tilde-fence, tilde-fence-nested-in-backtick-fence,
      two-adjacent-same-kind-fences-with-prose-between. These feed I1-I3 and I4 automatically.
- [x] 3.7 Run `npm test`. **Record verbatim: Gate 2 (excerpt.test.ts D4 assertion) and the new tilde
      fixtures in flatten-map.test.ts are RED at this point** — production still carries the old
      `` /```[^`]*```/g `` regex. This is the commit-order requirement's "gate is red here" boundary:
      everything in Phases 1-3 is committed and observably failing before Phase 4 touches production.
      **Recorded verbatim in `apply-progress.md`, with one deviation flagged**: `excerpt.test.ts`'s
      Gate 2 assertion and the two new tilde cases ARE red (3 failures) as expected, but
      `flatten-map.test.ts` is fully green (109/109) — design D3 itself predicts this (I4 is not the
      red-first discriminator; see apply-progress.md's Phase 3 section for the full trace).

## Phase 4: Production Fix (GREEN — the one-line change)

> **Commit-order note**: this is the ONLY phase that edits `src/`. Every commit in Phases 1-3 must
> already exist in the branch history, red, before this phase's commit. That ordering is what lets a
> reviewer of the single PR still watch the gate fail before the fix exists, diff by diff.

- [x] 4.1 Edit `src/domain/flatten-map.ts:35`: `` /```[^`]*```/g `` becomes
      `` /```[\s\S]*?```|~~~[\s\S]*?~~~/g ``, same `trackedReplace(flat, regex, (m) =>
      singleSpaceAt(flat, m.index))` call. Update the quoting `// S2:` comment at `:33` to match the new
      literal. **Applied to the working tree, uncommitted — see BLOCKED status below.**
- [x] 4.2 Edit `test/domain/flatten-map.test.ts:32`'s `referenceFlatten` S2 line to the textually
      identical literal, **preserving branch order** (`` /```[\s\S]*?```|~~~[\s\S]*?```/g ``... backtick
      branch first, tilde branch second — design D3's leftmost-first alternation argument). This is one
      of the three permitted existing-assertion changes (with 3.1 and the D3 rewrite below). Committed
      in `d7c0d16`.
- [x] **RESOLVED (was BLOCKED).** Applying 4.1/4.2 broke a test `sdd-apply` had not been told to expect:
      `test/domain/excerpt.test.ts:198-218` (`"D3: a span on a retained fence-interior heading-pattern
      line becomes locatable and survives filtering"` — the sibling `excerpt-fence-aware-flatten`
      cycle's own test). Root cause: that test isolated S1's map-locatability claim from S2's fence-drop
      behaviour by using a `~~~` fence, which was invisible to S2's old backtick-only regex — an
      accident of the gap this change closes, not a designed property. Once S2 recognizes every fence
      style, no fence shape can isolate S1 from S2 through `buildExcerpt` any more (confirmed: an
      unterminated fence flips `balanced` false and strips the line from the other direction; an
      indented block has no delimiter to retain it under — no third shape exists). `sdd-apply` stopped
      and reported this per HARD REQUIREMENT #4 rather than patching silently. The orchestrator
      independently verified the analysis and the user decided: **rewrite the D3 test to observe its
      claim at the level it actually lives (`flattenWithMap`/`toFlatOffset` directly, not through
      `buildExcerpt`), and record the substantive consequence** (the sibling's D3 guarantee is now
      pass-scoped to the fenced-blocks-included fallback pass only). Done in commit `d96dcab`,
      **before** the production fix commit (`d7c0d16`), per the commit-ordering requirement. This is
      the **third and last** permitted existing-assertion change in the whole diff — a fourth still
      means stop and report. The consequence is recorded in
      `openspec/changes/excerpt-fence-drop-generalization/specs/mcp-contract/spec.md`'s new `## MODIFIED
      Requirements` section and in `CLAUDE.md`'s S2 bullet (task 6.2).
- [x] 4.3 Ran `npm test` (scoped) after the D3 rewrite + 4.1/4.2: **112/112 passing** in
      `test/domain/excerpt.test.ts` + `test/domain/flatten-map.test.ts`, including Gate 3b and D4's
      inverted assertion.
- [x] 4.4 Confirmed the sibling's existing case (`"Prose before. Prose after."`, unmodified, no diff)
      still passes — part of the 112 green.
- [x] 4.5 Confirmed via the fully-green I4 suite (89/89 in `flatten-map.test.ts`, covering all 16
      pre-existing fixtures plus the 5 new ones) that no fixture's `flattenWithMap` output regressed;
      the odd-backtick fixture's new divergent behavior is covered by 3.1's rewritten assertion.

## Phase 5: Live Corpus Test + Re-run the Probe

- [x] 5.1 Create `test/application/excerpt-fence-drop.test.ts`, driving the fixture corpus through
      `buildHarness` in-memory (following `test/application/excerpt-window.test.ts`'s precedent — no
      CLI, no `.compendio/`): assert each of the 5 fixture documents indexes to exactly one chunk; assert
      `\r\n` is present in the two `*-crlf.md` documents' stored chunk content; assert a `~~~` delimiter
      is present in the corpus; assert the end-to-end `search_docs` excerpt property (tilde fence and
      interior-backtick fence both excluded from the fenced-blocks-excluded pass). 6 tests, all passing.
- [x] 5.2 Add `EXCERPT_FENCE_DROP_DOCS` to `test/helpers/build.ts`, following the existing
      `EXCERPT_WINDOW_DOCS` pattern (`fileURLToPath(new URL("../fixtures/excerpt-fence-drop/docs",
      import.meta.url))`), with a doc comment naming what the fixture proves.
- [x] 5.3 Run `npm run build`, re-run
      `node dist/cli.js --root test/fixtures/excerpt-fence-drop index --lexical`, then
      `node scripts/excerpt-fence-drop-probe.mjs test/fixtures/excerpt-fence-drop`. **Recorded verbatim in
      `apply-progress.md`.** Result: exit 0, C1 = 0, C3 = 0, C2 = 2 (unchanged), C4 true.
- [x] 5.4 Re-run `node scripts/excerpt-fence-drop-probe.mjs test/fixtures/excerpt-window`. Confirmed it
      still exits non-zero with `GATE IS VACUOUS` on C2 — the anti-vacuity guard fails identically in
      both tree states (design D6, second bullet of "what falsifies the change").

## Phase 6: Spec Traceability, Docs, and Full Suite

- [x] 6.1 Confirmed `openspec/changes/excerpt-fence-drop-generalization/specs/mcp-contract/spec.md`
      (already written by `sdd-spec`) matches the shipped behavior: nested-fence scenario, interleaved-
      fence non-guarantee scenario, tilde-fence scenarios (lead/supporting/CRLF/info-string/indented),
      interior-backtick scenario, byte-identical-when-unaffected scenario, unterminated-fence scenario,
      fallback-pass-unaffected scenario, odd-total-delimiter-count scenario — all present, matching
      implementation. **Additionally** (per the D3-conflict resolution, not in the original plan): added
      a `## MODIFIED Requirements` section narrowing the sibling `A Heading-Pattern Line Inside a Fenced
      Code Block Is Not Stripped From a search_docs Excerpt` requirement's locatability claim to the
      fenced-blocks-included fallback pass only, with a new scenario making that observable.
- [x] 6.2 Added the new `CLAUDE.md` bullet (design D7, verbatim wording, plus the D3-narrowing
      consequence folded into the same bullet per the D3-conflict resolution) immediately after the
      `excerpt-fence-aware-flatten` bullet in *Non-obvious decisions*: S2's fence drop is
      delimiter-agnostic, interior-agnostic, and NOT balanced-gated; the exact regex; both closed defects
      (tilde-never-dropped, interior-backtick-leak); the `*?` load-bearing rationale; the accepted
      balanced-parity divergence; the interleaved-fence non-guarantee; the probe command; the sibling
      D3 guarantee's narrowing to the fallback pass.
- [x] 6.3 Amended the existing `excerpt-fence-aware-flatten` bullet's closing sentence (design D7) —
      appended, did not delete: `"— closed by excerpt-fence-drop-generalization; see the next bullet. The
      0-of-21 measurement stands as the reason it was safe to defer, not as a live risk."`
- [x] 6.4 Amended the existing `isFenceDelimiter` deferral bullet (design D8) by appending the third-
      occurrence paragraph verbatim: notes the trigger did NOT re-fire (S2 never imports the predicate,
      consumer count stays at three), and that the next fourth-importer should move it.
- [x] 6.5 Added the manual-gate documentation block to `CLAUDE.md`'s Commands section, matching how
      `vector-reach.mjs` and `section-lookup.mjs` are documented: the exact command sequence
      (`node dist/cli.js --root test/fixtures/excerpt-fence-drop index --lexical` then
      `node scripts/excerpt-fence-drop-probe.mjs test/fixtures/excerpt-fence-drop`), what C1-C5 mean, and
      the two anti-vacuity commands against `test/fixtures/excerpt-window`, with a before/after/anti-
      vacuity table.
- [x] 6.6 Ran `npm test`, `npm run typecheck`, `npm run build` — **all green**. `npm test`: 841/841
      across 50 files. `npm run typecheck`: clean (`tsc --noEmit && tsc -p tsconfig.test.json`).
      `npm run build`: clean.
- [x] 6.7 Ran `node dist/cli.js --root ejemplos eval`. Result: hybrid recall@5 = 1.00, MRR = 0.943,
      0 failures — matches the documented baseline exactly (Gate 5; `ejemplos/` has neither fence
      shape, so identity is the expected and observed result).
- [x] 6.8 `git diff --stat main..HEAD -- src/domain/split-text.ts src/domain/excerpt.ts
      src/application/read-document.ts` — empty output, confirming zero-line diffs on all three
      (design's asserted non-touches).
- [x] 6.9 `git diff --stat main..HEAD -- test/` — confirmed the only modified existing test assertions
      in the whole change are `test/domain/flatten-map.test.ts:32` (4.2), `test/domain/excerpt.test.ts`'s
      D4 inversion (3.1), and `test/domain/excerpt.test.ts:198-218`'s D3 rewrite (the resolved
      mid-apply addition — see the note under task 4.3). **This tripwire is now three, not two**, per
      the D3-conflict resolution; a fourth modified existing assertion still means stop and report.

## Traceability

| Spec scenario | Task(s) |
|---|---|
| Fences nested one inside the other are excluded as a single outer fence | 3.6, 4.5 |
| Improperly interleaved fences leave a residue | design D2 non-guarantee, recorded 6.2 — **automated** in `flatten-map.test.ts`'s "pins the interleaved-fence residue" test (added post-`sdd-verify`, closing that WARNING) |
| A tilde-fenced block is excluded from the lead excerpt | 3.3, 1.1, 2.6, 5.3 |
| A tilde-fenced block is excluded from a supporting excerpt | 5.1 |
| A CRLF-encoded tilde fence is excluded identically to an LF-encoded one | 3.4, 1.2, 2.3 (C4), 5.1, 5.3 |
| A tilde fence carrying an info string is excluded in full | 1.1 (fixture carries `~~~json`) |
| An indented tilde fence is excluded in full | 3.6 (regex trace covers indentation; no anchor) — **automated** in `flatten-map.test.ts`'s "drops a ~~~ fence whose delimiter lines carry leading whitespace" test (added post-`sdd-verify`, closing that WARNING; **this is a positive behavioural claim, not a non-guarantee** — see `verify-report.md`'s Resolution section for the framing correction) |
| A backtick fence with an interior backtick is now excluded, diverging from the included pass | 3.1, 1.3, 2.6, 5.3 |
| A fence with no interior same-character content is unaffected | 1.5 (control fixture), 4.5, 2.4 (C5) |
| An unterminated fence is still not excluded | 4.5 (existing fixture unmodified, D4 Gate 3) |
| The fenced-blocks-included fallback pass is unaffected | design's out-of-scope assertion on `excerpt.ts:68`, covered by 4.5's byte-identity check |
| A well-formed inner fence pair is dropped even when the chunk's total delimiter count is odd | design D2/D7's balanced-parity divergence, recorded 6.2 — **automated** in `flatten-map.test.ts`'s "pins the odd-delimiter-count case" test (added post-`sdd-verify`, closing that WARNING) |
