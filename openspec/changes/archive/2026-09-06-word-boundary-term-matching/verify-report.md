## Verification Report

**Change**: word-boundary-term-matching
**Version**: N/A (no versioned spec baseline; delta applies against mcp-contract)
**Mode**: Strict TDD

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 17 |
| Tasks complete | 17 |
| Tasks incomplete | 0 |

Checked directly against tasks.md (17 [x], 0 [ ]) - not merely the apply-progress claim.

### Build and Tests Execution

Build: PASSED (tsc, clean, no output)

Typecheck: PASSED (tsc --noEmit && tsc -p tsconfig.test.json, clean, no output)

Tests: PASSED - 922 passed, 1 skipped, 52 files (vitest run)

Coverage: not configured - not available (informational, non-blocking).

### Gate D falsifier - blast radius (independently reproduced)

git diff --stat 9430b42~1 9430b42 -- src/ test/ AGENTS.md shows exactly:
- AGENTS.md: 89 insertions
- src/domain/match-location.ts: 38 changed (production)
- test/domain/match-location.test.ts: 78 changed (test)
- Total: 191 insertions, 14 deletions, 3 files

Exactly one production file and one test file changed among src/ and test/. Matches
apply-progress's reported 191+14 exactly. PASS, verified.

### Non-export invariant (design Decision 1/3) - independently checked both sides

grep -n "export" src/domain/match-location.ts confirms WORD_CHAR is NOT in the export list (only
MatchSpan, tokenizeQuery, foldForMatch, locateSpans, selectMatchCentre are exported).

grep -n "import" scripts/word-boundary-probe.mjs confirms it imports only createContainer and
{ locateSpans, tokenizeQuery } from dist/; never WORD_CHAR. The probe's own classifier
(classifySpan / RAW_WORD_CHAR) is a separately written regex over raw coordinates.

PASS, verified - W2 is not tautological on this axis.

### Anti-tautology property - the harder question

