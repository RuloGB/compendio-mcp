# Tasks: Filter Input Hygiene — one enforcement point, one definition of a tag

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 265–330 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | exception-ok |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | PR | Notes |
|------|------|----|-------|
| 1 | `normalizeTags` module + tests | PR 1 | Revertible per design Open Q1 |
| 2 | `resolveTags` delegates to it | PR 1 | `frontmatter.test.ts` unmodified = falsifier |
| 3 | `buildFilters` fix + comments | PR 1 | Depends on unit 1 |
| 4 | `seedDoc` hardening + Gates 1–4 | PR 1 | Depends on unit 3 |
| 5 | Spec + `CLAUDE.md` | PR 1 | Doc-only |

If over budget, cut along `module` first / `tags` second (independent normalizations, independent gates).

## Phase 1: Shared Tag Normalization

- [x] 1.1 RED: `test/domain/tags.test.ts` for `normalizeTags` — trim, lowercase, drop-empty, mixed, all-empty, empty-input, idempotence. Confirm fails (no module yet).
- [x] 1.2 GREEN: add `src/domain/tags.ts`, export `normalizeTags(values)` (Decision 3). Zero non-stdlib imports (hexagonal purity).

## Phase 2: Indexing-Side Delegation (behavior-preserving)

- [x] 2.1 `src/domain/frontmatter.ts:29-36` `resolveTags` delegates: `return { tags: normalizeTags(raw) };`.
- [x] 2.2 FALSIFIER: run `test/domain/frontmatter.test.ts` **unmodified** — must pass with zero edits.

## Phase 3: Query-Side Fix (the behavioral change)

- [x] 3.1 RED: widen `seedDoc` (`index-and-search.test.ts:518-521`) with `module?`/`tags?`; throw if seeded `tags` aren't already canonical per `normalizeTags` (Decision 6 — makes the tags false-green hazard structural).
- [x] 3.2 RED: Gate 1 — corpus with a declared `module`; precondition `expect(collectFacets(store.listDocuments()).modules).not.toEqual([])` (module-less-corpus hazard guard). Assert pre-fix `module: ""`/`"   "` → `[]` + `noMatchReason` `no document has module ""`.
- [x] 3.3 RED: Gate 3 — corpus with **no** declared module, pinned `.modules` `toEqual([])`. Assert pre-fix `module: ""` → `filterWarning` naming `convention.frontmatterFields`.
- [x] 3.4 RED: Gate 2 — corpus `tags: ["api"]` (canonical, via 3.1 seam). Assert pre-fix `tags: [" api"]` and `["api","  "]` both miss with `no document carries " api"`.
- [x] 3.5 GREEN: `search-documents.ts:131-143` `buildFilters` — trim `module`, omit if blank (mirrors `type`, Decision 2); `tags` = `normalizeTags(query.tags)` then `length > 0` check (Decision 7 order matters).
- [x] 3.6 GREEN: confirm Gates 1–3 now `toEqual` the filter-omitted call (set-equality, not "non-empty" — see design's assertion-shape note).
- [x] 3.7 GREEN: Gate 4 — `tags: []` unchanged; unknown-value filter still reports `noMatchReason`; `module: "Identity"` vs query `"identity"` still misses (no lowercasing); `index-and-search.test.ts:546` passes **unmodified**.

## Phase 4: Contract Documentation

- [x] 4.1 `src/domain/model.ts`: promote `SearchFilters` comment to interface level (Decision 4 — invariant + producer obligation + `excludedStatuses` exemption).
- [x] 4.2 `search-documents.ts` `SearchQuery` (lines 13-24): replace `type`-only comment with interface-level caller policy (Decision 4).
- [x] 4.3 Verify `search-diagnostics.ts`, `server.ts`, `cli.ts`, `sqlite-index-store.ts` stay **byte-unchanged** (Decisions 1, 5 — fork B and CLI trim removal both rejected).

## Phase 5: Spec and Docs

- [x] 5.1 Verify `specs/search/spec.md`'s `module`/`tags` requirements match shipped behavior (owned by `sdd-spec`; verification only). Confirmed: already in place, matches implementation exactly, no edits needed.
- [x] 5.2 Add one `CLAUDE.md` entry: single chokepoint at `buildFilters`, blank-silent for all three fields, shared `normalizeTags`, diagnostics deliberately non-defensive, `parseType`'s trim kept as tripwire.

## Phase 6: Final Verification

- [x] 6.1 `npm test` full suite green; `search-diagnostics.test.ts`, `cli.test.ts` unmodified.
- [x] 6.2 `npm run typecheck` and `npm run build` clean.
- [x] 6.3 `git diff` confirms only additions to existing test files, no modified assertions (Gate 5).
- [x] 6.4 Record each gate's verbatim "before" string in the verify report (`strict_tdd: true`).
