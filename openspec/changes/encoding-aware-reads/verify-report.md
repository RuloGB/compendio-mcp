# Verification Report: encoding-aware-reads

**Change**: encoding-aware-reads
**Branch**: `feat/encoding-aware-reads`
**Mode**: Strict TDD (`openspec/config.yaml`: `strict_tdd: true`)
**Verifier**: sdd-verify (independent pass -- the apply-phase copy of this file is superseded by this report)

**Verdict**: **PASS WITH WARNINGS**

No CRITICAL issues. All 43 tasks in `tasks.md` are genuinely complete and match the code state. All
five proposal Success Criteria gates hold, independently reproduced in this pass (not merely
re-read). Four WARNING-level test-coverage gaps are identified below -- none blocks the behavior
they describe, all were independently confirmed correct by manual runtime verification during this
pass, but the automated regression suite does not lock them in, so a future regression in those
specific paths would not be caught by `npm test`.

---

## 1. What this report re-verified vs. what it took as given

Per the launch brief, the following was already independently confirmed by the orchestrator and is
NOT re-litigated here: `npm test` (450/450), `npm run typecheck`, `npm run build`, the 27-entry
CP1252 table's behavioral correctness (all 27 assigned + 5 unassigned bytes), the RED/GREEN mutation
test on the CP1252 table, the end-to-end CP1252 CLI smoke test, and `ejemplos/`/`goldenset.yaml`/the
four protected fakes being untouched.

This pass focused on:

