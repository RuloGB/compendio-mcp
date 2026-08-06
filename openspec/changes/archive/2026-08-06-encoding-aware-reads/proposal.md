# Proposal: Encoding-Aware Reads

## Intent

`FileDocumentSource` reads every `.md` as UTF-8 unconditionally
(`src/infrastructure/fs/file-document-source.ts:54`). Node does not throw on invalid UTF-8 — it
substitutes `U+FFFD` — so the surrounding `try/catch` is not a safety net. The read "succeeds",
nothing reaches `readErrors`, and a corrupted document is reported as indexed.

Measured on a real 38-document corpus (`IMPROVEMENTS.md` §1): **1 file was CP1252**, 3 191 non-ASCII
bytes were destroyed, **89 of 89** of its chunks were corrupted, and the chunk holding the answer to
a real query fell from lexical rank 2 to rank 36 and was evicted before reaching the caller. FTS5's
`unicode61 remove_diacritics 2` normalizes `sección` → `seccion`, but the index holds
`secci<U+FFFD>n`, which tokenizes as `secci` + `n`. The term cannot match.

After this change, **no file is decoded on an assumption**: it is decoded on evidence, or it is
skipped and named.

## Scope

### In Scope

- **`decode-text.ts`** (new, `src/infrastructure/fs/`, pure): BOM sniff → `buffer.isUtf8()` gate →
  CP1252 fallback → error. Returns the decoded string plus what it decided.
- **`FileDocumentSource` reads raw bytes** and routes them through it. This one site covers `index`,
  `serve`'s incremental sync and `index-md` — all three call `discover()` on the same injected port
  (`src/domain/ports.ts:34`), and `src/composition.ts:72` wires exactly one implementation.
- **A transcoded file is always reported**, even when transcoding is perfect. Threaded through
  `ports.ts` → `IndexReport` → `SyncReport` → `SyncInfo` → `formatOverview` → `cli.ts`, as an
  **optional** field, mirroring `embeddingsWarning` call site for call site.
- **Surfaces on the CLI (`index`, `index-md`) and in `docs_overview`** — the only MCP path that
  already carries `skipped`/`embeddingsWarning`, so no new contract shape is introduced.
- **Genuinely undecodable content gets its own `skipped` message**, distinct from a generic read
  error.

### Out of Scope

| Item | Why |
|---|---|
| `src/cli.ts:207` (`loadGoldenset`), `src/infrastructure/config.ts:76` (`loadConfig`) | Same code pattern, different risk profile: dev-only and hand-authored files, no cited or plausible non-UTF-8 instance. Deferred, not overlooked |
| `file-index-writer.ts:20`, `server.ts:22`, `scripts/vector-reach.mjs:205` | Self-generated, npm-shipped ASCII, or dev-only |
| Encodings beyond UTF-8 / UTF-16-BOM / CP1252 | Decision 2 below. A different legacy corpus reported later is new evidence and a new, narrow change |
| A config key for encoding | Detection is unconditional and evidence-driven. Nothing to tune |
| `IMPROVEMENTS.md` §2 (blind lead excerpt) and §3 (unaddressable heading-less chunks) | Separate changes |
| Migrations, schema markers, compat shims | Beta, no installed users (`config.yaml` proposal rules) |

## Capabilities

### New Capabilities

- None. The decoder is an implementation detail inside `indexing`.

### Modified Capabilities

- `indexing`: reads are encoding-aware; a transcoded document is reported while still being indexed;
  undecodable bytes become a new, mode-independent skip reason under *Resilience Skip Reasons Apply
  in Both Modes*.
- `mcp-contract`: *Sync-Status Visibility in `docs_overview` Response* (spec line 85) currently lists
  `skipped` and `embeddingsWarning` "at minimum". A delta MUST add the encoding notice explicitly —
  leaving it to "at minimum" makes an untested reading load-bearing.
- `index-md`: *Skip-and-Report Resilience Matches Indexing* extends to the new skip reason and to the
  transcode notice, since `index-md` reads through the same port.

## Approach

Adapter-local, zero new dependencies.

1. `readFile(path)` with no encoding argument.
2. **BOM sniff** — UTF-8, UTF-16LE, UTF-16BE. Explicit bytes, no guessing.
3. **`buffer.isUtf8()`** (measured present and exact on the floor runtime) decides UTF-8 outright.
   Only what fails this gate needs a fallback.
