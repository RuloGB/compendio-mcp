# Verification Report

**Change**: multiple-doc-roots
**Version**: N/A (openspec deltas, not yet merged into base specs — merge happens at archive)
**Mode**: Strict TDD

## Supersession notice

**This report supersedes the previous partial verification** (PR 1-3 only, 51/51 tasks, PASS WITH
WARNINGS, 3 warnings). This is the **full-scope, final verification**: all 4 PRs, 70/70 tasks,
across `feat/multiple-doc-roots-01-exclude-prefix` → `-02-structural-core` →
`-03-behavioural-companions` → `-04-surface-and-docs`. The prior partial report's content is
replaced in place, not appended, per the task's explicit instruction. All findings below were
independently re-derived in this pass — nothing is carried forward on trust, including the
manual-gate numbers that happen to match.

Artifact store this cycle: openspec (file-based). Engram MCP tools were confirmed unavailable
again this batch — no `mem_*` calls made.

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total (whole 4-PR chain) | 70 |
| Tasks complete | 70/70 |
| Tasks incomplete | 0 |

All 70 checkboxes across all four PR phases in `tasks.md` were spot-checked against the actual
repository state — source inspection, git history, and running code — not taken on trust. Nothing
is outstanding-by-plan any more; the chain is complete.

## Build & Tests Execution

**Build**: PASS
```text
$ npm run build
> compendio-mcp@1.2.9 build
> tsc
(no output, exit 0)
```

**Typecheck**: PASS
```text
$ npm run typecheck
> compendio-mcp@1.2.9 typecheck
> tsc --noEmit && tsc -p tsconfig.test.json
(no output, exit 0)
```

**Tests**: PASS — 648 passed / 0 failed / 0 skipped
```text
$ npm test
 Test Files  43 passed (43)
      Tests  648 passed (648)
   Duration  7.06s
```
Matches `apply-progress.md`'s claimed final count exactly (identity), re-run independently rather
than quoted. Up from 639 at the end of PR 3 — the +9 matches PR 4's own accounting
(`generate-index-md.test.ts` 4, `read-document.test.ts` 2, `config.test.ts` 1, `composition.test.ts` 2).

**Coverage**: Not available — no coverage tool configured (`vitest.config.ts` has no coverage
provider wired, `package.json` has no `--coverage` script). Reported cleanly, not a failure, per
Strict TDD module rules.

**Linter**: Not available — `package.json`'s `scripts` block has no `lint` entry (confirmed by
direct inspection), matching `CLAUDE.md`'s own statement.

## Gate 7 — diffed against `main`, across the whole 4-PR chain (highest-priority check)

Re-run independently, not quoted from `apply-progress.md`. `main` was confirmed a strict ancestor
of `HEAD` first (`git merge-base --is-ancestor main HEAD` → true), so a diff against `main` is
exactly the 4-PR chain's own changes, nothing else:

```
$ git diff main -- src/application/sync-index.ts | wc -l
0
$ git diff main -- src/infrastructure/sqlite/sqlite-index-store.ts | wc -l
0
$ git diff main -- src/application/read-document.ts | wc -l
0
$ git diff main -- src/domain/ports.ts | wc -l
0
```

All four zero-diff. `SCHEMA_DDL`/`documents(path TEXT UNIQUE NOT NULL)` is byte-identical; `SyncIndex`
needed no change because identity was solved entirely at discovery (Decision 1); `ReadDocument` needed
no change because the strip-fallback was already correct once every path is prefixed (Decision 12);
`ports.ts` needed no change because the composite implements the existing `DocumentSource` port.

Union-type grep, via the Grep tool (ripgrep-backed — see `apply-progress.md`'s Deviation #1 on why the
shell `grep` builtin misparses this exact pattern on this Windows/Git-Bash environment):
```
pattern: string\s*\|\s*string\[\]   path: src/
→ No matches found
```

**Confirmed, with no disagreement from the orchestrator's claim.** All three of this instruction's
checks — `sync-index.ts` zero-diff, `SCHEMA_DDL` zero-diff, zero `string | string[]` in `src/` — hold.

## The three previously-open WARNINGs — each confirmed genuinely closed

### WARNING #1 — the `..`-prefixed nested-root edge case had zero test coverage

**Closed, confirmed.** `test/infrastructure/config.test.ts` now contains an assertion equivalent to
`expect(() => resolveRoots(PROJECT, ["docs", "docs/..cache"])).toThrow(...)`.
This test is part of the file that passed 648/648 (the full suite includes it). The implementation
at `config.ts:198` (`rel !== ".." && !rel.startsWith(\`..${sep}\`)`) is unchanged — the warning's own
static-inspection finding ("implementation already correct") holds — and now has automated coverage
where it previously had none.

