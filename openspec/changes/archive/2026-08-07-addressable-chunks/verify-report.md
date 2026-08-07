# Verification Report: A Chunk Heading Is Never Empty

**Change**: addressable-chunks
**Version**: N/A (openspec delta, no version tag)
**Mode**: Strict TDD

This report is written independently by sdd-verify. Every command below was re-run against the
current working tree rather than cited from the apply agent's own verify-report.md (now
overwritten) or from the orchestrator's summary. Two mutation tests were re-executed from scratch
(files backed up, mutated, tested, restored, re-confirmed green) because a defect with zero prior
test coverage makes "the suite is green" weak evidence on its own.

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 35 |
| Tasks complete | 35 |
| Tasks incomplete | 0 |

All 35 tasks are marked [x] in tasks.md. Spot-checked against the actual diff/source for every
phase (1-12), not taken on the checkbox's word - see Correctness and Coherence tables below.

## Build & Tests Execution

**Build**: PASSED
```text
$ npm run build
> tsc
(clean, no output)
```

**Typecheck**: PASSED
```text
$ npm run typecheck
> tsc --noEmit && tsc -p tsconfig.test.json
(clean, no output)
```
Independently confirmed package.json:35 is `tsc --noEmit && tsc -p tsconfig.test.json`, and
tsconfig.test.json:9 is `"include": ["src/**/*", "test/**/*"]`. The command is NOT blind to
`test/` - only the bare root tsconfig.json (used by `tsc --noEmit` alone) is. This confirms the
apply agent's correction, not the design/brief's original claim. See Issue W3 below.

**Tests**: PASSED - 588/588
```text
$ npm test
 Test Files  40 passed (40)
      Tests  588 passed (588)
```

**Eval (ejemplos/, Gate 5)**: PASSED - identity, not a tolerance band
```text
$ node dist/cli.js --root ejemplos index
Indexed 11 documents (29 chunks) in 3415 ms [mode hybrid]

$ node dist/cli.js --root ejemplos eval
mode      recall@5   MRR      failures
--------------------------------------
hybrid    1.00       0.943    0
lexical   0.95       0.856    1
```
Matches the pinned baseline exactly: hybrid recall@5 1.00, MRR 0.943, 0 failures.

**Coverage**: not available. No coverage tool is configured (vitest.config.ts, package.json
contain no coverage script). Skipped per strict-tdd-verify.md - not a failure.

## Mutation Testing — independently re-executed

Both rules of design Decision 1 were disabled one at a time (files backed up first, restored after,
full suite re-confirmed green). This is the load-bearing evidence for a defect that had zero test
coverage before this change — a green suite alone proves nothing about it.

| Mutation | Expected (per apply/orchestrator) | Reproduced | Result |
|---|---|---|---|
| Disable `withNonEmptyHeadings` at the seam (raw producer output, no fallback wrap) | 4 tests fail, incl. Gate 2's `-.md` case | Re-ran npm test | 4 failed / 584 passed — heading-less-round-trip.test.ts (Gate 1, Gate 3 `-.md`) x2 and index-pipeline.test.ts (Gate 2, both branches) x2. The `-.md` case failed with "expected '' to be '-.md'", matching the claim verbatim |
| Disable the empty-segment filter in chunking.ts (plain `piece.path.join(" > ")`) | 1 test fails — the empty-`###`-child case | Re-ran npm test | 1 failed / 587 passed — chunking.test.ts "INVERTED (2.2b)" test, "expected 'Parent > ' to be 'Parent'", matching the claim verbatim |
| Restore both files from backup | 588/588 | Re-ran npm test | 588/588, diff against backup byte-identical |

Both rules are therefore independently load-bearing, confirmed by measurement, not by re-reading the
diff.

## P1 (parser probe) — independently reproduced against the real parser

Design's Open Question / task P1 asked whether RemarkMarkdownParser itself emits `title: ""` for an
empty ATX heading (`## ` with no text) — a claim state.yaml records as "measured by the
orchestrator" but not committed as a test. Reproduced directly against the compiled parser:

