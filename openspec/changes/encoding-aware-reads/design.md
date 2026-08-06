# Design: Encoding-Aware Reads

## Technical Approach

One pure function, `decodeText(bytes: Buffer): DecodeResult` in a new `src/infrastructure/fs/decode-text.ts`, is the only thing in the codebase allowed to turn document bytes into a `string`. `FileDocumentSource.walk` reads raw bytes (`readFile(path)` with no encoding argument) and routes every `.md` through it. Three outcomes, no fourth: decoded as UTF-8 (silent), decoded under a non-UTF-8 encoding (indexed **and** reported), or undecodable (skipped with its own named reason). Nothing is decoded on an assumption.

Because `IndexDocuments`, `SyncIndex` and `GenerateIndexMd` all call `discover()` on the same injected port (`ports.ts:34`) and `composition.ts:72` wires exactly one implementation, this single site covers `index`, `serve`'s incremental sync and `index-md`.

## The constraint that forces the hand-written table

**`TextDecoder('windows-1252')` is measurably wrong on this project's Node floor, and `readFile(path, 'latin1')` is wrong in the same way.** On Node v22.22.0 with full ICU, `TextDecoder('windows-1252')` decodes byte-for-byte identically to `latin1`: `0x93` → `U+0093` (a C1 control) instead of `U+201C`. It does not throw and it returns a `string`, so nothing detects the mistake. The same runtime decodes `windows-1251`, `koi8-r` and `shift_jis` correctly — this is a `windows-1252` table defect, not a general ICU problem.

```bash
node -e "
const cp = s => [...s].map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')).join(' ');
const b = Buffer.from([0xC0, 0x93]);
for (const label of ['windows-1252','cp1252','windows-1251','iso-8859-1','koi8-r','shift_jis']) {
  const d = new TextDecoder(label);
  console.log(label.padEnd(14), '->', d.encoding.padEnd(14), cp(d.decode(b)));
}
"
```

`0x93` must print `U+201C`. On the floor runtime it prints `U+0093`.

**The in-repo table is not a stylistic preference and MUST NOT be "simplified" back into either one-liner.** The highest-likelihood failure of this change is exactly that simplification, made by a future reader who has not re-run the command above. `0x80–0x9F` is precisely where Word puts curly quotes, dashes and ellipses, so the wrong decoder is silently wrong on the only corpus shape this change exists for. Run the command before reconsidering. `decode-text.ts` MUST NOT call `TextDecoder` at all — every decode path uses `Buffer.prototype.toString` or the in-repo table.

Related trap: `scripts/generate-perf-corpus.mjs:169-170` writes its CP1252 fixture with `latin1` under a comment claiming latin1 is CP1252-compatible. True for the `0xA0–0xFF` vowels it emits, false in general. **Not a model for the decoder.**

## Architecture Decisions

### Decision 1: 27 overrides, not 32 — the figure in the proposal is corrected here

`0x80–0x9F` is 32 bytes, but only **27** are assigned a character in CP1252. Both authorities agree on all 27 (verified during design, not transcribed):

- `https://www.unicode.org/Public/MAPPINGS/VENDORS/MICSFT/WINDOWS/CP1252.TXT`
- `https://encoding.spec.whatwg.org/index-windows-1252.txt`

| byte | cp | byte | cp | byte | cp | byte | cp |
|---|---|---|---|---|---|---|---|
| 0x80 | U+20AC | 0x88 | U+02C6 | 0x93 | U+201C | 0x9A | U+0161 |
| 0x82 | U+201A | 0x89 | U+2030 | 0x94 | U+201D | 0x9B | U+203A |
| 0x83 | U+0192 | 0x8A | U+0160 | 0x95 | U+2022 | 0x9C | U+0153 |
| 0x84 | U+201E | 0x8B | U+2039 | 0x96 | U+2013 | 0x9E | U+017E |
| 0x85 | U+2026 | 0x8C | U+0152 | 0x97 | U+2014 | 0x9F | U+0178 |
| 0x86 | U+2020 | 0x8E | U+017D | 0x98 | U+02DC | | |
| 0x87 | U+2021 | 0x91 | U+2018 | 0x99 | U+2122 | | |
| | | 0x92 | U+2019 | | | | |

