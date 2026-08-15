# Proposal: Filter Input Hygiene — extend `type`'s trim/empty rule to `module` and `tags`

`SearchDocuments.buildFilters` (`src/application/search-documents.ts:131-143`) trims `type` and drops
it when empty. It copies `module` **verbatim** and lowercases `tags` **without trimming**. The
interface those three fields belong to already states the rule they are supposed to follow —
`SearchFilters` (`src/domain/model.ts:48-55`) carries the comment *"empty/whitespace treated as absent
by callers"* — and one field out of three honours it.

The consequence is not cosmetic. A `module: ""` arriving from an MCP client reaches SQL as
`d.module = ''`, matches nothing, and comes back explained as `no document has module "" (declared:
…)` — the project's anti-silence machinery reporting a deliberate, checkable request that the caller
never meaningfully made.

**This is one of three changes split from the same exploration**
(`openspec/changes/archive/2026-08-15-code-review-findings-1.3-1.5/exploration.md`, finding 1.3). The siblings
are `read-doc-fence-aware-sections` (1.4) and `overview-counter-safety` (1.5), proposed in parallel.
They share an origin document and nothing else — different spec capabilities, different files, zero
shared code. They are not to be bundled.

## Intent

### The strongest argument is internal precedent, not robustness

`resolveTags` (`src/domain/frontmatter.ts:29-36`) — the function that normalizes a document's own
declared tags at **indexing** time — already does exactly what this change proposes, verbatim:

```typescript
return { tags: raw.map((e) => e.trim().toLowerCase()).filter((e) => e.length > 0) };
```

So the write side trims, lowercases and drops empties. The read side lowercases and stops. This is
not a new pattern being introduced into the codebase; it is **the project's own normalization,
present on one side of the comparison and missing on the other**. Every stored tag is trimmed; no
queried tag is. The two sides are compared with `je.value IN (?)` — exact string equality — so the
asymmetry is not a stylistic inconsistency, it is a guaranteed miss.

The same argument in one line: `type`'s handling in `buildFilters` is the precedent for `module`, and
`resolveTags` is the precedent for `tags`. Both precedents are in this repository already. The change
applies them; it invents nothing.

### What an agent experiences today — the exact strings

Three concrete outcomes, each traced through the real code path.

**Case A — `module: ""` against a corpus that declares modules** (the common case: under the default
`loose` mode, `inferModule` gives a module to every document not at its root's top level, so
`facets.modules` is almost never empty):

| Step | What happens |
|---|---|
| `buildFilters` | `{ module: "" }` — copied through, no check |
| first `runSearch` | `d.module = ''` (`sqlite-index-store.ts:516-518`) → **0 rows** |
| `dropImpossibleFilters` | **keeps it** — it only drops when `facets.modules.length === 0`, which is false here |
| `explainEmptyResult` | `no document has module "" (declared: "leadsviewer", "identity").` |

The agent is handed an empty result and told, with authority, that no document has module `""` —
alongside a list of the values that do exist, as if it had asked a real question with a wrong answer.

**Case B — `module: ""` against a corpus that declares *no* modules.** Here
`dropImpossibleFilters` does fire, and the result is worse in a different way: the caller gets
correct (unfiltered) results plus this `filterWarning`:

> Ignored the module filter: no document in this project declares that field, so it could never
> match. Results below are unfiltered. If you expected module to work, the project needs
> convention.frontmatterFields to map its frontmatter keys.

An empty string triggers a recommendation to change the project's configuration. **This case is not
in the exploration**; it was found while verifying case A, and it is the sharper of the two, because
the advice is confidently wrong rather than merely unhelpful.

**Case C — `tags: [" api"]` against a corpus whose documents declare `api`:**

> no document carries " api" (declared: "api", "leads").

The declared list contains the value the caller asked for, spelled identically apart from the space,
and the message asserts nothing carries it. `collectFacets` lowercases but does not trim
(`search-diagnostics.ts:23`) — it does not need to, because `resolveTags` already trimmed everything
it reads. Only the query side is dirty.

