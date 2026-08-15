# Archive Report: `read_doc`'s Section Lookup Must Not Treat Fenced Code as Headings

**Change**: `read-doc-fence-aware-sections` (finding 1.4 from code-review-src-2026-08-14.md)

**Archived**: 2026-08-15 to `openspec/changes/archive/2026-08-15-read-doc-fence-aware-sections/`

**Status**: PASS WITH FINDINGS — verified, all implementation tasks complete, CRITICAL issues resolved

---

## Executive Summary

`read_doc`'s section lookup has been made fence-aware and chunk-local to prevent phantom headings inside fenced code blocks (markdown template examples, code samples) from becoming addressable section targets. The implementation exports a new predicate (`isFenceDelimiter`) from the domain layer, rewrites the `headingsIn` function to track fence depth using balanced-delimiter counting, and gates suppression on the balanced count to avoid regressions when a chunk straddles an open fence. The live occurrence was 17 phantom `##` headings in this repository's own `docs/documentation-convention.md`; those names no longer resolve. A critical CRLF regression was discovered mid-apply and fixed: moving from `matchAll(/…/gm)` to a per-line `.exec()` loses `/m`'s "`$` matches before any line terminator" semantics, and since `.` never matches `\r`, every heading match fails on CRLF input. The fix is an explicit `\r?` before `$`; the design document had asserted the opposite and was corrected after the fact. The change is fully tested, including mutation testing that proves the balanced guard is load-bearing, and verified against the repository's own corpus with a manual gate script.

---

## Spec Merge

**File**: `openspec/specs/mcp-contract/spec.md`

**Action**: ADDED one new requirement with six scenarios

**Requirement Name**: "A Heading Line Inside a Fenced Code Block Is Not an Addressable Section"

**Placement**: Inserted after the "`read_doc` Never Renders an Empty-Labeled Bullet..." requirement and before the "`docs_overview` Per-Document Line..." requirement (lines 87–155 in the merged spec).

**Scope**: Chunk-local fence tracking with four documented non-guarantees:
1. Unterminated fences (fence continues into a later chunk or end-of-document)
2. Chunk-crossing fences (fence opened in an earlier chunk, continues into this chunk)
3. Indented 4-space code blocks (no fence delimiter to detect)
4. Misaligned-even parity holes (stray closer from earlier + stray opener to later + heading between them; accepted over closing because it requires document-level state)

**Existing Requirements Preserved**: The "`search_docs`'s `section` Is Never Empty and Round-Trips" and "`read_doc` Never Renders an Empty-Labeled Bullet" requirements remain byte-identical.

---

## Implementation Summary

### Domain Layer (Phase 1)
- **Export `isFenceDelimiter`** predicate from `src/domain/split-text.ts:85` with a doc comment explaining it is a deliberate CommonMark approximation (not a stricter parser) and is shared with `read-document.ts`'s `headingsIn` function.

### Tooling (Phase 2)
- **Script `scripts/section-lookup.mjs`**: Added a manual gate tool to test `read_doc`'s section lookup directly. Mirrors the `vector-reach.mjs` precedent (header doc comment, no embeddings provider, constructed `SqliteIndexStore` directly). Outputs resolved heading, delimiter count per matched chunk, and an asserted self-check: exits non-zero when a match came from a content heading rather than a real chunk heading (the defect's exact shape). Satisfies Gate 1's before/after measurement requirement.

### Application Layer (Phase 3)
- **Rewrite `headingsIn`** in `src/application/read-document.ts` to hoist `HEADING_LINE` (H1 excluded per proposal), import `isFenceDelimiter`, compute `balanced` once before the loop, then loop with toggle-on-delimiter and skip-while-`inFence`, else test the heading pattern.
- **CRLF Fix**: the shipped pattern is `` /^#{2,6}\s+(.+)\r?$/ `` (`read-document.ts:138`) — an explicit **`\r?` before `$`**. It is not `.trim()` doing the work: `.` never matches `\r`, so `(.+)` stops before it and `$` without `/m` then fails at a position that is not end-of-input. Without the `\r?`, the match returns `null` and `.trim()` is never reached. `docs/documentation-convention.md` has 275 CRLF terminators; shipping the design as written would have silently broken all its real sections while fixing the phantom ones. See "Critical Findings" below for the measurement.

