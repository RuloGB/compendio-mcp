# Exploration — encoding-aware-reads

Status: complete for design purposes.

A note on epistemic status, because this repository has been burned by it before. Every claim about
this codebase is **VERIFIED** — quoted with `path:line`. Claims about Node.js runtime behaviour were
initially **INFERRED** by the exploration phase (which had no execution access) and were then
**MEASURED** on the actual runtime before this document was written. Where measurement contradicted
the inference, the measurement wins and the correction is recorded rather than smoothed away
(section 3). Nothing below is presented as measured unless a command in this document produces it.

Measurement environment: Node **v22.22.0** (project floor is `>=22.12.0`, `package.json`), full ICU
(`process.config.variables.icu_small === false`), win32 x64.

## Problem statement

`FileDocumentSource` reads every `.md` file as UTF-8 unconditionally
(`src/infrastructure/fs/file-document-source.ts:54`):

```ts
out.push({ path, content: await readFile(join(dir, entry.name), "utf8") });
```

A CP1252/Latin-1 markdown file — the documented normal output of exporting a Word document on a
Spanish-locale Windows machine — gets one `U+FFFD` replacement character per undecodable byte. The
surrounding `try/catch` (`file-document-source.ts:53-57`) is not a safety net: Node does not throw on
invalid UTF-8, it substitutes. The read "succeeds", nothing lands in `readErrors`, and the document
is indexed as a normal success while its content is silently destroyed.

`IMPROVEMENTS.md` §1 measured the consequence on a real 38-document corpus: 1 file was CP1252,
3 191 non-ASCII bytes were destroyed, 89 of 89 chunks of that document were corrupted, and the chunk
holding the answer to a real query fell from lexical rank 2 to rank 36. FTS5's
`unicode61 remove_diacritics 2` normalizes `sección` to `seccion`, but the corrupted index holds
`secci<U+FFFD>n`, which tokenizes as `secci` + `n`. The term cannot match.

## Evidence

### 1. Blast radius of the UTF-8 assumption

Every site in the shipped source that turns file bytes into a string:

| Site | Reads | Shares the defect? | Why |
|---|---|---|---|
| `src/infrastructure/fs/file-document-source.ts:54` | every `.md` under `docsDir` | **Yes — primary, in scope** | Feeds the indexed corpus; this is where real Word-export CP1252 files land |
| `src/cli.ts:207` (`loadGoldenset`) | `goldenset.yaml` | Same pattern (`readFileSync(path, "utf8")`) | Dev/eval-only. This repo's `goldenset.yaml` is UTF-8 and frozen |
| `src/infrastructure/config.ts:76` (`loadConfig`) | `compendio.config.json` | Same pattern | Authored directly, saved UTF-8 by any modern editor; no evidenced real-world instance |
| `src/infrastructure/fs/file-index-writer.ts:20` | existing `INDEX.md`, for idempotency diffing | Same pattern | Self-generated; line 30 writes it back as `"utf8"`, so it is self-consistent |
| `src/server.ts:22` | own `package.json` for `SERVER_VERSION` | Same pattern | npm-shipped, ASCII in practice |
| `scripts/vector-reach.mjs:205` | a doc file, for the Gate 1b probe | Same pattern | Dev-only measurement script, not shipped |

**One fix covers all three use cases.** `IndexDocuments` (`src/application/index-documents.ts:70`),
`SyncIndex` (`src/application/sync-index.ts:68`) and `GenerateIndexMd`
(`src/application/generate-index-md.ts:34`) all call `this.source.discover()` on the injected
`DocumentSource` port (`src/domain/ports.ts:34`), and `src/composition.ts:72` wires exactly one
production implementation. There is no second code path to patch for `index`, `serve`'s incremental
sync, or `index-md`.

**Scope recommendation**: fix `file-document-source.ts:54` only. The other five sites share the code
pattern but not the risk profile — dev tooling, self-generated files, or npm-shipped ASCII manifests,
none with a cited or plausible non-UTF-8 instance. Including them roughly doubles the diff for no
evidenced benefit and pushes against the 400-line budget (section 8).

### 2. What is detectable, and with what

**BOM handling today: none.** Grepping `src/` for `BOM`, `﻿`, `FEFF`, `byteOrderMark` returns
zero matches. A UTF-8-BOM'd or UTF-16-BOM'd file is not special-cased anywhere in the pipeline.

