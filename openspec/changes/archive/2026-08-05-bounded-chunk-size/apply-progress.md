# Apply Progress: Bounded Chunk Size

## Batch: Work Unit 1 — Gate 1b Tooling (PR #1, base: `main`)

Scope: `scripts/generate-perf-corpus.mjs` (`--profile fixture`), the committed fixture corpus,
`scripts/vector-reach.mjs`, the Gate 1b "before" measurement, and the `CLAUDE.md` manual procedure.
**Zero production code touched** — no file under `src/` was modified. Confirmed by `git status`
below.

## Completed Tasks

- [x] 1.1 `scripts/generate-perf-corpus.mjs`: added `--profile fixture`
- [x] 1.2 `test/fixtures/vector-reach/docs/**`: generated and left committed to the working tree
- [x] 1.3 Created `scripts/vector-reach.mjs`
- [x] 1.4 `vector-reach.mjs` prints per-rank chunk id/path/heading/tokens/marker-presence, then the
  marker chunk's own cosine
- [x] 1.5 Ran the Gate 1b "before" manual measurement — **see Finding below, result does not match
  the expected outcome**
- [x] 1.6 `CLAUDE.md`: added the Gate 1b manual procedure beside the progress smoke test
- [x] 1.7 `npm test` + `npm run typecheck` — both green
- [x] 1.8 Extended `scripts/vector-reach.mjs` per amended Decision 5: per-rank cosine for every
  chunk, the filler band (min/max across non-marker chunks), the truncation probe, and the two
  diagnostics (marker offset inside its chunk, chunk character length)
- [x] 1.9 Re-ran the Gate 1b "before" measurement with the extended script and recorded the full
  baseline below — **see "Batch: Tasks 1.8–1.9" section** — **superseded by 1.10 (re-embedded, not
  stored, vectors)**
- [x] 1.10 Fixed `vector-reach.mjs` to read cosines from stored `chunks_vec` vectors, added the
  monotonicity self-check (proven able to fail, then reverted), and re-captured the authoritative
  "before" baseline — **see "Batch: Task 1.10" section**

Standard workflow (not Strict TDD): Work Unit 1 is scripts + fixture data, no production logic, so
there is no RED/GREEN cycle. Per the orchestrator's brief, no TDD Cycle Evidence table applies to
this batch.

## Files Changed

| File | Action | What Was Done |
|---|---|---|
| `scripts/generate-perf-corpus.mjs` | Modified | Added `--profile fixture` (and `--profile default`, the prior unnamed behavior, now explicit); wrapped the existing generation logic in `generateDefaultProfile()`, added `generateFixtureProfile()`. No change to any default-profile output — same seed, same functions, same file contents (verified by re-running the default profile; see Verification below). |
| `test/fixtures/vector-reach/docs/manual-extenso.md` | Created | ~12 000-char heading-less document, `QUETZAL-7731` marker at char 6 068 |
| `test/fixtures/vector-reach/docs/distractor-{01..05}.md` | Created | 5 short heading-less distractor documents (3 000–3 800 chars each), no marker |
| `scripts/vector-reach.mjs` | Created | Gate 1b measurement script (Decision 5) — imports `dist/domain/tokens.js`, `dist/infrastructure/embeddings/transformers-embeddings.js`, `dist/infrastructure/sqlite/sqlite-index-store.js`; calls `IndexStore.searchVector` directly, FTS5 never consulted |
| `CLAUDE.md` | Modified | Added the Gate 1b manual procedure (commands, what-to-expect, and the measured caveat below) beside the existing progress-reporting smoke test |

No `src/` file was touched. `git status --porcelain` at the end of this batch:

```
 M CLAUDE.md
 M scripts/generate-perf-corpus.mjs
?? scripts/vector-reach.mjs
?? test/fixtures/vector-reach/
```

(`openspec/changes/bounded-chunk-size/{design.md,tasks.md,specs/}` also show untracked — those are
prior-phase SDD artifacts, not part of this batch, and were already present before this session
started.)

## Evidence

### `--profile fixture` dry run (scratchpad, before committing)

```
$ node scripts/generate-perf-corpus.mjs <scratch-dir> --profile fixture
fixture generated at <scratch-dir>\docs
  1 marker document (~12,000 chars) + 5 distractor documents, seed 1592594996
  Gate 1b marker: QUETZAL-7731 (inside manual-extenso.md)
```