### WARNING #2 — Gate 3 narrative misattribution (docs/documentation-convention.md vs openspec/testing-capabilities.md)

**Closed, confirmed.** `apply-progress.md`'s Batch 3 "Manual Gate 3" section now carries an explicit
correction naming `openspec/testing-capabilities.md` as the real root-level/no-module document, with
the arithmetic stated (`changes (N) + specs (6) + transversal (1) + testing-capabilities.md (no
module) = total`). Independently re-verified in this pass:
- `docs/documentation-convention.md:1-8` carries pre-existing frontmatter `module: transversal` — read
  directly, confirmed present.
- `openspec/testing-capabilities.md:1-10` carries no frontmatter block at all — starts directly with
  `# Testing Capabilities — compendio-mcp`.
Both facts match the correction. Not re-litigated here as a new finding — it is closed.

### WARNING #3 — the `--dir` requirement was missing from `specs/configuration/spec.md`

**Closed, confirmed.** `specs/configuration/spec.md` now contains a fourth ADDED requirement,
"`--dir` Replaces the Declared Root Set With One Directory", with two scenarios (override replaces a
multi-root config entirely; produces the identical prefixed path shape as an equivalent one-element
`docsDir`). Both scenarios have covering tests in `test/composition.test.ts`
(`describe("createContainer — docsDir override (--dir) replaces the configured root set...")`, two
`it` blocks at lines 111 and 135), confirmed present and passing as part of the 648/648 run.

**All three WARNINGs from the PR 1-3 partial verification are genuinely closed, not merely claimed
closed.**

## Re-measured independently, not quoted from apply-progress.md

### Gate 1 — goldenset identity, on `ejemplos/`

```
$ node dist/cli.js --root ejemplos index
Indexed 11 documents (29 chunks) in 3307 ms [mode hybrid]
```
All 11 paths carried the `docs/` prefix (`docs/glosario.md`, `docs/leadsviewer/...`, etc.) — same
set/count as pre-change + `docs/`.

```
$ node dist/cli.js --root ejemplos eval

mode      recall@5   MRR      failures
--------------------------------------
hybrid    1.00       0.943    0
lexical   0.95       0.856    1

Failures in lexical mode:
- "¿Qué endpoint hay que llamar para crear un lead?" -> docs/leadsviewer/alta-leads.md (position 11)
```
Identity with `CLAUDE.md`'s documented pre-change baseline (hybrid MRR 0.943, recall@5 1.00). `git
status --short ejemplos/` confirmed clean afterward — no leftover diff, no `.compendio/` committed.

### Gate 2 — the motivating case, on this repository

Formula computed independently before running: `find docs -name "*.md"` → 2; `find openspec -name
"*.md" -not -path "openspec/changes/archive/*"` → 17; `2 + 17 − 1 (INDEX.md) = 18`.

A temporary `compendio.config.json` (`{ "docsDir": ["docs","openspec"], "exclude": ["INDEX.md",
"openspec/changes/archive"] }`) was written at the repo root:
```
$ node dist/cli.js index --lexical
Indexed 18 documents (345 chunks) in 251 ms [mode lexical]
```
Matches the formula exactly: **18 = 18**. SQL checks against the resulting `.compendio/compendio.db`
(queried directly via `better-sqlite3`, not inferred):
```sql
SELECT count(*) FROM documents WHERE path LIKE 'openspec/changes/archive/%';            -- 0
SELECT count(*) FROM documents;                                                         -- 18
SELECT path FROM documents WHERE path NOT LIKE 'docs/%' AND path NOT LIKE 'openspec/%'; -- []
```
Zero archived paths (would read a much larger number if the directory-prefix `exclude` were matched
against the wrong path). Every indexed path carries either the `docs/` or `openspec/` prefix,
unconditionally. Temp config and `.compendio/` deleted immediately after; `git status --short`
confirmed clean.

Note: this repository's own `openspec/changes/multiple-doc-roots/` directory now contains 10 files
(the 9 counted during PR 3's manual gate, plus this `verify-report.md`, which did not exist at PR 3
apply time — confirmed by `apply-progress.md`'s own note that `verify-report.md` is an `sdd-verify`
artifact, not written during apply). This is why this run's total (18) and module counts below differ
from PR 3's own recorded 17/"changes (9)" — the corpus genuinely grew by one file between batches, not
a discrepancy.

### Gate 3 — `module` is still a folder signal, not a root name

Same corpus, `overview`:
```
$ node dist/cli.js overview
Indexed documents: 18
By type: guide (1)
By module: transversal (1), changes (10), specs (6)
```
Arithmetic: `changes (10) + specs (6) + transversal (1) = 17`, `+ 1` (`openspec/testing-capabilities.md`,
no module) `= 18`. No `docs`/`openspec` bucket — confirmed. `docs/documentation-convention.md` is
correctly assigned `module: transversal` via its own pre-existing frontmatter (frontmatter wins over
inference, per spec), not via naive root-alias inference — consistent with WARNING #2's correction.
Temp config and `.compendio/` deleted immediately after; `git status --short` confirmed clean.

### Gate 4b — the silent-data-loss guard, empirically re-falsified again in this pass

Per the task's explicit instruction to not merely re-read the previous falsification, this was run
again independently, from a clean working tree:

```
$ git status --short                                    # clean before
$ sed -i 's/path: root\.prefix,/path: root.declared,/' src/infrastructure/fs/composite-document-source.ts
$ npx vitest run test/infrastructure/composite-document-source.test.ts test/application/sync-index.test.ts

 FAIL  test/infrastructure/composite-document-source.test.ts > CompositeDocumentSource >
       a failed root's ReadError.path is its ALIAS, never its declared string — silent-data-loss guard
   Expected: "docs"  Received: "packages/app/docs"

 FAIL  test/application/sync-index.test.ts > SyncIndex — Gate 4b ... > end to end through the real
       CompositeDocumentSource over a nested, differently-aliased root
   AssertionError: expected [ 'docs/a.md', 'docs/nested/b.md' ] to deeply equal []

 Test Files  2 failed (2)
      Tests  2 failed | 26 passed (28)