Outside `0x80–0x9F`, CP1252 is identity (`String.fromCharCode(b)`), which is also what `latin1` does — that agreement is why `latin1` looks correct on accented Spanish prose and is why the defect went unnoticed in the generator.

### Decision 2: The 5 unassigned bytes are decode failures, not C1 controls — and they carry the undecodable requirement

`0x81`, `0x8D`, `0x8F`, `0x90`, `0x9D` have no CP1252 character. The two authorities **disagree**: Unicode's vendor table marks them UNDEFINED; the WHATWG standard maps each to the same-numbered C1 control (identity — i.e. what `latin1` already does).

**Choice: the Unicode reading. These 5 bytes are a decode failure.**

**Alternatives considered**: WHATWG identity, which would make the decoder literally "`latin1` with 27 overrides" and structurally incapable of failing on any byte.

**Rationale**:
1. WHATWG's identity mapping serves a browser mandate — *never fail to render a page*. This change's mandate is the opposite: *never accept content on an assumption*. Adopting the browser rule here would import the wrong goal.
2. Mapping them to C1 controls writes invisible control characters into FTS5 and into the embedded passage text — a quieter instance of the exact silent corruption this change removes.
3. No correct CP1252 document contains them, so nothing legitimate is lost.
4. It makes the undecodable requirement (Gate 5) **implementable**. Under the WHATWG reading every byte sequence decodes and "genuinely undecodable" would be an unreachable branch — a requirement that cannot fail is not a requirement. This is why open questions 3 and 4 are resolved together: the same table decides both.

The table is therefore a `Map<number, number>` of exactly 27 entries, and *absence from the map* is what marks a C1 byte as unassigned. There is no second list of 5 to keep in sync.

### Decision 3: Plausibility is a deterministic byte-set test, never a statistic

After `isUtf8()` fails, the CP1252 fallback is **conditional**. The buffer is rejected if it contains any byte that cannot appear in CP1252 text:

| Rejected | Why |
|---|---|
| `0x00–0x08`, `0x0B`, `0x0E–0x1F` | C0 controls. `TAB (0x09)`, `LF (0x0A)`, `FF (0x0C)`, `CR (0x0D)` are the only ones that occur in real text files |
| `0x7F` | DEL; never legitimate in a document |
| any of the 5 unassigned C1 bytes | Decision 2 |

Everything else is accepted and transcoded. **Alternatives considered**: an unconditional fallback (then nothing is ever undecodable and Gate 5 is untestable); `chardet` statistical detection (rejected on the record — it trades a deterministic bug for a probabilistic one, and the evidence base is exactly one encoding).

The scan covers the **whole buffer**, not a prefix: a partial scan lets a binary tail through, and the file already failed `isUtf8()`, so this pass is paid only by non-UTF-8 files.

**Accepted residual**: a binary file whose bytes happen to avoid all of the above is transcoded into mojibake. It is still *reported* (Decision 5), never silent, and no realistic binary format avoids C0 bytes over a whole file.

### Decision 4: BOM sniffing handles UTF-16 only; UTF-8-BOM needs no special case except one contradiction guard

`EF BB BF` is itself valid UTF-8, so a BOM'd UTF-8 file passes `isUtf8()` on the whole buffer with no special-casing. Only `FF FE` / `FE FF` need sniffing, because they are invalid UTF-8 and would otherwise reach the CP1252 gate — where the interleaved `0x00` bytes would reject them as binary. **BOM sniff must therefore run before the `isUtf8` gate**, or every UTF-16 document becomes "undecodable".

One guard is still required: a buffer that starts `EF BB BF` but fails `isUtf8()` is self-contradicting (a CP1252 editor re-saved a UTF-8 file). It is rejected with a message naming the contradiction, rather than transcoded into a document beginning `ï»¿`.

