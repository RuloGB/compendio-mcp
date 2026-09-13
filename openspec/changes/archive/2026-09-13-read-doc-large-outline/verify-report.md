## Verification Report

**Change**: read-doc-large-outline (revision 1, R1–R6)
**Version**: N/A (openspec artifact store)
**Mode**: Strict TDD

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 68 |
| Tasks complete | 68 |
| Tasks incomplete | 0 |

### Build & Tests Execution — independently re-run, not trusted from apply-progress

**Typecheck**: ✅ `npm run typecheck` — 0 errors (`tsc --noEmit && tsc -p tsconfig.test.json`)

**Build**: ✅ `npm run build` clean

**Tests**: ✅ 1050 passed / 0 failed / 1 skipped (57 test files) — `npm test`, 19.0s

**Stress probe** (`node scripts/outline-stress-probe.mjs`, against a fresh build): the probe imports `dist/composition.js` (`createContainer`) and `dist/server.js` (`formatReadResult`) — the real built code path through `IndexDocuments`/`ReadDocument`, not a reimplementation or mock. All 15 shape×size combinations (apiRef/flat/changelog × 105/500/1000/2000/5000) stayed within the 2300-token outline budget; changelog/5000 completes without throw or OOM (`docTokens 278531`, `outlineTokens 2106`). Max median exec time: ~62 ms (changelog/5000). The probe was re-run a second time by the orchestrator with matching results.

| shape | headings | docTokens | type | outlineTokens |
|---|---:|---:|---|---:|
| apiRef | 105 | 6350 | outline | 1022 |
| apiRef | 500 | 28429 | outline | 484 |
| apiRef | 1000 | 56304 | outline | 690 |
| apiRef | 2000 | 112304 | outline | 2130 |
| apiRef | 5000 | 280304 | outline | 2135 |
| flat | 105 | 5854 | full (below threshold) | 5857 |
| flat | 500 | 27974 | outline | 2142 |
| flat | 1000 | 55974 | outline | 2143 |
| flat | 2000 | 112224 | outline | 2145 |
| flat | 5000 | 280974 | outline | 2147 |
| changelog | 105 | 5837 | full (below threshold) | 5839 |
| changelog | 500 | 27865 | outline | 841 |
| changelog | 1000 | 55754 | outline | 1498 |
| changelog | 2000 | 111365 | outline | 2106 |
| changelog | 5000 | 278531 | outline | 2106 |

Every rendered outline is below its document's own token count. The two `full` rows are documents under the ~6000-token threshold and are served whole, as specified.

**ejemplos eval**: `node dist/cli.js --root ejemplos index` then `eval` → hybrid MRR **0.943**, recall@5 1.00.

**Pre-apply check re-run against final `dist/`** (task 12.5), in an isolated OS-temp project root with `forceLexical`:
- `docs/design-decisions.md`: `type=outline`, `tokens=13395`, `omitted={"kind":"none"}` → `full`
- `openspec/specs/indexing/spec.md`: `type=outline`, `tokens=17321`, `omitted={"kind":"none"}` → `full`

Both match the Acceptance table's prediction.

### Spec Compliance Matrix (representative sample — all 27 scenarios are traced in tasks.md's traceability table)

