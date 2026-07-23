# Verify Report: configurable-convention

**Date**: 2026-07-23
**Verifier**: sdd-verify (independent pass)
**Branch**: `feat/configurable-convention` (3 commits on `main`: `f7f2a4d`, `eadc0a3`, `4206bbe`)
**Verdict**: **PASS** — recommend archive.

## Summary

CRITICAL: 0. WARNING: 1. SUGGESTION: 2.

Six apply batches, two orchestrator post-batch fixes, and two further commits outside the
batch record (`eadc0a3`, `4206bbe`) all land cleanly. I re-ran the full gate from a clean
tree, read every changed production file against its spec requirement, and independently
reproduced every high-risk scenario against real command output. I did not find a fifth
defect.

## Command evidence (this session)

```
$ git status --short
(clean)

$ npm run typecheck
(exit 0, no output)

$ rm -rf dist *.tsbuildinfo && npm run build
(exit 0, no output)

$ npm test
 Test Files  21 passed (21)
      Tests  167 passed (167)
```

167/167 — up from apply-progress.md's final count of 159/159, because `eadc0a3` and
`4206bbe` added 8 tests after Batch 6 closed (2 in `test/server.test.ts`, 6 in the new
`test/cli-subprocess.test.ts`). Both commits are real, verified work — see Warnings.

## Scenario-by-scenario spec verification

### specs/search/spec.md (highest-scrutiny item 1)

- **Open `tipo` Filtering** — CONFIRMED. `search-documents.ts:85-86` trims and treats
  empty/whitespace as absent; no closed union anywhere (grep for `Tipo` in `src/` empty).
  Test: `index-and-search.test.ts:380-402`.
- **Config-Driven `estadosExcluidos`, NULL-aware** — CONFIRMED. SQL predicate at
  `sqlite-index-store.ts:328-334`: `(d.estado IS NULL OR d.estado NOT IN (...))`.
  `buildFilters` (`search-documents.ts:83-95`) only sets the deny-list key when
  `incluirNoVigentes !== true && estadosExcluidos.length > 0` — the no-op case is
  structural (key never set), not a runtime branch that could regress. Tests:
  `index-and-search.test.ts:404-448`, five scenarios.
- **Reproduced against the real CLI this session**:
  ```
  $ node dist/cli.js --root ejemplos search "plan de pruebas" --lexico > default.json
  $ node dist/cli.js --root ejemplos search "plan de pruebas" --lexico --todos > todos.json
  $ diff default.json todos.json
  (no output — byte-identical)
  $ grep -c "informes/plan-pruebas.md" default.json
  1
  ```
  `informes/plan-pruebas.md` (`estado: borrador`) is genuinely returned unfiltered — the
  no-op is real, not an absence of matching documents.
  ```
  $ node dist/cli.js --root test/fixtures/estricto search "alertas de inventario" --lexico
  -> especificacion-alertas, decision-cache-redis, guia-onboarding, contrato-api-pagos
     (plan-pruebas-alertas.md, estado: borrador, ABSENT)
  $ ... --todos
  -> same four PLUS plan-pruebas-alertas.md
  ```
  Deny-list is real and reversible on the same corpus.

### specs/indexing/spec.md (highest-scrutiny item 2)

- **`estricto` validates `tipo`/`estado` per field, independently** — CONFIRMED.
  `convencion.ts:99-116` (`crearPoliticaEstricta`): `tipo` checked against `cfg.tipos`
  only when declared; `estado` checked against `cfg.estados` only when declared —
  genuinely independent branches. `modulo` (`:106-109`) is always presence-only,
  regardless of the other two. Tests: `convencion.test.ts:138-148` (mixed declaration),
  `:172-181` (modulo presence-only even when both taxonomies satisfied).
- **Presence-only fallback when undeclared** — CONFIRMED, same file `:100-104`/`:111-115`.
  Tests: `convencion.test.ts:150-159`/`:161-170`.
- **Real-CLI round trip**: `--tipo notarealtype` against the estricto fixture returns
  `exit=0` with an empty result set (open string, no rejection).

### specs/configuration/spec.md (highest-scrutiny item 3)