UTF-16LE uses `bytes.toString("utf16le")` (V8-native, not ICU). UTF-16BE uses `Buffer.from(bytes).swap16().toString("utf16le")` — a copy, then a byte swap; `TextDecoder('utf-16be')` is avoided on principle after the `windows-1252` measurement. An odd byte length is a decode failure (`swap16` cannot apply).

### Decision 5: The BOM is stripped — as contract hygiene, not as a bug fix

`decodeText` strips one leading `U+FEFF` from its output, whatever the encoding, so `DocumentFile.content` never begins with a BOM.

**Verified, and it corrects an assumption carried into this phase**: a leading `U+FEFF` does **not** break frontmatter parsing today. `gray-matter` strips it before it does anything else — `node_modules/gray-matter/lib/to-file.js:39` calls `utils.toString`, which calls `strip-bom-string` (`lib/utils.js:44,48`). `RemarkMarkdownParser` (`remark-markdown-parser.ts:26`) consumes `matter(raw)`'s already-stripped `content`, and both the outline and the chunker work from `parsed.body`, so nothing downstream ever sees the BOM. The only consumer of the raw string is `computeHash` (`index-pipeline.ts:33-35`), where a BOM changes the hash harmlessly.

Stripping is still correct: a BOM is an encoding artefact, not text, and making a correctness property depend on a third-party library's incidental normalization is the class of unverified load-bearing assumption this repository has been burned by. **No test may claim the BOM breaks parsing** — it does not.

### Decision 6: No new port; the notice rides the existing `DiscoverResult`

**Choice**: `DiscoverResult.encodingNotices?: EncodingNotice[]` in `src/domain/ports.ts`, mirroring `readErrors` in shape and placement. `decode-text.ts` stays a plain module in `src/infrastructure/fs/`.

**Rationale, argued against the code rather than from the principle**:
- `openspec/config.yaml`'s design rule says *route any new **adapter** through `ports.ts`*. `decodeText` is not an adapter: it performs no I/O, opens nothing, and depends on nothing injectable. There is nothing to route. The project has no precedent for wrapping a locally-called pure function in a port — `splitToBound`, `chunkOutline` and `estimateTokens` are all called directly.
- `DiscoverResult` already carries a non-content, per-file *outcome* channel next to `files` (`readErrors`, `ports.ts:18-27`). Encoding is the same kind of fact — a property of the read, not of the document — so this uses the existing seam rather than widening the architecture.
- Not `src/domain/` either, even though the table is pure: the helper's parameter is a `Buffer`, and the domain today contains no byte-level type at all. Moving it there would start a boundary drift for zero benefit, since a function with no I/O is equally unit-testable in `infrastructure/fs/`.
- `EncodingNotice.encoding` is typed `string` in `ports.ts`, not a union: the domain must not import an infrastructure type, and the closed union lives in the adapter. This is the same open-string-in-the-domain shape already used for `type`/`module`/`status`.

**Optional at every hop** (`encodingNotices?`), present only when non-empty — matching `embeddingsWarning?` and the mcp-contract spec's "omit empty/absent fields rather than render placeholders" (spec line 87). Verified consequence: the four in-memory fakes return the object literal `{ files, readErrors }` (`index-progress.test.ts:93`, `sync-index.test.ts:42`, `index-and-search.test.ts:282`, `generate-index-md.test.ts:43`) and compile unchanged.

### Decision 7: Undecodable content reuses `readErrors` — and this grants it delete-protection, deliberately

**Choice**: a decode failure is pushed to `readErrors` with a distinctive message; the existing plumbing already maps that into `skipped` in all three use cases.

The message names the byte and offset, which is what makes it distinguishable per Gate 5:

```
unrecognized encoding: not valid UTF-8, and byte 0x00 at offset 1234 rules out windows-1252
```

versus a generic `EACCES: permission denied, open '...'`.

