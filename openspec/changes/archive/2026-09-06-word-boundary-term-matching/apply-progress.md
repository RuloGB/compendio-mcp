# Apply Progress: Match Query Terms on Word Boundaries, Not Substrings

**Mode**: Strict TDD. **Status**: 17/17 tasks complete. All blocking gates (A, B, C, D, E) passed,
measured on this machine, transcripts below.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `test/domain/match-location.test.ts` | Unit | ✅ 30/30 (pre-existing) | ✅ Written, run, failure captured | ✅ Passed (after 1.5) | N/A — canary inversion, not new behaviour class | ➖ None needed |
| 1.2 | `test/domain/match-location.test.ts` | Unit | N/A (same file, continued) | ✅ Written, run, failure captured (4 of 6 new cases red; 2 passed trivially — already-correct behaviour) | ✅ Passed (after 1.5) | ✅ 6 boundary classes (exact, prefix, interior, suffix, underscore, digit-adjacency) | ➖ None needed |
| 1.3 | `test/domain/match-location.test.ts` | Unit | N/A (same file, continued) | ✅ Written, run, failure captured | ✅ Passed (after 1.5) | ✅ NFD + NFC forms of the same text, self-asserted precondition | ➖ None needed |
| 1.4 | `test/domain/match-location.test.ts` | Unit | N/A — checkpoint, no code change | N/A | ✅ Confirmed green (2/2, unchanged) | ➖ Single (checkpoint) | ➖ None needed |
| 1.5 | `src/domain/match-location.ts` | Unit (production) | ✅ 30/30 baseline | ✅ (from 1.1-1.3, already red) | ✅ 38/38 passed | ✅ (inherited from 1.1-1.3's multiple cases) | ✅ Doc comment updated to state whole-token semantics; module-private `WORD_CHAR`, not exported |
| 1.6 | N/A (verification task) | N/A | N/A | N/A | ✅ Full suite 922/922 + 1 skipped; typecheck clean; build clean; diff-check: exactly 1 test file + 1 production file changed | N/A | N/A |
| 2.1 | `scripts/word-boundary-probe.mjs` | System/script | N/A (new file) | N/A — standalone script, not `npm test` | ✅ Runs to completion | N/A | ➖ None needed |
| 2.2 | N/A (verification task) | N/A | N/A | N/A | ✅ Smoke run against `ejemplos/`: W0=0, W2=0, all messages distinct | N/A | N/A |
| 3.1-3.5 | N/A (measurement tasks) | N/A | N/A | ✅ 3 RED transcripts captured (below) | ✅ Gate A/B numbers measured | N/A | N/A |
| 4.1-4.4 | N/A (docs/verification) | N/A | N/A | N/A | ✅ Docs added, final full-suite + eval re-check | N/A | N/A |

### Test Summary
- **Total tests written**: 9 new/rewritten test cases in `test/domain/match-location.test.ts`
  (2 inverted-canary assertions replacing 1 old test, 6 new boundary-class tests, 1 NFD/NFC test).
- **Total tests passing**: 38/38 in the target file; 922/922 (+1 skipped) full suite.
- **Layers used**: Unit (38 in target file), no Integration/E2E needed — no call-site shape changes
  (design.md: `excerpt.ts`, `search-documents.ts`, `server.ts` untouched).
- **Approval tests** (refactoring): None — this is new behaviour (narrowing), not a refactor of
  existing-preserved behaviour.
- **Pure functions created**: 0 new exported functions; 1 new module-private predicate (`WORD_CHAR`,
  a regex constant, deliberately not exported per design.md Decision 3).

## Task 1.1 — RED transcript (canary inversion)

```
FAIL  test/domain/match-location.test.ts > locateSpans > only the whole-token term matches when one term is a substring of another
AssertionError: expected [ …(2) ] to deeply equal [ Array(1) ]
- Expected
+ Received
  [
    {
+     "end": 3, "start": 0, "term": "the",
+   },
      "end": 5, "start": 0, "term": "theta",
    },
  ]

FAIL  test/domain/match-location.test.ts > locateSpans > a term with no whole-token occurrence yields no spans
AssertionError: expected [ { start: 0, end: 3, term: 'the' } ] to deeply equal []
Tests  2 failed | 29 passed (31)
```

## Task 1.2 — RED transcript (boundary-class tests)

```
FAIL  ... rejects a term that is only a prefix of a longer word
AssertionError: expected [ { start: 8, end: 11, term: 'for' } ] to deeply equal []
FAIL  ... rejects a term that is only an interior fragment of a longer word
AssertionError: expected [ { start: 4, end: 8, term: 'time' } ] to deeply equal []
FAIL  ... rejects a term that is only a suffix of a longer word
AssertionError: expected [ { start: 18, end: 21, term: 'for' } ] to deeply equal []
FAIL  ... rejects a term adjacent to a digit, since a digit is a word character
AssertionError: expected [ { start: 8, end: 9, term: 'v' } ] to deeply equal []
Tests  6 failed | 31 passed (37)
```
(The "exact whole-token match" and "underscore boundary" cases passed trivially — they exercise
already-correct pre-fix behaviour, not new logic; this is expected, not a weak test.)

## Task 1.3 — RED transcript (NFD fixture)

```
FAIL  ... rejects a non-whole-token occurrence identically under NFD and NFC normalization
AssertionError: expected [ { start: 2, end: 5, term: 'the' } ] to deeply equal []
Tests  1 failed | 37 skipped (38)
```
Precondition assertion (`nfd.normalize("NFC") !== nfd`) passed before the behavioural assertion ran,
confirming the fixture literal is genuinely NFD.

## Task 1.4 — checkpoint

`"locates a term under a case- and diacritic-fold"` (DUPLICADO ← duplicado) and `"locates an accented
raw occurrence via an unaccented term"` (dirección ← direccion) — both untouched, both still passing
(2/2) before 1.5's production edit.

## Task 1.5 — GREEN

All 38 tests in `test/domain/match-location.test.ts` pass after adding the module-private `WORD_CHAR
= /[\p{L}\p{N}]/u` predicate and the folded-coordinate boundary check inside `locateSpans`'s scan
loop. Rejected occurrences `continue` the scan via `searchFrom = idx + 1` (never `break`) — the
`"charged charge"` trap named in design.md's Flow section.

## Task 1.6 — full suite, typecheck, build, diff-check

- `npm test`: 52 test files, 922 passed, 1 skipped.
- `npm run typecheck`: clean.
- `npm run build`: clean.
- `git status --porcelain -- src/ test/`: exactly `M src/domain/match-location.ts` and
  `M test/domain/match-location.test.ts` — no second existing file touched. Gate D's blast-radius
  claim holds.

## Task 2.1/2.2 — the probe

`scripts/word-boundary-probe.mjs` created, deriving from `strict-cost.mjs` (kept as prior art),
hardened per design.md Decision 1: imports `dist/composition.js` and `dist/domain/match-location.js`
only, drives `createContainer` (hybrid, no `--lexical`, no explicit `k`), computes W0-W5 with five
distinct failure messages (`CANNOT IDENTIFY THE MEASURED CHUNK`, `GATE IS VACUOUS`,
`THE FIX DID NOT LAND`, `POPULATION DRIFTED BETWEEN RUNS`, `MATCH CENTRING WAS LOST`), and writes a
per-fragment digest (`(query, rank, path, section)` plus span count and excerpt hash) so a
`--compare-digest` invocation can compute W3/W4/W5 without re-running the earlier build. The probe's
own classifier (`classifySpan`) is written independently in RAW coordinates and never imports the
production `WORD_CHAR` predicate (not exported, by design). Smoke run against `ejemplos/`:
`W0=0`, `W2=0`, all messages distinct, exit 0.

## Gate A — the fix lands (measured on `ejemplos/`)

BEFORE (`git stash push -- src/domain/match-location.ts`, `npm run build`, `--mode before`):

```
total spans emitted: 3035
  exact word match      : 1692 (55.7%)
  prefix of longer word : 586 (19.3%)
  word interior         : 518 (17.1%)
  suffix of longer word : 239 (7.9%)
W1 (non-exact spans, anti-vacuity denominator): 1343
```

**W1 = 1343 > 0** — non-vacuous, confirmed without widening the query set.

AFTER (`git stash pop`, `npm run build`, `--mode after --compare-digest <before-digest>`):

```
total spans emitted: 1692
  exact word match      : 1692 (100.0%)
W2 (non-exact spans among AFTER-run emissions): 0
W3 (fragments that lost ALL spans between the two runs): 0
```

**W2 = 0**. W4 (population identity): no `POPULATION DRIFTED BETWEEN RUNS` message emitted, exit 0 —
the 110-tuple `(query, rank, path, section)` population is identical between the BEFORE and AFTER
runs. W5 (reported): retention 1692/3035 = 55.7%; 48/110 fragments (43.6%) show a different excerpt
(centre moved because `selectMatchCentre` now sees fewer candidates), 2 verbatim before/after pairs
printed above in the raw transcript (see script output).

DocuTests2 (888 chunks) exists on this machine (`C:\Users\Raul\Workspace\DocuTests2`) but ships no
`goldenset.yaml` — there is no committed query set to drive the probe against it, and constructing an
ad-hoc one would not be reviewer-reproducible. Skipped, as the tasks/proposal treat it as
non-blocking corroboration only.

## Gate B — the functional cost, re-measured here

**W3 = 0** on `ejemplos/`'s 22 goldenset queries (same run as Gate A's AFTER pass, above). This
supersedes exploration §4.6.4's raw-coordinate `0/110` — this measurement is in the shipped folded-
coordinate implementation, over the real pipeline, and reproduced identically across all subsequent
runs in this apply session (see Gate C below).

