# Design: Filter Input Hygiene — one enforcement point, one definition of a tag

**Phase**: design · **Artifact store**: openspec (Engram MCP tools unavailable this cycle — this file
is the artifact of record) · **Skill resolution**: paths-injected (`cognitive-doc-design`).

**Fork decision: A — normalization lives in `SearchDocuments.buildFilters` and nowhere else.** B is
rejected, but not for the reason the proposal offered ("distrust rather than design"). It is rejected
because it is **mis-sited**: `dropImpossibleFilters` and `explainEmptyResult` are diagnostics, called
only from `SearchDocuments.execute` *after* `buildFilters` and never on the SQL path, so B's trim is
dead code on every production path today and is **not in the call chain of the hypothetical future
producer that is the entire argument for adding it**. Decision 1 carries the evidence.

A leaves one real residue: `SearchFilters` is a public domain type and a future producer could bypass
`buildFilters`. That residue is answered by documentation at the type (Decision 4), not by trimming in
the wrong place.

One thing the proposal did not ask for and this design adds: **`tags` normalization becomes a shared
domain function** (`normalizeTags`, `src/domain/tags.ts`) called by both `resolveTags` (write side) and
`buildFilters` (read side). Fixing a drift bug by making a second copy of the rule is self-undermining;
Decision 3 argues it from this repository's own `tokenizeQuery` precedent.

## Findings that correct the inputs

Recorded first, not buried, per this project's practice. Every row was checked against the file.

| Claim in the proposal / exploration | Verified state |
|---|---|
| *"the untrimmed-tag path is reachable only over MCP"* (proposal, Reachability) | **Half true, and the half that is false widens the gates.** The *whitespace-padded* tag is MCP-only — `cli.ts:205` trims each entry. The **blank** tag is CLI-reachable: `split(",")` never drops empties, so `--tags ""` → `[""]`, `--tags "api,"` → `["api", ""]`, and `--tags ","` → `["", ""]`, which today yields `no document carries "", "" (declared: …)` against a tagged corpus and the `convention.frontmatterFields` advice against an untagged one. Case A and case C both have a CLI door for `tags`, and `--module ""` gives `module` one too (`cli.ts:203` is a bare passthrough) |
| *"`SearchFilters`' field-scoped comment is the likely root cause of the asymmetry"* (proposal, Scope) | **Confirmed, and incomplete in a way that matters.** The identical shape exists a second time, in the file this change already edits: `SearchQuery` (`search-documents.ts:15-18`) carries `/** Open string, project-defined; empty/whitespace-only is treated as absent. */` on `type` and leaves `module?`/`tags?` bare. Promoting only `model.ts`'s comment leaves the root-cause pattern live at the caller-facing interface. See Decision 4 |
| *"fork B — defence in depth … they are exported domain functions with their own direct unit tests, so they are callable by anything"* (proposal, The design fork) | True and irrelevant to the risk. Traced the call graph: `dropImpossibleFilters`/`explainEmptyResult` have exactly one production caller (`search-documents.ts:60,66,71`), always downstream of `buildFilters`, and neither sits on the path to `searchLexical`/`searchVector`. A future producer that hand-builds `SearchFilters` and calls the store port directly never reaches them. **B guards the explanation of the result, not the result.** Decision 1 |
| *"`buildFilters` is the only producer of `SearchFilters` in production code (verified)"* | **Confirmed independently.** Every other reference in `src/` is a type annotation on a consumer (`ports.ts:169,172`; `sqlite-index-store.ts:399,416,509`; `search-diagnostics.ts:51,53,99,166`) or the `{ ...filters }` spread at `search-diagnostics.ts:54`. The only other literals in the repo are in `test/domain/search-diagnostics.test.ts`, which constructs the *post-normalization* shape on purpose |
| *"`seedDoc` … needs a `module`/`tags` passthrough. That is the one non-mechanical piece of test work"* (proposal, Dependencies) | Confirmed, and **the reason it is non-mechanical is not named in the proposal**. `saveDocument` persists `JSON.stringify(meta.tags)` verbatim (`sqlite-index-store.ts:219`); `resolveTags` never runs in that seam. A test that seeds `tags: [" api"]` builds a corpus production cannot produce, and it inverts Gate 2: green **before** the fix (both sides dirty, `je.value IN (' api')` matches) and **red after** it (query normalizes to `api`, storage stays `" api"`). This is the tags-shaped twin of the module-less-corpus hazard. See Decision 6 |
| *"`tags: []` is inert at four independent `length > 0` guards"* | **Confirmed** (`search-documents.ts:136`, `sqlite-index-store.ts:527`, `search-diagnostics.ts:65,129,170`). Second consequence the proposal did not draw: because `filters.tags = []` is inert, **checking `length > 0` before normalizing instead of after is behaviourally invisible** — no gate can catch it. See Decision 7 |

