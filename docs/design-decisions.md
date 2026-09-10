# Design decisions

Non-obvious decisions, verified against code, with their full rationale and measurements. Moved verbatim from `AGENTS.md`, which keeps a one-line summary of each and links here. One section per decision so `read_doc({ path, section })` can address each one; "the bullet above" means the previous section, and "the Manual gate below" now lives in `docs/manual-gates.md`.

## Root selection is explicit or discovery

- **Root selection is explicit-or-discovery, never a hidden default.** `CompendioConfig.docsDir` is present only for explicit root mode; absent config, omitted `docsDir`, or `docsDir: []` selects discovery mode instead of synthesizing `["docs"]`. A populated `docsDir` array and CLI `--dir` are authoritative explicit modes. There is still no single-string config form, and malformed top-level config JSON shapes (`string`, `number`, `array`, `null`) are rejected instead of broadening into discovery. Every indexed document `path` carries the owning root alias as a prefix — declared-root basename in explicit mode and discovered top-level folder basename in discovery mode — so `docs/x.md` and `openspec/specs/y.md` round-trip through `search_docs`, `docs_overview`, and `read_doc({ path })` verbatim. A declared root set is rejected before document discovery/store mutation when roots duplicate, nest, or derive the same alias (`resolveRoots`, `src/infrastructure/config.ts`).

## Exclude matching semantics

- **`exclude` matches a full path, a basename, or a directory prefix — always against the emitted (prefixed) path.** `entry === path || entry === basename || path.startsWith(entry + "/")` (`FileDocumentSource.isExcluded`), with a trailing-slash strip on `entry` first so `exclude: ["openspec/changes/archive/"]` and `exclude: ["openspec/changes/archive"]` behave identically. This is not glob syntax — no wildcard, brace, or character-class matching. `exclude: ["docs"]` excludes an entire declared root; that is expressible, not guarded, and is the user's own statement.

## Unreadable roots fail closed in discovery mode

- **Discovery-mode unreadable roots fail closed; explicit roots preserve legacy tolerance.** A root present in explicit `docsDir` that cannot currently be read (a network mount down, a typo only some checkouts hit) is reported as a `ReadError` whose `path` is the root's **alias**, and the run continues on the remaining roots — throwing only when *every* declared root fails. Because `SyncIndex.deleteMissingDocuments`'s delete-protection (`isProtected`) keys on that same alias-prefixed `path`, the failed root's whole subtree survives the pass untouched (`src/infrastructure/fs/composite-document-source.ts`, `src/application/sync-index.ts`). **Removing a root from explicit `docsDir` is the opposite**: no `ReadError` is produced, so `deleteMissingDocuments` treats every one of that root's documents as absent-from-disk and purges them on the very next sync pass. Discovery mode is stricter and dynamic: every `index`, `sync`, and `serve` sync pass re-runs top-level discovery so a long-running server sees newly added Markdown-bearing top-level folders. Candidate probing scans the full tree even after finding early Markdown, any later scan/traversal/read error or selected-root failure (`ENOENT`, `EACCES`, `EIO`) aborts before store mutation, and previously indexed discovered root aliases are revalidated on fresh containers. If such a root still exists as a readable directory, it is traversed even with zero remaining Markdown so legitimate file deletions still purge normally; if it disappeared or became a symlink/junction, the pass fails closed and preserves rows.

## Module inference strips the root alias

- **`module` inference strips at most one matching declared-root-alias prefix before taking the first remaining path segment** (`inferModule(path, rootPrefixes?)`, `src/domain/convention.ts`, threaded from `composition.ts` unconditionally). Without this, `module` would degrade from "the folder a document sits in" into "which root it came from" — every top-level file under a declared root would report the root's own alias as its module instead of being root-level. This is well-defined only because `resolveRoots` rejects nested roots first: two aliases can never both be a prefix of the same path.

## Type, module and status are open strings

- **`type`/`module`/`status` are optional, project-defined open strings**, not a closed taxonomy — `src/domain/model.ts`'s old `Tipo`/`Estado`/`TIPOS`/`ESTADOS` are retired. Resolution is driven by `convention.mode` (`src/domain/convention.ts`, injected as a `ConventionPolicy`): `"loose"` (default, zero-config) infers `title`/`module` and never skips a file for missing/unknown metadata; `"strict"` (opt-in) is a linter that requires an H1 and non-empty `type`/`module`/`status`, validating `type`/`status` independently against a project's declared `convention.types`/`convention.statuses` when present (presence-only otherwise — `module` is always presence-only, it has no taxonomy). See `docs/documentation-convention.md` for the full behavior table.

## Status filtering is a NULL-aware deny-list

- **`status` filtering is a NULL-aware deny-list** (`convention.excludedStatuses`, default `[]`), not a closed allow-list — a document with no `status` is never excluded. `mergeConfig` builds `search` from an explicit whitelist rather than a spread, so an unrecognized key in a project's config can never leak into the loaded config (`src/infrastructure/config.ts`).

## Numeric config validation

