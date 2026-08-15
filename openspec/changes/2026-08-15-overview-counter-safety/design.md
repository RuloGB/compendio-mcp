# Design: Counting by a value the project chose — `Map` inside, plain object at the boundary

**Phase**: design · **Artifact store**: openspec (Engram MCP tools unavailable this cycle) ·
**Skill resolution**: paths-injected (`cognitive-doc-design`) — no project skill in the registry
applies to a single-function TypeScript correctness fix.

**Fork decision: Option A — `Map<string, number>` as the accumulator, `Object.fromEntries` at the
return boundary.** The proposal recommended it on idiom and encapsulation grounds; those hold, and
two inputs it did not price make the choice firmer rather than merely preferable (Decision 1). The
conversion's defining-not-assigning constraint is promoted from advice to a three-layer requirement
in Decision 2.

**Framing, unchanged and load-bearing: a data-integrity defect in an agent-facing corpus map.** Not
prototype pollution — measured, `Object.prototype` untouched. No sanitization, no input rejection,
no allow-list. The counter is what is wrong; the vocabulary stays open.

## Findings that correct the inputs

Every row checked against the file, not carried on trust. **Three of them change what a gate must
assert**, and one of them decides the fork.

| Claim in the proposal | Verified state |
|---|---|
| Gate 2: *"at least one case reaches `module` the way a real corpus does — a document path under a folder literally named `constructor`"* — beside Dependencies' *"no new fixture corpus"* | **The two collide as written.** `buildHarness` (`test/helpers/build.ts:93-127`) needs a real on-disk directory, so a folder literally named `constructor`/`__proto__` means a committed fixture. **It is not needed**: `FileDocumentSource` contributes nothing to `module` except the emitted path *string*. `inferModule` (`convention.ts:53-58`) derives the value from that string, and `createLoosePolicy` (`:87`) is the only consumer. Chaining the real resolver to the real store reaches `module` by the production route with zero files on disk — Decision 5 |
| Gate 3: *"`Object.getOwnPropertyNames(Object.prototype)` … before and after … is identical"* | **Correct, and insufficient — it is blind to the one mutation this code could plausibly cause.** The name set does not change when an *existing* own property's *value* changes, and `Object.prototype.constructor` is a **writable data property**: it is precisely the member the `constructor` branch writes through. The instrument and the hazard are mismatched. Decision 6 adds the value assertion that closes it |
| Gate 4: *"every existing case in `test/application/get-overview.test.ts` passes with no assertion modified"* | **Names one file; there are two.** `test/application/index-and-search.test.ts:330-353` asserts `byModule`'s shape directly — `expect(overview.byModule).toEqual({ specs: 1 })` plus two `not.toHaveProperty` probes — through the full index pipeline. It is the only existing coverage of folder-derived `byModule` and it must pass unmodified too |
| *"Option B … Nothing consumes it that way today, so this is latent rather than live"* | **Not entirely latent: it lands on Gate 4.** `expect(overview.byType).toEqual({})` against an `Object.create(null)` value is a question about vitest's `toEqual` (prototype comparison belongs to `toStrictEqual`, so it very probably passes) — but *"very probably"* is the exact register this repository has been burned in. Under Option A the gate holds by construction with nothing to measure. Decision 1 |
| *"`formatOverview` needs no change — traced"* | **Confirmed, and re-traced independently.** `formatOverview:110-113` → `formatCounts` (`:148-152`) → `Object.entries(counts)`, which enumerates own enumerable string keys — exactly what both options produce. No edit, under either option |
| *"`byModule` … the same treatment"* | **True of the fix, false of the gate.** `formatDocLine` (`index-markdown.ts:33-42`) renders `[type]` and `(status)` and **never `module`**. So the strongest discriminator available for `byType` — rendered self-consistency — does not exist for `byModule`, which needs a different one. Decision 4 |
| `Object.fromEntries` availability on this project's floor | **Confirmed, not assumed.** `tsconfig.json` `target`/`lib` are `ES2022`; `Object.fromEntries` is ES2019. Node floor is ≥22.12. No polyfill, no lib bump |
| The hostile value survives persistence | **Traced.** `saveDocument` binds `meta.type`/`meta.module` as SQL parameters and `toDocument` (`sqlite-index-store.ts:544-559`) rebuilds with **fixed** keys (`if (row.type !== null) doc.type = row.type`). Untrusted data is the value at every hop, never a key. Gate 1 exercises the round-trip anyway rather than resting on this |

