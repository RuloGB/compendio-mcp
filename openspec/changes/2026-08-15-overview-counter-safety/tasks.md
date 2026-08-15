# Tasks: `docs_overview` Taxonomy Counters Must Not Lose or Corrupt a Bucket

**Phase**: tasks · **Artifact store**: openspec (Engram unavailable this cycle) ·
**Skill resolution**: paths-injected (`work-unit-commits`).

**Execution mode**: `strict_tdd: true`. For every behavioral task below, write the test, run
`npm test` and observe it fail for the stated reason, then write the minimum implementation that
makes it pass. The single declared exception is Task 1 (Gate 3), which is written once and is
expected to pass **before and after** the fix — do not treat an already-green Task 1 as a mistake.

**Delivery**: `delivery_strategy: exception-ok`, one PR. Forecast ~80–180 changed lines (proposal,
*Delivery size*); if the actual diff exceeds 400 lines, record a `size:exception` note in the PR
description rather than splitting — do not split regardless of the forecast.

**Normative source for the fix**: design.md Decision 1's code block is copied verbatim in Task 3,
not paraphrased or re-derived.

---

## 1. Non-regression baseline — prototype integrity (Gate 3, Decision 6)

Spec link: none directly (this gate pins the proposal's *framing*, not a scenario). Design link:
Decision 6.

Write this first, independent of the fix, because it is the assertion that keeps this change
classified as a data-integrity bug rather than a security fix for the rest of its life.

- [x] 1.1 In `test/application/get-overview.test.ts`, add a `describe` block (e.g.
      `"GetOverview — prototype integrity (non-regression, Gate 3)"`) that runs
      `GetOverview.execute()` over a corpus seeded with `type: "__proto__"` and
      `type: "constructor"` documents (via the existing `seed()` helper) and asserts, in this exact
      form:
      - (a) `Object.getOwnPropertyNames(Object.prototype)` captured before the call equals the same
        capture taken after.
      - (b) `Object.keys({}).length === 0` on a **fresh, unrelated** object literal created after the
        call.
      - (c) `({}).constructor === Object` and `Object.getPrototypeOf({}) === Object.prototype`,
        both asserted **after** the call.
- [x] 1.2 **Forbidden predicate — do not write it, and do not let it survive review.**
      `Object.prototype.hasOwnProperty('__proto__') === false` MUST NOT appear anywhere in this
      test. `__proto__` genuinely is an own accessor property of a healthy `Object.prototype`; this
      predicate reports a false positive. If this predicate appears in the diff, reject the diff —
      do not "fix" the assertion by weakening it further.
- [x] 1.3 Run `npm test`. This block is expected to be **green immediately**, on the pre-fix tree —
      that is Gate 3's declared, correct outcome, not a sign the test is vacuous. Confirm assertion
      (c) specifically fails to distinguish "before" from "after" (it doesn't — that's the point: it
      is a standing invariant, not a reproduction).

**Work unit**: standalone commit. It does not depend on, and is not depended on by, the fix — it
can land before, after, or interleaved with Tasks 2–4 with no rebase cost.

---

## 2. Red — reproduce both failure shapes through the real application path

Spec link: the ADDED requirement *`docs_overview` Taxonomy Counters Are Safe For Any `type`/`module`
Value* (`specs/mcp-contract/spec.md`), all 5 scenarios. Design link: Decisions 1, 5; Gates 1 and 2.

All of 2.x must be written and observed **failing** on the current tree before any of Task 3 is
written. Do not implement the fix piecemeal against a partial red set.

- [x] 2.1 `byType`, `__proto__` (spec Scenario 1). Seed a document with `type: "__proto__"` via
      `seed()`, call `GetOverview.execute()`. Assert:
      - `Object.keys(overview.byType)` does **not** contain `"__proto__"`.
      - `formatOverview(overview)` renders no count for it (no `__proto__ (1)` substring).
      Run `npm test` — confirm this fails in the stated way. If it passes on the unfixed tree, STOP:
      the defect did not reproduce through the application path and this change's justification
      needs re-examination before continuing.
- [x] 2.2 `byType`, `constructor` (spec Scenario 2). Seed a document with `type: "constructor"`.
      Assert `typeof overview.byType.constructor === "string"` (not `"number"` — presence alone is
      not enough, per design's explicit warning against a presence-only assertion) and that
      `formatOverview(overview)` contains `native code`. Confirm this fails on the current tree.
- [x] 2.3 `byModule`, `__proto__`, reached via the production route (spec Scenario 3, design
      Decision 5's link chain — **no fixture directory on disk**):
      ```ts
      const policy = createConventionPolicy({ mode: "loose", ... }, ["docs"]);
      const result = policy.resolver({
        path: "docs/__proto__/a.md",
        title: "A",
        summary: "content",
        data: {},
        hash: "h",
      });
      expect(result.meta.module).toBe("__proto__"); // link 1: inferModule genuinely produces it
      seed(store, { path: "docs/__proto__/a.md", module: result.meta.module, ... }); // link 2: seed with the returned meta, not a hand-written string
      ```
      Then assert `Object.keys(overview.byModule)` does not contain `"__proto__"` and
      `formatOverview` renders no `By module:` line naming it. **Do not** commit a directory
      literally named `__proto__/` or `constructor/` anywhere in the repo — design Decision 5
      rejects this explicitly; it buys no coverage `FileDocumentSource` doesn't already get for
      free from the path string.
- [x] 2.4 `byModule`, `constructor`, same production-route pattern as 2.3 with
      `path: "docs/constructor/a.md"` (spec Scenario 4). Assert
      `typeof overview.byModule.constructor === "string"` on the unfixed tree.
- [x] 2.5 Confirm all four of 2.1–2.4 fail on `npm test` for the reasons stated, not for an
      unrelated reason (e.g. a typo in the seed call). This is the STOP gate for the whole task
      list: implementation work in Task 3 does not begin until this is confirmed.

**Work unit**: not committed standalone (a red-only commit leaves `npm test` failing, which
contradicts the work-unit-commits checklist's "repo still makes sense after applying only this
commit"). Folded into the Task 3 commit.

---

## 3. Green — implement the safe accumulator (Decision 1, normative)

Spec link: same requirement as Task 2. Design link: Decision 1's code block (copied verbatim),
Decision 2 (defining-not-assigning), Decision 3 (renderer unchanged — asserted).

- [x] 3.1 In `src/application/get-overview.ts`, replace the `byType`/`byModule` accumulation in
      `GetOverview.execute` with design.md Decision 1's code block verbatim: two
      `Map<string, number>` accumulators (`byType.set(k, (byType.get(k) ?? 0) + 1)` /
      `byModule.set(...)` — same pattern), converted at the return with
      `byType: Object.fromEntries(byType)` / `byModule: Object.fromEntries(byModule)`. Keep both
      comment blocks from the design (the accumulator comment explaining the plain-object hazard,
      and the conversion comment forbidding an assigning loop) — they are the durable layer of
      Decision 2's three-layer enforcement, not optional prose.
- [x] 3.2 **Do not** write the conversion as `for (const [k, v] of byType) out[k] = v`. This performs
      the identical `[[Set]]` the original defect is made of, relocated from accumulation to
      conversion, and it looks correct in review. `Object.fromEntries` is the only accepted form
      (`Object.defineProperty` in a loop is the only acceptable alternative, and there is no reason
      to prefer it here).
- [x] 3.3 Run `npm test`. Tasks 2.1–2.4 must now pass, asserting the **type**, not just presence:
      - `Object.getOwnPropertyDescriptor(overview.byType, "__proto__")` is a data descriptor with
        `value: 1` (design Decision 2, Layer 2 — asserted against the **returned** object, never
        the internal `Map`; this is what makes an assigning conversion fail even if 3.1 were
        written wrong).
      - `typeof overview.byType.constructor === "number"` with the correct count.
      - The `byModule` equivalents from 2.3/2.4.
- [x] 3.4 Add the mixed-corpus case (spec Scenario 5): one document each typed `__proto__`,
      `constructor`, and an ordinary value (e.g. `guide`). Assert all three counts are correct and
      the ordinary value's count is unaffected by the other two.
- [x] 3.5 `noUncheckedIndexedAccess: true` makes `overview.byType["constructor"]` type
      `number | undefined`. Write assertions that typecheck without weakening what they assert —
      `expect(typeof x).toBe("number")`, not a cast or non-null assertion that erases the
      distinction Gate 1 exists to make. Run `npm run typecheck` to confirm `test/` typechecks
      clean.

**Work unit**: this commit is Tasks 2 + 3 together (red tests + the fix that turns them green) —
the work-unit-commits skill requires tests to ship with the behavior they verify, and a red-only
predecessor commit would fail `npm test` on its own.

---

## 4. Close the remaining gates on the same tree

Spec link: same requirement (self-consistency backs Scenarios 1–4; Gate 4 backs the sibling
*Omits Empty Taxonomy Buckets* requirement, unaffected by this change). Design link: Decision 5
(self-consistency + anti-vacuity), Decision 4 (twin-corpus differential for `byModule`), Gate 4.

- [x] 4.1 **`byType` self-consistency invariant (Gate 1b) — its own task, not a sub-bullet of 3.4.**
      Write a helper that parses `formatOverview`'s rendered per-document `[type]` segments and its
      `By type:` line, and asserts every `type` shown in a per-document segment appears in the
      `By type:` line with a matching count. Run it against the hostile corpus from Task 2/3 (fails
      before the fix — a `- [__proto__] a.md` line with no matching `By type:` entry — passes after)
      and against a genuinely typeless corpus (passes on both, so the invariant never fights the
      omission requirement it sits beside).
      **Mandatory anti-vacuity guard**: the helper MUST also assert that the number of per-document
      lines it parsed equals `overview.documents.length`. Without this, a regex that matches nothing
      on both sides passes trivially and the whole gate is noise — call out this exact risk in the
      test's own comment, per design Decision 5, so a later editor cannot delete it as "unused."
- [x] 4.2 **`byModule` twin-corpus differential (Gate 2's second half, Decision 4).** `byModule` has
      no per-document rendering to cross-check against (`formatDocLine` never renders `module`), so
      it needs a different, symmetric gate: build two otherwise-identical corpora — control with
      `module: "guides"`, hostile with `module: "__proto__"` — and assert the *difference in
      `By module:` line presence* is gone after the fix (before: hostile corpus renders no
      `By module:` line at all while control does; after: both render their respective line). This
      is a separate assertion from 2.3/2.4 (which check the value directly) — it exists because a
      value-only check cannot tell "correctly absent" from "silently lost" the way the `byType`
      self-consistency check can.
- [x] 4.3 **Gate 4 — confirm nothing else moved.** Run `npm test`, `npm run typecheck`,
      `npm run build`. Confirm, without modifying a single existing assertion:
      - `test/application/get-overview.test.ts`'s pre-existing cases still pass verbatim, in
        particular `expect(overview.byType).toEqual({})` (empty-corpus omission, line ~42) and
        `expect(overview.byType).toEqual({ guia: 1 })` (partial coverage, line ~59).
      - `test/application/index-and-search.test.ts:330-353` (the alias-aware `byModule` inference
        test) passes unmodified, in particular `expect(overview.byModule).toEqual({ specs: 1 })`
        and its two `not.toHaveProperty("docs"/"openspec")` probes.
      - A genuinely typeless corpus still renders no `By type:` line, and no rendered output
        contains the literal `undefined`.
      - `Overview.byType`/`byModule` are still declared `Record<string, number>` in
        `src/application/get-overview.ts` (no type change), and the rendered line format is
        byte-identical for every corpus not using `__proto__`/`constructor`.
      If any of these fails or required an edit to an existing assertion, STOP — the fix has moved
      the normal path, which is out of scope.

**Work unit**: same commit as Task 3 (all gates for the one behavioral change land together).

---

## 5. Documentation — `CLAUDE.md` clause

Spec link: none (informational). Design link: File Changes table, last row.

- [x] 5.1 Add one small clause to `CLAUDE.md`'s `docs_overview` bullet under *Non-obvious decisions*,
      noting that a `byType`/`byModule` bucket is never lost or garbled by the string value it is
      keyed by, regardless of what that value is (open, project-defined `type`/`module` strings
      include values that collide with an inherited `Object.prototype` member name). Keep it to the
      one clause the design scopes — this is not the place to re-explain the mechanism.

**Work unit**: own commit (docs-only, no test dependency) — cheap to review and cheap to revert
independently of the code fix, per the work-unit-commits checklist.

---

## 6. Final verification and commit sequencing

- [x] 6.1 Run `npm test`, `npm run typecheck`, `npm run build` on the final tree — all green.
- [x] 6.2 `git diff --stat` against `main` — confirm the changed-lines total against the ~80–180
      forecast. If it exceeds 400 lines, record a `size:exception` note in the PR description per
      `delivery_strategy: exception-ok`; do not split the PR regardless.
- [x] 6.3 Confirm the three work units from this file land as three Conventional Commits (or fewer,
      if a reviewer prefers squashing docs into the fix commit — but never a red-only commit):
      1. `test(application): pin GetOverview prototype-integrity as non-regression (Gate 3)`
      2. `fix(application): make GetOverview's byType/byModule accumulation safe for any key value`
      3. `docs: note docs_overview bucket-value safety in CLAUDE.md`
- [x] 6.4 Confirm no unrelated file changed: `src/domain/convention.ts`, `src/server.ts`,
      `src/cli.ts`, `src/infrastructure/sqlite/**`, `src/composition.ts`, and
      `openspec/specs/mcp-contract/spec.md` (already written in `sdd-spec`) are untouched by this
      phase's commits — the design asserts all of these as unchanged.

**Next recommended phase**: `sdd-apply`.