- **A single `positiveNumber`/`positiveInteger` policy validates every declared numeric config key** — `chunk.minTokens`, `chunk.maxTokens`, `search.k`, and `sync.throttleMs` (`src/infrastructure/config.ts`, generalized from the pre-existing `validThrottleMs`). A declared value is honored only when it is a finite number greater than 0 (`search.k` additionally must be a whole number, matching the integer guard both `server.ts` and `cli.ts` already enforce per-call); anything else falls back to the default exactly like an absent key, with no clamping — any finite positive value, however small, is accepted. Two coercion findings shaped the exact boundary. A *quoted* number (`"480"`) is rejected even though every consumer of `maxTokens`/`minTokens` is a relational comparison (`estimateTokens(x) <= opts.maxTokens`) that would coerce a numeric string correctly on its own — `typeof value === "number"` is a deliberate, not incidental, part of the guard, and it means a declared `maxTokens: "600"` that worked before this change now silently reverts to the default. `NaN` can never be *declared* at all: the JSON grammar has no `NaN` literal, so `JSON.parse` throws first. `1e400` parses to `Infinity` (IEEE-754 overflow under the JSON number grammar), which `Number.isFinite` rejects like any other invalid value.

## Nullable metadata columns and schema upgrades

- **SQLite `type`/`module`/`status` columns are nullable.** `migrate()` (constructor path — runs on *every* container construction: `search`, `overview`, `eval`, `index-md`, `serve`, `index`) stays a non-destructive `CREATE TABLE IF NOT EXISTS`. The current-schema guarantee — including upgrading a pre-existing database created under the old `NOT NULL` schema, with no manual `.compendio/` deletion — lives in `reset()` instead, which runs only once, at the start of `IndexDocuments.execute()`, as a single-transaction drop-and-recreate (`src/infrastructure/sqlite/sqlite-index-store.ts`). Concurrent readers (e.g. a live `compendio serve`) during that transaction are a declared non-goal — they may see empty results or a transient error for its duration; retrying after the `index` run completes is the supported behavior.

## reset() recreates the database file when vec0 cannot load

- **`reset()` has a second path that recreates the database file, and it is not optional.** When the database carries a `chunks_vec` table created while sqlite-vec loaded, and the current process cannot load the extension, the in-place `DROP TABLE IF EXISTS chunks_vec` raises `no such module: vec0` — dropping a virtual table needs the module to call its destructor. That throw happens before a single file is read, so **`compendio index` used to die outright on that database**. `reset()` now detects the case (`!vectorsEnabled && tableExists("chunks_vec")`), closes the connection, deletes the `.db` plus its `-wal`/`-shm` sidecars, and reopens. Do not "simplify" this back into guarding the DROP: dropping vec0's four shadow tables by name was measured to succeed and still leave the undroppable `chunks_vec` row in `sqlite_master` — a half-destroyed table that breaks the moment the extension loads again — and skipping the drop entirely leaves stale vectors attached to chunk ids that restart at 1, silently pairing the previous corpus's vectors with the new corpus's chunks. Deleting the file loses nothing `reset()` was not already destroying. The healthy path is unchanged and still an in-place transaction, which `test/infrastructure/sqlite-index-store-degraded.test.ts`'s D7 canary pins.

## INDEX.md and docs_overview ordering

