# Tasks: Encoding-Aware Reads

## Review Workload Forecast

| Task group | Estimated changed lines |
|---|---|
| Phase 1–2: `decode-text.ts` + `decode-text.test.ts` (new) | ~260–320 |
| Phase 3–4: `file-document-source.ts` + its test (modify) | ~85–105 |
| Phase 5: `generate-perf-corpus.mjs` comment + `CLAUDE.md` entry | ~15–20 |
| **PR #1 subtotal** | **~360–445** |
| Phase 6: `ports.ts` + notice collection in `file-document-source.ts` | ~15–20 |
| Phase 7–8: report threading (6 `src/` files) + 3 test files | ~180–230 |
| Phase 9: manual gates (no code diff) | 0 |
| **PR #2 subtotal** | **~195–250** |
| **Total** | **~555–695** |

```text
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: Medium
```

| Field | Value |
|---|---|
| Delivery strategy | ask-on-risk |
| Chain strategy | pending — `chain_strategy` was not yet chosen at this gate |
| Recommended chain strategy (needs confirmation) | stacked-to-main |

**This revises the proposal's 240–420 line estimate**, not restates it. The proposal's variance
assumption ("almost all the variance is report threading") does not hold post-design: PR #1 (the
decoder) is now the larger and riskier half, because the table-driven test suite the design
requires — all 27 CP1252 overrides asserted by exact code point, the 5 unassigned bytes, the C0/DEL
reject set, `TAB`/`LF`/`FF`/`CR` non-rejection, and three BOM scenarios — was not itemized at that
granularity in the exploration. PR #2's per-file changes are genuinely small (`~3–15` lines each,
per design's own estimate for `generate-index-md.ts`), so its subtotal comes in well under budget.

