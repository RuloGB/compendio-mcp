# Exploration: findings 1.3, 1.4, 1.5 from `code-review-src-2026-08-14.md`

**Phase**: explore · **Artifact store**: openspec (Engram unavailable in the originating session —
no `mem_*` tool was exposed, so this file is the artifact of record) · **Skill resolution**: none
(no skill in the registry applies to a read-only TypeScript exploration).

**Origin**: findings 1.3, 1.4, 1.5 of `code-review-src-2026-08-14.md` (severities: medium,
medium-low, low). Findings 1.1 and 1.2 from the same review are already fixed and archived
(`2026-08-14-config-value-validation`, `2026-08-14-sync-vector-contract`) — referenced below as
prior art and as the precedent for how this review's findings get split into changes.

**Shared exploration**: this file covers three findings and recommends **three separate changes**
(see "Scoping recommendation"). It is the common exploration artifact for all three; each change's
proposal references it rather than re-deriving it.

**Method**: every claim below was re-verified against the current code on `main` (not accepted
from the review document), with an explicit confirmed/partially-confirmed/falsified verdict, a
reachability check (can a real caller actually trigger this?), and a check of whether an existing
mechanism already neutralizes the defect. The explore agent had no Bash/Node tool, so claims that
warranted empirical proof were hand-traced by it and then **measured by the orchestrator** — see
the Orchestrator Verification Addendum at the end, which converts the two load-bearing claims from
"reasoned" to "measured" and corrects one count upward.

---

## 1.3 — `search-documents.ts` `buildFilters`: `module`/`tags` don't get the trim/empty treatment `type` gets

**Verdict: confirmed**, and more directly reachable than the review implies — there is no adapter
guard at all for `module`/`tags` (unlike `search.k`, which has a per-call zod/CLI bound).

### Current state (verified)

`src/application/search-documents.ts:131-143`:

```typescript
private buildFilters(query: SearchQuery): SearchFilters {
  const filters: SearchFilters = {};
  const type = query.type?.trim();
  if (type !== undefined && type.length > 0) filters.type = type;
  if (query.module !== undefined) filters.module = query.module;               // no trim/empty check
  if (query.tags !== undefined && query.tags.length > 0) {
    filters.tags = query.tags.map((e) => e.toLowerCase());                    // lowercased, not trimmed
  }
  ...
}
```

`SearchFilters` (`src/domain/model.ts:48-55`) carries the comment `"empty/whitespace treated as
absent by callers"` — but it is placed only on the `type` field's own doc line, and only `type`'s
handling in `buildFilters` honors it. That comment placement is itself the likely root cause of the
asymmetry: it reads as a field-specific note, not an interface-wide contract, so it was implemented
once and never re-applied to the siblings.

### Reachability — confirmed, no upstream guard on either adapter

- **MCP** (`src/server.ts:131-140`): `module: z.string().optional()` and
  `tags: z.array(z.string()).optional()` — neither has `.min(1)` or a `.trim()`/`.refine()`. An
  agent (or a client library that always sends `module: ""` for an unset optional field, which is a
  real client behavior class) reaches `buildFilters` with the raw value untouched.
- **CLI** (`src/cli.ts:184,203-206`): `--module <module>` has no validation either. `--tags` is
  actually **partially better** than the review implies: `options.tags.split(",").map((e) =>
  e.trim())` already trims at the CLI boundary — but `buildFilters` still only lowercases, so a
  value that arrives untrimmed via MCP (the more common calling path for this server) is
  unaffected by the CLI's own hygiene.

This is a wider-open door than 1.1's `search.k`, where the review itself found a narrowing
adapter-level bound. Here there is none, at either adapter, for either field.

### Interaction with `dropImpossibleFilters` — does NOT neutralize the common case