1. Full requirement/scenario-by-scenario spec conformance (indexing, mcp-contract, index-md deltas).
2. Deviation 5 (`sync-index.ts`'s non-RED-first test) -- reverted and re-ran to prove discrimination.
3. Gate 2 ("the report is loud") -- reproduced through the actual production wiring
   (`composition.ts` -> `SyncIndex` -> `toSyncInfo` -> `formatOverview`, the exact call sequence
   `server.ts`'s `docs_overview` handler uses), for the specific case named in the brief: notices
   present, `skipped` empty, `embeddingsWarning` absent.
4. The `index-md` path, via a real `compendio index-md` run, not just the unit tests.
5. UTF-16LE, UTF-16BE, and UTF-8-BOM, via a real `compendio index` run and direct SQLite inspection
   of the stored chunk content.
6. Regression: a real `compendio index`/`eval` run against `ejemplos/`.
7. Reproduction of the apply-phase `verify-report.md`'s Gate 3 transcript (rank identity,
   `generate-perf-corpus.mjs` + `rank-probe.mjs`) -- re-run from scratch, not trusted.

All manual runs used a disposable scratch corpus (outside the repo) and were cleaned up afterward.
No repo file was modified except the temporary revert-and-restore of `sync-index.ts` described in
Section 3, which is fully reverted (`git diff --stat` for that file after restoration matches the
pre-test diff exactly, and the full suite was re-run green afterward).

---

## 2. Task completeness

All 43 checklist items across both Work Units in `tasks.md` are `[x]`. Spot-checked against the code:

- Work Unit 1 (decoder + adapter): `decode-text.ts` exists, contains zero `TextDecoder` usage
  (confirmed by reading the file -- only doc-comment mentions), and `FileDocumentSource` reads raw
  bytes (`readFile(path)`, no encoding argument) and routes through it.
- Work Unit 2 (notice threading): `ports.ts`, `index-documents.ts`, `sync-index.ts`,
  `get-overview.ts`, `generate-index-md.ts`, `cli.ts` all carry `encodingNotices?` exactly as
  `design.md`'s "Report flow" and "File Changes" tables specify, verified by reading each file.

No unchecked or partially-done task. No CRITICAL from this dimension.

---

## 3. Deviation 5 -- `sync-index.ts`'s non-RED-first test, verified by reversion

`apply-progress.md` self-reports that Phase 8.2's `sync-index.ts` change was implemented without a
failing test first (RED-first was skipped at that specific layer), and that a test was added
afterward in `test/application/index-and-search.test.ts` ("SyncIndex -- CP1252 encoding notices
persist across passes...") to close the gap -- with the caveat that "it passed immediately... which
is the honest signal that this specific test was not RED-first."

**Verification performed**: saved the current `src/application/sync-index.ts`, replaced it with
`git show HEAD:src/application/sync-index.ts` (the pre-change version -- no `encodingNotices`
anywhere), and ran only that test:

```
$ npx vitest run test/application/index-and-search.test.ts -t "SyncIndex"

 x reports the transcoded document on the indexing pass and again on a hash-match no-op pass
   AssertionError: expected undefined to deeply equal [ { path: 'cp1252.md', encoding: 'windows-1252' } ]
   at index-and-search.test.ts:675:37

 Tests  1 failed | 1 passed | 35 skipped (37)
```

It fails exactly where expected (`first.encodingNotices` is `undefined` against the reverted code),
and only that test fails -- the sibling `IndexDocuments`/`FileDocumentSource` tests in the same run
stay green, confirming the failure is specific to `SyncIndex`'s own code path, not a shared fixture
artifact. Restored the file from the saved copy, confirmed `git diff --stat -- src/application/sync-index.ts`
matches the pre-test diff exactly, re-ran the same test (2/2 passing), then ran the full suite
(`npm test`: 450/450) and `npm run typecheck` (clean).

**Conclusion**: the test genuinely exercises the `SyncIndex` path and would catch a regression in it,
despite not having been written RED-first. Deviation 5 is accurately self-reported and does not leave
a coverage hole -- it leaves a process gap (Strict TDD's letter was not followed at that one step),
not a verification gap. WARNING-worthy as a process note, not CRITICAL, because nothing is actually
untested.

---

## 4. Gate 2 -- "the report is loud", reproduced through the real MCP wiring

Built a disposable corpus (`plain.md`, `bom-utf8.md`, `utf16le.md`, `utf16be.md`), ran
`compendio index` (hybrid mode, embeddings succeed), then called `container.syncIndex.execute()`
directly (bypassing the scheduler's throttle, all other wiring unchanged) followed by the exact
sequence `server.ts`'s `docs_overview` handler runs -- `toSyncInfo(report)` then
`formatOverview(overview, sync)`:

```
=== raw SyncReport ===
{
  "mode": "hybrid", "indexed": [], "deleted": [], "skipped": [], "totalChunks": 0,
  "encodingNotices": [
    { "path": "utf16be.md", "encoding": "utf-16be" },
    { "path": "utf16le.md", "encoding": "utf-16le" }
  ]
}
=== formatOverview() (this is the exact docs_overview MCP response text) ===
Indexed documents: 4
...
Sync:
WARNING utf16be.md: not UTF-8 -- decoded as utf-16be and indexed; re-save as UTF-8 to silence this
WARNING utf16le.md: not UTF-8 -- decoded as utf-16le and indexed; re-save as UTF-8 to silence this
```

This is precisely the case the launch brief and `design.md` call load-bearing: a pass whose only
finding is a transcode (`skipped: []`, no `embeddingsWarning`) still renders a non-empty `Sync:`
block, because `toSyncInfo`'s content-based null rule was extended to check `encodingNotices` too.
Without that extension (the pre-change behavior), this exact report would have rendered `sync: null`
and Gate 2 would fail silently. Confirmed working in the real composition root, not just in the
`get-overview.test.ts` unit tests.

---

## 5. `index-md` path, real run

Added a CP1252 document (curly quotes, en dash, ellipsis) to the same scratch corpus and ran:

```
$ node dist/cli.js --root <scratch> index-md
WARNING cp1252.md: not UTF-8 -- decoded as windows-1252 and indexed; re-save as UTF-8 to silence this
WARNING utf16be.md: not UTF-8 -- decoded as utf-16be and indexed; re-save as UTF-8 to silence this
WARNING utf16le.md: not UTF-8 -- decoded as utf-16le and indexed; re-save as UTF-8 to silence this
INDEX.md updated: 5 documents at <scratch>/docs/INDEX.md
```

Generated `INDEX.md` content:
```
- bom-utf8.md — Hola, con BOM.
- cp1252.md — “Cita” con guion – y puntos suspensivos…
- plain.md — Just ASCII prose, nothing special.
- utf16be.md — Hola mundo BE.
- utf16le.md — Hola mundo LE.
```

All three transcoded documents are reported, and `cp1252.md`'s summary line renders the correct
curly quotes/en dash/ellipsis (not `U+FFFD`, not the C1-control mis-decode). Confirms the index-md spec's
"A transcoded document is included in INDEX.md and reported" scenario against real code, not only
the `SourceWithEncodingNotices` fake in `generate-index-md.test.ts`.

---

## 6. UTF-16LE, UTF-16BE, UTF-8-BOM -- real run + direct storage inspection

Same scratch corpus, `compendio index` (full pipeline, real embeddings):

```
[1/4] bom-utf8.md
[2/4] plain.md
[3/4] utf16be.md
[4/4] utf16le.md
WARNING utf16be.md: not UTF-8 -- decoded as utf-16be and indexed; re-save as UTF-8 to silence this
WARNING utf16le.md: not UTF-8 -- decoded as utf-16le and indexed; re-save as UTF-8 to silence this
Indexed 4 documents (4 chunks) in 974 ms [mode hybrid]
```

`bom-utf8.md` produces no warning (correct -- a UTF-8 BOM is consumed silently per `decodeText`'s
design, not treated as a transcode). Read the stored chunk content directly from SQLite
(`SqliteIndexStore.getChunksByDocument`), bypassing search/excerpt formatting entirely:

```
=== utf16be.md ===  "Hola mundo BE."
=== utf16le.md ===  "Hola mundo LE."
=== bom-utf8.md ===  "Hola, con BOM."
=== plain.md ===  "Just ASCII prose, nothing special."
```

All four decode to their exact source strings -- no BOM leakage, no mojibake, no `U+FFFD`. This
specifically confirms the UTF-16BE branch, called out in the brief as the least-exercised path
(design.md bans `TextDecoder('utf-16be')` and requires the hand-rolled `swap16` copy instead): it
works correctly through the full production stack (`FileDocumentSource` -> `decodeText` ->
`IndexDocuments` -> SQLite), not just the pure-function unit test.

Gap noted (see Section 8, Finding W1): this exact integration-level scenario for UTF-16BE has no
automated test -- `file-document-source.test.ts` has a dedicated UTF-16LE integration test but no
UTF-16BE counterpart, only `decode-text.test.ts`'s pure-function unit test covers BE at all.

---

## 7. Regression -- plain UTF-8 corpus unmoved

Independently re-ran (not reusing the apply-phase transcript) against the real `ejemplos/` corpus:

```
$ node dist/cli.js --root ejemplos index
Indexed 11 documents (29 chunks) in 3469 ms [mode hybrid]
(zero WARNING lines)

$ node dist/cli.js --root ejemplos eval
mode      recall@5   MRR      failures
hybrid    1.00       0.943    0
lexical   0.95       0.856    1
```

Bit-identical to the project's documented baseline (`CLAUDE.md`: "hybrid MRR 0.943, top-1 20/22") and
to the apply-phase transcript. Confirms Gate 4 independently.

Gate 3 reproduced from scratch (not trusted from the apply-phase record): regenerated both corpora
with `scripts/generate-perf-corpus.mjs`, indexed both (`38 documents (358 chunks)` each, matching the
recorded transcript exactly), and re-ran `scripts/rank-probe.mjs` for the `QUETZAL-7731` marker. Both
runs produced identical ranks at every stage (lexical #1, vector #1, fused #1, after cap #1, returned
#1) and an identical top-5 result set -- reproducing the apply-phase transcript exactly, matching the
printed ranks. As `design.md`/`tasks.md` state explicitly, this gate is non-discriminating on its own
(the CP1252 flag in the generator writes with `latin1`, which never emits a `0x80-0x9F` byte); Gate 1
(the 27-override table tests) is the gate that actually discriminates a correct decoder from
`latin1`. Both are now independently confirmed.

---

## 8. Spec compliance matrix

Every requirement and scenario in the three delta specs, mapped to its covering evidence.
"Manual (this pass)" means verified by real command execution during this verification, not merely
inferred from source.

### `specs/indexing/spec.md`

| Requirement / Scenario | Status | Evidence |
|---|---|---|
| Encoding-Aware Decoding -- CP1252 curly quotes/dash/ellipsis | PASS | `decode-text.test.ts` (27-case table) + `index-and-search.test.ts` Gate-1 e2e + manual (this pass, Sections 5-6) |
| Encoding-Aware Decoding -- CP1252 accented vowels | PASS | `decode-text.test.ts` + `file-document-source.test.ts` + e2e test |
| Encoding-Aware Decoding -- Valid UTF-8 is unaffected | PASS | `decode-text.test.ts` passthrough + `index-and-search.test.ts` "leaves encodingNotices undefined" + manual `ejemplos/` run (Section 7) |
| Encoding-Aware Decoding -- UTF-8 BOM is consumed | PASS | `decode-text.test.ts` unit test + manual (this pass, Section 6): no notice, correct content |
| Encoding-Aware Decoding -- UTF-16 BOM, LE and BE | PASS, with a gap | Unit-level both (`decode-text.test.ts`); integration-level only LE (`file-document-source.test.ts`); BE confirmed manual (this pass, Section 6) through the full production stack, but no automated integration test exists for BE -- see Finding W1 |
| A Successfully Transcoded Document Is Always Reported -- perfect transcode still reported | PASS | `index-and-search.test.ts` Gate-1+2 e2e + manual `index`/`index-md` runs (Sections 5-6) |
| A Successfully Transcoded Document Is Always Reported -- CLI output | PASS | `cli.ts` code inspection + manual (this pass): WARNING lines confirmed for both `index` and `index-md` |
| Corrected Decoding Self-Heals via Incremental Sync | PASS, no automated test | No test in the suite exercises this (confirmed by grep). Verified manually (this pass, custom script): seeded a document at the hash of the pre-fix, `U+FFFD`-corrupted decode; ran `SyncIndex` with the real decoder against the unchanged on-disk CP1252 bytes; confirmed the hash differs -> the document is re-indexed (not treated as a hash-match no-op) -> the newly stored content is `U+FFFD`-free with the correct curly quotes/dash/ellipsis restored. Behavior holds; see Finding W2 |
| Resilience -- I/O-unreadable, under strict | PASS | Pre-existing, untouched (`git diff` confirms zero change to this path) |
| Resilience -- malformed frontmatter, loose and strict | PASS | Pre-existing, untouched |
| Resilience -- no indexable content | PASS | Pre-existing, untouched |
| Resilience -- genuinely undecodable, distinct message, never transcoded | PASS, with a gap | `decode-text.test.ts` (unassigned bytes, C0/DEL) + `file-document-source.test.ts` (binary JPEG header). Architecturally mode-independent (readErrors bypass `ConventionPolicy` entirely in all three call sites -- confirmed by reading `index-documents.ts`, `sync-index.ts`, `generate-index-md.ts`), but no test exercises this specific path under `convention.mode: "strict"` -- see Finding W3 |

### `specs/mcp-contract/spec.md`

| Requirement / Scenario | Status | Evidence |
|---|---|---|
| Sync pass skipped a document | PASS | Pre-existing, untouched |
| Sync pass had nothing to report | PASS | `get-overview.test.ts` (default `fakeReport()`) |
| Embeddings degrade during incremental sync | PASS | Pre-existing, untouched |
| Sync pass transcoded a document | PASS | `get-overview.test.ts` unit tests + manual (this pass, Section 4), reproduced through the actual `composition.ts` -> `SyncIndex` -> `toSyncInfo` -> `formatOverview` chain `server.ts` uses for `docs_overview` -- the strongest verification in this report |

### `specs/index-md/spec.md`

| Requirement / Scenario | Status | Evidence |
|---|---|---|
| Malformed frontmatter skipped, loose and strict | PASS | Pre-existing, untouched |
| Unreadable file skipped, under strict | PASS | Pre-existing, untouched |
| Undecodable content skipped during index-md generation | PASS, with a gap | Architecturally identical to the indexing-spec path (same `discover()` call, same `readErrors`->`skipped` mapping). No `GenerateIndexMd`-layer test uses a real undecodable file or the distinct encoding-rejection message -- existing tests use a generic fake `readError`. See Finding W4 |
| A transcoded document is included in INDEX.md and reported | PASS | `generate-index-md.test.ts` unit test + manual (this pass, Section 5): real `index-md` run, correct summary text in generated `INDEX.md` |

No requirement or scenario has zero covering evidence. All four gaps below are "tested indirectly /
architecturally, not directly, at this exact layer" -- not "untested."

---

## 9. Findings

### CRITICAL

None.

### WARNING

- **W1 -- UTF-16BE has no automated integration-level test.** `decode-text.test.ts` unit-tests the
  pure `decodeText` function for BE correctly (BOM sniff + `swap16`), and `file-document-source.test.ts`
  has a UTF-16LE integration test but no UTF-16BE counterpart. `design.md` itself names BE "the least
  exercised branch" because it needed the hand-rolled `swap16` copy instead of `TextDecoder`. Manually
  confirmed correct in this pass (Section 6) through the real `FileDocumentSource` -> `IndexDocuments`
  -> SQLite stack, but nothing in `npm test` would catch a regression specific to the BE wiring (e.g.
  an accidental swap of the LE/BE branches, or a broken `swap16` call) if the LE path stayed correct.
  Suggested fix: add one integration test to `file-document-source.test.ts` mirroring the existing
  UTF-16LE one, with a UTF-16BE-with-BOM temp file.

- **W2 -- "Corrected Decoding Self-Heals via Incremental Sync" has no automated test.** The spec adds
  this as a first-class ADDED requirement with its own scenario. No test in the suite exercises it
  (confirmed by grep across `test/`). It is a real, verified behavior (manually confirmed in this
  pass, Section 8's matrix row) -- a logical consequence of two independently-tested facts
  (`computeHash` runs over decoded content; `SyncIndex` re-indexes on hash mismatch) -- but the
  encoding-specific instance of it (a document corrupted by the old decoder gets picked up and healed
  by the new one) is not locked into the regression suite. Suggested fix: a `SyncIndex` test seeding a
  document at a hash computed over `U+FFFD`-corrupted content, then confirming a sync pass with the
  current decoder re-indexes and cleans it (the script used for manual verification in this pass is a
  workable starting point).

- **W3 -- Undecodable content under `strict` mode has no dedicated test.** The indexing spec's
  scenario says "under either `loose` or `strict`." The mechanism is architecturally mode-independent
  (readErrors bypass `ConventionPolicy` entirely before it ever runs, in all three call sites --
  verified by reading `index-documents.ts`, `sync-index.ts`, `generate-index-md.ts`), matching the
  pattern already established and tested for the pre-existing three resilience reasons. But no test
  actually constructs an `IndexDocuments`/`SyncIndex`/`GenerateIndexMd` instance with a `strict`
  policy and an undecodable file to prove it. Low risk given the architecture, but the literal
  scenario wording isn't test-proven.

- **W4 -- `index-md`'s undecodable-content scenario isn't tested with the real rejection message.**
  `generate-index-md.test.ts`'s resilience tests use a generic fake `readError` ("permission denied"),
  never the actual `decodeText`-produced message (`"unrecognized encoding: ... rules out windows-1252"`).
  The plumbing is identical to `IndexDocuments`'s (same `readErrors`->`skipped` mapping), and manually
  confirmed correct in this pass (Section 5, via a real `index-md` run against the same corpus), but
  there is no `GenerateIndexMd`-layer regression test locking in the "distinguishable from a generic
  I/O error" half of the index-md spec's scenario specifically.

### SUGGESTION

- **S1 -- Design's open question on the `0x0B`/`0x0C` reject-set boundary is still unresolved.**
  `design.md`'s Open Questions flags this as "the one judgement call in Decision 3 with no authority
  behind it... confirm the boundary at review." No record of it being revisited exists in
  `apply-progress.md` or this change's history. Not a defect -- `0x0B` (VT) rejected, `0x0C` (FF)
  accepted is a defensible, tested (`decode-text.test.ts` covers both directions), low-risk choice --
  but the open question itself was never explicitly closed. Worth a one-line resolution note before
  archive, simply to avoid re-litigating it blind later.

- **S2 -- `cli.ts`'s `index-md` action has no dedicated unit test at all** (pre-existing project
  convention, not introduced by this change -- the project has no `cli.ts` tests generally, verified
  manually instead, same as the progress-bar feature). Not a gap specific to this change; noted only
  because both new warn loops (`index`, `index-md`) rely entirely on manual verification, which this
  report now provides for both.

---

## 10. Diff size

`git diff --stat` (tracked files only): 13 files changed, 349 insertions, 25 deletions. Plus 3 new
files: `src/infrastructure/fs/decode-text.ts` (154 lines), `test/infrastructure/decode-text.test.ts`
(201 lines), `test/helpers/cp1252.ts` (44 lines). Total roughly 740 changed lines, against the
accepted `size:exception` (forecast 555-695; actual landed slightly above the upper bound, consistent
with `tasks.md`'s own caveat that PR #1's test-suite granularity was undercounted at the exploration
stage). No new finding here -- this matches `apply-progress.md`'s own accounting exactly,
independently recomputed via `git diff --stat` in this pass.

---

## 11. Recommendation

**Archive-ready with WARNING findings.** No CRITICAL blocks archive. The four WARNING findings are
test-suite gaps for behaviors that are themselves correct (independently proven at runtime in this
pass) -- they are a risk to future regressions, not to the current change's correctness. Recommend
either (a) archiving as-is with W1-W4 carried forward as a small fast-follow test-hardening task, or
(b) a short follow-up commit adding the four missing tests before archive, at the user/orchestrator's
discretion given the change is already at its accepted size exception.