| Requirement/Scenario | Test | Result |
|---|---|---|
| Row budget ≤2300 tokens at 2000 headings, 3 shapes | `read-document.test.ts` [9.2–9.4] | ✅ COMPLIANT (`expect(Math.ceil(rowsText.length/4)).toBeLessThanOrEqual(2300)`) |
| No OOM at 5000 headings | `read-document.test.ts` [9.5], 10s timeout | ✅ COMPLIANT |
| No two rows share a normalized title | `read-document.test.ts` [4.1] | ✅ COMPLIANT (Set-size equality) |
| Heading repeated under several parents → one `repeated` entry with count | `read-document.test.ts` [4.2] | ✅ COMPLIANT |
| Title promoted top-level excluded from `repeated` | `read-document.test.ts` [4.4] | ✅ COMPLIANT |
| Title with child + single top-level occurrence → one top-level row ("top-level + H3 under a single parent") | `read-document.test.ts` [4.3] | ✅ COMPLIANT |
| Ordinary non-terse changelog version H2 NOT flagged `+other` | `read-document.test.ts` [6.2], real `IndexDocuments`/`RemarkMarkdownParser` chunker | ✅ COMPLIANT |
| `repeated` `Added` row flagged when fused with parent heading; not flagged when parent descends | `read-document.test.ts` [6.6] | ✅ COMPLIANT |
| D4 gate cap (2000 candidates) | `read-document.test.ts` [5.1]/[5.2] | ✅ COMPLIANT |
| Budget ladder steps 2/3 (subheadings / truncated) | `read-document.test.ts` [7.6]/[7.7] | ✅ COMPLIANT |
| `ejemplos/` corpus stays below threshold | `read-document.test.ts` integration test + live CLI eval | ✅ COMPLIANT |
| `AGENTS.md` `read_doc` bullet wording | Manual inspection | ✅ COMPLIANT |

### Correctness (Static Evidence)

| Item | Status | Notes |
|---|---|---|
| `OutlineSection.oversized` / `includesOtherContent` | ✅ Consistent | `src/application/read-document.ts` `OutlineSection` — revision 0's `overlapsOtherSection` renamed to `includesOtherContent` per R3; `oversized` unchanged |
| Document path excluded from the 2300-token budget | ⚠️ Documented non-guarantee | design.md Acceptance budgets and the spec both state the path is emitted once and not counted against the budget |

### Coherence (Design)

| Decision | Followed? | Notes |
|---|---|---|
| R1 — occurrence table, two-pass classification | ✅ | `buildOccurrenceTable` / `classifyRows`; tests 4.1–4.6 |
| R2 — short flags + legend | ✅ | `formatOutlineRow`; tests 7.3–7.4, 7.12 |
| R3 — own sections, `+other` | ✅ | All worked examples (a–d) and both consequences tested, several through the real chunker |
| R4 — budget ladder + gate cap | ✅ | `OUTLINE_ROWS_BUDGET_CHARS = 8000`, `MAX_GATE_CANDIDATES = 2000`, both tested |
| R5 — bounded work, no retained text | ✅ | `ComputedRow.content` and `overlaps()` removed; probe confirms no OOM at 5000 headings |
| R6 — probe → acceptance | ✅ | `scripts/outline-stress-probe.mjs` uses `import.meta.url` + `os.tmpdir()` and exits non-zero on a budget break |

### Issues Found

**CRITICAL**: None.

**WARNING**:
1. `scripts/outline-stress-probe.mjs` never machine-asserts `outlineTokens < docTokens`; it only fails on `outlineTokens > TOKEN_BUDGET`. The Acceptance budget requires the outline to be below the document's own tokens. This run confirmed it manually for all 15 rows, and the absolute 2300 bound implies it for any document above the ~6000-token threshold, but nothing enforces it on future runs.
   **Resolved after verify:** the probe now fails any `outline` row with `outlineTokens >= docTokens`, and `docs/manual-gates.md` lists the check. RED check: a scratch copy of the probe with the threshold tightened to `docTokens / 100` printed 10 failing rows and exited 1; the real probe prints 15/15 `ok` and exits 0.

**SUGGESTION**:
1. No test covers a pathologically long document path pushing the total rendered response past 2300 tokens while the rows stay in budget. This is a documented non-guarantee, not a defect; a note in `docs/manual-gates.md` would close the loop.

### Verdict

**PASS WITH WARNINGS** — every independently reproduced number (typecheck, 1050/1 tests, build, 15/15 probe shapes within budget with no OOM, MRR 0.943, both pre-apply-check documents resolving to `full`) matches the apply report. The single WARNING is a probe-completeness gap, not a functional defect.