**Consequence, named rather than discovered later**: `SyncIndex.deleteMissingDocuments` protects every `readErrors` path from deletion (`sync-index.ts:79,156-159`, `isProtected`). So a previously-indexed document that later becomes undecodable keeps its stale row instead of being deleted, unlike a resolver rejection, which deletes it (`sync-index.ts:116-121`).

**Accepted**, because: the dominant real case is a binary file misnamed `.md` that was never indexed, where protection is a no-op; where it does bite, the outcome is the *safe* one — the corpus keeps serving the last known-good version, the owner is warned on every pass, and `compendio index`'s `reset()` clears it. A third channel to get delete-on-undecodable would cost plumbing in a change already at budget for a corner of a corner.

### Decision 8: `GenerateIndexMd` surfaces notices too

**Choice**: yes, `IndexMdReport.encodingNotices?`, filtered on `path !== INDEX_FILE` exactly as `readErrors` already is (`generate-index-md.ts:36-38`).

**Rationale**: it costs ~3 lines because the notices arrive through the same port for free; `index-md` needs no embeddings, no model download and no database, so it is the cheapest command a new user runs and the cheapest place to discover a mixed-encoding corpus; and the `index-md` spec's *Skip-and-Report Resilience Matches Indexing* requirement makes an asymmetry here a new, unexplained divergence between two commands that mirror each other on purpose. Counter-argument (it only reads frontmatter and the summary, so damage is smaller) is real but argues about severity, not about whether the owner should be told.

## Decode flow

```
FileDocumentSource.walk → readFile(path)            // no encoding argument → Buffer
        │
        ▼  decodeText(bytes)                        // src/infrastructure/fs/decode-text.ts, pure
        │
  1. FF FE ─→ utf-16le   bytes.toString("utf16le")           odd length ─→ FAIL
     FE FF ─→ utf-16be   copy → swap16 → toString("utf16le") odd length ─→ FAIL
        │
  2. isUtf8(bytes) ─→ utf-8   bytes.toString("utf8")     // covers BOM'd and BOM-less
        │
  3. starts with EF BB BF ─→ FAIL "declares a UTF-8 BOM but is not valid UTF-8"
        │
  4. plausible CP1252?  any rejected byte (Decision 3) ─→ FAIL {byte, offset}
        │              otherwise ─→ windows-1252: identity, with the 27 C1 overrides
        ▼
  5. strip one leading U+FEFF (all encodings)  →  DecodeResult
        │
        ├─ ok, "utf-8"      → files.push({ path, content })                       // silent
        ├─ ok, other        → files.push(...) + encodingNotices.push({ path, encoding })
        └─ fail             → readErrors.push({ path, error: reason })
```

## Report flow

```
DiscoverResult { files, readErrors, encodingNotices? }
   ├─ IndexDocuments  → IndexReport.encodingNotices?   → cli.ts `index` warn loop
   ├─ SyncIndex       → SyncReport.encodingNotices?    → toSyncInfo → SyncInfo.encodingNotices?
   │                                                      └→ formatOverview "Sync:" block → docs_overview
   └─ GenerateIndexMd → IndexMdReport.encodingNotices? → cli.ts `index-md` warn loop
                          (INDEX.md filtered, mirroring readErrors)
```

**Load-bearing, easy to miss**: `toSyncInfo`'s omission rule is content-based (`get-overview.ts:68`) and currently returns `null` when `skipped` is empty and `embeddingsWarning` is absent. It MUST also require `encodingNotices` to be empty — otherwise a pass whose only finding is a transcode renders nothing in `docs_overview` and **Gate 2 fails**.

## Interfaces / Contracts

```ts
// src/domain/ports.ts — mirrors ReadError
export interface EncodingNotice {
  path: string;
  /** Open label, e.g. "windows-1252". The closed union lives in the adapter. */
  encoding: string;
}
export interface DiscoverResult {
  files: DocumentFile[];
  readErrors: ReadError[];
  /** Optional so existing in-memory fakes compile; production always sets it. */
  encodingNotices?: EncodingNotice[];
}

// src/infrastructure/fs/decode-text.ts
export type DecodedEncoding = "utf-8" | "windows-1252" | "utf-16le" | "utf-16be";
export type DecodeResult =
  | { ok: true; content: string; encoding: DecodedEncoding }
  | { ok: false; reason: string };
export function decodeText(bytes: Buffer): DecodeResult;

// src/application/index-documents.ts — one renderer, three call sites
export function formatEncodingNotice(notice: EncodingNotice): string;
// → `${path}: not UTF-8 — decoded as ${encoding} and indexed; re-save as UTF-8 to silence this`
```