- **`INDEX.md` and `docs_overview` order entries alphabetically by `path` by default** (`src/domain/index-markdown.ts`'s `renderIndexMd`/`createIndexComparator`). Under `strict` with a declared `convention.types`, ordering follows that declared sequence instead, falling back to alphabetical by `path` within each `type` group. There is no legacy `TIPOS.indexOf` compatibility path.

## Overview buckets keyed by arbitrary strings

- **A `docs_overview` `byType`/`byModule` bucket is never lost or garbled by the string value it is keyed by** (`GetOverview.execute`, `src/application/get-overview.ts`). `type` and `module` are open, project-defined strings, so a declared value can collide with a member name inherited from `Object.prototype` (`__proto__`, `constructor`, and their kin) — reachable, for `module`, through nothing more than a folder literally named `constructor`. The counters are accumulated in a `Map` and converted to the returned `Record<string, number>` with `Object.fromEntries`, never a plain-object accumulator or an assigning conversion loop, so no key can be silently dropped or coerced into a garbled value.

## CLI entry-point guard uses realpathSync, not realpathSync.native

- **`cli.ts`'s entry-point guard must keep using `realpathSync`, NOT `realpathSync.native`** — it
  looks like the same defect `discover-markdown-roots.ts` had (JS `realpathSync` PRESERVES a Windows
  8.3 short name; `realpathSync.native` and `fs/promises`' `realpath` EXPAND it) and it is not.
  There, both compared values came from the filesystem, so mixing the two canonicalizations produced
  a phantom "the root changed". Here only ONE side is canonicalized by us; the other,
  `import.meta.url`, arrives already resolved by Node's ESM loader — which resolves the entry through
  that same JS `realpathSync`. Both sides therefore preserve the short name identically and the guard
  holds. Measured on Node 22.22.0, launching through a real 8.3 alias
  (`...\C-560F~1\SCRATC~1\probe.mjs`): the current comparison is `true`, and the `.native` variant
  is `false` — so the "hardening" fix would BREAK the guard, and a broken guard exits 0 with empty
  stdout, which reads as success. `.native` is also `false` for nothing worse than a lowercased drive
  letter (`c:\...`) on a fully long path. A link + short path together is fine either way: resolving
  the link discards the 8.3 prefix with it. Pinned by `test/cli-subprocess.test.ts`'s "invoked
  through a Windows 8.3 short path" case, which asserts STDOUT (never the exit code) and skips
  explicitly — never silently passes — on a volume that mints no alias.

## sqlite-vec requires BigInt primary keys

- **`sqlite-vec` requires `BigInt` primary keys** with `better-sqlite3` — passing a `number` throws "Only integers are allowed" (`src/infrastructure/sqlite/sqlite-index-store.ts:153-154`).

## Normalized embeddings with plain L2

- **Embeddings are normalized in the provider; the `vec0` table uses plain L2**, not `distance_metric=cosine`. With normalized vectors, L2 order == cosine order, and it sidesteps a fragile cross-version syntax.

## index-md reads the filesystem, not the index

- **`compendio index-md` reads the filesystem, not the SQLite index** (`GenerateIndexMd` in `src/application/generate-index-md.ts` uses `DocumentSource` + `MarkdownParser` directly). This means generated `INDEX.md` can never lag behind a stale DB index. Discovery mode writes project-root `INDEX.md`; explicit config and `--dir` write inside the first effective root. `INDEX.md` never lists itself even if config `exclude` is overridden.

## Graceful degradation on embeddings failure

- **Graceful degradation on embeddings failure is trigger-agnostic and cause-agnostic.** Both `IndexDocuments` (full `compendio index`) and `SyncIndex` (incremental `compendio sync`/`serve`) complete in lexical-only mode (`mode: "lexical"`) instead of crashing or dropping content, and report why via `embeddingsWarning` — whether the cause is the embeddings provider (missing or throwing) or the store itself being unable to persist vectors (`IndexStore.canPersistVectors()` returning `false`, e.g. the `sqlite-vec` extension failing to load). `SyncIndex` asks `canPersistVectors()` **once per pass**, in `execute()`, before any per-document work — not inside the per-document embed step — so the degradation is reported even on a pass where nothing is new or changed (the shape a running `serve` produces most); a fix scoped only to the per-document path would report a false `mode: "hybrid"` on that pass. When vectors cannot be persisted, `embed()` is never called at all (no wasted CPU or model download) and `IndexStore.upsertDocument` still commits the document, its chunks, and its FTS rows — only the vector row is skipped. A genuine hard write failure (unrelated to vector-persistence unavailability) is still a per-document skip, not a degrade.

## TextDecoder windows-1252 is wrong on the Node floor

- **`TextDecoder('windows-1252')` is measurably wrong on this project's Node floor** — it decodes byte-for-byte identically to `latin1`, mapping `0x93` to `U+0093` (a C1 control) instead of `U+201C` (a curly quote). It does not throw and returns a `string`, so nothing catches the mistake, and `readFile(path, 'latin1')` is wrong in exactly the same way. `0x80–0x9F` is precisely where Word puts curly quotes, dashes and ellipses, so this is silently wrong on the shape of corpus `encoding-aware-reads` exists for. Reproduce on this repo's Node floor:
  ```bash
  node -e "
  const cp = s => [...s].map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')).join(' ');
  const b = Buffer.from([0xC0, 0x93]);
  for (const label of ['windows-1252','cp1252','windows-1251','iso-8859-1']) {
    const d = new TextDecoder(label);
    console.log(label.padEnd(14), '->', d.encoding.padEnd(14), cp(d.decode(b)));
  }
  "
  ```
  `0x93` must print `U+201C`; on the floor runtime (measured on v22.22.0) it prints `U+0093`. Because of this, `src/infrastructure/fs/decode-text.ts` bans `TextDecoder` outright and hand-writes the 27-entry CP1252 `0x80–0x9F` override table instead (verified against both `https://www.unicode.org/Public/MAPPINGS/VENDORS/MICSFT/WINDOWS/CP1252.TXT` and `https://encoding.spec.whatwg.org/index-windows-1252.txt`). Do not "simplify" that table back into `TextDecoder('windows-1252')` or `readFile(path, 'latin1')` without re-running this command first.

## Heading-based chunking with a hard size bound

- **Heading-based chunking** (H2, H3 if a section exceeds the token max) decides WHERE the coarse cuts land; `splitToBound` (`src/domain/split-text.ts`) then guarantees every emitted chunk stays within `chunk.maxTokens` regardless of source. A table or fenced code block that would otherwise exceed the bound is split across rows/lines, re-emitting its header/separator or fence markers on each piece — tables and fences ARE split mid-row/mid-block when they must be to hold the bound.

## Chunk boundary changes need a full reindex

- **A `chunk.maxTokens` (or splitting-logic) change needs a full `compendio index` to reach an existing corpus.** Incremental sync's change fingerprint is the document's content hash alone, so a document whose content hasn't changed keeps its old chunk boundaries under an incremental sync pass — whether triggered by `serve` (startup or a throttled pre-tool-call check) or invoked manually via `compendio sync` — even after the config changes. There is deliberately no schema-version marker or automatic re-chunk migration for this (`openspec/specs/indexing/spec.md`'s "Chunk Boundary Changes Require a Full Reindex to Reach Existing Documents" requirement) — `compendio index`'s `reset()` (drop-and-recreate) is the only mechanism that applies new boundaries to unchanged content.

## No chunk has an empty heading

- **No persisted chunk ever has an empty `heading`.** The invariant is enforced once, at `transformFile` (`src/application/index-pipeline.ts`), via `withNonEmptyHeadings` — not inside `chunkOutline` itself, so both chunk producers (`chunkOutline` and the `NO_CHUNKING` path's `wholeDocumentChunk`) are covered by one expression rather than two. The fallback chain (`src/domain/chunking.ts`'s `documentHeading`) is: the chunk's own heading path → `DocumentMeta.title` (the humanized filename under `loose`) → the document's `path` → the literal `"Untitled document"`. Level 2 is the path, not a fixed literal, because it round-trips by construction: `normalize` (`src/domain/similarity.ts`) only lowercases and strips diacritics, leaving punctuation intact, so a value like `-.md` still matches itself through `read_doc`'s normalized-substring matcher. Same operational shape as the bullet above: a heading-only change does not reach unchanged documents through incremental sync either — the fingerprint is the content hash alone, so a document whose content hasn't changed keeps its old (possibly empty) heading under an incremental sync pass, whether triggered by `serve` or invoked manually via `compendio sync`, and a full `compendio index` is required for the corrected heading to land on an existing corpus.

## RRF fusion constant is 5, not 60

- **RRF** (`score = Σ 1/(RRF_K + rank)`, `RRF_K = 5`) fuses lexical and vector rankings — no weights
  to tune. **The constant is 5, not the literature-default 60, and that is a measured decision**
  (`src/domain/fusion.ts` carries the full reasoning). At 60 the formula is nearly flat over rank:
  a chunk ranked #1 by one leg (1/61) loses by 1.74x to any chunk present in BOTH legs at rank ~10
  (2/70), so fusion rewarded agreement between the legs over the quality of either match. Measured
  case: an 888-chunk corpus where the answering chunk was BM25 #1 and vector #62 fused to #18 and
  was never returned; at 5 it lands at #3. Neither raising the over-fetch limit (it reaches only
  #12 with the vector leg fully participating) nor raising the per-document cap moves it — the cap
  is not the binding constraint, despite `rank-probe.mjs` reporting a needle chunk dropped by it.
  Verified against both evaluated corpora: `ejemplos/` holds at recall@5 1.00 / MRR 0.943 / 0
  failures (identical to 60; MRR only degrades at 2 and below), and a 60-query chunk-level
  goldenset over `demo-docs` improved 52/60 → 55/60 answers found with its rank-1 count unchanged
  at 37. This narrows the both-legs preference, it does not invert it — an id found by both legs
  still outscores one found by a single leg; what changes is rank leverage (ranks 1 and 2 differ
  by 1.6% at 60, by 17% at 5). **What it does NOT fix**: the vector leg still ranked that chunk
  #62 of 888. A smaller constant compensates for a weak vector rank by giving lexical more
  leverage; it cannot rescue a query that both legs miss.

## Impossible filters are dropped

- **A structurally impossible filter is dropped, not honoured** (`dropImpossibleFilters` in `src/domain/search-diagnostics.ts`). An agent told to go straight to `search_docs` cannot know the project's taxonomy, so it infers `type` from directory names (`docs/uc/` → `type: "uc"`); against a project whose frontmatter keys were never mapped, that filter can never match. Prose could not stop this — parameter descriptions saying "never infer it from directory names" were observed being ignored three times in one session, with the agent escalating `k` from 5 to 10 rather than dropping the filter `noMatchReason` told it to drop. So the mechanism changed instead: a filter targeting a field **no document declares** is removed, the search re-runs unfiltered, and `filterWarning` says what was ignored and names `convention.frontmatterFields` as the real fix. Nothing is hidden — the fallback is loud. The narrower line matters: a filter on a *declared* field with an unknown value is kept, because that request is answerable and the caller gets the real values back to correct itself with.

## Empty results explain themselves

- **An empty `search_docs` result explains itself** via `noMatchReason` (`explainEmptyResult`), covering the value-does-not-exist case (declared values listed), individually-valid filters whose combination matches nothing, and the project's own `convention.excludedStatuses` deny-list — that last being the case a caller cannot possibly guess, since it comes from config rather than the request. Deliberately absent on an *unfiltered* miss: a bare query matching nothing needs no explanation, and inventing one would be noise on every empty search.

## Filter strings are normalized once

- **A caller-supplied filter string is normalized exactly once, at `SearchDocuments.buildFilters`** (`src/application/search-documents.ts`), and nowhere else. `type` and `module` are trimmed and omitted entirely when blank; `tags` are trimmed, lowercased and empty entries dropped via the shared `normalizeTags` (`src/domain/tags.ts`) — the same function `resolveTags` (`src/domain/frontmatter.ts`) uses to normalize a document's own declared tags at index time, so the write side and the read side cannot silently drift apart on what counts as a tag. A blank value in any of the three fields is treated as a client mistake, not a request to match the empty string, and the normalization is **silent** — no `filterWarning`, no third diagnostic variant. `src/domain/search-diagnostics.ts` (`dropImpossibleFilters`, `explainEmptyResult`) is deliberately **not** defensive against a raw, unnormalized `SearchFilters`: both functions have exactly one production caller, always downstream of `buildFilters`, so a trim added there would be dead code on every real path while leaving a genuinely bypassing future producer — which never reaches these functions at all — exactly as exposed as before. `type`'s trim at `parseType` (`src/cli.ts`) and `buildFilters` is intentionally redundant — `trim(trim(x)) === trim(x)` for every input, so the two can never disagree — and is kept rather than removed, unlike the write/read tag asymmetry this repeats-the-rule pattern replaced.

## read_doc tolerates one leading path segment

- **`read_doc` tolerates one leading path segment** (`ReadDocument.resolve`, unchanged by `multiple-doc-roots` — the strip-fallback branch was already correct once every indexed path carries its root alias). Indexed paths are root-alias-prefixed (`docs/func/x.md`), so a caller holding the on-disk project-relative path now hits the **exact** match; the strip fallback is reserved for a genuinely over-prefixed value (`repo/docs/func/x.md` → strips to `docs/func/x.md`). Only attempted when the literal path misses, and only one segment deep, so a genuine document at `a/b.md` always wins over stripping into `b.md`. **One documented non-guarantee**: with multiple declared roots, a miss whose stripped form happens to equal another root's real path resolves to that document instead of `path-not-found` (`docsDir: ["docs","adr"]`, requesting the non-existent `docs/adr/x.md` strips to the real `adr/x.md`) — the mechanism cannot distinguish this from the over-prefixing case it exists to serve. A bare basename (`x.md`) no longer resolves at all, since a single-segment path has no leading segment to strip; it returns `path-not-found` with the 3 closest matches.

## read_doc section lookup is fence-aware

- **`read_doc`'s section lookup is fence-aware, chunk-local, and shares the chunker's own
  `isFenceDelimiter` predicate — not a stricter parser, deliberately.** `headingsIn`
  (`src/application/read-document.ts`) excludes a `##`-`######` line that sits inside a fenced code
  block from both section matching and the `section-not-found` available-sections listing, using the
  exact same fence-delimiter regex `splitToBound` uses (`src/domain/split-text.ts`'s exported
  `isFenceDelimiter`) — the same argument as the sqlite-vec/normalized-vectors bullets above:
  `read_doc` agreeing with the boundaries the indexer actually produced matters more than either being
  independently more CommonMark-correct. Fence state is evaluated per **stored chunk**, never across
  chunk boundaries, and only suppresses a heading when that chunk's own fence-delimiter-line count is
  even (balanced) — an odd count means the chunk begins or ends mid-fence and nothing in it is
  suppressed. Four named non-guarantees, not covered by this fence-awareness: **(1)** an unterminated
  fence (no closing delimiter anywhere in the chunk) still produces phantom headings; **(2)** a chunk
  that begins mid-fence (no opening delimiter, because the fence opened in a preceding chunk) is
  unaffected — safe direction, the heading stays reachable; **(3)** a 4-space-indented code block
  carries no fence delimiter to detect at all; **(4)** a chunk whose fence-delimiter count is even but
  *misaligned* — one stray closer (from a fence opened in an earlier chunk) immediately followed by one
  stray opener (starting a fence that continues into a later chunk) — reads as "balanced" like a
  genuine self-contained fence, so a real heading sitting between the two stray delimiters is
  suppressed. Unlike (2), this is the regression direction (a real heading becomes unreachable), and it
  is a deliberately accepted, documented limitation (design.md Decision 4's orchestrator note,
  `read-doc-fence-aware-sections`), not a defect — see `mcp-contract/spec.md`'s fourth non-guarantee.

## Excerpt flattening is fence-aware

- **`search_docs` excerpt flattening (`stripHeadingLines`, `src/domain/flatten-map.ts`) is fence-aware,
  chunk-local, and balanced-only, sharing the same `isFenceDelimiter` predicate as `read_doc`'s section
  lookup above** (`excerpt-fence-aware-flatten`) — the counterpart change to the `read_doc` bullet above,
  not its copy: the fence-interior heading-pattern line is **kept**, not skipped, because S1's output
  feeds the next flatten step (`` /```[^`]*```/g ``), which needs both delimiters of a pair present to
  recognize and drop a fence at all — a copied `continue` would silently disable that drop corpus-wide
  while every existing invariant stayed green. The same four shapes are uncovered, but shape 4 (a
  misaligned-even chunk: stray closer, then content, then stray opener) has the **opposite, milder**
  consequence here: a real document heading is misread as fence-interior and **retained**, leaking its
  text into the excerpt as prose, rather than a real section becoming unreachable. Shapes 1-3 (unterminated
  fence, chunk-crossing fence, 4-space-indented block) fail toward today's behaviour, same as `read_doc`'s.
  One measured, deliberately unfixed residual risk: a fence-interior heading-pattern line can now carry a
  backtick, and an ODD backtick count breaks `` /```[^`]*```/g ``'s pairing, leaking the whole fence into
  the excluded-pass excerpt too — measured as zero live instances on this repo's own corpus (0 of 21 newly
  retained fence-interior lines carry a backtick), and recorded rather than fixed, since fixing it means
  designing and CRLF-verifying a second regex for a step (S2) this change deliberately did not touch
  — closed by `excerpt-fence-drop-generalization`; see the next bullet. The 0-of-21 measurement stands as
  the reason it was safe to defer, not as a live risk. The
  probe script for this gate lives beside `section-lookup.mjs`:
  `scripts/excerpt-flatten-probe.mjs <root>` (needs `node dist/cli.js --root . index --lexical` first).

## S2 fence drop is delimiter-agnostic

- **S2's fence drop (`flatten-map.ts:35`) is delimiter-agnostic, interior-agnostic, and — unlike every
  other fence mechanism in this codebase — NOT balanced-gated** (`excerpt-fence-drop-generalization`).
  The regex is `` /```[\s\S]*?```|~~~[\s\S]*?~~~/g ``, not the old `` /```[^`]*```/g ``: the old form
  identified a fence by *character-class exclusion* over a string S1 had already stripped of newlines,
  which spelled the delimiter in backticks (so a `~~~` fence was **never** dropped from any excerpt,
  in either pass) and could not cross an interior backtick (so **one** stray backtick inside a fence
  made the pair unmatchable, leaking the entire fence — delimiters, body and all — into the
  `dropFencedBlocks: true` excerpt byte-identically to the `false` pass). Both are closed. `*?` is
  load-bearing: a greedy `[\s\S]*` would match a chunk's first delimiter to its last, merging every
  fence and deleting the prose between them, and neither I1-I3 nor I4 would notice (I4 carries the
  same literal by design). **The accepted divergence**: S1, `read_doc`'s `headingsIn` and the chunker
  all refuse to act on a chunk whose fence-delimiter-line count is ODD; S2 has no such whole-chunk
  gate and will still drop a well-formed pair inside one, leaving the stray third delimiter as text
  (S3 then blanks it). So S1 and S2 can now answer "do we trust this chunk's fence state?"
  **differently for the same chunk**. This is not content loss — strictly more genuinely-fenced
  content is correctly dropped than before — but it does break the "every mechanism shares one
  fence-state rule" pattern the two prior cycles established as a value. Closing it would require S2
  to consult whole-chunk parity before matching, which is the S1-fusion architecture this change
  exists to avoid. One further non-guarantee, from `*?`'s nearest-closer rule: **improperly
  interleaved** fences (`~~~ a ``` b ~~~ c ``` `) pair across the two styles and leave a residue.
  Nesting either way round is handled correctly — the outer fence is consumed whole, which is what a
  nested fence *is*. The gate corpus is `test/fixtures/excerpt-fence-drop/docs/`, whose two
  `*-crlf.md` documents are pinned CRLF by `.gitattributes` **on purpose**: the CRLF half of the gate
  is real evidence only if the line endings survive checkout. Probe:
  `node scripts/excerpt-fence-drop-probe.mjs test/fixtures/excerpt-fence-drop` (needs
  `node dist/cli.js --root test/fixtures/excerpt-fence-drop index --lexical` first). **A second,
  discovered-at-apply-time consequence, folded in here rather than opened as a new location**: this
  same style-agnostic recognition narrows the sibling `excerpt-fence-aware-flatten` bullet's own D3
  guarantee — that a span on a retained fence-interior heading-pattern line stays locatable — to the
  fenced-blocks-INCLUDED (fallback) pass only. Before this change, a retained line inside a `~~~`
  fence happened to stay locatable even on the excluded pass, purely because that pass's
  fence-recognition was backtick-only and blind to `~~~`; that was always an accident of the gap this
  change closes, never a designed guarantee, and it stops holding for every fence style once
  recognition is style-agnostic. `test/domain/excerpt.test.ts`'s own D3 test was rewritten to observe
  this claim directly against `flattenWithMap`/`toFlatOffset` rather than through `buildExcerpt`,
  since no fence shape can isolate S1 from S2 through `buildExcerpt` any more — see
  `mcp-contract/spec.md`'s narrowed requirement for the same fence-retention bullet above.

## isFenceDelimiter module move is deferred

- **`isFenceDelimiter`'s revisit trigger (`read-doc-fence-aware-sections`'s Decision 1: "move it to its
  own domain module when a third consumer appears… the candidate is already identified:
  `src/domain/flatten-map.ts:92`") has now fired — `excerpt-fence-aware-flatten` is that third consumer —
  and was deliberately deferred again, not acted on.** The function stays exported from
  `src/domain/split-text.ts`, imported by `flatten-map.ts` and `read-document.ts` both. Recording it here,
  in the same greppable sentence as the S2 follow-up above, is the point: the previous deferral survived
  only as one line in an archived change's report and had to be rediscovered by a whole new SDD cycle.
  **Third occurrence, `excerpt-fence-drop-generalization` (2026-08-16): the trigger did NOT re-fire and
  the deferral stands.** That change touches only S2's regex literal, which never imports the predicate,
  so the consumer count is still exactly three. Recorded here rather than in an archived report for the
  same reason the sentence above exists. **The next thing that adds a fourth importer should move it**
  — three deferrals is the point at which "cheap later" stops being an argument.

## HEADING_LINE needs an optional CR before its end anchor

- **The `HEADING_LINE` regex needs an explicit `\r?` before its `$` anchor, or CRLF documents lose every
  content-derived heading, silently.** Discovered live on this repository's OWN CRLF-encoded
  `docs/documentation-convention.md` during `read-doc-fence-aware-sections`: `String.split("\n")`
  leaves a trailing `\r` on every line, and — unlike the previous `matchAll(/…/gm)` on the WHOLE
  document, where `$` (multiline mode) matches immediately before ANY line terminator including a bare
  `\r` — a per-line `.exec()` without the `/m` flag requires `$` to sit at the literal end of that
  line's string. `.` never matches `\r`, so `(.+)$` (with no trailing `\r?`) fails to match every
  single heading line on a CRLF document, not merely fenced ones. `HEADING_LINE` is
  `/^#{2,6}\s+(.+)\r?$/`, not `/^#{2,6}\s+(.+)$/`, precisely to keep this working.

