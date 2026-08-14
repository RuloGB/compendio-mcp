# Exploration: `config-value-validation` — validate declared numeric config values

**Phase**: explore · **Artifact store**: openspec (Engram unavailable in the originating session —
no `mem_*` tool was exposed, so this file is the artifact of record) · **Skill resolution**: none
(no skill in the registry applies to a TypeScript configuration-validation change).

**Origin**: finding 1.1 of `code-review-src-2026-08-14.md` (severity: medium; priority 1 in that
document's suggested ordering).

**Sibling change**: `2026-08-14-sync-vector-contract` covers finding 1.2. The two were reviewed
together and are deliberately split — see "Why this is not one change with 1.2" below.

## The claim under test

The review asserts that `mergeConfig` validates `sync.throttleMs` but merges `search.k`,
`chunk.minTokens` and `chunk.maxTokens` unvalidated, and that `embeddings`/`chunk`/
`frontmatterFields` use spread so unknown keys leak into the loaded config — contradicting the
whitelist rationale written into the `search` branch.

**Verdict: confirmed, all of it.** One reachability nuance narrows the blast radius, and one
consequence turns out to be a spec-compliance violation rather than a robustness nicety.

## Current state (verified)

`mergeConfig` (`src/infrastructure/config.ts`):

| Key | Merge form | Validated |
|---|---|---|
| `docsDir`, `exclude`, `db` | whole-value replace | n/a (non-numeric) |
| `embeddings` | `{ ...base, ...override }` | no — unknown keys leak |
| `chunk` (`minTokens`, `maxTokens`) | `{ ...base, ...override }` | **no** — unknown keys leak *and* values unchecked |
| `search.k` | explicit whitelist | **no** — key is whitelisted, value is not checked |
| `sync.throttleMs` | explicit whitelist + `validThrottleMs` | **yes** |
| `convention.frontmatterFields` | `{ ...base, ...override }` (`mergeConvention`) | no — unknown keys leak |

`validThrottleMs` is the existing template, and its own doc comment already states the general
principle the other keys do not follow: *"a finite number greater than 0; anything else
(non-numeric, negative, zero) is treated the same as an absent key and falls back to the default."*

The `search` branch carries a comment claiming the explicit whitelist "ensures none of them leak
into the returned config." That is true of `search` alone. The stated principle and the code agree
in **one of four** object-valued branches.

## Consequences (verified by code path, not assumed)

### `search.k = 0`

`SearchDocuments` slices to `k`, so `capPerDocument(...).slice(0, 0)` returns `[]`. With no active
filters, `explainEmptyResult` (`src/domain/search-diagnostics.ts`) returns `undefined` because
`hasAnyFilter` is false — so **every search returns empty with no `noMatchReason` to explain it**.
This is precisely the silent-zero failure mode that `noMatchReason` and `dropImpossibleFilters`
exist to eliminate, reintroduced through the config door.

### `search.k = "abc"` (or any non-number)

`k * CANDIDATE_FACTOR` → `NaN` → `Math.max(50, NaN)` → `NaN` → bound as a `LIMIT` parameter into
better-sqlite3, which rejects it. The failure fires **at query time, on every search**, not at
config load — the caller sees a store-layer error with no indication that a config value caused it.

*Not empirically captured*: the exact better-sqlite3 error string. The review calls it "opaque";
code-path inspection confirms only that it throws at query time. Settling the wording would take a
one-liner against a live `better-sqlite3` instance; the design does not depend on it.

### `chunk.maxTokens = 0` (or `NaN`, or a quoted number)

`splitToBound` cascades to `splitCodePoints` (`src/domain/split-text.ts`). `estimateTokens` is
`Math.ceil(len / 4)`, which is `>= 1` for any non-empty string, so the `estimateTokens(candidate)
<= opts.maxTokens` guard is never satisfied → **one chunk per Unicode code point**. A quoted number
(`"maxTokens": "480"`, a plausible generated-config typo) produces the identical explosion and is
arguably more likely than a literal zero; it needs coverage in its own right, not as an afterthought
to the zero case.

### Unknown-key leak

`{ "chunk": { "maxtokens": 480 } }` (lowercase typo) survives into the loaded config object
untouched, while `maxTokens` silently stays at its default. No error, no warning, and the user's
declared intent is discarded. `test/infrastructure/config.test.ts` already proves the whitelist
branch works for `search` — that test is the template to extend to the three spread branches.

## Reachability — narrower than the review implies for `search.k`, wider for `chunk`

`search.k` is validated **per call** at both input adapters:

- MCP: `src/server.ts` — `z.number().int().min(1).max(20)`
- CLI: `src/cli.ts` — `parsePositiveInt`

So the only unvalidated path for `k` is `compendio.config.json` → `SearchDefaults.k`
(`src/composition.ts`), used when a caller **omits** `k` — which is the common case for an agent
calling `search_docs({ query })`, so it still matters, but the surface is smaller than "any `k`".

`chunk.minTokens` / `chunk.maxTokens` have **no per-call override at any adapter**. Config is their
only source. They are fully exposed, and they are the pair with the destructive failure mode.

## `minTokens > maxTokens` — real but low severity

An inverted pair is **not** dangerous, only wasteful: `mergeTinyPieces` (`src/domain/chunking.ts`)
gates every merge on `estimateTokens(candidate) <= opts.maxTokens`, so an inverted pair can never
produce an oversized chunk — it just disables merging entirely and leaves a corpus of tiny chunks.
A coherence check is cheap to add in the same pass, but it does not carry the same urgency as the
`maxTokens = 0 | NaN` case and should not be allowed to expand the change's scope.

## Spec surface

`openspec/specs/configuration/spec.md`:

- **"Default `chunk.maxTokens` Is 480 and Is a Guaranteed Upper Bound"** — states the bound "MUST be
  honored as a guaranteed upper bound... not merely a hint." An unvalidated `chunk.maxTokens`
  means **this MUST is already violable in production by a bad config value**. This is the finding's
  strongest argument: it is not new robustness, it is closing a hole in a requirement the project
  has already committed to.
- **The `sync.throttleMs` requirement** is the literal three-way-fallback template
  (non-numeric / negative / zero → default) to extend to the siblings.

No other spec capability is touched.

## Design fork for `sdd-design`

**A. Silent fallback to default** (matches `validThrottleMs` exactly).
Consistent with the one precedent in the file; zero new surface; but a user who typo'd
`"maxTokens": "480"` gets the default silently and never learns why their chunking did not change.

**B. Loud failure at config load.**
Catches the typo at the earliest possible moment and matches the existing precedent for a *malformed*
config (`loadConfig` already throws on invalid JSON). But it turns a previously-working start into a
hard stop, and it is inconsistent with `validThrottleMs`'s established silent fallback unless that
one is changed too — which widens the change.

**C. Fallback plus a reported warning.**
Preserves A's resilience and B's visibility. Cost: `loadConfig` currently returns a plain
`CompendioConfig` with nowhere to put a warning, so this needs a return-shape change threaded
through `composition.ts` to a reporting surface. Note the project already has the vocabulary for
this shape (`embeddingsWarning`, `filterWarning`, `noMatchReason`) — degrade, but say so — which is
a real argument that C is the house style rather than a novelty.

The unknown-key leak is **separable scope**. It shares a file and a rationale comment with the
value-validation work, but it is a different mechanism (key filtering vs value checking) with a
different failure mode (declared intent discarded vs invalid value honored). Recommend deciding it
explicitly at propose time rather than letting it ride along unexamined.

## Why this is not one change with 1.2

Argued on spec-delta cohesion, not convenience:

| | This change (1.1) | `sync-vector-contract` (1.2) |
|---|---|---|
| Spec capability | `configuration` | `indexing` |
| Files | `src/infrastructure/config.ts` | `ports.ts`, `sqlite-index-store.ts`, `sync-index.ts` |
| Mechanism | input validation | write-path contract / signaling |
| Risk | mechanical | the review's own suggested fix is wrong (see sibling) |

Zero shared code, tests, or spec capability. "Both are medium-severity findings from the same review
pass" is a scheduling fact. The review's own priority list groups them for shipping *order*, not for
bundling. Coupling them either slows the easy win or under-scopes the hard one.

## Risks

- `NaN`-typo variants (quoted numeric strings) are at least as likely as literal zero and produce
  identical failures — they need explicit coverage, not just the zero case the review named.
- Choosing option B or C without also revisiting `validThrottleMs` leaves the file with two different
  policies for the same class of problem, which is the exact inconsistency this change exists to end.

## Next recommended

`sdd-propose` for this change alone.