```js
new RemarkMarkdownParser().parse("# T\n\nintro\n\n## \n\nbody")
// -> outline.sections === [{ title: "", text: "## \n\nbody", children: [] }]
```

Confirmed: the real parser does emit an empty-titled section for a bare `## `. This validates the
second live defect path design.md's Decision 1 is built on. See Issue S1 below for the one gap this
leaves (the regression tests for this path exercise a hand-built DocOutline, not the real parser).

## Spec Compliance Matrix

### indexing delta

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Every Emitted Chunk Heading Is Non-Empty | Heading-less document under loose mode | heading-less-round-trip.test.ts (Gate 1, full IndexDocuments->SearchDocuments->ReadDocument) + chunking.test.ts/index-pipeline.test.ts unit/integration halves | COMPLIANT |
| ...same requirement | Filename humanizes to empty (`-.md`/`_.md`) | index-pipeline.test.ts Gate 2 (chunkOutline branch) + heading-less-round-trip.test.ts `-.md` round trip | COMPLIANT |
| ...same requirement | NO_CHUNKING covered by the same invariant | index-pipeline.test.ts "wholeDocumentChunk (NO_CHUNKING) branch" | COMPLIANT |
| Heading-Only Changes Also Require a Full Reindex | Incremental sync alone does not correct existing empty headings | No dedicated test naming headings. Rests on a pre-existing, unmodified test of the general mechanism (sync-index.test.ts:87-90, "leaves an unchanged file untouched") that this change does not touch | PARTIAL — see Issue W2 |
| ...same requirement | A full reindex applies the corrected heading | heading-less-round-trip.test.ts (uses the full-rebuild IndexDocuments path, whose reset() drop-and-recreates) | COMPLIANT |

### mcp-contract delta

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| search_docs's section is never empty and round-trips | Heading-less document's results carry a non-empty section | heading-less-round-trip.test.ts, `hit!.section === "Manual extenso"` | COMPLIANT |
| ...same requirement | A corpus not yet reindexed is not repaired at query time | No dedicated test. search-documents.ts has zero diff (independently confirmed, `git diff --stat` empty) and `section: chunk.heading` (:120) is an unconditional copy — verified by reading, not by a seeded-store test that calls SearchDocuments.execute and asserts an empty section survives | UNTESTED (compliant by code inspection only) — see Issue W1 |
| ...same requirement | The returned section round-trips through read_doc | heading-less-round-trip.test.ts, two cases (manual-extenso.md, `-.md`) | COMPLIANT |
| read_doc never renders an empty-labeled bullet, explains a sectionless document in prose | A document with no addressable sections explains itself | format-read-result.test.ts (5 cases hitting the no-sections prose, one via the dedicated variant, three via the defensive filter) + read-document.test.ts 6.1 (real seeded-store no-sections case) | COMPLIANT — literal output asserted, not structural shape |
| ...same requirement | A document with some sections still lists them normally | format-read-result.test.ts "section-not-found ... normal non-empty list" | COMPLIANT |

Compliance summary: 8/10 scenarios fully COMPLIANT with runtime-evidence coverage, 1 PARTIAL
(inherited coverage of the underlying mechanism, no heading-specific test), 1 UNTESTED (correct by
code inspection — the touched file has zero diff — but with no regression test that would catch a
future regression).

Per the skill's hard rule ("a spec scenario is compliant only when a covering test passed at
runtime"), the UNTESTED item cannot be marked COMPLIANT even though the reasoning behind it is sound
and independently verified here. tasks.md's own Coverage Map already flags both of these as
"satisfied by omission" / "operational, not code-testable" rather than hiding the gap — that framing
is accurate for the second one; the first (search_docs not-repaired) is not purely operational,
since it is a MUST NOT on live application code (search-documents.ts) that could regress silently.
Recommend a follow-up test (see Issues).

## Correctness (Static Evidence)

