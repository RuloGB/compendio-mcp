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

## Remaining Tasks (Work Unit 2 — NOT started, per batch scope)

- [ ] 2.1–2.9 `splitToBound` cascade tests (RED)
- [ ] 3.1–3.3 `splitToBound` implementation (GREEN)
- [ ] 4.1–4.8 Wire into `chunkOutline` + merge-guard fix
- [ ] 5.1–5.6 Wire into `wholeDocumentChunk` / `NO_CHUNKING`
- [ ] 6.1–6.5 Default `480`, comments, test-harness drift
- [ ] 7.1–7.2 Cross-cutting bound invariant
- [ ] 8.1–8.2 Integration regression + full suite
- [ ] 9.1–9.7 Manual Gates 1 / 1b-after / 2 + docs
- [ ] 10.1–10.3 Final gate

## Workload / PR Boundary

- Mode: chained PR slice (`stacked-to-main`, per the tasks artifact's Review Workload Forecast)
- Current work unit: Work Unit 1 — Gate 1b Tooling (PR #1, base `main`)
- Boundary: this batch starts from an unmodified `src/` tree and ends with the fixture, generator
  flag, and `vector-reach.mjs` committed to the working tree (not yet committed to git — per
  instruction, commits are the user's call). PR #2 (Work Unit 2) is NOT started; no `split-text.ts`,
  no `src/infrastructure/config.ts` change.
- Estimated review budget impact: within the ~550–650 line forecast for PR #1 (mostly generated
  fixture content).

## Status

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
`npm test` (308/308) and `npm run typecheck` green. Ready for Work Unit 2 (the splitter, PR #2) to
begin in a fresh batch — this "before" baseline must not be re-measured once `src/split-text.ts`
lands, per Decision 6's sequencing requirement.