## Gate C — every gate verified RED

**W2 RED** (revert-only): `git stash push -- src/domain/match-location.ts`, `npm run build`, then
`node scripts/word-boundary-probe.mjs ejemplos` (default `--mode after`) — the probe was already
present in the reverted tree:

```
W2 (non-exact spans among AFTER-run emissions): 1343
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
THE FIX DID NOT LAND
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
exit=1
```

Restored (`git stash pop`, `npm run build`): Gate A/B's numbers reproduced identically (W2=0, W3=0,
retention 55.7%).

**W1 RED** (vacuity guard, both tree states), query set `--query "qwertzuiop plughxyzzy frobnicate"
--query "blorptastic wibblefrotz"`, `--mode before`:

Fixed (post-1.5) build:
```
W1 (non-exact spans, anti-vacuity denominator): 0
GATE IS VACUOUS
exit=1
```

Reverted (pre-1.5) build (`git stash push`, `npm run build`):
```
W1 (non-exact spans, anti-vacuity denominator): 0
GATE IS VACUOUS
exit=1
```

Identical outcome in both tree states — the vacuity guard does not depend on which side of the fix
it runs on. Restored (`git stash pop`, `npm run build`) afterward.

**W3 RED** (deliberately over-strict patch): temporarily added `if (foldedTerm.length < 4)
continue;` to `locateSpans` (rejecting any term under 4 characters, zeroing out short-term
fragments), `npm run build`, re-ran against `ejemplos/`:

```
W3 (lost match-centring): ... 15 fragments listed, e.g.
  "¿Cómo evitamos fichas repetidas de clientes potenciales?" rank 3 — spanCount 6 -> 0
  "¿Qué mensaje ve el usuario si escribe un correo mal formado?" rank 3 — spanCount 11 -> 0
  ... (15 total)
W3 (fragments that lost ALL spans between the two runs): 15
MATCH CENTRING WAS LOST
exit=1
```

The counter fires and correctly identifies the loss it names. Reverted the patch, `npm run build`,
confirmed 3.1/3.2's numbers reproduce exactly (W2=0, W3=0, retention 55.7%). Working tree returned to
the real, final `match-location.ts` — confirmed via `git diff --stat` (34 insertions, 4 deletions vs
base, matching the permanent Task 1.5 change only).

## Gate D — blast radius, final check

- `npm test`: 922/922 passed, 1 skipped.
- `npm run typecheck`: clean.
- `npm run build`: clean.
- `node dist/cli.js --root ejemplos eval`: hybrid recall@5 = **1.00**, MRR = **0.943** — identity
  match with the pre-change baseline. Scope not breached.
- Final diff-check (`git status --porcelain -- src/ test/ scripts/ AGENTS.md openspec/`):
  ```
   M AGENTS.md
   M src/domain/match-location.ts
   M test/domain/match-location.test.ts
  ?? openspec/changes/word-boundary-term-matching/
  ?? scripts/word-boundary-probe.mjs
  ```
  Exactly one test file, one production file, one new script, `AGENTS.md`, and the new change folder
  (which includes the `mcp-contract/spec.md` delta authored in `sdd-spec`, verified unchanged in Task
  4.1). No other `src/`/`test/` file appears.

