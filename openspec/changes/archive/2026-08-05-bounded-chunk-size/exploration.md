# Exploration — bounded-chunk-size

Status: complete. Every number below was **measured**, not estimated. Commands and scripts used
are recorded so any claim can be re-run.

## Problem statement

`compendio index` on a real 38-document corpus took 285 s, with the progress bar sitting at 100%
for most of it. The progress bar was a symptom. The cause is that `chunk.maxTokens` is not an
upper bound, so a single document can become one arbitrarily large chunk.

## Evidence

### 1. One document accounts for 88% of the run

Corpus: an external, private 38-document corpus of functional documentation (not committable to
this repository; referred to below as `EXTERNAL-CORPUS`). Its largest file is a 167 KB user manual
exported from Word, referred to as `MANUAL.md`.

| Corpus | Documents indexed | Chunks | Wall time |
| --- | --- | --- | --- |
| Full | 36 | 242 | **285 s** |
| Without `MANUAL.md` | 35 | 241 | **31.2 s** |

Removing one file of 38 removes ~254 s. That file contributes exactly **one** chunk.

### 2. Why it becomes a single chunk

`MANUAL.md` is 167 KB, 5 688 lines, and contains **zero markdown headings**
(`H1=0, H2=0, H3=0`) and **zero tables**. It is a flat Word export.

With no H2, `outline.sections` is empty and the whole body lands in `outline.intro`, which
`chunkOutline` pushes without any size check (`src/domain/chunking.ts:32`). Result: one chunk of
**41 837 estimated tokens**, 52x the configured `maxTokens` of 800.

Chunk-size distribution over the same corpus (real parser + real chunker, no embeddings):

- 242 chunks total; **5 exceed `maxTokens`**.
- Those 5 chunks hold **50 302 of 106 507 total tokens** — 47% of the corpus lives in 2% of chunks.

The five oversized chunks:

| Estimated tokens | Document | Heading |
| --- | --- | --- |
| 41 837 | `MANUAL.md` (167 KB, Word export) | (none — intro) |
| 2 908 | second manual, same folder | (none — intro) |
| 2 461 | a systems presentation | (none — intro) |
| 1 977 | a spreadsheet export | `Sheet1` |
| 1 119 | a short summary document | (none — intro) |

All five live in the same folder: business-analysis documentation converted from Word and Excel.

**Four of five come from the unbounded `intro` branch, and four of five contain no tables at
all.** Only one (`Sheet1`, 47 table rows) is a table case. This matters for design: paragraph and
line splitting is the primary mechanism; table-header repetition covers a minority case.

There are three unbounded paths in `chunkOutline`, not one:

- `src/domain/chunking.ts:32` — `intro` is pushed with no size check (dominant in this corpus).
- `src/domain/chunking.ts:37` — `|| section.children.length === 0` pushes a whole section when
  there is no H3 to descend into.
- `src/domain/chunking.ts:45` — each child is pushed via `sectionFullText(child)` with no size
  check, so a large H3 is unbounded too.

A bounding pass applied to every `Piece` covers all three uniformly.

### 3. The expensive work produces nothing

Embedding that one chunk takes **267.98 s**. Cosine similarity of the resulting vector against
embeddings of prefixes of the same document:

| Input | Cosine vs full-document vector |
| --- | --- |
| First 128 words | 0.9868 |
| **First 384 words** | **1.0000** |
| First 2 000 words | 1.0000 |
| Last 2 000 words | 0.9175 |

The full-document vector is **identical** to the vector of its first ~384 words. Those first words
are the cover page — title, organisation names, document reference, change log. The stored vector
for a 167 KB user manual represents its letterhead; the remaining 99% is invisible to vector
search. The 268 s buys nothing.

The content is still present in FTS5, so lexical search can reach it — subject to finding 5 below.

### 4. `chunk.maxTokens: 800` is mis-calibrated against the model

