# Proposal: Config Value Validation — apply `validThrottleMs`'s policy to the numeric keys that lack it

Extend the validation `sync.throttleMs` already receives in `mergeConfig` (`src/infrastructure/config.ts:108,116-118`) to the three numeric config values that receive none: `search.k`, `chunk.minTokens` and `chunk.maxTokens`. The policy is already written down in this repository — in `validThrottleMs`'s own doc comment, in the `CompendioConfig.sync` field comment, and as a `MUST` in `openspec/specs/configuration/spec.md:201`. What is missing is its application to the siblings.

**This is one of two changes split from the same review pass.** The sibling is `2026-08-14-sync-vector-contract` (finding 1.2). They share a review document and nothing else — no file, no test, no spec capability. They are not to be bundled; see `exploration.md`'s comparison table.

## Intent

### The strongest argument is not robustness. It is a `MUST` that is already violable.

`openspec/specs/configuration/spec.md:221` states, under *Default `chunk.maxTokens` Is 480 and Is a Guaranteed Upper Bound*:

> This value MUST be honored as a guaranteed upper bound on every emitted chunk (see Indexing spec's chunk-size-bound requirements) — **not merely a hint** that heading-based descent may exceed.

That requirement was written by `bounded-chunk-size`, and the mechanism that carries it — `splitToBound` (`src/domain/split-text.ts`) — honors whatever number it is handed. It is handed `config.chunk.maxTokens` unvalidated. So the bound is guaranteed against *the chunker*, which is where the risk was believed to live, and not guaranteed against *the config*, which is the other input to the same guarantee.

The failure is not a violated bound in the ordinary sense. With `maxTokens: 0` (or `NaN`, or the string `"480"`), `estimateTokens` — `Math.ceil(len / 4)`, `>= 1` for any non-empty string — can never satisfy the `<= maxTokens` guard, so `splitToBound` cascades all the way to `splitCodePoints` and emits **one chunk per Unicode code point**. A requirement about an upper bound is broken by a value that makes every bound unsatisfiable.

This is what separates this change from ordinary input hardening: it is not new safety, it is closing a hole in a commitment the project already published.

### The failure that is quiet is worse than the failure that is loud

Three consequences, each verified by code path in `exploration.md`:

- **`search.k: 0`** — `SearchDocuments` slices to `k`, so every search returns `[]`. `explainEmptyResult` (`src/domain/search-diagnostics.ts`) produces **no** `noMatchReason`, because `hasAnyFilter` is false and an unfiltered miss is deliberately left unexplained. So the project's own anti-silence machinery — `noMatchReason`, `dropImpossibleFilters`, `filterWarning`, built precisely because an agent cannot debug an empty result it was given no reason for — is bypassed through the config door. The same value also silently redefines what `compendio eval` measures: `cli.ts:234` uses `config.search.k` as the recall@k default when `--k` is omitted.
- **`search.k: "abc"`** — `k * CANDIDATE_FACTOR` → `NaN` → `Math.max(50, NaN)` → `NaN`, bound as a `LIMIT` parameter into better-sqlite3, which rejects it. The error fires **at query time, on every search**, not at config load, and names nothing that would point a user at their config file. (The exact error string is not empirically captured; nothing in this change depends on its wording.)
- **`chunk.maxTokens: 0 | NaN | "480"`** — the per-code-point explosion above. Indexing does not fail; it completes, reports a chunk count nobody reads as an alarm, and produces a corpus in which retrieval is meaningless.

None of the three is reported as a config problem. All three are reachable from a single mistyped character.

### Quoted numbers are not a footnote

`{"chunk": {"maxTokens": "480"}}` produces exactly the same degeneracy as a literal `0`, and is **more** likely to occur: JSON has no numeric coercion, a config written by hand next to string-valued keys (`db`, `docsDir`, `embeddings.model`) invites the quote, and a templated or generated config invites it more. The review named the zero case; the zero case is the rarer one. Every gate in this proposal covers the string form as a first-class input, not as a variant appended to the numeric one.

### Why now

`sync.throttleMs` established the policy and the vocabulary two cycles ago, and its spec requirement is already written in the exact three-way form (non-numeric / negative / zero → default) the siblings need. The `mergeConfig` comment claiming an explicit whitelist "ensures none of them leak into the returned config" is true of one branch out of four. Every additional cycle that adds a config key to this file compounds the divergence between the stated principle and the code; the cost of alignment only grows.

## Scope

### In Scope

- **Value validation for `search.k`, `chunk.minTokens` and `chunk.maxTokens`** in `mergeConfig`, applying the same predicate `validThrottleMs` applies (finite number, greater than zero). A declared value failing it is treated as an absent key.
- **Non-numeric declared values are the same case as invalid numeric ones** — a quoted number, `null`, an array, an object, `NaN`, `Infinity`. One predicate, one outcome, no special cases.
- **Key hygiene: the `embeddings`, `chunk` and `convention.frontmatterFields` branches become explicit whitelists**, like `search` already is, so the file's own rationale comment becomes true of every branch rather than one. See "The unknown-key leak" below for why this is in scope and what it does *not* buy.
- **Spec delta on `configuration`** — one new requirement generalizing the numeric-validation policy, plus a scenario on the existing `chunk.maxTokens` bound requirement pinning that an invalid declared value falls back to 480 with the bound intact.
- **Whether an invalid or unrecognized declared value is *reported*** — left open as the design fork below, because it is the only real decision in this change.

### Out of Scope

| Item | Why |
|---|---|
| **`2026-08-14-sync-vector-contract` (finding 1.2)** | Separate change. Different spec capability (`indexing`), different files, different mechanism, and a materially harder risk profile — the review's own suggested fix there is wrong. Bundling would either slow this one or under-scope that one |
| **A `minTokens > maxTokens` coherence check that changes behavior** | An inverted pair is wasteful, not dangerous — `mergeTinyPieces` (`src/domain/chunking.ts`) gates every merge on `estimateTokens(candidate) <= opts.maxTokens`, so an inverted pair can never produce an oversized chunk; it disables merging and leaves a corpus of tiny chunks. And no correction policy is non-arbitrary: nothing in the config says which of the two numbers the user mistyped. See the decision below |
| **Type-validating non-numeric config keys** (`docsDir` entries beyond `resolveRoots`' existing checks, `exclude`, `db`, `embeddings.provider`, `convention.mode`, `convention.types`/`statuses`) | Different class. `configuration/spec.md:7` states explicitly that "config loading stays untyped by deliberate design"; this change applies an existing, already-specified numeric policy, it does not introduce schema validation. A general validator is a larger and separately-justified change |
| **A schema library (zod, ajv) for `compendio.config.json`** | Zero new dependencies. The whole change is one predicate and four call sites; importing a validator to express `> 0` would be a dependency added for a comment's worth of code |
| **Clamping to a floor or ceiling** | The `sync.throttleMs` precedent explicitly rejects it — `configuration/spec.md:201` requires that "any finite positive value, however small, MUST be accepted". A validator that clamps is a different (and worse) contract than one that falls back. Gate 3 exists to catch this being introduced by accident |
| **Migrations, schema markers, compatibility shims** | Beta, no installed users (`openspec/config.yaml`, `rules.proposal`) |

## Two scope decisions the exploration deliberately left to this phase

### The unknown-key leak: **in scope, as hygiene — and honest about what it does not fix**

`{"chunk": {"maxtokens": 480}}` (lowercase typo) survives into the loaded config object while `maxTokens` silently keeps its default. The exploration flags this as separable — different mechanism (key filtering), different failure mode (declared intent discarded, rather than an invalid value honored). That reading is correct, and the recommendation is still to include it, for two reasons that are worth stating precisely because they are narrower than they look:

1. **The cost is four lines in a function this change already rewrites**, with the test template already in place (`test/infrastructure/config.test.ts:115` proves the `search` branch). Deferring means a second change editing the same four lines with the same tests.
2. **It removes a live contradiction.** The comment at `config.ts:104-106` asserts a rationale that holds in one of four branches. A reader who trusts it is wrong three times out of four.

**What it does not buy, stated so nobody claims otherwise at verify time:** whitelisting alone changes nothing a user can observe. No consumer of `CompendioConfig` enumerates its keys — every field is read by name in `composition.ts` — so today an undeclared key is inert, and after whitelisting it is absent. Either way the user's `maxtokens` is silently ignored. **The mistyped-key problem is only actually solved by reporting, not by filtering.**

That binds the two halves of this change: **if the design fork below selects a mechanism that makes an invalid value visible, an unrecognized key MUST ride the same mechanism.** Building a reporting channel and then not using it for the most common typo class would be arbitrary. If the fork selects silent fallback, whitelisting remains pure hygiene and is honestly labelled as such.

### `minTokens > maxTokens`: **no behavior change; reportable if a channel exists**

Two independently valid positive numbers in the wrong order pass every predicate this change adds, and should. The damage is bounded and self-evident (merging is disabled; chunks stay small), the bound requirement is not threatened, and any automatic correction — swap them, drop `minTokens`, reset both to defaults — invents an intent the config does not express. **Decision: no rejection, no clamp, no swap.** If the fork produces a warning channel, an inverted pair is a natural thing to say through it at zero behavioral cost. That is a design-phase call, not a scope expansion.

## The design fork — left open for `sdd-design`

This proposal deliberately does **not** pick. All three options fix the spec violation; they differ on what the user learns, and that is a product question, not a mechanical one.

**A. Silent fallback to the default** — exactly `validThrottleMs`. Zero new surface, one predicate reused, perfectly consistent with the one precedent in the file, and the spec requirement for it is already written. Cost: a user who typed `"maxTokens": "480"` gets 480 anyway (by coincidence of the default) or gets 480 instead of the 600 they meant, and never learns their config was ignored. The corpus is correct; the user's intent is discarded in silence — which is the same silence this change objects to elsewhere.

**B. Loud failure at config load** — catches the typo at the earliest possible moment, and there is precedent for a *malformed* config: `loadConfig` already throws on invalid JSON (`config.ts:89-93`). Cost: it converts a previously-working start into a hard stop, and it makes the file hold two policies for one class of problem unless `sync.throttleMs` is changed to match — which widens this change into one that alters already-specified, already-tested behavior.

**C. Fallback plus a reported warning** — A's resilience with B's visibility, and arguably the house style: this project already reports rather than fails for `embeddingsWarning`, `filterWarning`, `noMatchReason`, `skipped` and encoding notices. Degrade, but say so. Cost is real and structural: `loadConfig` returns a plain `CompendioConfig` with nowhere to put a warning, so this needs a return-shape change threaded through `composition.ts` to a reporting surface (CLI, and plausibly `docs_overview`, which is the only MCP path already carrying warnings). That is the difference between a one-file change and a threaded one — see Delivery size.

**The constraint the fork must respect, whichever way it goes:** B or C without also revisiting `validThrottleMs` leaves `mergeConfig` with two policies for the same class of problem, which is the exact inconsistency this change exists to end. `configuration/spec.md:199-219` pins `sync.throttleMs`'s silent fallback in a requirement and a scenario, so B or C implies a delta there too. Option A implies none. **The spec surface is a function of the fork's answer**, and `sdd-spec` cannot be run to completion before it is settled.

## Capabilities

### New Capabilities

- None. This is a policy already specified for one key, extended to three.

### Modified Capabilities

- **`configuration`** — one new requirement: a declared numeric value for `search.k`, `chunk.minTokens` or `chunk.maxTokens` that is not a finite number greater than zero MUST be treated as an absent key and fall back to the default; any finite positive value MUST be accepted without clamping. One new scenario on *Default `chunk.maxTokens` Is 480 and Is a Guaranteed Upper Bound* (`spec.md:221`) tying the bound guarantee to the validated value. One new scenario, or requirement text, for the unknown-key hygiene, mirroring `spec.md:165`'s existing legacy-key scenario for `search`.
- **`configuration`, conditional on the fork** — the *`sync` Configuration Section With a Per-Project Throttle Default* requirement (`spec.md:199`) and its invalid-value scenario (`spec.md:215`) require a delta **if and only if** design selects B or C.
- **`indexing`** — **no delta, asserted.** Its chunk-size-bound requirements are already unconditional; this change makes them reachable, it does not restate them. An `indexing` delta appearing in `sdd-spec`'s output means the scope moved.
- **`mcp-contract`** — **no delta under A or B.** Under C, only if the warning is chosen to surface in `docs_overview`.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/infrastructure/config.ts:97-118` | Modified | Shared positive-finite-number predicate applied to `search.k`, `chunk.minTokens`, `chunk.maxTokens`; `embeddings`/`chunk`/`frontmatterFields` branches converted to explicit whitelists; the rationale comment at `:104-106` generalized now that it is true |
| `src/composition.ts`, `src/cli.ts` | Modified **only under fork C** | Return-shape threading for a load-time warning. Untouched under A and B |
| `src/domain/`, `src/application/`, `src/infrastructure/sqlite/` | **Unchanged — asserted** | No port change, no schema change, no chunker change. `splitToBound` and `mergeTinyPieces` are untouched: they were always correct for the value they were handed |
| `test/infrastructure/config.test.ts` | Extended | Value-validation cases per key (numeric-invalid **and** string/quoted forms), the no-clamping case, unknown-key cases for the three converted branches. Every existing case must pass unmodified |
| Chunking integration test (existing file, TBD by `sdd-tasks`) | Extended | Gate 1: an invalid `chunk.maxTokens` produces an index identical to the default-config one, not a per-code-point explosion |
| `openspec/specs/configuration/spec.md` | Modified | New requirement + scenarios; the `sync.throttleMs` requirement only if the fork forces it |
| `CLAUDE.md` | Modified | One line in *Non-obvious decisions*: declared numeric config values are validated with a single policy, and what falls back |
| `README.md` | Modified **only under B or C** | The config table documents defaults; it needs a sentence only if an invalid value now produces user-visible output |

## Success Criteria

Each gate can **fail and stop the change**. This project gates on *falsification* — a measurement contradicting the reasoning — not on a tolerance band. `strict_tdd: true` applies: every gate below is written first and observed failing against the current code before any fix lands. A gate that passes on the unfixed tree is not measuring what it claims.

### Gate 1 — The spec violation is reproduced, then closed (BLOCKING)

Against a fixture corpus (`test/fixtures/strict/` or `ejemplos/`, whichever `sdd-tasks` selects), indexed three times: with no `chunk` block, with `{"chunk": {"maxTokens": 0}}`, and with `{"chunk": {"maxTokens": "480"}}`.

- [ ] **Before the fix**: both invalid configs produce a chunk count orders of magnitude above the default run's — the per-code-point explosion, recorded as a number in the verify report, not described.
- [ ] **After the fix**: all three runs produce an **identical** chunk count, and no emitted chunk exceeds 480 estimated tokens.

Identity is the correct assertion, not a tolerance band: once an invalid value falls back to the default, the three runs are the same run. Any residual difference falsifies the fix.

**STOP condition.** A "before" measurement that does *not* explode means the analysis in `exploration.md` is wrong and the change's justification collapses. That outcome stops the change rather than being smoothed over.

### Gate 2 — `search.k`'s config default is validated on the path that has no other guard (BLOCKING)

- [ ] With `{"search": {"k": 0}}`, an MCP `search_docs({ query })` call that omits `k` returns a non-empty result set for a query that matches — **before the fix it returns `[]` with no `noMatchReason`**, and that empty-with-no-explanation state must be observed first.
- [ ] With `{"search": {"k": "abc"}}`, the same call succeeds instead of throwing a store-layer error at query time.
- [ ] An explicit per-call `k` still wins over the config value, unchanged — the existing adapter validation (`server.ts:141`'s `z.number().int().min(1).max(20)`, `cli.ts:278`'s `parsePositiveInt`) is neither duplicated nor weakened.

**Reachability note, so the gate is not over-claimed.** Both input adapters already reject a bad per-call `k`. The only unvalidated path is the config default used when a caller omits `k` — narrower than "any `k`", and still the common case for an agent calling `search_docs({ query })`, plus `compendio eval`'s recall@k default (`cli.ts:234`). `chunk.minTokens`/`maxTokens` have no per-call override at any adapter and are fully exposed; that asymmetry is why Gate 1 is the primary gate and this one is secondary.

### Gate 3 — Valid values are untouched, and nothing is clamped (BLOCKING)

The gate against an over-eager validator, which is the realistic way this change causes a regression.

- [ ] `{"chunk": {"maxTokens": 600}}` resolves to `600`, and the existing test at `config.test.ts:50` passes unmodified.
- [ ] `{"search": {"k": 3}}` resolves to `3`.
- [ ] A very small positive value (e.g. `chunk.maxTokens: 1`) is **accepted, not clamped to a floor** — mirroring the existing `throttleMs` case at `config.test.ts:189` and the `MUST` at `configuration/spec.md:201`.
- [ ] `sync.throttleMs`'s existing behavior is byte-identical under fork A; under B or C, its spec delta and its tests are updated in the same change, never left in the old policy.

### Gate 4 — The rationale comment is true of every branch

- [ ] An unknown key declared under `chunk`, under `embeddings`, and under `convention.frontmatterFields` does not appear in the loaded config — extending the existing `search` case at `config.test.ts:115` to all four branches.
- [ ] The declared sibling keys in the same object keep their values (a partial `frontmatterFields` still merges per key against the identity defaults — `configuration/spec.md:173` and its scenario at `:181` must pass unmodified).

### Gate 5 — Nothing else moved

- [ ] `npm test`, `npm run typecheck`, `npm run build` pass.
- [ ] `compendio eval` on `ejemplos/` is **unchanged**: MRR ≥ 0.943, recall@5 = 1.00, top-1 ≥ 20/22. `ejemplos/` ships no config file, so it runs entirely on defaults and a validator that touches these numbers has changed the default path — which nothing in this change is allowed to do.
- [ ] No test in `test/infrastructure/config.test.ts` is modified to accommodate the change; only added to. A modified existing assertion means merge semantics moved, not just validation.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Only the literal-zero case is covered**, and quoted numbers — the more likely typo — ship unhandled | **High** | Every gate names the string form explicitly as a first-class input. One predicate handles both by construction; a design that special-cases `0` fails Gate 1's third run |
| **The fork lands on B or C and `validThrottleMs` is left behind**, leaving two policies for one problem in one function | **High** | Named as a hard constraint on the fork, with the exact spec lines (`configuration/spec.md:199,215`) that must move with it. Gate 3's last item asserts it |
| **The validator clamps instead of falling back** — a plausible and wrong-looking-right implementation, since "minimum 1" reads as sensible | Med | Gate 3 asserts a value of `1` survives. `configuration/spec.md:201` already forbids clamping for `throttleMs`; the new requirement must forbid it in the same words |
| **Scope creeps into general config type validation** because the same predicate "obviously" applies to `docsDir` and `mode` | Med | Out of Scope, with `configuration/spec.md:7`'s explicit "config loading stays untyped by deliberate design" as the citation. `resolveRoots` already covers the one non-numeric key with a real failure mode |
| **The change looks trivial and ships without observing a failing "before" state**, so nobody learns whether the reasoning was right | Med | Gate 1 requires the explosion be *measured and recorded* before the fix, and `strict_tdd: true` makes a failing-first test mandatory anyway. This repository's recorded history is agents reporting green over defects; the before-measurement is the guard |
| **Fork C's threading exceeds the change's apparent size** and turns a one-file fix into a report-shape change | Med | Called out in Delivery size before design chooses, so the cost is part of the decision rather than a discovery at apply time |
| **A user actually running an invalid `chunk.maxTokens` today sees no improvement after upgrading** | Low | Real, and documented rather than fixed: chunk boundaries only reach unchanged documents through `compendio index`'s `reset()`. See Rollback Plan |

## Rollback Plan

Included per `openspec/config.yaml` `rules.proposal`, though this is a near-empty case under fork A.

1. Revert the change commits and `npm run build`.
2. Under forks A and B: **nothing else.** No schema change, no DDL, no config key added, no path/ID shape change, so `ejemplos/goldenset.yaml` and `compendio eval` are untouched.
3. Under fork C: also nothing on disk — the return-shape change is in-process only.

**The one asymmetry worth naming, and it points forward rather than backward.** A project that was genuinely running with an invalid `chunk.maxTokens` has a corpus chunked at the degenerate boundaries. Applying this fix does **not** re-chunk it: the incremental fingerprint is the content hash alone, so an unchanged document keeps its old boundaries through any `serve` or `compendio sync` pass. Only `compendio index`'s drop-and-recreate applies the corrected bound — the limit already specified in `openspec/specs/indexing/spec.md` ("Chunk Boundary Changes Require a Full Reindex to Reach Existing Documents") and documented in `CLAUDE.md`. This is a *pre-existing* documented property, not new debt introduced here, but it must appear in the change's own notes: "the fix is installed" and "the fix has reached your corpus" are different statements.

## Dependencies

- **Zero new npm dependencies.** No schema library, no port change, no new domain type.
- **No new fixture corpus.** `test/fixtures/strict/` (5 documents) plus the existing temp-config helpers in `test/infrastructure/config.test.ts` cover every gate.
- **No model download required by any gate.** Gate 1 is a chunk-count assertion and runs lexical; Gate 5's `eval` run is the only one needing embeddings and is an existing, already-required measurement.

## Delivery size — a decision for the `sdd-tasks` gate

| Driver | Fork A | Fork C |
|---|---|---|
| `config.ts` — predicate, four call sites, whitelist conversions, comment | 15–30 | 30–50 |
| `composition.ts` / `cli.ts` — warning threading and rendering | 0 | 40–80 |
| `config.test.ts` — value cases per key incl. string forms, no-clamp, unknown-key branches | 120–200 | 160–260 |
| Chunking integration test (Gate 1) | 40–80 | 40–80 |
| Spec delta — `configuration` | 60–120 | 100–180 |
| `CLAUDE.md` / `README.md` | 5–15 | 20–40 |
| **Total** | **240–445** | **390–690** |

Against a 400-line PR review budget: fork A clears it at the low-to-middle end, fork C almost certainly does not. **This repository's forecasts have landed 2–4× low for several cycles running** (`bounded-chunk-size` 240–420 → 773; `match-centred-excerpt` 300–470 → ~1 521; `incremental-reindex` missed by 2×), and that pattern is recorded here rather than assumed away. The mitigating difference is real but should not be overweighted: those changes carried new mechanisms across several layers, while fork A's production surface is one function in one file — the variance is concentrated in tests and spec prose, which is the more predictable half.

**Recommendation: settle the fork before `sdd-tasks` sizes anything.** Under A this is a single PR. Under C the natural cut is validation-and-hygiene first (behavior-preserving except for the fallbacks, fully gated), reporting second.

## Resolved decisions

Recorded so later phases do not re-litigate them.

| Question | Decision |
|---|---|
| Which keys are validated | **`search.k`, `chunk.minTokens`, `chunk.maxTokens`** — every declared numeric key that lacks validation today. Not a general config schema |
| Predicate | **The same one `validThrottleMs` uses**: a finite number greater than zero. One shared helper, not three variants |
| Non-numeric / quoted-number values | **The same case as an invalid number**, covered by every gate as a first-class input, not a variant |
| Clamping | **No.** Any finite positive value is accepted, per `configuration/spec.md:201`'s existing `MUST` for `throttleMs`. Gate 3 asserts it |
| Unknown-key leak (`embeddings`, `chunk`, `frontmatterFields`) | **In scope, as hygiene.** Same function, four lines, existing test template, and it removes a comment that is currently three-quarters false. Explicitly labelled as buying nothing observable on its own — reporting is what fixes a mistyped key, and reporting rides the fork |
| `minTokens > maxTokens` | **No behavior change.** Not dangerous (`mergeTinyPieces` gates on `maxTokens`), and no correction policy is non-arbitrary. Reportable through the fork's channel if one is built |
| Reporting policy (silent / throw / warn) | **Deliberately open — the fork for `sdd-design`.** Not pre-decided here, because it is the only genuine decision in the change |
| `sync.throttleMs` under forks B/C | **Moves with them or the change fails its own premise.** Two policies in one function is the inconsistency this change exists to end |
| Sibling change | **Not bundled.** `2026-08-14-sync-vector-contract` shares a review pass and nothing else |
| Migrations / schema markers / shims | **None.** Beta, no installed users |
| Artifact store | **openspec** (file-based). Engram MCP tools unavailable this cycle |

## Proposal question round (open — for the user, before `sdd-design`)

Four product questions this proposal currently answers by assumption. Each names the assumption in force, so silence is a valid answer and the change proceeds either way. A second round is available if any answer moves the scope.

1. **Which failure serves the user better: a config value silently ignored, or a start that refuses?** This is the fork, stated as a product question rather than a mechanical one. Assumed: **not pre-decided**, with the observation that this project's established reflex everywhere else is *degrade and say so* (`embeddingsWarning`, `filterWarning`, `noMatchReason`, `skipped`), which argues for C — at the cost of a return-shape change. Answering this collapses the fork and unblocks `sdd-spec`'s surface.

2. **Who writes `compendio.config.json` in the projects you care about — a person, or a template/generator?** Assumed: **a person editing by hand.** It matters because the two typo populations differ: a human typos a key name (`maxtokens`), a generator emits a quoted number (`"480"`). If generated configs are a real case, loudness at load (B or C) is worth more than it looks, and the silent-fallback option becomes noticeably weaker.

3. **Should the user be told when a declared key is not recognized at all?** Assumed: **yes, but only if the fork builds a channel** — otherwise the key is silently dropped, which is the status quo minus the leak. The alternative (a reporting channel built for values but deliberately withheld from keys) is defensible only if unknown keys are considered noise. Naming keys is where the change's practical value for a real user probably concentrates.

4. **Is a wasteful `minTokens > maxTokens` pair worth saying anything about?** Assumed: **no behavior change, warn only if a channel exists.** The consequence accepted: a project can run indefinitely with merging disabled and a corpus of tiny chunks, entirely silently, with every value technically valid. If that is a shape you expect to see in practice, say so and it becomes a first-class case rather than a rider.
