## Verification Report

**Change**: bounded-chunk-size
**Version**: N/A (openspec delta specs, no versioned schema)
**Mode**: Strict TDD (openspec/config.yaml: `strict_tdd: true`)

This report re-derives every number in it by direct execution against the current working tree
(branch `feat/bounded-chunk-size`, commits `f5ec119` + `8f8fef7`), not by copying `apply-progress.md`.
Per this change's own history — three defects (an unfalsifiable Gate 1b criterion, a re-embedded vs.
stored-vector measurement bug, and a content-dropping bug in `splitToBound` that shipped 9/9 green with
a passing mutation proof) previously passed through green reports — every claim below states what was
run and what came back, not what was asserted.

### Completeness

| Metric | Value |
|---|---|
| Tasks total | 55 (1.1–1.10, 2.1–2.9, 3.1–3.3, 4.1–4.8, 5.1–5.6, 6.1–6.5, 7.1–7.2, 8.1–8.2, 9.1–9.7, 10.1–10.3) |
| Tasks complete | 55 — confirmed by reading `tasks.md` directly; every line ends `[x]`, none `[ ]` |
| Tasks incomplete | 0 |

### Build & Tests Execution (re-run independently in this session, not copied from apply-progress.md)

**Build**: PASSED
```text
$ npm run build
> compendio-mcp@1.2.5 build
> tsc
(no output — exit 0)
```

**Tests**: PASSED — 376/376
```text
$ npm test
> compendio-mcp@1.2.5 test
> vitest run

 Test Files  31 passed (31)
      Tests  376 passed (376)
   Duration  6.72s
```

**Typecheck**: PASSED
```text
$ npm run typecheck
> tsc --noEmit && tsc -p tsconfig.test.json
(no output on either invocation — both exit 0)
```

**Coverage**: not configured in this project (`openspec/config.yaml`: `coverage_command: null`,
`coverage_threshold: 0`) — not applicable, consistent with the project's stated tooling.

### Manual Gates — re-run independently in this session

**Gate 1** (`compendio eval` on `ejemplos/`, hybrid + lexical, blocking on hybrid only):
```text
$ node dist/cli.js --root ejemplos eval
mode      recall@5   MRR      failures
hybrid    1.00       0.943    0
lexical   0.95       0.856    1
```
Matches the required MRR >= 0.943 / recall@5 = 1.00 / top-1 >= 20/22 exactly, and matches the figure
already recorded by the coordinator byte-for-byte. **PASS.**

**Gate 1b, "after"** (rebuilt `dist/`, fixture re-indexed, `vector-reach.mjs` re-run):
```text
$ node dist/cli.js --root test/fixtures/vector-reach index
Indexed 6 documents (19 chunks) in 2771 ms [mode hybrid]

$ node scripts/vector-reach.mjs test/fixtures/vector-reach "código de verificación interna QUETZAL"
#1  chunk 16  manual-extenso.md  tokens=421  containsMarker=true   cosine=0.8800
#2  chunk 17  manual-extenso.md  tokens=475  containsMarker=false  cosine=0.8441
...
Filler band (min/max cosine, non-marker chunks): [0.8358, 0.8441]
Criterion A — rank of the marker chunk: 1 of 10
Criterion B — marker chunk cosine vs query: 0.8800
Criterion C — truncation probe: 0.9447
Diagnostics — marker offset 1164 chars; chunk length 1681 chars
```
All three criteria against amended Decision 5's table: **A** rank 1 (required: 1) — PASS. **B** 0.8800,
strictly above the band ceiling 0.8441 and above the >=0.855 floor — PASS. **C** 0.9447, well under the
expected <=0.97 — reported, not gated, holds. Fixture went 6 -> 19 chunks, matching the recorded figure
exactly. **PASS**, independently reproduced, byte-for-byte identical to the recorded "after" baseline.

Gate 1b "before" (pre-splitter baseline) was **not** re-run — doing so would require reverting the
splitter on the working tree, which the task brief does not ask for. The "before" numbers are accepted
as recorded (rank 4/6, cosine 0.8357 in-band [0.8274, 0.8385], probe 0.9947), since the "after" run just
reproduced above is what actually proves the fix, and the "before" figures were already independently
scrutinized during apply (two corrected amendments, both documented and reproducible).