**Node's substitution behaviour — VERIFIED** against `nodejs.org/api/buffer.html`: decoding a Buffer
that does not exclusively contain valid UTF-8 uses `U+FFFD` for those errors. This applies to
`fs.readFile(path, 'utf8')`. The "no throw, silent substitution" premise is documented Node
behaviour, not a recollection.

**`buffer.isUtf8()` — MEASURED, available and exact** on the floor runtime:

```bash
node -e "const {isUtf8}=require('node:buffer'); console.log(isUtf8(Buffer.from('a')), isUtf8(Buffer.from([0xF3])))"
# => true false
```

This answers "is this buffer valid UTF-8" exactly, with a built-in, with no heuristics. It is the
right gate before any fallback: valid UTF-8 is decoded as UTF-8, full stop, and only the remainder
needs a guess.

**Dependency survey** — nothing encoding-related is in `package.json` today:

| Package | Purpose | Size | License | Native? | Maintenance |
|---|---|---|---|---|---|
| `chardet` | statistical charset **detection** | ~179 kB install | MIT | Pure JS/TS | Healthy, v2.2.0, ~52.5M weekly downloads |
| `iconv-lite` | charset **decoding**, wide coverage | ~344 kB install, 1 dep | MIT | Pure JS | Healthy, actively published |

Neither is a native addon, so neither adds to the "second native dependency" cost — `better-sqlite3`
stays the only one either way. Both still add install size, license and maintenance surface, and a
second decoding path.

### 3. The measurement that changed a recommendation

The exploration phase flagged `TextDecoder('windows-1252')` as a plausible zero-dependency decoder,
with an **INFERRED** risk: a reported regression (`nodejs/node#56219`) on v23.4.0 and an
apparently-open PR (`nodejs/node#60893`, "implement Windows-1252 encoding support"). Its position was
that the floor version is probably fine but must be verified.

Measured. It is not fine, and the failure is worse than the reported regression:

```bash
node -e "
const cp = s => [...s].map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')).join(' ');
const b = Buffer.from([0x93,0xf3,0x94,0x85,0x96]);
console.log('windows-1252 ->', cp(new TextDecoder('windows-1252').decode(b)));
console.log('latin1       ->', cp(b.toString('latin1')));
"
```

| Input bytes | Correct CP1252 | Node v22.22.0 `TextDecoder('windows-1252')` | Node `latin1` |
|---|---|---|---|
| `0x93` | `U+201C` `“` | `U+0093` (C1 control) | `U+0093` |
| `0xF3` | `U+00F3` `ó` | `U+00F3` | `U+00F3` |
| `0x94` | `U+201D` `”` | `U+0094` (C1 control) | `U+0094` |
| `0x85` | `U+2026` `…` | `U+0085` (C1 control) | `U+0085` |
| `0x96` | `U+2013` `–` | `U+0096` (C1 control) | `U+0096` |

**Node's `windows-1252` decoder is byte-for-byte identical to `latin1` on this runtime.** It does not
throw, it does not warn, it returns a `string` (so the v23.4.0 `Buffer`-return regression is a
different bug from this one) — it simply produces the wrong characters for the entire `0x80–0x9F`
range, which is exactly the range where Word puts curly quotes, en/em dashes and ellipses.

This is specifically a `windows-1252` table defect, not a general "legacy encodings are broken in
Node" problem. Same runtime, other labels, same byte `0x93`:

| Label | `decoder.encoding` | `0xC0` | `0x93` | Correct? |
|---|---|---|---|---|
| `windows-1252` | `windows-1252` | `U+00C0` | `U+0093` | **no** |
| `cp1252` | `windows-1252` | `U+00C0` | `U+0093` | **no** (same decoder) |
| `iso-8859-1` | `windows-1252` | `U+00C0` | `U+0093` | label mapping is per WHATWG spec; decoder still wrong |
| `windows-1251` | `windows-1251` | `U+0410` | `U+201C` | yes |
| `koi8-r` | `koi8-r` | `U+044E` | `U+2320` | yes |
| `shift_jis` | `shift_jis` | `U+FF80` | `U+FFFD` | yes |