`dropImpossibleFilters` (`src/domain/search-diagnostics.ts:50-70`) only drops `module`/`tags` when
`facets.modules.length === 0` / `facets.tags.length === 0` — i.e., when **no document in the whole
corpus** declares that field at all. Traced against `inferModule`
(`src/domain/convention.ts:53-58`): under the zero-config default (`loose`), every document not at
its root's top level gets a `module` inferred from its folder, unconditionally. So in the realistic
case — almost any real corpus with subfolders — `facets.modules` is non-empty, and
`module: ""` **survives** `dropImpossibleFilters` unchanged. It reaches the SQL layer as
`d.module = ''` (`sqlite-index-store.ts:516-518`), matches nothing (no document has a literal empty
string `module` — `applyOptionalFields`/`readField` never assign one), and `explainEmptyResult`
(`search-diagnostics.ts:116-126`) reports exactly the review's predicted string: `no document has
module "" (declared: ...)` — a filter that was never meaningfully "applied" gets reported as if it
were a deliberate, checkable request. Same trace for `tags: [" api"]`: `collectFacets` lowercases
but does not trim (`tag.toLowerCase()`, `search-diagnostics.ts:23`), so a leading-space tag also
survives `dropImpossibleFilters` when the corpus has any tags at all, and fails the same way in
`explainEmptyResult`.

**Conclusion**: this is not a diagnostics-quality nicety on top of an already-neutralized bug — it
is a live path to the exact silent-filter-failure mode `dropImpossibleFilters`/`noMatchReason` were
built to eliminate, reachable through the un-trimmed value alone, for any corpus that declares
modules or tags (the common case).

### A stronger precedent than the review cites

`src/domain/frontmatter.ts:29-36`, `resolveTags` — used at **indexing** time to normalize a
document's own declared `tags` — already does exactly the fix this finding proposes:

```typescript
return { tags: raw.map((e) => e.trim().toLowerCase()).filter((e) => e.length > 0) };
```

The fix is not a new pattern being introduced into the codebase; it is the same normalization the
project already applies on the write side, missing on the read/query side. This is a stronger
argument for the fix than anything in the original review.

---

## 1.4 — `read-document.ts` `headingsIn`: fence-unaware regex — **confirmed live in this repo's own corpus**

**Verdict: confirmed**, and unlike the other two findings this one is not theoretical: **this
project's own `docs/documentation-convention.md`, which this repo indexes under its default
zero-config `loose` mode, already contains the exact failure shape.**

### Current state (verified)

`src/application/read-document.ts:113-119`:

```typescript
function headingsIn(markdown: string): string[] {
  const titles: string[] = [];
  for (const match of markdown.matchAll(/^#{2,6}\s+(.+)$/gm)) {
    titles.push(match[1]!.trim());
  }
  return titles;
}
```

No fence tracking. Used in two places in `ReadDocument.execute` (`read-document.ts:76-101`):

1. **Section matching** (line 79): `headingsIn(c.content).some((h) => normalize(h).includes(wanted))`
   — a phantom heading can make a chunk match a `section` request that has nothing to do with it.
2. **Available-sections listing** (line 89) — the `section-not-found` payload the review calls out.

So the review's own framing understates it: this is not just a cosmetic "phantom entry in an error
message" bug. It is a **retrieval-correctness bug** — `read_doc({ path, section })` can silently
resolve against the wrong chunk.

### Live proof, not a hypothetical

`docs/documentation-convention.md`, section "12. Templates" (lines 162-260), contains four fenced
`markdown` template blocks. The functional-spec template (lines 166-185) is:

```
166: ```markdown
167: ---
...
176: # <Feature name>
178: <2-3 line summary...>
180: ## Context and objective
181: ## Business rules
182: ## Use cases
183: ## Out of scope
184: ## References
185: ```
```

Lines 180-184 are five `## ...` lines **genuinely inside** one fenced block (opened at 166, closed
at 185, no nested fence in between — traced by hand-counting the fence toggle, since a naive
non-anchored regex search across this file produces false positives by pairing a closing fence with
a later, unrelated opening fence around a real heading in between). The ADR, API-contract, and
QA-plan templates immediately after (lines 189-207, 211-233, 237-260) repeat the same shape with
different phantom headings (`## Context`, `## Decision`, `## Endpoints`, `## Data models`, `##
Scope`, `## Test cases`, etc.).

**Measured**: the full count is **17** phantom headings in this one file, not the five of the first
template — see the Orchestrator Verification Addendum for the enumeration.