4. **CP1252**: `latin1` plus an in-repo **32-entry override table for `0x80–0x9F`**.
5. Anything neither valid UTF-8 nor plausibly CP1252 → the error path. Never silently corrupted.

Decoding runs *before* a `DocumentFile.content` string exists, which makes it an adapter concern by
construction. `src/domain/` stays free of `Buffer`. No new port: `DocumentSource` is already the
"how documents are read" seam, and a second interface with one caller and no plausible second
implementation is speculative abstraction.

### The constraint that forces the hand-written table

**`TextDecoder('windows-1252')` is broken on this project's Node floor.** Measured on v22.22.0 with
full ICU (`icu_small=false`): it decodes **byte-for-byte identically to `latin1`**, mapping `0x93` →
`U+0093` (a C1 control) instead of `U+201C` (`“`). It does not throw and it returns a `string`, so
nothing detects the mistake. The same runtime decodes `windows-1251`, `koi8-r` and `shift_jis`
correctly — this is a `windows-1252` table defect specifically, not a general legacy-encoding
problem. Full table and reproduction command: `exploration.md` §3.

Consequence, stated plainly because a future reader will otherwise "simplify" it back to the broken
one-liner: **neither `TextDecoder('windows-1252')` nor `readFile(path, 'latin1')` is an acceptable
decoder.** The in-repo table is not a stylistic preference; it is the only correct option available
without a dependency. Re-run `exploration.md` §3's command before reconsidering.