## Graduated excerpt budget

- **The excerpt budget is graduated by rank, not uniform** (`src/domain/excerpt.ts`'s `excerptBudget`). A flat cap loses either way: small enough to keep `k` results affordable is too small to answer with. Measured over `ejemplos/` + a 17-doc external corpus, the previous flat 240 truncated ~93% of fragments and withheld ~70% of their content, so `search_docs` paid answer prices for router value while `read_doc` stayed mandatory anyway. The policy is only sound because rank 1 usually *is* the answer (hybrid MRR 0.943, top-1 20/22 on `ejemplos/`) — if that regresses, revisit this first.

## What supporting-excerpt-anchoring did not change

- **What `supporting-excerpt-anchoring` did NOT change**: the 1400/120 split itself is untouched, and the graduated-by-rank policy above is not re-litigated. What changed is only *where inside* a supporting fragment's 120-character budget the window sits — centred on the fragment's own matched span (`locateSpans` now runs for every rank, not rank 0 only), falling back to a start-anchored prefix only when the chunk's flattened content holds no locatable query term. Two accepted costs, both 0% before this change, both measured on `ejemplos/`: both-ellipsis fragments (window truncated on both sides) 0% → 78.4%, and hard mid-word edges (the window's own snap-revert guard refusing to hide the match) 0% → 9.1% — an external 81-document corpus corroborates at 84.4% / 3.4% but is not reproducible in this repository. The `…` truncation signal's *meaning* shifts with the first number: today it usually means "more after"; after this change, for most supporting fragments it means "more on both sides" — a weaker discriminator for an agent deciding whether `read_doc` is worth it, and **this behavioural effect is unmeasured and unproven**, accepted on the reasoning that a fragment showing the matched terms routes better than one showing unrelated opening prose. See `scripts/supporting-anchor-probe.mjs` and the Manual gate below for how these numbers are reproduced.

