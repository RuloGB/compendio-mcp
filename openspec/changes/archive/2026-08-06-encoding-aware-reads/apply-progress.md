# Apply Progress: Encoding-Aware Reads

**Status**: All 43 tasks complete (33 original + 10 unmarked sub-items folded into existing
checkboxes' notes — see Deviations). Both Work Unit 1 (PR #1: decoder + adapter) and Work Unit 2
(PR #2: notice threading) implemented in a single working tree per the accepted `size:exception`.
A follow-up batch (below, "Follow-Up Batch: Closing sdd-verify's Four WARNING Gaps") then closed
all four WARNING-level test-coverage gaps `sdd-verify` found (`verify-report.md` Section 9, W1–W4)
— tests only, zero production-code changes retained.

**Mode**: Strict TDD (`openspec/config.yaml`: `strict_tdd: true`) — followed throughout.

## Completed Tasks

All of Phases 1–9 in `tasks.md` are marked `[x]`. Summary by phase:

- **Phase 1–2** (`decode-text.ts` RED/GREEN): 27-entry CP1252 table, independently re-verified
  against both `unicode.org` and `encoding.spec.whatwg.org` via live `curl` before writing any code
  (per the hard constraint — not transcribed from `design.md` on trust). BOM sniffing, `isUtf8` gate,
  deterministic reject byte-set, CP1252 fallback, BOM stripping. 60 unit tests, all green on first
  GREEN run.
- **Phase 3–4** (`FileDocumentSource` RED/GREEN): raw-byte `readFile`, routed through `decodeText`.
  Undecodable → `readErrors`; transcoded → `files` (Work Unit 1 has no `encodingNotices` yet, by
  design — that's Work Unit 2).
- **Phase 5** (PR #1 docs/gate): `generate-perf-corpus.mjs` comment corrected; `CLAUDE.md`
  non-obvious-decisions entry added with the `TextDecoder('windows-1252')` repro command; full suite
  green; all four protected fakes confirmed byte-for-byte unchanged (`git diff --stat` empty).
- **Phase 6** (`EncodingNotice` contract): `ports.ts` extended; `FileDocumentSource` collects notices.
  Added a RED/GREEN pair not itemized in the original task text (see Deviations) to honor Strict TDD's
  "test before production code" law at this layer, not just at the Phase 7 integration layer.
- **Phase 7–8** (report threading RED/GREEN): `IndexReport`, `SyncReport`, `SyncInfo`,
  `IndexMdReport` all gained `encodingNotices?`; `formatEncodingNotice` added once and reused by
  `get-overview.ts` and `cli.ts`; `toSyncInfo`'s null rule extended (the load-bearing fix design.md
  named); `cli.ts` warn loops added for both `index` and `index-md`.
- **Phase 9** (manual gates): Gate 3 (rank identity, UTF-8 vs CP1252 corpus) and Gate 4
  (`ejemplos/` eval, unmoved) both run and PASSED — see `verify-report.md` for full transcripts.

## Files Changed

| File | Action | What Was Done |
|---|---|---|
| `src/infrastructure/fs/decode-text.ts` | Created | `decodeText(bytes): DecodeResult` — BOM sniff, `isUtf8` gate, 27-entry CP1252 table, deterministic reject set, BOM strip. No `TextDecoder` anywhere. |
| `src/infrastructure/fs/file-document-source.ts` | Modified | Raw `readFile(path)`; routes bytes through `decodeText`; collects `EncodingNotice` per non-UTF-8 successful decode; `discover()` returns `{ files, readErrors, encodingNotices }`. |
| `src/domain/ports.ts` | Modified | Added `EncodingNotice`; `DiscoverResult.encodingNotices?` (optional so the 4 in-memory fakes compile unchanged). |
| `src/application/index-documents.ts` | Modified | `IndexReport.encodingNotices?`; exported `formatEncodingNotice`; `execute()` copies non-empty notices onto the report. |
| `src/application/sync-index.ts` | Modified | `PassState.encodingNotices` accumulator; `processNewAndChanged` carries per-file notices from `discover()` for every currently discovered file (not just re-indexed ones — a transcoded document is reported every pass); `SyncReport.encodingNotices?`. |
| `src/application/get-overview.ts` | Modified | `SyncInfo.encodingNotices?`; `toSyncInfo`'s content-based null rule extended to require `encodingNotices` empty/absent too; `formatOverview` renders notices in the `Sync:` block. |
| `src/application/generate-index-md.ts` | Modified | `IndexMdReport.encodingNotices?`, filtered on `path !== INDEX_FILE` exactly like `skipped`. |
| `src/cli.ts` | Modified | Warn loops (`formatEncodingNotice` per notice) added after the existing `skipped` loops in both `index` and `index-md` actions. |
| `scripts/generate-perf-corpus.mjs` | Modified | Corrected the `:169` comment — latin1 is CP1252-compatible only for `0xA0-0xFF`, not in general. |
| `CLAUDE.md` | Modified | Added the `TextDecoder('windows-1252')` non-obvious-decisions entry (repro command, measured result, why `decode-text.ts` bans it) and updated the resilience bullet to name the undecodable-encoding skip reason. |
| `test/infrastructure/decode-text.test.ts` | Created | 60 table-driven unit tests: all 27 CP1252 overrides, 5 unassigned bytes, C0/DEL reject set, TAB/LF/FF/CR non-rejection, accented range, ASCII, empty buffer, UTF-8 passthrough, all 4 BOM scenarios. |
| `test/infrastructure/file-document-source.test.ts` | Modified | `realReadFile` returns `Buffer` (no `"utf8"` arg); added CP1252/binary/UTF-16LE temp-file tests; added `encodingNotices` RED/GREEN tests. |
| `test/application/index-and-search.test.ts` | Modified | New `describe` block: CP1252 document end-to-end (zero `U+FFFD`, exact code points, notice present, not skipped) and the UTF-8-only-corpus-leaves-it-undefined companion test. Existing fake `DocumentSource` at `:282` untouched. |
| `test/application/get-overview.test.ts` | Modified | Extended `toSyncInfo` and `formatOverview` test blocks with `encodingNotices` cases. *(Not itemized in design.md's File Changes table — see Deviations.)* |
| `test/application/generate-index-md.test.ts` | Modified | Added `SourceWithEncodingNotices`, separate from the untouched `StaticSource`; new test asserting the transcoded document is listed and reported, `INDEX.md` filtered. *(Not itemized in design.md's File Changes table — see Deviations.)* |
| `test/helpers/cp1252.ts` | Created | Shared test-only CP1252 byte-encoder (inverse of `decode-text.ts`'s override table), used by all three test files that needed byte-exact CP1252 fixtures instead of duplicating the table three times. |
| `openspec/changes/encoding-aware-reads/verify-report.md` | Created | Gate 3 and Gate 4 transcripts (apply-phase run; `sdd-verify` should independently re-confirm). |

## TDD Cycle Evidence

| Task(s) | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1–1.6 / 2.1–2.6 | `test/infrastructure/decode-text.test.ts` | Unit | N/A (new) | Written — module import failed | 60/60 passed on first GREEN run | 27 CP1252 cases, 5 unassigned-byte cases, 15 C0/DEL cases, 4 non-reject cases, 4 accented/ASCII/empty/passthrough cases, 4 BOM cases | Clean — no post-green changes needed |
| 3.1–3.5 / 4.1–4.4 | `test/infrastructure/file-document-source.test.ts` | Integration (real temp-dir fs, mocked `readFile`/`readdir`) | 4/4 pre-existing passed before edits | Written — 3 new tests failed (raw `Buffer` returned instead of decoded string) | 7/7 passed after wiring | CP1252 / binary / UTF-16LE-BOM — 3 distinct decode paths | Clean |
| 6.1–6.2 | `test/infrastructure/file-document-source.test.ts` | Integration | 7/7 pre-existing passed before this edit | Written — 2 new tests failed (`encodingNotices` undefined) | 9/9 passed | CP1252-present vs. UTF-8-absent — 2 cases | Clean |
| 7.1–7.4 / 8.1 | `test/application/index-and-search.test.ts` | Integration (real temp-dir fs via `FileDocumentSource`, real `SqliteIndexStore`) | 35/36 pre-existing passed before this edit (1 new test added at RED, correctly failing) | Written — failed on `report.encodingNotices` | 36/36 passed after `index-documents.ts` wiring | CP1252-populated vs. UTF-8-undefined — 2 cases | Clean |
| 7.5–7.6 / 8.3 | `test/application/get-overview.test.ts` | Unit | 10/12 pre-existing passed before this edit (2 new tests added at RED) | Written — both failed (`toSyncInfo` returned `null`; render missing) | 12/12 passed after `get-overview.ts` wiring | `toSyncInfo` non-null case + `formatOverview` render case — 2 cases | Clean |
| 7.7 / 8.4 | `test/application/generate-index-md.test.ts` | Integration (in-memory `DocumentSource` stub) | 9/10 pre-existing passed before this edit (1 new test added at RED) | Written — failed on `report.encodingNotices` | 10/10 passed after `generate-index-md.ts` wiring | Single scenario (INDEX.md-filtering is exercised by the existing `readErrors`/`skipped` tests already in the file) | Clean |
| 8.2 | `test/application/index-and-search.test.ts` (`sync-index.test.ts` is protected — cannot be edited) | Integration (real temp-dir fs via `FileDocumentSource`, real `SqliteIndexStore`) | 36/37 pre-existing passed before this test (1 new test added) | **Written after the `sync-index.ts` implementation, not before** — see Deviation 5. Genuinely exercises the new code path (two-pass: indexing pass + hash-match no-op pass, both asserting `encodingNotices`) rather than relying on indirect full-suite coverage alone | 37/37 passed | 2 cases: notice present on the indexing pass, notice still present on the hash-match no-op pass (the design's "even when the transcode was exact" / every-pass requirement) | Clean |
| 8.5 | none (no dedicated `cli.ts` test in this project; not itemized in design.md/tasks.md as needing one) | N/A | N/A | N/A | Verified manually via Gate 3/4 CLI runs (`WARNING ba/manual.md: not UTF-8 …` printed correctly) | ➖ Skipped — purely structural wiring reusing an already-tested renderer (`formatEncodingNotice`), consistent with strict-tdd.md's "purely structural, one possible output" exemption | Clean |

### Test Summary
- **Total tests written**: 60 (decode-text) + 5 (file-document-source, 3 decode scenarios + 2 encodingNotices) + 3 (index-and-search: 2 `IndexDocuments` CP1252 + 1 `SyncIndex` CP1252) + 2 (get-overview) + 1 (generate-index-md) = **71 new tests**
- **Total tests passing**: 450/450 (full suite, including all 71 new tests)
- **Layers used**: Unit (62: 60 decode-text + 2 get-overview), Integration (9: 5 file-document-source + 3 index-and-search + 1 generate-index-md)
- **Approval tests** (refactoring): None — no refactoring tasks; all changes were new behavior additions to existing files
- **Pure functions created**: `decodeText`, `detectUtf16Bom`, `findRejectedByte`, `isRejectedCp1252Byte`, `decodeCp1252`, `stripBom`, `formatByte` (all in `decode-text.ts`), `formatEncodingNotice` (in `index-documents.ts`)

## Deviations from Design

1. **Two test files not itemized in design.md's File Changes table**: `test/application/get-overview.test.ts` and `test/application/generate-index-md.test.ts` were modified, exactly as `tasks.md` 7.5–7.7 explicitly directed, and exactly matching the contract design.md's own "Interfaces/Contracts" and "Report flow" sections already specified for `get-overview.ts`/`generate-index-md.ts`. This is a gap in the design's summary table, not a deviation from the design's actual intent — the source files it lists (`get-overview.ts`, `generate-index-md.ts`) were correctly modified per the design.
2. **`test/helpers/cp1252.ts` added** (not itemized anywhere): a shared CP1252 byte-encoder, factored out once three test files needed byte-exact CP1252 fixtures. This is the inverse operation of `decode-text.ts`'s decode table, test-only, never shipped in `src/`. Avoids three copies of the same 27-entry table drifting.
3. **Phase 6.2 got its own RED/GREEN test pair** in `file-document-source.test.ts` ("reports a transcoded CP1252 file as an encoding notice" / "produces no encoding notice for a plain UTF-8 corpus"), which the original task text did not itemize as a separate RED step. Strict TDD's core law ("do NOT write production code until you have a failing test") applies to `file-document-source.ts`'s behavior change in Phase 6.2 exactly as it does everywhere else, so a test was written first at that layer too, not only at the Phase 7 integration layer above it.
4. **`verify-report.md` created during apply**, not left for `sdd-verify` alone, because `tasks.md` 9.1/9.2 explicitly instruct "Record both runs in `verify-report.md`". It is written framed as an apply-phase record — `sdd-verify` should independently re-run both gates rather than trust it, per this project's own convention (see the archived `bounded-chunk-size/verify-report.md`, which states the same principle).
5. **Phase 8.2's `sync-index.ts` change was initially implemented with no dedicated failing test** — `sync-index.test.ts` is one of the four protected fakes and cannot be edited, and tasks.md's own 8.2 text does not itemize a new test for it, unlike 8.1/8.3/8.4 which are each paired with RED tests in Phase 7. The only net at implementation time was the full-suite regression (all pre-existing `sync-index.test.ts` tests, which don't exercise `encodingNotices` at all, since that field didn't exist before this change) plus TypeScript. This is a genuine Strict TDD gap, self-identified during the apply-progress writeup rather than left unstated: a new test was added afterward to `test/application/index-and-search.test.ts` (not protected) exercising `SyncIndex` directly over a real temp dir, asserting `encodingNotices` on both the indexing pass and a second hash-match no-op pass. It passed immediately (the implementation was already correct), which is the honest signal that this specific test was not RED-first — it verifies, it did not drive, the `sync-index.ts` change.

No other deviations. The CP1252 table, the 5-unassigned-bytes decision, the C0/DEL reject set, the BOM handling, the `readErrors`/`skipped` reuse for undecodable content, the `EncodingNotice` shape and optionality, and the delivery slice (Work Unit 1 / Work Unit 2 boundary, commit-scoped even though shipped in one working tree) all match design.md exactly.

## Issues Found

None. All hard constraints verified:
- `decode-text.ts` contains zero `TextDecoder` usage (`grep` confirms only a doc-comment mention).
- The CP1252 table has exactly 27 entries, independently re-verified via live `curl` against both `unicode.org/Public/MAPPINGS/VENDORS/MICSFT/WINDOWS/CP1252.TXT` and `encoding.spec.whatwg.org/index-windows-1252.txt` before writing `decode-text.ts` — both authorities agree on the 27 assigned code points and on which 5 bytes (`0x81`, `0x8D`, `0x8F`, `0x90`, `0x9D`) are unassigned.
- The four protected fakes (`index-progress.test.ts:93`, `sync-index.test.ts:42`, `index-and-search.test.ts:282`, `generate-index-md.test.ts:43`) are byte-for-byte unchanged (`git diff --stat` confirms empty diffs).
- `ejemplos/` and `goldenset.yaml` are untouched (`git diff --stat` confirms empty diff).
- `src/domain/` stays free of `Buffer`/fs/SQLite dependencies — only `ports.ts`'s pure `EncodingNotice { path: string; encoding: string }` type was added.
- No migrations, schema markers, or compatibility shims were added (beta project convention).
- Gate 3's non-discriminating nature (CP1252 flag uses `latin1`, which never emits a `0x80-0x9F` byte) is stated explicitly in `verify-report.md`, not glossed over.

## Remaining Tasks

None — all 43 checklist items in `tasks.md` are `[x]`.

## Workload / PR Boundary

- **Mode**: `single-pr` with `size:exception` accepted (per `state.yaml` and the orchestrator's explicit instruction). Forecast was 555–695 lines against a 400-line budget.
- **Actual diff size**: 341 changed lines across 13 tracked files (`git diff --stat`) + 3 new files totaling 399 lines (`decode-text.ts` 154, `decode-text.test.ts` 201, `cp1252.ts` 44) = **~740 lines total**, within the accepted exception (slightly above the upper forecast bound, consistent with the tasks.md forecast's own caveat that PR #1's test-suite granularity was undercounted in the original exploration).
- **Work unit boundary preserved inside the single PR**, per the orchestrator's explicit instruction to keep commit-level boundaries clean even though delivered together:
  - **Work Unit 1** (`decode-text.ts` + `file-document-source.ts` + their tests + docs/comment fixes): zero contract change, independently valuable, corresponds to Phases 1–5.
  - **Work Unit 2** (`EncodingNotice` through `ports.ts` → 3 reports → `docs_overview`/CLI): the "loud even when perfect" reporting layer, corresponds to Phases 6–9.
- Work is left uncommitted in the working tree per the explicit instruction not to commit or push.

## Status

43/43 tasks complete. `npm test` (450/450), `npm run typecheck`, and `npm run build` all green. Manual Gates 3 and 4 both passed. Ready for `sdd-verify` — flag Deviation 5 (the one non-RED-first test) for that phase's attention.

---

## Follow-Up Batch: Closing sdd-verify's Four WARNING Gaps

**Trigger**: `verify-report.md`'s Section 9 recorded four WARNING-level test-coverage gaps (W1–W4)
against behavior that was already independently confirmed correct at runtime (Sections 5–8 of that
report). This batch adds the four missing tests. **Tests only — zero production-code changes are
retained**; the only edits to `src/` were temporary mutations, each restored byte-for-byte and
re-verified (proof below, per test).

**Mode**: the strict-TDD RED-first step does not literally apply here — the behavior under test
already works, confirmed by the prior batch and by `sdd-verify`. Per the launch brief, RED-first was
replaced with something stronger: for every test, the production code it guards was temporarily
broken, the test was run and confirmed to FAIL for the predicted reason, then the code was restored
byte-for-byte and the test re-confirmed passing. This is recorded per test below, not summarized away.

### W1 — UTF-16BE integration test

**File**: `test/infrastructure/file-document-source.test.ts` — new test `"decodes a UTF-16BE-with-BOM
file correctly"`, added immediately after the existing UTF-16LE integration test, mirroring its shape
exactly (temp-dir bytes, real `FileDocumentSource`, no mocks on `decodeText`).

**Discrimination proof**:
- **Mutation**: in `src/infrastructure/fs/decode-text.ts`, changed
  `const content = bom === "utf-16le" ? bytes.toString("utf16le") : Buffer.from(bytes).swap16().toString("utf16le");`
  to unconditionally `bytes.toString("utf16le")` — skipping `swap16` for the BE branch, exactly the
  mutation the launch brief suggested.
- **Failure observed**: `AssertionError: expected '￾⌀ 唀吀䘀ⴀ㄀㘀䈀䔀਀਀䠀漀氀愀 洀甀渀搀漀⸀਀' to be '# UTF-16BE\n\nHola mundo.\n'` —
  byte-order-reversed mojibake, exactly the predicted failure mode for a missing `swap16`.
- **Restoration confirmed**: `git diff --stat -- src/infrastructure/fs/decode-text.ts` empty (the file
  is untracked/new in this branch, so also visually re-read line-for-line against the pre-mutation
  content — identical); re-ran `npx vitest run test/infrastructure/file-document-source.test.ts` →
  10/10 passing.

### W2 — "Corrected Decoding Self-Heals via Incremental Sync"

**File**: `test/application/index-and-search.test.ts` — new `describe` block `"SyncIndex — self-heals
a previously mis-decoded document via incremental sync"`. Seeds `SqliteIndexStore` directly (bypassing
`FileDocumentSource`) with content AND hash both computed over the string a pre-fix, UTF-8-only decoder
would have produced from the real CP1252 bytes (`bytes.toString("utf8")`, which turns every invalid
byte into `U+FFFD` — asserted as a sanity check before the real test body runs, so the simulated defect
is proven real, not assumed). The real CP1252 bytes are then written unchanged to a temp dir, and an
ordinary `SyncIndex.execute()` pass is run against them via a real `FileDocumentSource`. Asserts the
document is re-indexed (present in `report.indexed`, not treated as a hash-match no-op) and that the
newly stored chunk content is `U+FFFD`-free with the correct curly quotes/dash/accented vowel restored
— the exact requirement text ("no full `compendio index` required").

**Discrimination proof**:
- **Mutation**: in `src/infrastructure/fs/file-document-source.ts`, reverted the decode call to the
  pre-fix behavior — `out.push({ path, content: bytes.toString("utf8") })`, bypassing `decodeText`
  entirely (the launch brief's second suggested mutation: "revert the decode call in
  `file-document-source.ts`").
- **Failure observed**: `AssertionError: expected [] to include 'cp1252.md'` — with the decode call
  reverted, the on-disk bytes decode into the *same* `U+FFFD`-corrupted string as the seeded hash, so
  the fingerprint now matches and the pass takes the hash-match no-op path instead of re-indexing —
  exactly the predicted failure mode, and exactly the bug this requirement exists to prevent.
- **Restoration confirmed**: `git diff -- src/infrastructure/fs/file-document-source.ts` shown in full
  and matches the intended production state exactly (the whole feature diff from the pre-change
  baseline, no residual mutation); re-ran `npx vitest run test/application/index-and-search.test.ts` →
  39/39 passing (at that point in the batch), and the full suite later confirmed 454/454.

### W3 — Undecodable content under `convention.mode: "strict"`

**File**: `test/application/index-and-search.test.ts` — new `describe` block `"IndexDocuments —
undecodable content is skipped under strict mode too (mode-independent resilience)"`. Uses a real
`FileDocumentSource` over a temp dir (the existing `StaticSource` fake hands `IndexDocuments`
already-decoded strings and cannot exercise `decodeText`'s rejection at all, so it was structurally
unable to cover this scenario) with a JPEG-magic-header binary file plus a strict-taxonomy-valid
document, wired through `IndexDocuments` with a `strict` `ConventionPolicy`. Asserts the valid document
is indexed, the binary file is skipped with a message that is neither a generic I/O error nor missing
the `"windows-1252"` naming.

**Discrimination proof** (shared mutation with W4 — same underlying code path):
- **Mutation**: in `src/infrastructure/fs/decode-text.ts`, replaced the byte-naming rejection reason
  with a generic `"could not open the file"` string (the launch brief's suggested mutation for W3/W4).
- **Failure observed**: `AssertionError: expected 'could not open the file' to contain 'windows-1252'`.
- **Restoration confirmed**: restored the exact original three-line reason string; re-ran
  `npx vitest run test/application/index-and-search.test.ts` → passing.

### W4 — `index-md`'s undecodable-content path with the real rejection message

**File**: `test/application/generate-index-md.test.ts` — new `describe` block `"GenerateIndexMd —
undecodable content, real decodeText rejection message"`. Every existing resilience test in this file
uses a fake `DocumentSource` handing `GenerateIndexMd` an already-decoded `readErrors` string (e.g.
`"permission denied"`), never the real `decodeText`-produced message. This test wires a real
`FileDocumentSource` over an on-disk binary file (`guides/binary.md`, JPEG magic header) alongside a
valid document, through `GenerateIndexMd`, and asserts the skip message is the real rejection text
(contains `"windows-1252"`, not `EACCES`/`ENOENT`/`"permission denied"`). Required adding
`FileDocumentSource` and `node:fs`/`node:os`/`node:path` imports to the file — the existing
`StaticSource`/`SourceWithEncodingNotices` fakes at `:43`/`:51` were not touched.

**Discrimination proof** (same mutation as W3, run and confirmed independently):
- **Mutation**: identical generic-message mutation to `decode-text.ts`, described above.
- **Failure observed**: `AssertionError: expected 'could not open the file' to contain 'windows-1252'`
  (same assertion, same file, confirmed to fail independently of W3's run).
- **Restoration confirmed**: same restore as W3; re-ran
  `npx vitest run test/application/generate-index-md.test.ts` → 11/11 passing.

### Files Changed (this batch)

| File | Action | What Was Done |
|---|---|---|
| `test/infrastructure/file-document-source.test.ts` | Modified | Added the UTF-16BE integration test (W1). |
| `test/application/index-and-search.test.ts` | Modified | Added `computeHash` import; added the self-heal test (W2) and the strict-mode undecodable test (W3). Existing `StaticSource` fake at `:282` and its surrounding `describe` blocks confirmed untouched via `git diff` hunk inspection. |
| `test/application/generate-index-md.test.ts` | Modified | Added `node:fs`/`node:os`/`node:path` and `FileDocumentSource` imports; added the real-rejection-message test (W4). Existing `StaticSource` (`:43`) and `SourceWithEncodingNotices` fakes confirmed untouched via `git diff` hunk inspection. |
| `test/application/index-progress.test.ts` | Not touched | Protected — confirmed `git diff` empty. |
| `test/application/sync-index.test.ts` | Not touched | Protected — confirmed `git diff` empty. |
| `src/infrastructure/fs/decode-text.ts` | Temporarily mutated, restored | Two mutation cycles (W1's `swap16` skip; W3/W4's generic-message swap), both restored byte-for-byte, both re-verified. Net diff: zero. |
| `src/infrastructure/fs/file-document-source.ts` | Temporarily mutated, restored | One mutation cycle (W2's decode-call revert), restored, re-verified. Net diff: zero (matches the pre-existing feature diff from the prior batch exactly). |
| `ejemplos/`, `goldenset.yaml` | Not touched | Confirmed `git diff --stat` empty. |

### Test Summary (cumulative)

- **New tests this batch**: 4 (W1: file-document-source UTF-16BE; W2: SyncIndex self-heal; W3:
  IndexDocuments strict-mode undecodable; W4: GenerateIndexMd real-rejection-message).
- **Total tests**: 454 (450 from the prior batch + 4 new), all passing.
- **Every new test has a recorded, independently-confirmed discrimination proof** — none is
  decorative. No test in this batch was found untestable at reasonable cost.

### Verification Commands (this batch, run at the end, verbatim)

```
$ npm test
 Test Files  32 passed (32)
      Tests  454 passed (454)

$ npm run typecheck
> tsc --noEmit && tsc -p tsconfig.test.json
(no output — clean)

$ npm run build
> tsc
(no output — clean)
```

### Status (this batch)

4/4 assigned coverage gaps closed, each with a recorded discrimination proof. `npm test` (454/454),
`npm run typecheck`, and `npm run build` all green. No production-code changes retained — the only
`src/` edits were temporary, restored, and re-verified mutations. Nothing committed or pushed, per the
explicit instruction. Ready for `sdd-verify` to independently re-confirm.
