# Archive Report: `overview-counter-safety`

**Archived**: 2026-08-15 · **Change**: finding 1.5 from code review pass · **Status**: COMPLETE

## Executive Summary

The `overview-counter-safety` change has been fully implemented, verified with PASS verdict, and archived. The data-integrity defect in `docs_overview`'s taxonomy counters — where bucket keys colliding with `Object.prototype` member names caused silent omission or garbled rendering — is now closed. One new MCP contract requirement governing bucket-value safety has been merged into the main spec.

## Artifacts Merged

### Specifications

**File**: `openspec/specs/mcp-contract/spec.md`

**Delta merged**: `openspec/changes/2026-08-15-overview-counter-safety/specs/mcp-contract/spec.md`

**Action**: ADDED one new requirement

**Details**: 
- **Requirement name**: `docs_overview` Taxonomy Counters Are Safe For Any `type`/`module` Value
- **Location in merged spec**: Lines 125–157 (immediately after "`docs_overview` Omits Empty Taxonomy Buckets", lines 109–123)
- **Scenarios added**: 5 scenarios covering `__proto__` and `constructor` values on both `type` and `module` fields, plus a mixed-value scenario
- **Relationship to existing requirement**: Sibling to "Omits Empty Taxonomy Buckets" (governs bucket presence), does not modify it. A corpus that genuinely declares no `type`/`module` still omits that line entirely, exactly as before
- **Destructiveness**: None. This is a pure addition with no deletions or rewrites to existing requirements

### Spanish Vocabulary Check

**Result**: PASS — No residual Spanish contract vocabulary found.

**Checked terms**: `ruta`, `tipo`, `modulo`, `estado`, `etiquetas`, `seccion`, `omitidos`, `indexados`, `avisoEmbeddings`, `convencion`, `estadosExcluidos`, `camposFrontmatter`

**Finding**: Specification uses only English technical identifiers (type, module, status, section, path, etc.). No Spanish vocabulary present in the merged main specs file.

## Defect and Fix Summary

### The Defect

`GetOverview.execute` in `src/application/get-overview.ts` counted documents into plain object literals (`byType` and `byModule`) using bracket assignment. On a plain object, property reads walk the prototype chain, so reading `byType["__proto__"]` or `byType["constructor"]` returned an inherited member rather than `undefined`, causing the `?? 0` fallback to fail to fire:

- **`__proto__`**: The Annex B setter ignores non-object values, so the assignment was a silent no-op → bucket vanishes entirely
- **`constructor`**: The inherited property is a writable data property, so assignment created an own property holding the string `"function Object() { [native code] }1"` → bucket renders as garbled text

Both values are reachable through ordinary inputs (frontmatter strings and folder names), and the bug wore the neighboring requirement's clothes: a corpus whose only type was `__proto__` rendered byte-identically to a corpus with no types at all.

### The Fix

Option A (recommended and implemented): `Map<string, number>` accumulators internally, converted to plain objects at the return boundary using `Object.fromEntries` (which **defines** properties, never assigns them). This confines the unusual runtime object to inside one function and matches the house idiom for keyed accumulators already used in five other files across the codebase.

**Binding constraint applied**: The conversion MUST use a property-**defining** operation (`Object.fromEntries`), not an assigning loop. An assigning loop would reintroduce the identical defect at the conversion instead of the accumulation.

### Framing (Load-Bearing)

**This is a data-integrity defect, NOT prototype pollution.**

Measured evidence (confirmed in verify-report):
- `Object.prototype` own property count is identical before and after
- Fresh objects created after the call show no stray enumerable keys
- The damage is confined to one freshly-constructed object inside one `execute()` call, with no cross-request persistence

Gate 3 in the test suite (non-regression, passes before and after) pins this framing so it cannot be re-filed as a security fix in the future.

## Implementation Status