## matchedTerms is a deferred follow-up

- **`matchedTerms` is a NAMED, DEFERRED follow-up, not an unrecorded idea** (`supporting-excerpt-anchoring`,
  explicit user decision 2026-09-05). Surfacing which query terms a result's chunk contains — a
  `matchedTerms: string[]` per `search_docs` result, built from the `terms` already hoisted once per
  search (`search-documents.ts:108`) and, **since this change, from spans that now exist at every
  rank** — is estimated at ~25-30 tokens per response, against the +274 tokens per response a
  400-character supporting budget was measured to cost. It is deferred because it is **unmeasured**
  and because it widens the MCP response contract, and this change deliberately rests on complete
  measured evidence. **What should fire it**: agent traces showing supporting hits driving excess
  `read_doc` chaining — the same observation that would reopen the both-ellipsis trade — or the next
  change that widens `SearchResultItem` for any other reason. Deferral count: 1.

## locateSpans requires word boundaries

- **`locateSpans` now requires a word boundary at both ends of a located span — a substring
  occurrence no longer counts as "a term matched"** (`word-boundary-term-matching`,
  `src/domain/match-location.ts`). It was a plain `indexOf` scan with no condition on either end,
  disagreeing with the lexical retriever it is supposed to be explaining: `toFtsQuery` emits a
  quoted, non-wildcard `MATCH` string against an FTS5 table with no stemmer, so `"charge"` never
  matches a chunk holding only `charged`, but the old `locateSpans` happily centred an excerpt on
  it. Classified over `DocuTests2` (888 chunks, exploration measurement): **71.9% of spans were not
  word matches** — 36.6% a prefix of a longer word, 35.3% an interior fragment, 0.0% a suffix.
  Re-measured on this repository's own `ejemplos/` corpus by the shipped gate
  (`scripts/word-boundary-probe.mjs`): of 3 035 spans the old code would have emitted across the
  22-query goldenset, 1 343 (44.3%) were non-exact, and after the fix 0 of the remaining 1 692 are —
  every one is a whole-token match, retention 55.7%. **The functional cost is zero, measured, not
  assumed**: W3 (fragments that lose every span and fall back to the start-anchored prefix) is 0 on
  `ejemplos/`'s 22 queries; 48 of 110 supporting/lead fragments (43.6%) show a different excerpt
  because `selectMatchCentre` now sees fewer, more honest candidates — reported, not gated (design.md
  Decision 5: a moved centre is the change working, and there is no excerpt-quality metric in this
  repository to threshold against). **The boundary test runs in FOLDED coordinates, not raw**
  (design.md Decision 2) — this is not tidiness, it is normalization-form correctness: `"áthe"`
  written NFD (`a` + U+0301 combining acute + `the`) puts a bare combining mark at
  `raw[start - 1]`, and a combining mark is not `\p{L}`/`\p{N}`, so a **raw**-coordinate test wrongly
  accepts the span; the NFC spelling of the identical text puts a plain `á` there and raw correctly
  rejects it. Folded coordinates give the same (correct) answer for both spellings, because that is
  where the match itself was made. Measured directly against compiled `dist/`: `"áthe value"` NFC
  rejects in raw coordinates, `"áthe value"` NFD wrongly accepts in raw coordinates — pinned by a
  decomposed-accent test in `test/domain/match-location.test.ts` that asserts its own input is
  genuinely NFD before asserting behaviour (`input.normalize("NFC") !== input`), following
  `test/fixtures/excerpt-window/`'s self-asserted-precondition pattern; a normalizing editor can
  silently revert an inline literal or a fixture file, and only that assertion would catch it.
  **The new `WORD_CHAR` predicate is deliberately NOT exported** — an exported predicate is one the
  falsifying gate probe could import, which would make its own "did the fix land" counter a
  tautological echo of the code it exists to falsify; the probe's classifier is written
  independently, in raw coordinates. Five named non-guarantees remain, deliberately not closed by
  this change: (1) the locator's fold (`foldForMatch`) is narrower than FTS5's
  `unicode61 remove_diacritics 2`; (2) the boundary class `[^\p{L}\p{N}]` is this project's own
  tokenizer class, not byte-for-byte `unicode61`'s token boundary; (3) no stemming in either
  direction — an inflected form never counts toward locatability of its root, matching the
  retriever, which does not stem either; (4) a lone surrogate half beside an astral-plane letter may
  read as a boundary here where FTS5's tokenizer would not; (5) this narrowing carries no
  corpus-frequency signal and does not change `selectMatchCentre`'s scoring, ranking, or the
  1400/120 excerpt budgets — those stay exactly as `supporting-excerpt-anchoring` left them. This
  change does **not** fix `docs/retrieval-open-work.md`'s Open problem 3 (rarity-weighted centre
  selection): the motivating `billing-rules.md` example was measured, during exploration, to still
  select the same early cluster after removing `charge` — the justification for this cycle is
  independent correctness (one definition of "a term matched", not two), not that symptom.