**After the fix**, all three become the same thing: the filter is absent, the search runs unfiltered,
and there is no `noMatchReason` and no `filterWarning` — because an unfiltered miss is deliberately
left unexplained (`explainEmptyResult` returns `undefined` when `hasAnyFilter` is false), and there is
no longer a filter to warn about.

### This is the failure mode the project built machinery to eliminate, reached through a different door

`CLAUDE.md` records why `dropImpossibleFilters` exists at all:

> Prose could not stop this — parameter descriptions saying "never infer it from directory names"
> were observed being ignored three times in one session, with the agent escalating `k` from 5 to 10
> rather than dropping the filter `noMatchReason` told it to drop. So the mechanism changed instead.

That mechanism has one gate: *does any document declare this field?* It was built against an agent
inventing a **value** for a field the project does not use. It has no defence against an agent — or a
client library — sending a **blank** value for a field the project does use, because the field is
declared, so the filter looks answerable. The escalation loop the mechanism exists to break (`k` 5 →
10 → 20, never dropping the filter) is fully reachable through case A, and the loud fallback stays
silent throughout it.

There is a secondary cost worth one line: every such call runs the search **twice** and does a full
`listDocuments()` facet scan in between, guaranteed, for a filter that was never meaningfully set.

### Reachability: no adapter guard exists, and the gap is MCP-shaped

| Boundary | `type` | `module` | `tags` |
|---|---|---|---|
| MCP (`server.ts:131-140`) | `z.string().optional()` | `z.string().optional()` — no `.min(1)`, no `.trim()` | `z.array(z.string()).optional()` — no per-entry constraint |
| CLI (`cli.ts:183-206`) | `parseType` → `value.trim()` (`cli.ts:298`) | **nothing** | `split(",").map(e => e.trim())` |
| `buildFilters` | trim + empty check | **nothing** | lowercase only |

Two things fall out. First, `type` is defended twice and `module` zero times. Second, the CLI already
trims `--tags` at its own boundary, so **the untrimmed-tag path is reachable only over MCP** — which
is the primary calling path for this server, and the one whose callers are agents and client
libraries rather than humans. A client that serializes unset optional fields as `""` (a real client
behaviour class, not a hypothetical) hits case A on every single call.

### Why now

The change is small, the mechanism it repairs is recent and load-bearing, and the review pass that
found it is fresh. More pointedly: `buildFilters` is **the only producer of `SearchFilters` in
production code** (verified — every other reference in `src/` is a consumer or a type import). That
makes it a genuine chokepoint today, and the cheapest moment to install the rule is while it still
has exactly one entrance.

## Scope

### In Scope

- **Normalize `module` in `buildFilters`** exactly as `type` is normalized: trim; if the result is
  empty, the filter is absent (the key is not set at all, not set to `""`).
- **Trim each `tags` entry and drop the empties**, joining the existing lowercasing — the
  `resolveTags` expression, applied on the read side.
- **Move `SearchFilters`' contract comment** from the `type` field's own doc line to the interface,
  where it already claims to be an interface-wide rule. The comment's placement is the likely root
  cause of the asymmetry: it reads as a note about one field, so it was implemented once. Rewriting
  it as a statement about `type`, `module` and `tags` is the cheapest guard against the next field
  repeating the pattern.
- **Spec delta on `search`** — extend the existing empty-is-absent rule to its siblings. See
  Capabilities.
- **The domain-layer defence-in-depth question** — presented below, explicitly left to `sdd-design`.

### Out of Scope