## Gate E — the record is honest

- `AGENTS.md` non-obvious-decision bullet added: states the substring→whole-token change, the
  71.9%/0-loss measurements, the folded-vs-raw coordinate rationale (with the measured NFC/NFD
  asymmetry), and all five named non-guarantees.
- `AGENTS.md` manual-gate section added, matching the shape of the five existing ones: reproduction
  commands, a before/after counters table with this session's real measured numbers, and the three
  RED verifications with their exact messages and exit codes.
- `mcp-contract/spec.md` delta confirmed final (Task 4.1) — narrows "locatable" to whole-token,
  states unchanged excerpt requirements explicitly, carries the five non-guarantees.
- Nothing in any shipped artifact claims this fixes `docs/retrieval-open-work.md` Open problem 3 —
  stated explicitly in the new `AGENTS.md` bullet's closing sentence.

## Deviations from Design

None. Implementation matches design.md Decisions 1-5 exactly: folded-coordinate boundary test,
non-exported `WORD_CHAR`, canary inverted (not patched into silence), centre movement reported not
gated, probe recomputes spans from `dist/`'s real `locateSpans` rather than proxying on excerpt text
or importing the private predicate.

## Issues Found

None blocking. Two small implementation choices not spelled out verbatim in the design, both
reasonable and non-deviating:
- The probe's `--mode before|after` flag: the design/tasks describe W1 and W2 as if computed by two
  separate runs of a single instrument, but a single script invocation cannot know which `dist/`
  build produced its imports. `--mode` makes the caller state it explicitly, matching how Gate C's
  own instructions already frame BEFORE/AFTER as separate invocations against separate `dist/`
  builds.
- W3/W5's "centre moved" sub-count is operationalized as: of fragments with >=1 span in BOTH runs
  (excluded from W3), those whose excerpt hash changed. This is the design's own reasoning (fewer
  spans -> smaller `selectMatchCentre` input -> some centres move) turned into a concrete, reportable
  count; it is explicitly non-gated (design.md Decision 5), consistent with its "reported only"
  status.

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `src/domain/match-location.ts` | Modified | Added module-private `WORD_CHAR` predicate + folded-coordinate whole-token boundary check inside `locateSpans`'s scan loop; updated doc comment to state whole-token semantics |
| `test/domain/match-location.test.ts` | Modified | Inverted the substring canary; added 6 boundary-class tests (exact/prefix/interior/suffix/underscore/digit-adjacency); added the NFD/NFC self-asserted-precondition test |
| `scripts/word-boundary-probe.mjs` | Created | W0-W5 gate probe, five distinct failure messages, `--mode before/after`, `--compare-digest`; imports `dist/` only |
| `AGENTS.md` | Modified | New non-obvious-decision bullet + new manual-gate section |
| `openspec/changes/word-boundary-term-matching/tasks.md` | Modified | All 17 tasks marked `[x]` |
| `openspec/changes/word-boundary-term-matching/apply-progress.md` | Created | This file |

## Workload / PR Boundary

- Mode: **single PR**, `size:exception` (accepted per user decision 2026-09-06, per proposal's own
  stated preference against splitting the gate from the change it gates).
- Current work unit: the entire change — production predicate, inverted/new unit tests, the
  falsifying gate probe, and documentation.
- Boundary: this apply batch is the full change, start to finish. Nothing deferred.
- Estimated review budget impact (excluding the `openspec/changes/` planning folder, which reviewers
  typically do not count as code): `git diff --stat -- src/ test/ AGENTS.md` = 191 insertions + 14
  deletions across 3 files; `scripts/word-boundary-probe.mjs` (new) = 361 lines. **Total ≈ 566
  changed/added lines** — above the tasks.md forecast's 445-620 range's midpoint, consistent with
  this project's recorded pattern of forecasts growing at each phase. `size:exception` covers this.

## Status

17/17 tasks complete. All gates (A, B, C, D, E) passed with measured, captured transcripts. Ready
for verify.