Effective window, measured by extending a prefix until the vector stops changing (real Spanish
prose from the corpus, `Xenova/multilingual-e5-small`, q8):

| Prefix chars | `estimateTokens` | Cosine vs next larger prefix |
| --- | --- | --- |
| 1 600 | 400 | 0.9927 |
| **2 000** | **500** | **1.0000** |
| 2 400 | 600 | 1.0000 |
| 3 200 | 800 | 1.0000 |

Content beyond ~2 000 characters (~500 `estimateTokens`) never changes the vector. The default
`maxTokens` is 800, so a chunk sitting at the configured maximum silently loses its last ~37% for
vector search. **This affects every project on default configuration, not just this corpus.**

`estimateTokens` is `Math.ceil(text.length / 4)` (`src/domain/tokens.ts`) — a character
heuristic that under-counts Spanish, so any chosen bound needs conservative margin.

### 5. Related but out of scope: fixed UTF-8 read

`src/infrastructure/fs/file-document-source.ts:54` reads every file as `"utf8"` with no detection.
`MANUAL.md` is CP1252 (byte `0xF3` where `ó` belongs), producing **3 191 U+FFFD replacement
characters**. Every accented character is destroyed before chunking, FTS5 and embedding. The
document is reported in `indexed`, not `skipped` — a silent failure. 1 of 38 files in this corpus.

Tracked as a separate change; **not** in scope here, so it does not contaminate this change's
retrieval revalidation.

### 6. Batch padding is real but secondary

A batched tokenizer pads every sequence to the longest in its batch, so one oversized chunk makes
its whole batch more expensive:

| Batch | Time |
| --- | --- |
| 16 small chunks | 0.03 s |
| 1 oversized chunk (43 KB) alone | 4.23 s |
| 16 small + 1 oversized | 6.23 s |

~47% overhead above the oversized chunk alone. Worth knowing, but the oversized chunk dominates by
two orders of magnitude. A token-budget batcher is a possible later optimisation, not part of the
fix.

## Decisions already taken by the user

1. **Split oversized sections at row/paragraph boundaries**, repeating the table header on each
   piece so every piece stays valid markdown. Not truncation, not a blind token cut.
2. **Lower the default `chunk.maxTokens` from 800 to ~480**, aligning it with the measured window
   with margin for `estimateTokens` under-counting Spanish.

## Falsifiable prediction

With both changes, `MANUAL.md` goes from 1 chunk to ~88; the corpus goes from 242 to ~330
chunks; and the full-corpus index time goes from **285 s to roughly 50 s**. If measurement does
not show approximately this, the analysis is wrong and the design must be revisited before
proceeding.

## Constraints for design

- `src/domain/` must stay free of SQLite/transformers.js/filesystem dependencies. The bounding
  pass is pure domain logic operating on already-parsed pieces.
- The current documented guarantee "cuts only happen at heading boundaries, so tables are never
  split mid-row" (`CLAUDE.md`, and the `chunkOutline` doc comment at
  `src/domain/chunking.ts:24-26`) stops being true and must be corrected in the same change.
- Both changes move chunk boundaries for every project, so `compendio eval` against
  `goldenset.yaml` must be run before and after. Published baseline: **MRR 0.943, top-1 20/22**.
  A regression there blocks the change.
- The project is in beta with no installed users; breaking the public contract is an accepted
  cost. No migration or compatibility shim is required (`openspec/config.yaml`, proposal rules).

## Reproduction tooling

Scripts written for this exploration (session scratchpad, not committed):

- `trace.mjs` — spawns the real CLI with `COMPENDIO_PROGRESS=plain` and timestamps every progress
  event plus process exit, showing where wall time actually goes.
- `chunkstats.mjs` — runs the real parser + chunker over a corpus and reports the chunk-size
  distribution against `maxTokens`.
- `window.mjs` / `window2.mjs` — locate the model's effective content window by cosine comparison
  of prefixes.
- `padding.mjs` — measures batch padding amplification.