### Tests (Phases 1, 3, 4)
- **Phase 1.1**: `test/domain/split-text.test.ts` — Added `describe("isFenceDelimiter")` with 8 edge cases (` ``` `, `~~~`, four backticks, leading whitespace, info string, two backticks **false**, line containing backticks **false**). All pre-existing cases untouched.
- **Phase 3.1–3.5**: `test/application/read-document.test.ts` — Added five red-first test cases:
  - 3.1: Genuine deep heading outside any fence (regression guard)
  - 3.2: Merged-in-chunk heading still resolves (regression guard)
  - 3.3: Phantom fenced heading not resolvable (core scenario, **fails on unfixed tree**)
  - 3.4: Chunk beginning mid-fence (the load-bearing Decision 3 guard — would fail under naive toggle)
  - 3.5: Misaligned-even parity hole (known-wrong behaviour, **pinned with comment** explaining why reachability is narrow and this is accepted as documented, not a defect)
- **Phase 4.1**: Round-trip integration over `ejemplos/` corpus — every `search_docs` result's returned `section` passes verbatim into `read_doc({ path, section })`, asserting `type: "section"` never `section-not-found`. Confirmed before and after apply; Decision 3 edge is the only change with any chance of breaking it.
- **Mutation Testing**: Neutralizing the `balanced` guard (forcing `balanced = true`) makes exactly **one** test fail — **3.4**, *"a lone unbalanced fence delimiter must not suppress a real heading after it"* — proving the guard is load-bearing and not accidental. (Re-measured by the orchestrator; an earlier draft of this report named 3.5, which is the parity-hole pin and is unaffected by the guard.) `scripts/section-lookup.mjs` exit-code check was also proven genuine (changed the assertion to print instead of exit non-zero, confirmed it fails manually).

### Documentation (Phase 6)

#### CLAUDE.md (Non-obvious decisions)
Added bullet stating `read_doc`'s section lookup is fence-aware, chunk-local, shares the chunker's own `isFenceDelimiter` predicate (deliberate CommonMark approximation, not stricter parser), and names all four non-guarantees explicitly with the fourth distinguished by its opposite consequence (heading becomes unreachable, not merely unguarded).

#### Manual Gate Recipe
Added to CLAUDE.md beside the existing `vector-reach.mjs` recipe, showing the exact `node dist/cli.js --root . index --lexical` build/index step and `node scripts/section-lookup.mjs . "docs/documentation-convention.md" "Business rules"` invocation. Measured before/after outcomes included (verbatim from verify report).

#### Spec Delta (Fourth Non-Guarantee)
Extended the new requirement's Scope section with a fourth named non-guarantee for the misaligned-even parity hole, distinguishing it from the mid-fence-start shape by its opposite consequence (heading becomes unreachable vs. stays reachable).

---

## Critical Findings and Resolutions

### Finding 1: CRLF Regression (Critical, Resolved During Apply)
> **Corrected by the orchestrator after archive.** The first draft of this section restated the
> *falsified* theory as if it were the fix, and misattributed the code change. Both are corrected
> below. The original wording claimed the resolution was `.split("\n")` with `.trim()` stripping the
> `\r` — that is precisely the `design.md` claim this cycle measured false, and preserving it here
> would have taught the wrong mechanism to the next reader.

**Discovery**: `design.md` asserted, in the imperative ("Do not 'fix' this"), that CRLF behaviour was
unchanged, on the theory that `split("\n")` leaves a trailing `\r` inside the `(.+)` capture where
`.trim()` removes it. **Measured false, twice over:**

1. `.` **never** matches `\r` — it is a line terminator in JS regex — so `(.+)` stops *before* the
   `\r` and never captures it. `.trim()` never gets the chance to run.
2. `$` **without** `/m` matches only at end-of-input, which is now one character further along. The
   match therefore fails outright and returns `null`.

The old `matchAll(/…/gm)` was safe only because `/m` makes `$` match *before* any line terminator —
a property silently lost the moment the expression is evaluated per-line, which is exactly what
Decision 3's rewrite does. Measured:

```
line = "## Title\r"
per-line, no /m     -> null        <-- every heading lost
per-line, with \r?  -> "Title"
matchAll /gm        -> "Title"     <-- what the old code did, and why it worked
```

**Impact**: `docs/documentation-convention.md` carries 275 CRLF terminators. Shipping the design as
written would have silently broken **all** its real sections while fixing the 17 phantom ones — a
regression strictly worse than the defect being repaired.

**Resolution**: an explicit `\r?` before `$` in `HEADING_LINE`
(`src/application/read-document.ts:138`, now `/^#{2,6}\s+(.+)\r?$/`), with a red-then-green
regression test. **The code fix was made by the apply executor in commit `4912bf5`**, which found the
design claim false by measuring it rather than obeying it. Commit `4c40603` was made separately by
the orchestrator after `sdd-verify` raised WARNING-1, and touched **only** `design.md` — correcting
the stale claim in the artifact of record so it would not mislead a future reader. `sdd-verify`
independently confirmed the mechanism, the blast radius, and the completeness of the fix.

**Lesson**: an instruction *not* to change something is exactly as fallible as an instruction to
change it, and deserves the same measurement before it is obeyed. Two of the three applies in this
cycle found their own upstream artifact factually wrong — a `tasks.md` with inverted assertion
directions, and this `design.md` CRLF claim. In both cases the executor caught it, not the author.

---

## Verification Outcomes

### Gate 1 — Before State (Task 0.2, 2.4)
**Run**: `node scripts/section-lookup.mjs . "docs/documentation-convention.md" "Business rules"` against unfixed tree

**Result**:
- Discriminant: `section`
- Resolved chunk heading: "12. Templates"
- Fence-delimiter count: **2** (balanced)
- Content excerpt: (Templates material, containing fenced `## Business rules` phantom heading)
- Script exit code: **1** (non-zero, 2.3's self-check correctly detects that the match came from a content heading, not a real chunk heading)

**Conclusion**: Live occurrence confirmed; gate condition met for blocking priority.

### Gate 1 — After State (Task 5.1)
**Run**: `npm run build`, re-index `--lexical`, then rerun script

**Result**:
- Discriminant: `section-not-found`
- Available sections listed: Real numbered H2s and their H3s (no phantom `## Business rules` from Templates section)
- Phantom count: **0** of 17 previously enumerable phantom names remain
- Script exit code: **0** (2.3's self-check passes; no content-only match)

**Conclusion**: Phantom headings successfully suppressed; regression guard passes.

### Gate 3 — Round-Trip (Task 4.1)
**Corpus**: `ejemplos/` with FakeEmbeddings, 22 golden-set queries

**Result**: Every `search_docs` result's `section` round-trips through `read_doc({ path, section })` as `type: "section"` before and after apply. Decision 3's fence-aware `headingsIn` changes did not break existing round-trip correctness.

### Gate 4 — Chunk Boundary Invariant (Task 5.2)
**Measurement**: Chunk count and boundaries in `ejemplos/` before and after apply

**Result**: **Identical** — this change only adds an `export` keyword to the chunker's own module, plus new red-then-green test cases. No chunking-logic change. Also confirmed: `compendio eval` numbers remain within measured baselines (MRR ≥ 0.943, recall@5 = 1.00, top-1 ≥ 20/22).

### Gate 6 — Full Suite (Task 5.3)
**Commands**: `npm test` (792/792 green), `npm run typecheck`, `npm run build`

**Result**: All pass. Diff confirms:
- `test/application/read-document.test.ts`: Additions only (no modified assertions)
- `test/domain/split-text.test.ts`: Additions only (no modified assertions)
- `src/domain/flatten-map.ts`: Zero-line diff (explicitly untouched; fence blindness there is a documented non-goal, separate change)

---

## Sizing and Delivery

**Forecast** (tasks.md): 278–488 changed lines, `size:exception` already recorded in openspec/config.yaml

**Actual**: ~612 changed lines

**Overrun reason**: Unbudgeted CRLF work (discovering the regex anchor issue, correcting design.md during apply, validating the fix) added ~130 lines. This was necessary to avoid shipping a breaking regression; the cost is accepted.

**Delivery**: One PR (PR #33), all commits landed together. No chained-PR slicing (both call sites share one function, Gate 1 is blocking, case 2c is the change's own regression guard).

---

## Task Completion Checklist

All implementation tasks (Phases 0–6) are complete and merged into `main` (PR #33):

- [x] Phase 0: Measure design claims (0.1, 0.2)
- [x] Phase 1: Domain — expose `isFenceDelimiter` (1.1, 1.2, 1.3)
- [x] Phase 2: Tooling — `scripts/section-lookup.mjs` (2.1, 2.2, 2.3, 2.4)
- [x] Phase 3: Application — rewrite `headingsIn` (3.1–3.7, including CRLF fix mid-apply)
- [x] Phase 4: Round-trip regression (4.1)
- [x] Phase 5: Gate 1 after, full-suite gates (5.1, 5.2, 5.3)
- [x] Phase 6: Documentation (6.1, 6.2, 6.3, 6.4)
- [x] Phase 7: Commit plan (five work-unit commits per `work-unit-commits` skill)

Full suite: 792/792 tests green. Typecheck and build clean.

---

## Artifacts Archived

This change folder (`openspec/changes/2026-08-15-read-doc-fence-aware-sections/`) contains:

- `proposal.md` — scope, approach, live case, rollback plan
- `specs/mcp-contract/spec.md` — delta spec (6 scenarios, 4 non-guarantees)
- `design.md` — decisions, flow notes, CRLF analysis (corrected by 4c40603)
- `tasks.md` — all phases, task-to-scenario mapping, parity-hole resolution
- `verify-report.md` — gate measurements and outputs

---

## Spanish Vocabulary Audit

**Requirement**: Confirm `openspec/specs/` carries no residual Spanish contract vocabulary (`ruta`, `tipo`, `modulo`, `estado`, `etiquetas`, `seccion`, `omitidos`, `indexados`, `avisoEmbeddings`, `convencion`, `estadosExcluidos`, `camposFrontmatter`), except where quoting `ejemplos/` corpus.

**Checked**: Entire `openspec/specs/mcp-contract/spec.md` file (only spec file in the project at this time)

**Result**: ✅ **CLEAN** — zero Spanish contract vocabulary. All identifiers, field names, parameters, and requirements are English. No `tipo`, `modulo`, `estado`, `seccion`, `etiquetas`, or other retired Spanish terms appear. The only non-English text is this archive report's `Executive Summary` opening phrase "Archive Report" and section headings, which are in English.

---

## Risks and Open Items

### Resolved Risks
- **CRLF Regression** (critical): discovered and fixed by the apply executor (`4912bf5`) after measuring the design claim false; `design.md` itself corrected later by the orchestrator (`4c40603`). No residual risk.

### Documented Non-Guarantees (Accepted, Not Risks)
1. **Unterminated fences**: Fence continues into a later chunk or EOF — heading inside remains addressable (chunk-local scope).
2. **Chunk-crossing fences**: Fence opened in earlier chunk, continues into this chunk — heading inside remains addressable (no cross-chunk state).
3. **Indented 4-space code blocks**: No fence delimiter to detect — heading inside remains addressable.
4. **Misaligned-even parity hole**: Stray closer + heading + stray opener within one chunk, indistinguishable from self-contained fence — heading is suppressed. Reachability is narrow (requires tight packing of two fences with heading between them, no blank lines, and chunk boundary precisely isolating the pattern). Accepted over closing because closing requires document-level state.

### Explicitly Out of Scope (Separate Change Needed)
- **`src/domain/flatten-map.ts:92`**: Same fence-blindness issue affects `search_docs` excerpts. Deliberately untouched here; deserves its own change. Confirmed by diff: zero-line change to this file.

---

## Traceability

### Observation IDs
None — artifact store is OpenSpec mode (no Engram backend available this cycle). All artifacts are filesystem-persisted in `openspec/changes/archive/2026-08-15-read-doc-fence-aware-sections/`.

### Change Dependencies
- **Depends on**: `overview-counter-safety` (merged into `openspec/specs/mcp-contract/spec.md` first, ~line 125)
- **Feeds**: Next SDD change in the cycle (if any)

### Commit References
- **Apply Phase**: PR #33, 4 work-unit commits including `4912bf5` (fence-awareness + the CRLF fix). Commit `4c40603` is separate and post-verify: an orchestrator correction to `design.md` only
- **Verify Phase**: Confirmed against this branch state before archiving

---

## Sign-Off

**Change**: `read-doc-fence-aware-sections` (finding 1.4)

**Status**: ✅ **ARCHIVED — COMPLETE**

**Spec Merged**: `openspec/specs/mcp-contract/spec.md` updated with new requirement and four non-guarantees

**Folder Moved**: From `openspec/changes/2026-08-15-read-doc-fence-aware-sections/` to `openspec/changes/archive/2026-08-15-read-doc-fence-aware-sections/`

**Next Step**: Ready for the next SDD change in the cycle, or close if all three code-review findings have now been archived.