| Requirement / Gate | Status | Notes |
|---|---|---|
| documentHeading fallback chain | Implemented | `title.trim() \|\| path.trim() \|\| UNTITLED_HEADING`, matches design.md Decision 2 exactly; heading-fallback.test.ts covers all 4 levels incl. whitespace-only title |
| withNonEmptyHeadings seam wrap | Implemented | Wraps both chunkOutline and wholeDocumentChunk output at transformFile's only production call site; chunkOutline's signature is unchanged (18 test call sites now, up from 15 — all still 2-arg, zero signature churn) |
| Empty-segment filter in chunkOutline's join | Implemented | `piece.path.filter((s) => s.trim().length > 0).join(" > ")`; mutation-confirmed load-bearing |
| no-sections ReadResult variant | Implemented | New union member; formatReadResult's switch is exhaustive (TS2366 would fire on an unhandled case — confirmed via a clean npm run typecheck that does see src/server.ts) |
| availableSections empty-member filtering | Implemented | Filtered on the way in (read-document.ts:88-91) and again defensively in formatReadResult (server.ts:223, Decision 5) |
| Contract text — document-region wording | Implemented | server.ts:111, :180-181 match design's contract text verbatim; no artifact greps positive for describing section as fragment-level |
| CLAUDE.md Gate 6 additions | Implemented | New non-obvious-decisions bullet (heading invariant + reindex consequence) and Gate 1b cosine-staleness caveat, both present in the diff |
| SCHEMA_DDL / ports.ts / model.ts unchanged | Confirmed | git diff --stat on all three: empty output |
| search-documents.ts unchanged | Confirmed | git diff --stat: empty output — supports (but does not itself test) the no-query-time-repair scenario |
| Size figure | Confirmed | git diff --stat on tracked files: 282 (+263/-19); 3 new untracked test files: 301 lines (wc -l); total 583 in src+test, plus CLAUDE.md +8. Matches state.yaml's corrected figure, independently re-measured here |

## Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| 1 — one invariant at the seam, one well-formedness rule in the domain | Yes | Both rules present and separately mutation-confirmed load-bearing |
| 2 — fallback chain, level 2 is the path (not a literal) | Yes | documentHeading; the `-.md` round-trip test exercises exactly why (punctuation survives normalize) |
| 3 — seam crossed by a post-hoc map, not a signature/options change | Yes | chunkOutline's signature and ChunkingOptions shape are byte-identical; confirmed by reading both files' diffs |
| 4 — no-sections variant, reachable only via a stale/unreindexed corpus | Yes | Reached in tests via directly-seeded SqliteIndexStore(":memory:"), exactly the stale-corpus shape the design calls out |
| 5 — formatReadResult exported, retyped, filters defensively a second time | Yes | Confirmed in server.ts diff; Gate 4's tests exercise the defensive filter specifically ([""], ["", "A"], []) |
| 6 — heading IS a retrieval input; Chunk.content untouched; eval identity holds | Yes | chunks_fts/embedding-string code paths untouched by this diff; compendio eval reproduced identical to baseline |

## Assertion Quality Audit (Strict TDD, mandatory)

Scanned all 6 test files touched or created by this change (chunking.test.ts, heading-fallback.test.ts,
index-pipeline.test.ts, heading-less-round-trip.test.ts, read-document.test.ts,
format-read-result.test.ts). No banned patterns found:

- No tautologies (`expect(true).toBe(true)` or equivalent).
- No orphan empty-collection checks without a companion non-empty case — every empty-heading
  assertion in the new tests is paired with a non-empty one in the same file.
- No assertions that skip production code — every new test calls documentHeading,
  withNonEmptyHeadings, chunkOutline, transformFile, IndexDocuments.execute,
  SearchDocuments.execute, ReadDocument.execute, or formatReadResult directly.
- No ghost loops: format-read-result.test.ts's assertNoEmptyBullet loops over
  `text.split("\n")`, which is never empty for the non-empty strings formatReadResult always
  returns — the loop body always executes.