$ git checkout -- src/infrastructure/fs/composite-document-source.ts
$ git status --short                                    # clean after
$ npx vitest run test/infrastructure/composite-document-source.test.ts test/application/sync-index.test.ts
 Test Files  2 passed (2)
      Tests  28 passed (28)
```

Confirmed genuine, not a vacuous or reasoning-only claim, and not merely re-reading the prior report's
transcript — this is a fresh, independent falsification run in this verification pass. Breaking
`root.prefix` → `root.declared` in `composite-document-source.ts` makes exactly the two tests fail that
should fail (the direct unit assertion and the end-to-end Gate 4b assertion wired through the real
composite), while the two hand-constructed Gate 4b tests correctly stay green.
`src/infrastructure/fs/composite-document-source.ts:64` (`path: root.prefix,`) confirmed unchanged
after revert; `git status --short` clean both before and after.

## `scripts/vector-reach.mjs` — run end to end, independently (not re-run by the orchestrator before this)

```
$ node dist/cli.js --root test/fixtures/vector-reach index
Discovering documents
Indexing 6 documents
[1/6] docs/distractor-01.md
...
[6/6] docs/manual-extenso.md
Embedding 19 chunks in 2 batches
Indexed 6 documents (19 chunks) in 2613 ms [mode hybrid]
```
The fixture ships no `compendio.config.json` (confirmed absent), so `docsDir` resolves to the
implicit `["docs"]` default and every path is prefixed `docs/...`, exactly as the fixture's directory
layout (`test/fixtures/vector-reach/docs/`) always implied.

```
$ node scripts/vector-reach.mjs test/fixtures/vector-reach "código de verificación interna QUETZAL"

#1  chunk 16  docs/manual-extenso.md  heading="Manual extenso"  containsMarker=true   cosine=0.8841
#2  chunk 17  docs/manual-extenso.md  heading="Manual extenso"  containsMarker=false  cosine=0.8420
...
Filler band (min/max cosine, non-marker chunks): [0.8336, 0.8420]