- **`camposFrontmatter` per-key merge** — CONFIRMED. `config.ts:113-126`
  (`mergeConvencion`): `camposFrontmatter: { ...base..., ...override... }` — per-key, not
  whole-value-replace (contrast with `tipos`/`estados`/`estadosExcluidos` in the same
  function, correctly whole-value-replace). Test: `config.test.ts:66-80`.
- **Shared-source-key case** — CONFIRMED at the domain level, where resolution actually
  happens: `convencion.ts`'s `leerCampo` is called independently per field, no dedup
  machinery to fail. Test: `convencion.test.ts:221-232`.

### specs/index-md/spec.md (highest-scrutiny item 4)

- **Declared-order-then-alphabetical-by-`ruta` tie-break** — CONFIRMED.
  `convencion.ts:155-167` (`crearComparadorIndice`):
  `tipos.indexOf(a.tipo ?? "") - tipos.indexOf(b.tipo ?? "")`, falling through to
  `a.ruta.localeCompare(b.ruta)`. Unit test: `convencion.test.ts:247-252`. Integration
  test (comparator wired through `GenerateIndexMd`/`renderIndexMd`, not called directly):
  `generate-index-md.test.ts:118-136`.
- **Reproduced against the real CLI this session**:
  ```
  $ node dist/cli.js --root test/fixtures/estricto index-md
  - [funcional] especificacion-alertas.md
  - [adr] decision-cache-redis.md
  - [api] contrato-api-pagos.md
  - [qa] plan-pruebas-alertas.md
  - [guia] guia-onboarding.md
  ```
  Matches the declared `tipos: ["funcional","adr","api","qa","guia"]` exactly. Contrast
  with `docs_overview` on the same fixture (this session): came back alphabetical by
  `ruta` — correct, because `GetOverview` uses `listDocuments()` (unconditional
  `ORDER BY ruta`), and `mcp-contract/spec.md`'s overview-ordering requirement has no
  estricto-declared-order variant, unlike `index-md/spec.md`. Verified as two genuinely
  different, correctly-implemented requirements, not assumed identical.

### specs/mcp-contract/spec.md (highest-scrutiny item 5)

- **Tool description truthfulness** — CONFIRMED, re-checked specifically because the
  brief flagged this as "wrong until Batch 5 review." Current `server.ts:60-64`:
  "Si el proyecto declara convencion.estadosExcluidos ... si no lo declara, no se excluye
  ningun documento por su estado." Conditional and accurate, matches `search/spec.md:23`.
  Read from current committed source, not trusted from the batch narrative.
- **Open `tipo` across MCP + CLI** — CONFIRMED. `server.ts:67`: `z.string().optional()`.
  `cli.ts:177-179`: `parseTipo` pure trimmed passthrough, no `process.exit`. Tests:
  `server.test.ts:36-54` (incl. negative control that `query` is still required),
  `cli.test.ts` (exit spied, never called), `cli-subprocess.test.ts` (real subprocess).
- **Conditional frontmatter rendering in `read_doc`** — CONFIRMED at the application
  layer: `read-document.ts:96-106`, each field rendered only `if (meta.X !== undefined)`.
  Tests: `read-document.test.ts` (4 cases). See Suggestions for the one gap.
- **`search_docs` omits absent `estado`** — CONFIRMED. `search-documents.ts:76`: the key
  is genuinely absent, not `estado: undefined`. Test: `index-and-search.test.ts:449-459`
  asserts both `.estado === undefined` AND `"estado" in item === false` — the stronger,
  correct assertion.
- **`docs_overview` omits empty buckets/segments, alphabetical ordering** — CONFIRMED.
  `get-overview.ts:63-68` (`formatCounts` returns `null` on empty); ordering from
  `listDocuments()`'s `ORDER BY ruta`. Tests: `get-overview.test.ts`, 4 describe blocks.
  Reproduced against real output this session (`ejemplos overview`: no "Por tipo:" line;
  `estricto overview`: line present with all 5 tipos counted).

## Hexagonal integrity