The `{ ok: true } | { ok: false }` union matches `PipelineResult` (`index-pipeline.ts:29`) and the `ConventionPolicy` resolver, so the call site reads like every other in this codebase. `formatEncodingNotice` lives beside `IndexedFileReport`/`SkippedFileReport` in `index-documents.ts`, which `get-overview.ts:3` and `generate-index-md.ts:5` already import — no new dependency direction. It is a single renderer rather than the duplicated `skipped` line (`cli.ts:53` / `get-overview.ts:92`) because this message names a remediation, and three copies of a remediation string drift.

## File Changes

| File | Action | Description |
|---|---|---|
| `src/infrastructure/fs/decode-text.ts` | Create | BOM sniff, `isUtf8` gate, reject set, 27-entry table, BOM strip |
| `src/infrastructure/fs/file-document-source.ts` | Modify | `readFile(path)` raw at `:54`; route through `decodeText`; collect notices; failure → `readErrors` |
| `src/domain/ports.ts` | Modify | `EncodingNotice`; `DiscoverResult.encodingNotices?` |
| `src/application/index-documents.ts` | Modify | `IndexReport.encodingNotices?`; `formatEncodingNotice` |
| `src/application/sync-index.ts` | Modify | Carry notices into `PassState` → `SyncReport.encodingNotices?` |
| `src/application/get-overview.ts` | Modify | `SyncInfo.encodingNotices?`; **extend `toSyncInfo`'s null rule**; render in `formatOverview`'s Sync block |
| `src/application/generate-index-md.ts` | Modify | `IndexMdReport.encodingNotices?`, `INDEX_FILE` filtered |
| `src/cli.ts` | Modify | Warn loops in `index` (after `:54`) and `index-md` (after `:80`) |
| `test/infrastructure/decode-text.test.ts` | Create | Pure unit tests, inline byte buffers |
| `test/infrastructure/file-document-source.test.ts` | Modify | Temp-dir bytes: CP1252 file, binary file, UTF-16LE file |
| `test/application/index-and-search.test.ts` | Modify | End-to-end: no `U+FFFD`, exact code points, notice present, not in `skipped` |
| `scripts/generate-perf-corpus.mjs` | Modify | Comment fix at `:169` — latin1 is CP1252-compatible **only for `0xA0–0xFF`** |
| `openspec/specs/{indexing,mcp-contract,index-md}` | Modify | Delta specs (`sdd-spec`) |
| `CLAUDE.md` | Modify | Non-obvious-decisions entry carrying the `windows-1252` measurement and the repro command |

**No committed fixture and no `.gitattributes` entry.** The integration fixtures are written byte-exactly into a temp directory at test time, the pattern both affected test files already use (`file-document-source.test.ts:37,49`, `index-and-search.test.ts:532-536`). This deletes the proposal's "fixture bytes rewritten by git EOL conversion or an editor re-save" risk at the source rather than mitigating it, and trims the diff.

## Testing Strategy

`strict_tdd: true` — the decoder's unit tests land first and need no file on disk.

