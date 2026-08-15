# Proposal: `docs_overview`'s Taxonomy Counters Must Not Lose or Corrupt a Bucket

`GetOverview.execute` counts documents into two plain object literals keyed by values the project
controls and nothing validates. For two specific string values — `__proto__` and `constructor` —
the count is either **silently lost** or **rendered as garbage text**. Both are reachable through
ordinary frontmatter or an ordinary folder name.

**This is a data-integrity bug in an agent-facing corpus map. It is NOT prototype pollution.** That
distinction is measured, not argued (see *What actually happens*), and it is load-bearing for how
this change is scoped, sized and reviewed.

**One of three changes split from the same review pass** (`code-review-src-2026-08-14.md`, finding
1.5). The siblings are `filter-input-hygiene` (1.3) and `read-doc-fence-aware-sections` (1.4),
proposed in parallel. They share an origin document and a shared exploration
(`openspec/changes/2026-08-15-code-review-findings-1.3-1.5/exploration.md`) and nothing else. The
1.4-vs-1.5 split was put to the user explicitly on 2026-08-15 and resolved in favour of separating
them; it is not to be re-opened by a later phase.

## Intent

### The defect

`src/application/get-overview.ts:48-55` (the review cited 31-36; that citation is wrong):

```typescript
const byType: Record<string, number> = {};
const byModule: Record<string, number> = {};
for (const doc of documents) {
  if (doc.type !== undefined) byType[doc.type] = (byType[doc.type] ?? 0) + 1;
  if (doc.module !== undefined) byModule[doc.module] = (byModule[doc.module] ?? 0) + 1;
}
```

`?? 0` is the whole safety mechanism, and it only fires when the read returns `undefined`. On a
plain object literal, a read of `__proto__` or `constructor` returns an **inherited** member instead
— so the fallback never fires and the arithmetic runs against `Object.prototype` or the `Object`
function.

### What actually happens — measured, not reasoned

Reproduced by the orchestrator on this runtime during exploration (`exploration.md`, Orchestrator
Verification Addendum). Verbatim:

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

| Declared value | What the user gets | Why |
|---|---|---|
| `__proto__` | The bucket **vanishes**. No own property is created, so it never appears in `Object.keys`/`Object.entries`, and `formatOverview` renders no count for it | The inherited `__proto__` **setter** (Annex B) ignores any assigned value that is not an object or `null`. A string is neither, so the write is a silent no-op |
| `constructor` | The bucket **renders as garbage**: `constructor (function Object() { [native code] }1)` | `Object.prototype.constructor` is a writable *data* property, so the read returns the `Object` function, `Object + 1` stringifies it, and the assignment creates a real own property holding that string |
| Any other value | Correct | Nothing inherited shadows the read, `?? 0` fires |

### There is no prototype pollution here, and the proposal will not claim there is

Measured on the same runtime:

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

`Object.prototype` is untouched. No fresh object inherits a stray key. `byType`'s own prototype
link is intact. The damage is confined to one freshly-constructed object inside one `execute()`
call, and `execute()` builds it fresh every time — there is no persistence and no cross-request
leakage.

**Severity stays where the review put it: low.** What is being fixed is a corpus map that
misreports itself, not a security boundary. A later phase that re-frames this as a security fix has
changed the change.

### The part that makes it worth fixing anyway: the bug is indistinguishable from correct behavior

`openspec/specs/mcp-contract/spec.md:109`, *`docs_overview` Omits Empty Taxonomy Buckets*, requires
the `By type:` line to be omitted entirely when no document defines a `type`. `formatCounts`
implements that by returning `null` on an empty entries list.

So a corpus whose only declared `type` is `__proto__` renders **no `By type:` line at all** — and
that output is byte-identical to the output the spec mandates for a corpus with no types whatsoever.
The failure wears the requirement's clothes. Nothing in the rendered response, and nothing in the
`Overview` object, distinguishes "correctly omitted because empty" from "silently dropped a real
bucket". An agent reading the map has no way to notice, and neither does a user.

The `constructor` case is the opposite and arguably worse for an agent: it renders a bucket label
paired with `function Object() { [native code] }1` where a count belongs, inside the response whose
entire purpose is to let an agent pick filter values for `search_docs`.

### Reachability — ordinary inputs, not contrived ones

`type` and `module` are open, project-defined strings. Verified through the resolution path, not
assumed:

- **`type`**: `readField` (`src/domain/convention.ts:33-36`) returns any non-empty trimmed string
  from frontmatter. `createLoosePolicy` applies no allow-list at all; `createStrictPolicy` checks
  *presence*, and membership in `convention.types` only when a project declares that list. Neither
  rejects these particular strings as values. The value survives the SQLite `type TEXT` column
  unmodified into `store.listDocuments()`.
- **`module`**: `inferModule` (`src/domain/convention.ts:53-58`) returns the first path segment
  inside the declared root, verbatim, with no filtering. A folder named `docs/constructor/` yields
  `module: "constructor"` — and in a JavaScript/TypeScript project's documentation that is a
  genuinely plausible folder name, not a probe. This is the more reachable of the two vectors.

### Why now

It is the cheapest of the three findings from this review pass, it is fully understood, and the
measurement work is already done. There is no argument that it is urgent; the argument is that it
costs a handful of lines and a test, and that leaving a known "a bucket can vanish and look correct
doing it" hole in the one tool an agent uses to enumerate the corpus is a bad trade against that
price.

## Scope

### In Scope

- **Safe accumulation of `byType` and `byModule`** in `GetOverview.execute`, so that every declared
  `type`/`module` value produces an own, correctly-typed numeric count regardless of the string.
- **`byModule` is not optional.** It is the same loop with the same defect and the more reachable
  input (folder names). A fix covering only `byType` is an incomplete fix, not a smaller one.
- **A test that reproduces both failure shapes before the fix** (`strict_tdd: true`), plus a
  prototype-integrity assertion written in the one form that cannot produce a false positive — see
  the trap below.
- **One new `mcp-contract` requirement**, sibling to *Omits Empty Taxonomy Buckets*.
- **The choice of mechanism is left open** for `sdd-design`, with a recommendation and a binding
  constraint. See *The mechanism*.

### Out of Scope

| Item | Why |
|---|---|
| **Finding 1.3 (`filter-input-hygiene`) and finding 1.4 (`read-doc-fence-aware-sections`)** | Separate changes, proposed in parallel. Disjoint files, disjoint tests; 1.3 is a different spec capability entirely (`search`). The 1.4-vs-1.5 split was decided by the user on 2026-08-15 |
| **Any change to `Overview`'s public shape or the `docs_overview` response** | `byType`/`byModule` stay `Record<string, number>`; the rendered text keeps its exact format. This change corrects *values inside* the existing shape. A shape change means the scope moved |
| **Restricting which strings may be a `type` or a `module`** | Directly contradicts the project's *"`type`/`module`/`status` are optional, project-defined open strings, not a closed taxonomy"* decision. The counter is what is wrong here, not the vocabulary. Sanitizing folder names would also silently rewrite a user's own directory layout into a different `module` value |
| **A general audit of every `Record<string, T>` in the codebase** | Not needed, and the audit was already performed rather than deferred — see *No follow-ups are opened* |
| **Migrations, schema markers, compatibility shims** | Beta, no installed users (`openspec/config.yaml`, `rules.proposal`). Nothing here touches the schema, and nothing persisted changes |

### No follow-ups are opened — the audit was done, not deferred

The instruction was to list other unsafe accumulators as follow-ups rather than absorb them. **There
are none.** Every other keyed accumulator in `src/` was read:

| Site | Structure | Verdict |
|---|---|---|
| `src/domain/search-diagnostics.ts:15-23` (`collectFacets`) | `Set<string>` × 4 | Safe — a `Set` does not use property keys |
| `src/domain/fusion.ts:15-16,41` | `Map<number, number>` | Safe (and not string-keyed) |
| `src/domain/match-location.ts:110,125` | `Map<string, number>`, keyed by query terms | Safe |
| `src/application/sync-index.ts:173-174,256,337` | `Map` / `Set`, keyed by document path | Safe |
| `src/application/search-documents.ts:90` | `Map<number, Chunk>` | Safe |
| `src/infrastructure/sqlite/sqlite-index-store.ts:438,468,476-481` | `Set` / `Map` | Safe |
| `src/application/get-overview.ts:50-51` | **plain object literal, keyed by untrusted values** | **The defect** |
| `src/application/get-overview.ts:60-65` (per-document `OverviewLine`) | Object literal with **fixed** keys (`path`, `summary`, `type`, `status`); untrusted data is the *value* | Safe — a fixed key cannot collide with an inherited member |