**PR #1 is the one to watch.** Its upper bound (~445) crosses 400 on its own. Do not fracture the
decoder+adapter cut line to fix this (the design requires it stay one PR — "corruption stops and
undecodable content is named, with zero contract change" is one correctness claim). Instead, if the
real diff lands high, use `work-unit-commits`: land Phase 1–2 (decoder + its tests) and Phase 3–5
(adapter wiring + docs) as separate, clearly-scoped commits inside the same PR so a reviewer can
review them independently even though they ship together.

**Recommended chain strategy: stacked-to-main**, pending user confirmation. PR #1 is independently
mergeable and valuable on its own (fixes the corruption defect; no contract change). PR #2 depends
only on PR #1's merged code, not on a shared tracker branch, so a feature-branch-chain adds
coordination cost with no corresponding benefit here.

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|---|---|---|---|
| 1 | `decodeText` + `FileDocumentSource` wired to it; undecodable content via the *existing* `readErrors`/`skipped` plumbing | PR 1 | Base: `main`. Zero contract change — corruption stops and undecodable content is named on its own. |
| 2 | `EncodingNotice` threaded through `ports.ts` → 3 reports → `docs_overview` → CLI | PR 2 | Base: `main`, post PR #1 merge. Adds the "loud even when perfect" reporting layer (Gate 2). |

---

## Work Unit 1 — Decoder + Adapter (PR #1, base: `main`)

### Phase 1: `decodeText` — RED

- [x] 1.1 Create `test/infrastructure/decode-text.test.ts`: table-driven test asserting all **27** CP1252 overrides (design Decision 1) decode to their exact code points — the test that must fail for `latin1` and for `TextDecoder('windows-1252')`
- [x] 1.2 Add: each of the 5 unassigned C1 bytes (`0x81`, `0x8D`, `0x8F`, `0x90`, `0x9D`) individually → `ok: false`, reason names the byte and offset (Decision 2 — absence from the map, not a second list)
- [x] 1.3 Add: C0 controls `0x00–0x08`, `0x0B`, `0x0E–0x1F` and `0x7F` → `ok: false`; `TAB`/`LF`/`FF`/`CR` do **not** reject (Decision 3)
- [x] 1.4 Add: `0xA0–0xFF` accented range, ASCII passthrough, empty buffer, valid UTF-8 passthrough is byte-identical (Req: Valid UTF-8 Is Unaffected)
- [x] 1.5 Add: UTF-8 BOM stripped; UTF-16LE BOM decoded+stripped; UTF-16BE BOM decoded+stripped via `swap16`; odd-length UTF-16 buffer → `ok: false`; `EF BB BF` followed by invalid UTF-8 → `ok: false` naming the contradiction (Decision 4, Req: UTF-16 BOM scenario)
- [x] 1.6 Run `npx vitest run test/infrastructure/decode-text.test.ts` — confirm RED (module does not exist)

### Phase 2: `decodeText` — GREEN

- [x] 2.1 Create `src/infrastructure/fs/decode-text.ts`: `DecodedEncoding`, `DecodeResult` types, `decodeText(bytes: Buffer): DecodeResult` skeleton
- [x] 2.2 Implement BOM sniff **before** the UTF-8 gate: `FF FE`/`FE FF` → UTF-16LE/BE (`Buffer.from(bytes).swap16().toString("utf16le")` for BE); odd length fails (Decision 4)
- [x] 2.3 Implement `isUtf8(bytes)` gate → `"utf-8"`; `EF BB BF` + failed `isUtf8` → contradiction failure, distinct message (Decision 4)
- [x] 2.4 Implement the CP1252 path: 27-entry `Map<number, number>` transcribed exactly from design.md's Decision 1 table, Decision 3's reject byte-set, identity fallback for everything else. **No `TextDecoder` import anywhere in this file** — this is the change's own stated highest-likelihood regression
- [x] 2.5 Strip one leading `U+FEFF` from the decoded output, whatever the encoding (Decision 5)
- [x] 2.6 Run `npx vitest run test/infrastructure/decode-text.test.ts` until green; `npm run typecheck`

### Phase 3: Wire `FileDocumentSource` — RED

- [x] 3.1 `test/infrastructure/file-document-source.test.ts`: fix `realReadFile` to return a `Buffer` (drop the hardcoded `"utf8"` argument) so the existing `readFile`/`readdir` mocks match the new raw-byte contract
- [x] 3.2 Add: a CP1252-byte temp file (curly quotes/dash/ellipsis + accented vowels) decodes to the correct content, zero `readErrors`
- [x] 3.3 Add: a binary (non-UTF-8, non-plausible-CP1252) temp file lands in `readErrors` with a message distinguishable from the generic I/O error, absent from `files`
- [x] 3.4 Add: a UTF-16LE-with-BOM temp file decodes correctly
- [x] 3.5 Run `npx vitest run test/infrastructure/file-document-source.test.ts` — confirm RED

### Phase 4: Wire `FileDocumentSource` — GREEN

- [x] 4.1 `src/infrastructure/fs/file-document-source.ts:54`: `readFile(join(dir, entry.name), "utf8")` → `readFile(join(dir, entry.name))` (raw `Buffer`, no encoding argument)
- [x] 4.2 Route the buffer through `decodeText`; `ok: false` → `readErrors.push({ path, error: reason })` (undecodable never reaches `files`)
- [x] 4.3 `ok: true` → `out.push({ path, content })`
- [x] 4.4 Run `npx vitest run test/infrastructure/file-document-source.test.ts` until green

### Phase 5: PR #1 Documentation and Gate

- [x] 5.1 `scripts/generate-perf-corpus.mjs:169` — correct the comment: latin1 is CP1252-compatible only for `0xA0–0xFF`, not in general; not a model for the decoder
- [x] 5.2 `CLAUDE.md` — add the non-obvious-decisions entry: `TextDecoder('windows-1252')` measured broken on this project's Node floor (decodes byte-for-byte identically to `latin1`), the repro command, and why `decode-text.ts` bans `TextDecoder` outright
- [x] 5.3 `npm test`, `npm run typecheck`, `npm run build` all green. Confirm the four in-memory `DocumentSource` fakes (`index-progress.test.ts:93`, `sync-index.test.ts:42`, `index-and-search.test.ts:282`, `generate-index-md.test.ts:43`) compile **unchanged** (Gate 4, Decision 6) — do not edit these four files in this work unit

---

## Work Unit 2 — Notice Threading (PR #2, base: `main`, post PR #1 merge)

### Phase 6: `DiscoverResult.encodingNotices` — Contract

- [x] 6.1 `src/domain/ports.ts`: add `EncodingNotice { path: string; encoding: string }` and `DiscoverResult.encodingNotices?: EncodingNotice[]` (Decision 6, mirrors `ReadError`/`readErrors` shape and placement). Re-confirm the four fakes still compile unchanged — they simply omit the new optional field
- [x] 6.2 `src/infrastructure/fs/file-document-source.ts`: collect an `EncodingNotice` per non-`"utf-8"` `ok: true` decode; `discover()` now returns `{ files, readErrors, encodingNotices }`. (RED/GREEN pair added to `file-document-source.test.ts`: "reports a transcoded CP1252 file as an encoding notice" / "produces no encoding notice for a plain UTF-8 corpus" — not itemized in the original task text, added to honor Strict TDD's "test before production code" law at this layer too.)

### Phase 7: Report Threading — RED

- [x] 7.1 `test/application/index-and-search.test.ts`: new `describe` block — write a temp docs dir with a CP1252 file (curly quotes/dash/ellipsis + accented vowels) via `writeFileSync` with a raw byte buffer (temp-dir pattern already used at `:536`; no committed fixture, per design's rejection of `.gitattributes`-pinned fixtures). Do not touch the existing fake `DocumentSource` at `:282`. (CP1252 byte-encoder factored into a new shared `test/helpers/cp1252.ts` rather than duplicated per test file.)
- [x] 7.2 Add: `IndexDocuments` end-to-end over that dir — stored chunk content has zero `U+FFFD`; `U+201C`, `U+201D`, `U+2013`, `U+2026`, `U+00F3` all present (Gate 1)
- [x] 7.3 Add: `report.encodingNotices` contains the file's path with `encoding: "windows-1252"`; the path is **not** in `report.skipped` (Gate 2)
- [x] 7.4 Add: the existing UTF-8-only `ejemplos/` harness leaves `report.encodingNotices` `undefined` (no warning noise on a healthy corpus)
- [x] 7.5 `test/application/get-overview.test.ts`: extend the `toSyncInfo — content-based omission` block — non-null for a `SyncReport` whose only finding is a populated `encodingNotices`
- [x] 7.6 Add: `formatOverview` renders an encoding-notice line in the `Sync:` block when `sync.encodingNotices` is present
- [x] 7.7 `test/application/generate-index-md.test.ts`: add a small new `DocumentSource` stub (separate from `StaticSource`, which stays untouched per Decision 6) returning `encodingNotices`; assert the transcoded document is still listed in `INDEX.md` and reported, filtered on `path !== INDEX_FILE`
- [x] 7.8 Run all three files above — confirm RED (fields/rendering not yet implemented)

### Phase 8: Report Threading — GREEN

- [x] 8.1 `src/application/index-documents.ts`: `IndexReport.encodingNotices?`; export `formatEncodingNotice(notice): string` beside `IndexedFileReport`/`SkippedFileReport` (`` `${path}: not UTF-8 — decoded as ${encoding} and indexed; re-save as UTF-8 to silence this` ``); `execute()` copies `discover()`'s notices onto the report when non-empty
- [x] 8.2 `src/application/sync-index.ts`: `PassState` gains an `encodingNotices` accumulator; `processNewAndChanged` carries per-file notices from `discover()`; `SyncReport.encodingNotices?` set when non-empty
- [x] 8.3 `src/application/get-overview.ts`: `SyncInfo.encodingNotices?`; **extend `toSyncInfo`'s null rule** to also require `encodingNotices` empty/absent — the load-bearing fix design.md calls out; without it a pass whose only finding is a transcode renders nothing in `docs_overview` and Gate 2 fails. Render notices in `formatOverview`'s `Sync:` block via `formatEncodingNotice`
- [x] 8.4 `src/application/generate-index-md.ts`: `IndexMdReport.encodingNotices?`, filtered on `path !== INDEX_FILE` exactly as `skipped` already is (Decision 8)
- [x] 8.5 `src/cli.ts`: warn loop after the existing `skipped` loop in the `index` action (after `:54`), and in the `index-md` action (after `:80`), each printing `formatEncodingNotice` per notice
- [x] 8.6 Run `npx vitest run test/application/index-and-search.test.ts test/application/get-overview.test.ts test/application/generate-index-md.test.ts` until green; `npm run typecheck`

### Phase 9: Manual Gates and Final Sign-off

- [x] 9.1 Manual Gate 3: two indexes via `node scripts/generate-perf-corpus.mjs <dir> [--cp1252]`, compare with `scripts/rank-probe.mjs` — ranks identical after. **This gate is non-discriminating on its own**: `--cp1252` writes with `latin1` (`generate-perf-corpus.mjs:170`), producing no `0x80–0x9F` byte, so it would pass with a latin1-only decoder too. Gate 3 proves rank identity, not the table — **Gate 1 (Phase 1 unit tests + Phase 7.2) is the gate that actually discriminates** a correct decoder from `latin1`/`TextDecoder('windows-1252')`. Record both runs in `verify-report.md`, stating this distinction explicitly. **PASSED** — both the UTF-8 and CP1252 corpora (38 docs, 358 chunks each) produced byte-identical ranks at every retrieval stage (lexical, vector, fused, capped, returned) for the `QUETZAL-7731` marker chunk; see `verify-report.md`
- [x] 9.2 Manual Gate 4: `node dist/cli.js --root ejemplos eval` — MRR ≥ 0.943, recall@5 = 1.00, top-1 ≥ 20/22, unmoved (valid UTF-8 decodes identically). Record in `verify-report.md`. **PASSED** — hybrid MRR = 0.943, recall@5 = 1.00, 0 hybrid failures, bit-identical to the project's documented `ejemplos/` baseline; see `verify-report.md`
- [x] 9.3 Full suite: `npm test`, `npm run typecheck`, `npm run build` green; diff review against design.md's File Changes table — every listed file touched, nothing else. **Confirmed**, with one noted gap in design.md's own table (not a deviation from the design's actual contract, which already specified these two files' changes in its "Interfaces/Contracts" and "Report flow" sections): `test/application/get-overview.test.ts` and `test/application/generate-index-md.test.ts` were modified per tasks.md 7.5–7.7 but were not itemized in design.md's File Changes table. Also added, not itemized either: `test/helpers/cp1252.ts` (a shared CP1252 byte-encoder factored out for the three test files that needed one, replacing what would otherwise be three copies of the same table)
