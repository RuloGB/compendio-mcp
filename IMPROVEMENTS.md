# Improvement backlog

Three defects found on 2026-08-05 while investigating a real retrieval failure reported by an
agent using the MCP tools against a large external corpus. Each one is a candidate for its own SDD
cycle; they are listed in the order the evidence recommends.

Everything here was **measured**, not inferred. The measurement also **falsified** the hypothesis
that motivated the investigation — that section is kept below on purpose, so the dead idea is not
re-proposed later.

## How these were found

An agent asked a question against a large corpus, `search_docs` returned the wrong fragment, and
the follow-up `read_doc` call could not resolve the section it had just been shown. The reported
episode was reproduced against two indexes built from the same corpus with the same binary,
differing in exactly one variable (source file encoding), measuring the rank of two specific
chunks — the one holding a document's table of contents, and the one holding the answer — in
**each retrieval leg separately**.

Measuring the fused rank alone would have confirmed the wrong conclusion. Only the per-leg split
showed that the vector leg was ranking correctly and BM25 was not.

### Reproducing the method

`scripts/rank-probe.mjs` is the instrument. It replicates `SearchDocuments.execute` exactly —
anything less does not describe what a caller actually receives — and reports, for every chunk
containing a given needle, its rank at each stage:

```bash
node scripts/rank-probe.mjs <root> "<query>" "<needle>"
```

Read the four stages as a diagnosis, not as one number:

| Stage | What a bad rank here means |
|---|---|
| lexical (BM25) | term-level problem: corrupted text, tokenizer mismatch, a list-like chunk hoarding the terms |
| vector | semantic reach: chunk too large, content buried, wrong embedding input |
| fused (RRF) | the two legs disagreed and the disagreement resolved against you |
| after cap | nothing to do with relevance — `MAX_CHUNKS_PER_DOCUMENT` evicted a chunk that had already ranked |

That last row is the one worth watching. It removes results *after* they rank, so a chunk can be
retrieved perfectly well and still never reach the caller.

A corpus with the failing shape — 38 documents including one 167 345-character, heading-less
Word-export-style manual — is already generated in-repo, with no external content:

```bash
node scripts/generate-perf-corpus.mjs <scratch-dir> --cp1252
```

Drop `--cp1252` for the same corpus in UTF-8. That flag pair is the A/B control used below.

---

## 1. Encoding is assumed to be UTF-8 on read

**Priority: highest.** Root cause of the reported failure, cheapest to fix, and it silently
corrupts data while reporting success.

### What's broken

`FileDocumentSource` reads every file as UTF-8 unconditionally
(`src/infrastructure/fs/file-document-source.ts:54`). A CP1252/latin1 markdown file — the normal
output of exporting a Word document on a Spanish-locale Windows machine — is decoded with one
`U+FFFD` replacement character per non-ASCII byte.

Note that the surrounding `try/catch` is no safety net here: Node substitutes replacement
characters rather than throwing, so the read never fails, nothing lands in `readErrors`, and the
document is indexed as a normal success.

### Evidence

In the corpus measured, **1 file of 38** was CP1252:

| Measurement | Value |
|---|---|
| Non-ASCII bytes destroyed | 3 191 |
| Chunks of that document corrupted | 89 of 89 |
| `U+FFFD` characters written into the index | 3 191 |
| Reported by `index` as | success |

The retrieval consequence is severe and non-obvious. FTS5 uses `unicode61 remove_diacritics 2` with
no stemmer, so a query term like `sección` normalizes to `seccion` while the corrupted index holds
`secci<U+FFFD>n`, which tokenizes as `secci` + `n`. The term simply cannot match. In the failing
query, the accented term was one of two discriminating terms, and the chunk holding the answer fell
from lexical rank 2 to rank 36.

Same corpus, same query, same binary — encoding is the only variable:

| Chunk | CP1252 index | UTF-8 index |
|---|---|---|
| Table of contents | lexical #8 · RRF #1 · **returned at #1** | lexical #1 · RRF #18 · not returned |
| The actual answer | lexical #36 · RRF #6 · **evicted** | lexical #2 · RRF #1 · **returned at #1** |

### Direction

Detect encoding on read rather than assuming UTF-8. The decision to make explicitly during design:
whether an undecodable file is transcoded silently, transcoded with a report entry, or skipped into
`skipped` like any other unreadable file. A silent success is the one option ruled out by the
evidence above — the whole point is that the current behaviour hides the damage.

Worth deciding at the same time: whether a *detected* non-UTF-8 file should be surfaced in the
`index` report even when transcoding succeeds, since a corpus with mixed encodings is usually an
accident the project owner wants to know about.

---

## 2. The lead excerpt is a blind prefix, not a window on the match

**Priority: second.** Independent of retrieval quality. It fires precisely when retrieval has
already succeeded, which makes it easy to miss.

### What's broken

`buildExcerpt` returns the first `LEAD_EXCERPT_CHARS` (1400) characters of the rank-1 chunk. It has
no knowledge of which part of that chunk matched the query. When the matching passage sits in the
second half of a chunk, the excerpt shows the preceding content and truncates before the answer,
appending the `…` truncation signal that sends the agent to `read_doc`.

### Evidence

In the healthy (UTF-8) index, `search_docs` returned the correct chunk at rank 1 — and the answer
still was not in the excerpt:

| Measurement | Value |
|---|---|
| Chunk length (raw / normalized) | 1811 / 1616 chars |
| Offset of the answer inside the normalized chunk | 1423 |
| Where the lead excerpt ends | 1391 |
| **Shortfall** | **32 chars** |
| Content withheld beyond the cut | 225 chars |

The retrieval was correct. The presentation lost it by 32 characters.

### Why raising the constant is not the fix

Raising `LEAD_EXCERPT_CHARS` moves the boundary; it does not remove it. Chunks are bounded at
`chunk.maxTokens`, so a large enough budget degenerates into "return the whole chunk", which is
what the graduated excerpt budget exists to avoid — the current values were tuned against measured
truncation rates, and inflating them regresses that work for every other query.

The defect is structural: the excerpt is a prefix when it should be a window centred on the span
that caused the match. In the case above, the answer fitted comfortably inside the existing 1400
character budget; only its position ruled it out.

### Direction

Centre the lead excerpt on the matched region, with the budget unchanged. Design questions worth
resolving explicitly:

- Where the match span comes from — FTS5 can report it (`snippet()`/`offsets()`), the vector leg
  cannot, so a chunk retrieved only by the vector leg needs a defined fallback.
- Whether a centred window keeps the leading `…` that a prefix excerpt never needed, since the
  truncation signal now applies at both ends.
- Whether `SUPPORTING_EXCERPT_CHARS` (120) fragments get the same treatment or stay prefixes —
  their job is routing, not answering, so the answer is not automatically yes.

---

## 3. Documents without headings produce unaddressable chunks

**Priority: third.** The most invasive of the three, and the only one where the reported episode
and the original proposal overlap.

### What's broken

`chunkOutline` derives every chunk's `heading` from the document outline. A document with no H1 and
no H2 — again, the normal shape of a Word export — yields `title = ""`, `sections = []`, and a
single intro piece whose heading path is `[""]`. `splitToBound` then bounds it into many chunks,
**all of which inherit the same empty heading**.

Three consequences, all observed:

1. `search_docs` returns `"section": ""` on the wire. The caller has a `path` and nothing else, and
   cannot address one fragment of the document rather than another.
2. `read_doc({ path, section })` cannot match anything, because neither the chunk headings nor
   `headingsIn(content)` (which requires `^#{2,6}`) find a candidate.