Two things follow, and both belong in the proposal rather than in a design note. First, this is a
**single isolated site**, not an instance of a pattern — which is what justifies a one-function
change instead of a codebase sweep. Second, `Map` is already the house idiom for keyed accumulation
in this codebase (five files use it); the plain object in `GetOverview` is the outlier, which
strengthens the recommendation below.

## The mechanism — recommendation, with the decision left to `sdd-design`

Both options were **measured to work** during exploration. They differ in diff size and in the
runtime type of what crosses the return boundary.

**Option A — `Map<string, number>` internally, converted to a `Record` at the return boundary
(recommended).**

- The public `Overview.byType`/`byModule` stay ordinary plain objects with `Object.prototype` in
  their chain: JSON-serializable, `hasOwnProperty`-callable, indistinguishable from today's value
  for every consumer.
- Matches the idiom the rest of the codebase already uses for keyed accumulation.
- Cost: a slightly larger diff — the accumulator type changes and a conversion is added.

**Option B — `Object.create(null)`.**

- The smallest possible diff: two initializers. Measured to produce both counts correctly.
- Cost: `Overview.byType` is then a null-prototype object at runtime while its declared type says
  `Record<string, number>` — a distinction TypeScript cannot express. Nothing consumes it that way
  today (`formatCounts` uses only `Object.entries`, and the MCP response is rendered text), so this
  is latent rather than live; but it exports a runtime surprise from a public application-layer type
  to buy a handful of lines.

**Recommendation: A.** The argument is not safety — both are safe — it is that A confines the
unusual runtime object to the inside of one function, while B lets it escape into a published type.

**The binding constraint on either option, and the one way to ship this bug while believing it
fixed:** the conversion step must **define** properties, not assign them. `Object.fromEntries` uses
`CreateDataPropertyOrThrow`, so `Object.fromEntries(map)` creates a genuine own `__proto__` data
property. A hand-written `for (const [k, v] of map) result[k] = v;` loop reintroduces the original
defect verbatim, at the conversion instead of the accumulation, and every intermediate step would
look correct in review. Gate 1 catches it, but it is named here so it is not discovered at apply
time.

### `formatOverview` needs no change — traced, and asserted

`formatOverview` → `formatCounts(overview.byType)` → `Object.entries(counts)` → `${key} (${count})`.
`Object.entries` enumerates own enumerable string-keyed properties, which is exactly what both
options produce. So once the accumulator is correct, the renderer is correct with no edit, under
either option.

Two consequences worth stating rather than leaving implicit:

1. **The `formatCounts` empty-check acquires the right meaning.** Its `entries.length === 0 → null`
   branch currently returns `null` for a corpus whose only type is `__proto__`. After the fix it
   returns `null` only when the corpus genuinely declares no type — which is what *Omits Empty
   Taxonomy Buckets* has always required.
2. **A previously-absent line will appear** for such a corpus. That is the fix, not a regression, and
   Gate 4 exists to make sure it is not mistaken for one.

`src/cli.ts:221` (`compendio overview`) and `src/server.ts:91-93` (the `docs_overview` tool) both
render through this same `formatOverview`, so both are covered by construction and neither needs
separate coverage. **One correction to the framing this change inherited**: the `docs_overview` MCP
response is **text-only** (`content: [{ type: "text", text: formatOverview(...) }]`) — there is no
structured `byType` field on the wire. The garbled `constructor` value reaches an agent through the
rendered text, and `Overview` itself is an application-layer type consumed by `formatOverview` and
the CLI. The user-visible defect is real either way; the delivery channel is the rendered string.

## Capabilities

### New Capabilities

- None. This is a correctness gap inside `mcp-contract`, not a new capability area.

### Modified Capabilities

- **`mcp-contract`** — one **new** requirement, sibling to *`docs_overview` Omits Empty Taxonomy
  Buckets* (`spec.md:109`). **Verified against the actual spec text, not inferred from the
  exploration**: that requirement governs bucket *presence* (omit the line when the corpus declares
  nothing; never synthesize a catch-all; never render `undefined`). It says nothing about the
  *values* a bucket may be keyed by, and none of its two scenarios could fail on this defect — a
  corpus whose only type is `__proto__` passes *Corpus with no type anywhere* by accident. So this
  is an ADDED requirement, not a modification, and folding it into the existing one would bury a
  value-safety guarantee inside a presence rule.