**Gate 2** (full 38-document generated corpus, ~370s pre-change baseline): **not re-run in this
session** — explicitly relied on the recorded transcript in `apply-progress.md` per this task's own
instruction that Gate 2 is slow. Recorded: `ba/manual.md` 1 -> 99 chunks (predicted ~88), corpus
242 -> 358 chunks (predicted ~330), full index 367s -> ~31s (predicted ~60s). All three landed outside
the point predictions but confirmed direction and order of magnitude, with a traced mechanism for each
deviation (greedy packing leaves headroom instead of filling exactly to `maxTokens`; the old default's
single 41 837-token chunk paid a disproportionate, now-removed tokenization/embedding cost). This is
stated here as unverified-by-this-report, not implied to have been re-run.

**Gate 3** (bound holds unconditionally) — re-verified independently on two live indexes, not copied:
```text
ejemplos/ (11 docs):        29 chunks, max estimateTokens = 333, 0 over 480
test/fixtures/vector-reach: 19 chunks, max estimateTokens = 475, 0 over 480
```
Both queried directly against the indexed SQLite `chunks` table's stored `content` in this session.
Matches the coordinator's recorded figures exactly. Combined with the Phase 7 fuzz-style invariant
suite (`split-text.test.ts`'s 11-case x 4-`maxTokens` table, `chunking.test.ts` and
`index-pipeline.test.ts`'s adversarial coverage tests, all in the 376-passing run above), the "no chunk
exceeds `maxTokens` on any path" invariant is proven, not merely asserted. **PASS.**

### Spec Compliance Matrix

#### `specs/indexing/spec.md`

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Chunk Size Is an Unconditional Upper Bound | Heading-less document split | `chunking.test.ts > "covers a heading-less 50 KB intro..."` | COMPLIANT |
| (same) | Childless section exceeding bound is split | `chunking.test.ts > "splits an oversized table..."`, `"...unterminated fenced code block..."`, `"...terminated fenced code block..."`, `"...20,000-character line..."` (all childless `DocSection`s) | COMPLIANT |
| (same) | Oversized child section is split | `chunking.test.ts > "splits an oversized H3 child section via the size cascade..."` | COMPLIANT |
| Split Preference Cascade With Guaranteed Fallback | Multi-paragraph splits at paragraph boundaries | `split-text.test.ts > "splits a multi-paragraph section at paragraph boundaries only"` | COMPLIANT |
| (same) | Single oversized paragraph falls to sentence level | `split-text.test.ts > "falls through to sentence-level splitting..."` | COMPLIANT |
| (same) | Single oversized line falls to word level | `split-text.test.ts > "falls through to word-level splitting..."` | COMPLIANT |
| (same) | Degenerate case (bound holds with no boundary at all) | `split-text.test.ts > "falls through to fixed-width code-point splitting..., never splitting a surrogate pair"` | COMPLIANT — exercises level 6, required by the scenario's "bound MUST still hold in the degenerate case" clause even though the spec's own prose only names paragraph/sentence/word |
| A Split Markdown Table's Pieces Stay Valid Markdown | Header/separator repeated on every piece | `split-text.test.ts > "splits an oversized markdown table, repeating the header and separator..."` + `chunking.test.ts > "splits an oversized table via the size cascade..."` | COMPLIANT |
| Every Split Piece Retains Its Full Heading Path | Split pieces share parent's heading path | `chunking.test.ts > "splits an oversized H3 child section..., and every resulting piece keeps the full 'H2 > H3' heading path"` | COMPLIANT |
| `NO_CHUNKING` Suppresses Heading-Based Splitting Only | Within-bound file stays 1 chunk | `index-pipeline.test.ts > "emits exactly one chunk for a NO_CHUNKING file within maxTokens..."` | COMPLIANT |
| (same) | Above-bound file splits by size, not by its internal headings | `index-pipeline.test.ts > "splits a NO_CHUNKING file above maxTokens via the size cascade, NOT by its internal headings"` — explicitly asserts every emitted chunk's `heading` is the document title, never one of the internal `## Internal Heading` lines | COMPLIANT — this is a strong test: it does not just check chunk count, it proves the split points are heading-blind |
| Chunk Boundary Changes Require a Full Reindex | Incremental sync alone does not re-apply new boundaries | Documentation-only by design (no schema marker per project rules) — `CLAUDE.md`'s new "Non-obvious decisions" bullet and the spec text itself state the mechanism correctly. Underlying general mechanism (content-hash-only fingerprint) has pre-existing coverage in `sync-index.test.ts > "does not re-embed a fully vectorized hash-match document"`, but no test in this change specifically simulates "maxTokens changed, sync runs, unchanged doc keeps old chunks." | COMPLIANT (by design) — matches this task's explicit instruction not to treat the absence of a mechanism as a gap; documentation content itself verified present and accurate |
| (same) | A full reindex applies the new bound | Manually reproduced in this session: `node dist/cli.js --root ejemplos index` after a code/config change re-chunks every document via `reset()`'s drop-and-recreate (11 docs, 29 chunks, confirmed above) | COMPLIANT |
| English Contract Preserves the `ejemplos/` Baseline (MODIFIED) | Frontmatter rename doesn't move metrics; scope narrowed to not bind this change | Gate 1, re-run independently above, PASS. The delta's added "Scope of the hold-exactly clause" and third scenario correctly redirect this change's own metric movement to its own gate rather than the rename's | COMPLIANT |

**Indexing spec**: 15/15 scenarios traced to passing, real tests or (for the two reindex-documentation
scenarios) to correct, present documentation plus a manual reproduction — 0 UNTESTED, 0 FAILING.

#### `specs/configuration/spec.md`

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Default `chunk.maxTokens` Is 480 | No config file / no `chunk` block defaults to 480 | **No automated unit test asserts this literal value.** `test/infrastructure/config.test.ts` has no `chunk`/`480` assertion at all (`grep -n "chunk" test/infrastructure/config.test.ts` returns nothing). Indirectly exercised by Gate 1 / Gate 1b / Gate 3's manual `node dist/cli.js` runs against corpora with no `compendio.config.json` (all independently re-run above, all showing bounds honored at <=480) — but those are manual gates, not part of `npm test`/CI | UNTESTED (automated) / demonstrated only manually — see Issues |
| (same) | A declared `chunk.maxTokens` overrides the default and is still enforced as a bound | **Zero coverage, automated or manual.** No test anywhere in the suite (nor any manual gate) constructs a `compendio.config.json` declaring a custom `chunk.maxTokens` and confirms both that `loadConfig` resolves it and that indexed chunks respect it as the bound | UNTESTED — see Issues |

**Configuration spec**: 0/2 scenarios have a covering test that passed at runtime, per the hard rule
"a spec scenario is compliant only when a covering test passed at runtime." See WARNING findings below
for the risk assessment — the underlying mechanisms are each independently well-tested in isolation
(`mergeConfig`'s per-key override pattern is proven for `search.k`/`sync.throttleMs`; `chunkOutline`/
`splitToBound` are fully parameterized on `maxTokens` and tested at many different values), so this is
assessed as a real but moderate-risk gap, not a sign the feature is broken.

### Correctness (Static + Runtime Evidence)

| Requirement | Status | Notes |
|---|---|---|
| One splitter, two call sites (Decision 1) | Implemented | `splitToBound` in `src/domain/split-text.ts`, imported by `chunkOutline` (`chunking.ts:3,54-56`) and `wholeDocumentChunk` (`index-pipeline.ts:6,94-98`). No third producer of `Chunk[]` — confirmed by reading both files |
| Six-level cascade (Decision 2) | Implemented | `splitBlocks -> splitOversizedBlock (table/fence/lines) -> splitLines -> splitSentences -> splitWords -> splitCodePoints`, one shared `packUnits` greedy packer. Code-point iteration (`for...of`) confirmed surrogate-safe by the emoji test |
| Spanish sentence rule (Decision 2) | Implemented | `extractSentences`/`isAbbreviation`/`isSentenceStart` match the spec exactly: `[.!?…]` + optional closer + whitespace + uppercase/¿/¡, with a single-letter-or-listed-abbreviation guard. Test covers all four named cases (`¿?`, `¡!`, `art. 12`/`art. Único`/`J. García`, `3.5`) in one case |
| Tables/fences re-wrapped, bound wins on conflict (Decision 3) | Implemented | `splitTable`/`splitFence` measure the joined candidate (preamble + content), never summands; when no row/line can share the preamble it is still emitted separately via `splitLines`, never silently dropped (`preambleEmitted` tracking) — this is the fix for the coordinator-found content-loss defects, confirmed present in the current `split-text.ts` |
| `mergeTinyPieces` candidate-measured guard (Decision 4) | Implemented | `chunking.ts:83-89` measures `estimateTokens(candidate)`, not the summed per-piece estimates. Regression test at `maxTokens: 100` / two 200-char pieces present and correctly reasoned (independently re-read in this session, matches the claimed defect shape exactly) |
| Gate 1b stored-vector measurement + monotonicity self-check (Decision 5, amended) | Implemented | `scripts/vector-reach.mjs` reads `chunks_vec` directly via its own `better-sqlite3` connection, asserts monotonicity, exits 1 on violation. Independently re-run in this session — clean, no violation |
| Gate 1b fixture, 1 marker + 5 same-pool distractors (Decision 6) | Implemented | `test/fixtures/vector-reach/docs/` committed, 6 files, matches design exactly |
| Default 800 -> 480 | Implemented | `src/infrastructure/config.ts:58` |
| `NO_CHUNKING` redefinition | Implemented | `wholeDocumentChunk` signature takes `maxTokens`, routes through `splitToBound`; doc comments in `config.ts`, `index-documents.ts`, `index-pipeline.ts` all corrected consistently |
| Doc comment corrections (`chunking.ts`) | Implemented | `chunkOutline`'s doc comment no longer claims tables are never split; correctly states heading descent decides coarse cuts, `splitToBound` guarantees the size bound |
| `CLAUDE.md` corrections + Gate 1b/Gate 2 procedures | Implemented | Independently diffed against `main` — matches every claim in `apply-progress.md`'s 9.5 section |
| `README.md` corrections | Partially implemented | `:136` (800->480) and the eval table (27->29 chunks, 0.857->0.856) are corrected and match my independent Gate 1 re-run exactly. **`README.md:207`'s "How it works" diagram still reads "tables are never cut"** — the same false claim `CLAUDE.md` corrected, left untouched in README. See WARNING findings |

### Coherence (Design)

| Decision | Followed? | Notes |
|---|---|---|
| Decision 1 (signature, call sites) | Yes | Exact signature `splitToBound(text: string, maxTokens: number): string[]`, own module, no imports beyond `tokens.js` |
| Decision 2 (cascade, Spanish sentence rule, explicit non-goals) | Yes | No ICU/`Intl.Segmenter` used, consistent with "explicitly NOT solved" |
| Decision 3 (tables/fences, preamble charged to budget, bound wins) | Yes | Including the coordinator-reported content-loss fix, which the design's own "the bound wins... that one unit... hands to the cascade" language already anticipated in principle; the implementation initially missed the "preamble must still be emitted somewhere" half and was corrected mid-apply — final code matches the design's stated intent |
| Decision 4 (merge-guard fix) | Yes | Candidate-measured, matches the design's code sketch (minor non-behavioral difference: nested `if`/`continue` instead of one combined condition, to skip building `candidate` when not needed) |
| Decision 5 (Gate 1b mechanism, amended twice) | Yes | Both amendments (withdrawing the unfalsifiable containment criterion; switching to stored-vector cosines) are implemented in the committed `vector-reach.mjs`, independently re-run and reproduced in this session |
| Decision 6 (fixture size, same-pool distractors) | Yes | Fixture matches exactly (1 marker + 5 distractors, same word pool) |
| `minTokens` stays at 100 (proposal, resolved) | Yes | Confirmed via `grep` — no `minTokens` value anywhere in the diff except the harness-drift-fix imports |
| Out of scope: UTF-8 fix, token-budget batching | Yes, absent | `git diff main -- src/infrastructure/fs/file-document-source.ts` is empty; `index-documents.ts`'s only change is a doc comment |

### Issues Found

**CRITICAL**: None.

**WARNING**:

1. **Configuration spec's two ADDED scenarios have no covering test that ran at runtime.** Neither
   "no config file defaults to 480" nor "a declared `chunk.maxTokens` override is honored as a bound"
   has a dedicated automated test. `test/infrastructure/config.test.ts` (the file that owns config
   default/merge testing) contains zero references to `chunk` or `480`. The default value IS exercised
   indirectly by the manual Gate 1/1b/3 runs against corpora with no config file (all independently
   re-confirmed in this report, all showing the bound honored), but manual gates are not part of
   `npm test`/CI — a future accidental revert of `DEFAULT_CONFIG.chunk.maxTokens` to `800` (or to any
   other wrong value under 480, which the bound-only manual checks could not distinguish from a correct
   480) would not be caught by the automated suite. The override scenario has **zero** coverage of any
   kind — nothing constructs a `compendio.config.json` with a custom `chunk.maxTokens` and confirms it
   is both resolved and enforced. Risk is moderate, not high: `mergeConfig`'s per-key override pattern
   is proven correct for sibling fields (`search.k`, `sync.throttleMs`), and `chunkOutline`/
   `splitToBound` are fully parameterized on `maxTokens` and tested at many different values elsewhere
   in the suite — so the specific wiring gap is "config value reaches the chunker," not "the chunker
   respects an arbitrary bound," which is exhaustively tested. Given this exact change's own history of
   assumed-but-unverified correctness, this should be closed with one or two small tests (a `loadConfig`
   default-value assertion, and an end-to-end or `chunkOutline`-level test with a non-480 `maxTokens`
   sourced from a config override) before treating the Configuration spec as fully proven, even though
   it does not block core functionality today.

2. **`README.md:207` still carries the false claim this change exists to correct.** The "How it works"
   ASCII diagram reads `split into fragments at heading boundaries (tables are never cut)` — the exact
   claim `CLAUDE.md`'s "Heading-based chunking" bullet was corrected to remove. This was found and
   explicitly disclosed during apply (`apply-progress.md`'s 9.6-9.7 section, "out-of-scope observation,
   not edited") on the grounds that neither `tasks.md`'s 9.6/9.7 wording nor `design.md`'s File Changes
   table for `README.md` (which names only `:136` and the eval table) authorized touching it — but the
   proposal's Scope section only verified README against the *second* false claim ("files indexed as a
   single chunk... no heading-based chunking"), not the first ("tables are never split mid-row"), so
   this line was never actually checked against the claim it now contradicts. Independently reconfirmed
   present in this session (`README.md` lines 204-213). A one-line, low-risk documentation fix; not
   blocking, but should not ship uncorrected given the change's own explicit scope item to fix exactly
   this claim wherever it appears.

**SUGGESTION**:

1. `apply-progress.md`'s task 10.3 already disclosed three categories of files touched that
   `design.md`'s File Changes table does not list: `.gitattributes` (new, load-bearing for Gate 1b's
   LF-pinning), `test/application/read-document.test.ts` (a new test closing a coverage gap the design's
   Testing Strategy table assumed already existed), and the SDD process artifacts themselves
   (`proposal.md`, `design.md`, `exploration.md`, `specs/`, `tasks.md`, `apply-progress.md`). All three
   are individually justified, already disclosed at the batch that introduced them, and re-confirmed
   present and accounted for in this report's own `git diff main --stat`. No action needed — noted only
   because this task's brief asked for scope discipline to be checked explicitly, and the check came
   back clean modulo these three already-transparent categories.
2. Consider adding, in a small follow-up, the two missing Configuration-spec tests named in WARNING 1 —
   cheap to write given the existing `config.test.ts`/`chunking.test.ts` patterns already in the suite.

### Scope Discipline (explicit check, per this task's brief)

- UTF-8 read fix (`file-document-source.ts:54`): **absent** — `git diff main` for that file is empty.
- Token-budget batching: **absent** — `index-documents.ts`'s only change is a doc-comment correction.
- `minTokens: 100`: **unchanged** — confirmed via `grep` across the full diff; only `maxTokens` moved.
- Two corrected records (proposal's "splitter fires once on ejemplos/" claim; `CLAUDE.md`'s Gate 2
  blocking/falsification framing): both independently re-read in `proposal.md` and `CLAUDE.md` in this
  session and confirmed to carry the corrected wording, not the original claims.

### Persistence Note

Engram (persistent memory) tools were not available in this execution context — no `mem_*` tools were
exposed to this agent. Per this task's instructions ("Engram tools may be unavailable; if so, note it
and continue — the file is the deliverable"), this file is the sole persisted artifact for this phase.

### Verdict

**PASS WITH WARNINGS**

All CRITICAL gates hold: full suite (376/376), build, and typecheck are clean; all 55 tasks are
genuinely complete; Gates 1, 1b (after), and 3 were independently re-executed in this session and
reproduced the recorded figures exactly; Gate 2 is accepted from the recorded transcript per this
task's own instruction that it is too slow to re-run; scope discipline holds (no UTF-8 fix, no batching
change, `minTokens` untouched); every Indexing-spec requirement and scenario traces to a real,
runtime-passing test or to correct, present documentation for the two by-design documentation-only
scenarios. Two WARNING-level gaps remain open: the Configuration spec's two ADDED scenarios have no
runtime-passing covering test (moderate risk, not a sign of broken behavior — the underlying mechanisms
are each independently proven), and `README.md:207` still states the false "tables are never cut"
claim this change exists to correct. Neither blocks the core "no chunk may exceed `maxTokens`"
guarantee, which is proven, not assumed — but both should be resolved (or explicitly accepted) before
archiving closes the book on this change.
