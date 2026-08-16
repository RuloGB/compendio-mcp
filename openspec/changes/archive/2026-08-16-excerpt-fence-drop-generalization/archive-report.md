# Archive Report: Fenced Content Exclusion Must Handle Both Delimiter Styles and Interior Backticks

**Change**: `excerpt-fence-drop-generalization`

**Archived**: 2026-08-16 to `openspec/changes/archive/2026-08-16-excerpt-fence-drop-generalization/`

**Status**: PASS — verified, all implementation tasks complete, spec merged, three warnings from verification documented and resolved mid-apply

---

## Executive Summary

`search_docs` excerpt construction's fenced-block exclusion step has been generalized to recognize and exclude both backtick (`` ``` ``) and tilde (`~~~`) delimited code fences, and to handle fences whose interior contains literal backticks (a defect that broke the old backtick-only regex's pairing). The production change is one regex literal in `src/domain/flatten-map.ts:35`, from `` /```[^`]*```/g `` to `` /```[\s\S]*?```|~~~[\s\S]*?~~~/g ``, with gate corpus and live measurements proving both defects eliminated. The sibling requirement from the prior cycle (`excerpt-fence-aware-flatten`) has been narrowed to reflect that a retained heading-pattern line's locatability is pass-scoped, holding only on the fenced-blocks-included fallback pass, never on the excluded pass that now universally drops every fence style.

---

## Spec Merge

**File**: `openspec/specs/mcp-contract/spec.md`

**Actions**:
1. **MODIFIED** one existing requirement: "A Heading-Pattern Line Inside a Fenced Code Block Is Not Stripped From a `search_docs` Excerpt" — narrowed the preamble and added a new scenario clarifying locatability is pass-scoped
2. **ADDED** one new requirement with 12 scenarios: "Fenced Content Is Excluded From a `search_docs` Excerpt Regardless of Delimiter Style or Interior Backticks"

**Spec Placement**: The new requirement is inserted after the modified heading-retention requirement and before the `docs_overview` requirement.

**Scope**: Chunk-local, pass-scoped (excludes-pass only), with two named, accepted non-guarantees (balanced-parity divergence for well-formed inner fence pairs, and improperly interleaved fences).

**Existing Requirements Preserved**: All other requirements remain byte-identical. The sibling requirement (from `excerpt-fence-aware-flatten`) is now qualified with a new scenario and preamble narrowing rather than replaced.

---

## Implementation Summary

### Production Layer (`src/domain/flatten-map.ts`)

- **Line 33 comment update**: Changed `` // S2: `` comment to match new regex
- **Line 35 production regex**: `` /```[^`]*```/g `` becomes `` /```[\s\S]*?```|~~~[\s\S]*?~~~/g ``
  - First alternative: backtick-delimited fence using `[\s\S]*?` (non-greedy match-any) instead of `[^`]*` (exclude-backtick), eliminating the interior-backtick defect
  - Second alternative: tilde-delimited fence, mirroring the backtick pattern for consistency
  - Non-greedy `*?` is load-bearing: greedy would consume past the first closer to a later one, breaking nested-fence scenarios
- **Architecture**: No new imports, no new functions; one expression replacing one

### Test Layer (Strict TDD)

**Phase 1**: Gate fixtures (all created before production edit)
- 5 new fixture documents in `test/fixtures/excerpt-fence-drop/docs/`:
  1. `tilde-fence.md` (LF): mixed prose + `~~~json` fence + closing prose
  2. `tilde-fence-crlf.md` (CRLF): byte-identical to 1
  3. `interior-backtick-fence.md` (LF): mixed prose + backtick fence with interior backtick + prose
  4. `interior-backtick-fence-crlf.md` (CRLF): byte-identical to 3
  5. `control-backtick-fence.md` (LF): plain backtick fence, no tilde, no interior backtick — byte-identical-before-and-after control
- `.gitattributes` two-rule append: `` test/fixtures/excerpt-fence-drop/** text eol=lf `` then `` test/fixtures/excerpt-fence-drop/docs/*-crlf.md text eol=crlf ``

**Phase 2**: Anti-vacuity probe script
- `scripts/excerpt-fence-drop-probe.mjs`: Five counters (C1-C5) + self-check
- Imports: `flattenWithMap` and `SqliteIndexStore` only (no `isFenceDelimiter` import, design-required)
- Self-check: exits non-zero with two distinct messages (GATE IS VACUOUS vs THE FIX DID NOT LAND)

**Phase 3**: RED-observable assertions and fixtures (before production fix)
- `test/domain/excerpt.test.ts`: D4 inverted assertion (interior-backtick fence exclusion) + tilde-fence cases (LF/CRLF)
- `test/domain/flatten-map.test.ts`: 5 new GENERATED_INPUTS fixtures + Gate 3b (adjacent same-kind fences)

**Phase 4**: Production regex edit (GREEN)
- One-line production change, preceded by all gate artifacts
- `test/domain/flatten-map.test.ts:32` reference-flatten S2 regex updated identically
- **Mid-apply blocker resolved**: `test/domain/excerpt.test.ts:198-218` D3 test rewritten at `flattenWithMap` level, per D3-conflict resolution

**Phase 5**: Live corpus test + probe re-run
- `test/application/excerpt-fence-drop.test.ts`: 6 tests driving fixture corpus through `buildHarness`, assert one chunk per document, CRLF presence, tilde delimiter presence, end-to-end `search_docs` excerpt exclusion
- `test/helpers/build.ts`: EXCERPT_FENCE_DROP_DOCS constant added

**Phase 6**: Spec, docs, full suite
- `openspec/specs/mcp-contract/spec.md`: spec traceability confirmed, delta scenarios all present
- `CLAUDE.md`: new S2 bullet with exact regex, closed defects, accepted non-guarantees, probe command; amended sibling S1 and D8 bullets
- Full suite: `npm test` 844/844 passing (including 3 new test assertions from post-verify resolution), `npm run typecheck` clean, `npm run build` clean, `npm run eval` baseline unchanged

### Files Changed

| File | Action | Diff Lines |
|------|--------|-----------|
| `src/domain/flatten-map.ts` | Modified | 2 |
| `test/domain/flatten-map.test.ts` | Modified | 6 |
| `test/domain/excerpt.test.ts` | Modified | 48 |
| `test/application/excerpt-fence-drop.test.ts` | Created | 76 |
| `test/helpers/build.ts` | Modified | 4 |
| `scripts/excerpt-fence-drop-probe.mjs` | Created | 152 |
| `test/fixtures/excerpt-fence-drop/docs/*.md` | Created | 5 files |
| `.gitattributes` | Modified | 2 |
| `CLAUDE.md` | Modified | 65 |
| `openspec/specs/mcp-contract/spec.md` | Modified | 159 (new requirement + narrowing) |
| All other files | Unchanged | 0 |

**Total**: 516 changed lines (under the 400-line review budget risk, accepted via `size:exception`)

---

## Measured Results

### Before the Fix

- Backtick-delimited fence with interior backtick: NOT excluded (regex `[^`]*` cannot cross interior backtick, so `` /```[^`]*```/g `` matches only up to the interior backtick, leaving the closing `backtick + rest` as text)
- Tilde-delimited fence: NEVER excluded (regex is backtick-only, blind to `~~~`)
- Result: fenced-blocks-excluded and fenced-blocks-included passes produce byte-identical output, leaking the whole fence as prose

### After the Fix

- Backtick fence with interior backtick: excluded ✅ (`` [\s\S]*? `` crosses any character including backtick, paired to nearest closer)
- Tilde fence: excluded ✅ (`` ~~~[\s\S]*?~~~ `` alternative added)
- Result: fenced-blocks-excluded pass drops both styles; excerpts diverge correctly

### Probe Script Results (Fixture Corpus)

```
Before fix (reverted regex):
  C1: 2   C2: 2   C3: 4   C4 holds: true
  EXIT CODE: 1 — THE FIX DID NOT LAND

After fix (current tree):
  C1: 0   C2: 2   C3: 0   C4 holds: true
  EXIT CODE: 0

Anti-vacuity guard (fence-free corpus):
  C1: 0   C2: 0   C3: 0   C4 holds: false
  EXIT CODE: 1 — GATE IS VACUOUS
```

### Live End-to-End

- `node dist/cli.js --root ejemplos eval`: hybrid MRR 0.943, recall@5 1.00 (baseline unchanged — `ejemplos/` has no fences)
- Existing tests (sibling's "Prose before. Prose after." case): still passing ✅

### Traceability

All 12 spec scenarios covered:
- Nested/interleaved fences: flatten-map.test.ts GENERATED_INPUTS
- Tilde exclusion (lead/supporting/CRLF/info-string/indented): excerpt.test.ts + excerpt-fence-drop.test.ts + fixtures
- Interior-backtick divergence: excerpt.test.ts D4 assertion + fixtures
- Byte-identical-when-unaffected: control fixture + I4 golden reference
- Unterminated/fallback-pass/odd-count: design-traced and tested via golden reference or new post-verify test assertions

---

## Verification Summary

**Phase**: sdd-verify (1 session) — Verdict: PASS WITH WARNINGS

### Findings from Verification

**Completeness**:
- All 6 phases in tasks.md marked complete; code state matches
- 7-commit history ordered gate-first (RED-observable before production edit)
- All 3 pre-existing-assertion changes (D4, flatten-map.test.ts:32, D3 rewrite) documented and accounted for

**Test Coverage**:
- `npm test`: 844/844 passing (844 vs. design forecast of 840 due to post-verify test additions)
- `npm run typecheck`: clean
- `npm run build`: clean
- Three spec scenarios (interleaved residue, indented tilde fence, odd-count pair) had no automated test at verify time; resolved post-verify with 3 new `flattenWithMap`-level assertions in `test/domain/flatten-map.test.ts`

**Measured Gates**:
- Probe anti-vacuity: verified on both known-good and known-broken states
- Fixture EOL handling: CRLF preserved through indexing (C4)
- No AI attribution: confirmed via git log grep
- Zero-line diffs on unchanged files (excerpt.ts, read-document.ts, split-text.ts): re-confirmed

**WARNING (RESOLVED)**: Three scenarios were hand-traced only; post-verify commit added direct test assertions for all three. The indented-tilde-fence scenario, particularly, is not a non-guarantee — it is a core, common markdown feature that should have had regression protection from day one.

---

## Design Decisions Carried Forward

### D9: Commit Ordering and Gateability

The production regex edit is commits 6/7 (d7c0d16), preceded by all gate artifacts in commits 1-5. This ordering lets a single-PR diff show RED-observable gate failures before the fix exists, matching the two-PR split's reviewability advantage even inside one PR.

### D10: Non-Greedy vs. Greedy Pairing

The regex uses `*?` (non-greedy) for both delimiters. A greedy match would consume from the first opener to the *last* closer in the text, breaking nested-fence scenarios (a tilde fence inside a backtick fence). The load-bearing argument is recorded in CLAUDE.md's new S2 bullet.

### D11: Balanced-Parity Divergence (Accepted Non-Guarantee)

The fence-exclusion step does NOT consult whole-chunk delimiter-line parity (the check `read_doc` and heading-retention use). It pairs delimiters directly. Consequence: in a chunk with an odd total delimiter count but a well-formed inner pair, the pair is still dropped. This is documented as accepted, deliberate, and safer than the alternative (silencing the drop to match parity state).

### D12: Interleaved-Fence Non-Guarantee (Accepted)

A malformed document interleaving two fence styles leaves trailing unpaired text. No regression risk and no fix intended — the input is malformed markdown.

---

## Narrowing: The Sibling Requirement's Pass-Scoped Guarantee

The prior cycle's requirement (`excerpt-fence-aware-flatten`) promised a retained fence-interior heading-pattern line's match becomes locatable for lead-excerpt centering. That was implicitly unqualified. This cycle's generalization closes the fence-recognition gap the prior cycle's lack of tilde-fence coverage was incidentally masking — a tilde-fence-interior line happened to remain locatable because the exclude pass was blind to tilde fences and didn't drop them. Once both fence styles are recognized and dropped by the exclude pass, **no fence-interior heading can be locatable on the exclude pass** for any style. The guarantee is narrowed to: locatability holds ONLY on the fenced-blocks-included fallback pass (the case where the exclude pass yields no text at all, forcing a fallback that retains everything). This is specified as a new scenario in the modified requirement and recorded in CLAUDE.md.

---

## Open Items for Future Reference

### F1: D3 Conflict Resolution and D3 Test Rewrite

During `sdd-apply`, the production fix broke the sibling cycle's D3 test (`test/domain/excerpt.test.ts:198-218`), which had isolated S1's (heading-retention) map-locatability from S2's (fence-drop) behavior by using a tilde fence — invisible to the old backtick-only regex. Once S2 recognizes every style, no fence can isolate the two. The test was rewritten to observe the claim at the layer it actually lives (flat-mapping and offset computation, not high-level excerpt building), making the D3 guarantee's narrowing observable and testable. This is the third and last permitted existing-assertion change; future changes must stop and report at a fourth.

### F2: `isFenceDelimiter` Refactor Deferred Again

The constant `isFenceDelimiter` is imported by `flatten-map.ts` and `read-document.ts`, making it a shared utility across the flatten chain and the read-doc layer. The design noted it should move to its own module at a third consumer; this change's S2 regex does NOT import the predicate (design-required for low-diff constraint), so the trigger did not re-fire. The design's deferral is carried forward: the next consumer or the next touch to `split-text.ts` should extract it.

---

## Traceability: SDD Artifacts to Archive

All artifacts from exploration through verification have been moved to this archive folder:

- `proposal.md` — Scope, approach, and resolution of mid-apply D3 conflict
- `design.md` — Twelve architectural decisions (D1–D12) covering regex shape, non-greedy pairing, gate ordering, balanced-parity divergence, interleaved-fence handling, empty-pass semantics, and deferral rationale
- `specs/mcp-contract/spec.md` — New requirement with 12 scenarios, 2 accepted non-guarantees, narrowed sibling requirement with new scenario
- `tasks.md` — 6 phases, 32 tasks, with explicit delivery decision (single PR, size:exception), commit ordering requirement, and mid-apply resolution record
- `apply-progress.md` — RED evidence, D3 conflict blocker, GREEN confirmation, TDD cycle proof, probe script measurements, delivery stats
- `verify-report.md` — Completeness check, test execution, probe re-execution on known-good and known-broken states, spec scenario coverage, three open findings (resolved post-verify)
- `exploration.md` — Motivating defects identified and measured

---

## Ready for Publication

The change is production-ready:
- ✅ All 32 tasks complete and verified
- ✅ 844/844 tests passing (including 3 new post-verify assertions)
- ✅ One-line production regex, with gate corpus proving both defects eliminated
- ✅ Spec merged: 12-scenario requirement added, sibling requirement narrowed with new scenario
- ✅ Two accepted non-guarantees documented and named
- ✅ D3 conflict resolved with test rewrite (third permitted assertion change)
- ✅ Probe script verified on both known-good and known-broken states
- ✅ Live corpus (ejemplos/) baseline unchanged
- ✅ Zero-line diffs on unchanged files confirmed

The SDD cycle is **CLOSED**.