| Layer | What | How |
|---|---|---|
| Unit | **All 27 overrides**, byte by byte, asserting exact code points. This is the test that fails for `latin1` and for `TextDecoder('windows-1252')` | `decode-text.test.ts`, table-driven from the Decision 1 table |
| Unit | Each of the 5 unassigned C1 bytes → `ok: false`; C0 controls and `0x7F` → `ok: false`, reason names byte and offset | `decode-text.test.ts` |
| Unit | `0xA0–0xFF` accented range; ASCII; empty buffer; valid UTF-8 passthrough is byte-identical | `decode-text.test.ts` |
| Unit | UTF-8 BOM stripped; UTF-16LE/BE BOM decoded and stripped; odd-length UTF-16 fails; `EF BB BF` + invalid UTF-8 fails with the contradiction reason | `decode-text.test.ts` |
| Unit | `TAB`/`LF`/`FF`/`CR` do **not** reject a CP1252 buffer | `decode-text.test.ts` |
| Integration | CP1252 file through `FileDocumentSource`: content clean, one notice, no `readErrors`. Binary file: no notice, one `readErrors` with the distinct message | `file-document-source.test.ts`, temp dir |
| Integration | `IndexDocuments` end to end on a CP1252 temp corpus: zero `U+FFFD` in stored chunks; `U+201C`, `U+201D`, `U+2013`, `U+2026`, `U+00F3` all present; `encodingNotices` populated; path **not** in `skipped` (Gates 1 + 2) | `index-and-search.test.ts` |
| Integration | `toSyncInfo` returns non-null for a pass whose only finding is a notice, and `formatOverview` renders it (Gate 2, `docs_overview` half) | `get-overview` tests |
| Integration | A UTF-8-only corpus leaves `encodingNotices` undefined at every hop (no warning noise on healthy corpora) | existing `ejemplos/` harness |
| Manual (Gate 3) | Two indexes of `generate-perf-corpus.mjs <dir> [--cp1252]`, `scripts/rank-probe.mjs`, ranks identical after | `verify-report.md` |
| Manual (Gate 4) | `compendio eval` on `ejemplos/`: MRR ≥ 0.943, recall@5 = 1.00, top-1 ≥ 20/22, unmoved | `verify-report.md` |

Gate 3's corpus is written with `latin1`, so it contains no `0x80–0x9F` byte and **would pass with a latin1-only decoder**. It gates rank identity, not the table; Gate 1 is the discriminating gate. Upgrading the generator to emit true CP1252 is declined — it needs an inverse table for one manual gate whose purpose is ranking.

## Migration / Rollout

**No migration, no schema marker, no shim** (beta, `openspec/config.yaml`). **No reindex in either direction**: `computeHash` runs over the decoded string (`index-pipeline.ts:33-35`), so a file whose decoding changes yields a different hash and `SyncIndex` re-indexes it unassisted (`sync-index.ts:107-113`). Applying the fix self-heals a corrupted corpus on the next `serve` pass; reverting restores the previous state the same way. A file that was valid UTF-8 all along keeps its hash and is correctly left alone. This is the opposite of `bounded-chunk-size`, where a full `index` was mandatory.

Rollback: revert the commits, `npm run build`. Nothing else.

**Delivery slice** (the decision itself belongs to the `sdd-tasks` gate). The cut line is clean because the undecodable path needs no new field:

- **PR #1 — decoder + adapter.** `decode-text.ts`, `FileDocumentSource`, unit tests, the undecodable path via the *existing* `readErrors`/`skipped` plumbing. Independently valuable: corruption stops and undecodable content is named, with zero contract change.
- **PR #2 — the notice.** `EncodingNotice` through `ports.ts` → the three reports → `toSyncInfo`/`formatOverview` → `cli.ts`, plus the spec deltas and integration tests.

## Open Questions

- [ ] Should `cli.ts index` also print a summary count line (`Transcoded N documents from a non-UTF-8 encoding.`) next to the existing `Skipped N documents` line at `:62-64`? Assumed no — the per-file warnings already carry it. Decide at `sdd-tasks`.
- [ ] `0x0B` (VT) is in the reject set and `0x0C` (FF) is not. This is the one judgement call in Decision 3 with no authority behind it. A false reject is loud and recoverable; confirm the boundary at review.
- [ ] Residual, out of scope and stated rather than fixed: UTF-16 **without** a BOM is not detected (it fails the reject set as binary), and a binary file starting `FF FE` is decoded as UTF-16LE garbage (1 in 65 536) — reported, never silent.