3. The recovery path degrades to nothing useful: `availableSections` collects the chunk headings
   into a `Set`, which for such a document is `{""}`, and `server.ts` renders
   `"Available sections:"` followed by a single empty bullet.

The only remaining option is `read_doc({ path })` with no section, which for a document of this size
returns the entire ~167 KB body.

### Evidence

| Measurement | Value |
|---|---|
| Chunks produced from the heading-less manual | 89 |
| Distinct `heading` values across them | 1 (`""`) |
| Same result in the UTF-8 index | yes — independent of improvement 1 |

### Direction

Make a chunk individually addressable and make the failure path informative. The proposal that
started this investigation suggested a four-level reference (path, heading anchor, line range,
content hash); only part of that survives contact with the code:

- **Heading anchors** already exist in a more robust form. `path` + `section` resolves through
  normalized substring matching against both the chunk heading path and the heading lines inside
  merged chunks. A GitHub-style slug is exact-equality and breaks when a title is reworded, so
  replacing the current mechanism with anchors would be a downgrade. Not in scope.
- **Line ranges** cannot be byte-exact with the current pipeline, and a reference that is silently
  approximate is worse than none in a feature whose entire premise is traceability. Frontmatter is
  stripped before offsets are taken, outline slices are trimmed, `sectionFullText` and
  `mergeTinyPieces` join fragments with injected `\n\n`, and `splitTable`/`splitFence` **re-emit**
  a header+separator or fence markers on every piece — for a split table chunk, no range of source
  lines reproduces the chunk's content. A *provenance* range ("this chunk came from somewhere
  between lines X and Y") is implementable, but it is a different contract and must be named as
  such.
- **A stable block identifier** is the part worth building, and it is cheap: the `chunks` table has
  no hash column today and adding one is mechanical.

Design questions worth resolving explicitly:

- Whether a synthesized heading (e.g. derived from the chunk's leading line, or its ordinal within
  the document) is preferable to an opaque id for the `section` field, since a human-readable value
  is also what `docs_overview` and `INDEX.md` consume.
- What `read_doc` should answer when a document genuinely has no sections. The current empty bullet
  list is strictly worse than saying so.
- Whether the block id becomes part of the public MCP contract — every added response field
  competes with the excerpt budget that improvement 2 is trying to protect.

### Related risk, not itself a defect

`MAX_CHUNKS_PER_DOCUMENT = 2` amplifies all of the above when one document dominates a corpus. In
the failing run, **45 chunks from a single document entered the fused candidate list and 2
survived** — and neither was the answer, which had ranked #6 before the cap. The cap is sound
policy (it stops one document from filling the whole result set), but its interaction with very
large single documents deserves a measurement before anything is changed.

---

## Falsified: "a document's table of contents competes with its own content"

Recorded so it is not re-proposed.

The hypothesis was that a table of contents is dense in query terms and thin in prose, making it a
retrieval magnet that outranks the content it points at.

**The BM25 half is true.** The table-of-contents chunk is lexical rank #1 in the *healthy* index —
an even stronger lexical match than in the corrupted one.

**The system-level claim is false.** Reciprocal Rank Fusion drops that same chunk to #18 and it is
not returned, because the vector leg does not rank it highly at all. Hybrid retrieval handled the
case correctly on its own. The table of contents only won in the corrupted index, and it won there
because its competitor had been damaged by improvement 1's defect, not because of any property of
tables of contents.

No change is warranted. The lesson worth keeping is the method: a fused rank alone would have shown
"table of contents at #1" and confirmed the hypothesis for entirely the wrong reason.

## Also considered and rejected

The originating proposal included marking previously-returned citations as stale on reindex. This
requires Compendio to remember what a caller cited — a citation registry, with ownership and
lifetime concerns of its own. The server is stateless between queries by design.

If the underlying need is real, the responsibility inverts cleanly: whoever stores an answer stores
the block id from improvement 3, and Compendio answers "is this block still current?" on demand.
Same guarantee, no new state.