Related: `scripts/generate-perf-corpus.mjs:169` writes its CP1252 fixture with `latin1` under a
comment claiming latin1 is CP1252-compatible. True for the accented vowels it generates
(`0xA0–0xFF`); false in general. The generator is correct for its own purpose and **must not be
treated as a model for the decoder**.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/infrastructure/fs/decode-text.ts` | New | BOM sniff, `isUtf8` gate, CP1252 table, decode result |
| `src/infrastructure/fs/file-document-source.ts` | Modified | Raw-byte read, decode call, notice collection |
| `src/domain/ports.ts` | Modified | Optional encoding-notice shape on the discover result |
| `src/application/{index-documents,sync-index,get-overview,generate-index-md}.ts` | Modified | Thread the notice into the reports |
| `src/cli.ts` | Modified | `console.warn` wiring, alongside the existing skip/embeddings warns |
| `test/fixtures/` + `.gitattributes` | New | CP1252 fixture with `0x80–0x9F` bytes, marked `-text` |
| `openspec/specs/{indexing,mcp-contract,index-md}` | Modified | Delta specs |
| `CLAUDE.md` | Modified | Non-obvious-decisions entry, including the `windows-1252` measurement |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| A later change "simplifies" the table into `TextDecoder('windows-1252')` or `latin1` | **High** | Gate 1 asserts the `0x80–0x9F` range specifically — it fails immediately for both. Recorded here, in `CLAUDE.md`, and in the spec |
| The 32 byte→codepoint pairs are transcribed from memory and one is wrong | Med | Verify every pair against the Unicode consortium `CP1252.TXT` mapping during design; unit-test all 32 |
| Fixture bytes rewritten by git EOL conversion or an editor re-save | Med | Generated by script, never opened in an editor; committed with `.gitattributes -text` (binary: no EOL conversion, no diff) |
| Binary misnamed `.md` transcoded into plausible-looking garbage | Med | Decision 4: it fails to the error path with its own message. Never a silent fallback |
| A valid-UTF-8 file misclassified as CP1252 | Low | `buffer.isUtf8()` is exact and runs first; the fallback is unreachable for valid UTF-8 |
| Report threading exceeds the 400-line PR budget | Med | Surfaced as a decision at the `sdd-tasks` gate (below), not absorbed silently |

## Rollback Plan

1. Revert the change commits and `npm run build`.
2. **No re-index is required, in either direction.** The incremental fingerprint is
   `computeHash(content)` over the already-decoded string (`src/application/index-pipeline.ts:33-35`),
   so a file whose decoding changes produces a different hash and `SyncIndex` re-indexes it
   unassisted. Applying the fix self-heals a corrupted corpus on the next `serve` sync pass;
   reverting restores the previous (corrupted) content the same way.

This is the opposite case from `bounded-chunk-size`, where bytes were identical and only config
moved, so a full `compendio index` was mandatory. Here nothing needs a forced rebuild.

## Dependencies

- **Zero new npm dependencies.** `chardet` + `iconv-lite` are rejected on the record (decision 2).
- In-repo instruments, all existing: `scripts/generate-perf-corpus.mjs --cp1252`,
  `scripts/rank-probe.mjs`, `compendio eval` + `ejemplos/goldenset.yaml`.
- A new committed CP1252 fixture carrying `0x80–0x9F` bytes — created by this change, because the
  existing generator cannot produce that range.

## Success Criteria

Each gate can **fail and stop the change**. None is a restatement of intent.

### Gate 1 — The `0x80–0x9F` range (BLOCKING)

A CP1252 document containing curly quotes (`0x93`/`0x94`), an en dash (`0x96`) and an ellipsis
(`0x85`), plus accented vowels from `0xA0–0xFF`, indexed end to end:

- [ ] Stored chunk content contains **zero** `U+FFFD`
- [ ] The exact code points `U+201C`, `U+201D`, `U+2013`, `U+2026`, `U+00F3` are present

**This gate fails for `latin1` and for Node's `TextDecoder('windows-1252')`.** If it ever passes with
either, the gate is not measuring what it claims and must be fixed before the change proceeds.

### Gate 2 — The report is loud (BLOCKING)

- [ ] The Gate 1 fixture appears in the `index` report **even though transcoding was perfect**
- [ ] It appears in `docs_overview`'s sync surface after an incremental pass
- [ ] It is **not** in `skipped` — it was indexed

A silent success fails the change; the silent success *is* the defect.

### Gate 3 — Reproduce the reported failure (BLOCKING)

Two indexes of the same corpus, encoding the only variable:
`node scripts/generate-perf-corpus.mjs <dir> --cp1252` and the same without.

- [ ] **Before**: `scripts/rank-probe.mjs` reproduces the measured split — answer chunk at lexical
      #36 and evicted in the CP1252 index, lexical #2 / RRF #1 / returned in the UTF-8 index
- [ ] **After**: the two indexes rank **identically** for the same query and needle

Identity is the right assertion, not a tolerance band: once decoding is correct, both corpora decode
to the same strings, so the hashes, chunks and ranks must match exactly. A residual difference
falsifies the fix.

### Gate 4 — No collateral damage

- [ ] `compendio eval` on `ejemplos/` (UTF-8 throughout): MRR ≥ 0.943, recall@5 = 1.00,
      top-1 ≥ 20/22 — these must not move **at all**, since valid UTF-8 decodes identically
- [ ] `npm test`, `npm run typecheck`, `npm run build` pass
- [ ] The four existing tests that build their own in-memory `DocumentSource` fake compile unchanged
      (the new field is optional)

### Gate 5 — Undecodable is named, not guessed

- [ ] Binary content misnamed `.md` is reported in `skipped` with a message distinguishable from a
      generic "could not open the file" error
- [ ] It is never transcoded

## Resolved decisions

Recorded so later phases do not re-litigate them.

| Question | Decision |
|---|---|
| A detected non-UTF-8 file that decodes cleanly | **Transcode and always report**, even when perfect. A mixed-encoding corpus is nearly always an accident the owner wants to know about, and it matches the codebase idiom — `embeddingsWarning` and `filterWarning` both degrade loudly |
| Encoding coverage | **CP1252 + UTF-16 with BOM only**, zero new dependencies. `chardet`/`iconv-lite` rejected: two dependencies for one evidenced encoding, and statistical detection trades a *deterministic* bug for a *probabilistic* one |
| Where the warning surfaces | **CLI and `docs_overview`.** No new MCP contract shape |
| Genuinely undecodable content | **Its own `skipped` message.** "Unknown encoding" and "could not open the file" are different problems with different fixes |
| Decoder implementation | **In-repo 32-entry table.** Forced by measurement, not preference (see Approach) |

## Delivery size — a decision for the `sdd-tasks` gate

`exploration.md` §9 estimates **~240–420 changed lines** against a 400-line PR budget. Almost all the
variance is report threading: `ports.ts` → `IndexReport` → `SyncReport` → `SyncInfo` →
`formatOverview` → `cli.ts`.

This proposal does **not** resolve it. At the review-workload gate the choice is between chained PRs
(natural cut line: decoder + `FileDocumentSource` first, report threading second — the decoder is
independently testable and independently valuable) and an accepted `size:exception`. Flagged here so
it is a decision rather than a surprise at apply time.