## Technical Approach

One function changes behaviour. One 12-line pure domain module is added so the read side and the write
side share a single definition of a tag. Everything else is documentation.

```
search_docs / --search        SearchQuery { type?, module?, tags? }
   │  server.ts  zod: .optional(), no .min(1)          UNCHANGED — asserted
   │  cli.ts     parseType trims; --module raw; --tags split+trim, empties kept   UNCHANGED — asserted
   ▼
SearchDocuments.buildFilters                                   THE ONLY ENFORCEMENT POINT
   ├─ type   : trim → blank ? omit : set                       unchanged
   ├─ module : trim → blank ? omit : set                       NEW, line-for-line identical to type
   ├─ tags   : normalizeTags() → empty ? omit : set            NEW, shared with resolveTags
   └─ excludedStatuses : from config, never from the caller    unchanged, exempt
   ▼
SearchFilters  ── every value is one the caller meaningfully asked for ──┐
   │                                                                     │
   ├─→ IndexStore.searchLexical / searchVector → buildFilterSql          │  consumers:
   └─→ dropImpossibleFilters → explainEmptyResult                        │  trust, never re-check

src/domain/tags.ts   normalizeTags()      ←── resolveTags()  (index time, frontmatter.ts)
                                          ←── buildFilters() (query time, search-documents.ts)
```

