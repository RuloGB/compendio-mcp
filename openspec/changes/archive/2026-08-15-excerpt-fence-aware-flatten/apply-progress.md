# Apply Progress: A Fence-Aware `stripHeadingLines` for `search_docs` Excerpts

**Change**: `excerpt-fence-aware-flatten`
**Mode**: Strict TDD
**Batch**: 1 of 1 (no prior batches — first apply run)
**Delivery**: single PR, `size:exception` accepted by the user (2026-08-16), per tasks.md
**Status**: 20/20 tasks complete. All five phases done in one batch.

## Ordering discipline (the highest-named risk in the whole change)

Followed exactly: (1) fixtures + `referenceFlatten` rewrite, (2) run `npm test` and **observe I4 red**,
(3) only then edit `stripHeadingLines`. The red evidence below is real — captured before any production
edit existed.

## Phase 1 — RED evidence (captured before touching `src/domain/flatten-map.ts`)

`npx vitest run test/domain/flatten-map.test.ts` after tasks 1.1-1.2, before task 2.1:

```
 FAIL  test/domain/flatten-map.test.ts > flattenWithMap I4 — matches today's flatten() output exactly
       > backtick fence containing a fence-interior heading-pattern line (dropFencedBlocks=false)
AssertionError: expected 'Prose before. python print(\'hi\') Pr…' to be 'Prose before. python # a python comme…'
Expected: "Prose before. python # a python comment print('hi') Prose after."
Received: "Prose before. python print('hi') Prose after."

 FAIL  ... > fence-interior heading-pattern line with an odd backtick count (dropFencedBlocks=true)
Expected: "Before text. js # a comment with an odd backtick const x = 1; After text."
Received: "Before text. After text."

 FAIL  ... > fence-interior heading-pattern line with an odd backtick count (dropFencedBlocks=false)
Expected: "Before text. js # a comment with an odd backtick const x = 1; After text."
Received: "Before text. js const x = 1; After text."

 FAIL  ... > misaligned-even fence: stray closer, real heading, stray opener (dropFencedBlocks=false)
Expected: "Some prose before. ## Real Heading Some prose after."
Received: "Some prose before. Some prose after."

 Test Files  1 failed (1)
      Tests  4 failed | 64 passed (68)
```

**Discriminating result, exactly as design D4 predicted**: the I1-I3 invariant suite (32/32) and the
"unterminated fence" I4 fixture (both modes) stayed **green** in this same unfixed state — only the
4 fence-interior-retention cases in I4 went red. This is what proves the new fixtures actually exercise
the fence-blindness defect rather than being decorative: "the invariants are green" was not evidence
here, matching the launch prompt's warning.

## Phase 2 — GREEN

After editing `stripHeadingLines` (design D1: hoisted `HEADING_LINE_PREFIX`, `balanced` computed before
the loop, `inFence` toggle, delimiter branch uses `else if` — never `continue`, per the D2 trap):

```
npx vitest run test/domain/flatten-map.test.ts test/domain/excerpt.test.ts
 Test Files  2 passed (2)
      Tests  85 passed (85)
```

## Phase 3 — Additional unit coverage

Added to `test/domain/excerpt.test.ts` (new `describe` block, additions only — verified below):
- Fallback-path case (all-fenced chunk, `dropFencedBlocks: true` empty, fallback fires, retained line
  visible in the excerpt) — traces spec scenario "A fence-interior heading-pattern line is retained when
  the excluded pass is empty."
- D3 locatable-span case, deliberately using a `~~~` tilde fence (outside S2's backtick-only regex — see
  exploration.md §0 row 3) to isolate the map-locatability claim from S2's separate fence-drop behavior.
  Confirms `end > start` survival by asserting the marker text is visible in a span-centred excerpt that
  a fence-blind S1 could never have produced.
- Gate 2 case: backtick fence + `# a python comment` — `dropFencedBlocks: true` byte-identical to
  `"Prose before. Prose after."`; `dropFencedBlocks: false` gains `"a python comment"`. Traces spec
  scenario "A fence holding a retained heading-pattern line is still recognized and dropped by the
  excluded pass."
- Gate 4 (measurement-only, D5/M1): odd-backtick fence-interior line. Verbatim measurement recorded in
  the test's own comment (see below) — the assertion checks only that the mechanism is reproducible
  (`dropFencedBlocks: true` output equals the `false`-pass output, since S2 makes zero replacements when
  the backtick count is odd), not any particular pass/fail outcome.