`windows-1251` maps `0x93` to `U+201C` correctly, so the C1-to-punctuation machinery works — only the
`windows-1252` table is wrong. Full ICU is present (`icu_small=false`); this is not a small-ICU build
artefact.

**Consequence for design: `TextDecoder('windows-1252')` is ruled out on measurement, not on risk
appetite.** And the same measurement rules out the naive `readFile(path, "latin1")` shortcut for the
identical reason — a point this repository already half-knew: `scripts/generate-perf-corpus.mjs:169`
writes its CP1252 fixture with Node's `"latin1"` under the comment *"latin1 is CP1252-compatible for
the accented characters this prose uses"*. That comment is true for the accented vowels it generates
(`0xA0–0xFF`, where the two encodings agree) and false in general. The fixture generator is therefore
correct for its own narrow purpose and **must not be treated as a model for the decoder**.

### 4. Approaches compared

| Approach | Pros | Cons | Effort |
|---|---|---|---|
| **A. In-repo, zero-dependency**: BOM sniff → `buffer.isUtf8()` gate → hand-written CP1252 table (a 32-entry override on `latin1` for `0x80–0x9F`) | No new dependency; deterministic across every Node build and version; independent of ICU; narrowly matches the one evidenced failure mode; smallest diff | Covers UTF-8 + CP1252 + UTF-16 BOM only; a genuinely different legacy encoding is not detected and falls through to the error path | Small — one ~60–90 line pure module plus wiring |
| **B. `chardet` + `iconv-lite`** | General across many encodings; well-trodden library code | Two dependencies for one evidenced encoding; statistical detection trades a *deterministic* bug (assume UTF-8) for a *probabilistic* one (mis-detect as X) — a different risk shape from the one measured; contradicts the "local, minimal footprint" positioning | Medium |
| **C. `TextDecoder('windows-1252')`** | Would have been the cheapest correct answer | **Measured wrong on the floor runtime** (section 3). Not viable. | — |

**Recommendation: Approach A.** The evidence base is exactly one encoding. A 32-entry override table
is cheap, reviewable as a constant, has zero runtime-version risk, and `buffer.isUtf8()` answers the
UTF-8 question exactly and for free. Building general multi-encoding detection now would generalize
from a single measured data point — the precise habit this project's evidence discipline exists to
prevent. A different non-UTF-8 corpus reported later is new evidence and a new, narrow follow-up.

### 5. Where it belongs architecturally

`DocumentFile.content: string` (`src/domain/ports.ts:11-15`) is already the boundary where the domain
and application layers see only decoded strings. Nothing in `src/domain/` touches raw bytes today
(grepped: no `Buffer`/`Uint8Array` in `src/domain/`), and this change should not make it start.

Decoding must run *before* a `DocumentFile.content` string exists, which makes it an adapter concern
by construction. The home is `FileDocumentSource`: read raw bytes (`readFile(path)` with no encoding
argument), then call a small pure helper colocated in `src/infrastructure/fs/` (e.g. `decode-text.ts`)
returning something like `{ content, encoding, transcoded }`.

**Not a new port.** `DocumentSource` (`ports.ts:34-36`) is already the "how documents are read" seam,
with one production implementation. A second interface used by a single adapter, with no plausible
second implementation, is speculative abstraction — and the project's own precedent argues against it:
`splitToBound` and `chunkOutline` are pure logic with no port wrapping them. The right-sized change is
extending the existing port's return shape to carry encoding metadata upward, the same pattern already
used for `ReadError` (`ports.ts:18-21`).

**Not domain either**, even though a CP1252 table is pure logic with zero I/O. Moving byte-level
decoding into `domain/` would require either changing `DocumentFile.content` to a `Buffer` — a much
larger blast radius touching every consumer — or duplicating the decode step on both sides of the
boundary. A pure helper in `infrastructure/fs/` is just as unit-testable without moving the boundary.

### 6. The report contract

Current shapes, VERIFIED:

- `IndexReport` (`src/application/index-documents.ts:24-32`): `mode`, `indexed[]`, `skipped[]`
  (`{path, errors[]}`), `totalChunks`, `durationMs`, `embeddingsWarning?`.
- `SyncReport` (`src/application/sync-index.ts:15-25`): adds `deleted[]`.
- `SyncInfo` (`src/application/get-overview.ts:53-56`), from `SyncScheduler.lastReport` via
  `toSyncInfo()` (lines 66-72): `skipped[]`, `embeddingsWarning?`. Content-based omission — `null`
  both when no pass has run and when the last pass had nothing to report.