- **`indexing`, `search`, `configuration`** — **no delta, asserted.** Nothing about what is
  persisted, filtered or configured changes. A delta in any of these appearing in `sdd-spec`'s output
  means the scope moved.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/application/get-overview.ts:48-55` | Modified | Safe accumulation for `byType` and `byModule`; conversion at the return boundary under option A |
| `src/application/get-overview.ts:103-152` (`formatOverview`, `formatCounts`) | **Unchanged — asserted** | Correct by construction once the accumulator is. An edit here means the accumulator fix is incomplete |
| `src/domain/convention.ts` (`readField`, `inferModule`) | **Unchanged — asserted** | Open project-defined strings stay open. Restricting them is an explicit non-goal |
| `src/server.ts`, `src/cli.ts` | **Unchanged — asserted** | Both render through `formatOverview`; neither touches the counters |
| `test/application/get-overview.test.ts` | Extended | Reproduction cases for both values, on both fields, plus the prototype-integrity guard. Every existing case must pass **unmodified** |
| `openspec/specs/mcp-contract/spec.md` | Modified | One new requirement + scenarios |
| `CLAUDE.md` | Modified (small) | The `docs_overview` bullet documents bucket omission; one clause noting that a bucket is never lost or garbled by its own key value |

## Success Criteria

Each gate can **fail and stop the change**. This project gates on *falsification*, not on a
tolerance band. `strict_tdd: true` applies: every gate below is written first and observed failing
against the current tree — **with the single, deliberate exception of Gate 3**, whose expected
result is "passes before and after" and which says so explicitly rather than pretending otherwise.

### Gate 1 — Both failure shapes are reproduced through `GetOverview`, then closed (BLOCKING)

Seeded through the existing `seed()` helper in `test/application/get-overview.test.ts` against a real
`SqliteIndexStore(":memory:")` — the application path, not a bare `node -e` repro:

- [ ] **Before**, `type: "__proto__"`: `Object.keys(overview.byType)` does **not** contain
      `__proto__`, and `formatOverview(overview)` renders no count for it.
- [ ] **Before**, `type: "constructor"`: `overview.byType.constructor` is a **string**, not a number,
      and `formatOverview(overview)` contains `function Object() { [native code] }`.
- [ ] **After**, both: the value is an own, enumerable, **numeric** entry with the correct count, and
      `formatOverview` renders `__proto__ (1)` / `constructor (1)`.
- [ ] **After**: a corpus mixing `__proto__`, `constructor` and an ordinary value counts all three,
      with the ordinary one unchanged.

**STOP condition.** If the "before" assertions pass on the unfixed tree, the measured behavior did
not reproduce through the real application path and the change's justification collapses. That
outcome stops the change rather than being smoothed over. Assert the *type* of the value
(`typeof === "number"`), not just its presence — the `constructor` case produces a present entry
holding a string, and a presence-only assertion passes on the broken tree.

### Gate 2 — `byModule` is covered identically, via the folder-derived path (BLOCKING)

- [ ] The same before/after pairs for `module: "__proto__"` and `module: "constructor"`.
- [ ] At least one case reaches `module` the way a real corpus does — a document path under a folder
      literally named `constructor` — rather than only by setting the field directly.

**STOP condition.** A fix landing on `byType` alone. The two loops are one defect.

### Gate 3 — The prototype-integrity claim is asserted in a form that cannot lie (NON-REGRESSION)

**This gate is expected to pass before *and* after the fix.** It is not a bug reproduction; it is
the assertion that pins the "data-integrity, not security" framing so a future reader cannot
re-file this as a security fix, and so a future change cannot quietly introduce real pollution.
Recorded as an intentional exception to `strict_tdd`'s failing-first rule rather than an oversight.

- [ ] `Object.getOwnPropertyNames(Object.prototype)` is compared **before and after** a
      `GetOverview.execute()` over the hostile corpus, and is identical.
- [ ] A **fresh, unrelated** object shows no stray key (`Object.keys({}).length === 0`).

**Forbidden predicate, on the record.** `Object.prototype.hasOwnProperty('__proto__') === false`
MUST NOT be used as the pollution check. `__proto__` genuinely **is** an own accessor property of
`Object.prototype` in a healthy runtime, so that probe reports pollution on an unmodified object.
This is not hypothetical: it produced a false positive during exploration and briefly "proved" a bug
that does not exist. A reviewer seeing that predicate in the diff should reject it.

### Gate 4 — Nothing else moved

- [ ] `npm test`, `npm run typecheck`, `npm run build` pass.
- [ ] Every existing case in `test/application/get-overview.test.ts` passes with **no assertion
      modified** — in particular `expect(overview.byType).toEqual({})` (empty-corpus omission) and
      `expect(overview.byType).toEqual({ guia: 1 })` (partial coverage). Modifying either means the
      normal path moved, which nothing in this change is allowed to do.
- [ ] *Omits Empty Taxonomy Buckets* still holds unchanged: a corpus that genuinely declares no
      `type` still renders **no** `By type:` line, and no rendered output contains the literal
      `undefined`.
- [ ] `Overview.byType`/`byModule` remain declared `Record<string, number>`, and the rendered line
      format is byte-identical for every corpus that does not use these two values.

### Gate 5 — The conversion boundary does not reintroduce the defect (conditional, option A only)

- [ ] The `Map`→`Record` conversion uses a property-**defining** operation (`Object.fromEntries`),
      not an assigning loop.
- [ ] The Gate 1 `__proto__` assertion is made against the **returned** object, not against the
      internal `Map`, so an assigning conversion fails it.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| **The change is written up, reviewed or archived as a security fix.** "Prototype pollution" is the phrase that comes to mind, it sounds more important, and it is wrong | **High** | Framed and measured in *Intent* with verbatim output showing `Object.prototype` untouched. Gate 3 pins it as a test. The severity stays at the review's own "low" |
| **A `hasOwnProperty('__proto__')` probe is used as the pollution check**, reporting a false positive and "proving" a bug that is not there | **High** | Already happened once during exploration. Forbidden explicitly in Gate 3, with the correct predicate given |
| **`byType` is fixed and `byModule` is not** — one loop looks like the finding, the other looks like a duplicate | Med | Gate 2 is blocking and independent. `byModule` is the more reachable of the two, via folder names |
| **Option A is chosen and the conversion is written as an assigning loop**, moving the bug from accumulation to conversion while every step looks right | Med | Named in *The mechanism*; Gate 5 asserts the defining operation, Gate 1 asserts against the returned object |
| **A presence-only assertion is used** (`'constructor' in byType`), which passes on the broken tree because the corrupted entry is present | Med | Gate 1 requires asserting `typeof === "number"` and the exact count |
| **The scope widens into sanitizing `type`/`module` values or auditing every `Record`** | Low-Med | Both are explicit non-goals with reasons; the accumulator audit is already complete and opened zero follow-ups |
| **The newly-appearing `By type:` line for a hostile corpus is read as a regression** against *Omits Empty Taxonomy Buckets* | Low | Called out in *The mechanism*; Gate 4 pins the genuinely-empty case separately from the newly-counted one |

## Rollback Plan

Included per `openspec/config.yaml` `rules.proposal`, and honestly assessed: **this is a normal
revert with nothing attached.** No ceremony is invented for it.

1. Revert the change commits and `npm run build`.
2. **Nothing else.**

The reasons, so the claim is checkable rather than asserted:

- **The counters are computed at query time from `listDocuments()`.** Nothing is persisted, so there
  is no on-disk artifact to undo and no `.compendio/` state that a reverted binary would misread.
- **No schema change, no DDL, no config key, no port change, no path/ID shape change**, so
  `ejemplos/goldenset.yaml` and `compendio eval` are untouched.
- **No reindex is needed in either direction.** This is the notable contrast with the sibling
  `config-value-validation`, whose fix could not reach an existing corpus without a full
  `compendio index` because chunk boundaries are persisted. Here the fix takes effect on the very
  next `docs_overview` call, and so does the revert.

The only residue is informational: after a revert, a corpus using these two values goes back to
under-reporting or garbling a bucket. That is the pre-change state.

## Dependencies

- **Zero new npm dependencies.**
- **No new fixture corpus.** `test/application/get-overview.test.ts`'s existing `seed()` helper over
  `SqliteIndexStore(":memory:")` covers every gate.
- **No model download required by any gate.** No gate touches embeddings; `GetOverview` never does.

## Delivery size

| Driver | Estimate |
|---|---|
| `src/application/get-overview.ts` — accumulator + conversion (option A) | 8–18 |
| `test/application/get-overview.test.ts` — Gates 1, 2, 3 | 45–100 |
| `openspec/specs/mcp-contract/spec.md` — one requirement + scenarios | 25–50 |
| `CLAUDE.md` — one clause | 3–10 |
| **Total** | **~80–180** |

The exploration's floor for this finding is **~20–35 changed lines**, which counts the production
edit and little else. The number above is that floor carried through tests and spec prose. **This
repository's forecasts have undershot by 1.3x–2x for several cycles running** (`bounded-chunk-size`
240–420 → 773; `match-centred-excerpt` 300–470 → ~1 521), and that pattern is recorded here rather
than assumed away. Even at the pessimistic end this clears the 400-line PR review budget
comfortably: **one PR**, with the production surface genuinely one function in one file and the
variance concentrated entirely in tests and spec text.

## Resolved decisions

Recorded so later phases do not re-litigate them.

| Question | Decision |
|---|---|
| Framing | **Data-integrity bug in `docs_overview`, severity low.** Not prototype pollution — measured, with `Object.prototype` provably untouched. Gate 3 pins it |
| Which fields | **`byType` and `byModule`, both.** Same loop, same defect; `byModule` is the more reachable via folder names |
| `formatOverview` / `formatCounts` | **Unchanged.** Correct by construction once the accumulator is; traced, not assumed |
| `Overview`'s public shape and the `docs_overview` response | **Unchanged.** `Record<string, number>` and the same rendered text |
| Restricting `type`/`module` values | **Non-goal.** Contradicts the open-taxonomy decision; the counter is the defect, not the vocabulary |
| Other unsafe accumulators | **None exist.** Audit performed and tabulated; `collectFacets` uses `Set`, five other sites use `Map`. Zero follow-ups opened |
| Mechanism (`Map`+convert vs `Object.create(null)`) | **Open — `sdd-design` decides.** Recommendation is `Map` + `Object.fromEntries`; the defining-not-assigning conversion is binding under either option |
| Spec surface | **One ADDED `mcp-contract` requirement**, sibling to *Omits Empty Taxonomy Buckets* — verified against the spec text: that one governs bucket presence, this one governs value safety |
| Rollback | **Normal revert, nothing attached.** No persisted state; the fix and its revert both take effect on the next call |
| Relationship to findings 1.3 and 1.4 | **Three separate changes** (user decision, 2026-08-15). Not bundled, not re-opened |
| Migrations / schema markers / shims | **None.** Beta, no installed users |
| Artifact store | **openspec** (file-based). Engram MCP tools unavailable this cycle |

## Proposal question round (open — for the user, before `sdd-spec`)

Four product questions this proposal currently answers by assumption. Each names the assumption in
force, so silence is a valid answer and the change proceeds either way. A second round is available
if any answer moves the scope.

1. **Is this a shape you expect to actually occur, or is the fix justified purely by the class of
   input?** Assumed: **the class.** No real corpus is known to declare `type: __proto__`; the
   plausible one is a folder named `constructor` in a JS/TS project's docs feeding `module`. This
   matters for priority, not for correctness — if you have never seen and never expect either, this
   change's value is a closed invariant plus a regression test, and it should be scheduled last of
   the three siblings rather than argued up.

2. **Should a bucket that would have vanished be *reported*, or is counting it correctly enough?**
   Assumed: **counting it is enough** — once the count is right there is nothing left to say, and the
   corrected map is itself the report. Worth confirming because this project's reflex everywhere else
   is *degrade and say so* (`embeddingsWarning`, `filterWarning`, `noMatchReason`, the `Config:`
   block), and a reviewer may expect that reflex here. The consequence of the assumption: a user who
   was silently losing a bucket is never told it used to be missing, only shown the correct value from
   the next call onward.

3. **Do you want folder-derived `module` values to stay completely unrestricted?** Assumed: **yes,
   unchanged.** `inferModule` returns the raw folder name and this change does not touch it. The
   alternative — sanitizing or rejecting certain folder names — would quietly rewrite a user's own
   directory layout into a different `module` value and would contradict the open-taxonomy decision.
   Confirming this closes the only door through which this change could grow.

4. **Is it worth its own PR, or should it ride with a sibling?** Assumed: **its own**, per your
   2026-08-15 decision. Recorded because the exploration itself flagged this as the lower-conviction
   half of the split: at ~80–180 lines it is small enough that folding it into whichever sibling
   ships nearest would be a defensible way to cut SDD overhead. The cost of the split is process
   overhead on a genuinely tiny fix; the benefit is a PR that reads as one concern.