| Item | Why |
|---|---|
| **`read-doc-fence-aware-sections` (finding 1.4) and `overview-counter-safety` (finding 1.5)** | Separate changes, proposed in parallel from the same exploration. Different spec capabilities (`mcp-contract` vs `search`), different files, no shared code or tests. The exploration's scoping table calls 1.3-vs-the-others "not a close call" |
| **Any change to MCP tool parameter or response shape** | `search_docs({ query, type?, module?, tags?, k?, include_excluded? })` is unchanged, pinned by `mcp-contract/spec.md:178`. This change alters how a value is interpreted, never which values exist |
| **Adding `.trim()`/`.min(1)` to the zod schemas in `server.ts`** | A second place to state one rule. `buildFilters` is the single chokepoint every adapter already funnels through; duplicating the policy at the adapter is how the two halves drift apart later. Rejected on the record so it is not re-proposed as "defence in depth" |
| **Lowercasing `module` (or `type`)** | `tags` are lowercased on the write side by `resolveTags`, so lowercasing on the read side restores symmetry. `module`/`type` are stored verbatim, so lowercasing them would be a *new* matching semantics, not hygiene — and would silently break a project whose modules are capitalized. Trim only |
| **Trimming or validating `k`, `include_excluded`, or `convention.excludedStatuses`** | `k` was covered by `2026-08-14-config-value-validation`; `excludedStatuses` comes from config, not from the caller. This change is about caller-supplied filter strings |
| **Making `dropImpossibleFilters` drop a filter that matches nothing** (as opposed to one whose *field* nothing declares) | Deliberate existing behaviour, documented in `search-diagnostics.ts:33-48`: a filter on a declared field with an unknown value is an answerable request and the caller gets the real values back. Widening it would delete the distinction this project chose |
| **Migrations, schema markers, compatibility shims** | Beta, no installed users (`openspec/config.yaml`, `rules.proposal`). Also structurally inapplicable: this is a query-time change with no persisted state |

## Two questions the proposal answers, so the spec delta does not over-reach

### `tags: []` (an empty array) needs nothing — confirmed

Traced through every consumer. An empty `tags` array is already inert at four independent points,
each guarding on `length > 0`:

| Site | Guard |
|---|---|
| `buildFilters` (`search-documents.ts:136`) | `query.tags.length > 0` — `filters.tags` is never even set |
| `buildFilterSql` (`sqlite-index-store.ts:527`) | `filters.tags.length > 0` |
| `dropImpossibleFilters` (`search-diagnostics.ts:65`) | `kept.tags.length > 0` |
| `explainEmptyResult` / `hasAnyFilter` (`:129`, `:170`) | `tags.length > 0` |

`tags: []` is therefore indistinguishable from absent today, and stays so after the fix. **The spec
delta must not add a scenario for it** — a scenario pinning behaviour that no code branch can
distinguish is a scenario that can never fail. Recorded here so it is not added out of symmetry.

### A tags array that becomes empty *after* trimming — a real semantic fork, and it resolves itself

`tags: ["  "]` is genuinely ambiguous: is it "no tag filter" (absent), or "a filter matching nothing"
(empty result with a reason)?

**Recommendation: absent**, and the reason is that it is not actually a separate decision. The rule
being adopted is one rule — *drop empty entries after trimming* — and it is obviously correct for the
mixed case: `tags: ["api", "  "]` must filter by `api`, not fail. Apply that same rule to
`tags: ["  "]` and the array becomes `[]`, which the table above shows is already absent. Treating
the all-empty case as "matches nothing" would require a **special case** — a branch distinguishing
"became empty" from "was empty" — to produce an outcome nobody asked for.

It also keeps `type: "  "`, `module: "  "` and `tags: ["  "]` behaving identically, which is the point
of the change.

`sdd-spec` should pin the mixed case (`["api", "  "]` → filters by `api`) as the load-bearing
scenario, with the all-empty case as its corollary. That ordering matters: the mixed case is the one
a wrong implementation actually gets wrong.

## The design fork — left open for `sdd-design`

**Where does normalization live?**

**A. `buildFilters` only** (recommended). Matches how `type` is handled today, exactly. `buildFilters`
is the sole producer of `SearchFilters` in production code, so a chokepoint fix is complete by
construction. Smallest diff, one place to state the rule, and consistent with the precedent the change
is built on.

**B. `buildFilters` plus defensive trimming inside `dropImpossibleFilters` / `explainEmptyResult`.**
Those are exported domain functions with their own direct unit tests
(`test/domain/search-diagnostics.test.ts`), so they are callable by anything, and defence in depth is
not unreasonable. Costs: a larger diff, the rule stated in three places instead of one, and — the real
objection — it makes the domain layer defensive against an input its only production caller cannot
produce, which reads as distrust rather than as design.

