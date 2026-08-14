# Design: Config Value Validation — one policy for every declared numeric key, and a channel that says so

**Phase**: design · **Artifact store**: openspec (Engram MCP tools unavailable this cycle) ·
**Skill resolution**: paths-injected (`sdd-design`, `_shared/sdd-phase-common`) — no project skill in
the registry applies to a TypeScript configuration change.

**Fork decision: C — fallback plus a reported warning — delivered as two chained PRs.** Slice 1 is
validation and key hygiene, silent, uniform across all four numeric keys. Slice 2 is the reporting
channel, which every one of those keys plus unrecognized keys plus an inverted `minTokens`/`maxTokens`
pair rides. The reasoning is Decision 1; the reason it must be two PRs rather than one is Decision 2.

## Findings that correct the inputs

Recorded first, not buried, per this project's practice. Every row was checked against the file rather
than carried on trust. **Two of them change what the change is, not just how it is described.**

| Claim in the exploration / proposal | Verified state |
|---|---|
| *"`{"chunk": {"maxTokens": "480"}}` produces exactly the same degeneracy as a literal `0`"* — the proposal's whole "Quoted numbers are not a footnote" section, and Gate 1's third run | **False, and this is the most consequential correction in the design.** Every use of `maxTokens` in the codebase is a relational comparison — `estimateTokens(x) <= opts.maxTokens` at `split-text.ts:19,60,68,174,180,220,226,323` and `chunking.ts:72,122` — and every use of `minTokens` is `tokens < opts.minTokens` (`chunking.ts:120`). **There is no arithmetic on either value anywhere.** JavaScript's relational operators coerce a string operand to a number, so `maxTokens: "480"` behaves *identically to the number 480*: correct chunking, no explosion. The dangerous shapes are the ones that coerce to `0`, to `NaN`, or to `Infinity` — see the reachability table below |
| *"`chunk.maxTokens: 0 \| NaN \| "480"` — the per-code-point explosion"* (proposal, second bullet of "The failure that is quiet") | `NaN` **cannot be declared at all.** The JSON grammar has no `NaN` and no `Infinity` literal, so `JSON.parse` rejects them and `loadConfig` already throws at `config.ts:89-93`. A `NaN` fixture is a test that cannot be written. `NaN` is real in the *consequence* chain (`k * CANDIDATE_FACTOR` with a non-numeric `k`), which is what the exploration actually observed — but not as a declared value |
| *"`search.k: "abc"` — `k * CANDIDATE_FACTOR` → `NaN` → … better-sqlite3 rejects it"* | **Confirmed for a non-numeric string.** But `search.k: "5"` works fine, by the same coercion: `"5" * 10 = 50`, and `slice(0, "5")` truncates to 5. The failing population is *non-numeric* strings, `{}`, and `[a, b]` — not "quoted numbers" |
| *"`loadConfig` returns a plain `CompendioConfig` with nowhere to put a warning, so this needs a return-shape change"* (fork C's stated cost) | Accurate about today, but it omits that **this project has already shipped a config-load warning channel.** `warnIfLegacyEstadosExcluidos` wrote a one-line stderr notice from `loadConfig` for the retired `search.estadosExcluidos` key. It was deleted by `english-contract` (its decision 5, `tasks.md:97`) **because the key it guarded ceased to exist under the no-shims/English-rename policy — not because warning at load was rejected.** Fork C is a re-establishment, not a novelty. `config.test.ts`'s otherwise-unused `vi` import and `vi.restoreAllMocks()` in `afterEach` (`:4,20-22`) are the residue of its coverage |
| `configuration/spec.md:165-169`, *"Legacy key is silently dropped, not merged … no deprecation warning is emitted"* | **The proposal missed this, and it is a hard collision with fork C.** Slice 2 reports unrecognized keys; `search.excludedStatuses` is an unrecognized key under `search`. That scenario must be deltaed in slice 2 or the spec contradicts the code. Named here so `sdd-spec` does not discover it at verify time |
| `cli.ts:234` uses `config.search.k` as `compendio eval`'s recall@k default (the consumer the exploration missed) | **Confirmed verbatim**: `const k = options.k ?? container.config.search.k;`. `--k` goes through `parsePositiveInt` (`:229,278-284`), so only the omitted-flag path is exposed |
| `search.k` has no integrality guard on the config path | **Confirmed, and it has one on both other paths**: `z.number().int().min(1).max(20)` (`server.ts`) and `parsePositiveInt` (`cli.ts:278`). It also reaches `sqlite-vec`'s `k = ?` constraint as `limit * 4` (`sqlite-index-store.ts:359,362`), which is an integer-typed constraint. See Decision 3 |

### The actual reachability table, replacing the proposal's three-case sketch

Declared value for `chunk.maxTokens`, and what it does **today, before any fix**:

| Declared | Coerces to | Behavior today | Explodes? |
|---|---|---|---|
| `0` | `0` | `estimateTokens >= 1` always, cascade to `splitCodePoints` | **Yes** — one chunk per code point |
| `-5` | `-5` | same | **Yes** |
| `null` | `0` | same | **Yes** |
| `"abc"`, `{}`, `[1,2]` | `NaN` | every `<=` is `false` | **Yes** |
| `"480"`, `["480"]`, `true` | `480`, `480`, `1` | correct at 480 / correct at 480 / **yes**, bound of 1 | mixed |
| `"600"` | `600` | **correct chunking at 600 — the user's intent is honored today** | No |
| `1e400` | `Infinity` | nothing ever splits — the `bounded-chunk-size` bug, reinstated | No, the opposite |

**The `"600"` row is the argument that settles the fork.** After this change it falls back to 480, so
a config that works today stops being honored. Under fork A that happens in silence — the change would
*introduce* exactly the failure mode it exists to remove, in a new place. Under fork C the user is told.
This is not a stylistic preference; it is the difference between a fix and a swap.

## Technical Approach

One predicate pair in `src/infrastructure/config.ts`, applied at four call sites, plus a returned
warnings list that the two input adapters render. `src/domain/`, `src/application/`, and
`src/infrastructure/sqlite/` are untouched in both slices: `splitToBound` and `mergeTinyPieces` were
always correct for the value they were handed.

```
compendio.config.json
   │  JSON.parse  (already throws on malformed JSON — config.ts:89-93, UNCHANGED)
   ▼
mergeConfig ─── positiveNumber()  → chunk.minTokens, chunk.maxTokens, sync.throttleMs
   │       └─── positiveInteger() → search.k                                   Decision 3
   │       └─── explicit whitelists on embeddings / chunk / frontmatterFields  Decision 4
   ▼
loadConfigReport(root) → { config, warnings: ConfigWarning[] }                 SLICE 2
   │                                        ▲ loadConfig(root) stays, = .config
   ▼
createContainer → Container.configWarnings ─┬─→ cli.ts withContainer (6 actions) ─→ stderr
                                            ├─→ cli.ts serve action              ─→ stderr
                                            └─→ formatOverview "Config:" block   ─→ docs_overview
```

| Question the change owns | Answer | Where |
|---|---|---|
| Silent, loud, or degrade-and-say-so | **C**, on evidence rather than taste | Decision 1 |
| How C fits a 400-line budget | It does not — two chained PRs, cut where policy stays uniform | Decision 2 |
| One predicate or two | Two, and `search.k`'s is the tighter one, for a reason that already exists in the codebase | Decision 3 |
| What the whitelists buy | Nothing observable in slice 1; the reporting channel in slice 2 | Decision 4 |
| Where a warning lives without breaking 13 test call sites | A second exported entry point, not a changed signature | Decision 5 |
| Which surfaces render it | CLI stderr and `docs_overview` — never `search_docs` | Decision 6 |
| Does `sync.throttleMs` move | Yes, in slice 2, with its spec requirement and scenario | Decision 7 |
| `minTokens > maxTokens` | Confirmed: no behavior change; reported in slice 2 | Decision 8 |

## Architecture Decisions

### Decision 1: Fork C — fallback plus a reported warning

**Choice.** An invalid declared value falls back to the default (fork A's behavior, byte for byte) and
is additionally recorded in a warnings list that the CLI and `docs_overview` render.

| Option | Cost | Decision |
|---|---|---|
| **A** — silent fallback | Zero new surface; matches `validThrottleMs` exactly | **Rejected.** The reachability table above shows it silently *revokes* a working `maxTokens: "600"`. A change whose thesis is "the quiet failure is worse" cannot ship a new quiet failure as its implementation |
| **B** — throw at load | Earliest possible detection; `loadConfig` already throws on malformed JSON | **Rejected**, on a project-specific ground stronger than the generic one. The primary consumption path is `compendio serve` over stdio inside an MCP client. A server that throws at startup surfaces to the user as "MCP server failed" with the reason buried in a client log file — this repo has a recorded instance of exactly that confusion (`opencode-unsupportedcontenttype-no-es-compendio`). **The loudest mechanism is the least visible on the path that matters.** It also converts a working install into a hard stop over a value the previous version accepted |
| **C** — fallback + report | A return-shape change and a rendering surface | **Chosen** |

**Three supports, none of which is "house style" on its own.**

1. **Every warning channel in this codebase is a returned field consumed by an input adapter**, never a
   print from a use case or an adapter: `IndexReport.embeddingsWarning`, `SyncReport.encodingNotices`,
   `SearchResponse.filterWarning`, `SearchResponse.noMatchReason`, `IndexReport.skipped`. C is that
   pattern applied to the one loader that lacks it.
2. **The channel existed and was removed for an unrelated reason** (findings table). This is not a new
   mechanism being argued into a codebase that has never wanted one.
3. **A returned value is falsifiable end to end; a `console.warn` is not.** This repository's recorded
   worst failure is a green suite beside an invisible function (`compendio-tests-verdes-funcion-invisible`
   — 306 passing tests while the progress bar never drew). A spy-on-`console` test reproduces that shape
   precisely. Slice 2's gates assert `docs_overview`'s rendered text and the CLI subprocess's stderr,
   which cannot pass while the user sees nothing.

**Rejected — C implemented as a direct `console.warn` inside `loadConfig`** (the shape the deleted
`warnIfLegacyEstadosExcluidos` used, and by far the cheapest: ~15 lines, no threading, one slice). Two
reasons. It puts presentation inside an infrastructure loader, against support 1 above and against the
hexagonal boundary this repo enforces. And it is invisible to the agent, which is the majority
consumer: many users register `compendio serve` in an MCP client and never run the CLI at all, so a
stderr-only warning is the same silence relocated. Cheapness is real and is why the slice boundary
exists — not why the wrong shape should ship.

### Decision 2: two chained PRs, cut between validation and reporting

**Choice.** Slice 1 = predicate + four call sites + whitelist hygiene + `configuration` spec delta +
`CLAUDE.md`. Slice 2 = `ConfigWarning`, `loadConfigReport`, `Container.configWarnings`, CLI rendering,
`docs_overview` rendering, `mcp-contract` delta, `README.md`, and the `sync.throttleMs` /
`search.excludedStatuses` spec deltas.

**The budget, restated honestly rather than optimistically.** The proposal forecasts C at 390–690 lines
and records that this repository's forecasts have landed 2–4× low for several cycles
(`bounded-chunk-size` 240–420 → 773; `match-centred-excerpt` 300–470 → ~1 521). Slice 2 adds an
`mcp-contract` delta and a rendering surface the proposal's table did not price. **C does not fit 400
lines and this design does not pretend otherwise.**

| Slice | Drivers | Forecast |
|---|---|---|
| 1 | `config.ts` 20–35; `config.test.ts` 130–200; chunking integration test 40–80; `configuration` spec 60–110; `CLAUDE.md` 5–15 | **255–440** |
| 2 | `config.ts` 25–45; `composition.ts`/`cli.ts` 35–60; `get-overview.ts` 20–35; tests 120–200; `configuration` + `mcp-contract` specs 80–140; `README.md` 15–30 | **295–510** |

**Why this cut and no other.** The constraint the fork must respect is that `mergeConfig` never holds
two policies for one class of problem. This is the only boundary at which that holds *at every
intermediate state*: slice 1 leaves all four numeric keys validating and falling back **silently** —
uniform, and `sync.throttleMs`'s specified behavior is byte-identical, so it needs no delta. Slice 2
makes all four **report** — uniform again, and `throttleMs`'s requirement moves with them. A cut at
"values now, keys later", or "chunk now, search later", would each leave a half-applied policy live on
`main`.

Slice 1 is independently shippable and independently valuable: it closes the `configuration/spec.md:221`
violation, which is the change's strongest justification, and passes Gates 1–5 alone.

**Rejected — ship fork A now and open fork C as a separate change later.** Materially the same code,
worse commitment: the "later" change is the one that gets deprioritized, and slice 1 alone silently
revokes `maxTokens: "600"` for however long that lasts. A chained PR with the reporting slice already
designed is a promise with a diff attached.

### Decision 3: two predicates — `positiveNumber` for the three thresholds, `positiveInteger` for `search.k`

**Choice.** In `src/infrastructure/config.ts`, module-private, immediately replacing `validThrottleMs`:

```ts
/** A declared numeric config value is honored only when it is a finite number greater
 * than 0. Anything else — non-numeric (a quoted number, `null`, a boolean, an array, an
 * object), zero, negative, or `Infinity` (reachable as `1e400`; `NaN` is not, the JSON
 * grammar has no literal for it) — is treated the same as an absent key and falls back to
 * the default. NEVER clamps: any finite positive value, however small, is accepted
 * (configuration/spec.md's `throttleMs` MUST, generalized). */
function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** `search.k` additionally: a whole number. It is a result count, and both input adapters
 * already require an integer — `z.number().int().min(1).max(20)` (server.ts) and
 * parsePositiveInt (cli.ts:278). The config path is the only one that does not, which is
 * this change's whole premise. No ceiling: 20 is the MCP adapter's per-call cap, not a
 * config bound, and adding one here would be the clamping spec.md:201 forbids. */
function positiveInteger(value: unknown): number | undefined {
  const n = positiveNumber(value);
  return n !== undefined && Number.isInteger(n) ? n : undefined;
}
```

Call sites in `mergeConfig`:

```ts
chunk: {
  minTokens: positiveNumber(override.chunk?.minTokens) ?? base.chunk.minTokens,
  maxTokens: positiveNumber(override.chunk?.maxTokens) ?? base.chunk.maxTokens,
},
search: { k: positiveInteger(override.search?.k) ?? base.search.k },
sync:   { throttleMs: positiveNumber(override.sync?.throttleMs) ?? base.sync.throttleMs },
```

**This overturns a Resolved decision, deliberately and with evidence.** The proposal settled on "the
same one `validThrottleMs` uses. One shared helper, not three variants." `positiveInteger` is not a
third variant invented for symmetry: it is the config path being brought into line with the two
adapters that already enforce integrality on the same field, which is the change's own argument. And
the failure is reachable rather than theoretical — `search.k: 5.01` yields `limit = 50.1` and
`limit * 4 = 200.4`, bound into `sqlite-vec`'s integer-typed `k = ?` constraint
(`sqlite-index-store.ts:359,362`). It costs one production line and one test case. **Cheap reversal for
`sdd-spec` if the user prefers strict adherence to the resolved decision: delete `positiveInteger`, use
`positiveNumber` for `search.k`, drop one spec sentence and one test case. Nothing else moves.**

**Why they live in `config.ts` and not in `src/domain/`.** Config loading is infrastructure; the domain
layer has no knowledge of the config shape, and `openspec/config.yaml`'s `rules.design` keeps
domain free of anything that is not pure model. Four lines used by one function is not a module.

**Rejected — clamping to a floor** (`Math.max(1, value)`), the plausible-looking wrong implementation
the proposal's risk table names. `configuration/spec.md:201` requires that "any finite positive value,
however small, MUST be accepted". Gate 3 asserts `maxTokens: 1` and `throttleMs: 100` survive.

**Rejected — a schema library.** Zero new dependencies (proposal, Dependencies). Importing `zod` into
the loader to express `> 0` is a dependency for a comment's worth of code, and
`configuration/spec.md:7` states that config loading stays untyped by deliberate design.

### Decision 4: `embeddings`, `chunk` and `convention.frontmatterFields` become explicit whitelists

**Choice.** The three spread branches become key-by-key builds, matching `search`:

```ts
embeddings: {
  provider: override.embeddings?.provider ?? base.embeddings.provider,
  model:    override.embeddings?.model    ?? base.embeddings.model,
},
// chunk: see Decision 3
frontmatterFields: {
  type:   override?.frontmatterFields?.type   ?? base.frontmatterFields.type,
  module: override?.frontmatterFields?.module ?? base.frontmatterFields.module,
  status: override?.frontmatterFields?.status ?? base.frontmatterFields.status,
},
```

The rationale comment at `config.ts:104-106` moves up to the function and is generalized, because it
finally becomes true of every branch rather than one of four.

**`frontmatterFields`' per-key merge survives by construction** — each key falls back independently, so
`{ "type": "tipo" }` still leaves `module`/`status` at identity. `configuration/spec.md:173` and its
scenario at `:181` must pass unmodified; that is Gate 4's second bullet, and it is the one thing this
conversion could plausibly break.

**Honest labelling, per the proposal's binding.** In slice 1 whitelisting changes nothing a user can
observe — no consumer of `CompendioConfig` enumerates keys, so an unknown key is inert before and
absent after. It earns its place because it is four lines in a function this change already rewrites,
and because it is the *enumeration* slice 2's unknown-key reporting needs. The mistyped key
(`maxtokens`) is fixed by slice 2, not by slice 1.

### Decision 5: `loadConfigReport` is added; `loadConfig`'s signature does not change

**Choice** (slice 2). One new exported function and one new exported type; `loadConfig` becomes a
one-line wrapper:

```ts
export type ConfigWarningKind = "invalid-value" | "unknown-key" | "inverted-chunk-bounds";

/** One thing `loadConfig` had to ignore or override in the declared config.
 * Structured rather than pre-rendered, mirroring `EncodingNotice`/`formatEncodingNotice`
 * (`ports.ts`, `index-documents.ts`) — the adapters own the wording. */
export interface ConfigWarning {
  kind: ConfigWarningKind;
  /** Dotted key path exactly as written in the file: `chunk.maxTokens`, `chunk.maxtokens`. */
  key: string;
  /** `JSON.stringify` of the declared value. Absent for `unknown-key`. */
  declared?: string;
  /** The value actually in force. Absent when nothing fell back. */
  inEffect?: number;
}

export interface ConfigLoadReport {
  config: CompendioConfig;
  /** Empty on a clean load; never absent. */
  warnings: ConfigWarning[];
}

export function loadConfigReport(root: string): ConfigLoadReport;
export function loadConfig(root: string): CompendioConfig;   // = loadConfigReport(root).config
export function formatConfigWarning(warning: ConfigWarning): string;
```

**Why an added entry point rather than a changed return type.** `loadConfig` has 4 non-test call sites
(`composition.ts:59`, `scripts/rank-probe.mjs:68`, `scripts/vector-reach.mjs:210`) and **13 call sites
inside `test/infrastructure/config.test.ts` alone**. Gate 5's third bullet requires that *no existing
test in that file is modified, only added to* — a breaking signature change violates the gate as
literally written, and would do it for churn rather than for meaning. The two `scripts/*.mjs` probes
genuinely do not want warnings on stdout. `createContainer` is the one caller that does, and it is the
one caller that switches.

**Why structured rather than a `string[]`.** Two consumers render it (CLI stderr, `docs_overview`) and
slice 2's gates assert on it. `EncodingNotice` is the established precedent for exactly this: a data
shape plus a `formatEncodingNotice` the adapters call. A pre-rendered string would put CLI wording
inside the loader and make the `docs_overview` assertion a substring match on prose.

**Why `warnings` is non-optional.** It is computed entirely inside `loadConfig` with no upstream
`undefined` to mirror — unlike `encodingNotices`, which is optional only because `DiscoverResult` is
(`ports.ts:37-40`). Non-optional removes an `?? []` from every consumer.

### Decision 6: CLI stderr and `docs_overview`; never `search_docs`

**Choice** (slice 2). `Container` gains `configWarnings: ConfigWarning[]`. Three render sites:

| Surface | Where | Shape |
|---|---|---|
| CLI, 6 actions | `cli.ts`'s `withContainer` (`:257-276`), immediately after `createContainer` and before `action(container)` | `console.warn(\`WARNING ${formatConfigWarning(w)}\`)` per warning — the exact prefix `index`/`sync` already use for `skipped`, encoding notices, and `embeddingsWarning` |
| CLI, `serve` | `cli.ts:245-253`, beside the existing startup `console.error` | same, on stderr — stdout belongs to the MCP protocol |
| MCP | `formatOverview(overview, sync, configWarnings)` (`get-overview.ts:84-112`) | a `Config:` block, same construction as the existing `Sync:` block, **omitted entirely when the list is empty** |

**A separate `Config:` block, not folded into `Sync:`.** `toSyncInfo`'s omission rule is content-based
and describes *the most recent sync pass* (`get-overview.ts:61-82`); a config warning is a property of
the running process, constant for its lifetime. Folding them would make a clean pass render config
warnings under a heading that lies about where they came from. The empty-block omission matches
`byType`/`byModule`'s existing "omitted when the bucket has nothing" rule (`formatCounts`, `:114-119`).

**`docs_overview` repeats the warning on every call, and that is correct.** Sync warnings describe an
event; a config warning describes a state that is still true. Suppressing it after the first call would
hide it from every agent session but the first.

**Rejected — surfacing on `search_docs`.** It already carries two per-query channels (`filterWarning`,
`noMatchReason`) and is the hot path an agent calls repeatedly; a process-constant warning appended to
every response is noise, and would compete with the two signals that *are* about the query.
`docs_overview` is this project's corpus-and-state tool and is already the only MCP path carrying
warnings — the proposal's own observation.

**Rejected — a dedicated fourth MCP tool.** "The MCP surface stays exactly these 3 tools" (`CLAUDE.md`).

### Decision 7: `sync.throttleMs` moves with the policy, in slice 2 — and two spec scenarios move with it

**Choice.** Slice 1: `throttleMs` switches from `validThrottleMs` to `positiveNumber` — the identical
predicate under a generalized name, so behavior is byte-identical and `configuration/spec.md:199-219`
needs **no delta**. Slice 2: an invalid `throttleMs` produces a `ConfigWarning` like the other three,
and `spec.md:201`'s requirement plus its `:215` scenario are deltaed to say "and MUST be reported".

**The second scenario the proposal did not find.** `configuration/spec.md:165-169` ("Legacy key is
silently dropped, not merged") asserts that a declared `search.excludedStatuses` produces **"no
deprecation warning"**. Slice 2 emits an `unknown-key` warning for it. Slice 2's delta must reword that
scenario — the legacy key is still not honored and there is still no compatibility shim, but it is no
longer silent. Leaving it would put a shipped scenario in direct contradiction with shipped code.

Consequence to state plainly: after slice 2, `mergeConfig` has **one** policy for one class of problem,
across four numeric keys and four object branches. That is the premise the change is measured against.

### Decision 8: `minTokens > maxTokens` — no behavior change, confirmed

**Choice.** No rejection, no clamp, no swap. Both values pass `positiveNumber` and both are honored.
Slice 2 emits one `inverted-chunk-bounds` warning naming both values.

**Confirmed against the code rather than inherited.** `mergeTinyPieces` gates every merge on
`estimateTokens(candidate) <= opts.maxTokens` (`chunking.ts:122`) and only attempts a merge when
`tokens < opts.minTokens` (`:120`). An inverted pair therefore makes every piece a merge candidate and
every merge rejected: merging is disabled, chunks stay small, **and the `maxTokens` bound is never
threatened** — which is the requirement this whole change exists to protect. Wasteful, not dangerous.

And no correction is non-arbitrary: swapping, dropping `minTokens`, or resetting both each invent an
intent the config does not express. A warning states the fact and lets the author decide — which is
only available because Decision 1 built a channel. Under fork A this row would have had to be silent.

## File Changes

| File | Slice | Action | Description |
|---|---|---|---|
| `src/infrastructure/config.ts` | 1 | Modify | `validThrottleMs` → `positiveNumber` + `positiveInteger`; four call sites; `embeddings`/`chunk`/`frontmatterFields` whitelisted; rationale comment generalized and hoisted |
| `src/infrastructure/config.ts` | 2 | Modify | `ConfigWarning`, `ConfigLoadReport`, `loadConfigReport`, `formatConfigWarning`; `loadConfig` becomes a wrapper — **signature unchanged** |
| `src/composition.ts` | 2 | Modify | `loadConfigReport` at `:59`; `Container.configWarnings`. `resolveRoots` still runs before `new SqliteIndexStore` (`:60-68`) — the no-`.compendio/`-on-invalid-roots guarantee is untouched |
| `src/cli.ts` | 2 | Modify | Render in `withContainer` (`:257-276`) and in the `serve` action (`:245`) |
| `src/application/get-overview.ts` | 2 | Modify | `formatOverview` gains a third parameter and a `Config:` block |
| `src/server.ts` | 2 | Modify | Pass `container.configWarnings` into `formatOverview` for `docs_overview` |
| `src/domain/**`, `src/application/**` (except `get-overview.ts`), `src/infrastructure/sqlite/**`, `src/infrastructure/fs/**` | — | **Unchanged — asserted** | No port change, no schema change, no chunker change, no `migrate()`/`reset()` edit. `splitToBound` and `mergeTinyPieces` were always correct for the value they were handed |
| `scripts/rank-probe.mjs`, `scripts/vector-reach.mjs` | — | **Unchanged — asserted** | They call `loadConfig`, whose signature does not move (Decision 5) |
| `test/infrastructure/config.test.ts` | 1, 2 | Extend, **additions only** | See Testing Strategy. Gate 5 forbids modifying an existing case |
| `test/application/index-and-search.test.ts` *(or a new `chunk-bound-config.test.ts` — `sdd-tasks`' call)* | 1 | Extend | Gate 1 |
| `test/application/get-overview.test.ts`, `test/cli-subprocess.test.ts` | 2 | Extend | Gate 6 |
| `openspec/specs/configuration/spec.md` | 1 | Modify | New numeric-validation requirement; scenario on the `chunk.maxTokens` bound requirement (`:221`) |
| `openspec/specs/configuration/spec.md` | 2 | Modify | Reporting added to the new requirement; deltas to `:199-219` (`throttleMs`) and `:165-169` (legacy key) |
| `openspec/specs/mcp-contract/spec.md` | 2 | Modify | `docs_overview`'s `Config:` block |
| `CLAUDE.md` | 1 | Modify | One line in *Non-obvious decisions* — and the coercion finding, which is exactly the kind of thing that file exists to stop being rediscovered |
| `README.md` | 2 | Modify | One sentence in the config table: an invalid value falls back and is reported |

## Testing Strategy

`strict_tdd: true`. Every gate is written first and **observed failing against the current tree**.

| Layer | What | Approach |
|---|---|---|
| Unit | `mergeConfig` per key × per invalid shape | `test/infrastructure/config.test.ts`, existing temp-dir + `writeFile` helper. Additions only |
| Unit | `formatConfigWarning`, `formatOverview`'s `Config:` block | pure functions, hand-built inputs |
| Integration | chunk count identity under an invalid `chunk.maxTokens` | `test/fixtures/strict/` (5 docs) + `FakeEmbeddings`, lexical — no model download |
| Integration | `docs_overview` renders the block | `GetOverview` + `formatOverview` over `:memory:` |
| E2E | spawned `dist/cli.js` emits the `WARNING` line on stderr | `test/cli-subprocess.test.ts`, `--lexical` |

### The fixture set, corrected

**The proposal's Gate 1 fixture `{"maxTokens": "480"}` cannot fail before the fix** — it coerces to 480
and produces the default chunk count. Written as specified, that gate reports a false STOP. Replace it:

| Fixture | Before the fix | After the fix |
|---|---|---|
| no `chunk` block (control) | default count | identical |
| `{"maxTokens": 0}` | **explosion** — recorded as a number in the verify report | identical to control |
| `{"maxTokens": "abc"}` | **explosion** (`NaN`, every `<=` false) | identical to control |
| `{"maxTokens": null}` | **explosion** (coerces to `0`) | identical to control |
| `{"maxTokens": "600"}` | **honored at 600** — count differs from control, no explosion | identical to control, **and slice 2 warns** |
| `{"maxTokens": 1e400}` | `Infinity` — one chunk, nothing splits | identical to control |
| `{"maxTokens": 600}` (Gate 3) | 600 | **still 600** |
| `{"maxTokens": 1}` (Gate 3) | — | accepted, **not clamped** |
| `{"maxTokens": NaN}` | **not writable** — invalid JSON, `loadConfig` already throws | n/a |

The `"600"` row is the one that carries the design's argument, and it is the only row whose "before"
state is *correct behavior*. `sdd-tasks` must not drop it as redundant.

**One measurement to take at apply time rather than assume:** `JSON.parse('{"a":1e400}')` yielding
`{a: Infinity}` is derived from the JSON number grammar plus IEEE-754 overflow, not observed. Confirm
with `node -e "console.log(JSON.parse('{\"a\":1e400}').a)"` before writing that fixture. `Number.isFinite`
is the exact guard either way, so nothing in the design depends on the answer — only one test case does.

### Gate mapping

| Gate | Decision tested | Falsifier |
|---|---|---|
| 1 — spec violation reproduced, then closed | 3 | The fixture table above. **STOP** if `{"maxTokens": 0}` does not explode before the fix |
| 2 — `search.k`'s config default | 3 | `k: 0` → empty with no `noMatchReason` before, non-empty after; `k: "abc"` → store error before, succeeds after; `k: 5.01` → the integrality case; explicit per-call `k` unchanged at both adapters |
| 3 — valid values untouched, nothing clamped | 3 | `maxTokens: 600` → 600 (`config.test.ts:50` unmodified); `k: 3` → 3; `maxTokens: 1` accepted; `throttleMs` cases at `:175-199` unmodified in slice 1 |
| 4 — the rationale comment is true of every branch | 4 | Unknown key under `chunk`, `embeddings`, `frontmatterFields` absent from the loaded config; partial `frontmatterFields` still merges per key (`spec.md:181` passes unmodified) |
| 5 — nothing else moved | — | `npm test`, `npm run typecheck`, `npm run build`; `compendio eval` on `ejemplos/` unchanged (MRR ≥ 0.943, recall@5 = 1.00, top-1 ≥ 20/22 — `ejemplos/` ships no config file, so any movement means the default path changed); `config.test.ts` diff is additions-only |
| **6 — the warning is visible where a user actually is** *(new, slice 2)* | 1, 5, 6, 7, 8 | (a) `loadConfigReport` returns one warning per invalid value, one per unknown key, one for an inverted pair; (b) `warnings` is `[]` on a clean config **and** on no config file at all; (c) `formatOverview` renders no `Config:` block when the list is empty; (d) a spawned `dist/cli.js index --lexical` against an invalid config prints the `WARNING` line on **stderr** and still exits 0; (e) `search_docs`' response shape is byte-identical |

Gate 6 (b) and (c) are the guards against the realistic slice-2 regression: a block that renders on
every clean project forever. Gate 6 (d) asserts *stdout is unaffected and the exit code is 0* — this
project's recorded broken-entry-point shape is exit 0 with empty stdout, so asserting content is not
optional (`compendio-cli-subprocess-test`).

## Migration / Rollout

No migration. No schema change, no DDL, no config key added, no path or ID shape change, so
`ejemplos/goldenset.yaml` and `compendio eval` are untouched. Slice 2's change is in-process only.
Rollback is `git revert` + `npm run build` for either slice independently.

**The one asymmetry, carried forward from the proposal and confirmed.** A project already running an
invalid `chunk.maxTokens` has a corpus chunked at the degenerate boundaries. This fix does **not**
re-chunk it: the incremental fingerprint is the content hash alone, so an unchanged document keeps its
old boundaries through any `serve` or `compendio sync` pass. Only `compendio index`'s drop-and-recreate
applies the corrected bound (`openspec/specs/indexing/spec.md`, "Chunk Boundary Changes Require a Full
Reindex to Reach Existing Documents"). Pre-existing property, not new debt — but "the fix is installed"
and "the fix has reached your corpus" are different statements, and slice 2's warning is the only thing
that will ever tell the user which one they are in.

## Open Questions

1. **`positiveInteger` for `search.k` overturns a Resolved decision** (Decision 3). Evidence-based and
   one line, with a stated cheap reversal. `sdd-spec` should either write it into the requirement or
   drop it deliberately — not inherit it silently.
2. **RESOLVED — slice 2 ships this cycle.** Put to the user on 2026-08-14; the answer is **both
   slices, chained, in this cycle**. The reason it was asked stands as the reason for the answer:
   slice 1 alone silently revokes a working `maxTokens: "600"` (Decision 1's table), which is the
   exact silence this change exists to remove, so no published state may contain slice 1 without
   slice 2. `sdd-tasks` plans both; the chain order is fixed (slice 1 then slice 2) and slice 2 is
   not deferrable without reopening this decision.
3. **Exact wording of `formatConfigWarning`.** A CLI/render detail, not a spec obligation; the spec
   should pin *that* an invalid value and an unrecognized key are reported, and that a clean config
   reports nothing — never the string.
4. **Whether `configuration/spec.md:165-169`'s legacy-key scenario is reworded or replaced** in slice 2
   (findings table). `sdd-spec` owns it; the design's requirement is only that it stop contradicting
   the code.
5. **Nothing in this design depends on the proposal's question round.** Q1 is answered by Decision 1 on
   evidence rather than by the assumption in force. Q2 (hand-authored vs generated configs) no longer
   changes the answer — the coercion finding makes reporting necessary for hand-authored configs too.
   Q3 is answered yes, in slice 2. Q4 is answered by Decision 8.