**Branch**: fix/overview-counter-safety (merged into main, PR #31)

**Verification**: PASS (0 CRITICAL, 0 WARNING, 1 non-blocking SUGGESTION)

**Test Coverage**: 
- Gate 1: Both failure shapes reproduced and closed (type `__proto__` and `constructor`)
- Gate 1b: Self-consistency invariant for `byType` with anti-vacuity guard
- Gate 2: Twin-corpus differential for `byModule` via production-route folder names
- Gate 3: Prototype integrity (passes before and after, pins data-integrity framing)
- Gate 4: All existing assertions pass unmodified; nothing else moved
- Gate 5: Conversion uses `Object.fromEntries`, not an assigning loop

**Diff Statistics** (from verify-report):
- CLAUDE.md: +1 line
- src/application/get-overview.ts: +26 lines
- test/application/get-overview.test.ts: +257 lines
- **Total**: 278 insertions, 6 deletions (well under 400-line budget, no size:exception needed)

**Commits** (3 conventional commits, per work-unit-commits):
1. `test(application): pin GetOverview prototype-integrity as non-regression (Gate 3)`
2. `fix(application): make GetOverview's byType/byModule accumulation safe for any key value`
3. `docs: note docs_overview bucket-value safety in CLAUDE.md`

## Spec Validation

**Pre-existing requirements checked**: 
- "`docs_overview` Omits Empty Taxonomy Buckets" (line 109) — unmodified, unaffected
- All other `mcp-contract` requirements — unmodified

**New requirement scenarios**: All 5 scenarios in the added requirement map directly to implementation behavior and test assertions:
1. `__proto__` type → Scenario 1 test
2. `constructor` type → Scenario 2 test
3. `__proto__` module → Scenario 3 test (via folder name, production route)
4. `constructor` module → Scenario 4 test (via folder name, production route)
5. Mixed hostile + ordinary values → Scenario 5 test

**Verified against code**: Design.md Decision 1's normative code block is copied byte-for-byte into the implementation.

## Process Notes

### Tasks Artifact State

All 24 tasks in `openspec/changes/2026-08-15-overview-counter-safety/tasks.md` are marked complete (`[x]`). Spot-checked against code state in verify-report; no unchecked tasks remain.

### Notable Findings in Verify Report

1. **Tasks 2.1–2.4 inverted assertion direction** — The tasks.md as originally written asserted the *absence* of hostile buckets, which would have passed vacuously pre-fix (since the Annex B setter makes `__proto__` truly absent). The executor caught this via the STOP condition and substituted spec-authoritative wording (asserting *presence* + correct type + correct value). Design.md and spec.md remain authoritative; this deviation is documented in verify-report and does not affect the shipped tests (which assert the correct thing).

2. **Anti-vacuity guard is load-bearing** — The self-consistency helper for `byType` includes an assertion that the parsed line count equals `overview.documents.length`. Mutation testing confirmed this guard prevents false passes when the helper's regex matches nothing on both sides.

3. **Forbidden predicate identified** — `Object.prototype.hasOwnProperty('__proto__') === false` was tested as a pollution check during exploration and produced a false positive. This predicate is explicitly forbidden in Gate 3 and absent from all live code.

## Risks and Mitigations

| Risk | Likelihood | Mitigation | Residual |
|---|---|---|---|
| Re-filed as security fix | Med | Gate 3 + design framing + verify-report all pin data-integrity classification | None — framing is load-bearing in test |
| Conversion regresses to assigning loop | Low | Three-layer enforcement: normative code block copied verbatim, Gate 1 asserts against returned object (fails on assigning conversion), durable "Do NOT" comment | None — shipping implementation passes all gates |
| Existing tests break | Low | Gate 4 confirmed all pre-existing assertions pass unmodified | None — full suite 765/765 green |

## Deployment Notes

- **No persisted state change**: Counters are computed at query time from `listDocuments()`. The fix takes effect on the next `docs_overview` call; revert takes effect on the next call after `git revert`.
- **No schema change, DDL, config key, or path-shape change**: `ejemplos/goldenset.yaml` and `compendio eval` are unaffected.
- **No reindex required**: Unlike changes affecting persisted chunk boundaries (e.g., `bounded-chunk-size`), this fix does not require a full `compendio index` to reach existing corpora.

## Resolved Dependencies and Decisions

**Related changes in the same review pass**:
- **1.3 (`filter-input-hygiene`)**: Separate change, disjoint files and tests (search tool, not overview). Archived immediately before this one.
- **1.4 (`read-doc-fence-aware-sections`)**: Separate change, unrelated scope. The 1.4-vs-1.5 split was user-decided on 2026-08-15 and is not re-opened here.

**Mechanism choice**: Option A (Map + Object.fromEntries) chosen per design.md Decision 1, with no reversal needed.

**Audit completed**: All other `Record<string, T>` accumulators in src/ audited; none are vulnerable (five sites use `Map`, four use `Set`; the sole plain-object site is this one).

## Closure

This change is complete across all four SDD phases:
- **Proposal**: Understanding and scope defined
- **Spec**: One new requirement added to `mcp-contract`
- **Design**: Mechanism selected and behavioral gates defined
- **Apply**: Implementation merged to main; full test coverage; all gates green
- **Verify**: PASS verdict; 0 CRITICAL, 0 WARNING
- **Archive**: Delta merged; no destructive edits; report written

The SDD cycle for `overview-counter-safety` is closed.