**Recommendation: A**, per the exploration's reasoning and the `type` precedent. `sdd-design` owns the
call and should record the rejected option either way, because "why isn't the domain layer defensive?"
is a question a future reviewer will ask.

One constraint the fork must respect whichever way it goes: **the rule is stated once in the type
system's documentation** (`SearchFilters`' comment), regardless of how many places enforce it. Under
B, the comment must say which layers enforce it, or the next reader cannot tell which is authoritative.

## Capabilities

### New Capabilities

- None. This extends an already-specified rule from one field to its two siblings.

### Modified Capabilities

- **`search`** — the existing *Open `type` Filtering* requirement already carries the scenario *Empty
  or whitespace-only type is treated as absent* (`openspec/specs/search/spec.md:15-19`), verified
  present. There is **no equivalent for `module` or `tags` anywhere in the file** — in fact `module`
  and `tags` filtering have no requirement of their own at all, which is why this is an addition
  rather than an edit. The delta states the empty-is-absent rule for all three filter inputs, plus
  the entry-level tags scenario (mixed array) described above.
- **`mcp-contract`** — **no delta, asserted.** *Renamed MCP Tool Signatures And Response Field Names*
  (`spec.md:178`) fixes the parameter set; the parameter set does not move. A `mcp-contract` delta
  appearing in `sdd-spec`'s output means the scope moved into the tool shape.