Marker chunk 16 (docs/manual-extenso.md)
Criterion A — rank of the marker chunk in the vector-only ranking: 1 of 10
Criterion B — marker chunk cosine vs query: 0.8841
Criterion C — truncation probe (first 384 words of the document vs the marker chunk): 0.9408
Diagnostics — marker string offset inside its chunk: 1164 chars; chunk length: 1681 chars
```
Exit code confirmed `0`. No crash, no `TypeError`, no `ENOENT`. The script's own monotonicity
self-check (rank and cosine must come from the same stored-vector population — see the script's own
header comment) printed nothing, i.e. no violation.

**Reading against the design's own criteria** (Decision 5's table — `CLAUDE.md`'s own warning that the
recorded numbers predate `addressable-chunks` is honored here: this is what was measured, not what the
old pre-`addressable-chunks` table predicted):
- Criterion A (rank): required `1` → measured `1`. **PASS.**
- Criterion B (cosine): required `>= 0.855` **and** strictly above this run's own filler-band ceiling
  (`0.8420`) → measured `0.8841`. Both hold. **PASS.**
- Criterion C (truncation probe): reported, not gated → `0.9408`.

Owning-root resolution confirmed correct by inspection of `scripts/vector-reach.mjs:210-213`: it calls
the same production `resolveRoots` (imported from `../dist/infrastructure/config.js`), finds the
marker chunk's owning root by prefix match, and slices the alias off before joining — no second,
divergent implementation of root resolution. `git status --short test/fixtures/vector-reach/`
confirmed empty after the run (`.compendio/` there is gitignored).

This closes the one instruction item explicitly flagged as untested by anyone but apply — it has now
been independently re-run end to end by this verification.

## Cross-checks performed (source inspection + git history, not inferred)

1. **`GenerateIndexMd`'s three `INDEX_FILE` equality checks — all three retargeted, not just one.**
   Read `src/application/generate-index-md.ts` in full: line 49 (`readErrors` filter), line 54 (entries
   filter), line 85 (`encodingNotices` filter) all compare against `this.selfPath`, not the literal
   `INDEX_FILE`. `composition.ts:101-112` passes `${roots[0]!.prefix}/${INDEX_FILE}` unconditionally.
   The `exclude: []` guarantee holds: `test/application/generate-index-md.test.ts`'s
   `"GenerateIndexMd — combined index across declared roots, exclude: [] ..."` describe block
   constructs a real `CompositeDocumentSource` + `FileDocumentSource` pair with `exclude: []` — the
   only config that reaches all three checks — and asserts self-exclusion holds and both roots'
   documents are listed under their prefixed paths. Confirmed passing as part of 648/648.

2. **`ReadDocument`'s four mcp-contract scenarios all have covering tests.** Exact prefixed-path hit
   and over-prefixed hit are covered above the new Phase 15 describe block (pre-existing, from PR 2's
   Deviation #2). The aliased-collision residual case and the bare-basename miss are covered by two new
   tests in `test/application/read-document.test.ts` (lines 139 and 176), both exercising a real
   `createContainer` / `buildHarness` round trip, not fakes. `read-document.ts` itself: zero diff
   against `main` (confirmed above under Gate 7), matching Decision 12's "a test, not an edit."

3. **The collision guard's full case matrix, including the newly closed `..`-prefixed case.** Dedicated
   tests exist for: nested outer-first, nested inner-first (the one-directional-sweep escape),
   duplicate, case-differing duplicate (`it.skipIf(process.platform !== "win32")`, runs on this dev
   machine), alias clash, empty array, and now the `..`-prefixed nested-directory-name edge case — at
   both the `resolveRoots` unit level (`config.test.ts`) and the container level (`composition.test.ts`).
   `config.ts:189-216` implements the ordered-pair sweep exactly as `design.md` Decision 5 specifies.

4. **No architectural leakage.** `grep "^import"` across every file in `src/domain/` resolves either to
   another file inside `src/domain/` or a `type`-only import — zero SQLite, transformers.js, or
   filesystem imports, confirmed by direct inspection of both matching files (`convention.ts`,
   `ports.ts`). `inferModule(path, rootPrefixes?)` and `createConventionPolicy(cfg, rootPrefixes?)`
   receive the alias list purely as a `readonly string[]` parameter threaded from `composition.ts`,
   never as an infrastructure import — confirmed by reading `convention.ts:53-58,73,168-173` in full.

5. **`inferModule`'s "first match wins" semantics, read against the implementation.** `convention.ts:54`
   uses `Array.find`, matching the design's stated semantics exactly (`rest = first p in rootPrefixes
   with path.startsWith(p + "/")`). Well-defined only because `resolveRoots` rejects nested roots first
   — both properties independently confirmed above.

6. **The `--dir` override wiring.** `composition.ts:63-66` normalizes `options.docsDir !== undefined ?
   [options.docsDir] : config.docsDir` before calling `resolveRoots`, exactly as Decision 10 specifies.
   `ContainerOptions.docsDir?: string` is unchanged (single-valued). Two new container-level tests
   (`composition.test.ts:111,135`) exercise this through a real `createContainer`, confirmed passing.

7. **Unchanged-by-design files, asserted not assumed, across the full 4-PR chain vs `main`.**
   `sync-index.ts`, `sqlite-index-store.ts`, `read-document.ts`, `ports.ts` — all zero-diff (Gate 7
   section above). `file-document-source.test.ts:99`'s original throw-test body confirmed still present
   and unmodified in intent (the primitive still rejects on an unreadable root).

8. **Declared deviations across all four batches** — read in full from `apply-progress.md` and spot-
   checked: the naive-`inferModule` intermediate state (skip/restore in PR 2/3), the two extra files
   needing re-addressing (`test/fixtures/strict/compendio.config.json`, `test/cli-subprocess.test.ts`),
   the shell-`grep`-vs-Grep-tool quoting trap (PR 4, Deviation #1 — a real environment gotcha, correctly
   caught and not acted on), and the "GREEN-on-first-write, then empirically falsified" pattern used for
   Phase 15 and both remaining warnings (PR 4) — all confirmed real, harmless, and honestly described.
   The empirical-falsification pattern was independently re-run for Gate 4b in this verification (see
   above) and found genuine, which is the strongest available confirmation that the pattern itself is
   trustworthy across the rest of its uses in this change.

9. **Assertion quality, spot-checked across the PR 4 additions.** `generate-index-md.test.ts`'s new
   describe blocks: every test calls production code, asserts concrete values, and the one
   `toEqual([])` assertion (line 313, filtering a self-path `readError` out of `skipped`) has a real
   non-empty companion elsewhere in the same file (line 218), so it is not an orphan empty-collection
   check. `composition.test.ts`'s `--dir` tests and `read-document.test.ts`'s two new tests: real
   `createContainer`/`buildHarness` round trips through actual files on disk, no tautologies, no ghost
   loops, no mock-heavy ratios. No CRITICAL or WARNING assertion-quality issues found in the sample.

10. **`openspec/specs/search/spec.md` — confirmed zero "path" occurrences**, matching task 17.2's claim:
    `grep -ci "path" openspec/specs/search/spec.md` → `0`. Nothing to amend there.

11. **README.md and CLAUDE.md checked against code, not against the proposal.** `README.md:132,149-171`
    documents array-only `docsDir` with no single-string form, the always-prefixed shape including
    zero-config, the three-clause directory-prefix `exclude`, and `--dir`'s replaces-not-adds semantics
    — all match the implementation verified above. `CLAUDE.md`'s "Non-obvious decisions" section
    (lines 162-165) carries the four expected bullets (array-only + prefixing + collision guard;
    three-clause `exclude`; unreadable-vs-removed-root contrast; alias-aware `module`), plus a corrected
    `read_doc`-tolerance bullet (line 192) naming the aliased-collision non-guarantee and the
    bare-basename-miss consequence, and an updated Working Conventions bullet (line 204) stating this
    repository's own implicit `docsDir: ["docs"]`. All read in full and cross-checked against the
    running code above, not merely against the proposal's stated intent.

## Spec Compliance Matrix (full 4-PR scope, all four deltas)

| Requirement (delta file) | Scenario | Test | Result |
|---|---|---|---|
| configuration: `docsDir` Is a Non-Empty Array | No-config default `["docs"]`, still prefixed | `goldenset-addresses.test.ts` (Gate 1b) + manual Gate 1 | COMPLIANT |
| configuration: `docsDir` Is a Non-Empty Array | One-element array behaves like any other | `config.test.ts` normalization case | COMPLIANT |
| configuration: `docsDir` Is a Non-Empty Array | Two-root array derives one alias per root | `config.test.ts`, `composition.test.ts` | COMPLIANT |
| configuration: Colliding/Nested/Duplicate/Empty Rejected | Nested, outer-first | `config.test.ts`, `composition.test.ts` | COMPLIANT |
| configuration: Colliding/Nested/Duplicate/Empty Rejected | Nested, inner-first (the escape case) | `config.test.ts`, `composition.test.ts` | COMPLIANT |
| configuration: Colliding/Nested/Duplicate/Empty Rejected | Duplicate entries | `config.test.ts`, `composition.test.ts` | COMPLIANT |
| configuration: Colliding/Nested/Duplicate/Empty Rejected | Case-differing duplicate (win32) | `config.test.ts`, `composition.test.ts` (skipIf) | COMPLIANT (platform-conditional, runs on this dev machine) |
| configuration: Colliding/Nested/Duplicate/Empty Rejected | Alias clash | `config.test.ts`, `composition.test.ts` | COMPLIANT |
| configuration: Colliding/Nested/Duplicate/Empty Rejected | Empty array | `config.test.ts`, `composition.test.ts` | COMPLIANT |
| configuration: Colliding/Nested/Duplicate/Empty Rejected | Fresh project, no `.compendio/` after rejection | `composition.test.ts` | COMPLIANT |
| configuration: Colliding/Nested/Duplicate/Empty Rejected | `..`-prefixed nested directory name (was WARNING #1) | `config.test.ts` (new, PR 4) | COMPLIANT — closed |
| configuration: `exclude` Matches a Directory Prefix | Directory-prefix, prefixed path | `file-document-source.test.ts`, manual Gate 2 | COMPLIANT |
| configuration: `exclude` Matches a Directory Prefix | Exact-match/basename unchanged | `file-document-source.test.ts` (pre-existing) | COMPLIANT |
| configuration: `--dir` Replaces the Root Set (was WARNING #3, requirement added PR 4) | Override replaces multi-root config | `composition.test.ts` (new, PR 4) | COMPLIANT — closed |
| configuration: `--dir` Replaces the Root Set | Identical shape to equivalent `docsDir` | `composition.test.ts` (new, PR 4) | COMPLIANT — closed |
| indexing: Root-Alias-Prefixed `path`, Always | Path carries root alias | manual Gate 2, `goldenset-addresses.test.ts` | COMPLIANT |
| indexing: Root-Alias-Prefixed `path`, Always | Same-basename files, different roots, no collision | `composite-document-source.test.ts`, `index-and-search.test.ts` multi-root case | COMPLIANT |
| indexing: Removing a Root Purges Documents | Sync-pass delete-on-absence, unmodified | `sync-index.test.ts` (pre-existing coverage, unaffected) | COMPLIANT (no new mechanism needed, per the requirement's own text) |
| indexing: Retrieval Evaluation Corpus Stays Addressable | Re-addressed, re-measured | manual Gate 1 before/after | COMPLIANT |
| indexing: Read Failures Protect the `path` Subtree (MODIFIED) | One of several roots unreadable | `composite-document-source.test.ts`, manual Gate 4 | COMPLIANT |
| indexing: Read Failures Protect the `path` Subtree (MODIFIED) | Sole root fails = all fail, still throws | `composite-document-source.test.ts` | COMPLIANT |
| indexing: Read Failures Protect the `path` Subtree (MODIFIED) | Every root fails | `composite-document-source.test.ts`, manual Gate 4 | COMPLIANT |
| indexing: Read Failures Protect the `path` Subtree (MODIFIED) | Failed root's `path` is its alias, protects subtree | `sync-index.test.ts` Gate 4b — independently re-falsified twice now | COMPLIANT |
| indexing: Field Inference in `loose` Mode (MODIFIED) | `module` relative to containing root | `convention.test.ts`, `index-and-search.test.ts` `byModule` test, manual Gate 3 | COMPLIANT |
| index-md: One Combined `INDEX.md` Across All Roots | Two-root combined file, first root | `generate-index-md.test.ts` (new, PR 4) | COMPLIANT — closed |
| index-md: One Combined `INDEX.md` Across All Roots | Default single-root set still one file, prefixed | `generate-index-md.test.ts` | COMPLIANT — closed |
| index-md: `INDEX.md` Never Lists Itself, Any Root Count | Default config, default root set | `generate-index-md.test.ts` (pre-existing) | COMPLIANT |
| index-md: `INDEX.md` Never Lists Itself, Any Root Count | Default config, two roots | `generate-index-md.test.ts` (new, PR 4) | COMPLIANT — closed |
| index-md: `INDEX.md` Never Lists Itself, Any Root Count | `exclude: []` override — the only case with teeth | `generate-index-md.test.ts` (new, PR 4, Gate 6) | COMPLIANT — closed |
| mcp-contract: Root-Prefixed `path` Flows Through Tools | Prefixed paths in `search_docs`/`docs_overview`, round-trip via `read_doc` | manual Gate 2, `index-and-search.test.ts` multi-root round trip | COMPLIANT |
| mcp-contract: `read_doc` Tolerates One Extra Leading Segment | Exact hit / over-prefixed hit | `read-document.test.ts` (PR 2 Deviation #2) | COMPLIANT |
| mcp-contract: `read_doc` Tolerates One Extra Leading Segment | Aliased-collision residual case | `read-document.test.ts` (new, PR 4) | COMPLIANT — closed |
| mcp-contract: `read_doc` Tolerates One Extra Leading Segment | Bare-basename miss | `read-document.test.ts` (new, PR 4) | COMPLIANT — closed |

**Compliance summary**: 33/33 scenarios compliant across all four spec deltas. Zero UNTESTED, zero
FAILING, zero PARTIAL. The scenarios reported as "NOT YET IMPLEMENTED — PR 4" in the prior partial
report are all now COMPLIANT, marked "— closed" above for traceability against that prior report.

## Correctness (Static Evidence)

| Requirement | Status | Notes |
|---|---|---|
| `resolveRoots` ordered-pair sweep, both directions, via `path.relative` | Implemented | `config.ts:189-204`, matches Decision 5 verbatim |
| Alias-clash sweep | Implemented | `config.ts:206-216` |
| Seven validation messages | Implemented | Verified against design's table; wording matches |
| `CompositeDocumentSource` — merge, sort, per-root tolerance, aggregate rethrow | Implemented | Zero `node:` imports confirmed by reading the file in full |
| `ReadError.path` is the alias | Implemented, empirically re-verified twice | See Gate 4b section |
| `inferModule` alias-aware, "first match wins" | Implemented | `convention.ts:53-58` |
| Container guard before `new SqliteIndexStore` | Implemented | `composition.ts:63-67`, confirmed by "no `.compendio/`" tests depending on this ordering |
| `--dir` normalizes to one-element array | Implemented | `composition.ts:63-66`, now with dedicated test coverage |
| `GenerateIndexMd.selfPath` | Implemented | `generate-index-md.ts:42,49,54,85`; `composition.ts:101-112` |
| Three dead `INDEX_FILE` equality checks retargeted | Implemented, all three confirmed | Lines 49/54/85, all compare against `this.selfPath` |
| `scripts/vector-reach.mjs` array-aware | Implemented, run end to end | `vector-reach.mjs:210-213`, calls production `resolveRoots` |
| README.md / CLAUDE.md prose | Implemented, checked against code | See Cross-check 11 |

## Coherence (Design)

| Decision | Followed? | Notes |
|---|---|---|
| 1 — seeded prefix, `isRoot` replaces `prefix === ""` | Yes | `file-document-source.ts`, PR 1 |
| 2 — primitive throws, composite owns tolerance | Yes | `file-document-source.test.ts:99` unchanged, verified byte-identical |
| 3 — composite merges/sorts, never rewrites a path | Yes | Zero `node:` imports in `composite-document-source.ts` |
| 4 — `ReadError.path` is the alias | Yes | Empirically re-falsified twice across the two verify passes |
| 5 — ordered-pair sweep, `path.relative`, both directions | Yes | Inner-root-first, case-differing-duplicate, and `..`-prefixed cases all tested |
| 6 — guard runs before `new SqliteIndexStore` | Yes | `composition.ts:59-67` |
| 7 — `inferModule` takes optional `rootPrefixes` via factory | Yes | No `ConventionConfig`/`FrontmatterInput` change |
| 8 — `exclude` is three clauses, one rule | Yes | PR 1, `file-document-source.ts:84-86`-equivalent |
| 9 — `GenerateIndexMd.selfPath` | Yes | PR 4, all three checks retargeted, confirmed |
| 10 — `--dir` stays single-valued | Yes | `ContainerOptions.docsDir?: string` unchanged, now covered by tests |
| 11 — `vector-reach.mjs` calls `resolveRoots` | Yes | Run end to end in this pass, confirmed no divergent second implementation |
| 12 — `ReadDocument` is a test, not an edit | Yes | `read-document.ts` zero diff vs `main`, all 4 mcp-contract scenarios covered |
| 13 — harness prefixes via `resolveRoots` | Yes | `test/helpers/build.ts:98,103` |
| 14 — goldenset re-addressed, gated by `goldenset-addresses.test.ts` | Yes | Confirmed genuine RED-then-GREEN via git history and independent re-measurement |

## TDD Compliance (Strict TDD module)

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | Yes | Present in `apply-progress.md` for all 4 batches, with per-task RED/GREEN/TRIANGULATE/SAFETY NET/REFACTOR columns |
| All tasks have tests | Yes | 70/70 tasks have an identifiable covering test file, source-code change, or (for docs-only tasks) a prose location |
| RED confirmed (tests exist) | Yes | Spot-checked across all 4 PRs: `composite-document-source.test.ts`, `sync-index.test.ts` Gate 4b block, `config.test.ts`'s `resolveRoots` block (incl. the new `..cache` test), `composition.test.ts` (incl. the new `--dir` block), `generate-index-md.test.ts`'s new `selfPath` blocks, `read-document.test.ts`'s new Decision-12 block — all exist and match their described scope |
| GREEN confirmed (tests pass) | Yes | 648/648 on this run, re-executed independently |
| Triangulation adequate | Yes | Composite source: 9 cases over fakes; `resolveRoots`: 13 cases (12 + the new `..cache` case); collision guard: 9 container-level cases (7 + 2 `--dir`); `read_doc` tolerance: 4 distinct scenarios |
| Safety Net for modified files | Yes | Full-suite reruns recorded at each phase boundary in `apply-progress.md`, cross-checked against this run's identical final count |

**TDD Compliance**: 6/6 checks passed

One methodological note, not a defect: PR 4's Phase 15 and both remaining warnings used a
"write-the-test, confirm-immediate-GREEN, then empirically-falsify-by-breaking-production-code"
pattern instead of a traditional pre-code RED, because the design and the prior verify-report's
static inspection both already asserted the underlying production code was correct (no code change was
predicted). This is the same pattern PR 2's task 7.1 and PR 3's Gate 4b used. This verification
independently re-ran the falsification for Gate 4b (the highest-stakes instance — silent data loss) and
confirmed it genuine; that gives reasonable confidence the pattern was applied honestly elsewhere too,
though only Gate 4b was independently re-executed rather than merely re-read.

---

### Test Layer Distribution (informational)

| Layer | Approx. Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | ~46 (config incl. `..cache`, composite-source, convention, file-document-source) | 4 core files | Vitest, fakes only |
| Integration | ~24 (sync-index Gate 4b, index-and-search multi-root, read-document incl. Decision-12 block, generate-index-md multi-root) | ~7 files | Vitest, real `SqliteIndexStore(":memory:")` |
| Container | ~13 (`composition.test.ts` incl. `--dir`, `goldenset-addresses.test.ts`) | 2 files | Vitest, real `createContainer` |
| Total (whole suite) | 648 | 43 | |

No E2E/browser layer in this project (CLI + MCP server over stdio); `test/cli-subprocess.test.ts` is
the closest analog.

---

### Assertion Quality

Spot-checked, in full, across every file changed in PR 4 plus the highest-risk PR 2/3 files
(`composite-document-source.test.ts`, `composition.test.ts`, `sync-index.test.ts`'s Gate 4b block):
every test calls production code, asserts concrete values (not tautologies), no ghost loops over
possibly-empty collections, no mock/assertion ratio issue. The one orphan-looking empty-collection
assertion found (`generate-index-md.test.ts:313`, `expect(report.skipped).toEqual([])`) has a real
non-empty companion assertion elsewhere in the same file (line 218), so it is not vacuous.

**Assertion quality**: No CRITICAL or WARNING issues found in the sampled files. A full line-by-line
audit of every touched test file across all 70 tasks was not performed exhaustively given the scope;
the sample covers every PR 4 addition plus the highest-risk, silent-data-loss-adjacent files from
PR 2/3.

---

### Changed File Coverage

Not available — no coverage tool configured in this project. Reported cleanly, not a failure, per
Strict TDD module rules.

---

### Quality Metrics

**Linter**: Not available — no lint script configured (confirmed directly in `package.json`, matching
`CLAUDE.md`'s own statement).
**Type Checker**: No errors (`npm run typecheck` clean, re-run independently in this pass).

## Issues Found

**CRITICAL**: None.

**WARNING**: None. All three WARNINGs carried over from the PR 1-3 partial verification are confirmed
closed above (the `..`-prefixed nested-root test, the Gate 3 narrative correction, and the `--dir` spec
requirement). No new WARNING-level issues were found in this full-scope pass.

**SUGGESTION**:
1. A full line-by-line assertion-quality audit across all 70 tasks' test changes was not performed
   exhaustively — the sample in this report and the prior partial report together cover every file
   flagged as highest-risk (silent-data-loss guards, the collision guard, all PR 4 additions), but a
   handful of purely mechanical re-addressed literals (the ~29 goldenset-adjacent path prefixes) were
   not individually re-read line by line in this pass. Low priority: these are one-line, mechanical,
   address-only edits with no logic, and the `goldenset-addresses.test.ts` gate independently proves
   every goldenset address is a real indexed path regardless of how each individual literal edit was
   made.
2. This repository's own corpus is not stable across manual gate runs (Gate 2/3's document counts
   legitimately move as `openspec/changes/multiple-doc-roots/` gains new SDD artifacts between phases —
   see the note under "Gate 2" above). This is expected and not a defect, but a future verify pass on
   this same repository should expect the exact counts to differ from this report's, and should
   recompute the formula fresh rather than compare against this report's constants (the same caution
   `proposal.md`'s Gate 2 wording already states: "the formula, not the constant, is the gate").

## Verdict

**PASS** — full 4-PR chain, all 70 tasks.

Zero CRITICAL findings, zero WARNING findings (all three carried-over warnings independently confirmed
closed). All 648 tests pass, build and typecheck are clean. Gate 7 — the highest-priority check for
this pass — is confirmed with certainty: `main` is a strict ancestor of `HEAD`, and `sync-index.ts`,
`sqlite-index-store.ts` (`SCHEMA_DDL`), `read-document.ts`, and `ports.ts` are all zero-diff across the
whole 4-PR chain; zero `string | string[]` unions exist anywhere in `src/`. The two headline
silent-data-loss guards were independently re-verified by running real code, not by reading prior
claims: Gate 2c's directory-prefix `exclude` match and Gate 4b's alias-vs-declared `ReadError.path`
(the latter re-falsified fresh in this pass, not merely re-read from the prior report). `scripts/
vector-reach.mjs` — flagged as untested by anyone but apply — was run end to end in this pass and
passes both gated criteria. All 33 scenarios across all four spec deltas (`configuration`, `indexing`,
`index-md`, `mcp-contract`) are COMPLIANT with a real, passing, independently-inspected covering test.
README.md and CLAUDE.md were checked against running code, not against the proposal's stated intent,
and match.

**This change is ready for `sdd-archive`.**