## Technical Approach

One method body in `src/application/get-overview.ts`. No port change, no schema change, no new module,
no new dependency, no change to `Overview`'s declared shape or to the rendered text format.

### Flow, with the two failure shapes marked

```
listDocuments()  ──►  IndexedDocument[]        doc.type / doc.module: open project-defined strings
                                               (frontmatter value, or first path segment)
   │
   ▼   BEFORE — plain object literal, [[Get]] walks the prototype chain
byType[k] = (byType[k] ?? 0) + 1
   ├── k = "__proto__"     read → Object.prototype (an object, not undefined) → `?? 0` never fires
   │                       write → Annex B setter, non-object value → SILENT NO-OP
   │                       ⇒ no own property ⇒ absent from Object.entries ⇒ BUCKET VANISHES
   ├── k = "constructor"   read → the `Object` function → `?? 0` never fires
   │                       write → inherited property is a writable DATA property, so [[Set]]
   │                               creates an OWN property on the receiver (prototype untouched)
   │                       ⇒ own property holding "function Object() { [native code] }1"
   └── anything else       nothing shadows the read ⇒ `?? 0` fires ⇒ correct

   ▼   AFTER — Map keys are values, not properties; nothing can be shadowed
byType.set(k, (byType.get(k) ?? 0) + 1)
   │
   ▼   Object.fromEntries  (CreateDataPropertyOrThrow — DEFINES, never assigns)
Overview.byType : Record<string, number>   ← ordinary {}-prototyped object, unchanged for consumers
   │
   ├──► formatCounts → `By type: __proto__ (1), constructor (1)`   UNCHANGED CODE
   ├──► src/server.ts:93   docs_overview → text only, no structured byType on the wire
   └──► src/cli.ts:221     compendio overview
```

| Question this design owns | Answer | Where |
|---|---|---|
| `Map` + convert, or `Object.create(null)` | **A**, on two inputs beyond idiom | Decision 1 |
| How the conversion is stopped from reintroducing the bug | Three layers, one of them behavioral | Decision 2 |
| Does `formatOverview`/`formatCounts` move | **No** — confirmed, not inherited | Decision 3 |
| Does `byModule` need more than the same treatment | Same fix, **different gate** — it has no per-document cross-check | Decision 4 |
| How a gate tells "correctly absent" from "silently lost" | Self-consistency for `byType`, twin-corpus differential for `byModule` | Decision 5 |
| The prototype-integrity assertion | Correct form, forbidden form, and the value check the proposal's version misses | Decision 6 |

## Architecture Decisions

### Decision 1: Option A — `Map` accumulator, `Object.fromEntries` at the return

**Choice.** `src/application/get-overview.ts`, `GetOverview.execute`. This block is normative:
`sdd-apply` writes it as given.