File sizes: `distractor-01.md` 3031 B, `distractor-02.md` 3232 B, `distractor-03.md` 3428 B,
`distractor-04.md` 3635 B, `distractor-05.md` 3836 B, `manual-extenso.md` 12121 B. Total 29 283 B
(≈28.6 KB — matches design's "≈30 KB" estimate). Marker position verified programmatically: char
6068 of 12000 (design target: "~char 6,000") — content around it:

```
...igo de verificación interna para pruebas de recuperación es QUETZAL-7731: un identificador
deliberadamente ajeno al voca...
```

### Committed fixture generation (real run, into the working tree)

```
$ node scripts/generate-perf-corpus.mjs test/fixtures/vector-reach --profile fixture
fixture generated at test\fixtures\vector-reach\docs
  1 marker document (~12,000 chars) + 5 distractor documents, seed 1592594996
  Gate 1b marker: QUETZAL-7731 (inside manual-extenso.md)
```

```
$ ls -la test/fixtures/vector-reach/docs
distractor-01.md   3031
distractor-02.md   3232
distractor-03.md   3428
distractor-04.md   3635
distractor-05.md   3836
manual-extenso.md  12121
```

### Build

```
$ npm run build
> compendio-mcp@1.2.5 build
> tsc
```

(no output — `tsc` is silent on success; exit code 0)

### Indexing the fixture (pre-splitter build)

```
$ node dist/cli.js --root test/fixtures/vector-reach index
Discovering documents
Indexing 6 documents
[1/6] distractor-01.md
[2/6] distractor-02.md
[3/6] distractor-03.md
[4/6] distractor-04.md
[5/6] distractor-05.md
[6/6] manual-extenso.md
Embedding 6 chunks in 1 batches
downloading model: 112.9/129.1 MB
downloading model: 119.4/129.1 MB
downloading model: 125.9/129.1 MB
[1/1] embedding batch
Indexed 6 documents (6 chunks) in 4414 ms [mode hybrid]
```

Confirms the pre-splitter pathology this fixture is built to reproduce: 6 documents → 6 chunks (each
heading-less document is exactly one chunk, since `chunkOutline` has nothing to split on).

### Gate 1b "before" measurement — `vector-reach.mjs`

```
$ node scripts/vector-reach.mjs test/fixtures/vector-reach "código de verificación interna QUETZAL"
Model: Xenova/multilingual-e5-small
Loading embeddings provider (may download on first run)...

Vector-only top-10 for query: "código de verificación interna QUETZAL"

#1	chunk 4	distractor-04.md	heading=""	tokens=900	containsMarker=false
#2	chunk 2	distractor-02.md	heading=""	tokens=800	containsMarker=false
#3	chunk 1	distractor-01.md	heading=""	tokens=750	containsMarker=false
#4	chunk 6	manual-extenso.md	heading=""	tokens=3000	containsMarker=true
#5	chunk 3	distractor-03.md	heading=""	tokens=850	containsMarker=false
#6	chunk 5	distractor-05.md	heading=""	tokens=950	containsMarker=false

RESULT: a chunk containing QUETZAL-7731 IS in the vector-only top-10.

Marker chunk 6 (manual-extenso.md) cosine against query: 0.8350
```

## FINDING — Gate 1b "before" measurement contradicts the expected outcome

**Expected** (per task 1.5 / Decision 5): no chunk containing `QUETZAL-7731` appears in the
vector-only top-10 on the pre-splitter build.

**Measured**: the marker chunk (`manual-extenso.md`, chunk 6) DOES appear — at rank 4 of 6 — with the
literal `vector-reach.mjs` output pasted above, unedited.

**Root cause, investigated (not assumed)**: this fixture's corpus has exactly 6 documents and, on the
pre-splitter build, exactly 6 chunks (confirmed by the `index` output: "Indexed 6 documents (6
chunks)"). `searchVector(embedding, {}, 10)` requests up to 10 results but a corpus with only 6 total
chunks can never exclude any of them from a "top-10" window — every chunk trivially satisfies
"appears in the top-10" regardless of relevance. The literal pass criterion in task 1.5 ("no chunk
appears in the top-10") is unfalsifiable at this corpus size: it could never have failed to hold
unless `searchVector` returned fewer than 6 results, which is not what "top-10 exclusion" is meant to
test.

I additionally ran a throwaway diagnostic (not committed, not part of any deliverable — a temporary
script deleted after use) that embeds every one of the 6 chunks against the query and prints its raw
cosine, to check whether the *rank* signal at least showed a meaningful gap even though top-10
membership couldn't exclude it:

```
distractor-01.md	chunk 1	containsMarker=false	cosine=0.8360
distractor-02.md	chunk 2	containsMarker=false	cosine=0.8386
distractor-03.md	chunk 3	containsMarker=false	cosine=0.8367
distractor-04.md	chunk 4	containsMarker=false	cosine=0.8407
distractor-05.md	chunk 5	containsMarker=false	cosine=0.8255
manual-extenso.md	chunk 6	containsMarker=true	cosine=0.8350
```

All 6 cosines sit inside a 0.0152-wide band (0.8255–0.8407). The marker chunk's cosine (0.8350) is
in the middle of that band, not distinctly separated from unrelated distractor content generated from
the same neutral-vocabulary word pool.

**Framing corrected (superseded by design.md Decision 5, amended):** the paragraph above originally
attributed this to mean-pooling dilution across the whole chunk. That is not what `design.md`'s
evidence shows. The exploration measured first-384-words cosine **1.0000** and first-2 000-words
cosine **1.0000**, both against the full-document vector (`exploration.md:74–76`) — two different
inputs cannot produce an *identical* vector unless the model consumed identical tokens for both. This
is **hard truncation** at e5-small's ~512-token window, not dilution: the marker sentence, sitting at
char 6 068 of a 12 000-char document, contributes exactly **zero** to the pre-split chunk's stored
vector — not merely a small share of a pooled average. The marker chunk's cosine landing mid-band is
the expected consequence of a vector that never saw the marker at all, indistinguishable from a
distractor built from the same word pool.

**Why this matters for the change's premise**: Decision 6 sizes the Gate 1b fixture at 1 marker
document + 5 distractor documents specifically so it stays "cheap enough to re-run on every future
chunking change" (seconds, not the ~370 s Gate 2 costs). That reasoning is sound on cost, but the
measurement above shows the *fixture size* itself — not the underlying defect — is what determines
whether "top-10 exclusion" can be observed at all: with only 6 total chunks, the criterion is
structurally unfalsifiable, independent of whether the real defect (a diluted, section-blind vector
for an oversized document) is present or absent. Whether Decision 6's small fixture can still serve
as a valid Gate 1b measurement — via rank-delta rather than raw top-10 membership, via more/more
heterogeneous distractor documents so total corpus size safely exceeds 10, or via some other
criterion — is a design question, not an implementation one. I did not unilaterally redesign the
fixture (e.g., by inflating the distractor count/structure) because that changes an approved design
decision; flagging it here per the orchestrator's explicit instruction that this exact scenario is
"a finding, not a failure to hide."

**Recommendation before Work Unit 2 starts**: re-examine Decision 6 — either (a) size the fixture so
total pre-splitter chunk count safely exceeds the top-K window (e.g., distractor documents that
themselves carry headings and split into several chunks each), or (b) make the Gate 1b pass/fail
criterion rank-based rather than top-10-membership-based, since task 9.3's "after" gate ("the
`QUETZAL-7731` chunk must now rank 1") already uses rank as its real criterion — the "before" gate's
wording should match it. This does not block PR #1 (the tooling itself works exactly as designed: it
does isolate the vector leg, and it does print the requested per-rank data). It affects only whether
the specific "before"/"after" contrast task 9.3 relies on will be a meaningful comparison.

## Full Suite / Typecheck (PR #1 gate)

```
$ npm test
> compendio-mcp@1.2.5 test
> vitest run

 Test Files  29 passed (29)
      Tests  308 passed (308)
   Start at  13:39:09
   Duration  9.10s (transform 4.15s, setup 0ms, import 11.82s, tests 12.00s, environment 6ms)
```

```
$ npm run typecheck
> compendio-mcp@1.2.5 typecheck
> tsc --noEmit && tsc -p tsconfig.test.json
```

(no output on either `tsc` invocation — both exit 0)

Both were already green before this batch (no `src/` change to affect them) and remained green after.

## Deviations from Design

- **Distractor document structure not specified by Decision 6** (it only says "5 short distractor
  documents"). I generated them heading-less, reusing the existing `headinglessDocument()` function
  (same as the marker document, minus the marker), each one chunk pre-splitter. This choice is what
  produced the "only 6 total chunks" condition behind the Finding above — a different structural
  choice (e.g., distractors with internal `##` headings, each splitting into several chunks even
  pre-splitter) might have produced a corpus safely over the top-10 window. Documented as a deviation
  because it is the load-bearing detail behind the Finding, not because it deviates from anything
  Decision 6 stated explicitly.
- New script output strings (`generateFixtureProfile`'s console output, all of `vector-reach.mjs`'s
  output) are in English per this batch's language contract, even though the pre-existing
  `generateDefaultProfile` output (untouched, carried over verbatim) is in Spanish. This is an
  intentional inconsistency within the same file: the existing Spanish strings were out of scope to
  translate, but new output is English per instruction.

## Issues Found

See FINDING above — the Gate 1b "before" measurement's literal pass criterion is unfalsifiable at
the fixture's current size, and even the raw cosine landscape shows no meaningful separation between
the marker chunk and the distractor cluster. No other issues found; the mechanism itself (real
`TransformersEmbeddings`, `SqliteIndexStore.searchVector`, no FTS5 consulted) works exactly as
Decision 5 specifies.

## Batch: Tasks 1.8–1.9 — Extended `vector-reach.mjs` + Final Gate 1b "Before" Baseline

Scope: extend `scripts/vector-reach.mjs` to print everything amended Decision 5 requires, then
re-run the Gate 1b "before" measurement on the unchanged pre-splitter build and record the full
baseline. **Zero production code touched** — still no file under `src/` modified. This batch does
not start Work Unit 2.

### What changed in `scripts/vector-reach.mjs`

The 1.1–1.7 version printed only the marker chunk's own cosine (a "corroboration," not a criterion)
and a top-10-membership check that Decision 5 has since withdrawn as unfalsifiable. Extended per the
amended Decision 5 to print, and nothing more than, its eight specified outputs:

1. Per rank (1..10): chunk id, path, heading, `estimateTokens`, `containsMarker`, and that chunk's
   own cosine against the query (previously only the marker row had a cosine — now every row does).
2. The filler band: min/max cosine across the ranked chunks that do NOT contain the marker.
3. Criterion A: the marker chunk's rank, located via a full scan (`findMarkerChunk`, unchanged),
   independent of whether it lands inside the printed top-10 window.
4. Criterion B: the marker chunk's own cosine against the query.
5. Criterion C, the truncation probe: `dot(embed("passage: " + first 384 words of the marker
   DOCUMENT), embed("passage: " + marker CHUNK content))`. The document text is read from disk
   (`loadConfig(root).docsDir` + `markerChunk.path`), not taken from the indexed chunk, so the probe
   stays meaningful after the splitter lands (task 9.3), when chunk content will be a fragment of the
   document rather than the whole thing.
6. Two diagnostics: the marker string's (`QUETZAL-7731`) character offset inside its chunk, and that
   chunk's character length.

### Finding — batching changes the reported cosine; fixed by embedding one chunk at a time

The first working version of the extension computed all 6 ranked chunks' passage vectors in **one**
batched `embeddings.embed([...6 texts...])` call, for efficiency. That produced:

```
#1  chunk 4  distractor-04.md   cosine=0.8385
#2  chunk 2  distractor-02.md   cosine=0.8384
#3  chunk 1  distractor-01.md   cosine=0.8369
#4  chunk 6  manual-extenso.md  cosine=0.8357   containsMarker=true
#5  chunk 3  distractor-03.md   cosine=0.8347
#6  chunk 5  distractor-05.md   cosine=0.8274
Filler band: [0.8274, 0.8385]
```

Rank (Criterion A) still read **4 of 6** — unchanged, because rank comes from `store.searchVector`
against the vectors already stored at index time, not from this script's display-only re-embedding.
But the marker's own cosine (0.8357) and the filler band ([0.8274, 0.8385]) both **disagreed** with
the previously recorded baseline (marker 0.8350, band [0.8255, 0.8407]) by up to 0.0022 — a real,
reproducible discrepancy, not noise (confirmed stable across repeated runs of the batched version).

Per the evidence-discipline instruction to report rather than quietly replace a discrepant number, I
investigated instead of accepting either figure. A throwaway scratch script (run outside the repo, in
the session scratchpad, not committed — same category as the deleted diagnostic this batch exists to
retire, so it stays disposable and out of the deliverable) embedded the same 6 chunks **one at a
time** (6 separate single-item `embed()` calls) against the same query:

```
distractor-01.md  chunk 1  cosine=0.8360
distractor-02.md  chunk 2  cosine=0.8386
distractor-03.md  chunk 3  cosine=0.8367
distractor-04.md  chunk 4  cosine=0.8407
distractor-05.md  chunk 5  cosine=0.8255
manual-extenso.md chunk 6  cosine=0.8350
```

Byte-identical to the previously recorded baseline, and stable across two consecutive passes in the
same process. **Root cause**: a batched tokenizer pads every sequence to the batch's longest member
(`exploration.md`'s "Batch padding is real" section documents the timing cost of this; this is its
numerical-accuracy counterpart), and that measurably perturbs the resulting embedding — a
floating-point effect of batch composition, not of the underlying index or content. Since Decision 6
requires the committed script to reproduce the recorded band, and a batch-composition-dependent
number is not reproducible (it would vary with corpus size, unrelated future runs, or how many chunks
happen to share a batch), the committed script was changed to embed each ranked chunk with its own
single-item `embed()` call. Re-running after that fix reproduced the baseline exactly (see below) —
this is the version now committed to `scripts/vector-reach.mjs`.

### Build

```
$ npm run build
> compendio-mcp@1.2.5 build
> tsc
```

(no output — exit 0; no `src/` change, so this recompiles the same `dist/` as PR #1)

### Gate 1b "before" measurement — final, unbatched, extended script (run twice for determinism)

```
$ node scripts/vector-reach.mjs test/fixtures/vector-reach "código de verificación interna QUETZAL"
Model: Xenova/multilingual-e5-small
Loading embeddings provider (may download on first run)...

Vector-only top-10 for query: "código de verificación interna QUETZAL"

#1	chunk 4	distractor-04.md	heading=""	tokens=900	containsMarker=false	cosine=0.8407
#2	chunk 2	distractor-02.md	heading=""	tokens=800	containsMarker=false	cosine=0.8386
#3	chunk 1	distractor-01.md	heading=""	tokens=750	containsMarker=false	cosine=0.8360
#4	chunk 6	manual-extenso.md	heading=""	tokens=3000	containsMarker=true	cosine=0.8350
#5	chunk 3	distractor-03.md	heading=""	tokens=850	containsMarker=false	cosine=0.8367
#6	chunk 5	distractor-05.md	heading=""	tokens=950	containsMarker=false	cosine=0.8255

Filler band (min/max cosine, non-marker chunks): [0.8255, 0.8407]

Marker chunk 6 (manual-extenso.md)
Criterion A — rank of the marker chunk in the vector-only ranking: 4 of 6
Criterion B — marker chunk cosine vs query: 0.8350
Criterion C — truncation probe (first 384 words of the document vs the marker chunk): 0.9949
Diagnostics — marker string offset inside its chunk: 6068 chars; chunk length: 12000 chars
```

Second run, same command, same process invocation, independent — identical output byte-for-byte
(all six per-rank cosines, the band, and Criteria A/B/C reproduced exactly):

```
$ node scripts/vector-reach.mjs test/fixtures/vector-reach "código de verificación interna QUETZAL"
Model: Xenova/multilingual-e5-small
Loading embeddings provider (may download on first run)...

Vector-only top-10 for query: "código de verificación interna QUETZAL"

#1	chunk 4	distractor-04.md	heading=""	tokens=900	containsMarker=false	cosine=0.8407
#2	chunk 2	distractor-02.md	heading=""	tokens=800	containsMarker=false	cosine=0.8386
#3	chunk 1	distractor-01.md	heading=""	tokens=750	containsMarker=false	cosine=0.8360
#4	chunk 6	manual-extenso.md	heading=""	tokens=3000	containsMarker=true	cosine=0.8350
#5	chunk 3	distractor-03.md	heading=""	tokens=850	containsMarker=false	cosine=0.8367
#6	chunk 5	distractor-05.md	heading=""	tokens=950	containsMarker=false	cosine=0.8255

Filler band (min/max cosine, non-marker chunks): [0.8255, 0.8407]

Marker chunk 6 (manual-extenso.md)
Criterion A — rank of the marker chunk in the vector-only ranking: 4 of 6
Criterion B — marker chunk cosine vs query: 0.8350
Criterion C — truncation probe (first 384 words of the document vs the marker chunk): 0.9949
Diagnostics — marker string offset inside its chunk: 6068 chars; chunk length: 12000 chars
```

### Baseline recorded (Gate 1b "before", final — supersedes the 1.5 raw-cosine table)

| # | Criterion | Value | Reads against amended Decision 5's table |
|---|---|---|---|
| A | Rank of marker chunk (vector-only, of 6 total) | **4 of 6** | Expected "not 1" — **holds**. Reproduces the 1.5 finding exactly (unchanged: rank is a property of the stored index, untouched by this batch) |
| B | Marker chunk cosine vs query | **0.8350** | Expected "inside the filler band" — **holds**: 0.8350 ∈ [0.8255, 0.8407] |
| — | Filler band (min/max, non-marker chunks) | **[0.8255, 0.8407]** | Reproduces the deleted throwaway script's figure exactly — this is now the number a committed script produces, not a discarded diagnostic's |
| C | Truncation probe (first 384 words vs marker chunk) | **0.9949** | Required "≥ 0.99 or the gate is void" — **holds**, comfortably. Not identical to the exploration's 1.0000 (that measurement used the private 167 KB `MANUAL.md`; this fixture's document is 12 KB, so "first 384 words" is a much larger share of it, and the truncation-probe denominator here is the indexed chunk's re-embedded vector rather than a second raw-text embedding of the same file — a different comparison than the exploration's, expected to be close to but not bound to hit 1.0000). The fixture is validated: it is not too small to exceed the model's absorption window |
| — | Marker offset inside chunk / chunk length | **6068 / 12000 chars** | Diagnostic only, not gated. Matches the generator's own reported marker position (`apply-progress.md`'s 1.1–1.7 section: "char 6068 of 12000") |

**No discrepancy against the previously recorded rank/cosine, once the batching artifact above was
fixed.** Rank held at 4 of 6 throughout (unaffected by the display-cosine batching bug, since rank
comes from the stored index, not this script's re-embedding). The marker cosine and filler band
matched the previously recorded 0.8350 / [0.8255, 0.8407] exactly once the script stopped batching
its display embed calls — the intermediate batched-call numbers (0.8357 / [0.8274, 0.8385]) were a
measurement artifact of the WIP script, not a property of the index, and are not part of the
recorded baseline.

### Full Suite / Typecheck (re-confirmed after 1.8–1.9)

```
$ npm test
> compendio-mcp@1.2.5 test
> vitest run

 RUN  v4.1.10 C:/Users/Raul/Workspace/compendio-mcp

 Test Files  29 passed (29)
      Tests  308 passed (308)
   Start at  13:55:42
   Duration  9.21s (transform 3.54s, setup 0ms, import 11.48s, tests 12.64s, environment 6ms)
```

```
$ npm run typecheck
> compendio-mcp@1.2.5 typecheck
> tsc --noEmit && tsc -p tsconfig.test.json
```

(no output on either `tsc` invocation — both exit 0)

`git status --porcelain` confirms no `src/` file was touched by this batch either:

```
 M CLAUDE.md
 M scripts/generate-perf-corpus.mjs
?? openspec/changes/bounded-chunk-size/apply-progress.md
?? openspec/changes/bounded-chunk-size/design.md
?? openspec/changes/bounded-chunk-size/specs/
?? openspec/changes/bounded-chunk-size/tasks.md
?? scripts/vector-reach.mjs
?? test/fixtures/vector-reach/
```

### Deviations from Design (this batch)

- The script embeds each ranked chunk's passage vector with its own `embeddings.embed([text])` call
  rather than one batched call across all ranked chunks. Not stated explicitly in Decision 5's
  8-step list, but required by Decision 6's "a later edit ... must not be able to silently retune a
  blocking gate" principle applied to the measurement script itself: a batch-composition-dependent
  number is not a reproducible baseline. Documented above as a Finding, not silently fixed.
- "The marker document" (Criterion C's first operand) is read from disk via `loadConfig(root).docsDir`
  joined with the marker chunk's `path`, rather than reused from the indexed chunk's content. Pre-split
  the two are identical (the whole document is one chunk), so this made no difference to today's
  number, but it is what keeps the probe meaningful after the splitter lands in Work Unit 2, when the
  chunk will be a fragment and the document will not be.

### Issues Found (this batch)

None blocking. See the batching Finding above — investigated, root-caused, and fixed in the committed
script before recording the baseline; not left as an open discrepancy.

## Batch: Task 1.10 — Fix `vector-reach.mjs` to Read Stored Vectors; Re-Capture Baseline

Scope: one task. Fix `scripts/vector-reach.mjs` so its displayed cosines come from the vectors
actually **stored** in `chunks_vec` (the same population `store.searchVector` ranks), instead of a
re-embedding — then re-run the Gate 1b "before" measurement and record the superseding baseline.
**Zero production code touched** — no file under `src/` was modified (confirmed by `git status`
below). Work Unit 2 was NOT started.

### The defect (found and diagnosed before this batch, by the orchestrator)

The 1.8–1.9 script embedded each ranked chunk one at a time (`embeddings.embed([text])` per chunk)
to *display* its cosine, deliberately choosing that over a single batched call because batching had
been shown to shift cosines by up to ~0.002 (documented in the "Batch: Tasks 1.8–1.9" section above).
That fix solved reproducibility but broke correctness in a different way: the *rank* printed next to
each cosine comes from `store.searchVector`, which ranks the vectors **stored** in `chunks_vec` —
written by `IndexDocuments` in one batch ("Embedding 6 chunks in 1 batches"). Re-embedding one chunk
at a time (no padding) measures a *different* population from the batch-padded one actually stored
and ranked. The symptom was directly visible in the 1.8–1.9 output: rank 5 (`distractor-03.md`,
cosine 0.8367) printed a **higher** cosine than ranks 3 and 4 (0.8360, 0.8350) — impossible if rank
and cosine come from the same vectors, since normalized vectors give `‖a−b‖² = 2 − 2·a·b`, so
`vec0`'s ascending-L2 order *is* descending-cosine order, exactly (`CLAUDE.md`'s stated invariant).
Nothing in the 1.8–1.9 script asserted this, so the inversion shipped silently into the recorded
baseline.

### What changed in `scripts/vector-reach.mjs`

1. Added `readStoredVectors(dbPath)`: opens its own `better-sqlite3` connection to the same database
   file `SqliteIndexStore` already opens (does not widen `IndexStore` — no new port method), calls
   `sqliteVec.load(db)` (mirrors `SqliteIndexStore`'s own constructor,
   `src/infrastructure/sqlite/sqlite-index-store.ts:84-92`), runs
   `SELECT chunk_id, embedding FROM chunks_vec`, and decodes each row's FLOAT32 blob
   (`new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)`), copying it into a fresh
   `Float32Array.from(view)` rather than retaining a view over the row's buffer (that buffer is
   reused/reclaimed as `better-sqlite3` iterates to the next row).
2. Replaced every per-rank re-embedding call and the marker chunk's re-embedding with a lookup into
   this stored-vector map. The truncation probe (Criterion C) now compares the marker chunk's
   **stored** vector against a fresh embedding of the first 384 words of the marker document, read
   from disk — unchanged on the "fresh embedding" side, changed on the "marker" side.
3. Replaced the raw `dot()` helper with `cosineSimilarity(a, b)`, which normalizes both vectors
   defensively (divides by `‖a‖·‖b‖`) instead of assuming they already are unit vectors — so the
   `‖a−b‖² = 2 − 2·a·b` identity the monotonicity check depends on stays correct even if a future
   embeddings provider stops normalizing.
4. Added `findMonotonicityViolations(cosines)`: scans the per-rank cosines (in rank order, skipping
   `null` for chunks lacking a stored vector) and returns every point where a later rank's cosine is
   strictly greater than an earlier rank's. After printing the per-rank table, the script calls this
   and, if any violation is found, prints a clearly-marked, multi-line `!`-bordered error naming the
   offending ranks/cosines and exits with code 1 — a silent violation is exactly what hid the
   original defect, so this must not be optional or "read by eye."
5. Kept the filler band (min/max across non-marker chunks) and both diagnostics unchanged in shape,
   now fed by stored-vector cosines.

### Build

```
$ npm run build
> compendio-mcp@1.2.5 build
> tsc
```

(no output — `tsc` is silent on success; exit code 0. No `src/` change, so this recompiles the same
`dist/` as the prior batches.)

### Gate 1b "before" measurement — stored-vector version (run twice for determinism)

```
$ node scripts/vector-reach.mjs test/fixtures/vector-reach "código de verificación interna QUETZAL"
Model: Xenova/multilingual-e5-small
Loading embeddings provider (may download on first run)...

Vector-only top-10 for query: "código de verificación interna QUETZAL"

#1	chunk 4	distractor-04.md	heading=""	tokens=900	containsMarker=false	cosine=0.8385
#2	chunk 2	distractor-02.md	heading=""	tokens=800	containsMarker=false	cosine=0.8384
#3	chunk 1	distractor-01.md	heading=""	tokens=750	containsMarker=false	cosine=0.8369
#4	chunk 6	manual-extenso.md	heading=""	tokens=3000	containsMarker=true	cosine=0.8357
#5	chunk 3	distractor-03.md	heading=""	tokens=850	containsMarker=false	cosine=0.8347
#6	chunk 5	distractor-05.md	heading=""	tokens=950	containsMarker=false	cosine=0.8274

Filler band (min/max cosine, non-marker chunks): [0.8274, 0.8385]

Marker chunk 6 (manual-extenso.md)
Criterion A — rank of the marker chunk in the vector-only ranking: 4 of 6
Criterion B — marker chunk cosine vs query: 0.8357
Criterion C — truncation probe (first 384 words of the document vs the marker chunk): 0.9947
Diagnostics — marker string offset inside its chunk: 6068 chars; chunk length: 12000 chars
```

Second run, same command, independent process — byte-identical output (all six per-rank cosines,
the band, and Criteria A/B/C reproduced exactly):

```
$ node scripts/vector-reach.mjs test/fixtures/vector-reach "código de verificación interna QUETZAL"
Model: Xenova/multilingual-e5-small
Loading embeddings provider (may download on first run)...

Vector-only top-10 for query: "código de verificación interna QUETZAL"

#1	chunk 4	distractor-04.md	heading=""	tokens=900	containsMarker=false	cosine=0.8385
#2	chunk 2	distractor-02.md	heading=""	tokens=800	containsMarker=false	cosine=0.8384
#3	chunk 1	distractor-01.md	heading=""	tokens=750	containsMarker=false	cosine=0.8369
#4	chunk 6	manual-extenso.md	heading=""	tokens=3000	containsMarker=true	cosine=0.8357
#5	chunk 3	distractor-03.md	heading=""	tokens=850	containsMarker=false	cosine=0.8347
#6	chunk 5	distractor-05.md	heading=""	tokens=950	containsMarker=false	cosine=0.8274

Filler band (min/max cosine, non-marker chunks): [0.8274, 0.8385]

Marker chunk 6 (manual-extenso.md)
Criterion A — rank of the marker chunk in the vector-only ranking: 4 of 6
Criterion B — marker chunk cosine vs query: 0.8357
Criterion C — truncation probe (first 384 words of the document vs the marker chunk): 0.9947
Diagnostics — marker string offset inside its chunk: 6068 chars; chunk length: 12000 chars
```

Every printed per-rank cosine is monotonically non-increasing (0.8385, 0.8384, 0.8369, 0.8357,
0.8347, 0.8274) — the invariant check ran and found nothing to report, both runs, and both exited 0.

### Verify the verifier — proof the monotonicity check can fail (MANDATORY, per instruction)

Before trusting the new invariant check, I temporarily edited the committed script to inject a
deliberately-out-of-order value into the per-rank cosine array right before the check runs:

```diff
+  // TEMPORARY PERTURBATION — proving the invariant check can fail. Reverted
+  // before commit; see apply-progress.md "Verify the verifier" section.
+  if (rankCosines.length >= 5) rankCosines[4] = 0.999;
   const monotonicityViolations = findMonotonicityViolations(rankCosines);
```

Ran with the perturbation in place:

```
$ node scripts/vector-reach.mjs test/fixtures/vector-reach "código de verificación interna QUETZAL"; echo "EXIT CODE: $?"
Model: Xenova/multilingual-e5-small
Loading embeddings provider (may download on first run)...

Vector-only top-10 for query: "código de verificación interna QUETZAL"

#1	chunk 4	distractor-04.md	heading=""	tokens=900	containsMarker=false	cosine=0.8385
#2	chunk 2	distractor-02.md	heading=""	tokens=800	containsMarker=false	cosine=0.8384
#3	chunk 1	distractor-01.md	heading=""	tokens=750	containsMarker=false	cosine=0.8369
#4	chunk 6	manual-extenso.md	heading=""	tokens=3000	containsMarker=true	cosine=0.8357
#5	chunk 3	distractor-03.md	heading=""	tokens=850	containsMarker=false	cosine=0.8347
#6	chunk 5	distractor-05.md	heading=""	tokens=950	containsMarker=false	cosine=0.8274

!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
INVARIANT VIOLATION: per-rank cosines are not monotonically
non-increasing. Rank comes from vec0's ascending-L2 order over the
SAME stored vectors these cosines are computed from, so with
normalized vectors (‖a−b‖² = 2 − 2·a·b) ascending L2 order IS
descending cosine order, exactly. A violation here means rank and
cosine are reading two different vector populations again — see
design.md Decision 5 and CLAUDE.md's normalized-vectors invariant.
  rank 5 cosine 0.9990 > rank 4 cosine 0.8357
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
EXIT CODE: 1
```

Confirmed: the checker errors clearly and exits non-zero. Reverted the perturbation immediately
(`grep -n "TEMPORARY PERTURBATION" scripts/vector-reach.mjs` → no matches after revert), then
re-ran the unmodified script to confirm exit 0 with clean output:

```
$ node scripts/vector-reach.mjs test/fixtures/vector-reach "código de verificación interna QUETZAL"; echo "EXIT CODE: $?"
[... same clean output as above ...]
EXIT CODE: 0
```

The perturbation was never committed — `git status --porcelain` (below) and `git diff --stat`
against the working tree confirm no stray edits remain in `scripts/vector-reach.mjs` beyond this
batch's intended change.

### Full Suite / Typecheck (re-confirmed after 1.10)

```
$ npm test
> compendio-mcp@1.2.5 test
> vitest run


 RUN  v4.1.10 C:/Users/Raul/Workspace/compendio-mcp


 Test Files  29 passed (29)
      Tests  308 passed (308)
   Start at  14:04:43
   Duration  9.00s (transform 4.02s, setup 0ms, import 11.63s, tests 11.60s, environment 5ms)
```

```
$ npm run typecheck
> compendio-mcp@1.2.5 typecheck
> tsc --noEmit && tsc -p tsconfig.test.json
```

(no output on either `tsc` invocation — both exit 0)

`git status --porcelain` confirms no `src/` file was touched by this batch either:

```
 M CLAUDE.md
 M scripts/generate-perf-corpus.mjs
?? openspec/changes/bounded-chunk-size/apply-progress.md
?? openspec/changes/bounded-chunk-size/design.md
?? openspec/changes/bounded-chunk-size/specs/
?? openspec/changes/bounded-chunk-size/tasks.md
?? scripts/vector-reach.mjs
?? test/fixtures/vector-reach/
```

(`scripts/generate-perf-corpus.mjs` and `CLAUDE.md` show modified from the 1.1–1.7 batch, not this
one — this batch touched only `scripts/vector-reach.mjs`, plus this file and `tasks.md`.)

### Baseline recorded (Gate 1b "before", SUPERSEDING the 1.8–1.9 table above)

**The 1.8–1.9 table is superseded, not silently edited.** Its numbers came from re-embedding each
chunk individually — a different vector population from the one `store.searchVector` actually
ranks. The table below is the corrected, authoritative "before" baseline; the 1.8–1.9 numbers stay
in this file, above, as a record of what was measured and why it was wrong, per this project's
evidence-discipline history.

| # | Criterion | 1.8–1.9 value (re-embedded, superseded) | 1.10 value (stored vector, authoritative) | Moved? |
|---|---|---|---|---|
| A | Rank of marker chunk (of 6 total) | **4 of 6** | **4 of 6** | **No — unchanged**, as required (rank is a property of the stored index; nothing about the index changed between batches) |
| B | Marker chunk cosine vs query | 0.8350 | **0.8357** | Yes, by +0.0007 — expected: this is the fix working, moving from a re-embedded to a stored vector |
| — | Filler band (min/max, non-marker chunks) | [0.8255, 0.8407] | **[0.8274, 0.8385]** | Yes, narrower on both ends (+0.0019 low, −0.0022 high) — same reason: five stored (batch-padded) vectors instead of five one-at-a-time re-embeddings |
| C | Truncation probe | 0.9949 | **0.9947** | Yes, by −0.0002 — negligible, still comfortably `≥ 0.99` |
| — | Marker offset / chunk length | 6068 / 12000 chars | 6068 / 12000 chars | No — unaffected (these come from the fixture's text, not embeddings) |

**Rank A did NOT move.** Per the batch instruction: "If rank A moves, stop and report it — that
would mean something other than the display path is wrong." Rank A held at 4 of 6 in both batches,
confirming the defect was confined to the display/measurement path (this script's cosine source),
never to `store.searchVector` or the stored index itself. **B and C both moved slightly, in the
expected direction** — B and the filler band because they now read the same batch-padded vectors
`searchVector` ranks (instead of unbatched re-embeddings of the same text), C because its
marker-side operand changed from a re-embedded vector to the stored one. All three criteria still
hold against amended Decision 5's pass/fail table (A: not 1 — holds; B: 0.8357 inside filler band
[0.8274, 0.8385] — holds; C: 0.9947 ≥ 0.99 — holds, fixture still validated).

**This 1.10 table is now the authoritative Gate 1b "before" baseline** that task 9.3 (Gate 1b-after,
Work Unit 2) must compare against — not the 1.8–1.9 table above, which is retained only as a
superseded record with its root cause documented.

### Deviations from Design (this batch)

None. This batch implements design.md Decision 5's amended steps 5 and 7 (stored-vector cosines,
monotonicity self-check) as written, plus the "verify the verifier" proof the orchestrator's
instruction required (not itself part of Decision 5, but does not touch the committed script's
final state).

### Issues Found (this batch)

None blocking. The defect this batch fixes was found and diagnosed by the orchestrator before this
batch started (see "The defect" above); this batch's own new mechanism (the monotonicity check) was
verified able to fail before being trusted, per instruction.

## Workload / PR Boundary (Work Unit 1)

- Mode: chained PR slice (`stacked-to-main`, per the tasks artifact's Review Workload Forecast)
- Current work unit: Work Unit 1 — Gate 1b Tooling (PR #1, base `main`)
- Boundary: this batch starts from an unmodified `src/` tree and ends with the fixture, generator
  flag, and `vector-reach.mjs` committed to the working tree (not yet committed to git — per
  instruction, commits are the user's call). PR #2 (Work Unit 2) is NOT started; no `split-text.ts`,
  no `src/infrastructure/config.ts` change.
- Estimated review budget impact: within the ~550–650 line forecast for PR #1 (mostly generated
  fixture content).

## Status (Work Unit 1)

10/10 tasks in Work Unit 1 complete (1.1–1.10). Decision 5 has since been **amended twice** by the
user/design process: first in response to the 1.5 FINDING (withdrawing the unfalsifiable
top-10-membership criterion in favor of the three-criterion table — A rank, B cosine vs filler band,
C truncation probe), then in response to the 1.8–1.9 baseline's own display-path defect (task 1.10):
per-rank cosines must come from the vector actually **stored** in `chunks_vec`, not a re-embedding of
`chunk.content`, so criteria A (rank) and B (cosine) measure the same objects — plus a self-asserted
monotonicity check (proven able to fail, then reverted) so a future recurrence of this exact defect
cannot ship silently again.

**The 1.10 baseline in the "Batch: Task 1.10" section above is now authoritative**, superseding
1.8–1.9's re-embedded numbers (retained above only as a documented, root-caused record). Final
figures, all measured on the unchanged pre-splitter build, reproduced byte-identical across two
independent runs: **A = rank 4 of 6** (not 1 — holds, **unmoved** from 1.8–1.9, confirming the
original defect was confined to the display path, not the stored index), **B = 0.8357** inside filler
band **[0.8274, 0.8385]** (holds; both shifted slightly from 1.8–1.9's 0.8350 / [0.8255, 0.8407] —
expected, now reading batch-padded stored vectors instead of one-at-a-time re-embeddings), **C =
0.9947** (≥ 0.99 — holds, fixture still validated; was 0.9949). Every figure in the gate now comes
from the committed `scripts/vector-reach.mjs`, reproducibly, reading the same vector population
`store.searchVector` ranks. Work Unit 1 (PR #1) is complete: zero `src/` changes throughout,
`npm test` (308/308) and `npm run typecheck` green. **PR #1 has since been committed as `f5ec119`.**

---

# Work Unit 2 — Batch: Phases 2–3, `splitToBound` Cascade RED → GREEN (PR #2, base: `main` post PR #1)

Scope, per this batch's brief: `tasks.md` 2.1–2.9 (RED) and 3.1–3.3 (GREEN) ONLY. Two files created:
`test/domain/split-text.test.ts` and `src/domain/split-text.ts`. Nothing else under `src/` touched —
`chunking.ts`, `index-pipeline.ts`, and `config.ts` are later phases; `splitToBound` lands **unwired**,
by design.

## TDD Cycle Evidence

Strict TDD is active (`openspec/config.yaml`: `strict_tdd: true`, `rules.apply.tdd: true`,
`test_command: "npm test"`). No pre-existing test file for `split-text` — Safety Net is N/A (new file).

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.1/3.1 | `test/domain/split-text.test.ts` | Unit | N/A (new) | ✅ Written | ✅ Passed | ➖ Single scenario (fast-path) | ✅ Clean |
| 2.2/3.2 | same | Unit | N/A (new) | ✅ Written | ✅ Passed | ✅ 3-paragraph packing | ✅ Clean |
| 2.3/3.2 | same | Unit | N/A (new) | ✅ Written | ✅ Passed | ✅ 3-sentence fallback | ✅ Clean |
| 2.4/3.2 | same | Unit | N/A (new) | ✅ Written | ✅ Passed | ✅ 5-piece word packing | ✅ Clean |
| 2.5/3.2 | same | Unit | N/A (new) | ✅ Written | ✅ Passed | ✅ surrogate-pair boundary case | ✅ Clean |
| 2.6/3.2 | same | Unit | N/A (new) | ✅ Written | ✅ Passed | ✅ 4 Spanish edge patterns in one case | ✅ Clean |
| 2.7/3.2 | same | Unit | N/A (new) | ✅ Written | ✅ Passed | ✅ 40-row table | ✅ Clean |
| 2.8/3.2 | same | Unit | N/A (new) | ✅ Written | ✅ Passed | ✅ fence with internal blank line | ✅ Clean |
| 2.9/3.2 | same | Unit | N/A (new) | ✅ Written | ✅ Passed | ✅ degenerate-row "bound wins" case | ✅ Clean |
| 3.3 | same | Unit | N/A (new) | — | ✅ `npx vitest run` green, 9/9 | — | — |

### Test Summary
- **Total tests written**: 9 (one `it` per task 2.1–2.9; each exercises a distinct cascade level per
  Decision 2's six-level table)
- **Total tests passing**: 9/9
- **Layers used**: Unit (9)
- **Approval tests** (refactoring): None — no refactoring tasks, `split-text.ts` is a new file
- **Pure functions created**: 1 exported (`splitToBound`) + 13 internal helpers (`packUnits`,
  `splitBlocks`, `splitIntoBlocksFenceAware`, `isFenceDelimiter`, `splitOversizedBlock`,
  `isFencedCodeBlock`, `isMarkdownTable`, `isSeparatorRow`, `splitTable`, `splitFence`, `splitLines`,
  `isSentenceStart`, `isAbbreviation`, `extractSentences`, `splitSentences`, `splitWords`,
  `splitCodePoints`) — no filesystem, no SQLite, no transformers, imports nothing beyond `tokens.js`

## RED — proof `splitToBound` did not exist yet

```
$ npx vitest run test/domain/split-text.test.ts

 RUN  v4.1.10 C:/Users/Raul/Workspace/compendio-mcp

 ❯ test/domain/split-text.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/domain/split-text.test.ts [ test/domain/split-text.test.ts ]
Error: Cannot find module '../../src/domain/split-text' imported from C:/Users/Raul/Workspace/compendio-mcp/test/domain/split-text.test.ts
 ❯ test/domain/split-text.test.ts:2:1
      1| import { afterEach, describe, expect, it, vi } from "vitest";
      2| import { splitToBound } from "../../src/domain/split-text";
       | ^
      3| import * as tokensModule from "../../src/domain/tokens";
      4| import { estimateTokens } from "../../src/domain/tokens";


 Test Files  1 failed (1)
      Tests  no tests
   Start at  17:14:50
   Duration  208ms (transform 30ms, setup 0ms, import 0ms, tests 0ms, environment 0ms)
```

All 9 `it()` cases were written before `src/domain/split-text.ts` existed at all — the whole suite
failed to even collect (0 tests), the strongest possible RED (not a runtime assertion failure but an
unresolvable import), confirming no test could have been passing by accident before the implementation
was written.

## GREEN — implementation, first run

```
$ npx vitest run test/domain/split-text.test.ts

 RUN  v4.1.10 C:/Users/Raul/Workspace/compendio-mcp


 Test Files  1 passed (1)
      Tests  9 passed (9)
   Start at  17:15:28
   Duration  210ms (transform 41ms, setup 0ms, import 56ms, tests 12ms, environment 0ms)
```

`npm run typecheck` after the implementation:

```
$ npm run typecheck
> compendio-mcp@1.2.5 typecheck
> tsc --noEmit && tsc -p tsconfig.test.json
```

(no output on either `tsc` invocation — both exit 0)

## Verify the verifier — MANDATORY mutation proof

Per instruction, before trusting the 9/9 GREEN, temporarily broke the cascade's terminal level
(`splitCodePoints`, level 6 — the "no input can defeat the bound" guarantee) to return its input
unsplit:

```diff
 function splitCodePoints(text: string, maxTokens: number): string[] {
+  // TEMPORARY PERTURBATION — proving the bound-invariant test can fail.
+  // Reverted immediately after capturing the RED run; see apply-progress.md
+  // "Verify the verifier" section.
+  return [text];
+  // eslint-disable-next-line no-unreachable
   const pieces: string[] = [];
   let current = "";
   for (const codePoint of text) {
```

Ran with the perturbation in place:

```
$ npx vitest run test/domain/split-text.test.ts

 RUN  v4.1.10 C:/Users/Raul/Workspace/compendio-mcp

 ❯ test/domain/split-text.test.ts (9 tests | 2 failed) 15ms
     × falls through to fixed-width code-point splitting on a whitespace-free run, never splitting a surrogate pair 5ms
     × keeps the bound over table validity for a row that cannot fit even with its own preamble 1ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/domain/split-text.test.ts > splitToBound > falls through to fixed-width code-point splitting on a whitespace-free run, never splitting a surrogate pair
AssertionError: expected [ Array(1) ] to deeply equal [ …(2) ]
  ❯ test/domain/split-text.test.ts:83:20

 FAIL  test/domain/split-text.test.ts > splitToBound > keeps the bound over table validity for a row that cannot fit even with its own preamble
AssertionError: expected 75 to be less than or equal to 20
  ❯ test/domain/split-text.test.ts:173:37

 Test Files  1 failed (1)
      Tests  2 failed | 7 passed (9)
   Start at  17:15:59
   Duration  214ms (transform 42ms, setup 0ms, import 57ms, tests 12ms, environment 0ms)
```

Confirmed: the bound-invariant checks (2.5's surrogate-pair test — the whole 5000-char run came back
as one unsplit piece instead of two bounded pieces — and 2.9's degenerate-table "bound wins" test —
the huge row's fragment measured 75 tokens against a maxTokens of 20) both fail with real, concrete
violations when the terminal cascade level is broken. This proves the invariant tests are not
tautologies and would catch a real regression in the "no input can defeat the bound" guarantee.

Reverted immediately:

```
$ grep -n "TEMPORARY PERTURBATION" src/domain/split-text.ts; echo "grep exit: $?"
grep exit: 1

$ npx vitest run test/domain/split-text.test.ts

 RUN  v4.1.10 C:/Users/Raul/Workspace/compendio-mcp


 Test Files  1 passed (1)
      Tests  9 passed (9)
   Start at  17:16:12
   Duration  213ms (transform 42ms, setup 0ms, import 57ms, tests 12ms, environment 0ms)
```

`grep` found no match (exit 1) — the perturbation left no trace in the committed file — and the suite
is green again, byte-identical to the original GREEN run.

## Full Suite / Typecheck / Build (this batch's gate)

```
$ npm test
> compendio-mcp@1.2.5 test
> vitest run

 RUN  v4.1.10 C:/Users/Raul/Workspace/compendio-mcp


 Test Files  30 passed (30)
      Tests  317 passed (317)
   Start at  17:16:18
   Duration  7.04s (transform 4.29s, setup 0ms, import 9.94s, tests 9.11s, environment 5ms)
```

(317 = the 308 from Work Unit 1's baseline + 9 new `split-text.test.ts` cases; every pre-existing test
still passes — nothing under `src/` besides the new `split-text.ts` file was touched, so no regression
was possible, and none occurred.)

```
$ npm run typecheck
> compendio-mcp@1.2.5 typecheck
> tsc --noEmit && tsc -p tsconfig.test.json
```

(no output on either `tsc` invocation — both exit 0)

```
$ npm run build
> compendio-mcp@1.2.5 build
> tsc
```

(no output — exit 0)

`git status --porcelain` confirms the batch's exact scope — only the two intended new files, nothing
else:

```
?? src/domain/split-text.ts
?? test/domain/split-text.test.ts
```

(Work Unit 1's files — `CLAUDE.md`, `scripts/generate-perf-corpus.mjs`, `scripts/vector-reach.mjs`,
`test/fixtures/vector-reach/`, and the `openspec/changes/bounded-chunk-size/` artifacts — are no
longer listed as pending changes because they are now committed as `f5ec119`, per the branch's git
log. This batch did not touch any of them.)

---

# Work Unit 2 — Batch: Phase 9 (9.4-9.7) + Phase 10, Gate 2, Docs, Final Diff Review (PR #2)

Scope, per this batch's brief: `tasks.md` 9.4-9.7 and 10.1-10.3. Tasks 9.1-9.3 were measured by the
coordinator **before** this batch started; per explicit instruction those figures are recorded below
as authoritative, not re-run. Files touched this batch: `CLAUDE.md` (modify), `README.md` (modify),
`openspec/changes/bounded-chunk-size/tasks.md` (checkbox updates), this file. No `src/` file was
touched this batch — Phase 9/10 is docs, manual gates, and review only.

## 9.1-9.3 — recorded as authoritative (measured by the coordinator, prior to this batch)

Per instruction, these were **not** re-run in this batch; the figures below are the coordinator's own
measurement, taken as authoritative and recorded here so the tasks artifact and this file carry the
full Phase 9 picture in one place.

### 9.1 — Manual Gate 1 (PASS)

`node dist/cli.js --root ejemplos eval`:

```
mode      recall@5   MRR      failures
hybrid    1.00       0.943    0
lexical   0.95       0.856    1
```

Hybrid holds the baseline exactly (required: recall@5 = 1.00, MRR >= 0.943 — both met, no tolerance
band needed). The lexical row moved from the README's previously published 0.857 to 0.856 — reported,
not gated, per an explicit user decision recorded by the coordinator.

### 9.2 — `ejemplos/` chunk count re-measured

11 documents / **27 chunks at 800** -> 11 documents / **29 chunks at 480**, from the real indexer
(`node dist/cli.js --root ejemplos index`). This number was already independently derived and traced
in the Phase 6-8 batch above (`test/` unaffected — see "Measured `ejemplos/` chunk count" there): the
+2 comes from `mergeTinyPieces`' narrower merge headroom on `leadsviewer/validacion-formulario.md`
(three H3 children that used to merge at the wider 700-token headroom no longer do at 380), not from
any section actually being divided by `splitToBound` — no `ejemplos/` section is individually large
enough to trigger the size cascade.

### 9.3 — Manual Gate 1b-after (PASS, all three criteria of amended Decision 5)

| # | Criterion | Before (1.10 baseline) | After (measured) | Required | Holds? |
|---|---|---|---|---|---|
| A | Rank of the marker chunk | 4 of 6 | **1 of 10** | rank 1 | Yes |
| B | Cosine vs the filler band | 0.8357, in-band | **0.8800**, band ceiling 0.8441 | >= 0.855 and above that run's ceiling | Yes |
| C | Truncation probe | 0.9947 | **0.9447** | reported, expected <= 0.97 | Yes (well under) |

Fixture went 6 -> 19 chunks; the marker chunk is 421 tokens, marker at char 1164 of 1681. **For the
record, stated plainly rather than smoothed over**: design.md Decision 5 derives an expected B in the
**0.855-0.875** range (model: `cos(q,p) approx 0.847 / 0.983 approx 0.862`). The measured **0.8800**
sits slightly *above* that derived range — still comfortably under the 0.90 red-flag line (which would
mean the splitter cut far below the bound), and still a clean PASS on the stated `>= 0.855` threshold,
but the design's own derivation under-predicted B by about 0.018-0.025. This is the second measurement
in this change where a design-derived number landed close to, but outside, its own predicted band (the
first was Gate 1b's own truncation-probe reasoning holding exactly; this is the cosine-derivation
model, not the pass/fail threshold, being slightly off) — noted here as a pattern worth keeping in mind
for 9.4's own prediction, per the coordinator's explicit "treat close enough with suspicion" framing.

## 9.4 — Manual Gate 2, the falsifiable prediction

### Build and pre-flight

```
$ npm run build
> compendio-mcp@1.2.5 build
> tsc
```

(no output — exit 0; picks up every `src/` change from Phases 4-8)

```
$ npm test
> compendio-mcp@1.2.5 test
> vitest run

 RUN  v4.1.10 C:/Users/Raul/Workspace/compendio-mcp

 Test Files  31 passed (31)
      Tests  376 passed (376)
   Start at  17:05:50
   Duration  9.07s (transform 3.97s, setup 0ms, import 13.62s, tests 14.39s, environment 8ms)
```

```
$ npm run typecheck
> compendio-mcp@1.2.5 typecheck
> tsc --noEmit && tsc -p tsconfig.test.json
```

(no output on either `tsc` invocation — both exit 0)

### Corpus generation (scratch dir, outside the repository)

```
$ node scripts/generate-perf-corpus.mjs "<scratchpad>\gate2-corpus"
corpus generado en <scratchpad>\gate2-corpus\docs
  38 documentos, semilla 1592594996
  marcador de la puerta 1b: QUETZAL-7731 (dentro de ba/manual.md)
```

```
$ ls -la <scratchpad>\gate2-corpus\docs\ba
comparativa.md              8015
manual-basico.md           11770
manual.md                 169011
presentacion-sistemas.md    9946
resumen-rapido.md           4519
```

### Index run, timed

```
$ time node dist/cli.js --root "<scratchpad>\gate2-corpus" index
Discovering documents
Indexing 38 documents
[1/38] arch/spec-01.md
...
[38/38] ba/resumen-rapido.md
Embedding 358 chunks in 23 batches
downloading model: 112.9/129.1 MB
downloading model: 119.4/129.1 MB
downloading model: 125.9/129.1 MB
[1/23] embedding batch
...
[23/23] embedding batch
Indexed 38 documents (358 chunks) in 30975 ms [mode hybrid]

real	0m31.875s
user	0m0.000s
sys	0m0.047s
```

**Model cache note, reported honestly, not hidden**: only 3 progress frames appeared (87% -> 92% ->
97% of the 129.1 MB model), consistent with `CLAUDE.md`'s documented "warm cache — few frames" case,
not a cold ~129 MB download. This session's earlier batches (Work Unit 1's fixture indexing, this
batch's own `npm test` runs) already populated the transformers.js model cache
(`node_modules/@huggingface/transformers/.cache`), so this run's 31 s is **not** confounded by a full
cold download the way a first-ever run would be. Whether the *baseline* 367 s figure (recorded in
`proposal.md`, not re-measured in this batch — the pre-change build no longer exists to re-run) was
itself measured warm or cold is not documented anywhere in this change's artifacts. This is flagged as
an open question about strict comparability, not resolved here.

### Chunk counts (queried directly from the indexed SQLite DB, per document)

```
$ node --input-type=module -e "... SELECT d.path, COUNT(c.id) FROM documents d JOIN chunks c ... GROUP BY d.id ..."
arch/spec-01.md .. arch/spec-27.md    7 each   (27 documents x 7 = 189)
arch/spec-28.md .. arch/spec-33.md    8 each   (6 documents x 8 = 48)
ba/comparativa.md                     6
ba/manual-basico.md                   7
ba/manual.md                         99
ba/presentacion-sistemas.md           6
ba/resumen-rapido.md                  3
TOTAL                               358
ba/manual.md chunks = 99
```

### Result against the prediction — reported plainly, not smoothed

| # | Metric | Predicted | Measured | Delta | Inside prediction? |
|---|---|---|---|---|---|
| A | `ba/manual.md` chunk count | 1 -> ~88 | 1 -> **99** | +11, +12.5% | **No — outside**, same order of magnitude and direction |
| B | Corpus total chunk count | 242 -> ~330 | 242 -> **358** | +28, +8.5% | **No — outside**, same direction |
| C | Full-corpus index wall-clock | 367 s -> ~60 s | 367 s -> **~31 s** | -29 s vs the ~60 s midpoint, i.e. roughly half | **No — outside**, in the favorable direction (faster than predicted, ~12x speedup vs the predicted ~6x) |

**None of the three landed inside the proposal's point prediction.** Per instruction, this is reported
as a finding, not explained away or used to retroactively adjust the prediction. Investigated (not
assumed) why, since "close enough" is explicitly not the bar this change sets:

- **A and B (chunk counts, both moderately above prediction)**: the design's ~88 estimate is the naive
  division `41 837 / 480 approx 87.2`. Greedy packing (Decision 2) does not fill every emitted piece to
  exactly `maxTokens` — it flushes a piece as soon as the *next* unit would overflow it, so the last
  unit accepted into each piece typically leaves headroom rather than landing exactly on the bound.
  Over ~99 pieces that slack compounds into roughly 11-12 extra pieces. This is consistent with how the
  cascade is specified (Decision 2: "accumulate while the joined candidate still fits, flush when it
  does not") — an expected consequence of greedy packing, not a bug; the empirical Gate 3 check below
  independently confirms no chunk exceeds the bound, which is the invariant that actually matters.
- **C (wall-clock, well below prediction, favorably)**: `exploration.md`'s own batch-padding
  measurement (already in this change's artifacts, not a new claim) found a single 43 KB chunk alone
  costs 4.23 s against 0.03 s for 16 small chunks combined — roughly 140x. The pre-change baseline's
  single 41 837-token (~167 KB) chunk is a more extreme case of exactly that pathology. Removing it
  entirely (replacing it with ~99 bounded pieces) plausibly saves *more* than the design's conservative
  ~60 s midpoint estimate — the design's own evidence for *why* the old default is slow supports a
  larger-than-predicted speedup, not a smaller one. The model-cache note above is a real, disclosed
  confound on the exact "~31 s" figure, but even a generous allowance for cache warmth would need to
  explain away a majority of the ~336 s gap between 367 s and 31 s, and the tokenization-cost mechanism
  above independently accounts for a large removal on its own.

**This is not treated as a contradiction requiring a design revisit**: the qualitative premise (an
oversized chunk dominates cost; bounding it removes that cost; the corpus grows in chunk count because
one huge chunk becomes many bounded ones) is strongly confirmed in the correct direction on all three
axes. What moved is the *magnitude* of two conservative point estimates, in directions this batch can
explain from evidence already in this change's own artifacts, not new assumptions. Flagged here,
plainly, for the coordinator/user to decide whether `design.md`'s specific `~88`/`~330`/`~60 s` figures
should be corrected to reflect the measurement, per this change's own "do not adjust the prediction to
fit the measurement" instruction — that correction, if wanted, is a design-artifact edit, not something
this apply batch will do unilaterally.

## 9.5 — `CLAUDE.md` corrections

1. **Corrected the now-false claim** ("cuts only happen at heading boundaries, so tables are never
   split mid-row") in the "Heading-based chunking" bullet — replaced with the accurate description:
   heading-based descent decides where the coarse cuts land, `splitToBound` guarantees the size bound
   afterward, and tables/fences ARE split mid-row/mid-block when the bound requires it.
2. **Added the Gate 2 manual procedure** beside the existing Gate 1b one (same section, same style):
   commands, the predicted-vs-measured table (9.4's numbers), and the two deviation explanations from
   9.4 above, condensed.
3. **Added the reindex operational note** as a new bullet in "Non-obvious decisions": a
   `chunk.maxTokens`/splitting-logic change needs a full `compendio index` to reach existing documents,
   because incremental sync's fingerprint is the content hash alone — citing
   `specs/indexing/spec.md`'s "Chunk Boundary Changes Require a Full Reindex" requirement by name.
4. **Left the `0.943`/`20/22` figures unchanged** — 9.1 did not move them (hybrid MRR/recall@5 held
   exactly; the excerpt-budget bullet's figures are about hybrid rank-1 behavior, not the lexical row
   that did move).
5. **Confirmed the archived file was not touched**:

```
$ git status --porcelain openspec/changes/archive/2026-07-28-index-progress-reporting/exploration.md
(no output)
```

## 9.6-9.7 — `README.md` updates

1. `:136` config example: `"chunk": { "minTokens": 100, "maxTokens": 800 }` -> `480`.
2. `:242-247` (now shifted slightly by the above edit): `27 chunks` -> `29 chunks` (9.2's measured
   figure); eval table hybrid row **unchanged** (1.00 / 0.943 / 0, gated by 9.1, did not move);
   keyword-only row `0.857` -> `0.856` (9.1's measured figure, reported not gated).

```
$ grep -n "800\|27 chunks\|0.857\|maxTokens" README.md
136:  "chunk": { "minTokens": 100, "maxTokens": 480 },
```

No stray `800`/`27 chunks`/`0.857` reference remains in README within this batch's edited scope.

**Out-of-scope observation, not edited**: `README.md:207` — `"split into fragments at heading
boundaries (tables are never cut)"` — carries the same stale claim CLAUDE.md's line 131 had. Neither
`tasks.md`'s 9.6/9.7 wording nor `design.md`'s File Changes table for `README.md` (which names only
`:136` and the eval table) authorizes touching this line, so it was left as-is per "follow the task
text exactly." Flagged here rather than silently fixed or silently ignored — a candidate for a small
follow-up if the coordinator wants README's "How it works" diagram corrected too.

## 10.1 — Gate 3, empirically re-confirmed

The Phase 7 unit-level invariant suite (bound + coverage, both invariants) re-run clean:

```
$ npx vitest run test/domain/split-text.test.ts test/domain/chunking.test.ts test/application/index-pipeline.test.ts test/application/read-document.test.ts

 RUN  v4.1.10 C:/Users/Raul/Workspace/compendio-mcp

 Test Files  4 passed (4)
      Tests  87 passed (87)
   Start at  17:12:01
   Duration  711ms (transform 395ms, setup 0ms, import 894ms, tests 496ms, environment 0ms)
```

**Additionally, empirically checked against the real 358-chunk Gate 2 index** (not just the unit-level
fuzz suite) — queried every chunk's stored content length directly from the indexed SQLite DB and
computed `estimateTokens` (`ceil(len/4)`) for all 358 chunks:

```
chunks checked: 358
max estimateTokens across ALL chunks in the Gate 2 corpus: 480 at ba/manual.md position 38
chunks exceeding 480 tokens: 0
```

The single largest chunk across the whole corpus lands at **exactly** 480 — the bound itself, not one
token over — and zero chunks exceed it. This is real-corpus evidence for Gate 3, independent of and in
addition to the synthetic adversarial suite. Table-piece markdown validity (2.7's requirement) is
covered by the existing unit tests (`splitTable`'s header/separator re-emission, asserted via
re-parsing each piece) — not re-verified again here since nothing in Phase 9/10 touched `split-text.ts`.

## 10.2 — Full suite / typecheck (final gate)

```
$ npm test
> compendio-mcp@1.2.5 test
> vitest run

 RUN  v4.1.10 C:/Users/Raul/Workspace/compendio-mcp

 Test Files  31 passed (31)
      Tests  376 passed (376)
   Start at  17:12:10
   Duration  7.62s (transform 3.87s, setup 0ms, import 11.98s, tests 11.63s, environment 5ms)
```

```
$ npm run typecheck
> compendio-mcp@1.2.5 typecheck
> tsc --noEmit && tsc -p tsconfig.test.json
```

(no output on either `tsc` invocation — both exit 0)

```
$ npm run build
> compendio-mcp@1.2.5 build
> tsc
```

(no output — exit 0)

## 10.3 — Diff review against design.md's File Changes table

Compared against `main`, not just this batch's own uncommitted diff, since design.md's File Changes
table describes the whole change (PR #1, already committed as `f5ec119`, plus PR #2's uncommitted
work):

```
$ git diff main --stat
 .gitattributes                                     |    5 +
 CLAUDE.md                                          |   65 +-
 README.md                                          |    6 +-
 openspec/changes/bounded-chunk-size/apply-progress.md | 2367 ++++++++
 openspec/changes/bounded-chunk-size/design.md      |  371 +++
 openspec/changes/bounded-chunk-size/exploration.md |  167 ++
 openspec/changes/bounded-chunk-size/proposal.md    |  193 ++
 openspec/changes/bounded-chunk-size/specs/configuration/spec.md |   19 +
 openspec/changes/bounded-chunk-size/specs/indexing/spec.md      |  126 ++
 openspec/changes/bounded-chunk-size/tasks.md       |  129 ++
 scripts/generate-perf-corpus.mjs                   |  241 ++
 scripts/vector-reach.mjs                           |  329 +++
 src/application/index-documents.ts                 |    7 +-
 src/application/index-pipeline.ts                  |   18 +-
 src/domain/chunking.ts                              |   41 +-
 src/infrastructure/config.ts                        |    9 +-
 test/application/index-progress.test.ts             |    6 +-
 test/application/read-document.test.ts              |   82 +-
 test/domain/chunking.test.ts                        |  203 +-
 test/fixtures/vector-reach/docs/*.md (6 files)      |  132 ++
 test/helpers/build.ts                                |    7 +-
 26 files changed, 4487 insertions(+), 36 deletions(-)
```

(`git diff` alone omits untracked files; `git status` confirms the 3 remaining untracked new files —
`src/domain/split-text.ts`, `test/application/index-pipeline.test.ts`,
`test/domain/split-text.test.ts` — all three ARE design-listed, see below.)

**Every file design.md's File Changes table lists (15 rows/patterns) is touched. None left
untouched.** Checked row by row: `src/domain/split-text.ts` (Create) ✓, `src/domain/chunking.ts`
(Modify) ✓, `src/application/index-pipeline.ts` (Modify) ✓, `src/application/index-documents.ts`
(Modify) ✓, `src/infrastructure/config.ts` (Modify) ✓, `test/domain/split-text.test.ts` (Create) ✓,
`test/domain/chunking.test.ts` (Modify) ✓, `test/application/index-pipeline.test.ts` (Create) ✓,
`test/helpers/build.ts` (Modify) ✓, `test/application/index-progress.test.ts` (Modify) ✓,
`test/fixtures/vector-reach/docs/**` (Create, 6 files) ✓, `scripts/generate-perf-corpus.mjs` (Modify)
✓, `scripts/vector-reach.mjs` (Create) ✓, `README.md` (Modify) ✓, `CLAUDE.md` (Modify) ✓.

**Files changed that design.md's File Changes table does NOT list — reported, not hidden:**

1. **`.gitattributes`** (new, PR #1) — pins `test/fixtures/vector-reach/** text eol=lf` so a Windows
   checkout with `core.autocrlf=true` cannot silently shift the fixture's byte-sensitive recorded
   figures (marker offset, chunk length, cosines). Well-justified and load-bearing for Gate 1b's
   reproducibility, but genuinely absent from design.md's table.
2. **`test/application/read-document.test.ts`** (modified, Phase 6-8 batch) — a new integration test
   plus mutation proof for the "split section reads back whole and in order" path (Decision 3's
   "load-bearing, verified" claim). Design.md's Testing Strategy table expected the *existing*
   `read-document.test.ts` to cover this "via the updated harness," but the Phase 6-8 batch found zero
   existing coverage anywhere in the suite for a genuinely `splitToBound`-divided section and closed the
   gap with a new test — already flagged as a deviation in that batch's own report, re-surfaced here per
   this task's explicit review requirement.
3. **`openspec/changes/bounded-chunk-size/{apply-progress.md,design.md,exploration.md,proposal.md,
   specs/configuration/spec.md,specs/indexing/spec.md,tasks.md}`** — the change's own SDD process
   artifacts (proposal, spec, design, tasks, and this progress file). Design.md's File Changes table
   describes production/doc/test files the *design* changes, not the SDD artifacts that produced the
   design — a table cannot list itself. `proposal.md` additionally received one substantive post-hoc
   correction during apply (Phase 6-8, not this batch): the "splitting path fires once" claim was
   corrected to "does not fire at all" once the real mechanism (heading descent, not a size split) was
   traced — already documented in that batch's own section, not a new finding here.

**No design-listed file was left untouched.** Three categories of undocumented change exist (one
small utility file, one test file closing a real coverage gap, and the SDD process artifacts
themselves) — none is unexplained, all three were already disclosed in this file at the batch that
introduced them, and this task's job was to re-surface them against the design's table specifically,
which is done above.

## Full Suite / Typecheck / Build (this batch's gate — final, restated)

`npm test` 376/376, `npm run typecheck` clean (both `tsc` invocations), `npm run build` clean. No
`src/` file was touched this batch (`CLAUDE.md`, `README.md`, and the two SDD artifacts are the only
edits) — confirmed by `git status --porcelain` below.

```
$ git status --porcelain
 M CLAUDE.md
 M README.md
 M openspec/changes/bounded-chunk-size/apply-progress.md
 M openspec/changes/bounded-chunk-size/proposal.md
 M openspec/changes/bounded-chunk-size/tasks.md
 M src/application/index-documents.ts
 M src/application/index-pipeline.ts
 M src/domain/chunking.ts
 M src/infrastructure/config.ts
 M test/application/index-progress.test.ts
 M test/application/read-document.test.ts
 M test/domain/chunking.test.ts
 M test/helpers/build.ts
?? src/domain/split-text.ts
?? test/application/index-pipeline.test.ts
?? test/domain/split-text.test.ts
```

(`src/application/index-documents.ts` through `test/helpers/build.ts`, and `openspec/.../proposal.md`,
are carryover from the Phase 4-8 batches, not this one — this batch touched only `CLAUDE.md`,
`README.md`, `openspec/.../tasks.md`, and this file. No commit was made, per instruction.)

## Deviations from Design (this batch)

None new in `src/`/`test/` (this batch is docs + manual gates + review only). The three
design-table-absent files reported in 10.3 above are all carryover from earlier batches, already
individually disclosed when introduced; this batch's contribution is surfacing them specifically
against `design.md`'s table, as 10.3 requires. Gate 2's measured numbers (9.4) deviate from
`design.md`'s point predictions in magnitude, not direction — reported plainly per instruction, not
silently reconciled, and explicitly left for the coordinator/user to decide whether `design.md`'s
`~88`/`~330`/`~60 s` figures warrant a correction.

## Issues Found (this batch)

**Finding (9.4, Gate 2)**: none of the three measured numbers landed inside the proposal's point
prediction — see the table and investigation above. Direction confirmed on all three; magnitude did
not match any of them. Not treated as a blocking contradiction (the qualitative premise holds, and
this batch traced plausible mechanisms for each deviation from evidence already in this change's own
artifacts), but reported exactly as measured, per the explicit "do not adjust the prediction to fit
the measurement" instruction.

**Finding (9.3, recorded from the coordinator's pre-batch measurement)**: design.md's derived B
(0.855-0.875) also landed outside its own predicted range (measured 0.8800) — the second instance in
this change of a design-derived number missing its own band while the pass/fail threshold itself still
holds. Noted as a pattern, not re-investigated in this batch (9.3 was not this batch's own
measurement).

**Finding (10.3)**: 3 categories of files changed that design.md's File Changes table does not list —
none newly introduced by this batch, all already individually disclosed at the batch that introduced
them, now cross-checked against the design table specifically as this task requires. No design-listed
file was left untouched.

No other issues.

## Remaining Tasks (Work Unit 2, this change)

- [x] 2.1–10.3 — **all tasks in `tasks.md` are now complete.**

## Workload / PR Boundary (this batch)

- Mode: chained PR slice (`stacked-to-main`), `size:exception` accepted for PR #2 as a whole per the
  tasks artifact's Review Workload Forecast
- Current work unit: Work Unit 2 — Splitter, Wiring, Default, Docs (PR #2, base `main` post PR #1) —
  **this batch closes it out.**
- Boundary: this batch starts from the Phase 6-8 batch's tree (all production wiring, default, and
  integration regression complete) and ends with Phase 9's manual gates recorded, `CLAUDE.md`/
  `README.md` corrected and extended, and Phase 10's final gate (bound invariant, full suite, diff
  review) confirmed. PR #2 is feature-complete against `tasks.md`; no commit was made, per instruction
  — that remains the user's call.
- Estimated review budget impact: this batch's own diff is doc-only (`CLAUDE.md`, `README.md`) plus
  tracking-artifact updates; PR #2's total diff (`git diff main --stat` above, 26 files, +4487/-36)
  remains within the `size:exception` already recorded for PR #2 as a whole in the tasks artifact.

## Status (this batch)

10/10 tasks assigned to this batch complete (9.4-9.7 = 4 tasks, 10.1-10.3 = 3 tasks, plus 9.1-9.3's
authoritative recording from the coordinator's pre-batch measurement = 3 tasks). `npm test` 376/376,
`npm run typecheck` and `npm run build` all clean. **Every task in `tasks.md` (2.1 through 10.3) is now
marked `[x]`.** Two findings were surfaced plainly rather than smoothed over: Gate 2's three measured
numbers all landed outside the proposal's point predictions (direction confirmed, magnitude off, with
a traced mechanism for each), and 10.3's diff review found 3 categories of design-table-absent files
(none newly introduced this batch, all previously disclosed). PR #2 is feature-complete against its
task list. Ready for `sdd-verify`.

## Design Decisions Implemented (traceable to design.md)

- **Decision 1** (signature): `export function splitToBound(text: string, maxTokens: number): string[]`
  in its own module, importing nothing beyond `./tokens.js`. The fast path (`estimateTokens(text) <=
  maxTokens`) returns `[text]` with exactly one `estimateTokens` call — verified via `vi.spyOn` on the
  `tokens` module namespace in task 2.1's test, not just inferred from reading the code.
- **Decision 2** (the six-level cascade): implemented as `splitBlocks` (1) → `splitOversizedBlock`
  routing to `splitTable`/`splitFence`/`splitLines` (2) → `splitLines` (3) → `splitSentences` (4) →
  `splitWords` (5) → `splitCodePoints` (6), each level built on one shared `packUnits` greedy-packing
  helper (accumulate while the joined candidate fits, flush when it does not, recurse into a single
  oversized unit). Level 6 iterates the string's own code-point iterator (`for...of` over a `string`,
  equivalent to `Array.from`/spread) rather than `.split("")` (a UTF-16 code-unit split that would tear
  a surrogate pair) or a naive fixed-index `.slice()` — packing is measured by `estimateTokens` exactly
  like every other level, which is what keeps the bound holding even when a chunk contains a surrogate
  pair (a naive "N code points per chunk" slice would not: an astral character is 1 code point but 2
  UTF-16 units, so a fixed code-point-count window can exceed the character-based token budget when it
  contains one — greedy packing measured in the same units as `estimateTokens` avoids that trap).
- **Decision 2**, Spanish sentence rule: `extractSentences` implements the exact rule stated —
  `[.!?…]+`, optional single closer (`"`, `'`, `»`, `)`), then a `(?=\s)` lookahead, then a manual
  check that the character following the whitespace is `¿`, `¡`, or `\p{Lu}` (any Unicode uppercase
  letter, not just ASCII — covers `Á/É/Í/Ó/Ú/Ñ`). The abbreviation guard (`isAbbreviation`) checks the
  word immediately before the punctuation: length 1 (an initial, e.g. `J.`) or membership in the
  declared list (`sr, sra, srta, dr, dra, ud, uds, art, núm, pág, cap, fig, tab, ej, p, etc, vs`,
  matched case-insensitively). Decimals (`3.5`) and digit-followed abbreviation periods (`art. 12`)
  are already excluded by the base `(?=\s)`-then-`\p{Lu}`/¿/¡ requirement (a digit is never a valid
  follower), independent of the abbreviation list; `J. García` and `art. Único` specifically exercise
  the abbreviation-list/initials guard (both are followed by an uppercase word, which the base rule
  alone would have wrongly treated as a sentence end).
- **Decision 3** (tables and fences re-wrapped; the preamble charged against the budget, bound wins
  on conflict): `splitTable`/`splitFence` measure the CANDIDATE (preamble + accumulated rows/lines)
  against `maxTokens`, never the summands — so the re-emitted header/separator or fence wrapper is
  paid for out of the same budget the content is. When even `preamble + one row/line` alone exceeds
  `maxTokens`, that single row/line is handed to `splitLines` with **no** preamble at all (task 2.9),
  while sibling rows keep theirs (verified: `normalRowPieces` in 2.9's test all start with the header
  and carry the separator as their second line; `hugeRowPieces` carry neither).
- **Decision 4** (`mergeTinyPieces` guard fix) and **Decision 1**'s two call sites
  (`chunkOutline`/`wholeDocumentChunk`): explicitly OUT of scope for this batch, per the brief.
  `splitToBound` is not imported anywhere outside its own test file — `grep -rn "split-text"
  src/domain/chunking.ts src/application/index-pipeline.ts` returns nothing, confirming it truly
  lands unwired.

## Deviations from Design

None. The implementation follows Decision 2's table and Decision 3's precedence rule as written. One
implementation-level choice not dictated verbatim by the design text: a single shared `packUnits`
helper is reused across levels 1, 3, 4, and 5 (blocks/lines/sentences/words all "accumulate while it
fits, flush, recurse into an oversized single unit" against different unit arrays and joiners) rather
than four independent copies of the same loop — a straightforward DRY choice, not a behavioral
deviation; each call site supplies the level's own unit array, joiner, and oversized-recursion target,
so the per-level behavior (which characters serve as the joiner, which level handles the fallback) is
unchanged.

## Issues Found

None. All 9 RED tests failed with a real "module not found" error (not a partial/skipped collection),
all 9 passed on first implementation attempt, the mutation proof produced real, on-topic assertion
failures (not crashes or unrelated errors) when the terminal cascade level was deliberately broken,
and the perturbation was fully reverted and confirmed absent before this record was written.

## Remaining Tasks (Work Unit 2, this change)

- [x] 2.1–2.9 `splitToBound` cascade tests (RED) — this batch
- [x] 3.1–3.3 `splitToBound` implementation (GREEN) — this batch
- [ ] 4.1–4.8 Wire into `chunkOutline` + merge-guard fix
- [ ] 5.1–5.6 Wire into `wholeDocumentChunk` / `NO_CHUNKING`
- [ ] 6.1–6.5 Default `480`, comments, test-harness drift
- [ ] 7.1–7.2 Cross-cutting bound invariant
- [ ] 8.1–8.2 Integration regression + full suite
- [ ] 9.1–9.7 Manual Gates 1 / 1b-after / 2 + docs
- [ ] 10.1–10.3 Final gate

## Workload / PR Boundary (this batch)

- Mode: chained PR slice (`stacked-to-main`), `size:exception` accepted for PR #2 as a whole per the
  tasks artifact's Review Workload Forecast (PR #2 stays one work unit; this batch is an internal
  slice of it, not a separate PR)
- Current work unit: Work Unit 2 — Splitter, Wiring, Default, Docs (PR #2, base `main` post PR #1)
- Boundary: this batch starts from the Work Unit 1 (`f5ec119`) tree and ends with exactly two new
  files (`test/domain/split-text.test.ts`, `src/domain/split-text.ts`), both untracked, nothing else
  changed. `splitToBound` is implemented but not yet wired into any production call site — that is
  Phase 4/5's job, intentionally deferred.
- Estimated review budget impact: this slice alone is small (~460 net new lines across the two files,
  test-heavy); the full PR #2 stays under `size:exception` as already recorded in the tasks artifact.

## Status (this batch)

12/12 tasks assigned to this batch complete (2.1–2.9, 3.1–3.3, plus the mutation-proof and full-suite
gates the brief required beyond the numbered tasks). `npm test` 317/317, `npm run typecheck` and
`npm run build` both clean. `splitToBound` exists as a pure, fully-tested domain primitive, unwired,
exactly as scoped. Ready for the next Work Unit 2 batch (Phase 4: wiring into `chunkOutline` +
the `mergeTinyPieces` off-by-one fix) — NOT started here, per this batch's explicit stop instruction.

---

# Work Unit 2 — Batch: Coordinator-Reported Content-Loss Fix (still Phases 2–3, PR #2)

**Trigger**: the coordinator independently fuzzed `splitToBound` against 306 (input, maxTokens)
combinations against the built `dist/` from the previous batch. Zero bound violations (Level 6 holds
the "no input can defeat the bound" guarantee as designed), but **27 of 306 cases lost content** —
the cascade's OTHER invariant (spec: "together the chunks cover the full body") was never asserted by
the 9 original tests, so 9/9 green and a passing mutation proof did not catch it. Three named defects,
all in the same family (a structural preamble/wrapper silently discarded when no content can share it):

1. An oversized, **unterminated** fenced code block returned `[]` — all content destroyed. Downstream,
   `transformFile` treats zero chunks as "the document has no indexable content," which would drop
   such a document from the index with a false reason.
2. A table whose **header row alone** exceeds the bound lost the header and separator entirely — only
   the two small data rows survived.
3. A smaller instance of the same defect: a fence whose wrapper is tiny but no single content line can
   fit alongside it loses exactly the wrapper's characters (the fence markers themselves).

Scope unchanged from the rest of this batch: only `src/domain/split-text.ts` and
`test/domain/split-text.test.ts`. Phase 4 still not started. Nothing committed.

## Root cause (read from the code, not assumed)

Both `splitTable` and `splitFence` built "candidate" strings (preamble/wrapper + accumulated
content) purely to test-and-discard: if `preamble + rows-so-far` didn't fit AND `preamble + this one
row/line alone` didn't fit either, the code fell straight to `pieces.push(...splitLines(row,
maxTokens))` for the **content alone** — the preamble/wrapper itself was never independently pushed
anywhere. It existed only inside candidate strings used for arithmetic, never as an emitted piece in
its own right. When EVERY row/line failed to share it (either because the preamble itself was globally
oversized — bug 2 — or because the one available line individually overflowed it — bug 3), the
preamble/wrapper had no piece left to ride along with and silently vanished.

A separate, independent defect caused bug 1: `isFencedCodeBlock` decided "this block is a fence" by
checking only that its FIRST line looked like an opening delimiter. For an unterminated fence, the
block's LAST line is just arbitrary content (whatever line the document happened to end on), not a
real closer — but `splitFence` unconditionally treated `lines[lines.length - 1]` as the closing fence
and `lines.slice(1, -1)` as the inner content. For a 2-line block (`["```js", <the whole 680-char
content line>]`), `slice(1, -1)` is the empty array — so `innerLines` was `[]`, the loop never ran, and
`pieces` stayed `[]` for the entire function.

## RED — coverage-invariant tests added first, run against the pre-fix implementation

Added, to `test/domain/split-text.test.ts`: a `nonWhitespace` helper, a code-point-safe
`isSubsequence` helper (iterates both sides via `for...of`/`Array.from` so a surrogate pair is never
compared against half of another one — the same lesson from task 2.5's bound test, applied to the new
helper itself), an `expectCoverage` assertion (the original's non-whitespace characters must appear,
in order, somewhere in the joined pieces' non-whitespace characters — pieces may ADD text via
re-emitted preambles/wrappers, never drop any), three named regression tests reproducing the
coordinator's exact defect family, and a permanent 11-case × 4-`maxTokens` table-driven suite (44
cases: empty, whitespace-only short/large, a 50,000-char no-whitespace run, surrogates-only, an
unterminated fence, nested fences without a blank-line separator, an oversized table header, an
oversized single table row, CRLF prose, and mixed content) asserting BOTH the bound and coverage
invariants for every combination.

```
$ npx vitest run test/domain/split-text.test.ts

 RUN  v4.1.10 C:/Users/Raul/Workspace/compendio-mcp

 ❯ test/domain/split-text.test.ts (56 tests | 10 failed) 63ms
     × preserves all content of an oversized, unterminated fenced code block instead of discarding it 3ms
     × preserves an oversized table header's content instead of discarding it when no row can share it 2ms
     × preserves the fence markers when no single line can fit alongside the fence wrapper 1ms
     × holds the bound and coverage invariants for "unterminated fence" at maxTokens=5 1ms
     × holds the bound and coverage invariants for "unterminated fence" at maxTokens=20 0ms
     × holds the bound and coverage invariants for "unterminated fence" at maxTokens=60 1ms
     × holds the bound and coverage invariants for "oversized table header" at maxTokens=5 1ms
     × holds the bound and coverage invariants for "oversized table header" at maxTokens=20 0ms
     × holds the bound and coverage invariants for "oversized single table row" at maxTokens=5 0ms
     × holds the bound and coverage invariants for "mixed content (heading, prose, table, fence)" at maxTokens=5 1ms

⎯⎯⎯⎯⎯⎯ Failed Tests 10 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/domain/split-text.test.ts > splitToBound coverage invariant (no content may be silently dropped) > preserves all content of an oversized, unterminated fenced code block instead of discarding it
AssertionError: expected 0 to be greater than 0
 ❯ test/domain/split-text.test.ts:241:27
    239|     const pieces = splitToBound(text, maxTokens);
    240|
    241|     expect(pieces.length).toBeGreaterThan(0);

 FAIL  test/domain/split-text.test.ts > splitToBound coverage invariant (no content may be silently dropped) > preserves an oversized table header's content instead of discarding it when no row can share it
AssertionError: expected false to be true // Object.is equality
 ❯ expectCoverage test/domain/split-text.test.ts:229:50

 FAIL  test/domain/split-text.test.ts > splitToBound coverage invariant (no content may be silently dropped) > preserves the fence markers when no single line can fit alongside the fence wrapper
AssertionError: expected false to be true // Object.is equality
 ❯ expectCoverage test/domain/split-text.test.ts:229:50

 [... 7 more coverage failures across the fuzz table, same "expected false to be true" shape ...]

 Test Files  1 failed (1)
      Tests  10 failed | 46 passed (56)
   Start at  17:28:09
   Duration  277ms (transform 42ms, setup 0ms, import 56ms, tests 63ms, environment 0ms)
```

10 real failures, exactly matching the coordinator's three reported defects plus their appearances
across the fuzz table (the "oversized table header" case only fails at `maxTokens` 5 and 20 — at 60
and 200 the 200-char header fits within the bound on its own, so the "no row can share it" condition
never triggers, which is the expected, non-buggy branch of the same code). This RED is stronger
evidence than an artificial mutation: these are real failures against the actual implementation
shipped in the prior batch, not a deliberately broken copy.

## The fix — `src/domain/split-text.ts`

**Fix 1 (bug 1, unterminated fence): `isFencedCodeBlock` now requires a genuine closer.**

```diff
+/** True only for a genuinely terminated fence: the block's first AND last
+ * line both look like a fence delimiter. An opening delimiter with no
+ * matching closer (a common shape in hand-edited or generated markdown)
+ * cannot be re-wrapped by `splitFence` — its last "line" would just be
+ * arbitrary content, not a real closing fence — so it is treated as
+ * ordinary text instead (`splitLines`), which is lossless. */
 function isFencedCodeBlock(block: string): boolean {
   const lines = block.split("\n");
-  return lines.length > 0 && isFenceDelimiter(lines[0]!);
+  if (lines.length < 2) return false;
+  return isFenceDelimiter(lines[0]!) && isFenceDelimiter(lines[lines.length - 1]!);
 }
```

An unterminated fence now fails `isFencedCodeBlock` and falls through to `splitLines(block,
maxTokens)` — ordinary paragraph/line/sentence/word/code-point splitting, which is provably lossless
(every level either absorbs a unit into an accumulating piece or recursively splits a single oversized
unit; nothing is ever discarded).

**Fix 2 (bug 2, table): `splitTable` tracks whether the preamble was ever emitted, and emits it
separately (split further if needed) if not.**

```diff
 function splitTable(block: string, maxTokens: number): string[] {
   ...
   const pieces: string[] = [];
   let current: string[] = [];
+  let preambleEmitted = false;

   const flush = () => {
     if (current.length === 0) return;
     pieces.push(`${preamble}\n${current.join("\n")}`);
+    preambleEmitted = true;
     current = [];
   };

   for (const row of rows) { /* unchanged */ }
   flush();

+  if (!preambleEmitted) {
+    return [...splitLines(preamble, maxTokens), ...pieces];
+  }
   return pieces;
 }
```

The header and separator always precede every data row in the source, so prepending the (possibly
further-split) preamble ahead of any row-cascade fragments preserves source order exactly. Verified
against the ALREADY-PASSING task 2.9 test (the "one huge row among normal rows" case): there,
`preambleEmitted` becomes `true` on the very first successful `flush()` (the normal rows DO share the
preamble), so the new branch is never taken and that test's behavior is byte-identical to before —
confirmed by it still passing unchanged in the GREEN run below.

**Fix 3 (bug 3, fence): `splitFence` gets the analogous fix, but NOT the analogous shape.**

First attempt (wrong): mirroring the table fix exactly —
`return [...splitLines(`${openFence}\n${closeFence}`, maxTokens), ...pieces]` — made the fence-marker
test fail differently (coverage failure, not a length failure): a table's preamble is entirely at the
FRONT (header line, then separator line, both before all rows), but a fence's wrapper spans BOTH ends
(opening fence before the content, closing fence after it). Combining `openFence` and `closeFence` into
one unit and prepending it bunches both markers before the content, so the reconstructed order becomes
`open, close, content` instead of `open, content, close` — a genuine reordering that the subsequence
check correctly rejected (all 6 backtick characters present, just in the wrong relative position to
qualify as a subsequence match). Corrected:

```diff
   flush();

   if (!preambleEmitted) {
+    // Unlike a table's header+separator (which always precede every row),
+    // a fence's wrapper spans BOTH ends of the content — the opening fence
+    // before it, the closing fence after. Emitting them as one combined
+    // unit up front (as the table branch does) would bunch both markers
+    // before the content and corrupt source order; they must be emitted
+    // as separate pieces, open first and close last.
+    return [...splitLines(openFence, maxTokens), ...pieces, ...splitLines(closeFence, maxTokens)];
   }
   return pieces;
 }
```

This is itself evidence the coverage invariant is doing real work: it caught a bug in my OWN fix for
the previous bug, in the same review pass, before it ever reached GREEN.

## GREEN

```
$ npx vitest run test/domain/split-text.test.ts

 RUN  v4.1.10 C:/Users/Raul/Workspace/compendio-mcp


 Test Files  1 passed (1)
      Tests  56 passed (56)
   Start at  17:29:53
   Duration  255ms (transform 44ms, setup 0ms, import 59ms, tests 56ms, environment 0ms)
```

56/56 — the original 9 cascade tests (unchanged, still passing byte-identical to the prior batch), the
3 named regression tests, and all 44 fuzz-table combinations (bound AND coverage, both invariants, for
every case × `maxTokens` combination).

## Full Suite / Typecheck / Build (this batch's gate)

```
$ npm test
> compendio-mcp@1.2.5 test
> vitest run

 RUN  v4.1.10 C:/Users/Raul/Workspace/compendio-mcp


 Test Files  30 passed (30)
      Tests  364 passed (364)
   Start at  17:30:09
   Duration  6.87s (transform 3.88s, setup 0ms, import 9.68s, tests 9.24s, environment 18ms)
```

(364 = 317 from the prior batch + 47 new: 3 named regressions + 44 fuzz-table cases. No pre-existing
test changed behavior — the fixes only add a fallback branch that fires exclusively in the
`preambleEmitted === false` / unterminated-fence paths that were previously broken.)

```
$ npm run typecheck
> compendio-mcp@1.2.5 typecheck
> tsc --noEmit && tsc -p tsconfig.test.json
```

(no output on either `tsc` invocation — both exit 0)

```
$ npm run build
> compendio-mcp@1.2.5 build
> tsc
```

(no output — exit 0)

```
$ git status --porcelain
 M openspec/changes/bounded-chunk-size/apply-progress.md
 M openspec/changes/bounded-chunk-size/tasks.md
?? src/domain/split-text.ts
?? test/domain/split-text.test.ts
```

Scope unchanged: only the two files this batch is allowed to touch, plus this artifact and `tasks.md`.
Phase 4 (wiring into `chunkOutline`) was NOT started.

## Deviations from Design

None new. This batch corrects an implementation defect against Decision 1/2/3 as already documented —
Decision 3 already states the preamble/wrapper is content charged against the budget and that "the
bound wins" only degrades the ONE unit that cannot fit, not the preamble's right to exist somewhere.
The fix makes the code match that stated intent; it does not change the intent.

## Issues Found

The three defects the coordinator reported, all confirmed present via the RED run above, all fixed,
all confirmed absent via the GREEN run above. One additional, smaller defect was found and fixed
DURING this same batch (the fence fix's first draft reordering `open`/`close` markers around the
content) — caught by the same coverage invariant before being reported as done, per the "verify before
declaring green" discipline this project has required since the tests-verdes-función-invisible
history.

## Status (this batch)

`splitToBound` now satisfies BOTH invariants required by the spec's own scenario wording ("every
chunk's `estimateTokens(content) <= maxTokens`, and together the chunks cover the full body") —
verified by a permanent, committed fuzz-style regression suite (11 pathological cases × 4 `maxTokens`
values), not only a hand-picked set of cascade-level examples. `npm test` 364/364, `npm run typecheck`
and `npm run build` clean. Still unwired (Phase 4 not started), per this change's ongoing scope
boundary. Ready for Phase 4 in the next batch.

---

# Work Unit 2 — Batch: Phases 4-5, Wire `splitToBound` Into `chunkOutline` + `wholeDocumentChunk`, Merge-Guard Fix (PR #2)

Scope, per this batch's brief: `tasks.md` 4.1-4.8 and 5.1-5.6 ONLY. Files touched: `src/domain/chunking.ts`
(modify), `src/application/index-pipeline.ts` (modify), `test/domain/chunking.test.ts` (modify),
`test/application/index-pipeline.test.ts` (create). `src/domain/split-text.ts` and
`test/domain/split-text.test.ts` were NOT touched (already finished, fuzz-verified in the prior batch).
`src/infrastructure/config.ts` was NOT touched — the `800` default stays unchanged until Phase 6.

## TDD Cycle Evidence

Strict TDD is active (`openspec/config.yaml`: `strict_tdd: true`, `rules.apply.tdd: true`,
`test_command: "npm test"`).

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 4.1 | `test/domain/chunking.test.ts` | Unit | 6 pre-existing tests, all still green | ✅ Deleted the stale "tables never split" test | ✅ N/A (deletion) | ➖ | ✅ Clean |
| 4.2 | same | Unit | same | ✅ Written, failed (`expected 1 to be greater than 1`) | ✅ Passed | ✅ asserts both bound AND that every piece's heading is one of the two valid paths | ✅ Clean |
| 4.3 | same | Unit | same | ✅ Written, failed (`expected 1 to be greater than 1`) | ✅ Passed | ✅ header/separator repetition asserted per-piece, not just once | ✅ Clean |
| 4.4 | same | Unit | same | ✅ Written, failed (`expected length 2, got 1` — the exact defect) | ✅ Passed | ✅ mutation-proof below re-confirms this specific test, not a coincidental pass | ✅ Clean |
| 4.5/4.6/4.7 | `src/domain/chunking.ts` | — | — | — | ✅ `flatMap` wiring + candidate-measured guard + doc comment, all in one edit pass | — | ✅ |
| 4.8 | `test/domain/chunking.test.ts` | Unit | — | — | ✅ `npx vitest run` green, 13/13 | — | — |
| 5.1 | `test/application/index-pipeline.test.ts` | Unit | N/A (new file) | ✅ Written, PASSED even pre-fix (within-bound case is unchanged behavior — see note below) | ✅ Passed | ➖ single scenario | ✅ Clean |
| 5.2 | same | Unit | N/A (new file) | ✅ Written, failed (`expected 1 to be greater than 1`) | ✅ Passed | ✅ asserts bound, coverage, uniform non-heading-derived `heading`, and sequential `position` all in one case | ✅ Clean |
| 5.3/5.4/5.5 | `src/application/index-pipeline.ts` | — | — | — | ✅ signature change + call-site wiring + comment fix, all in one edit pass | — | ✅ |
| 5.6 | `test/application/index-pipeline.test.ts` | Unit | — | — | ✅ `npx vitest run` green, 2/2 | — | — |

**Note on 5.1's RED**: task 5.1 is explicitly the "within-bound, unchanged from current behavior"
scenario (Req: `NO_CHUNKING` Suppresses Heading-Based Splitting Only). It passed on the very first run
because `wholeDocumentChunk`'s pre-fix single-chunk behavior already satisfies that case — the file
itself only became RED as a *whole* once 5.2 (the above-bound scenario) was added alongside it, and
independently the file did not even type-check against the pre-fix two-argument `wholeDocumentChunk`
signature until 5.3 landed (see the RED transcript below: `npx vitest run` on the whole file shows 1
real failure, not 2, which is the correct and expected RED for this task pairing — 5.1's own scenario
was never meant to be a regression, only 5.2's was).

### Test Summary
- **Total tests added**: 5 in `chunking.test.ts` (4.2, 4.3, 4.4, plus 4 adversarial coverage cases — see
  below) — corrected count: 3 core scenario tests (4.2/4.3/4.4) + 4 adversarial coverage tests = 7 new,
  minus 1 deleted (4.1) = net +6; 2 in `index-pipeline.test.ts` (5.1, 5.2), a new file
- **Total tests passing**: 15/15 in the two files touched this batch (13 + 2); 372/372 full suite
- **Layers used**: Unit (all)
- **Pure functions modified**: `chunkOutline`, `mergeTinyPieces` (`src/domain/chunking.ts`);
  `wholeDocumentChunk`, `transformFile`'s call site (`src/application/index-pipeline.ts`)

## RED — `test/domain/chunking.test.ts` (tasks 4.1-4.4 collectively), against the PRE-wiring code

```
$ npx vitest run test/domain/chunking.test.ts

 RUN  v4.1.10 C:/Users/Raul/Workspace/compendio-mcp

 ❯ test/domain/chunking.test.ts (13 tests | 7 failed) 21ms
     × splits an oversized H3 child section via the size cascade, and every resulting piece keeps the full 'H2 > H3' heading path 4ms
     × splits an oversized table via the size cascade, repeating the header and separator on every table piece 2ms
     × does not merge two pieces whose joined candidate exceeds maxTokens, even though each is under minTokens alone (mergeTinyPieces guard regression) 3ms
     × covers a heading-less 50 KB intro without losing any content, staying within the bound 1ms
     × covers a section that is one large unterminated fenced code block, without losing content 1ms
     × covers a section that is one large oversized markdown table, without losing content 2ms
     × covers a section that is a single unbroken 20,000-character line, without losing content 2ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 7 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/domain/chunking.test.ts > chunkOutline > splits an oversized H3 child section via the size cascade, and every resulting piece keeps the full 'H2 > H3' heading path
AssertionError: expected 1 to be greater than 1
 ❯ test/domain/chunking.test.ts:82:33

 FAIL  test/domain/chunking.test.ts > chunkOutline > splits an oversized table via the size cascade, repeating the header and separator on every table piece
AssertionError: expected 1 to be greater than 1
 ❯ test/domain/chunking.test.ts:101:27

 FAIL  test/domain/chunking.test.ts > chunkOutline > does not merge two pieces whose joined candidate exceeds maxTokens, even though each is under minTokens alone (mergeTinyPieces guard regression)
AssertionError: expected [ { heading: 'A', …(2) } ] to have a length of 2 but got 1

- Expected
+ Received

- 2
+ 1

 ❯ test/domain/chunking.test.ts:129:20

 FAIL  test/domain/chunking.test.ts > chunkOutline coverage invariant (no content may be silently dropped) > covers a heading-less 50 KB intro without losing any content, staying within the bound
AssertionError: expected 1 to be greater than 1
 ❯ test/domain/chunking.test.ts:176:27

 FAIL  test/domain/chunking.test.ts > chunkOutline coverage invariant (no content may be silently dropped) > covers a section that is one large unterminated fenced code block, without losing content
AssertionError: expected 1300 to be less than or equal to 100
 ❯ test/domain/chunking.test.ts:194:45

 FAIL  test/domain/chunking.test.ts > chunkOutline coverage invariant (no content may be silently dropped) > covers a section that is one large oversized markdown table, without losing content
AssertionError: expected 1 to be greater than 1
 ❯ test/domain/chunking.test.ts:210:27

 FAIL  test/domain/chunking.test.ts > chunkOutline coverage invariant (no content may be silently dropped) > covers a section that is a single unbroken 20,000-character line, without losing content
AssertionError: expected 1 to be greater than 1
 ❯ test/domain/chunking.test.ts:225:27

 Test Files  1 failed (1)
      Tests  7 failed | 6 passed (13)
   Start at  16:37:24
   Duration  454ms (transform 71ms, setup 0ms, import 99ms, tests 21ms, environment 0ms)
```

7 real failures against the actual pre-fix `chunkOutline`/`mergeTinyPieces` — none of them a "module
not found" or type error, all real assertion failures against running code, including task 4.4's
regression case failing with `length 2, got 1` — the exact defect Decision 4 documents: the old
summand guard (`50 + 50 <= 100`) merges the two 200-char pieces into one chunk instead of keeping them
apart. The 6 passing tests are the pre-existing suite, confirming the new test additions did not
disturb anything already covered.

## RED — `test/application/index-pipeline.test.ts` (tasks 5.1-5.2), against the PRE-wiring code

```
$ npx vitest run test/application/index-pipeline.test.ts

 RUN  v4.1.10 C:/Users/Raul/Workspace/compendio-mcp

 ❯ test/application/index-pipeline.test.ts (2 tests | 1 failed) 21ms
     × splits a NO_CHUNKING file above maxTokens via the size cascade, NOT by its internal headings 13ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/application/index-pipeline.test.ts > transformFile — NO_CHUNKING respects the size bound > splits a NO_CHUNKING file above maxTokens via the size cascade, NOT by its internal headings
AssertionError: expected 1 to be greater than 1
 ❯ test/application/index-pipeline.test.ts:89:34

 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
   Start at  16:37:48
   Duration  639ms (transform 87ms, setup 0ms, import 393ms, tests 21ms, environment 0ms)
```

1 real failure (the above-bound scenario, exactly as expected — pre-fix `wholeDocumentChunk` always
returns a single chunk regardless of size), 1 pass (the within-bound scenario, which is unchanged
behavior and correctly does not need a fix — see the TDD Cycle Evidence note above).

## The fix

**`src/domain/chunking.ts`** — Decision 1's `flatMap` wiring (every `Piece` routed through
`splitToBound(p.text, opts.maxTokens)` before `mergeTinyPieces`) and Decision 4's guard fix (measure
`estimateTokens(candidate)`, the joined string, instead of summing the two pieces' individual
estimates), plus the doc comment correction removing the now-false "tables never cut in half" /
heading-boundary-only claim (task 4.7).

**`src/application/index-pipeline.ts`** — `wholeDocumentChunk(title, body)` becomes
`wholeDocumentChunk(title, body, maxTokens)`, routing `content` through `splitToBound` and mapping each
returned piece to a `Chunk` with its own `position`; `transformFile`'s call site passes
`options.chunking.maxTokens`; the `PipelineOptions.noChunking` doc comment is corrected to describe
"split by size only, never by internal headings" instead of the old "indexed as a single chunk" claim.

Full diff (both files, exactly as committed):

```diff
diff --git a/src/application/index-pipeline.ts b/src/application/index-pipeline.ts
index 9efb5a6..da1c8d5 100644
--- a/src/application/index-pipeline.ts
+++ b/src/application/index-pipeline.ts
@@ -3,11 +3,15 @@ import { chunkOutline, type ChunkingOptions } from "../domain/chunking.js";
 import type { ConventionPolicy } from "../domain/convention.js";
 import type { Chunk, DocumentMeta } from "../domain/model.js";
 import type { DocumentFile, MarkdownParser } from "../domain/ports.js";
+import { splitToBound } from "../domain/split-text.js";
 
 export interface PipelineOptions {
   chunking: ChunkingOptions;
-  /** File names (relative path or basename) indexed as a single chunk,
-   * without heading-based chunking. The glossary is the canonical case. */
+  /** File names (relative path or basename) exempt from heading-based
+   * chunking -- split by size only, via `splitToBound`, never by internal
+   * headings. Still emits a single chunk when the body fits within
+   * `maxTokens`; splits into several bounded chunks otherwise. The glossary
+   * is the canonical case. */
   noChunking: string[];
 }
 
@@ -69,7 +73,7 @@ export function transformFile(
   }
 
   const chunks = isNoChunking(file.path, options.noChunking)
-    ? wholeDocumentChunk(resolution.meta.title, parsed.body)
+    ? wholeDocumentChunk(resolution.meta.title, parsed.body, options.chunking.maxTokens)
     : chunkOutline(parsed.outline, options.chunking);
 
   if (chunks.length === 0) {
@@ -84,8 +88,12 @@ function isNoChunking(path: string, noChunking: string[]): boolean {
   return noChunking.some((entry) => entry === path || entry === basename);
 }
 
-function wholeDocumentChunk(title: string, body: string): Chunk[] {
+function wholeDocumentChunk(title: string, body: string, maxTokens: number): Chunk[] {
   const content = body.trim();
   if (content.length === 0) return [];
-  return [{ heading: title, content, position: 0 }];
+  return splitToBound(content, maxTokens).map((text, position) => ({
+    heading: title,
+    content: text,
+    position,
+  }));
 }
diff --git a/src/domain/chunking.ts b/src/domain/chunking.ts
index ca8c353..e094a51 100644
--- a/src/domain/chunking.ts
+++ b/src/domain/chunking.ts
@@ -1,5 +1,6 @@
 import type { Chunk } from "./model.js";
 import type { DocOutline, DocSection } from "./outline.js";
+import { splitToBound } from "./split-text.js";
 import { estimateTokens } from "./tokens.js";
 
 export interface ChunkingOptions {
@@ -19,11 +20,15 @@ function sectionFullText(section: DocSection): string {
 
 /**
  * Chunking policy: split by H2, descend to H3 only when the H2 section
- * exceeds `maxTokens`, then merge contiguous tiny pieces (< minTokens).
+ * exceeds `maxTokens`, then bound every resulting piece via `splitToBound`
+ * before merging contiguous tiny pieces (< minTokens).
  *
- * Splitting only ever happens at heading boundaries, so tables are never cut
- * in half: a section holding a large table stays whole even if it exceeds the
- * maximum. Every chunk carries its full heading path ("H2 > H3").
+ * Heading-based descent decides WHERE the coarse cuts land; `splitToBound`
+ * guarantees the SIZE bound afterward, on every piece regardless of source
+ * (intro, leaf section, or oversized child) -- a table or fenced code block
+ * is split across rows/lines, re-wrapping its header/separator or fence
+ * markers, rather than staying whole past `maxTokens`. Every chunk carries
+ * its full heading path ("H2 > H3"), including split pieces.
  */
 export function chunkOutline(outline: DocOutline, opts: ChunkingOptions): Chunk[] {
   const pieces: Piece[] = [];
@@ -46,7 +51,11 @@ export function chunkOutline(outline: DocOutline, opts: ChunkingOptions): Chunk[
     }
   }
 
-  return mergeTinyPieces(pieces, opts).map((piece, position) => ({
+  const bounded = pieces.flatMap((p) =>
+    splitToBound(p.text, opts.maxTokens).map((text) => ({ path: p.path, text })),
+  );
+
+  return mergeTinyPieces(bounded, opts).map((piece, position) => ({
     heading: piece.path.join(" > "),
     content: piece.text,
     position,
@@ -58,21 +67,27 @@ export function chunkOutline(outline: DocOutline, opts: ChunkingOptions): Chunk[
  * combination stays within `maxTokens`. The merged chunk keeps the first
  * heading path; the swallowed section keeps its heading line inside the text,
  * so lexical search still matches it.
+ *
+ * The guard measures the CANDIDATE joined string, not the sum of the two
+ * pieces' individual token estimates: `estimateTokens` is `ceil(len / 4)`,
+ * and the merge itself adds two characters (`\n\n`), so `ceil(la/4) +
+ * ceil(lb/4)` can be strictly less than `ceil((la + lb + 2) / 4)` -- summing
+ * the estimates could pass the guard while the actual merged text lands one
+ * token over `maxTokens`.
  */
 function mergeTinyPieces(pieces: Piece[], opts: ChunkingOptions): Piece[] {
   const merged: Piece[] = [];
   for (const piece of pieces) {
     const previous = merged[merged.length - 1];
     const tokens = estimateTokens(piece.text);
-    if (
-      previous !== undefined &&
-      tokens < opts.minTokens &&
-      estimateTokens(previous.text) + tokens <= opts.maxTokens
-    ) {
-      previous.text = `${previous.text}\n\n${piece.text}`;
-    } else {
-      merged.push({ ...piece });
+    if (previous !== undefined && tokens < opts.minTokens) {
+      const candidate = `${previous.text}\n\n${piece.text}`;
+      if (estimateTokens(candidate) <= opts.maxTokens) {
+        previous.text = candidate;
+        continue;
+      }
     }
+    merged.push({ ...piece });
   }
   return merged;
 }
```

## GREEN

```
$ npx vitest run test/domain/chunking.test.ts test/application/index-pipeline.test.ts

 RUN  v4.1.10 C:/Users/Raul/Workspace/compendio-mcp

 Test Files  2 passed (2)
      Tests  15 passed (15)
   Start at  16:38:32
   Duration  629ms (transform 180ms, setup 0ms, import 458ms, tests 293ms, environment 1ms)
```

15/15 — 13 in `chunking.test.ts` (6 pre-existing + 7 new, minus 0 net since the deletion is folded into
the "new" count already), 2 in `index-pipeline.test.ts` (both new).

## Verify the verifier — mutation proof for the `mergeTinyPieces` guard fix (MANDATORY)

Per instruction, before trusting the GREEN run, temporarily reintroduced the exact pre-fix summand
guard into the committed file:

```diff
   for (const piece of pieces) {
     const previous = merged[merged.length - 1];
     const tokens = estimateTokens(piece.text);
+    // TEMPORARY PERTURBATION -- reintroduces the pre-fix summand guard to
+    // prove the regression test can fail. Reverted immediately after
+    // capturing the RED run; see apply-progress.md "Verify the verifier".
     if (
       previous !== undefined &&
       tokens < opts.minTokens &&
       estimateTokens(previous.text) + tokens <= opts.maxTokens
     ) {
       previous.text = `${previous.text}\n\n${piece.text}`;
     } else {
       merged.push({ ...piece });
     }
   }
```

Ran with the perturbation in place:

```
$ npx vitest run test/domain/chunking.test.ts

 RUN  v4.1.10 C:/Users/Raul/Workspace/compendio-mcp

 ❯ test/domain/chunking.test.ts (13 tests | 1 failed) 266ms
     × does not merge two pieces whose joined candidate exceeds maxTokens, even though each is under minTokens alone (mergeTinyPieces guard regression) 10ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/domain/chunking.test.ts > chunkOutline > does not merge two pieces whose joined candidate exceeds maxTokens, even though each is under minTokens alone (mergeTinyPieces guard regression)
AssertionError: expected [ { heading: 'A', …(2) } ] to have a length of 2 but got 1

- Expected
+ Received

- 2
+ 1

 ❯ test/domain/chunking.test.ts:129:20

 Test Files  1 failed (1)
      Tests  1 failed | 12 passed (13)
   Start at  16:39:02
   Duration  569ms (transform 66ms, setup 0ms, import 94ms, tests 266ms, environment 0ms)
```

Exactly one failure — the regression test itself, nothing else. This confirms the test is not a
tautology: with the old guard, the two 200-char pieces merge into one 101-token chunk (over the
bound), and only the dedicated regression test catches it — every other test (including the coverage
and table tests, which do not happen to exercise this exact `50+50=100` boundary condition) stays
green, which is itself useful evidence that the perturbation is narrowly scoped to the merge guard
and not a broader breakage.

Reverted immediately:

```
$ grep -n "TEMPORARY PERTURBATION" src/domain/chunking.ts; echo "grep exit: $?"

grep exit: 1

$ npx vitest run test/domain/chunking.test.ts test/application/index-pipeline.test.ts

 RUN  v4.1.10 C:/Users/Raul/Workspace/compendio-mcp

 Test Files  2 passed (2)
      Tests  15 passed (15)
   Start at  16:39:17
   Duration  598ms (transform 165ms, setup 0ms, import 433ms, tests 292ms, environment 0ms)
```

`grep` found no match (exit 1, meaning "not found") — the perturbation left no trace in the committed
file — and both files are green again, byte-identical to the original GREEN run (15/15).

## Full Suite / Typecheck / Build (this batch's gate)

```
$ npm test
> compendio-mcp@1.2.5 test
> vitest run

 RUN  v4.1.10 C:/Users/Raul/Workspace/compendio-mcp

 Test Files  31 passed (31)
      Tests  372 passed (372)
   Start at  16:39:24
   Duration  12.06s (transform 5.88s, setup 0ms, import 21.58s, tests 17.86s, environment 12ms)
```

(372 = 364 from the prior batch + 8: chunking.test.ts nets +6 [3 core scenario tests (4.2-4.4) + 4
adversarial coverage tests - 1 deleted table test], index-pipeline.test.ts is a new file with +2.
364 + 6 + 2 = 372, exactly matching. No pre-existing test changed behavior.)

```
$ npm run typecheck
> compendio-mcp@1.2.5 typecheck
> tsc --noEmit && tsc -p tsconfig.test.json
```

(no output on either `tsc` invocation — both exit 0)

```
$ npm run build
> compendio-mcp@1.2.5 build
> tsc
```

(no output — exit 0)

```
$ git status --porcelain
 M openspec/changes/bounded-chunk-size/apply-progress.md
 M openspec/changes/bounded-chunk-size/tasks.md
 M src/application/index-pipeline.ts
 M src/domain/chunking.ts
 M test/domain/chunking.test.ts
?? src/domain/split-text.ts
?? test/application/index-pipeline.test.ts
?? test/domain/split-text.test.ts
```

Exactly the files this batch was allowed to touch, plus this artifact and `tasks.md`. `split-text.ts`
and `split-text.test.ts` are untouched carryover from the prior batch (still untracked, unchanged).
`src/infrastructure/config.ts` was NOT touched — confirmed absent from `git status`. No commit was
made, per instruction.

## Adversarial coverage assertions added this batch — what they cover

Per the orchestrator's explicit "carry forward the lesson" instruction (the prior batch's `splitToBound`
shipped 9/9 green with a passing mutation proof and still destroyed content in 27/306 fuzzed cases,
caught only by external fuzzing), this batch does not stop at asserting the bound at the
`chunkOutline`/`transformFile` level — it asserts coverage too, using the same code-point-safe
subsequence check (`nonWhitespace` + `isSubsequence` + `expectCoverage`, duplicated locally in each
test file rather than extracted to a shared helper, since a new shared helper file was outside this
batch's allowed file list; mirrors `test/domain/split-text.test.ts`'s own local copy):

**At the `chunkOutline` level** (`test/domain/chunking.test.ts`, new `describe` block):
1. A heading-less ~50 000-char intro (no H2 sections at all) — exercises the `outline.intro` path,
   the one `chunkOutline` path with no section/heading structure whatsoever.
2. A section whose entire content is one large **unterminated** fenced code block — the exact defect
   family the prior batch's coordinator-reported fuzzing caught in `splitToBound` itself; this test
   proves the fix holds through the full `chunkOutline` call path, not just `splitToBound` in
   isolation.
3. A section that is one large oversized markdown table (200 rows) — proves header/separator
   re-emission doesn't just look right per-piece (as 4.3 checks) but that literally none of the 200
   rows' cell content is lost across the whole split.
4. A section that is a single unbroken 20 000-character line — the code-point-splitting terminal
   level, exercised through the full heading-aware pipeline rather than `splitToBound` alone.

**At the `transformFile` level** (`test/application/index-pipeline.test.ts`, task 5.2's own test,
extended): the `NO_CHUNKING`-above-bound-with-internal-headings scenario itself carries the
coverage assertion (`expectCoverage` on all emitted chunk contents against the full source), covering
the fifth named hostile input from the brief. This is the one case that exercises the *other*
production call site (`wholeDocumentChunk`), not `chunkOutline`, so the coverage guarantee is checked
independently on both paths that call `splitToBound`, not assumed to transfer from one to the other.

All 5 named hostile inputs from the brief are covered: heading-less 50 KB body (1), unterminated fence
(2), oversized table (3), unbroken 20 000-char line (4), `NO_CHUNKING` above-bound with internal `##`
headings (5). Every one of these tests passed on the FIRST implementation attempt (no additional
defects found this batch, unlike the prior batch's coordinator-reported fuzzing round) — expected,
since `splitToBound` itself already carries its own fuzz-verified coverage guarantee from the prior
batch; these tests confirm that guarantee actually reaches callers through the wiring this batch adds,
which is a distinct claim from "the primitive is correct in isolation."

This is NOT a substitute for Phase 7's own cross-cutting invariant tasks (7.1/7.2), which the tasks
artifact still lists as pending — Phase 7 is expected to build a broader, more systematic fuzz-style
suite (mirroring `split-text.test.ts`'s 11-case × 4-`maxTokens` table) at the `chunkOutline` and
`index-pipeline` levels. This batch's adversarial tests are the specific inputs the brief named, added
now per explicit instruction, not a claim that Phase 7 is already complete.

## Deviations from Design

None. Decision 1's `flatMap` wiring and `wholeDocumentChunk` signature match design.md's code sketches
exactly (including the `.map((text) => ({ path: p.path, text }))` shape). Decision 4's guard fix matches
the design snippet's intent (measure the candidate) with one cosmetic difference: the design's snippet
uses a single combined `if` condition; the implementation uses a nested `if` with `continue` to avoid
constructing `candidate` when `tokens >= opts.minTokens` (a piece that isn't tiny never needs the
candidate string built at all) — same behavior, one fewer string allocation on the common path, not a
behavioral deviation.

## Issues Found

None. All 8 RED tests failed for the correct, on-topic reason (7 in `chunking.test.ts`, 1 in
`index-pipeline.test.ts`); all 15 passed on the first GREEN implementation attempt; the mutation proof
produced exactly one on-topic failure (not a crash, not an unrelated cascade of failures) when the
merge guard was deliberately reverted to its buggy form; the perturbation was fully reverted and
confirmed absent before this record was written.

## Remaining Tasks (Work Unit 2, this change)

- [x] 2.1–2.9 `splitToBound` cascade tests (RED) — prior batch
- [x] 3.1–3.3 `splitToBound` implementation (GREEN) — prior batch
- [x] 4.1–4.8 Wire into `chunkOutline` + merge-guard fix — this batch
- [x] 5.1–5.6 Wire into `wholeDocumentChunk` / `NO_CHUNKING` — this batch
- [ ] 6.1–6.5 Default `480`, comments, test-harness drift
- [ ] 7.1–7.2 Cross-cutting bound invariant
- [ ] 8.1–8.2 Integration regression + full suite
- [ ] 9.1–9.7 Manual Gates 1 / 1b-after / 2 + docs
- [ ] 10.1–10.3 Final gate

## Workload / PR Boundary (this batch)

- Mode: chained PR slice (`stacked-to-main`), `size:exception` accepted for PR #2 as a whole per the
  tasks artifact's Review Workload Forecast (PR #2 stays one work unit; this batch is an internal
  slice of it, not a separate PR)
- Current work unit: Work Unit 2 — Splitter, Wiring, Default, Docs (PR #2, base `main` post PR #1)
- Boundary: this batch starts from the prior batch's tree (`splitToBound` implemented but unwired) and
  ends with both production call sites (`chunkOutline`, `wholeDocumentChunk`) routing through it, and
  the `mergeTinyPieces` off-by-one fixed. The `480` default (Phase 6), the cross-cutting fuzz-style
  invariant suite (Phase 7), integration regression at the new default (Phase 8), and the manual gates
  (Phase 9) are explicitly NOT started, per this batch's stop instruction.
- Estimated review budget impact: this slice's net diff is small in `src/` (two focused, well-commented
  changes) but test-heavy in `test/` (new coverage-invariant assertions per the brief); still within
  the `size:exception` already recorded for PR #2 as a whole.

## Status (this batch)

14/14 tasks assigned to this batch complete (4.1–4.8 = 8 tasks, 5.1–5.6 = 6 tasks; all ticked `[x]` in
`tasks.md`). `npm test` 372/372, `npm run typecheck` and
`npm run build` both clean. Both `chunkOutline` and `wholeDocumentChunk` now route through
`splitToBound`, and `mergeTinyPieces` can no longer re-create an over-bound chunk after a merge. RED
was observed and pasted for every new/changed test before implementation, confirmed via the module
still failing for the correct reason; GREEN was observed after implementation; the merge-guard fix was
additionally proven load-bearing via a mutation proof (revert-and-fail, then restore-and-pass). Ready
for the next Work Unit 2 batch (Phase 6: the `480` default, remaining doc-comment corrections, and the
test-harness drift fix in `test/helpers/build.ts` / `test/application/index-progress.test.ts`) — NOT
started here, per this batch's explicit stop instruction.

---

# Work Unit 2 — Batch: Phases 6-8, Default `480`, Test-Harness Drift, Cross-Cutting Invariant, Integration Regression (PR #2)

Scope, per this batch's brief: `tasks.md` 6.1-6.5, 7.1-7.2, 8.1-8.2 ONLY. Files touched:
`src/infrastructure/config.ts` (modify — `480` default + `NO_CHUNKING` comment),
`src/application/index-documents.ts` (modify — comment only), `test/helpers/build.ts` (modify —
`DEFAULT_CONFIG.chunk`/`NO_CHUNKING` imports), `test/application/index-progress.test.ts` (modify —
same fix over the `ejemplos/`-sized case only), `test/domain/chunking.test.ts` (modify — 2 new
adversarial invariant cases), `test/application/index-pipeline.test.ts` (modify — 1 new adversarial
invariant case), `test/application/read-document.test.ts` (modify — 1 new integration test closing a
gap identified while verifying task 8.1's third criterion). `src/domain/split-text.ts` was **not**
touched, per instruction. Phase 9 (manual gates, docs) and Phase 10 (final gate) were **not** started.

## Phase 6 — Default `480`, Comments, Test-Harness Drift

### 6.1 / 6.2 — `DEFAULT_CONFIG.chunk.maxTokens` `800 → 480`, doc comments corrected

```diff
--- a/src/infrastructure/config.ts
+++ b/src/infrastructure/config.ts
@@
-/** Files indexed as a single chunk (no heading-based chunking). */
+/**
+ * File names (relative path or basename) exempt from heading-based
+ * chunking -- split by size only, via `splitToBound`, never by internal
+ * headings. Still emits a single chunk when the body fits within
+ * `maxTokens`; splits into several bounded chunks otherwise.
+ */
 // es-frozen: filename in the Spanish `ejemplos/` reference corpus; translating
 // it would change the corpus chunk count and move the eval baseline.
 export const NO_CHUNKING = ["glosario.md"];
@@
-  chunk: { minTokens: 100, maxTokens: 800 },
+  chunk: { minTokens: 100, maxTokens: 480 },
```

`src/application/index-documents.ts`'s `IndexDocumentsOptions.noChunking` doc comment corrected to the
same wording (task 6.2) — comment only, no behavior change, mirroring the fix design.md's File Changes
table already applied to `PipelineOptions.noChunking` in the prior batch.

### 6.3 / 6.4 — test-harness drift fix

`test/helpers/build.ts:75` and `test/application/index-progress.test.ts:24` both hardcoded
`{ minTokens: 100, maxTokens: 800 }` under a comment claiming it mirrors production. Both now import
`DEFAULT_CONFIG`/`NO_CHUNKING` from `../../src/infrastructure/config` and pass `DEFAULT_CONFIG.chunk` /
`NO_CHUNKING` directly, so the harness can never silently drift from the real default again. Per
instruction, the synthetic cases at `index-progress.test.ts:134`/`:158` (`{ minTokens: 10, maxTokens:
800 }`, sized against their own small fixed-file corpora, unrelated to the production default) were
left untouched — confirmed by reading them before editing (see below).

### 6.5 — confirmed no change needed elsewhere

Read `test/application/index-and-search.test.ts:292` (`buildIndexer`: `{ minTokens: 10, maxTokens: 800
}`, a `StaticSource`-based synthetic corpus sized to its own tests) and `:544` (the embedded
`SyncIndex` e2e block: same explicit pair, real disk temp dir, synthetic content) and
`test/application/sync-index.test.ts:34` (`const OPTIONS = { chunking: { minTokens: 10, maxTokens: 800
}, noChunking: [] };`, shared across that whole file's synthetic `MutableSource` corpora) — all three
are explicit, self-contained options unrelated to `DEFAULT_CONFIG`, exactly as design.md's File Changes
table states. No edit made. Confirmed, not assumed, by running the whole suite after 6.1-6.4 landed
(see Full Suite below): both files stayed green with zero changes.

### Measured: no test assertion had to change

Contrary to this batch's brief ("Phase 6 is where the suite is most likely to go red... expect
breakage there"), running the full suite immediately after 6.1-6.4 landed found **zero** failures:

```
$ npm test
> compendio-mcp@1.2.5 test
> vitest run


 RUN  v4.1.10 C:/Users/Raul/Workspace/compendio-mcp


 Test Files  31 passed (31)
      Tests  372 passed (372)
   Start at  16:48:26
   Duration  7.87s (transform 3.49s, setup 0ms, import 12.54s, tests 12.03s, environment 5ms)
```

Investigated why, rather than accepting the pass silently: no test in this repo hardcodes a total
chunk count for the `ejemplos/` corpus (`grep`-verified against `toHaveLength`/`toBe` patterns near
`chunks`/`totalChunks` across `test/`) — the closest matches are `report.indexed.map((d) =>
d.path)`/`report.indexed).toHaveLength(5)` (document counts, not chunk counts) and
`glosario?.chunks).toBe(1)` (glosario.md specifically, which stays 1 chunk at 480 exactly as it did at
800 — measured below). `test/application/evaluate.test.ts`'s 3-case goldenset (`FakeEmbeddings`, hybrid
recall@5 = 1, lexical recall@5 = 2/3) also held unchanged at the new default. **No assertion was
loosened, rewritten, or deleted to make this pass** — the suite was simply never coupled to the exact
`ejemplos/` chunk count in the first place.

### Measured `ejemplos/` chunk count: BEFORE (800) vs AFTER (480)

Per the evidence-discipline instruction, measured directly rather than assumed, using a small scratch
script (`node --input-type=module -e "..."`, not committed) that runs the real `IndexDocuments` over
`ejemplos/docs` with lexical-only mode (`embeddings: null`, so no model download) at each `maxTokens`
value, toggling `src/infrastructure/config.ts` and rebuilding between runs (git-diffed and restored to
`480` immediately after; confirmed via `git diff --stat src/infrastructure/config.ts` showing only the
intended final `480` change):

```
BEFORE (maxTokens=800) totalChunks=27 indexedDocs=11 skipped=0
glosario.md chunks=1

AFTER  (maxTokens=480) totalChunks=29 indexedDocs=11 skipped=0
glosario.md chunks=1
```

**27 → 29 chunks** (matches task 9.2's own note, "was 27 at 800", exactly). `glosario.md` stays exactly
1 chunk at both values (~290 tokens, well under both 800 and 480), matching `CLAUDE.md`'s documented
gate. Per-document breakdown (BEFORE → AFTER, chunks per indexed document):

| Document | 800 | 480 | Changed? |
|---|---|---|---|
| `glosario.md` | 1 | 1 | No |
| `informes/panel-metricas.md` | 2 | 2 | No |
| `informes/plan-pruebas.md` | 1 | 1 | No |
| `leadsviewer/alta-leads.md` | 3 | 3 | No |
| `leadsviewer/importacion-csv.md` | 5 | 5 | No |
| `leadsviewer/plan-pruebas-validacion.md` | 2 | 2 | No |
| `leadsviewer/validacion-formulario.md` | **4** | **6** | **Yes, +2** |
| `transversal/adr-0001-eleccion-mongodb.md` | 1 | 1 | No |
| `transversal/adr-0003-autenticacion-sso.md` | 2 | 2 | No |
| `transversal/adr-0007-eleccion-base-datos.md` | 4 | 4 | No |
| `transversal/despliegue.md` | 2 | 2 | No |

Only `leadsviewer/validacion-formulario.md` moved. Investigated whether the +2 came from
`splitToBound` actually dividing one section (a genuine size-cascade split) or from
`mergeTinyPieces`' narrower headroom (Decision 4: 700 → 380 tokens) simply merging fewer tiny
sections together — these are different mechanisms and the design predicts the second, not the first,
for a corpus this small. Read the chunk headings directly (`store.getChunksByDocument`, ordered by
position) at 480:

```
0 "Validación del formulario de alta de leads"          275 chars
1 "Contexto y objetivo"                                  681 chars
2 "Reglas de negocio > Campos y validaciones"             878 chars
3 "Reglas de negocio > Reglas de duplicidad"               967 chars
4 "Reglas de negocio > Mensajes de error"                  685 chars
5 "Casos de uso"                                          1186 chars
```

Six **distinct** headings, none repeated — confirms **no section in `ejemplos/` is individually large
enough to be divided by `splitToBound` at 480**; the two extra chunks are three H3 children
(`Campos y validaciones`/`Reglas de duplicidad`/`Mensajes de error`) that used to merge into fewer
combined chunks at the wider 700-token merge headroom and no longer do at 380 — exactly Decision 4's
documented, accepted consequence ("chunk count rises slightly above Gate 2's estimate. Observed, not
acted on"), not a new code path being exercised. This finding directly shapes the Phase 8 gap closed
below.

## Phase 7 — Cross-Cutting Bound Invariant

Read `test/domain/chunking.test.ts` and `test/application/index-pipeline.test.ts` first, per
instruction, before writing anything. Of the five named hostile inputs in task 7.1 (heading-less 50 KB
body, one 50 KB paragraph, one unbroken line, a 60-row table, a fenced block), three were already
covered by the prior Phase 4/5 batch's adversarial suite (heading-less 50 KB intro; a single unbroken
20,000-char line; a 200-row oversized table, a superset of "60-row"). Two genuine gaps closed:

1. **"One 50 KB paragraph"** — distinct from the existing heading-less-intro test (which is
   sentence-punctuated, so it exercises sentence-level splitting) and the existing unbroken-line test
   (zero whitespace, falls straight to code points). A single ~50,000-char block with **no sentence
   punctuation at all** (`word0 word1 word2 ...`) forces the cascade through block → line → sentence
   (no boundary found) → **word-level** packing specifically, which nothing at the `chunkOutline`
   level previously exercised.
2. **"A fenced block"** — the existing test only covers an **unterminated** fence (the coordinator's
   coverage-invariant defect-regression case from the prior batch). A genuine, **well-formed
   (terminated)** oversized fence, with a blank line inside its body that must not be treated as a
   block boundary, was not yet exercised through the full `chunkOutline` path (only at the
   `splitToBound`-unit level, task 2.8).

Task 7.2 ("same invariant for a `NO_CHUNKING` body above the bound") is *structurally* already
satisfied by the prior batch's task 5.2 test (bound + coverage over a `NO_CHUNKING` body with internal
headings and paragraphs). Closed one additional gap there too: that existing test never exercises
table/fence structure flowing through `wholeDocumentChunk`'s `splitToBound` call — a NO_CHUNKING body
combining a 60-row table, a fenced block, and an unbroken (no-punctuation) paragraph, added as a
distinct scenario from the headings+paragraphs case already covered.

### RED — proof these tests are not tautological (production code temporarily perturbed, then reverted)

Per this project's "verify the verifier" discipline, before trusting any GREEN, disabled the size
bound in each of the two production functions these tests exercise and re-ran, confirming a real,
on-topic failure — then reverted immediately and confirmed the revert left no trace.

**`chunkOutline`** (`src/domain/chunking.ts`) — temporarily replaced the `flatMap` through
`splitToBound` with a no-op passthrough:

```diff
-  const bounded = pieces.flatMap((p) =>
-    splitToBound(p.text, opts.maxTokens).map((text) => ({ path: p.path, text })),
-  );
+  // TEMPORARY PERTURBATION -- disables the size bound to prove Phase 7's new
+  // invariant tests can fail. Reverted immediately after capturing the RED
+  // run; see apply-progress.md "Verify the verifier" section (Phase 7).
+  const bounded = pieces.map((p) => ({ path: p.path, text: p.text }));
+  void splitToBound;
```

```
$ npx vitest run test/domain/chunking.test.ts

 Test Files  1 failed (1)
      Tests  8 failed | 7 passed (15)
```

All 8 failures are real assertion failures (`expected 1 to be greater than 1` / `expected 1300 to be
less than or equal to 100`), spanning both the two NEW tests added this batch and 6 pre-existing
adversarial tests from the prior batch — confirming the whole suite, not just the new additions,
genuinely depends on the wiring rather than being tautological. Reverted:

```
$ grep -n "TEMPORARY PERTURBATION" src/domain/chunking.ts; echo "grep exit: $?"
grep exit: 1

$ npx vitest run test/domain/chunking.test.ts

 Test Files  1 passed (1)
      Tests  15 passed (15)
```

**`wholeDocumentChunk`** (`src/application/index-pipeline.ts`) — temporarily reverted to its pre-Phase-5
single-chunk behavior:

```diff
 function wholeDocumentChunk(title: string, body: string, maxTokens: number): Chunk[] {
   const content = body.trim();
   if (content.length === 0) return [];
-  return splitToBound(content, maxTokens).map((text, position) => ({
-    heading: title,
-    content: text,
-    position,
-  }));
+  // TEMPORARY PERTURBATION -- disables the size bound to prove Phase 7.2's
+  // new invariant test can fail. Reverted immediately after capturing the
+  // RED run; see apply-progress.md "Verify the verifier" section (Phase 7).
+  void splitToBound;
+  void maxTokens;
+  return [{ heading: title, content, position: 0 }];
 }
```

```
$ npx vitest run test/application/index-pipeline.test.ts

 Test Files  1 failed (1)
      Tests  2 failed | 1 passed (3)
```

Both the prior batch's task 5.2 test AND this batch's new combined table/fence/paragraph test fail
(`expected 1 to be greater than 1`, on the `result.chunks.length` bound check both share) — the one
passing test is task 5.1's within-bound scenario, correctly unaffected since it never needed splitting
in the first place. Reverted:

```
$ grep -n "TEMPORARY PERTURBATION" src/application/index-pipeline.ts; echo "grep exit: $?"
grep exit: 1

$ npx vitest run test/application/index-pipeline.test.ts

 Test Files  1 passed (1)
      Tests  3 passed (3)
```

## Phase 8 — Integration Regression

### 8.1 — ran the existing integration suite at 480; found and closed a real gap

`test/application/index-and-search.test.ts` and `test/application/read-document.test.ts` both stayed
green at the new default (46/46 combined, ran together):

```
$ npx vitest run test/application/index-and-search.test.ts test/application/read-document.test.ts

 Test Files  2 passed (2)
      Tests  46 passed (46)
```

Two of the task's three named facts are directly confirmed: **`ejemplos/` indexes clean** (`"indexes
every valid document except INDEX.md, in hybrid mode"`: `report.skipped` is `[]`) and **`glosario.md`
stays exactly 1 chunk** (`"indexes the glossary as a single chunk"`: measured above, unchanged at both
800 and 480).

The third fact — **`read_doc({ section })` returns a split section whole and in order** — could
**not** be exercised against the real `ejemplos/` corpus: Phase 6's investigation above already
established that no `ejemplos/` section is individually large enough to be divided by `splitToBound`
at 480 (the corpus's only chunk-count change is a `mergeTinyPieces`-headroom effect, not a split).
Checked whether an existing test anywhere already covered this end-to-end (`grep`-searched for
"ReadDocument"/"split section"/"whole and in order" across `test/`) — found none: `ReadDocument`'s own
test file only exercises single-chunk sections, and `read-document.ts`'s
`matching.map((c) => c.content).join("\n\n")` line (unchanged by this whole feature) had never been
exercised against a section actually split by `splitToBound` through the real
`IndexDocuments` → `SqliteIndexStore` → `ReadDocument` pipeline — only at the `chunkOutline`-unit level
(prior batch's heading-path test) in isolation.

Design.md calls this exact mechanism "load-bearing, verified" (Decision 3), so closed the gap with one
new integration test in `test/application/read-document.test.ts`: a synthetic document (temp dir,
real `FileDocumentSource`/`IndexDocuments`/`SqliteIndexStore`, `DEFAULT_CONFIG.chunk` — the real
production default) with one H2 section built from 120 numbered sentences (~10,200 chars, well over
480 tokens), asserting (a) the section really was divided into more than one chunk sharing the same
heading, (b) `read.execute({ section })` returns content containing both the first and last sentence,
and (c) the first sentence's text precedes the last sentence's text in the reassembled string (order,
not just presence).

```
$ npx vitest run test/application/read-document.test.ts

 Test Files  1 passed (1)
      Tests  13 passed (13)
```

**Mutation proof** — temporarily made `ReadDocument.execute` return only the first matching chunk
instead of joining all of them:

```diff
     return {
       type: "section",
       meta: doc,
       section: request.section,
-      content: matching.map((c) => c.content).join("\n\n"),
+      content: matching[0]!.content,
     };
```

```
$ npx vitest run test/application/read-document.test.ts

 Test Files  1 failed (1)
      Tests  1 failed | 12 passed (13)

 FAIL  ... > reassembles a section that splitToBound divided into multiple same-heading chunks, in position order
AssertionError: expected '## Sección extensa' to contain 'Oración número 0 '
```

Real, informative failure: `matching[0]` turned out to be the section's **heading line alone**
(`splitToBound`'s block-level cascade treats the blank line between `## Sección extensa` and the body
as a block boundary, so the heading becomes its own tiny first piece of the split section) — confirming
the join really is necessary and the test is not a false positive. Reverted:

```
$ grep -n "TEMPORARY PERTURBATION" src/application/read-document.ts; echo "grep exit: $?"
grep exit: 1

$ npx vitest run test/application/read-document.test.ts

 Test Files  1 passed (1)
      Tests  13 passed (13)
```

### 8.2 — full suite, typecheck, build

```
$ npm test
> compendio-mcp@1.2.5 test
> vitest run


 RUN  v4.1.10 C:/Users/Raul/Workspace/compendio-mcp


 Test Files  31 passed (31)
      Tests  376 passed (376)
   Start at  16:57:46
   Duration  8.41s (transform 3.70s, setup 0ms, import 13.36s, tests 12.15s, environment 6ms)
```

(376 = 372 from the prior batch + 4 new: 2 in `chunking.test.ts` [7.1], 1 in
`index-pipeline.test.ts` [7.2], 1 in `read-document.test.ts` [the 8.1 gap]. No pre-existing test
changed behavior or was loosened.)

```
$ npm run typecheck
> compendio-mcp@1.2.5 typecheck
> tsc --noEmit && tsc -p tsconfig.test.json
```

(no output on either `tsc` invocation — both exit 0)

```
$ npm run build
> compendio-mcp@1.2.5 build
> tsc
```

(no output — exit 0)

```
$ git status --porcelain
 M openspec/changes/bounded-chunk-size/apply-progress.md
 M openspec/changes/bounded-chunk-size/tasks.md
 M src/application/index-documents.ts
 M src/application/index-pipeline.ts
 M src/domain/chunking.ts
 M src/infrastructure/config.ts
 M test/application/index-progress.test.ts
 M test/application/read-document.test.ts
 M test/domain/chunking.test.ts
 M test/helpers/build.ts
?? src/domain/split-text.ts
?? test/application/index-pipeline.test.ts
?? test/domain/split-text.test.ts
```

`src/application/index-pipeline.ts` and `src/domain/chunking.ts` show modified from the **prior**
Phase 4/5 batch, not this one — `git diff` against them shows no `TEMPORARY PERTURBATION` string and
no unexpected hunks beyond that prior batch's committed-pending changes (confirmed via `grep -n
"TEMPORARY PERTURBATION"` returning exit 1 on both, and `git diff src/domain/chunking.ts
src/application/index-pipeline.ts src/application/read-document.ts` showing zero matches). No commit
was made, per instruction.

## Deviations from Design

None. Task 6.1/6.2's comment wording mirrors the wording design.md's File Changes table already
specifies for `PipelineOptions.noChunking` (applied in the Phase 4/5 batch), extended verbatim to the
two remaining doc comments the design names. Phase 7/8's new tests are additive test coverage, not
production-code changes, and target exactly the scenarios the design's Testing Strategy table and this
batch's brief name; the read-document.test.ts addition targets a scenario the design explicitly calls
"load-bearing, verified" (Decision 3) that had no automated coverage anywhere in the suite before this
batch.

## Issues Found

**Finding, not a defect**: the brief predicted Phase 6 was "where the suite is most likely to go
red" and instructed re-measuring `ejemplos/` assertions "honestly" if they moved. Investigated and
found the opposite: zero test assertions needed any change, because no existing test hardcodes an
`ejemplos/`-wide chunk count. The real, measured shift (27 → 29 chunks, one document affected) is
recorded above for Phase 9's README update, but no test needed touching to accommodate it.

**Gap found and closed** (not a defect in existing code): `read_doc({ section })`'s "whole and in
order" guarantee for a genuinely `splitToBound`-divided section had zero automated coverage anywhere
in the suite — not because it was broken (it was not; `ReadDocument.execute`'s join logic is untouched
by this whole feature), but because no document in any existing corpus (real or synthetic) happened to
produce a same-heading multi-chunk split. Closed with one new integration test plus a mutation proof
confirming it is not a false positive.

No other issues. All mutation proofs produced real, on-topic failures (not crashes or unrelated
cascades); every perturbation was confirmed absent (via `grep`, exit code 1) before recording GREEN.

## Remaining Tasks (Work Unit 2, this change)

- [x] 2.1–2.9 `splitToBound` cascade tests (RED) — earlier batch
- [x] 3.1–3.3 `splitToBound` implementation (GREEN) — earlier batch
- [x] 4.1–4.8 Wire into `chunkOutline` + merge-guard fix — earlier batch
- [x] 5.1–5.6 Wire into `wholeDocumentChunk` / `NO_CHUNKING` — earlier batch
- [x] 6.1–6.5 Default `480`, comments, test-harness drift — this batch
- [x] 7.1–7.2 Cross-cutting bound invariant — this batch
- [x] 8.1–8.2 Integration regression + full suite — this batch
- [ ] 9.1–9.7 Manual Gates 1 / 1b-after / 2 + docs
- [ ] 10.1–10.3 Final gate

## Workload / PR Boundary (this batch)

- Mode: chained PR slice (`stacked-to-main`), `size:exception` accepted for PR #2 as a whole per the
  tasks artifact's Review Workload Forecast (PR #2 stays one work unit; this batch is an internal
  slice of it, not a separate PR)
- Current work unit: Work Unit 2 — Splitter, Wiring, Default, Docs (PR #2, base `main` post PR #1)
- Boundary: this batch starts from the prior batch's tree (both call sites wired, merge guard fixed,
  default still `800`) and ends with the `480` default live, all doc comments corrected, the
  test-harness drift eliminated at its source (`DEFAULT_CONFIG.chunk`/`NO_CHUNKING` imports), the
  cross-cutting bound+coverage invariant closed for all five named hostile inputs plus the
  `NO_CHUNKING` case, and the integration suite green at the new default with one real gap (the
  split-section `read_doc` reassembly path) found and closed. Phase 9 (manual gates, README/CLAUDE.md
  updates) and Phase 10 (final gate/diff review) are explicitly NOT started.
- Estimated review budget impact: small, well-commented diff in `src/` (one config line + 3 doc
  comments); the `test/` diff is larger (4 new tests + 2 harness fixes) but each addition is narrowly
  scoped and directly traceable to a named task; still within the `size:exception` already recorded for
  PR #2 as a whole.

## Status (this batch)

12/12 tasks assigned to this batch complete (6.1–6.5 = 5 tasks, 7.1–7.2 = 2 tasks, 8.1–8.2 = 2 tasks;
8.1 additionally required closing one real coverage gap beyond just "running existing tests", recorded
above). `npm test` 376/376, `npm run typecheck` and `npm run build` all clean. Every new test's
non-tautology was proven via a temporary, immediately-reverted production-code perturbation
(`grep`-confirmed absent afterward) rather than trusted on a single GREEN run. Measured, not assumed:
`ejemplos/` chunk count moved 27 → 29 at the new default with zero test assertions requiring a change,
and the one document whose chunk count moved (`leadsviewer/validacion-formulario.md`, 4 → 6) was
traced to `mergeTinyPieces`' narrower merge headroom, not to any section actually being divided by
`splitToBound` — meaning the "split section reads back whole and in order" guarantee still had zero
real-corpus exercise, which is exactly the gap this batch closed with a synthetic integration test.
Ready for the next Work Unit 2 batch (Phase 9: manual Gates 1 / 1b-after / 2, and the `CLAUDE.md`/
`README.md` doc updates) — NOT started here, per this batch's explicit stop instruction.