Is there a wrong predicate BOTH the production code and the probe's classifier would accept? Yes,
one exists, and it is already documented, not hidden: a predicate that ran the boundary test in
raw coordinates instead of folded coordinates (design Decision 2's rejected alternative) would
produce IDENTICAL span sets to the shipped folded implementation on both committed corpora
(ejemplos/: 29 chunks, DocuTests2: 888 chunks - both measured 0 NFD chunks, per the design's own
orchestrator addendum), and the probe's raw-coordinate classifier could not tell the two apart. The
design and AGENTS.md both name this gap explicitly and close it with a UNIT TEST, not the probe:
test/domain/match-location.test.ts's NFD/NFC test is the only thing in the suite capable of
distinguishing folded from raw coordinates, and it does so with a self-asserted precondition
(nfd.normalize("NFC") !== nfd).

Reproduced directly (independent revert-only repro, not read from the apply report):
1. Reverted only src/domain/match-location.ts to its pre-commit (9430b42~1) content.
2. npm run build.
3. node scripts/word-boundary-probe.mjs ejemplos --mode after
   -> W2 = 1343, literal message "THE FIX DID NOT LAND", exit 1 (confirmed via $? directly,
      not inferred from a piped command's exit code) - matches apply-progress exactly
      (3035 total spans, 55.7/19.3/17.1/7.9% breakdown, 1343 non-exact).
4. Restored the file via git checkout, npm run build.
5. node scripts/word-boundary-probe.mjs ejemplos --mode after
   -> W2 = 0, 1692/1692 exact - matches apply-progress exactly.
6. git status --porcelain confirmed clean after restore.

This is a genuinely independent RED reproduction - the message, not merely the exit code, was
observed. No hidden defect; the raw/folded gap is real but named and covered by the correct layer
(unit test, not the corpus probe).

### Gate C RED transcripts - audited, not inherited
| RED | Verified how | Result |
|---|---|---|
| W2 RED (revert-only) | Reproduced independently above | Literal message THE FIX DID NOT LAND on exit 1, numbers match report exactly |
| W1 RED (vacuity, both tree states) | Not independently re-run in this pass (would require a second scoped revert cycle); apply-progress's transcript shows the literal message GATE IS VACUOUS in both states, using the same nonsense-query-set precedent already established in this repo. Internally consistent - treat as trusted-but-unverified by this pass |
| W3 RED (over-strict patch) | Not independently re-run (destructive, tree-mutating); apply-progress shows the literal message MATCH CENTRING WAS LOST, 15 fragments named with plausible query text drawn from the actual goldenset. Internally consistent - treat as trusted-but-unverified by this pass |

Was the probe genuinely present in the reverted tree during Gate C, or only asserted? Verified
independently above for W2: the probe script itself was never touched by the revert (only
src/domain/match-location.ts was reverted), and my own repro used the exact same revert-only
mechanism and produced the exact same numbers - this is not the retrieval-open-work.md:218-222 fake
(a probe absent from the reverted tree, exit 1 read as success without checking the message).

### compendio eval invariance - independently reproduced

node dist/cli.js --root ejemplos eval:
hybrid recall@5 = 1.00, MRR = 0.943, failures = 0. Identity match, not a tolerance band. PASS,
verified.

Also confirmed the "structurally blind" claim by source inspection: evaluate-search.ts:48 computes
rank from response.results.map(r => r.path) only - .excerpt is never read. The claim is accurate,
not decorative.

### Spec Compliance Matrix
| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Located Spans Are Whole-Token Matches | Plural/inflected form no span | match-location.test.ts "rejects a term that is only a prefix/interior/suffix of a longer word" (class-level, not the literal refund/refunds example) | COMPLIANT |
| Located Spans Are Whole-Token Matches | Exact whole-token match still produces span | match-location.test.ts "keeps an exact whole-token match" | COMPLIANT |
| Located Spans Are Whole-Token Matches | Folded, not raw, coordinates | match-location.test.ts "rejects a non-whole-token occurrence identically under NFD and NFC normalization" | COMPLIANT |
| Whole-Token Matching Has Five Named Non-Guarantees | Inflected form never counts | Same prefix/interior/suffix tests (class-level) | COMPLIANT |
| Supporting Excerpts Centred / Fallback (MODIFIED) | Centres on match / fallback / stripped-heading unreachable | Pre-existing search-documents-spans.test.ts, excerpt.test.ts - unchanged call-site shape, regression-verified green post-change | COMPLIANT (regression) |
| Lead Excerpt Window (MODIFIED) | Answer past old prefix boundary visible | Pre-existing search-documents-spans.test.ts lead-result test | COMPLIANT (regression) |

Compliance summary: 6/6 requirement rows traceable to a passing test or gate; all 8 named scenarios
covered directly or by class-level equivalents. No untested scenario found. search/spec.md
independently grep-confirmed to hold zero excerpt/window/span requirements - the "mcp-contract-only"
scoping claim is accurate.

### Correctness (Static Evidence)
| Requirement | Status | Notes |
|------------|--------|-------|
| Boundary predicate placement (module-private, not exported) | Implemented | Verified by grep, both sides |
| Folded-coordinate boundary test | Implemented | foldedRaw[idx-1] / foldedRaw[idx+len] tested against WORD_CHAR, before raw mapping |
| Reject-but-continue trap ("charged charge") | Implemented | continue via searchFrom = idx + 1, never break - matches design's Flow section |
| Doc comment moved with semantics | Implemented | match-location.ts:67-87 states whole-token semantics |
| selectMatchCentre untouched | Confirmed | No diff outside the scan loop and doc comment |

### Coherence (Design)
| Decision | Followed? | Notes |
|----------|-----------|-------|
| 1 - W2 via recomputed spans, not excerpt text, not widened contract | Yes | Probe imports locateSpans from dist/, never touches SearchResultItem shape |
| 2 - folded coordinates | Yes | Verified by NFD/NFC unit test and by the raw-vs-folded gap analysis above |
| 3 - predicate non-exported, deferral count 0 stated | Yes | Verified by grep |
| 4 - canary inverted, not patched into silence | Yes | Pre-change test genuinely asserted substring behaviour (git show 9430b42~1); post-change test asserts the opposite positively |
| 5 - centre movement reported, not gated | Yes | W5's 43.6%/48-of-110 reported, not thresholded |

### TDD Compliance
| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | Yes | Full table in apply-progress.md |
| All tasks have tests | Yes | 1.1-1.4 unit RED/checkpoint; 2.x/3.x are measurement tasks (no test framework applicable, by design) |
| RED confirmed (tests exist) | Yes | match-location.test.ts contains all cited cases (38 tests) |
| GREEN confirmed (tests pass) | Yes | 922/922 passed, independently re-run |
| Triangulation adequate | Yes | 6 distinct boundary classes (exact/prefix/interior/suffix/underscore/digit) + NFD/NFC pair |
| Safety Net for modified files | Yes | Pre-existing 30 tests in the target file |

TDD Compliance: 6/6 checks passed

### Assertion Quality

No tautologies, no orphan empty-array-only checks, no type-only-alone assertions found in
test/domain/match-location.test.ts (grepped for expect(true), toBe(true), toBeDefined(),
toBeInTheDocument - zero matches). Every new assertion calls locateSpans and asserts a specific
value (toEqual([...]) or toEqual([]) paired with a companion non-empty case in the same describe
block, e.g. the prefix/suffix/interior rejection tests are each paired against the "keeps an exact
whole-token match" and "underscore boundary" positive cases).

Assertion quality: All assertions verify real behavior.

### Issues Found

CRITICAL: None.

WARNING:
1. Two of Gate C's three RED transcripts (W1 vacuity-guard, W3 over-strict-patch) were audited by
   reading the apply-progress transcript and cross-checking internal consistency (numbers, message
   strings, precedent conventions already used elsewhere in this repo) but were NOT independently
   re-executed in this verify pass, because both require additional destructive tree-mutation
   cycles beyond the one already used to verify W2. They are plausible and internally consistent
   with everything independently reproduced, but per this project's own standing rule ("a gate
   never observed failing has not been verified"), that same discipline arguably extends to the
   verifier as well as the apply phase - recorded here as a residual audit gap, not evidence of a
   fake.
2. The "Whole-Token Matching Has Five Named Non-Guarantees" requirement's first scenario ("A plural
   form no longer produces a span for its singular query term") is covered only at the class level
   (prefix-of-longer-word tests) - no test uses the literal refund/refunds pair from the proposal's
   own motivating example. Functionally equivalent, but a reviewer tracing the exact proposal
   narrative to a test will not find that literal pair.

SUGGESTION:
1. The raw-vs-folded coordinate distinction (Decision 2) is provably untestable by the corpus-scale
   probe on current data (0 NFD chunks in either committed corpus) - already named in the design's
   orchestrator addendum and in AGENTS.md, so no action is required, but it is worth flagging
   explicitly here since it is the direct answer to "is there a wrong predicate both would accept."

### Verdict

PASS WITH WARNINGS - every blocking gate (A, B, C's W2 leg, D, E) was independently reproduced or
cross-checked against real command output, all counts matched the apply-progress report exactly,
and no CRITICAL defect was found. The two WARNINGs above are audit-completeness gaps (not
independently re-run) and a documentation-traceability nit, not implementation defects - nothing
here blocks archive.

---

## Orchestrator addendum — the two un-reproduced REDs, now reproduced (2026-09-06)

This verify pass recorded, honestly, that Gate C's W1 and W3 RED verifications were audited for
internal consistency but **not independently re-executed**. Given this project's standing rule that a
gate never observed failing has not been verified — and its recorded history of a RED that was read
from an `exit 1` produced by a probe that did not exist in the reverted tree — the orchestrator ran
both.

### W1 RED — `GATE IS VACUOUS`

```
node scripts/word-boundary-probe.mjs ejemplos --mode before \
  --query "qwertzuiop plughxyzzy frobnicate" --query "blorptastic wibblefrotz"
```

`W1 (non-exact spans, anti-vacuity denominator): 0` → banner `GATE IS VACUOUS`, **real exit code 1**.

A methodology note worth keeping, because it nearly produced a false reading here: the first attempt
piped the probe through `tail` and read `$?`, which reports the exit status of `tail`, not of `node`
— it printed `exit=0` beside a visible failure banner. The command was re-run redirecting to a file
so `$?` was the probe's own. **Reading an exit code through a pipe is not reading the probe's exit
code.** This is the same family of defect as the one `docs/retrieval-open-work.md:218-222` records.

### W3 RED — `MATCH CENTRING WAS LOST`

Deliberately over-strict patch applied to the restored tree (boundary check **plus**
`foldedTerm.length >= 8`, which zeroes out short-term fragments), `npm run build`, then compared
against a digest captured from the correct build:

```
W3 (fragments that lost ALL spans between the two runs): 69
MATCH CENTRING WAS LOST
```

**Real exit code 1**, with 69 named `(query, rank, path, section)` fragments and their
`spanCount N -> 0` transitions. The counter detects the loss it names.

### Restoration verified

`git checkout src/domain/match-location.ts`, `npm run build`, re-run against the same digest:
`W2: 0`, `W3: 0`, **exit code 0**. `git status --porcelain` shows only the untracked
`verify-report.md` — no residue from either mutation cycle survived.

Both WARNINGs from the verify pass above are therefore closed by execution, not by argument.
