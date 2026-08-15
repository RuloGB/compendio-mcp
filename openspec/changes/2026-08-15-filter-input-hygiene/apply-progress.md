# Apply Progress: Filter Input Hygiene

**Status**: all 22 tasks complete (6/6 phases). `strict_tdd: true` followed throughout.

## Summary

`SearchDocuments.buildFilters` (`src/application/search-documents.ts`) is now the single
chokepoint (design.md Decision 1, Fork A) that normalizes all three caller-supplied filter
fields: `type` (unchanged), `module` (now trimmed, omitted when blank — same four lines as
`type`, Decision 2), and `tags` (now normalized through a new shared `normalizeTags`,
Decision 3). `src/domain/search-diagnostics.ts`, `src/server.ts`, `src/cli.ts`, and
`src/infrastructure/sqlite/sqlite-index-store.ts` are byte-unchanged, as required.

## RED evidence — verbatim "before" strings (recorded per task 6.4)

All four gates below were observed failing against the pre-fix tree, with the tests written
first and confirmed RED before `buildFilters` was touched.

**Gate 1 (case A — module blank, corpus declares modules)**:
```
AssertionError: expected { mode: 'lexical', results: [], … } to deeply equal { mode: 'lexical', … }
+ "noMatchReason": "no document has module \"\" (declared: \"identity\", \"leads\").",
+ "results": [],
```

**Gate 3 (case B — module blank, corpus declares no modules)**:
```
+ "filterWarning": "Ignored the \"module\" filter: no document in this project declares that
  field, so it could never match. Results below are unfiltered. If you expected \"module\" to
  work, the project needs convention.frontmatterFields to map its frontmatter keys.",
```

**Gate 2 (tags — padded entry `" api"`)**:
```
+ "noMatchReason": "no document carries \" api\" (declared: \"api\").",
+ "results": [],
```

**Gate 2 corollary (tags — blank entry `""`, the CLI's `--tags ""` shape)**:
```
+ "noMatchReason": "no document carries \"\" (declared: \"api\").",
+ "results": [],
```

Gate 4 (module case-preservation, unknown-value diagnostic, `tags: []` no-op) and the module
whitespace check (`"   "`) were **not** hazards — they passed both before and after, as
expected for an invariant gate, and are recorded here so a future reader does not mistake
"passed on first run" for "not tested": the whitespace assertion in Gate 1's test body ran
only after the blank-string assertion above it failed and stopped the test, and was
independently confirmed passing in the post-fix GREEN run.

## GREEN evidence

`npx vitest run test/application/index-and-search.test.ts` after the `buildFilters` fix:
`Test Files 1 passed (1)` / `Tests 47 passed (47)`.

## Two false-green hazards addressed structurally (per the task brief)

1. **Module-less-corpus hazard**: Gate 1's test asserts
   `collectFacets(store.listDocuments()).modules` is non-empty before trusting its "before"
   result; Gate 3's test pins the opposite (`toEqual([])`).
2. **Dirty-seed hazard**: `seedDoc` (`test/application/index-and-search.test.ts`) now throws
   when given non-canonical `tags` — implemented as a throw, not downgraded to a comment, per
   the task brief's explicit instruction to keep Decision 6's Open Question 3 at its stronger
   setting.

## Falsifiers confirmed

- `test/domain/frontmatter.test.ts` passes **unmodified** after `resolveTags` was changed to
  delegate to `normalizeTags` (11/11 tests, zero edits to the file).
- `test/domain/search-diagnostics.test.ts`, `test/cli.test.ts` are byte-identical to `main`
  (`git diff main -- <file>` empty for both).
- `src/cli.ts`, `src/server.ts`, `src/domain/search-diagnostics.ts`,
  `src/infrastructure/sqlite/sqlite-index-store.ts` are byte-identical to `main`.

## Final verification

- `npm test`: 48 test files, **768 tests passed**, 0 failed.
- `npm run typecheck`: clean (`tsc --noEmit && tsc -p tsconfig.test.json`).
- `npm run build`: clean.
- `git diff main -- src/cli.ts`: empty (confirmed twice — before and after the full change).

## Scope note

`src/domain/tags.ts` + `test/domain/tags.test.ts` + the `resolveTags` delegation were kept in
two separate commits from the `buildFilters` fix, exactly as design.md's Open Question 1
recommends, so the shared-normalization scope addition can be reverted independently without
unpicking the query-side behavioral fix.

## Commits (on `fix/filter-input-hygiene`, branched from `main`)

1. `feat(domain): add shared tag normalization` — `src/domain/tags.ts`,
   `test/domain/tags.test.ts`
2. `refactor(domain): delegate resolveTags to normalizeTags` — `src/domain/frontmatter.ts`
3. `fix(search): normalize module and tags filters in buildFilters` —
   `src/application/search-documents.ts`, `src/domain/model.ts`,
   `test/application/index-and-search.test.ts`
4. `docs: record the buildFilters normalization chokepoint` — `CLAUDE.md`

## Deviations from tasks.md

None. `spec.md` was verified matching shipped behavior with zero edits needed (task 5.1) —
it already stated the `module`/`tags` empty-is-absent rule and the mixed-array scenario
exactly as implemented.
