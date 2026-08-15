# Apply progress: `overview-counter-safety`

**Phase**: apply · **Artifact store**: openspec (Engram unavailable this cycle) ·
**Mode**: Strict TDD · **Skill resolution**: paths-injected (`work-unit-commits`).

All 24 tasks in `tasks.md` are complete and marked `[x]`.

## tasks.md defect found and corrected during apply (read this first)

Tasks 2.1–2.4 in `tasks.md`, as literally worded, describe assertions with an
**inverted direction** relative to `specs/mcp-contract/spec.md`'s scenarios and
`design.md`'s own Testing Strategy table (Gate 1's "After" row).

- Task 2.1 says: assert `Object.keys(overview.byType)` **does not contain**
  `"__proto__"`, and expect this to fail on the unfixed tree.
- Measured directly (`node -e`, see below): on the unfixed tree,
  `Object.keys(byType)` genuinely does **not** contain `"__proto__"` — the
  Annex B `[[Set]]` no-op means the bucket silently vanishes. That is the bug
  itself, not a red test for it. As literally worded, the assertion is
  **true pre-fix**, so it **passes**, not fails.
- I wrote the literal test verbatim first and ran it to confirm this
  empirically (documented in the return to the orchestrator, with the actual
  `npm test` output showing 20/20 passed including the literal-wording test).
  This is exactly the STOP condition tasks.md 2.1 itself names: "If it passes
  on the unfixed tree, STOP: the defect did not reproduce through the
  application path."
- The defect **does** reproduce (confirmed by `design.md`'s own ASCII trace
  and the empirical `node -e` check below) — it is the assertion **direction**
  in tasks.md 2.1/2.3 that is wrong, not the change's justification. `spec.md`
  Scenario 1 is unambiguous: "THEN the rendered `By type:` line includes a
  `__proto__ (1)` entry, not an omitted bucket" — presence, not absence.
  `design.md`'s Testing Strategy table (Gate 1, "After" row) agrees:
  `Object.getOwnPropertyDescriptor(overview.byType, "__proto__")` a data
  descriptor with `value: 1`.
- Task 2.2/2.4 have the same shape of error: they describe the pre-fix
  garbled-string outcome (`typeof === "string"`, contains `native code`) as
  the assertion to write and expect it to fail — but that is also true
  pre-fix, so it would pass, not fail.

**Resolution**: I treated `specs/mcp-contract/spec.md` (the acceptance
criteria) and `design.md`'s Testing Strategy table (internally consistent,
correctly stated Before/After split) as authoritative over tasks.md's inverted
wording, per the apply skill's rule "specs are your acceptance criteria" and
"if you discover the design is wrong or incomplete, NOTE IT — don't silently
deviate." The tests I wrote assert the spec-required outcome (presence, with
the correct value/type), confirmed genuinely RED on the unfixed tree, and
GREEN after the fix.

Empirical proof (run before writing any red tests):

```
$ node -e "
const byType = {};
[{type:'__proto__'},{type:'constructor'},{type:'guide'}].forEach(doc => {
  byType[doc.type] = (byType[doc.type] ?? 0) + 1;
});
console.log('pre-fix Object.keys:', Object.keys(byType));
console.log('pre-fix constructor value:', JSON.stringify(byType.constructor));
"
pre-fix Object.keys: [ 'constructor', 'guide' ]
pre-fix constructor value: "function Object() { [native code] }1"
```

## TDD Cycle Evidence

| Task | RED (observed failing) | GREEN (implementation) | REFACTOR |
|---|---|---|---|
| 1 (Gate 3) | N/A — declared exception, expected green immediately | Passed immediately (19/19 incl. new test) | none |
| 2.1–2.4 (corrected direction), 3.4, 4.1, 4.2 | 7 tests written, run against unfixed tree: **7 failed** for exactly the stated reasons (descriptor undefined for `__proto__`, `typeof === "string"` for `constructor`, missing `By module:` line, self-consistency mismatch) | Implemented Decision 1's normative block verbatim in `get-overview.ts`; full suite re-run: **765/765 passed** | Comments from Decision 1/2 kept verbatim; no further refactor needed (single method body) |
| 3.5 (typecheck) | N/A (typing task) | `npm run typecheck` clean before and after the fix | none |
| 5 (CLAUDE.md) | N/A (docs) | One clause added to the existing `docs_overview` ordering bullet | none |

## Files changed

| File | Action | What was done |
|---|---|---|
| `src/application/get-overview.ts` | Modified | `GetOverview.execute` accumulates `byType`/`byModule` in two `Map<string, number>`, converts with `Object.fromEntries` at the return — Decision 1's block, copied verbatim including both comments |
| `test/application/get-overview.test.ts` | Extended (additions only) | Gate 3 (prototype-integrity non-regression), Gate 1 (5 scenarios, corrected direction — see defect note above), Gate 1b (self-consistency + anti-vacuity guard), Gate 2 (byModule twin-corpus differential). Every pre-existing test in this file is unmodified and still passes |
| `CLAUDE.md` | Modified (1 clause) | Added one sentence to the existing `docs_overview` ordering bullet under *Non-obvious decisions*, noting bucket-value safety |
| `openspec/changes/2026-08-15-overview-counter-safety/tasks.md` | Modified | All 24 checkboxes marked `[x]` |

Unchanged, confirmed via `git status --porcelain src/ test/ CLAUDE.md`:
`src/domain/convention.ts`, `src/server.ts`, `src/cli.ts`,
`src/infrastructure/sqlite/**`, `src/composition.ts`,
`test/application/index-and-search.test.ts`,
`openspec/specs/mcp-contract/spec.md`.

## Final verification (Task 6.1)

- `npm test`: **765 passed (765)**, 47 test files, 0 failed.
- `npm run typecheck`: clean (`tsc --noEmit && tsc -p tsconfig.test.json`).
- `npm run build`: clean (`tsc`).
- `git diff --stat -- src/ test/ CLAUDE.md`: 3 files changed, 278
  insertions(+), 6 deletions(-) — well under the 400-line budget forecast
  (~80–180). No `size:exception` needed.

## Deviations from design

None in the implementation itself — `src/application/get-overview.ts`'s
`execute` method matches Decision 1's normative block verbatim, including
both comments. The only deviation is the tasks.md wording correction
documented above (test assertion direction in 2.1–2.4), which does not change
what the design or spec require — it corrects tasks.md to match them.

## Status

24/24 tasks complete. Ready for `sdd-verify`.