```ts
execute(): Overview {
  const documents = this.store.listDocuments();
  // Counted in a `Map`, NOT a plain object. A plain object's read walks the
  // prototype chain, so `byType["__proto__"] ?? 0` returns the inherited member
  // and the `?? 0` fallback never fires. Measured on this runtime: a `type` of
  // `__proto__` is lost outright (the Annex B setter ignores a non-object value,
  // so the write is a silent no-op) and a `type` of `constructor` becomes the
  // string "function Object() { [native code] }1". `type` and `module` are open,
  // project-defined strings -- a folder named `docs/constructor/` is the reachable
  // case. Map keys are values, not properties: no key can collide with an
  // inherited member.
  const byType = new Map<string, number>();
  const byModule = new Map<string, number>();
  for (const doc of documents) {
    if (doc.type !== undefined) byType.set(doc.type, (byType.get(doc.type) ?? 0) + 1);
    if (doc.module !== undefined) byModule.set(doc.module, (byModule.get(doc.module) ?? 0) + 1);
  }
  return {
    totalDocuments: documents.length,
    // `Object.fromEntries` DEFINES properties (CreateDataPropertyOrThrow), so a
    // `__proto__` key becomes a genuine own data property. Do NOT "simplify" this
    // into `for (const [k, v] of byType) out[k] = v` -- assignment reintroduces the
    // identical defect at the conversion instead of the accumulation, and every
    // line of it looks correct in review (design.md Decision 2).
    byType: Object.fromEntries(byType),
    byModule: Object.fromEntries(byModule),
    documents: documents.map(/* unchanged */),
  };
}
```

**The tradeoff, weighed rather than asserted.**

| | Option A — `Map` + `Object.fromEntries` | Option B — `Object.create(null)` |
|---|---|---|
| Diff at the production site | ~8 lines + comment | 2 initializers |
| Runtime type crossing the return boundary | ordinary `{}`-prototyped object — **identical to today** | null-prototype object under a `Record<string, number>` declaration TypeScript cannot express |
| Gate 4 (existing assertions unmodified) | holds **by construction** | an empirical question about `toEqual` vs `toStrictEqual`, across **two** test files |
| Safety visible at the point of use | yes — `byType.set(...)` is self-evidently key-safe | **no** — the accumulation line is textually unchanged; safety lives in a distant initializer |
| Can the Decision-2 trap occur | yes, at the conversion — mitigated in three layers | structurally impossible |
| House idiom | matches `fusion.ts`, `match-location.ts`, `sync-index.ts`, `search-documents.ts`, `sqlite-index-store.ts` | the outlier stays an outlier |

**Three supports. Only the third is style.**

1. **Gate 4 stops being a measurement.** The proposal requires `expect(overview.byType).toEqual({})`
   and `toEqual({ guia: 1 })` — plus `index-and-search.test.ts`'s `toEqual({ specs: 1 })` and its two
   `not.toHaveProperty` probes — to pass with **no assertion modified**. Under A the returned value's
   prototype is what it has always been, so the gate is satisfied without anyone checking anything.
   Under B the gate's outcome depends on vitest's structural-equality semantics for a null-prototype
   object. That is very likely fine. This repository's recorded failure mode is exactly the class of
   claim that is very likely fine (`compendio-agentes-reportan-verde-falso`, eleven defects inside
   success reports), and a fork that removes the question outright is worth eight lines.
2. **Under B the diff shows nothing at the defect site.** `byType[doc.type] = (byType[doc.type] ?? 0) + 1`
   is byte-identical before and after. A future reader cannot tell the line is safe without finding
   the initializer, and the most plausible future edit — a cleanup that "normalizes" an odd-looking
   `Object.create(null)` back to `{}` — silently restores the bug with no local signal. Under A the
   safety and the operation are the same expression.
