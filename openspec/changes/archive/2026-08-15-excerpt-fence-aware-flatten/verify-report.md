## Verification Report

**Change**: excerpt-fence-aware-flatten

**Version**: N/A (no spec version field)
**Mode**: Strict TDD

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 20 |
| Tasks complete | 20 |
| Tasks incomplete | 0 |

All 20 checkboxes in tasks.md were spot-checked against the tree, not accepted on the checkbox alone. Tasks 3.5, 5.4, 5.5 (the self-referential diff claims) were re-derived independently with fresh git diff / git diff --stat calls rather than trusted from apply-progress.md:

- git diff --stat -- src/domain/split-text.ts src/domain/excerpt.ts src/application/read-document.ts -- empty output. Zero-line diff confirmed on all three (task 5.4).
- git diff -- test/domain/excerpt.test.ts | grep -E "^-" | grep -v "^---" -- empty. Confirmed additions-only (part of tasks 3.5/5.5's claim).
- git diff -- test/domain/flatten-map.test.ts -- read in full. referenceFlatten's body is the only modified existing block; the four new GENERATED_INPUTS entries are pure additions. Confirms task 5.5's claim exactly.
- git diff -- src/domain/flatten-map.ts -- read in full, matches design D1/D2 verbatim (isFenceDelimiter import, hoisted HEADING_LINE_PREFIX, balanced precomputed, inFence toggle, else-if branch -- delimiter lines are never continue-d).

### Build & Tests Execution
**Build**: PASSED (npm run build -- tsc, no output)
**Typecheck**: PASSED (npm run typecheck -- tsc --noEmit && tsc -p tsconfig.test.json, no output)

**Tests**: 812 passed / 0 failed / 0 skipped (49 files) -- reproduced independently, matches orchestrator's own run
```text
npm test
 Test Files  49 passed (49)
      Tests  812 passed (812)
```

Directly-touched files run in isolation, verbose, all 89 test names read individually:
```text
npx vitest run test/domain/flatten-map.test.ts test/domain/excerpt.test.ts --reporter=verbose
 Test Files  2 passed (2)
      Tests  89 passed (89)
```
Breakdown confirmed by reading the source: flatten-map.test.ts = 68 (16 fixtures x 2 modes x 2 describes [I1-I3, I4] + 4 toFlatOffset cases); excerpt.test.ts = 21 (17 pre-existing + 4 new in the fence-aware S1 describe block). Matches apply-progress.md's "20 new test cases" claim (16 + 4) exactly, independently recomputed from the fixture/describe counts, not taken on faith.

**Coverage**: Not available (no coverage tool configured in this project).

### Mutation / gate re-verification (independently reproduced, not just re-read)

- npm run build then node dist/cli.js --root . index --lexical then node scripts/excerpt-flatten-probe.mjs . -- exit 0, output byte-for-byte identical to apply-progress.md's Phase 4 transcript: stored chunk 1473 chars, pass 1 (dropFencedBlocks: true) = 0 chars, pass 2 = 1131 chars, 3/3 phrases present in pass 2, 21 fence-interior heading lines, 0 with an odd backtick count.
- node dist/cli.js --root . search --lexical "business rules" -- rank-1 result's excerpt field contains the three phrases and section "12. Templates", status "draft" -- reproduced live.
- node dist/cli.js --root ejemplos eval -- hybrid 1.00 / 0.943 / 0 failures, lexical 0.95 / 0.856 / 1 failure -- matches the required floor (MRR >= 0.943, recall@5 = 1.00) and matches apply-progress.md's recorded numbers exactly.
- Ran an ad-hoc script against the compiled SqliteIndexStore to check the CLAUDE.md claim "0 of 21 newly retained fence-interior lines carry a backtick": confirmed literally true (0 of 21 carry any backtick, not merely 0 with an odd count) -- the CLAUDE.md wording is accurate, and actually understates nothing.
- Ran flattenWithMap directly against the "unterminated fence" fixture in both modes: confirmed the heading-pattern line is stripped identically in both passes -- spec scenario 3 ("An odd fence-delimiter count leaves today's behavior unchanged") holds in fact, not merely by golden-reference equality (see Spec Compliance Matrix for the caveat on how this is tested, as distinct from how it behaves).

The orchestrator's own pre-verified items (full npm test, typecheck, build, the mutation check via git stash push -- src/domain/flatten-map.ts, the production diff review, and the zero-line-diff confirmation) were not repeated -- they are taken as given per the launch instructions, and this report's independent re-runs above corroborate rather than duplicate them.

### Spec Compliance Matrix

Each of the six spec scenarios opened and traced to a concrete, executed test -- file and test name named, not inferred from a filename.

| # | Scenario | Test | Result |
|---|---|---|---|
| 1 | A fence-interior heading-pattern line is retained when the excluded pass is empty | excerpt.test.ts, describe "buildExcerpt -- fence-aware S1", it "falls back to fenced content that now includes a retained fence-interior heading-pattern line" -- asserts excerpt contains "a python comment" on an all-fenced chunk | COMPLIANT -- direct assertion of the THEN clause |
| 2 | A real heading outside any fence is still dropped | excerpt.test.ts, describe "buildExcerpt", it "drops heading lines and collapses whitespace" (pre-existing, confirmed unmodified by git diff) | COMPLIANT -- direct, and confirmed untouched by this change rather than assumed |
| 3 | An odd fence-delimiter count leaves today's behavior unchanged | flatten-map.test.ts -- fixture "unterminated fence (odd delimiter count) with a heading-pattern line inside", asserted only via the generic I1-I3 invariant suite and the I4 golden-reference byte-equality against the independently-written referenceFlatten (no direct not-toContain assertion in excerpt.test.ts for this shape) | COMPLIANT, but INDIRECT -- see finding F1 below |
| 4 | A fence holding a retained heading-pattern line is still recognized and dropped by the excluded pass | excerpt.test.ts, it "Gate 2: a fence holding a retained heading-pattern line is still recognized and dropped by the excluded pass" -- asserts withFencesExcluded is byte-identical to "Prose before. Prose after." and withFencesIncluded contains "a python comment" | COMPLIANT -- direct, named after the scenario itself |
| 5 | A simple balanced fence is still fully dropped when fenced blocks are excluded | excerpt.test.ts, describe "buildExcerpt", it "still prefers prose over fenced content when both are present" (pre-existing, confirmed unmodified) -- asserts excerpt equals "Regla vigente.", proving the fence's content is fully absent | COMPLIANT -- direct, unmodified pre-existing test |
| 6 | The live case -- docs/documentation-convention.md, "12. Templates" | scripts/excerpt-flatten-probe.mjs (Gate 1's self-check, exit-code-asserted) + node dist/cli.js --root . search --lexical "business rules" (manual, both independently re-run above) | COMPLIANT -- manual/script layer by design (no model download requirement), reproduced twice (apply, then this verify pass) with identical output |

**Compliance summary**: 6/6 scenarios compliant, 1 indirect (F1).

### Correctness (Static Evidence)
| Requirement | Status | Notes |
|------------|--------|-------|
| Fence delimiter lines never continue-d | Implemented | else-if structure at flatten-map.ts:116-121, confirmed by direct read and by Gate 2's byte-identical-before/after assertion |
| balanced computed before the loop, not maintained during it | Implemented | flatten-map.ts:108, matches D1 verbatim |
| HEADING_LINE_PREFIX anchor-free, prefix-only, CRLF rationale documented | Implemented | Hoisted at module scope, comment present, no dollar-anchor |
| referenceFlatten independent witness (imports only the shared predicate, hand-writes its own loop + heading regex) | Implemented | Read in full -- does not call stripHeadingLines/flattenWithMap; own filter-join idiom, own literal heading regex |
| isFenceDelimiter third-consumer trigger recorded in CLAUDE.md | Implemented | New D6 bullet present, verified isFenceDelimiter genuinely has 3 consumers (split-text.ts, flatten-map.ts, read-document.ts) via grep |
| Four non-guarantees documented with shape 4's inverted/milder consequence | Implemented | spec.md and CLAUDE.md both state "kept... leaking... as prose" (not "unreachable") for shape 4 |
| Scope discipline -- no S2 tilde/interior-backtick fix | Held | git diff --stat shows only flatten-map.ts touched in src/; S2's regex is untouched, confirmed by reading flatten-map.ts's diff |

### Coherence (Design)
| Decision | Followed? | Notes |
|----------|-----------|-------|
| D1 -- loop shape | Yes | Diff matches the specified snippet character-for-character |
| D2 -- delimiter lines emitted, not skipped | Yes | No continue on the delimiter branch; Gate 2 test proves it operationally |
| D3 -- no new map machinery, I1-I4 argument holds | Yes | I1-I3 suite (32/32 pairs) green; D3 locatable-span test (tilde fence) passes |
| D4 -- referenceFlatten rewritten as independent witness, red-then-green ordering | Yes | Verified independent (see Correctness table); RED evidence in apply-progress.md is internally consistent with the fixture set actually present |
| D5 -- backtick-injection risk measured, not fixed | Yes | M1 (Gate 4 test, comment-recorded) and M2 (probe script scan) both present and reproduced |
| D6 -- third-consumer trigger recorded, not acted on | Yes | CLAUDE.md bullet present; split-text.ts zero-line diff confirms "not acted on" |
| D7 -- four uncovered shapes, per-shape consequence | Yes | Matches spec.md's non-guarantees section verbatim in substance |

### TDD Compliance
| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | Yes | Full table present in apply-progress.md, cross-checked below |
| All tasks have tests | Yes | 20/20 tasks map to a test file, script, or doc/suite-run row |
| RED confirmed (tests exist) | Yes | flatten-map.test.ts, excerpt.test.ts, scripts/excerpt-flatten-probe.mjs all exist and were read in full |
| GREEN confirmed (tests pass) | Yes | 812/812 on independent re-run; 89/89 on the two directly-touched files in isolation |
| Triangulation adequate | Yes | 4 new flatten-map.test.ts fixtures each exercise a structurally distinct case (core retention, odd-backtick injection, unterminated/odd-count non-guarantee, misaligned-even non-guarantee) -- none collapse onto the same assertion |
| Safety Net for modified files | Yes | flatten-map.ts's only modification is additive (import + hoisted const + gated branch); pre-existing 32/32 I1-I3 pairs stayed green throughout |

**TDD Compliance**: 6/6 checks passed

---

### Test Layer Distribution
| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | 20 new (89 total in the two files) | 2 (flatten-map.test.ts, excerpt.test.ts) | vitest |
| Manual/script gate | 1 (Gate 1 self-check + D5 M2 scan) | 1 (scripts/excerpt-flatten-probe.mjs) | node, direct dist/ import, no model download |
| Integration/E2E | 0 | -- | not applicable -- this change has no MCP-surface-facing test beyond the manual CLI run reproduced above |
| **Total** | **20 new unit + 1 manual gate** | **3** | |

---

### Changed File Coverage
Coverage tooling is not configured in this project (npm test has no --coverage script). Skipped -- not a failure, per Strict TDD Verify Step 5d.

### Assertion Quality
Scanned flatten-map.test.ts and excerpt.test.ts's new/modified content for banned patterns (tautologies, orphan empty checks, type-only assertions, ghost loops, smoke-test-only, implementation-detail coupling, mock-heavy ratios).

| File | Line(s) | Assertion | Issue | Severity |
|------|---------|-----------|-------|----------|
| excerpt.test.ts | Gate 4 case (around line 259-269) | expect(withFencesExcluded).toBe(flattenWithMap(markdown, false).text) | Not a tautology (calls real production code, asserts a real behavioral property -- S2 makes zero replacements on an odd backtick count, so both passes converge) -- but it is narrower than "measurement-only, no assertion" as D5/M1 frames it. Deliberate and defensible, but worth naming since the design explicitly says "no required outcome" | SUGGESTION |

No CRITICAL or WARNING-level assertion-quality issues found. Both describe blocks call real production code (flattenWithMap, buildExcerpt) in every it; no ghost loops (GENERATED_INPUTS is a static, always-non-empty array read from source, not a filtered runtime query); no mocks used anywhere in this change.

**Assertion quality**: 0 CRITICAL, 1 SUGGESTION (see F2 below)

---

### Quality Metrics
**Linter**: Not available (no lint script configured, confirmed via CLAUDE.md)
**Type Checker**: No errors (npm run typecheck, reproduced above)

### Issues Found

**CRITICAL**: None.

**WARNING**: None.

**SUGGESTION**:

- F1 -- Spec scenario 3 ("An odd fence-delimiter count leaves today's behavior unchanged") is covered only indirectly. The unterminated-fence fixture in flatten-map.test.ts is asserted solely via the generic I1-I3 invariant suite and the I4 golden-reference byte-equality check against referenceFlatten -- there is no direct, human-readable assertion anywhere (e.g. expect(excerpt).not.toContain(...)) that names this scenario the way Gate 2's test names "A fence holding a retained heading-pattern line...". I independently ran flattenWithMap against this exact fixture and confirmed the heading line is in fact stripped identically in both modes -- the behavior is correct -- but the test proving it depends on referenceFlatten staying a faithful independent witness (which it is, confirmed above) rather than on a scenario-named assertion. This matches tasks.md's own traceability table, which maps this scenario only to tasks 1.1/2.3 (fixture + production-fix confirmation), not to any excerpt.test.ts task -- so this is consistent with what was planned, not a gap against the plan.
- F2 -- Gate 4's assertion is narrower than "measurement-only." design.md D5/M1 states the case has "no required outcome; the only failing outcome is not measuring it." The implemented test does record the verbatim before/after strings in a comment (satisfying the letter of that), but its one expect() also asserts a real invariant (the true-pass output equals the false-pass output on this fixture) that would fail if S2's odd-backtick behavior ever changed. This is a reasonable and arguably better test than pure recording -- it turns "record the outcome" into a live regression detector for the mechanism rather than the string -- but it is not literally assertion-free the way "measurement-only" could be read. Not a defect; flagging because the launch prompt specifically asked whether the Gate 4 case is genuinely measurement-only.
- F3 -- The misaligned-even (non-guarantee 4) fixture asserts only structural invariants, not the documented leak. The "misaligned-even fence: stray closer, real heading, stray opener" fixture in flatten-map.test.ts is exercised by I1-I3 (generic) and I4 (byte-equality to referenceFlatten, which independently reproduces the same toggle logic and therefore the same misread). No test anywhere -- in flatten-map.test.ts or excerpt.test.ts -- asserts in business terms that the real heading text actually appears (leaks) in a buildExcerpt() output for this shape. This is consistent with design.md D4's own table, which scopes this fixture's purpose to pinning non-guarantee 4's known-wrong behaviour visibly rather than latently at the flatten-map.test.ts level only -- no task or design gate asked for an excerpt.test.ts case here, and shape 4 is explicitly a non-guarantee, not one of the six spec scenarios. Not a plan deviation; recorded because the launch prompt explicitly asked what the fixture asserts.

### Verdict
**PASS**

Zero CRITICAL, zero WARNING findings after independent re-execution of the full suite (812/812), typecheck, build, the live probe script, the live CLI search, and the eval gate, plus line-by-line reading of every changed production and test file. All 20 tasks are genuinely done, not merely checked. referenceFlatten is a real independent witness. The CLAUDE.md additions are factually accurate against the code, including the D6 trigger record. The three SUGGESTION findings (F1-F3) describe indirection in test-to-scenario mapping that matches what design.md/tasks.md actually planned -- none of them represent an unmet spec requirement or a broken invariant.