- No smoke-test-only patterns (this project has no render layer).
- No CSS/implementation-detail coupling (no UI layer in scope).
- No mock-heavy tests — zero `vi.mock()` calls across all 6 files; the integration tests use a real
  in-memory or temp-dir SqliteIndexStore, not mocks.

Assertion quality: all assertions verify real behavior.

## TDD Compliance

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | Yes | apply-progress.md's "TDD Cycle Evidence" table covers all 35 tasks |
| All tasks have tests | Yes | 33/35 have direct test coverage; 8.1-8.2 (prose-only) and 9.1/11.x/12.x (docs/verification-only) correctly marked N/A |
| RED confirmed (tests exist) | Yes | All claimed new/modified test files exist and were read directly in this phase |
| GREEN confirmed (tests pass) | Yes | npm test: 588/588, reproduced independently |
| Triangulation adequate | Yes | heading-fallback.test.ts (9 cases across 2 functions), format-read-result.test.ts (8 cases across 5 variants) — no single-case behavior with multiple spec scenarios left under-triangulated |
| Safety Net for modified files | Yes | Pre-edit test counts recorded in apply-progress.md's table are internally consistent with the Phase 2 baseline (567) and the two work-unit checkpoints (578, 588) |

TDD Compliance: 6/6 checks passed.

### Test Layer Distribution

| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | 20 | 3 (chunking.test.ts +3, heading-fallback.test.ts +9, format-read-result.test.ts +8) | vitest |
| Integration | 7 | 3 (index-pipeline.test.ts +3, heading-less-round-trip.test.ts +2, read-document.test.ts +2) | vitest + real better-sqlite3 (in-memory / temp dir) |
| E2E | 0 | 0 | not applicable — this project has no browser/HTTP layer |
| Total | 27 | 6 | |