3. **`Map` is already this codebase's keyed accumulator** in five files; `GetOverview` is the single
   outlier (the proposal's completed audit). A fixes an inconsistency rather than adding one.

**Rejected — Option B (`Object.create(null)`).** Genuinely cheaper, genuinely safe, and it has one
real advantage A does not: the Decision-2 trap cannot occur in it. That advantage is bought by moving
the unusual runtime object out of one function body and into a published application-layer type, and
by converting a gate this change must pass into something that has to be measured first. **Cheap
reversal if a reviewer disagrees:** replace the two `new Map()` lines with `Object.create(null)`,
delete the conversion and Decision 2's third layer, keep every gate except Gate 5, and re-run Gate 4
with the prototype question now live. Nothing else in this design moves.

**Rejected — hand-guarded plain object** (`Object.hasOwn` on read, `Object.defineProperty` on write).
Correct, and worse than both: it puts the safety in a hand-written guard at every read *and* every
write, which is the shape a later "simplification" reverts one half of.

**Rejected — a shared `countBy` helper or a `Counter` type in `src/domain/`.** One call site, two
loops, four lines. The precedent is this repo's own ruling on the same question:
*"Four lines used by one function is not a module"* (`config-value-validation` design, Decision 3).

### Decision 2: the conversion MUST define, never assign — enforced in three layers

**Requirement (hard, not advice).** The `Map` → `Record` conversion MUST use a property-**defining**
operation. `Object.fromEntries` is the chosen one (`CreateDataPropertyOrThrow`).
`Object.defineProperty` is the only acceptable alternative. An assigning loop
—`for (const [k, v] of byType) out[k] = v`— is **forbidden**: it performs the identical `[[Set]]` the
defect is made of, relocated from accumulation to conversion, and it produces a diff in which every
individual line is correct.

`sdd-apply` is prevented from writing it by three layers, deliberately of different kinds:

| Layer | Mechanism | What it catches |
|---|---|---|
| **1 — normative** | Decision 1's code block is copied verbatim, not paraphrased. `Object.fromEntries` is in the block | The intended path: there is nothing to invent |
| **2 — behavioral (the real enforcement)** | Gate 1 asserts `Object.getOwnPropertyDescriptor(overview.byType, "__proto__")` is a data descriptor with `value: 1`, **against the returned object, never the internal `Map`** | An assigning conversion produces **no own property** at all, so the descriptor is `undefined` and the test fails. Cannot be satisfied by any assigning form, however written |
| **3 — durable** | The `Do NOT "simplify" this into …` comment at the conversion, in the exact register this repo already uses for `reset()`'s file-recreate path and `decode-text.ts`'s CP1252 table | The future edit, months from now, by someone who never reads this file |

Layer 2 is what makes the constraint real. Layers 1 and 3 make it cheap and make it survive.

### Decision 3: `formatOverview` and `formatCounts` are unchanged — confirmed, and the confirmation is asserted

**Choice.** No edit. `formatCounts:149` calls `Object.entries(counts)`, which enumerates own
enumerable string-keyed properties; `Object.fromEntries` produces exactly those. The renderer is
correct the moment the accumulator is.

Two consequences, both stated so neither is mistaken for a regression:

1. **The `entries.length === 0 → null` branch acquires the meaning it always claimed.** Today it
   returns `null` for a corpus whose only `type` is `__proto__`. After the fix it returns `null` only
   when the corpus genuinely declares nothing — which is what *`docs_overview` Omits Empty Taxonomy
   Buckets* (`mcp-contract/spec.md:109`) has always required and never actually got.
2. **A `By type:` line appears where none appeared before**, for a corpus using these values. That is
   the fix. Gate 4 pins the genuinely-empty case separately so the two are never conflated.

**An edit to either function means the accumulator fix is incomplete** — that is the falsifier, and it
is why this is a decision rather than a note.

Key ordering is unchanged and needs no gate: `Object.fromEntries` builds an ordinary object, so
integer-like keys sort first and the rest keep insertion order — the same rule the plain-object
version obeyed.

### Decision 4: `byModule` gets the identical fix and a *different* gate

**Choice.** Same two lines, same conversion — and a separate discriminator, because the two fields are
not observationally symmetric.

`formatDocLine` renders `[type]` and `(status)`. It **never renders `module`**. So for `byType` the
rendered response contains the same information twice (per-document segments and the aggregate line)
and can be checked against itself; for `byModule` the aggregate line is the *only* place the value
ever appears. A lost `byModule` bucket leaves no trace anywhere in the output — which makes it the
harder of the two to detect and, since `inferModule` returns a raw folder name, the more reachable of
the two to trigger.

Nothing else about `byModule` needs treatment. `inferModule` stays exactly as it is: restricting
folder names would silently rewrite a user's own directory layout into a different `module` value and
contradicts the open-taxonomy decision. **`src/domain/convention.ts` is unchanged — asserted.**

### Decision 5: the discriminator — how a gate tells "correctly absent" from "silently lost"

This is the design's central test problem. `formatCounts` returns `null` on an empty list, so a corpus
whose only `type` is `__proto__` renders **byte-identically** to a corpus with no types at all. The
bug wears the requirement's clothes, and every naive assertion is therefore vacuous:
`not.toContain("undefined")` passes, `toEqual({})` passes, `not.toContain("By type:")` passes. All
three pass on the broken tree *and* describe correct behavior on a healthy one.

Two discriminators, one per field, both differential rather than absolute.

**For `byType` — rendered self-consistency.** A single rendered response cross-checked against itself:

> Every `type` value shown in a per-document `[type]` segment MUST appear as a key in the `By type:`
> line, with a count equal to the number of per-document lines carrying it. A `type` that appears in
> neither is not a violation.

On the hostile corpus **before** the fix, a document line reads `- [__proto__] a.md — content` while
no `By type:` line exists — the response contradicts itself, and the check fails. **After**, both
agree. On a genuinely typeless corpus both sides are empty and the check passes, so the invariant
never fights the requirement it sits beside. Its virtue is that it hard-codes **no expected value**:
it cannot be satisfied by a bucket that vanished, and it cannot be broken by the case the spec
mandates.

**Guard against a vacuous checker — mandatory.** A regex-parsed self-consistency helper passes
trivially when its regex matches nothing on both sides. The helper MUST therefore also assert that the
number of per-document lines it parsed equals `overview.documents.length`. Verifying the verifier
against a known-broken state is this project's standing rule
(`compendio-agentes-reportan-verde-falso`), and this helper is exactly the shape that has failed it
before.

**For `byModule` — a twin-corpus differential**, since no cross-check exists. Two corpora identical in
every respect except the module value:

| Corpus | Module value | Before the fix | After the fix |
|---|---|---|---|
| control | `guides` | `By module: guides (1)` | unchanged |
| hostile | `__proto__` | **no `By module:` line** | `By module: __proto__ (1)` |

The falsifier is the *difference in presence* between two corpora that differ only in a string value.
That difference is the bug stated in one line, and it is invisible to any assertion looking at the
hostile corpus alone.

**And the hostile module value is reached by the production route, with no fixture on disk** (findings
table): `createConventionPolicy({ mode: "loose", … }, ["docs"]).resolver({ path: "docs/__proto__/a.md",
title: "A", summary: "content", data: {}, hash: "h" })` → assert `meta.module === "__proto__"` (link 1:
`inferModule` genuinely produces it) → seed the store with **that returned `meta`**, not a hand-written
one (link 2) → `GetOverview.execute()`. No `module: "__proto__"` string is typed anywhere in the test.

**Rejected — a committed fixture directory named `__proto__/` or `constructor/`.** It buys nothing:
`FileDocumentSource` contributes only the path string, which link 1 already supplies, and
`test/` is not published (`package.json` `files: ["dist", "README.md", "LICENSE"]`), so the on-disk
form would never even reach a user. Against that, a directory named `__proto__` committed to the repo
is a durable oddity that every future reader must decode.

### Decision 6: the prototype-integrity assertion — the correct form, the forbidden form, and the missing check

**Forbidden, on the record.** `Object.prototype.hasOwnProperty('__proto__') === false` MUST NOT be used
as the pollution predicate. `__proto__` **is** an own accessor property of `Object.prototype` in a
healthy runtime, so the probe reports pollution on an unmodified object. It already produced a false
positive in this cycle and briefly "proved" a defect that does not exist. **A reviewer seeing this
predicate in the diff should reject the diff.**

**Required form**, around a `GetOverview.execute()` over the hostile corpus:

| # | Assertion | What it catches |
|---|---|---|
| a | `Object.getOwnPropertyNames(Object.prototype)` compared before/after — identical | A **new** own property appearing on the prototype |
| b | `Object.keys({}).length === 0` on a **fresh, unrelated** object | Any enumerable inheritance leak |
| c | **`({}).constructor === Object`** and `Object.getPrototypeOf({}) === Object.prototype` | **The gap in the proposal's version.** (a) is blind to a *value* change of an existing own property, and `Object.prototype.constructor` is a writable data property — the exact member the `constructor` branch writes through. Name-set comparison is the wrong instrument for the one mutation this code could plausibly cause |

Row (c) is not defensive padding. Per spec, `[[Set]]` against an inherited *writable data property*
creates an own property on the receiver and leaves the prototype's value alone — which is why the
measured run showed 12 own props before and after. (c) is what turns that spec derivation into an
observed fact, and it is the assertion a future genuine-pollution regression would trip first.

**This gate passes before and after the fix, deliberately.** It is not a reproduction; it is the
assertion that pins the *"data-integrity, not security"* framing so a later reader cannot re-file this
as a security fix, and so a later change cannot quietly introduce real pollution. Recorded as an
explicit exception to `strict_tdd`'s failing-first rule rather than left to look like an oversight.

## File Changes

| File | Action | Description |
|---|---|---|
| `src/application/get-overview.ts` (`execute`, `:48-55` + the return) | Modify | Decision 1's normative block: two `Map` accumulators, `Object.fromEntries` at the return, two comments |
| `src/application/get-overview.ts` (`formatOverview`, `formatCounts`, `Overview`) | **Unchanged — asserted** | Decision 3. An edit here means the accumulator fix is incomplete |
| `src/domain/convention.ts` (`inferModule`, `readField`) | **Unchanged — asserted** | Decision 4. Open project-defined strings stay open |
| `src/server.ts:93`, `src/cli.ts:221` | **Unchanged — asserted** | Both render through the same `formatOverview`. `docs_overview` is text-only — there is no structured `byType` on the wire |
| `src/infrastructure/sqlite/**`, `src/domain/**` (other), `src/composition.ts` | **Unchanged — asserted** | No port, schema, DDL, config-key or path-shape change |
| `test/application/get-overview.test.ts` | Extend, **additions only** | Gates 1, 2, 3 and the self-consistency helper. Existing cases unmodified (Gate 4) |
| `test/application/index-and-search.test.ts:330-353` | **Unchanged — asserted** | Existing `byModule` coverage through the full pipeline; it must pass untouched (findings table) |
| `openspec/specs/mcp-contract/spec.md` | Modify | One **added** requirement, sibling to *Omits Empty Taxonomy Buckets* (`:109`). Owned by `sdd-spec` |
| `CLAUDE.md` | Modify (small) | One clause on the `docs_overview` bullet: a bucket is never lost or garbled by its own key value |

## Testing Strategy

`strict_tdd: true`. Every gate is written first and **observed failing against the current tree** —
with the single declared exception of Gate 3 (Decision 6). All gates run over
`SqliteIndexStore(":memory:")` through the existing `seed()` helper: no fixture corpus, no embeddings,
no model download, no network.

| Gate | Decision tested | Falsifier / STOP condition |
|---|---|---|
| **1 — both failure shapes reproduced through `GetOverview`, then closed** (BLOCKING) | 1, 2, 5 | **Before**, `type: "__proto__"`: `Object.keys(overview.byType)` lacks it and the render carries no count. **Before**, `type: "constructor"`: `typeof overview.byType["constructor"] === "string"` and the render contains `function Object() { [native code] }`. **After**: `Object.getOwnPropertyDescriptor(overview.byType, "__proto__")` is a data descriptor with `value: 1`, `typeof byType["constructor"] === "number"`, and the render reads `__proto__ (1)` / `constructor (1)`. Plus a mixed corpus counting all three with the ordinary value unchanged. **STOP** if any "before" assertion passes on the unfixed tree — the defect did not reproduce through the application path and the change's justification collapses. Assert the **type**, never presence alone: the `constructor` case produces a present entry holding a string |
| **1b — the self-consistency invariant** (BLOCKING) | 5 | Per-document `[type]` segments ↔ `By type:` counts agree. Fails before, holds after, and holds on a genuinely typeless corpus. The helper MUST assert its parsed line count equals `overview.documents.length` or it can pass vacuously |
| **2 — `byModule`, via the folder-derived route** (BLOCKING) | 4, 5 | The twin-corpus differential (Decision 5's table) for `__proto__` and `constructor`, with the module value produced by `createConventionPolicy(...).resolver` over `docs/__proto__/a.md` and asserted at link 1 before it is ever seeded. **STOP**: a fix landing on `byType` alone. The two loops are one defect |
| **3 — prototype integrity, in a form that cannot lie** (NON-REGRESSION, passes before *and* after) | 6 | Rows (a), (b), (c) of Decision 6. `hasOwnProperty('__proto__')` is a **forbidden** predicate |
| **4 — nothing else moved** | 1, 3 | `npm test`, `npm run typecheck`, `npm run build` pass. Every existing assertion in `test/application/get-overview.test.ts` **and** `test/application/index-and-search.test.ts:330-353` passes **unmodified** — in particular `toEqual({})`, `toEqual({ guia: 1 })`, `toEqual({ specs: 1 })` and the two `not.toHaveProperty` probes. *Omits Empty Taxonomy Buckets* still holds: a genuinely typeless corpus renders **no** `By type:` line and no output contains the literal `undefined`. `Overview.byType`/`byModule` remain declared `Record<string, number>` and the rendered line format is byte-identical for every corpus not using these two values |
| **5 — the conversion boundary does not reintroduce the defect** (Option A only) | 2 | The conversion is `Object.fromEntries`, not an assigning loop, and Gate 1's `__proto__` descriptor assertion is made against the **returned** object. An assigning conversion yields `undefined` for that descriptor and fails |

**One typing note for whoever writes the tests.** `noUncheckedIndexedAccess: true` makes
`overview.byType["constructor"]` typed `number | undefined`, and `npm run typecheck` covers `test/`.
Assertions must be written to typecheck without weakening what they assert — `expect(typeof x).toBe("number")`
rather than a cast that erases the very distinction Gate 1 exists to make.

## Migration / Rollout

None, and nothing attached. The counters are computed at query time from `listDocuments()`; nothing is
persisted, so there is no on-disk artifact and no `.compendio/` state involved. No schema change, no
DDL, no config key, no port change, no path or ID shape change — `ejemplos/goldenset.yaml` and
`compendio eval` are untouched. **No reindex is needed in either direction**, which is the notable
contrast with `config-value-validation` and `bounded-chunk-size`, whose fixes could not reach an
existing corpus without a full `compendio index`. Here the fix takes effect on the very next
`docs_overview` call, and so does its revert (`git revert` + `npm run build`).

The only residue after a revert is informational: a corpus using these two values goes back to
under-reporting or garbling a bucket. That is the pre-change state.

## Open Questions

1. **Nothing in this design depends on the proposal's question round.** Q1 (class vs occurrence) affects
   scheduling only. Q2 (report the previously-lost bucket, or just count it) — this design **does not**
   add a warning channel: the corrected map is the report, and `formatCounts`'s omission rule stays
   content-based. Reversing that answer would add a surface, not change the fix. Q3 (folder names stay
   unrestricted) is answered **yes** by Decision 4. Q4 (own PR) is the user's 2026-08-15 decision.
2. **The exact wording of the added `mcp-contract` requirement is `sdd-spec`'s.** This design pins only
   *what* it must guarantee: a declared `type`/`module` value is counted as an own numeric entry
   regardless of the string, and the bucket-omission rule of `:109` applies **only** to a corpus that
   genuinely declares nothing. Decision 5's self-consistency invariant is the shape worth writing into
   a scenario, because it is the one a reader can check against a rendered response without knowing the
   corpus.
3. **Option B remains a one-paragraph reversal** (Decision 1) if a reviewer weighs the smaller diff above
   the two inputs that decided the fork. The reversal cost is stated there so it does not have to be
   re-derived.