**The three cases, before and after** (proposal's case A/B/C, traced end to end):

| Input | Today | After |
|---|---|---|
| `module: ""`, corpus **with** modules | `d.module = ''` → 0 rows → survives `dropImpossibleFilters` → `no document has module "" (declared: …)` | filter absent; identical response to the module-omitted call |
| `module: ""`, corpus **without** modules | `dropImpossibleFilters` fires → unfiltered results **plus** advice to edit `convention.frontmatterFields` | filter absent; no `filterWarning`; identical to the module-omitted call |
| `tags: [" api"]` / `[""]` / `["api", "  "]` | exact-equality miss → `no document carries " api" (declared: "api", …)` | `["api"]` / absent / `["api"]` |

No `filterWarning`, no `noMatchReason`, no third warning variant: the normalization is **silent**, as
`type`'s is today (user decision, 2026-08-15, Q2).

| Question the change owns | Answer | Where |
|---|---|---|
| Does the domain layer get defensive trimming | **No — A.** B is mis-sited, not merely redundant | Decision 1 |
| Does `module` get a helper, or the same four lines as `type` | The same four lines, deliberately | Decision 2 |
| Does `tags` duplicate `resolveTags`' expression or share it | **Share it**, via a new pure domain module | Decision 3 |
| Where the contract is stated, and in how many places | Two places stating **two different things**: input policy on `SearchQuery`, post-normalization invariant on `SearchFilters` | Decision 4 |
| Does `type`'s double trim get removed | **No**, and the principle is idempotence, not tolerance | Decision 5 |
| How the two false-green hazards are made structural | Executable preconditions in the tests, and a throwing test seam | Decision 6 |
| The one wrong implementation no gate can catch | Normalize first, then check length | Decision 7 |

## Architecture Decisions

### Decision 1: Fork A — `buildFilters` is the only enforcement point

**Choice.** `src/application/search-documents.ts` is the only file whose behaviour changes.
`src/domain/search-diagnostics.ts` is **untouched**.

| Option | Decision |
|---|---|
| **A** — `buildFilters` only | **Chosen** |
| **B** — plus defensive trimming in `dropImpossibleFilters` / `explainEmptyResult` | **Rejected — mis-sited.** See the call-graph argument below |
| **C** — make `SearchFilters` unforgeable (branded type + a `createSearchFilters` constructor) | **Rejected.** This is the *only* option that would actually close the residual risk, and it costs more than the risk is worth: it breaks every `SearchFilters` literal in `test/domain/search-diagnostics.test.ts`, which Gate 5 forbids ("no existing assertion modified, only added to"), and it introduces nominal typing into a codebase that uses plain interfaces throughout. Recorded so it is not re-proposed as the obvious middle ground |

**Why B fails on its own terms.** The stated risk is a *future producer* — a new use case or adapter
that constructs `SearchFilters` directly instead of going through `buildFilters`. Map that producer's
call path:

| Who touches `SearchFilters` | Role | Would fork B protect it? |
|---|---|---|
| `SearchDocuments.buildFilters` (`:131-143`) | producer — the only one in `src/` | It *is* the enforcement |
| `IndexStore.searchLexical` / `searchVector` (`ports.ts:169,172`), `SqliteIndexStore`, any future store adapter | consumer | Nothing to protect — receives already-normalized values |
| `buildFilterSql` (`sqlite-index-store.ts:509`) | consumer | Same |
| `dropImpossibleFilters` / `explainEmptyResult` / `hasAnyFilter` | consumer (spreads, never constructs from raw input) | Would trim values `buildFilters` already trimmed — dead code |
| A future use case that hand-builds filters and calls the store port directly | **producer — the actual risk** | **No.** It calls `searchLexical`; it never enters the diagnostics functions at all |

The last row is decisive. B's defence sits on the path where the breach cannot happen and is absent
from the path where it can. Adding it would buy the *appearance* of defence in depth while leaving the
named risk exactly where it was — and it would do so while adding a second, silently-diverging
statement of the rule, which is the failure mode this whole change exists to remove.

**What A actually leaves open, stated plainly.** A future producer bypassing `buildFilters` gets no
normalization. That is true, and no option short of C changes it. Two things bound it:

1. **Adapters are not producers.** `server.ts` and `cli.ts` construct `SearchQuery`, not
   `SearchFilters`; `SearchFilters` is internal to the search use case and sits on the far side of it.
   A new *input* adapter (HTTP, a second MCP client shape) inherits normalization for free. A new
   *output* adapter (a different vector store) is a consumer. The only exposed shape is a new
   application-layer use case that skips `SearchDocuments` — none exists, and `EvaluateSearch`, the
   one use case that searches, goes through `SearchDocuments`.
2. **The obligation is written where that producer will read it** — on the type itself (Decision 4),
   not in a diagnostics function they will never call.

This is speculative generality declined on evidence, not on taste: the cost of A being wrong is that
someone later writes a use case, reads the interface comment that tells them to normalize, and does.

### Decision 2: `module` gets the same four lines as `type`, not a helper

**Choice.**

```ts
const type = query.type?.trim();
if (type !== undefined && type.length > 0) filters.type = type;
const module = query.module?.trim();
if (module !== undefined && module.length > 0) filters.module = module;
```

**Rejected — a `blankToAbsent(value)` helper for the two scalar fields.** It would shorten the function
by two lines and *lengthen* the reasoning: the bug being fixed is an asymmetry, and the anti-recurrence
property is that the symmetry is **visible at the point of use**. Two adjacent, character-for-character
parallel pairs make a third field's omission obvious to any reader; two calls to a helper make it
obvious only to a reader who opens the helper. Contrast Decision 3, where the two statements of the
rule live in different files *and different layers* and cannot be seen together at all — that is when
extraction earns its indirection.

**Rejected — lowercasing `module`.** Out of scope on the record (proposal, Resolved decisions) and
Gate 4's case-preservation assertion is what proves it did not sneak in. The asymmetry is real and has
a reason: `tags` are lowercased on the *write* side by `resolveTags`, so lowercasing on the read side
restores symmetry; `type`/`module` are stored verbatim, so lowercasing them would be new matching
semantics that silently breaks a project with capitalized modules. Trim only.

### Decision 3: `tags` normalization becomes a shared pure domain function

**Choice.** A new module, `src/domain/tags.ts`:

```ts
/**
 * The canonical form of a tag in this system: trimmed, lowercased, empties
 * dropped. Both sides of every tag comparison MUST use this — `resolveTags`
 * normalizes what a document declares at index time, `buildFilters`
 * normalizes what a caller asks for at query time, and the comparison is
 * exact string equality in SQL (`je.value IN (…)`). Two copies of this rule
 * is precisely the defect this function exists to make unrepeatable: before
 * it, the write side trimmed and the read side did not, so a stored `api`
 * could not be found by a query for ` api`.
 */
export function normalizeTags(values: readonly string[]): string[] {
  return values.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0);
}
```

`resolveTags` (`frontmatter.ts:29-36`) becomes `return { tags: normalizeTags(raw) };` — behaviour
byte-identical, with `test/domain/frontmatter.test.ts` passing **unmodified** as the falsifier.
`buildFilters` calls the same function.

**Why sharing rather than a second copy of the expression.** This repository already made this exact
argument, in a code comment, about this exact class of problem — `tokenizeQuery`, extracted so that
`toFtsQuery` and the excerpt locator use *"one definition of 'what a query term is,' not two that can
silently drift apart"* (`sqlite-index-store.ts:495-501`). A tag is the same kind of object: a value
whose identity two subsystems must agree on. And the drift is not hypothetical here — it is the bug in
the ticket. Shipping the fix as a copy-paste of the write side's expression leaves the next change to
tag normalization (Unicode folding, stripping a leading `#`, anything) able to reintroduce this defect
in exactly its original form: silent, and with a diagnostic that lists the value the caller asked for.

**Why this does not violate the hexagonal rule** (`openspec/config.yaml`, `rules.design`).
`src/domain/tags.ts` is pure string manipulation — no SQLite, no transformers.js, no filesystem, no I/O
of any kind, and no import beyond the standard library. It is domain logic consumed across layers in
the established direction: `src/application/search-documents.ts` → `../domain/tags.js`, exactly as it
already imports `../domain/excerpt.js`, `../domain/fusion.js` and `../domain/match-location.js`. It is
not an adapter, so `ports.ts` is not involved; adding a port for a pure function would be the
violation, not the fix.

**Why a new module rather than exporting from `frontmatter.ts`.** `frontmatter.ts` is about parsing a
document's YAML frontmatter; `resolveTags` takes `Record<string, unknown>` and does shape validation.
Importing it from the search use case would read as "search parses frontmatter", which it does not, and
would attach a query-time dependency to an indexing-time module. A single small pure module per concept
is this project's established shape — `tokens.ts` is one 3-line function in its own file, and
`similarity.ts`, `flatten-map.ts` and `outline.ts` follow the same pattern.

**Rejected — `normalizeTag` (scalar) exported alongside the list form.** Nothing needs it. New exported
domain surface has to be justified and tested one function at a time (the lesson the sibling change
recorded about `isFenceDelimiter`); the scalar can be added the day something calls it.

**Rejected — a single `normalizeFilters(query): SearchFilters` in the domain.** Attractive for
testability, but `SearchQuery` is defined in `src/application/`, so the domain would have to import an
application type (a hexagonal inversion) or `SearchQuery` would have to move. Both cost more than the
integration tests already cover.

**Explicitly not touched: `collectFacets`' `tag.toLowerCase()` (`search-diagnostics.ts:23`) and
`explainEmptyResult`'s (`:136`).** They read *stored* values, which `resolveTags` already canonicalized,
so both are pre-existing no-ops with no observable behaviour either way. Routing them through
`normalizeTags` would be fork B wearing a different hat: making the domain defensive against a corpus
production cannot persist.

### Decision 4: two comments, two jobs — input policy on `SearchQuery`, invariant on `SearchFilters`

**Choice.** The proposal asked for the `SearchFilters` comment to be promoted from a field line to the
interface. Do that, **and fix the identical shape at `SearchQuery`** (findings table), because that is
the interface a caller and a future maintainer actually read first.

`src/domain/model.ts`:

```ts
/**
 * Filters applied to a search, after normalization: every value present here
 * is one the caller meaningfully asked for.
 *
 * The three caller-supplied fields carry an obligation on whoever constructs
 * this object. `type` and `module` MUST be trimmed, and omitted entirely —
 * never set to `""` — when the result is blank. `tags` MUST be passed through
 * `normalizeTags` (`domain/tags.ts`), the same canonical form the indexer
 * stores them in. A blank value is a client mistake, never a request to match
 * the empty string, and it is dropped silently.
 *
 * `SearchDocuments.buildFilters` is the only producer in production code and
 * the only place the rule is enforced. Consumers — `IndexStore.searchLexical`
 * and `searchVector`, `buildFilterSql`, `dropImpossibleFilters`,
 * `explainEmptyResult` — trust it and deliberately do not re-check. A new
 * producer inherits the obligation, not the enforcement.
 *
 * `excludedStatuses` is exempt: it comes from the project's config, not from
 * the request.
 */
export interface SearchFilters {
  /** Open string, project-defined; matched verbatim and case-sensitively. */
  type?: string;
  /** Open string, project-defined; matched verbatim and case-sensitively — never lowercased. */
  module?: string;
  /** Canonical tag values (trimmed, lowercased); an empty array means no tag filter. */
  tags?: string[];
  /** Deny-list: documents whose status is in this list are excluded; NULL status is never excluded. */
  excludedStatuses?: string[];
}
```

`src/application/search-documents.ts`:

```ts
export interface SearchQuery {
  query: string;
  /**
   * `type`, `module` and `tags` are open strings, project-defined. A blank
   * value — empty or whitespace-only, and per-entry for `tags` — is treated as
   * absent: the filter is not applied, and nothing is reported about it. `type`
   * and `module` match verbatim and case-sensitively; `tags` match in canonical
   * form (see `normalizeTags`).
   */
  type?: string;
  module?: string;
  tags?: string[];
  …
}
```

**Why two statements are not a violation of "one statement of the rule."** They state different
propositions. `SearchQuery` is the caller-facing *policy*: what you may send and what compendio will do
with it. `SearchFilters` is the internal *invariant plus the producer's obligation*: what is guaranteed
true of a value that reaches a consumer. The thing the proposal forbids duplicating is the
*enforcement*, and there is exactly one of those (Decision 1). The comment on `SearchQuery` also closes
the root cause in the place it would otherwise survive — a field-scoped note on `type` with two bare
siblings underneath, one file away from the bug.

### Decision 5: `parseType`'s trim stays; `src/cli.ts` is byte-unchanged

**Choice.** Confirmed, overturning nothing — but the proposal's reason ("it would touch a
separately-tested CLI helper for no behavioural gain") does not survive the strongest objection, so
here is one that does.

**The objection worth answering.** After this change, `type` is trimmed at the CLI *and* at
`buildFilters` while `module` is trimmed only at `buildFilters`. That is an asymmetry — arguably the
same *shape* of asymmetry the change exists to delete, merely relocated.

**Why it is not.** The failure mode being fixed is two **partial, disagreeing** statements of one rule:
the write side did `trim().toLowerCase()`, the read side did `toLowerCase()`, and the gap between them
was a guaranteed miss. `parseType` and `buildFilters` state the **identical, idempotent** rule:
`trim(trim(x)) === trim(x)` for every input, so they cannot disagree for any value, ever. A duplicated
idempotent normalization is inert; a duplicated partial one is the bug. That distinction is the
principle, and it also explains why *adding* zod trims for `module`/`tags` was still correctly
rejected: a second enforcement point is one more thing to keep in step, and its value is zero when the
chokepoint is complete.

Two supporting costs of removal, neither load-bearing on its own: `parseType` is exported with a
docstring recording *why* `--type` is unvalidated (open, project-defined), so deleting the trim leaves
an identity passthrough and deleting the function loses the record; and `test/cli.test.ts` tests it
directly, so removal edits an existing test file against Gate 5's additions-only rule.

`src/cli.ts` therefore stays **byte-unchanged**, which keeps it usable as a tripwire: an edit there
means the one-chokepoint decision was reversed without saying so. The explanation lands in `CLAUDE.md`
instead, where the next reader who notices the double trim will look.

### Decision 6: both false-green hazards become executable, not checklist items

**Choice.** The proposal names two ways this change's verification can pass for the wrong reason and
mitigates both with prose ("STOP condition", "check `facets.modules` is non-empty"). Prose has a
recorded failure rate in this repository. Both become assertions.

**Hazard 1 — Gate 1 seeded against a module-less corpus** passes green before the fix, because
`dropImpossibleFilters` drops the filter, and "proves" there is no bug. The precondition
(`facets.modules` non-empty) is a one-line assertion using a function the test can already import:

```ts
// Precondition, not decoration: with no declared module this test silently
// measures case B, where dropImpossibleFilters fires and the "before" run is
// green for the wrong reason.
expect(collectFacets(store.listDocuments()).modules).not.toEqual([]);
```

Its mirror belongs in the Gate 3 (case B) test: `expect(collectFacets(store.listDocuments()).modules)
.toEqual([])`. Each test then pins the corpus shape its own conclusion depends on, and a later edit to
the seed data fails on the precondition line with an obvious message instead of quietly changing which
case is under test.

**Hazard 2 — a dirty seeded tag** (findings table). `seedDoc` bypasses `resolveTags` entirely, so a
test *can* create a corpus production cannot produce, and doing so inverts Gate 2's signal in both
directions. The seam is made incapable of it:

```ts
function seedDoc(
  store: SqliteIndexStore,
  overrides: {
    path: string;
    type?: string;
    module?: string;
    status?: string;
    tags?: string[];
    content: string;
  },
): void {
  const tags = overrides.tags ?? [];
  // saveDocument persists meta.tags verbatim (JSON.stringify) — resolveTags
  // never runs in this seam. A non-canonical seed builds a corpus the indexer
  // cannot produce and makes the tags gates green before the fix and red
  // after it. Fail loudly at the seed instead.
  if (normalizeTags(tags).join(" ") !== tags.join(" ")) {
    throw new Error(`seedDoc: tags must already be canonical, got ${JSON.stringify(tags)}`);
  }
  const meta = {
    path: overrides.path,
    title: overrides.path,
    summary: "r",
    tags,
    hash: overrides.path,
    ...(overrides.type !== undefined ? { type: overrides.type } : {}),
    ...(overrides.module !== undefined ? { module: overrides.module } : {}),
    ...(overrides.status !== undefined ? { status: overrides.status } : {}),
  };
  store.saveDocument(meta, [{ heading: "H", content: overrides.content, position: 0 }]);
}
```

**Backward compatibility of the seam is by construction**: `tags` defaults to `[]` (today's hardcoded
value) and `module` follows the existing conditional-spread idiom, so all existing call sites behave
identically. Widening a helper's parameter object is not modifying an assertion — Gate 5's
additions-only rule is satisfied, and this is recorded here so `sdd-verify` does not read the helper
diff as a violation.

**Is a defensive guard in the test seam inconsistent with rejecting fork B?** No, and the contrast is
the principle: defence belongs where the mistake is reachable. Fork B defends production code against
an input its production caller cannot produce. This guard defends against an input a test author can
and — per the proposal's own risk table, rated **High** — plausibly will produce.

**Rejected — having `seedDoc` silently normalize the tags it is given.** Smaller, and it hides the
mistake instead of reporting it: the test would pass for a reason its author did not intend, which is
the class of outcome this project keeps getting burned by.

### Decision 7: normalize first, then test for emptiness — the wrong version is invisible

**Choice.**

```ts
const tags = query.tags === undefined ? [] : normalizeTags(query.tags);
if (tags.length > 0) filters.tags = tags;
```

**The plausible-looking wrong implementation** keeps today's guard and normalizes inside it:

```ts
if (query.tags !== undefined && query.tags.length > 0) {
  filters.tags = normalizeTags(query.tags);   // can assign []
}
```

For `tags: ["  "]` this sets `filters.tags = []` instead of omitting the key. **That is behaviourally
inert** — all four downstream guards (`buildFilterSql:527`, `dropImpossibleFilters:65`,
`explainEmptyResult:129`, `hasAnyFilter:170`) test `length > 0`, so no response field differs and
**no gate in this change can distinguish the two versions**. It is recorded here because that is the
only defence available: correctness by construction and by review, not by test. The version above makes
"absent" literally true rather than merely indistinguishable, which is what the spec delta says and
what a future guard-less consumer would depend on.

Resulting `buildFilters`, in full:

```ts
private buildFilters(query: SearchQuery): SearchFilters {
  const filters: SearchFilters = {};
  const type = query.type?.trim();
  if (type !== undefined && type.length > 0) filters.type = type;
  const module = query.module?.trim();
  if (module !== undefined && module.length > 0) filters.module = module;
  const tags = query.tags === undefined ? [] : normalizeTags(query.tags);
  if (tags.length > 0) filters.tags = tags;
  if (query.includeExcluded !== true && this.defaults.excludedStatuses.length > 0) {
    filters.excludedStatuses = this.defaults.excludedStatuses;
  }
  return filters;
}
```

## File Changes

| File | Action | Description |
|---|---|---|
| `src/domain/tags.ts` | **Add** | `normalizeTags` — the canonical form of a tag, pure, ~12 lines with its docstring (Decision 3) |
| `src/domain/frontmatter.ts` | Modify | `resolveTags` delegates to `normalizeTags`. **No behaviour change** — `test/domain/frontmatter.test.ts` passes unmodified, which is the falsifier. The proposal's "`indexing` — no delta, asserted" therefore still holds: a spec delta describes behaviour, and none moves |
| `src/application/search-documents.ts` | Modify | `buildFilters`: `module` trimmed, `tags` normalized (Decisions 2, 3, 7). `SearchQuery`'s field comments promoted (Decision 4) |
| `src/domain/model.ts` | Modify | `SearchFilters`' contract promoted to the interface; per-field lines restated (Decision 4) |
| `src/domain/search-diagnostics.ts` | **Unchanged — asserted** | Fork B rejected (Decision 1). `collectFacets`/`explainEmptyResult`'s `toLowerCase()` calls stay as they are (Decision 3) |
| `src/server.ts` | **Unchanged — asserted** | No zod `.trim()`/`.min(1)`. An edit here reverses the one-chokepoint decision |
| `src/cli.ts` | **Unchanged — asserted, byte for byte** | `parseType` keeps its trim (Decision 5); `--module`/`--tags` gain no parsing |
| `src/infrastructure/sqlite/sqlite-index-store.ts` | **Unchanged — asserted** | `buildFilterSql` was always correct for the filters it was handed |
| `test/domain/tags.test.ts` | **Add** | Direct unit coverage of the new exported domain surface: trim, lowercase, drop-empties, mixed array, all-empty array, empty input, already-canonical input unchanged (idempotence) |
| `test/domain/frontmatter.test.ts` | **Unchanged — asserted** | The regression guard for the `resolveTags` refactor |
| `test/application/index-and-search.test.ts` | Extend | `seedDoc` widened + canonical-tags guard (Decision 6); Gates 1–4 as sibling `it`s. Existing assertions untouched |
| `test/domain/search-diagnostics.test.ts` | **Unchanged — asserted** | Would only move under fork B |
| `openspec/specs/search/spec.md` | Modify | Owned by `sdd-spec`, in progress in parallel |
| `CLAUDE.md` | Modify | One entry in *Non-obvious decisions*: caller-supplied filter strings are normalized once, at `buildFilters`; blank means absent for all three and is silent; `tags` share `normalizeTags` with the indexer so the two sides cannot drift; the diagnostics functions are deliberately **not** defensive (with the mis-sited reason, so fork B is not re-proposed); `parseType`'s trim is redundant-but-idempotent and deliberately kept |

**Forecast**, on the proposal's own drivers plus the two this design adds
(`src/domain/tags.ts` + its test, `SearchQuery`'s comment, the `seedDoc` guard): **~265–330 lines**,
inside fork A's stated realistic ceiling of ~320 and well inside a 400-line budget. **One PR.** If it
overruns, the proposal's cut stands and is unaffected by anything here: `module` first, `tags` second —
they are independent normalizations with independent gates, and only the `tags` half depends on
`src/domain/tags.ts`.

## Testing Strategy

`strict_tdd: true`. Every gate is written first and **observed failing against the current tree**, with
the "before" string recorded verbatim in the verify report.

| Layer | What | Approach |
|---|---|---|
| Unit | `normalizeTags` | `test/domain/tags.test.ts`, pure inputs, no store |
| Unit | `resolveTags` unchanged after delegation | `test/domain/frontmatter.test.ts`, **run unmodified** |
| Integration | Gates 1–4 | `test/application/index-and-search.test.ts`, `SqliteIndexStore(":memory:")` + `new SearchDocuments(store, null, …)` — lexical mode, **no model download** |

### Gate mapping

| Gate | Decision under test | Falsifier / STOP condition |
|---|---|---|
| 1 — case A reproduced, then closed | 1, 2 | Before: `module: ""` and `module: "   "` each return `results: []` with `noMatchReason` containing `no document has module ""`. After: **the whole `SearchResponse` deep-equals the module-omitted call**. **STOP** if the precondition assertion (`collectFacets(store.listDocuments()).modules` non-empty) does not hold — the test is measuring case B |
| 2 — case C: an untrimmed tag reaches its stored form | 3, 7 | Corpus seeded `tags: ["api"]` — **canonical, enforced by the seam**. Before: `tags: [" api"]` → `[]` + `no document carries " api"` listing `"api"` as declared. After: same set as `tags: ["api"]`. Plus the mixed case `["api", "  "]` (the one a wrong implementation gets wrong) and `tags: [""]` — the CLI's `--tags ""` shape, one extra line (findings table) |
| 3 — case B: no config advice from a blank filter | 1 | Corpus with **no** declared module, pinned by `collectFacets(...).modules` deep-equalling `[]`. Before: `filterWarning` naming `convention.frontmatterFields`. After: no `filterWarning`, response equals the module-omitted call. This gate is what fails loudly if the fix is placed downstream of `buildFilters` |
| 4 — nothing legitimate was widened | 2 | `module: "identity"` still filters; `module: " identity "` now resolves to the same set; against a corpus declaring `Identity`, a query for `identity` **still returns nothing** (proves no lowercasing snuck in); a declared-field/unknown-value filter still produces its `noMatchReason`; `tags: []` behaves exactly as today; `index-and-search.test.ts:546` (`treats an empty or whitespace-only type as absent`) passes **unmodified** |
| 5 — nothing else moved | — | `npm test`, `npm run typecheck`, `npm run build`. `frontmatter.test.ts`, `search-diagnostics.test.ts`, `cli.test.ts` unmodified and passing. `compendio eval` structurally untouched by reasoning (`EvaluateSearch` passes no `type`/`module`/`tags`, so `buildFilters` yields `{}` before and after); if run anyway, MRR ≥ 0.943 / recall@5 = 1.00 / top-1 ≥ 20/22 |
| — | 7 | **No gate exists.** The `filters.tags = []` variant is behaviourally identical (Decision 7). Correctness by construction and review |

### Two assertion-shape notes

**Deep-equal the whole `SearchResponse`, not just the paths.** Gate 1's and Gate 3's real claim is
*"once the filter is absent, the two calls are the same call"*, and lexical-only search over an
in-memory store is deterministic (BM25 ordering, fixed RRF constants, no embeddings), so
`expect(blank).toEqual(omitted)` is available, is the literal statement of the claim, and subsumes the
separate "`noMatchReason` absent" and "`filterWarning` absent" bullets. Fall back to comparing
`results.map(r => r.path)` only if a real ordering instability is observed — and record it if so.

**Never assert on "non-empty".** A blank-filter call that returns *something* proves nothing; the
pre-fix behaviour on a two-document corpus can also return something the moment another filter changes.
Set equality against the omitted-filter call is the assertion.

## Migration / Rollout

None, and the claim is structural rather than assessed: the change is query-time only. No schema, no
DDL, no config key, no port signature, no persisted-shape or path/ID change, so nothing written under
the old behaviour can be misread under the new one and nothing written under the new behaviour can be
misread after a revert. `ejemplos/goldenset.yaml` and `compendio eval` are untouched by construction.
Rollback is `git revert` + `npm run build`; the only residue is immediate and behavioural — a client
sending `module: ""` goes back to an empty result with a misleading explanation.

Unlike `2026-08-14-config-value-validation`, **there is no "the fix has not reached your corpus" state**:
nothing about this change depends on stored chunk boundaries or stored metadata, so it takes effect on
the next call and un-takes effect on the next call after a revert. No `compendio index` is required.

## Open Questions

1. **`src/domain/tags.ts` and the `resolveTags` delegation are a scope addition** beyond the proposal's
   Affected Areas, which listed neither (Decision 3). Behaviour-preserving on the write side, with
   `frontmatter.test.ts` unmodified as the falsifier. **Cheap reversal if `sdd-tasks` or the user judges
   it over-built**: inline `values.map(e => e.trim().toLowerCase()).filter(e => e.length > 0)` in
   `buildFilters`, delete the module and `test/domain/tags.test.ts`, leave `frontmatter.ts` alone —
   roughly 50 fewer lines, no behaviour change, and the drift risk that caused this bug comes back.
   Nothing else in the design moves.
2. **`SearchQuery`'s comment asymmetry is a new finding**, not something the proposal scoped
   (Decision 4). It costs ~6 lines in a file the change already edits and closes the root cause where it
   would otherwise survive. Drop it only deliberately.
3. **The `seedDoc` canonical-tags throw** (Decision 6) is a test-helper guard, not production code.
   `sdd-tasks` may downgrade it to a comment; the design's position is that a comment is the mitigation
   this repository has repeatedly watched fail, and four lines is the price of it failing loudly instead.
4. **Nothing here depends on the proposal's open questions.** Q1 and Q2 are settled by the user
   (normalize silently, no third `filterWarning` variant) and this design implements exactly that. Q3 is
   answered by Gate 3 remaining blocking and the change not widening. Q4 is answered by Decision 5, with
   a stronger reason than the proposal's.