- **`indexing`** — **no delta, asserted.** `resolveTags`' write-side behaviour is the precedent this
  change follows; it is not modified by it.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/application/search-documents.ts:131-143` | Modified | `buildFilters` trims `module` and drops it when empty; trims each `tags` entry and drops empties alongside the existing lowercasing |
| `src/domain/model.ts:48-55` | Modified | `SearchFilters`' empty-is-absent comment promoted from a `type`-only doc line to the interface contract |
| `src/domain/search-diagnostics.ts` | Modified **only under fork B** | Defensive trimming. Untouched under A |
| `src/server.ts`, `src/cli.ts` | **Unchanged — asserted** | No zod refinement, no new CLI parsing. An edit here means the "one chokepoint" decision was reversed without saying so |
| `src/infrastructure/sqlite/sqlite-index-store.ts` | **Unchanged — asserted** | `buildFilterSql` was always correct for the filters it was handed |
| `test/application/index-and-search.test.ts:534-556` | Extended | Sibling `it`s under the existing `describe("SearchDocuments — open type filtering")` (or a renamed sibling `describe`), following the `type` case's assertion shape: unfiltered result set. Plus the case-A/case-B regression tests |
| `test/domain/search-diagnostics.test.ts` | Extended **only under fork B** | Direct unit coverage of the defensive path |
| `openspec/specs/search/spec.md` | Modified | Requirement + scenarios for `module`/`tags` empty-is-absent |
| `CLAUDE.md` | Modified | One line in *Non-obvious decisions*: caller-supplied filter strings are trimmed at `buildFilters`, empty means absent for all three, and `tags` entries additionally follow `resolveTags`' write-side normalization |

## Success Criteria

Each gate can **fail and stop the change**. This project gates on *falsification*, not on a tolerance
band. `strict_tdd: true` applies: every gate is written first and **observed failing** against the
current tree before any fix lands. A gate that passes on the unfixed tree is not measuring what it
claims — and in this change that is a live hazard, because a carelessly-seeded corpus makes the
"before" case pass for the wrong reason.

### Gate 1 — Case A is reproduced, then closed (BLOCKING)

A corpus in which **at least one document declares a `module`** (so `facets.modules` is non-empty and
`dropImpossibleFilters` cannot fire), queried with `module: ""` and again with `module: "   "`:

- [ ] **Before the fix**: both calls return `results: []` and a `noMatchReason` containing
      `no document has module ""`. Recorded verbatim in the verify report.
- [ ] **After the fix**: both calls return the **same result set as the identical call with `module`
      omitted entirely** — and `noMatchReason` and `filterWarning` are both absent.

Set equality against the omitted-filter call is the correct assertion, not "non-empty": once the
filter is absent, the two calls are the same call.

**STOP condition.** A "before" run that does *not* produce that string means the corpus was seeded
without modules and the test is measuring case B instead. Check `facets.modules` is non-empty before
trusting a red.

### Gate 2 — Case C: an untrimmed tag matches its trimmed stored form (BLOCKING)

A corpus with a document declaring `tags: ["api"]`:

- [ ] **Before**: `tags: [" api"]` returns `[]` with `noMatchReason` containing
      `no document carries " api"` and listing `"api"` among the declared values.
- [ ] **After**: `tags: [" api"]` returns that document, identically to `tags: ["api"]`.
- [ ] `tags: ["api", "  "]` returns the same set as `tags: ["api"]` — the mixed case, which is the one
      a wrong implementation gets wrong.

### Gate 3 — Case B: no config advice from a blank filter (BLOCKING)

A corpus in which **no document declares a `module`** (every document at its root's top level):

- [ ] **Before**: `module: ""` produces a `filterWarning` naming `convention.frontmatterFields`.
- [ ] **After**: no `filterWarning`, and the result set equals the module-omitted call.

This gate exists because it is the only one that fails loudly if the fix is placed *downstream* of
`buildFilters` in a way that normalizes the diagnostic path but not the filter itself.

### Gate 4 — Nothing legitimate was widened (BLOCKING)

The gate against an over-eager normalizer, which is the realistic way this change causes a regression.

- [ ] `module: "identity"` still filters to that module, and `module: " identity "` now resolves to
      the same set — trimmed, not ignored.
- [ ] **Case is preserved**: against a corpus declaring `module: "Identity"`, a query for
      `module: "identity"` still returns nothing. Lowercasing `module` is out of scope and this
      assertion is what proves it did not sneak in.
- [ ] A *declared field, unknown value* filter still produces its `noMatchReason`
      (`no document has module "nonexistent" (declared: …)`). The change removes blank filters, not
      the diagnostic for real ones.
- [ ] `tags: []` behaves exactly as it does today — indistinguishable from absent, no new branch.
- [ ] The existing test at `index-and-search.test.ts:546` (`treats an empty or whitespace-only type as
      absent`) passes **unmodified**.

### Gate 5 — Nothing else moved

- [ ] `npm test`, `npm run typecheck`, `npm run build` pass.
- [ ] No existing assertion in `test/application/index-and-search.test.ts` or
      `test/domain/search-diagnostics.test.ts` is modified — only added to. A modified expectation
      means filter semantics moved beyond blank-input handling.
- [ ] `compendio eval` on `ejemplos/` is **structurally untouched**, and this is asserted by reasoning
      rather than by a run: `EvaluateSearch` passes no `type`/`module`/`tags`, so `buildFilters`
      produces `{}` both before and after. If `sdd-verify` chooses to run it anyway, the bar is the
      recorded MRR ≥ 0.943 / recall@5 = 1.00 / top-1 ≥ 20/22. **No gate in this change requires a
      model download.**

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| **The change is judged trivial and ships without an observed red**, so nobody learns whether the reasoning about `dropImpossibleFilters` was right | **High** | Gates 1–3 each require the "before" string recorded verbatim. `strict_tdd: true` makes failing-first mandatory. This repository's recorded history is agents reporting green over defects |
| **Gate 1 is seeded against a module-less corpus** and passes green before the fix, "proving" there was no bug | **High** | Named in Gate 1's STOP condition with the exact precondition (`facets.modules` non-empty). This is the specific way the verification mechanism fails here, and this project has a recorded history of defects hiding inside verification mechanisms |
| **`module` gets lowercased** along with `tags`, because the two are normalized in adjacent lines and lowercasing "looks like normalization" | Med | Explicit non-goal with its reason (write-side asymmetry). Gate 4's case-preservation assertion fails if it happens |
| **The fix is duplicated into `server.ts`'s zod schema** as belt-and-braces, leaving two statements of one rule | Med | Out of Scope with its reason. `src/server.ts` asserted unchanged in Affected Areas |
| **The spec delta over-reaches**, adding a `tags: []` scenario no code branch can distinguish | Med | Answered above with the four-guard table; the delta is told what *not* to pin |
| **Scope creeps into "make `dropImpossibleFilters` smarter"** — it is the nearby mechanism and it looks under-powered from case A | Med | Out of Scope with the citation (`search-diagnostics.ts:33-48`): the declared-field/unknown-value distinction is deliberate |
| **A caller relying on `module: ""` to mean "match nothing"** loses that behaviour | Very low | Accepted, not mitigated. Nobody expresses "match nothing" that way, and beta with no installed users makes it a non-question |

## Rollback Plan

Included per `openspec/config.yaml` `rules.proposal`. **Assessed honestly: this change is not risky,
and a normal revert is the entire plan.** The ceremony below is three lines because there is nothing
else to say, not because the analysis was skipped.

1. Revert the change commits and `npm run build`.
2. **Nothing else.**

Why it is that cheap, stated so the claim is checkable rather than asserted:

- **The change is query-time only.** Nothing is written, so nothing persisted can be left in a shape
  reverted code misreads. Contrast `2026-08-14-config-value-validation`, whose fix could not reach an
  existing corpus without a full `compendio index` — that asymmetry does not exist here. The fix takes
  effect on the next call, and un-takes effect on the next call after a revert.
- **No schema, no DDL, no config key, no port change, no path/ID shape change.** `ejemplos/goldenset.yaml`
  and `compendio eval` are untouched by construction.
- **No public contract shape change**, so the beta/no-migrations clause is not even in play — there is
  nothing to migrate and nothing to shim.

The only residue after a revert is behavioural and immediate: a client sending `module: ""` goes back
to empty results with a misleading explanation. That is the pre-change state.

## Dependencies

- **Zero new npm dependencies.**
- **No new fixture corpus.** `test/application/index-and-search.test.ts`'s existing `seedDoc` helper
  (`:517-532`) covers Gates 1–4 — though note it currently seeds `type`/`status` only, so it needs a
  `module`/`tags` passthrough or a local variant. That is the one non-mechanical piece of test work in
  the change.
- **No model download required by any gate.** Every gate runs `new SearchDocuments(store, null, …)` in
  lexical mode, as the existing tests in that file already do.
- **No blocking dependency on the sibling changes.** `read-doc-fence-aware-sections` and
  `overview-counter-safety` touch no file this change touches; the three can land in any order.

## Delivery size — a decision for the `sdd-tasks` gate

| Driver | Fork A | Fork B |
|---|---|---|
| `search-documents.ts` — `buildFilters` normalization | 5–12 | 5–12 |
| `model.ts` — contract comment | 3–6 | 3–8 |
| `search-diagnostics.ts` — defensive trimming | 0 | 15–30 |
| `index-and-search.test.ts` — Gates 1–4 (+ `seedDoc` extension) | 90–160 | 90–160 |
| `search-diagnostics.test.ts` — direct unit coverage | 0 | 40–70 |
| `search` spec delta — requirement + scenarios | 30–60 | 30–60 |
| `CLAUDE.md` | 5–12 | 5–15 |
| **Total** | **135–250** | **185–355** |

Both forks clear a 400-line PR budget, so this is **one PR** under either.

**The caveat this repository has earned, stated rather than assumed away.** The exploration's floor for
this finding was ~20–40 changed lines; the table above is already 5× that, because the exploration's
number counted production code and this one counts the change. Beyond that, this repo's forecasts have
landed 1.3×–4× low for several cycles running (`bounded-chunk-size` 240–420 → 773; `match-centred-excerpt`
300–470 → ~1 521; `incremental-reindex` missed by 2×). Applying the low end of that pattern to fork A
puts a realistic ceiling near **~320 lines**, still inside budget. The mitigating difference is real but
should not be overweighted: the production surface here is genuinely one function, and the variance sits
in tests and spec prose — the more predictable half. If it overruns anyway, the natural cut is
**`module` first, `tags` second**; they are independent normalizations with independent gates.

## Resolved decisions

Recorded so later phases do not re-litigate them.

| Question | Decision |
|---|---|
| What gets normalized | **`module`: trim, empty → absent. `tags`: trim each entry, drop empties, keep the existing lowercasing.** Nothing else |
| Lowercasing `module`/`type` | **No.** Tags are lowercased on the write side by `resolveTags`, so read-side lowercasing restores symmetry; `module`/`type` are stored verbatim and lowercasing them is new semantics. Gate 4 asserts it |
| `tags: []` | **No change, and no spec scenario.** Four independent `length > 0` guards already make it indistinguishable from absent |
| `tags: ["  "]` (empty after trimming) | **Treated as absent** — a corollary of the one rule (drop empty entries), not a second decision. The mixed case `["api", "  "]` is the scenario that carries the rule |
| Adapter-level guards (`server.ts` zod, `cli.ts`) | **Not added.** One chokepoint, one statement of the rule. Asserted unchanged |
| `SearchFilters`' contract comment | **Promoted to the interface.** Its field-scoped placement is the likely root cause of the original asymmetry |
| Defensive trimming in `dropImpossibleFilters`/`explainEmptyResult` | **Open — the fork for `sdd-design`.** Recommendation is the narrow fix (A), with the rejected option recorded either way |
| Widening `dropImpossibleFilters` to drop filters that merely match nothing | **No.** The declared-field/unknown-value distinction is deliberate and documented |
| MCP tool shape | **Unchanged.** No param added, removed or retyped |
| Relationship to findings 1.4 / 1.5 | **Separate changes**, proposed in parallel from the same exploration. Not bundled |
| Migrations / schema markers / shims | **None.** Beta, no installed users — and structurally inapplicable to a query-time change |
| Rollback | **A normal revert, nothing more.** Assessed, not skipped |
| Artifact store | **openspec** (file-based). Engram MCP tools unavailable this cycle |
| Meaning of a blank filter | **Always a client/agent mistake → normalize to absent.** Confirmed by the user 2026-08-15; rejection-with-error was offered and declined. Settles Q1 |
| Announcing the normalization | **Silent, as `type` is today.** "Normalize + `filterWarning`" was offered and declined. No third warning variant. Settles Q2 |

## Proposal question round

**Q1 and Q2 are answered (2026-08-15, user). Q3 and Q4 stand on their assumptions.**

1. **Is a blank filter always a mistake, or is there a client you know of that means something by
   it?** ✅ **ANSWERED: always a client/agent mistake — normalize it, treat it as absent.** The
   assumption the whole change rests on is confirmed, explicitly and not by silence. Rejection
   (returning a validation error) was offered as an alternative and declined. `sdd-spec` and
   `sdd-design` may treat this as settled: the fix belongs in `buildFilters`, not in `server.ts`'s
   zod schema.

2. **When a caller sends a blank filter, should compendio silently ignore it or say it ignored it?**
   ✅ **ANSWERED: silently, matching `type` exactly.** A "normalize but emit a `filterWarning`"
   variant was offered as a third option and declined. Do **not** add a third `filterWarning`
   variant. The recorded counter-argument stands unaddressed by choice: an agent whose client has a
   blank-string bug will not be told. That is accepted — the alternative is noise on every search
   carrying a blank optional.

3. **Case B — the blank filter that triggers advice to change `convention.frontmatterFields` — how
   much does that specific misfire matter to you?** Assumed: **enough to be a blocking gate (Gate 3),
   not enough to widen the change.** It is the outcome most likely to waste a real person's time,
   because the advice is confident, specific, and points at a config file that is not the problem. If
   you have seen this in the wild, say so: it would argue for surfacing *which* filter value triggered
   a warning, which is a small extension to `describeDroppedFilters` and currently out of scope.

4. **Should `type` be re-examined at the same time, or is it genuinely settled?** Assumed: **settled**
   — `type` is trimmed at both the CLI and `buildFilters`, and its spec scenario exists. The reason to
   ask is that this change makes all three fields symmetric for the first time, which is the natural
   moment to notice that `type`'s double-trim is now redundant (`parseType` is a `.trim()` the
   application layer repeats). Removing that redundancy is not proposed here; it would touch a
   separately-tested CLI helper for no behavioural gain.