Recounted directly from the files (not taken from apply-progress.md's claim) — matches exactly.

### Changed File Coverage

Coverage analysis skipped — no coverage tool detected in vitest.config.ts or package.json.

### Quality Metrics

Linter: not available (no lint script configured, per CLAUDE.md).
Type Checker: No errors (npm run typecheck clean, and — corrected — this command does check
test/, see Issue W3).

## Recorded Observations (Phase 12, not gates)

### 12.1 — Distinct-heading count and max chunks-per-heading, heading-less fixture

Independently reproduced (not taken from the apply-created report):

```
$ node dist/cli.js --root test/fixtures/vector-reach index
Indexed 6 documents (19 chunks)

$ query: SELECT heading, COUNT(*) FROM chunks GROUP BY heading
Manual extenso   7
Distractor 05    3
Distractor 04    3
Distractor 03    2
Distractor 02    2
Distractor 01    2
```

Distinct headings: 6. Maximum chunks-per-heading: 7 (manual-extenso.md). Matches the apply
report's figures exactly. This is the baseline a future fragment-addressability cycle would argue
from — recorded, not gated.

### 12.2 — MAX_CHUNKS_PER_DOCUMENT probe recipe (restated, NOT run)

Confirmed scripts/rank-probe.mjs:183 prints the "after cap" row cited in the restated recipe.
Recipe, per exploration.md section 7 and tasks.md 12.2, restated here and NOT executed (out of scope):

```bash
npm run build
node scripts/rank-probe.mjs <root> "<query>" "<needle>" [k]
```

Read the "after cap" row — results removed by capPerDocument after fusion ranking, not by BM25 or
the vector leg. `<needle>` should be a literal string unique to a chunk deep inside a large
heading-less document (e.g. manual-extenso.md's QUETZAL-7731 marker). For the follow-up cycle only.

## Manual Gate 1b — not re-measured (by design)

Confirmed the required CLAUDE.md caveat exists (next to the Gate 1b cosine table): the recorded
numbers predate this change, every heading-less fixture document is now embedded with a
filename-derived heading line (heading\ncontent), and the table must be re-measured before being
trusted on the next chunking change. Per the task brief, this re-measurement needs a ~130 MB model
download and is deliberately not a gate for this change — NOT run in this verification.

## Issues Found

CRITICAL: None.

WARNING:
- W1 — mcp-contract's "not repaired at query time" scenario has no dedicated regression test.
  Correct today only because search-documents.ts has a zero-line diff (independently confirmed);
  nothing would fail if a future change added query-time "repair" logic to `section: chunk.heading`
  other than a careful reviewer noticing. Recommend a test that seeds an empty-heading chunk into a
  real SqliteIndexStore, calls SearchDocuments.execute, and asserts `section === ""` survives
  unrepaired — mirroring the pattern already used for ReadDocument in read-document.test.ts 6.1/6.2.
- W2 — indexing's "incremental sync alone does not correct" scenario has no heading-specific test.
  It rests entirely on a pre-existing, unmodified test of the general content-hash fingerprint
  mechanism (sync-index.test.ts:87-90). Defensible (the mechanism itself is untouched by this change
  and is already tested), but tasks.md's own framing ("operational, not code-testable") slightly
  overstates the case — it is code-testable, just not tested here. Not blocking; recommend for a
  future cycle if SyncIndex is touched again.
- W3 — design.md's Testing Strategy note is stale/incorrect and should be corrected before archive.
  It states "tsconfig.json:18 sets include: [\"src/**/*\"], so npm run typecheck does not see
  test/, and vitest does not typecheck." Independently reconfirmed: the actual npm run typecheck
  script is `tsc --noEmit && tsc -p tsconfig.test.json`, and tsconfig.test.json includes
  `test/**/*`. The narrow claim (root tsconfig.json alone) is true; the claim about the command
  that ships is false. This does not affect Gate outcomes (the apply agent already caught and worked
  around it), but the stale claim should not propagate into future changes' briefs unchanged.

SUGGESTION:
- S1 — P1's "second live defect path" (empty ATX heading via the real parser) is confirmed real
  (reproduced directly against the compiled RemarkMarkdownParser in this phase) but has no test
  that exercises it through the real parser end to end — chunking.test.ts's 2.2a/2.2b tests
  construct a DocOutline by hand via outline()/section() helpers. Design's own reasoning ("the unit
  invariant holds regardless [of parser behavior]") makes this acceptable as-is, but a parser-level
  regression test would additionally protect the rationale itself, not just the domain invariant, if
  remark's handling of empty ATX headings ever changes.
- No coverage tool / linter configured — informational only, not a defect of this change.

## Verdict

PASS WITH WARNINGS

All 6 blocking gates (1-6) pass on independently reproduced evidence, including two from-scratch
mutation tests that reconfirm the two rules of Decision 1 are both load-bearing rather than dead
code. npm test/typecheck/build are green, compendio eval is identical to the pinned baseline, and
the schema/ports/model files have a byte-for-byte empty diff as Gate 5 requires. The three WARNINGs
are about test-coverage gaps on two spec scenarios that are correct-by-inspection today (not
incorrect behavior) and one stale cross-reference in design.md, none of which block archive — but W1
and W3 should be looked at before this change is considered fully closed out.

## Change Log vs. the apply-created report

This report replaces openspec/changes/addressable-chunks/verify-report.md as written by the apply
agent (out of its lane per this phase's brief). Differences from that version:

- Adds the independently re-executed mutation-testing table (the apply/orchestrator record described
  the results; this phase reproduced them from scratch).
- Adds the independently reproduced P1 parser probe (previously only a state.yaml narrative claim).
- Adds explicit UNTESTED/PARTIAL classification for the two "satisfied by omission" spec scenarios,
  per this skill's hard rule that a scenario is compliant only when a covering test passed at
  runtime — the apply report had marked both as PASSED without this distinction.
- Adds the Assertion Quality Audit, Test Layer Distribution, and TDD Compliance sections required by
  Strict TDD mode, which the apply-created report did not include (it is not the apply agent's
  artifact to produce).
- Recorded observations (12.1, 12.2) and the Gate 1-6 results are otherwise consistent with the
  prior version's numbers — independently re-measured here, not merely copied.