```
npx vitest run test/domain/flatten-map.test.ts test/domain/excerpt.test.ts
 Test Files  2 passed (2)
      Tests  89 passed (89)

npm test
 Test Files  49 passed (49)
      Tests  812 passed (812)
```

`git diff` confirms: `referenceFlatten` is the **only** modified existing assertion in
`flatten-map.test.ts` (its diff shown below); `excerpt.test.ts`'s diff is 100% additions (`git diff --
test/domain/excerpt.test.ts | grep -E "^-" | grep -v "^---"` returns nothing).

```diff
 function referenceFlatten(markdown: string, dropFencedBlocks: boolean): string {
-  const withoutHeadings = markdown
-    .split("\n")
-    .filter((line) => !/^\s*#{1,6}\s/.test(line))
+  const lines = markdown.split("\n");
+  const balanced = lines.filter(isFenceDelimiter).length % 2 === 0;
+  let inFence = false;
+  const withoutHeadings = lines
+    .filter((line) => {
+      if (isFenceDelimiter(line)) {
+        if (balanced) inFence = !inFence;
+        return true;
+      }
+      return inFence || !/^\s*#{1,6}\s/.test(line);
+    })
     .join(" ");
```

### Gate 4 (D5/M1) verbatim measurement, both directions

Measured with a `git stash push -- src/domain/flatten-map.ts` / `npx tsx` round-trip (pre-fix code
temporarily restored, then popped back):

| | `dropFencedBlocks: true` | `dropFencedBlocks: false` |
|---|---|---|
| **BEFORE** (fence-blind S1 — the odd interior backtick never reached S2) | `"Before text. After text."` | `"Before text. js const x = 1; After text."` |
| **AFTER** (fence-aware S1 — retained line's lone backtick makes 3 total, odd, S2 pairing fails, zero replacements) | `"Before text. js # a comment with an odd backtick const x = 1; After text."` | same as `true` (S2 made no replacements either way) |

Confirms D5's stated mechanism exactly: the risk is real, and on this fixture it manifests as "the true
pass equals the false pass" rather than data loss — no live instance on this repo's actual corpus (M2
below: 0 of 21 newly-retained fence-interior lines carry a backtick).

## Phase 4 — Live measurement (probe script)

Created `scripts/excerpt-flatten-probe.mjs`, following the `section-lookup.mjs`/`vector-reach.mjs`
precedent (imports from `dist/`, no production surface widened, one asserted self-check, non-zero exit
on failure).

```
node dist/cli.js --root . index --lexical
Discovering documents
Indexing 1 documents
[1/1] docs/documentation-convention.md
WARNING indexed without embeddings (provider unavailable): search runs in lexical mode
Indexed 1 documents (13 chunks) in 46 ms [mode lexical]

node scripts/excerpt-flatten-probe.mjs .
Target chunk 12 — heading: "12. Templates"
Stored content length: 1473 chars

dropFencedBlocks: true  -> 0 chars
dropFencedBlocks: false -> 1131 chars
buildExcerpt() -> 119 chars: "markdown --- type: functional module: <module status: draft owner: BA tags: [] ..."

Pass 1 (dropFencedBlocks: true) is 0 chars: true
Phrases present in pass 2 (dropFencedBlocks: false): 3/3 — Business rules, Use cases, Out of scope
Phrases present in buildExcerpt() output (informational — no spans, prefix path): 0/3 — (none)

--- D5 M2 scan: fence-interior heading lines with an odd backtick count ---

Fence-interior heading-pattern lines (balanced chunks only): 21
Of those, with an odd backtick count: 0
(Measurement only — no pass/fail. See design.md Decision 5.)
exit code: 0
```

**Reproduces exploration.md §0b exactly**: pass 1 stays 0 chars (proof S2 still drops the four fences),
all three phrases now present in pass 2, 21 fence-interior lines newly retained, 0 with backticks.

**Self-check verified load-bearing, not decorative**: re-ran against the pre-fix build (git-stash round
trip) — the script correctly detected the regression and exited non-zero:

```
dropFencedBlocks: false -> 774 chars
Phrases present in pass 2: 0/3 — (none)
SELF-CHECK FAILED: ...
exit code: 1
```

Rebuilt (`npm run build`) and re-ran against the fixed code — exit code 0 confirmed again.

Live CLI end-to-end (task 4.5):

```
node dist/cli.js --root . search --lexical "business rules"
```

Rank-1 result's `excerpt` field contains all three phrases (`Business rules`, `Use cases`,
`Out of scope`) — confirmed by inspection of the JSON output. `noMatchReason`/`filterWarning` absent,
`section: "12. Templates"`, `status: "draft"`.

## Phase 5 — Docs and full suite

- `CLAUDE.md`: added one *Non-obvious decisions* bullet for the fence-aware excerpt flattening (mirrors
  the `read_doc` bullet's structure, states the inverted shape-4 consequence, the unfixed odd-backtick
  risk with its measured zero-instance count, and the probe script path) plus a second bullet recording
  D6 — the sibling change's `isFenceDelimiter`-module-move revisit trigger has fired (third consumer) and
  is deliberately deferred again, not acted on.
- Final full-suite results:

```
npm test
 Test Files  49 passed (49)
      Tests  812 passed (812)

npm run typecheck
tsc --noEmit && tsc -p tsconfig.test.json    (no output — clean)

npm run build
tsc    (no output — clean)

node dist/cli.js --root ejemplos eval
Goldenset: 22 questions | k = 5
mode      recall@5   MRR      failures
hybrid    1.00       0.943    0
lexical   0.95       0.856    1
```

MRR 0.943 and recall@5 1.00 match the required floor exactly (unchanged from baseline — `ejemplos/`
contains no fenced heading-pattern content, so this change cannot move that number; it is a
non-regression check, not evidence of improvement).

- `git diff --stat -- src/domain/split-text.ts src/domain/excerpt.ts src/application/read-document.ts`
  → empty (zero-line diff confirmed on all three, as design.md asserted).
- `git diff -- test/domain/excerpt.test.ts | grep -E "^-" | grep -v "^---"` → empty (additions only).
- `git diff -- test/domain/flatten-map.test.ts` → `referenceFlatten` is the only modified existing
  assertion; the four new fixtures are pure additions.

## Files Changed

| File | Action | What Was Done |
|------|--------|----------------|
| `src/domain/flatten-map.ts` | Modified | `stripHeadingLines` gains fence-awareness: import `isFenceDelimiter`, hoisted `HEADING_LINE_PREFIX` with CRLF why-comment, `balanced` precomputed, `inFence` toggle, `else if` branch (never `continue`s a delimiter line). Doc comment updated to state the fence rule and its chunk-locality (design D1/D2) |
| `test/domain/flatten-map.test.ts` | Modified | `referenceFlatten` rewritten with a dated why-comment (design D4) — the only permitted existing-assertion change in the whole diff. 4 new `GENERATED_INPUTS` fixtures added |
| `test/domain/excerpt.test.ts` | Extended (additions only) | New `describe` block: fallback-path case, D3 locatable-span case (tilde fence), Gate 2 case, Gate 4 measurement-only case |
| `scripts/excerpt-flatten-probe.mjs` | Created | Gate 1 (stored-chunk two-pass check, self-check exits non-zero on regression — verified against both pre-fix and post-fix builds) + D5's M2 corpus scan |
| `CLAUDE.md` | Modified | New *Non-obvious decisions* bullet for fence-aware excerpt flattening; new bullet recording D6's fired-but-deferred `isFenceDelimiter`-module-move trigger |
| `src/domain/split-text.ts` | **Unchanged** | Zero-line diff confirmed |
| `src/domain/excerpt.ts` | **Unchanged** | Zero-line diff confirmed |
| `src/application/read-document.ts` | **Unchanged** | Zero-line diff confirmed |

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1-1.2 | `test/domain/flatten-map.test.ts` | Unit | ✅ 69/69 (pre-change baseline) | ✅ Written | N/A (RED gate, see 2.1-2.3) | N/A | N/A |
| 1.3 | `test/domain/flatten-map.test.ts` | Unit | — | ✅ Confirmed red: 4/68 failed, I1-I3 (32/32) + unterminated-fence I4 stayed green | — | — | — |
| 2.1-2.3 | `src/domain/flatten-map.ts` | Unit | ✅ Baseline captured above | ✅ (from 1.3) | ✅ 85/85 passed | ➖ (4 fixtures = D4's own triangulation set) | ➖ None needed — matches design D1 verbatim |
| 3.1 | `test/domain/excerpt.test.ts` | Unit | ✅ 89/89 after 2.1-2.3 | ✅ Written | ✅ Passed | ➖ Single scenario (fallback path) | ➖ None needed |
| 3.2 | `test/domain/excerpt.test.ts` | Unit | ✅ (same) | ✅ Written | ✅ Passed | ➖ Single scenario (D3 locatability) | ➖ None needed |
| 3.3 | `test/domain/excerpt.test.ts` | Unit | ✅ (same) | ✅ Written | ✅ Passed | ✅ 2 cases (both `dropFencedBlocks` values) | ➖ None needed |
| 3.4 | `test/domain/excerpt.test.ts` | Unit | ✅ (same) | ✅ Written | ✅ Passed | ➖ Measurement-only, one case per D5/M1 | ➖ None needed |
| 4.1-4.5 | `scripts/excerpt-flatten-probe.mjs` | Manual/script gate | N/A (new file) | ✅ Verified failing against pre-fix build (git-stash round trip) | ✅ Passed against post-fix build, exit 0 | ➖ Single target chunk, by design (the live case) | ➖ None needed |
| 5.1-5.5 | `CLAUDE.md`, full suite | Docs / Suite | ✅ 812/812 | N/A | ✅ All gates green | N/A | N/A |

### Test Summary
- **Total tests written**: 20 new test cases — 16 in `flatten-map.test.ts` (4 new `GENERATED_INPUTS`
  fixtures × 2 `dropFencedBlocks` modes × 2 describe blocks, I1-I3 and I4) + 4 new `it` blocks in
  `excerpt.test.ts`
- **Total tests passing**: 812/812 (full suite), including 89/89 in the two directly-touched files
- **Layers used**: Unit (20 new cases), manual/script gate (1 probe script, verified both red and green)
- **Approval tests** (refactoring): None — `stripHeadingLines` is new-behavior fixture-driven TDD, not a
  behavior-preserving refactor; `referenceFlatten`'s rewrite is itself the golden-reference update device
  D4 specifies, verified red-then-green as its own gate (1.3 → 2.3)
- **Pure functions created**: 0 new exported functions (`stripHeadingLines` stays private, same shape as
  before); `HEADING_LINE_PREFIX` is a new pure constant

## Delivery / diff size

Total changed lines across all touched/created files (`git diff --stat` with `scripts/` intent-to-add):

```
 CLAUDE.md                         |  25 ++++
 scripts/excerpt-flatten-probe.mjs | 157 +++++++++++++++++++++++++++++++++++++
 src/domain/flatten-map.ts         |  35 ++++++-
 test/domain/excerpt.test.ts       |  84 ++++++++++++++++
 test/domain/flatten-map.test.ts   |  42 +++++++-
 5 files changed, 337 insertions(+), 6 deletions(-)
```

**343 changed lines total** — inside design.md's 252-440 estimate, and under the 400-line review budget
even though the delivery decision already accepted `size:exception` in advance (recorded in `tasks.md`).
Not re-opening that decision; recording the actual number as the delivery decision instructed.

## Deviations from Design

None — implementation matches design D1-D7 exactly, including the `else if` (not `continue`) branch
structure, the `balanced`-before-the-loop placement, and the golden-reference rewrite shape specified in
D4. One scoping clarification made during Phase 4 not spelled out in tasks.md: Gate 1's self-check in
the probe script asserts only pass-1-emptiness and pass-2 phrase presence (per tasks.md 4.2's literal
wording), not `buildExcerpt()`'s own (spanless) output — that call is printed informationally, since with
no matched spans it takes the prefix path (design.md Decision 6) and the three phrases sit ~1000 chars
into the flattened text, past the 120-char supporting budget. The real end-to-end proof of a **matched**
excerpt is task 4.5's live `search --lexical` run, which does contain all three phrases in the real
rank-1 excerpt.

## Issues Found

None.

## Remaining Tasks

None — all 20 tasks across all 5 phases complete.

## Workload / PR Boundary

- Mode: single PR, `size:exception` accepted (2026-08-16)
- Current work unit: the whole change (no natural cut, per tasks.md's Delivery decision)
- Boundary: starts from a clean working tree (verified via `git status` before starting), ends with all
  5 phases done, full suite green, both zero-line-diff assertions and the additions-only test assertions
  confirmed
- Estimated review budget impact: 343 changed lines — inside budget despite the accepted exception

## Status

20/20 tasks complete. Ready for verify.