## Skipped files never fail the run

- A file that is unreadable, genuinely undecodable (neither valid UTF-8 nor plausibly CP1252 — see `decode-text.ts` above), fails frontmatter parsing, or (under `strict`) fails validation is skipped and reported in `skipped` — both by `index` and by `index-md` — never a hard failure of the whole run; these resilience reasons are mode-independent (identical under `loose` and `strict`). A file that decodes successfully under a non-UTF-8 encoding is not skipped — it is indexed normally and reported separately as transcoded.

## Test doubles and fixtures

- Test doubles: `test/helpers/fake-embeddings.ts` provides a deterministic embeddings stub (stem-grouped, no model download) used by integration tests against the real `ejemplos/` corpus. `test/fixtures/strict/` is a small synthetic corpus + `compendio.config.json` that exercises `convention.mode: "strict"` end to end.

## MCP tool surface and progressive disclosure

Registered in `server.ts`. Progressive disclosure is a set of rungs, **not a mandatory sequence**: `search_docs` is the entry point for a specific question (it usually answers outright, in one call), `docs_overview` is for enumerating the corpus or picking filter values, and `read_doc` is the last resort — with a `section`, since a whole document costs several times more. The tool descriptions carry this routing, so it holds without any per-project agent configuration.

1. `docs_overview()` — corpus map (counts by type/module, ~10 tokens/doc). `byType`/`byModule` buckets and per-document `[type]`/`(status)` segments are omitted entirely when a document/corpus has no value for that field — never a synthetic "no type" bucket or `[undefined]`.
2. `search_docs({ query, type?, module?, tags?, k?, include_excluded? })` — hybrid search, top-k fragments with a **graduated excerpt budget**: the rank-1 fragment gets `LEAD_EXCERPT_CHARS` (1400), spent as a window centred on the matched span rather than as a prefix, so it can answer outright; the rest get `SUPPORTING_EXCERPT_CHARS` (120), spent the same way — a window centred on their own matched span — enough to judge whether rank 1 is the right one. A supporting fragment falls back to a start-anchored prefix only when its chunk's **flattened** content holds no locatable query term (the vector-only / fold-miss path, and a term that survives only in a heading line). A `…` at either edge is the documented truncation signal that tells an agent to call `read_doc`. `type` is an open, project-defined string (no enum). Docs whose `status` is listed in the project's `convention.excludedStatuses` are excluded unless `include_excluded` is set; with nothing declared (the default), nothing is excluded and the flag is a no-op.
3. `read_doc({ path, section? })` — one section or the full document; `type:`/`module:`/`status:` header lines render only when present. Unknown `path` returns the 3 closest matches instead of erroring.

The MCP surface stays exactly these 3 tools — **`compendio sync` is a human-only CLI escape hatch, not a fourth MCP tool.** Every tool call already triggers `serve`'s throttled pre-tool-call sync, so an agent has no gap `sync` would close for it; an agent that suspects its answers are stale can only tell the user to run `compendio sync`, never call it itself (user decision, `manual-sync-command` proposal Q1).

## Why English code indexes Spanish docs without loss

- Why this is safe, and worth re-deriving before doubting it: frontmatter keys never reach the index (`matter(raw)` yields `{ data, content }` and only `content` is chunked and embedded), FTS5 uses `unicode61 remove_diacritics 2` with no language-specific stemmer, and `EvaluateSearch` passes no metadata filters. Code language and retrieval quality are structurally independent.