```
$ grep -rn "^import" src/domain/*.ts | grep -viE "from \"\./|from \"\.\./domain"
src/domain/convencion.ts:1:import {
src/domain/ports.ts:1:import type {
```
Both hits are relative imports within `src/domain/` itself, not `infrastructure/`,
`better-sqlite3`, `transformers.js`, or `node:fs`. CONFIRMED, not assumed.

## Task completion (tasks.md)

All 40 items ticked. Spot-checked against code, not trusted at face value: A3 (closed via
B20) — verified `CompendioConfig["search"]` is genuinely `{ k: number }` only. B21 (closed
in Batch 3) — verified `grep -rn "TIPOS\|ESTADOS\|\bTipo\b\|\bEstado\b" src/` returns
nothing. E1/E2 — re-ran independently rather than trusting the batch's reported output.

## Test-quality check (tautology / coverage gaps)

- **No tautological tests found.** Spot-checked the ones most likely to be tautological:
  `server.test.ts`'s `SERVER_VERSION` test reads `package.json` independently via its own
  `readFileSync`/`JSON.parse`, not by calling `readPackageVersion()` — an independent
  re-derivation against the same ground-truth file, not `x === x`.
  `config.test.ts`'s `DEFAULT_CONFIG.convencion` test compares against a hand-written
  literal matching the spec's documented defaults, not a value copied from production.
- **Coverage gap (SUGGESTION, not blocking)**: `read_doc`'s conditional-rendering
  requirement is fully covered at the application layer but has no automated test through
  the actual registered MCP tool handler — `server.test.ts` only exercises `search_docs`.
  Batch 6's verification of this path was real but ad hoc and not committed to the suite.

## Warnings

### WARNING: SDD artifact trail is now stale relative to the shipped code

`tasks.md`'s E2 and `apply-progress.md`'s Batch 6 both record, as of batch-process close,
two "known issues, confirmed present, NOT fixed": `SERVER_VERSION` hardcoded `"0.1.0"` vs
`package.json`'s `"0.1.2"`, and "no subprocess-level CLI test exists." Both are **no
longer true** — commits `eadc0a3`/`4206bbe`, made after Batch 6 closed (same author, same
day, not run through the `sdd-apply` batch process), fix exactly these two issues. I
independently confirmed both fixes are real and correct. Not a code defect — a
documentation/audit-trail gap: `tasks.md`, `apply-progress.md`, and `state.yaml`'s
`phases.apply` note still describe the change as if these two issues remain open. **Not
blocking archive**, but the artifact trail should be reconciled (a short addendum note)
before or during archive so the historical record matches reality.

## Suggestions

1. **`read_doc` MCP-registration-level test** — see Test-quality section. Would close the
   one mcp-contract path currently proven only by uncommitted manual verification plus
   lower-layer unit tests.
2. **Cosmetic, already known, re-confirmed still true**: `formatFrontmatter` emits a bare
   `---\n---` for a document with no metadata — now the common case (8/11 `ejemplos/`
   docs). Not a spec violation; deliberately deferred.

## Known-accepted items re-confirmed still true and still scoped

- **Concurrent readers during `compendio index`** — non-goal intact:
  `reset()` (`sqlite-index-store.ts:119-130`) still runs drop-and-recreate inside a single
  `db.transaction`, matching spec text verbatim.
- **`formatFrontmatter`'s bare `---\n---`** — see Suggestion 2, unchanged, cosmetic.

## Result Contract

- **status**: done
- **executive_summary**: 0 CRITICAL, 1 WARNING (SDD artifact trail stale re: two
  post-batch fixes, not a code defect), 2 SUGGESTION — change passes verification,
  recommend archive.
- **artifacts**: `openspec/changes/configurable-convention/verify-report.md`,
  `openspec/changes/configurable-convention/state.yaml` (`phases.verify` updated)
- **next_recommended**: sdd-archive
- **risks**: None blocking. Non-blocking: reconcile `tasks.md`/`apply-progress.md`'s
  stale "known issues, not fixed" claims against the two post-batch commits before or
  during archive.
- **skill_resolution**: none — no skills-to-load block or registry found; proceeded with
  `sdd-verify`'s own SKILL.md and shared `sdd-phase-common.md` only.