Practical consequence: a `read_doc({ path: "docs/documentation-convention.md", section: "Business
rules" })` call — a plausible request, since "Business rules" is a real, common section name in
*other* documents in this convention (see the API-contract template's own field list) — currently
resolves against the "12. Templates" chunk (which is about template documentation, not business
rules) instead of returning `section-not-found`. This is the second-order consequence the review
only gestured at, now demonstrated with a concrete path and section name.

(`ejemplos/docs/leadsviewer/alta-leads.md` was also checked; on closer read its `## Errores` /
`## Ejemplos` headings sit **between** separate fences, not inside one, so it does not exemplify the
bug — it was a false positive from the same naive-regex trap described above. The
`documentation-convention.md` case stands on its own.)

### Domain reuse — genuine, not an awkward seam

`src/domain/split-text.ts:85-87` already has exactly the primitive needed:

```typescript
function isFenceDelimiter(line: string): boolean {
  return /^\s*(```|~~~)/.test(line);
}
```

It is private, pure, stateless, and currently only tested indirectly through `splitToBound`'s
behavior (`test/domain/split-text.test.ts:137-151`, etc. — no direct unit test of the delimiter
check itself). Exporting it and reusing it in `headingsIn` is a clean fit, not a forced one:

- `split-text.ts` is already `src/domain/` — zero SQLite/transformers.js/filesystem dependencies,
  satisfying `config.yaml`'s hexagonal rule.
- `read-document.ts` (`src/application/`) already legally imports from `../domain/*`.
- No new file is needed — just `export function isFenceDelimiter` in the existing module, imported
  by `headingsIn`, which switches from `matchAll` to a line-by-line loop toggling `inFence` (the
  same shape `splitIntoBlocksFenceAware` already uses one function away). Reusing the heavier
  `splitIntoBlocksFenceAware` (block splitting, unrelated to heading extraction) would be the
  awkward seam — reusing only the one-line delimiter check is not.
- The exported function becomes new public domain surface with no direct unit test today — `sdd-design`
  should decide whether it gets one (recommended, since it stops being "tested only through its
  effects" once exported).

---

## 1.5 — `get-overview.ts` `byType`/`byModule`: unsafe plain-object counters

**Verdict: confirmed as a data-correctness bug; NOT a prototype-pollution security issue** — this
narrows the review's own "corrupts or loses the count" framing into something more precise, worth
carrying into the proposal so the fix isn't oversold. **Now measured**, not only reasoned — see the
addendum.

### Current state (verified)

`src/application/get-overview.ts:48-55` (the review cited 31-36; the correct location is 48-55):

```typescript
const byType: Record<string, number> = {};
const byModule: Record<string, number> = {};
for (const doc of documents) {
  if (doc.type !== undefined) byType[doc.type] = (byType[doc.type] ?? 0) + 1;
  if (doc.module !== undefined) byModule[doc.module] = (byModule[doc.module] ?? 0) + 1;
}
```

### Reachability — confirmed

`type`/`module` are open, project-defined strings with no value restriction anywhere in the
pipeline. Traced through `createLoosePolicy`/`createStrictPolicy`
(`src/domain/convention.ts:85-87,115-125`): `type = readField(data, cfg.frontmatterFields.type)`
reads a raw YAML scalar value with no allow-list check under `loose`, and only a *presence* check
(or a declared-list membership check if `convention.types` happens to be configured) under `strict`
— neither rejects `"__proto__"` or `"constructor"` as *values*. gray-matter/js-yaml has no special
handling for these strings when used as a YAML **value** (only as a *key* would there be a class of
YAML-specific gotchas, and that's not this path). A document with:

```yaml
---
type: __proto__
---
```

produces `meta.type = "__proto__"` and survives the SQLite `type TEXT` column
(`sqlite-index-store.ts`) with no validation, unmodified, into `GetOverview.execute()`. Same for a
folder literally named `__proto__` or `constructor` feeding `inferModule`. This is fully reachable
through ordinary frontmatter or folder naming, not a contrived input.

### Behavior

For `type = "__proto__"`, on a fresh `byType = {}` (a plain object, `Object.prototype` in its
chain):

- `byType["__proto__"]` reads the **inherited accessor getter** `Object.prototype.__proto__`, which
  returns the object's own `[[Prototype]]` — i.e. `Object.prototype` itself, an object, not
  `undefined`. So `?? 0` does **not** fire.
- `Object.prototype + 1` triggers `ToPrimitive` → `valueOf()` returns the object unchanged (not
  primitive) → falls to `toString()` → `"[object Object]"` → string-concatenates with `1`.
- The assignment invokes the inherited `__proto__` **setter** (Annex B, `B.2.2.1.2`), whose
  spec-defined behavior is: if the assigned value is not an object and not `null`, do nothing. A
  string is neither, so the assignment is a silent no-op.

**Net effect for `"__proto__"`**: the count is silently **lost** — it never appears anywhere in
`byType`, `Object.entries(byType)` never lists it (no own property was created), and
`Object.prototype` is **not** mutated, so there is no cross-request/global pollution.

For `type = "constructor"`:

- `byType["constructor"]` reads the inherited **data property** `Object.prototype.constructor`
  (the `Object` function) — again not `undefined`, so `?? 0` does not fire.
- `Object + 1` → `ToPrimitive` → `toString()` on the function → concatenated with `1`.
- Because `Object.prototype.constructor` is a *writable* data property (not an accessor with a
  guard), assignment through it **creates a new own property** `constructor` on `byType` itself,
  shadowing the inherited one. `Object.prototype` is again untouched.

**Net effect for `"constructor"`**: the count is **corrupted** — `byType.constructor` becomes a
garbled string instead of a number, and it *does* show up (in `Object.entries` and therefore in
`formatOverview`'s rendered output), unlike the silently-vanishing `__proto__` case.

> **Correction (propose phase, verified)**: an earlier revision of this paragraph said the garbled
> value also appears "in the raw `docs_overview` MCP response". That is wrong. `server.ts:93`
> returns `content: [{ type: "text", text: formatOverview(...) }]` — **text only**; there is no
> structured `byType` on the wire. The corruption reaches an agent through the rendered string,
> not a response field. The `overview-counter-safety` proposal carries the corrected framing. Still scoped to that one call's freshly-constructed `byType`
object (`execute()` builds it fresh every call) — no persistence or cross-request leakage either
way.

**Revised severity framing for the proposal**: this is a data-integrity bug in the `docs_overview`
response (a count silently disappears, or a count field renders as garbage text) — real,
low-effort to fix, worth doing — but not the kind of "prototype pollution" that would justify
elevating its severity beyond the review's own "low" rating. `Map<string, number>` (converted to a
`Record` at the return boundary, to keep `Overview.byType`'s public shape unchanged) is the right
fix; `Object.create(null)` is a viable alternative with a smaller diff but changes `byType`'s
runtime type in a way a `Map`-then-convert does not. **Both were measured to work** — see the
addendum.

---

## Spec surface (per finding)

### 1.3 — `openspec/specs/search/spec.md`

Existing requirement **"Open `type` Filtering"** already has a scenario, verified:

> #### Scenario: Empty or whitespace-only type is treated as absent
> - WHEN `search_docs`/`--type` is called with `type: ""` or a whitespace-only string
> - THEN the filter is treated as absent — no filtering by `type` is applied, consistent with the
>   indexing spec's empty-string-as-absent rule

There is **no equivalent scenario for `module`/`tags`** anywhere in this file. The fix is a
same-shaped **addition** to an existing requirement (or a sibling requirement), not a rewrite —
directly mirroring the `type` scenario already there, plus a `tags`-specific scenario covering
whitespace-only individual entries (not just an empty array, which already short-circuits via
`query.tags.length > 0`).

### 1.4 and 1.5 — `openspec/specs/mcp-contract/spec.md`

Both findings land in the **same spec file**, but on disjoint requirements:

- 1.4 is closest to the existing **"`search_docs`'s `section` Is Never Empty and Round-Trips"** and
  **"`read_doc` Never Renders an Empty-Labeled Bullet..."** requirements (lines ~47-85) — both are
  about `section`/heading correctness, but neither currently says anything about fenced-code-block
  awareness. This is a new requirement, sibling to those, not a modification of them.
- 1.5 is closest to the existing **"`docs_overview` Omits Empty Taxonomy Buckets"** requirement
  (line ~109) — again related (both about `byType`/`byModule` correctness) but distinct: that
  requirement is about *presence* (omit empty buckets), this finding is about *value safety*
  (don't corrupt/lose a bucket for a specific string value). New requirement, not a modification.

Sharing a spec *file* does not mean sharing a spec *capability requirement* — same situation
`config-value-validation`/`sync-vector-contract` explicitly reasoned through for 1.1 vs 1.2, just
one level more granular (same file, disjoint requirements) rather than (different files).

---

## Test surface (per finding, `strict_tdd: true` — mapping only, no tests written)

### 1.3 — `filter-input-hygiene`

- `test/application/index-and-search.test.ts:534-556` — `describe("SearchDocuments — open type
  filtering")` already contains the exact template test to extend:
  `"treats an empty or whitespace-only type as absent (no filtering applied)"`. A failing-first test
  would add sibling `it`s for `module: ""`/`module: "  "` and `tags: [" api"]` under the same
  `describe`, asserting the filter has no effect (same assertion shape: unfiltered result set).
- `test/application/index-and-search.test.ts:145-170` — the `dropImpossibleFilters`/`filterWarning`
  tests are the right place for a regression test proving `module: ""` does NOT trigger
  `filterWarning`/get silently dropped by that mechanism today (the reachability finding above) —
  i.e. a test that would currently demonstrate the bug by asserting `noMatchReason` currently
  contains `no document has module ""`, then flips to asserting no filtering occurred once fixed.
- `test/domain/search-diagnostics.test.ts` — unit-level coverage of `dropImpossibleFilters`/
  `explainEmptyResult` directly, if the fix is scoped to also normalize inside that mechanism rather
  than only at `buildFilters` (design decision, not settled here).

### 1.4 — `read-doc-fence-aware-sections`

- `test/application/read-document.test.ts:105-112` (`"lists available sections when the requested
  one does not exist"`) and `:288-303` (the `[RED->GREEN]` empty-heading test already in the house
  style for this exact function) are the direct templates. A failing-first test would seed a chunk
  whose content contains a fenced block with an `## ` line and assert it is absent from
  `availableSections`, then a second test asserting a `section` request matching only the phantom
  heading returns `section-not-found` (not a false `section` match).
- `test/domain/split-text.test.ts` — if `isFenceDelimiter` is exported, it currently has **zero
  direct unit tests** (only indirect, through `splitToBound`'s behavior); the change should add a
  small dedicated `describe("isFenceDelimiter")` block, since it becomes new public domain surface.
- Consider one integration-level regression using the repo's own live case: a test fixture modeled
  on `docs/documentation-convention.md`'s Templates section shape (fenced block containing `##`
  lines) is stronger evidence than a synthetic one-liner, given the bug was found live in this
  exact corpus.

### 1.5 — `overview-counter-safety`

- `test/application/get-overview.test.ts:35-49` — `describe("GetOverview — empty taxonomy
  omission")` is the direct template. Add `it`s seeding a document with `type: "__proto__"` and one
  with `type: "constructor"`, asserting (a) the count is present and correct (`{ __proto__: 1 }` /
  `{ constructor: 1 }` as *own, correctly-typed* entries) and (b) `formatOverview`'s rendered output
  contains the correct count, not a garbled string or a silently-missing entry. Repeat for
  `byModule` with a module-named `__proto__`/`constructor` (via `SqliteIndexStore.saveDocument`,
  same seeding helper already in the file).

---

## Scoping recommendation: **three separate changes**, not one

> **Decided (2026-08-15, user)**: three separate changes, as recommended below. The
> 1.4-vs-1.5 call flagged as lower-conviction was put to the user explicitly and resolved in
> favour of the split — 1.5 does **not** ride along with 1.4. Each change gets its own folder at
> propose time and references this shared exploration rather than re-deriving it.
>
> **Delivery strategy (2026-08-15, user): `exception-ok`.** Each change ships as a single PR even
> if it exceeds the 400-line review budget; a `size:exception` is recorded rather than the work
> being split into chained PRs. This is live for `read-doc-fence-aware-sections` specifically,
> whose design forecasts 278–488 lines — `auto-chain` and `ask-on-risk` were both offered and
> declined. `sdd-tasks` and `sdd-apply` must be told this run uses `size:exception`; the Review
> Workload Guard does not stop the chain. Note the design's own caveat: there is no natural cut in
> 1.4, so any voluntary trimming would come out of test breadth, and **never** out of test case 2c
> (the guard regression) or the verification script.

| | `filter-input-hygiene` | `read-doc-fence-aware-sections` | `overview-counter-safety` |
|---|---|---|---|
| Finding | 1.3 | 1.4 | 1.5 |
| Spec capability | `search` | `mcp-contract` (read_doc) | `mcp-contract` (docs_overview) |
| Files | `search-documents.ts` (+ maybe `search-diagnostics.ts`) | `read-document.ts`, `split-text.ts` (new export) | `get-overview.ts` |
| Mechanism | input trimming/normalization, symmetric with existing `type` handling | fence-state tracking reused from an existing private domain function | safe key-value counting (`Map` vs. plain object) |
| Reachability | confirmed, no adapter guard at all | confirmed **live** in this repo's own indexed corpus (17 occurrences) | confirmed, reachable via ordinary frontmatter/folder names |
| Risk | mechanical | touches a hexagonal seam (new exported domain symbol) — needs a design decision | mechanical, but needs the security-framing nuance carried through |
| Rough size (see caveat below) | ~20-40 changed lines | ~60-110 changed lines | ~20-35 changed lines |

Reasoning, same criterion the `config-value-validation`/`sync-vector-contract` split used
("spec-delta cohesion, not convenience"):

- **1.3 vs. the other two**: different spec capability (`search` vs. `mcp-contract`), different
  file, zero shared code. Not a close call.
- **1.4 vs. 1.5**: this is the closer call — both land in `mcp-contract/spec.md`, both are
  correctness bugs in an MCP tool's response. But they touch **completely disjoint files**
  (`read-document.ts`+`split-text.ts` vs. `get-overview.ts`), have **zero shared code or test
  files**, and — most importantly — very different risk/design weight: 1.4 requires a design
  decision about exporting new domain surface and reusing it across a layer boundary; 1.5 is a
  self-contained, low-risk, one-function edit. Bundling them means the trivial, unambiguous fix
  (1.5) either rides along and gets slowed down by the design discussion 1.4 actually needs, or the
  PR reads as two unrelated concerns stitched together for scheduling convenience — the same
  argument the prior exploration made almost verbatim for 1.1 vs 1.2: *"Coupling them either slows
  the easy win or under-scopes the hard one."*
- This is a **lower-conviction call than 1.3 vs. the others**, though: 1.5 is small enough
  (~20-35 lines) that a reviewer could reasonably choose to fold it into whichever of the other two
  ships nearest in time, purely to reduce SDD process overhead for what is genuinely a tiny fix. That
  is a legitimate call to make explicitly at `sdd-propose` time, not one this exploration should
  force — recorded here so it isn't silently decided by default.

**Suggested order**: `read-doc-fence-aware-sections` first — it is the only one of the three proven
live in this repo's own corpus today, not merely reachable in theory. `filter-input-hygiene` and
`overview-counter-safety` can follow in either order; neither blocks the other.

### Forecast honesty (per this repo's own recorded pattern)

This repo's own history shows exploration-phase size estimates have undershot actual delivered size
by roughly 1.3x-2x by the time `sdd-tasks`/`sdd-apply` run, driven by test coverage and edge cases
the exploration phase doesn't fully enumerate. The line-count column above should be read as a
**floor**, not a target — particularly for `read-doc-fence-aware-sections`, where the "should this
get its own dedicated unit test file" question alone (noted in the test surface section) could add
another test file's worth of lines that isn't counted in the estimate.

---

## Risks

- **1.3**: the fix's exact boundary needs a design decision `sdd-design` should make explicit — does
  normalization happen only in `buildFilters` (application layer, narrowest fix, matches how `type`
  is currently handled), or should `dropImpossibleFilters`/`explainEmptyResult` also defensively
  trim (domain layer, defense in depth, larger diff)? The review's suggested snippet only touches
  `buildFilters`; this exploration found that sufficient to close the live bug, given `type`'s
  existing precedent does the same (fixes at the boundary, not defensively downstream).
- **1.4**: exporting `isFenceDelimiter` from `split-text.ts` creates new public domain surface with
  no direct unit test today. `sdd-design` should decide whether `headingsIn`'s fence-aware rewrite
  needs a fully separate loop or can share more structure with
  `splitIntoBlocksFenceAware` without over-coupling two functions that currently serve different
  purposes (block splitting for chunking vs. heading extraction for section lookup).
- **1.5**: the fix must not be sold as closing a "prototype pollution" security hole — measured
  behavior (addendum below) shows `Object.prototype` is never actually mutated by either
  `"__proto__"` or `"constructor"` as a `type`/`module` value; the bug is response-data-integrity (a
  lost or garbled count), not a security escalation.
- **General**: none of the three findings have any interaction with the beta/no-migrations policy in
  `openspec/config.yaml` — all three are internal behavior corrections with no persisted-schema or
  public-contract-shape change (MCP tool params/response field names are unchanged in all three
  fixes), so the "breaking changes are an accepted cost" clause is not in play here and no rollback
  plan beyond a normal revert is needed.

---

## Orchestrator Verification Addendum (measured, not reasoned)

The explore agent has no Bash/Node tool and flagged two claims as hand-traced. The orchestrator ran
them. Both hold; one count was corrected upward.

### 1.5 — prototype-key counter behavior, reproduced

```bash
node -e "
const byType = {};
for (const t of ['__proto__','constructor','normal']) byType[t] = (byType[t] ?? 0) + 1;
console.log('own keys:', Object.keys(byType));
console.log('entries :', JSON.stringify(Object.entries(byType)));
"
```

```
own keys: [ 'constructor', 'normal' ]
entries : [["constructor","function Object() { [native code] }1"],["normal",1]]
```

The `__proto__` count is **absent entirely** (silently lost); the `constructor` count is the string
`"function Object() { [native code] }1"` instead of `1`. Both predictions confirmed exactly.

Prototype mutation and the proposed fix, measured on the same runtime:

```bash
node -e "
const before = Object.getOwnPropertyNames(Object.prototype).length;
const byType = {};
for (const t of ['__proto__','constructor']) byType[t] = (byType[t] ?? 0) + 1;
console.log('Object.prototype own props before/after:', before, Object.getOwnPropertyNames(Object.prototype).length);
console.log('fresh object sees a stray key?         :', Object.keys({}).length === 0 ? 'no' : 'YES');
console.log('proto of byType still Object.prototype :', Object.getPrototypeOf(byType) === Object.prototype);
const safe = Object.create(null);
for (const t of ['__proto__','constructor']) safe[t] = (safe[t] ?? 0) + 1;
console.log('Object.create(null) entries            :', JSON.stringify(Object.entries(safe)));
"
```

```
Object.prototype own props before/after: 12 12
fresh object sees a stray key?         : no
proto of byType still Object.prototype : true
Object.create(null) entries            : [["__proto__",1],["constructor",1]]
```

`Object.prototype` is untouched (12 own props before and after), no fresh object inherits a stray
key, and `byType`'s own prototype link is intact — **there is no prototype pollution here**. The
"data-integrity, not security" framing is measured fact, not an argument. `Object.create(null)`
produces both counts correctly.

**A trap worth recording**: the first attempt at the pollution check used
`Object.prototype.hasOwnProperty('__proto__') === false` as the predicate and reported `YES`
(polluted). That predicate is wrong — `__proto__` *is* an own accessor property of
`Object.prototype` in an unmodified runtime, so the check reports pollution on a perfectly healthy
object. Any test written for this change must compare the prototype's own-property set **before and
after**, or check that a *fresh, unrelated* object is unaffected. A naive `hasOwnProperty` probe
will produce a false positive and "prove" a bug that isn't there.

### 1.4 — phantom headings in this repo's own corpus, enumerated

A fence-toggling scan of `docs/documentation-convention.md` (the same algorithm the fix will
implement) finds **17** `##`-level headings inside fenced blocks, not the 5 of the first template
alone:

| Line | Phantom heading | Line | Phantom heading |
|---|---|---|---|
| 180 | `## Context and objective` | 225 | `## Endpoints` |
| 181 | `## Business rules` | 230 | `## Data models` |
| 182 | `## Use cases` | 231 | `## Errors` |
| 183 | `## Out of scope` | 232 | `## Examples` |
| 184 | `## References` | 251 | `## Scope` |
| 203 | `## Context` | 253 | `## Test cases` |
| 204 | `## Decision` | 258 | `## Test data` |
| 205 | `## Alternatives considered` | 259 | `## Exit criteria` |
| 206 | `## Consequences` | | |

Every one of these is currently offered to an agent as an available section of that document, and
every one can currently capture a `read_doc({ section })` request. The live-occurrence claim is
confirmed and larger than reported.

### Code citations spot-checked

`search-documents.ts:131-143` (`buildFilters`), `get-overview.ts:48-55` (counters),
`split-text.ts:85-87` (`isFenceDelimiter`), `read-document.ts:113-119` (`headingsIn`) and
`search-diagnostics.ts:50-70` (`dropImpossibleFilters`) were each read at the cited location and
match the exploration's quoted text verbatim. In particular `dropImpossibleFilters` does gate on
`facets.<field>.length === 0` (corpus-wide emptiness), confirming that `module: ""` survives it
whenever any document declares a module — the claim 1.3's severity rests on.

---

## Findings surfaced during the propose phase (verified by the orchestrator)

Three things the propose agents found that this exploration missed. Recorded here so the shared
artifact stays the honest record.

1. **1.3 has a third symptom, worse than the two documented above.** On a corpus where *no*
   document declares a module, `module: ""` **does** trip `dropImpossibleFilters` (the field is
   defined, `facets.modules` is empty), producing `describeDroppedFilters`'s advice:
   *"the project needs `convention.frontmatterFields` to map its frontmatter keys"*
   (`search-diagnostics.ts:73-81`, read and confirmed). A blank string from a client sends the user
   to edit their config for a bug that is not in their config. The documented cases fail silently;
   this one fails confidently and wrongly.

2. **A sibling fence-blindness defect exists in `search_docs`'s path, not just `read_doc`'s.**
   `src/domain/flatten-map.ts:92` skips heading lines with `/^\s*#{1,6}\s/` and is equally
   fence-unaware (confirmed by reading the line), so a `# comment` inside a fenced shell block is
   dropped from search excerpts. **Explicit non-goal** of `read-doc-fence-aware-sections`: different
   capability, different failure mode, and the raw→flat offset-map contract makes it materially
   riskier to touch. Recorded as a known open item — it hits `search_docs`, the tool agents actually
   call, so it deserves its own change rather than quiet inclusion.

3. **The strongest argument for 1.4 is one nobody made until propose.** Every *other* heading reader
   in the pipeline is already fence-aware: remark's AST at parse time (a `##` inside a fence is a
   `code` node, never a heading) and `splitIntoBlocksFenceAware` at split time. `headingsIn`
   therefore invents section names **the indexer explicitly declined to create**. That removes any
   reading of this as a deliberate design choice.

Also worth noting for whoever writes the gates: `read_doc` has **no CLI command**
(`src/cli.ts` registers `index`, `sync`, `index-md`, `search`, `overview`, `eval`, `serve` — no
`read`). It is MCP-only, so no manual gate for 1.4 can be a `node dist/cli.js` one-liner; the
`scripts/vector-reach.mjs` precedent (a small script calling the use case directly) is the pattern
to follow.

## Ready for Proposal

Yes, for all three, in the order recommended above. `read-doc-fence-aware-sections` is ready to
propose immediately given the confirmed live occurrence in this repo's own corpus; the other two are
equally well-understood and unblocked, differing only in urgency, not readiness.