- CLI (`src/cli.ts:52-64`): one `console.warn` per `skipped` entry, one for `embeddingsWarning`.
- MCP: only `docs_overview` surfaces any of this, via `formatOverview` (`get-overview.ts:74-99`).
  `index` and `index-md` are CLI-only; `server.ts` registers exactly `docs_overview`, `search_docs`,
  `read_doc` (lines 78, 97, 161).

The three options `IMPROVEMENTS.md` names, costed against that contract:

| Option | Cost here | Verdict |
|---|---|---|
| Silent transcode | Zero new fields | **Ruled out by the evidence.** The defect *is* the silent success. Also inconsistent with the codebase idiom: embeddings failure degrades *and reports*; an impossible filter is dropped *and reported* |
| **Transcode + report** | One optional field threaded through `ports.ts`, `IndexReport`, `SyncReport`, `SyncInfo`/`toSyncInfo`, `formatOverview`, and the `cli.ts` warn blocks | **Recommended.** Mirrors `embeddingsWarning` exactly — same call sites, same "loud, not hidden" philosophy. Answers the open question in `IMPROVEMENTS.md` ("should a *detected* file be surfaced even when transcoding succeeds?") with yes: a mixed-encoding corpus is an accident the owner wants to know about |
| Skip like an unreadable file | Cheapest — reuse `skipped` verbatim | **Not recommended.** A decodable CP1252 file is not broken; it is indexable content. Discarding a servable document is a worse outcome than a warning. Reserve `skipped`/`readErrors` for bytes that are neither valid UTF-8 nor plausibly CP1252 |

### 7. Interaction with incremental reindex

**VERIFIED from code.** The change fingerprint is `computeHash(content)`
(`src/application/index-pipeline.ts:33-35`), a SHA-256 over the **already-decoded JS string**, not
the raw bytes. `SyncIndex.processNewAndChanged` (`sync-index.ts:107-113`) skips re-indexing only when
`existingDoc.hash === hash`.

Once decoding is fixed, a previously-corrupted file decodes to `"sección"` where it used to decode to
`"secci�n"`. Different string, different hash, even though the bytes on disk never changed —
so `SyncIndex` classifies it as changed and re-runs the full transform/embed/upsert path
(`sync-index.ts:115-142`) unassisted.

**This is self-healing under incremental `serve` sync; no full `compendio index` is required.** It is
the *opposite* case from `bounded-chunk-size`, where content was byte-identical and only the chunking
*config* moved, so the hash never changed and a full `index` was the only way to apply new
boundaries. A file that was valid UTF-8 all along decodes identically before and after, keeps its
hash, and is correctly left alone.

### 8. Test strategy

`vitest.config.ts` uses `pool: "forks"` for `better-sqlite3`. Text decoding involves no native
module, so it imposes no pool or isolation requirement of its own.

**Byte preservation in git.** The only `.gitattributes` entry today is
`test/fixtures/vector-reach/** text eol=lf`, added because that fixture's recorded offsets are
byte-sensitive and a Windows checkout under `core.autocrlf=true` would rewrite every newline. Git
stores blob bytes verbatim regardless of character encoding — the risk for a CP1252 fixture is the
same EOL rewriting, not encoding corruption. `-text` (treat as binary: no EOL conversion, no diff) is
the safer marking for a non-UTF-8 file than `text eol=lf`.

**Authoring the fixture without an editor re-saving it.** `scripts/generate-perf-corpus.mjs:168-173`
already proves the pattern: `writeFileSync(path, content, "latin1")` produces byte-exact non-UTF-8
output with no editor in the loop. Verified by reading the script rather than trusting
`IMPROVEMENTS.md` — the `--cp1252` flag is real (`process.argv.includes("--cp1252")`, line 223).
Caveat from section 3: that generator only exercises `0xA0–0xFF`, so it cannot by itself produce the
`0x80–0x9F` bytes that distinguish a correct decoder from `latin1`.

Two tiers:

1. **Pure-function unit tests (strict-TDD first)** against the decode helper, with byte arrays
   constructed inline — no file on disk, so no git or editor risk at all. Cases: valid UTF-8
   passthrough, UTF-8 BOM, UTF-16LE/BE BOM, CP1252 accented range (`0xA0–0xFF`), **CP1252
   `0x80–0x9F`** (the case `latin1` and Node's `TextDecoder` both get wrong — this is the test that
   would have caught Approach C), and undecodable/binary falling through to the error path.
2. **One small integration fixture**, generated the same way `--cp1252` does, committed with a
   `.gitattributes -text` entry, driven through `FileDocumentSource`/`IndexDocuments` end to end to
   prove the wiring, not just the pure function.

Four existing tests build their own in-memory `DocumentSource` fake
(`test/application/index-progress.test.ts`, `sync-index.test.ts`, `index-and-search.test.ts`,
`generate-index-md.test.ts`). Making the new report field **optional** on the port keeps all four
compiling unchanged — the same pattern every other optional report field already uses.

`ejemplos/` and `goldenset.yaml` are the frozen Spanish regression suite, already UTF-8. Not touched,
and not a fixture source for this change.

### 9. Rough size

| File | Change | Est. lines |
|---|---|---|
| `src/infrastructure/fs/decode-text.ts` (new) | BOM sniff + `isUtf8` gate + CP1252 table + decode | 60–90 |
| `src/infrastructure/fs/file-document-source.ts` | read bytes, call decoder, collect notices | 15–25 |
| `src/domain/ports.ts` | optional encoding-notice shape on the discover result | 10–15 |
| `src/application/index-documents.ts` | thread notices into `IndexReport` | 10–20 |
| `src/application/sync-index.ts` | thread notices into `SyncReport` | 10–20 |
| `src/application/get-overview.ts` | `SyncInfo`/`toSyncInfo`/`formatOverview` | 10–15 |
| `src/application/generate-index-md.ts` | consistent surfacing decision | 5–10 |
| `src/cli.ts` | warn wiring for `index` (and `index-md`) | 10–15 |
| Unit tests (`decode-text`) | inline byte-buffer cases | 80–150 |
| Integration test + generated fixture + `.gitattributes` | | 30–60 |
| **Total** | | **~240–420** |

At or slightly over the 400-line budget depending on how much report threading lands. Keeping scope
to the CP1252 fallback plus the section 6 threading — and explicitly deferring the `goldenset.yaml`
and `config.ts` sites — keeps it inside budget without cutting anything the evidence supports.

## Constraints for design

- Beta, no installed users: breaking the report contract is an accepted cost. No migrations, schema
  markers or compatibility shims (`openspec/config.yaml`, proposal rules).
- `src/domain/` stays free of `Buffer`/fs/SQLite/transformers.js. The decode step lives in
  `src/infrastructure/fs/`.
- `strict_tdd: true` — the decode-helper unit tests come first and need no fixture files.
- Everything in the diff is English. `ejemplos/` and `goldenset.yaml` are untouched.
- Node floor `>=22.12.0`. `buffer.isUtf8()` is confirmed present and correct on v22.22.0;
  `TextDecoder('windows-1252')` is confirmed **wrong** on the same runtime and must not be used.
- PR budget 400 lines. Scope excludes `cli.ts:207` and `config.ts:76`.

## Open questions for design

1. Exact shape and name of the new report field (`EncodingNotice[]` with `{path, detected}`, or
   something narrower), and where it sits in `ports.ts`.
2. The CP1252 override table as a fixed, reviewable 32-entry constant — confirm the byte→codepoint
   pairs against the Unicode consortium mapping rather than transcribing from memory.
3. Whether `GenerateIndexMd` surfaces encoding notices too. It shares the `DocumentSource` and the
   "never silently succeed on damaged content" principle, but only reads frontmatter and summary.
4. Whether the genuinely-undecodable case (neither valid UTF-8 nor plausibly CP1252) gets a distinct
   message from a generic read error, so an owner can tell "wrong encoding, unknown which" apart from
   "file could not be opened".
5. Detection confidence for the CP1252 fallback: after `isUtf8()` fails, is the fallback
   unconditional, or is there a check that rules out binary content misnamed `.md`?

## Reproducing the measurements in section 3

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

Expected on a runtime where `windows-1252` is correct: `0x93` decodes to `U+201C`. On Node v22.22.0
it decodes to `U+0093`. Re-run this before any future change that reconsiders Approach C.
