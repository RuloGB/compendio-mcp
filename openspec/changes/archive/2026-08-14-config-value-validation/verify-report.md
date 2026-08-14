# Verify Report: Config Value Validation

**Change**: `2026-08-14-config-value-validation` - **Mode**: full artifacts (proposal, design, two spec deltas, tasks) - **Branch**: `fix/config-value-validation` (4 commits on `main` at `fce813f`) - **Verified by**: independent re-execution, not trust in prior reports.

## Verdict: PASS WITH FINDINGS

All five proposal gates and design's Gate 6 hold under independent re-execution (742/742 tests, clean typecheck, clean build, unchanged ejemplos eval numbers). One WARNING-level architecture deviation was found that no gate or spec covers. No CRITICAL issues found.

---

## Commands re-run independently (not trusted from the orchestrator's numbers)

| Command | Result |
|---|---|
| `npm test` | 742/742 passed, 45 files, 12.46s. Matches claimed baseline exactly. |
| `npm run typecheck` | Clean (tsc --noEmit and tsc -p tsconfig.test.json), no output. |
| `npm run build` | Clean (tsc), no output. |
| `node dist/cli.js --root ejemplos eval` | 0 bytes on stderr. stdout: hybrid recall@5 = 1.00, MRR = 0.943, 0 failures; lexical recall@5 = 0.95, MRR = 0.856, 1 failure (alta-leads.md, unaffected by this change, pre-existing lexical gap). Matches the claimed baseline exactly. |
| Deliberately bad config (chunk.maxtokens typo, chunk.maxTokens: "600", search.k: 0) into index --lexical | Exactly three config-related WARNING lines on stderr, in this order: chunk.maxtokens unrecognized config key ignored; chunk.maxTokens invalid declared value "600" falling back to 480; search.k invalid declared value 0 falling back to 5. Matches the claimed baseline exactly (two unrelated warnings also appeared, about no indexable content and embeddings unavailable, artifacts of the throwaway single-doc fixture, not the change under test). |

## Gate-by-gate (proposal.md Success Criteria + design.md Gate 6)

### Gate 1 - spec violation reproduced, then closed (BLOCKING) - PASS

`test/application/chunk-bound-config.test.ts` indexes the `test/fixtures/strict/` corpus under `{"maxTokens":0}`, `"abc"`, `null`, `1e400`, `"600"` (quoted), `600`, and `1`. `tasks.md`'s recorded "before" measurement (796 chunks / 1-token max vs. control's 5 chunks / 59-token max for `0`/`NaN`/`null`, a 159x explosion) is consistent with the design's reachability table and was independently reproduced end-to-end: all invalid-shape runs now resolve to 480 and match the control's chunk count under `npm test`. The corrected fixture table (design.md's replacement of the proposal's naive `"480"`-explodes claim) is exactly what's implemented, the quoted `"600"` case is present as the row whose "before" state was honored-at-600, not exploded, and it now correctly falls back to 480. Covering tests exist and pass at runtime, not just source-inspected.

### Gate 2 - search.k config default validated (BLOCKING) - PASS

`chunk-bound-config.test.ts`'s "search.k config default (Gate 2)" block: `k:0` returns a non-empty result with `noMatchReason` undefined (was `[]` with no reason before); `k:"abc"` succeeds (was a store-layer NaN LIMIT throw before, confirmed in `tasks.md`'s 1.3 note: a "datatype mismatch" error); `k:5.01` falls back to 5; explicit per-call `k:5` overrides an invalid config default. Confirmed `server.ts:141`'s `z.number().int().min(1).max(20)` and `cli.ts:285`'s `parsePositiveInt` are byte-for-byte untouched (git diff shows only an added import line and warning-render lines in cli.ts; server.ts's only change is passing `container.configWarnings` into `formatOverview`, not touching the tool's Zod schema).

### Gate 3 - valid values untouched, nothing clamped (BLOCKING) - PASS

Verified `config.test.ts:61` (chunk.maxTokens: 600 resolves to 600) and the sync.throttleMs: 100 case are the same pre-existing test bodies, present and passing, not rewritten. chunk.maxTokens: 1, search.k: 3 both honored unclamped in both `config.test.ts` and `chunk-bound-config.test.ts`. sync.throttleMs behavior is confirmed byte-identical in Slice 1 (renamed validThrottleMs to positiveNumber, same predicate) and only gains reporting in Slice 2, exactly as design Decision 7 specifies.

### Gate 4 - rationale comment true of every branch - PASS

`config.ts`'s embeddings, chunk, and mergeConvention's frontmatterFields branches are now explicit key-by-key builds (verified in the diff, not just prose), git diff shows the spreads (`{ ...base.embeddings, ...override.embeddings }` etc.) replaced with per-key `??`. Unknown-key tests exist for all three branches plus search's pre-existing case. The partial-frontmatterFields-merge test (config.test.ts:104, tagged es-frozen, a partial `{type: "tipo"}` still yields identity defaults for module/status) is present unmodified.

### Gate 5 - nothing else moved - PASS

npm test/typecheck/build all clean (re-run independently, see above). ejemplos eval numbers unchanged. `git diff main...HEAD -- test/infrastructure/config.test.ts` shows exactly one modified line across both slices, the import statement widened to bring in formatConfigWarning, loadConfigReport, type ConfigWarning, and zero modified assertions; every it()/it.each() block from main is present verbatim (spot-checked line 61, the throttleMs 100 case, and the partial-frontmatterFields case at 104-114). This satisfies the letter of "additions only" (the import line is mechanical, not an assertion change), but see Finding 2 below on how literally to read "no existing case was modified."

### Design Gate 6 (a)-(e) - warning visible where a user actually is - PASS

(a) One ConfigWarning per invalid value / unknown key / inverted pair, confirmed via config.test.ts's loadConfigReport describe block (invalid-value across 4 keys, unknown-key across 5 cases including the legacy search.excludedStatuses, inverted-bounds x1, plus a negative case that a non-inverted pair does not fire). (b) warnings equals [] on a clean declared config and on no config file at all, both cases present and passing. (c) formatOverview's Config: block renders only when configWarnings is non-empty and defined; the get-overview.test.ts regression test explicitly re-confirms the 2-arg call site (representing every existing caller, including the docs_overview response construction path) never contains "Config:". (d) Independently reproduced: dist/cli.js index --lexical against an invalid config prints WARNING lines on stderr, exits 0, stdout unaffected (cli-subprocess.test.ts's new describe block, plus my own manual repro above). (e) search_docs's handler in server.ts was not touched by this diff (git diff shows only the docs_overview tool handler's formatOverview call gained the third argument); the response-shape assertion in get-overview.test.ts explicitly guards this.

---

## Task honesty (tasks.md, 40 boxes)

Spot-checked rather than trusted: every phase's checked box has corresponding code and/or a passing test. Two items worth flagging as process, not substance, findings:

- Finding 3 (SUGGESTION): tasks.md's phases 1.2 and 4.1 instruct "Record ... in apply-progress.md," but no apply-progress.md file exists in the change folder, the measurements were instead recorded inline as sub-bullets under the task boxes themselves. The content is present and consistent with the design's reachability table (796 chunks / 1-token max vs. control's 5 / 59 for the exploding cases), so nothing is actually missing, but the artifact-location instruction in tasks.md was not followed literally.
- Provenance note honored: the task's instruction to treat Slice 2 with extra suspicion (found already-written, uncommitted, before being verified or committed) was acted on, Slice 2's diff was read in full against design.md's Decisions 5-8 rather than spot-checked, and its tests were independently re-run rather than trusted. No discrepancy between Slice 2's code and its design was found beyond Finding 1 below.

All 40 boxes reflect real, tested work. No CRITICAL "checked box, no corresponding code" findings.

---

## Design decisions honored

| Decision | Status |
|---|---|
| positiveNumber (three thresholds) vs positiveInteger (search.k) | Honored, confirmed in config.ts diff; positiveInteger calls positiveNumber then Number.isInteger, exactly as drafted in design.md Decision 3. |
| No clamping | Honored, maxTokens: 1, throttleMs: 100, k: 3 all pass through unclamped, tested at both the unit (config.test.ts) and integration (chunk-bound-config.test.ts) layers. |
| sync.throttleMs observable behavior unchanged in Slice 1, reported starting Slice 2 | Honored, same predicate under a new name in Slice 1 (no spec delta needed, none written); Slice 2 adds warning emission and the corresponding spec delta at configuration/spec.md's sync requirement. |
| Explicit whitelists replacing spreads (embeddings, chunk, convention.frontmatterFields) | Honored, confirmed in the diff; all three converted from spread to key-by-key build. |
| Clean config reports nothing | Honored, warnings equals [] tested on both "declares only valid/recognized keys" and "no config file at all," and formatOverview/CLI both omit any warning output in that case (tested). |

---

## Findings

### Finding 1 (WARNING) - Hexagonal-boundary violation: application/get-overview.ts imports directly from infrastructure/config.ts

`src/application/get-overview.ts:3`:

```ts
import { formatConfigWarning, type ConfigWarning } from "../infrastructure/config.js";
```

This is the only `src/application/**` to `src/infrastructure/**` direct import in the entire codebase (`grep -r 'from "../infrastructure' src/application` returns exactly this one line). CLAUDE.md's Architecture section states as a hard rule: "The domain layer has zero dependencies on SQLite, transformers.js, or the filesystem, those live only in infrastructure/ behind ports" and "use cases never import from infrastructure/ directly." GetOverview and formatOverview in get-overview.ts are use cases in application/, and this import crosses the boundary the project's own stated architecture forbids.

Design.md's Decision 5 justifies putting ConfigWarning and formatConfigWarning in config.ts by analogy to the existing EncodingNotice/formatEncodingNotice pair, but that pair actually respects the boundary this violates: EncodingNotice is a domain type (src/domain/ports.ts) and formatEncodingNotice lives in application/index-documents.ts, not in an infrastructure adapter. The new code puts both the type and its formatter in infrastructure/config.ts and then has an application-layer file import them directly. The analogy was used to justify the shape of the mechanism (a returned data value plus a pure formatter) but the actual placement inverts the layering the cited precedent demonstrates.

Impact: does not break any test or spec, behaviorally correct, npm run typecheck/build are clean because application/ is not physically prevented from importing infrastructure/ (no lint or dependency-cruiser rule enforces the boundary; it is convention only). This is a design-time cost, not a runtime one: application/ no longer compiles independently of a concrete infrastructure adapter for this one file, and the pattern is a plausible next place someone copies from.

Recommended fix (out of scope for this verify pass, for the record): move ConfigWarningKind/ConfigWarning to domain/ports.ts (or a small domain module) and formatConfigWarning to an application/ module, leaving infrastructure/config.ts to produce ConfigWarning values without owning the type, mirroring EncodingNotice exactly rather than by analogy only.

### Finding 2 (SUGGESTION) - "Additions only" is true of every assertion, not of every line

Gate 5's third bullet and Decision 5's stated constraint are "no existing test in config.test.ts is modified, only added to." The literal diff has exactly one non-additive line: the import statement was widened from a single-line import to a multi-line one to bring in the four new names. No existing it()/it.each() body, description string, or assertion changed. This satisfies the gate's actual intent (verified: git diff confirms zero assertion-line changes), but a reviewer reading "additions only" as "zero non-plus lines" would flag the import-line diff as a false negative. Recording this so it is not rediscovered as a surprise at archive time.

### Finding 3 (SUGGESTION) - apply-progress.md referenced but not created

See Task Honesty section above. The measurements tasks.md instructs to record in apply-progress.md were instead recorded inline in tasks.md. Content is present and correct; only the file-location instruction was not followed.

---

## Spec-to-test mapping (both deltas)

| Spec requirement | Scenario | Covering test | Result |
|---|---|---|---|
| configuration: Declared Numeric Configuration Values Are Validated | invalid chunk.maxTokens falls back | config.test.ts (INVALID_NUMERIC cases) + chunk-bound-config.test.ts Gate 1 | PASS |
| same | search.k falls back when invalid/non-integer | config.test.ts + chunk-bound-config.test.ts Gate 2 | PASS |
| same | valid value honored, never clamped | config.test.ts line 61, throttleMs case (pre-existing) + new 1/3 cases | PASS |
| configuration: Config Load Reports Invalid Values and Unrecognized Keys | invalid value reported | config.test.ts's loadConfigReport block + cli-subprocess.test.ts | PASS |
| same | unrecognized key reported | same + legacy search.excludedStatuses case | PASS |
| same | inverted pair reported, not corrected | config.test.ts's inverted-pair describe block | PASS |
| same | clean config reports nothing | config.test.ts "warnings is []" cases x2 | PASS |
| configuration: chunk.maxTokens bound (MODIFIED) | invalid value cannot defeat the bound | chunk-bound-config.test.ts Gate 1 (maxObservedTokens <= resolvedMaxTokens) | PASS |
| configuration: sync.throttleMs (MODIFIED) | invalid throttle falls back and is reported | config.test.ts's sync.throttleMs report case | PASS |
| configuration: excludedStatuses legacy key (MODIFIED) | silently dropped but presence reported | config.test.ts's legacy-key unknown-key case | PASS |
| mcp-contract: Config-Warning Visibility in docs_overview | block renders when warnings present | get-overview.test.ts + server.ts's wired call site | PASS |
| same | clean config omits block | get-overview.test.ts (undefined and [] cases) | PASS |
| same | persists across repeated calls | get-overview.test.ts "renders on every call" case | PASS |

Every scenario in both spec deltas has a passing covering test, confirmed at runtime via the full npm test run, not asserted from source inspection alone.

---

## Asserted-unchanged items - confirmed

- search_docs's response shape: unchanged (server.ts's search_docs handler untouched by this diff; regression test in get-overview.test.ts guards the formatOverview 2-arg call path).
- scripts/rank-probe.mjs, scripts/vector-reach.mjs: git diff main...HEAD for both is empty.
- src/domain/**, src/infrastructure/sqlite/**, src/infrastructure/fs/**: untouched (only src/infrastructure/config.ts, composition.ts, cli.ts, server.ts, application/get-overview.ts changed in src/).

## Accepted behavior change - confirmed real and documented

chunk.maxTokens: "600" (quoted number) was honored today via JS relational coercion (estimateTokens(x) <= opts.maxTokens, verified against every call site in split-text.ts) and now falls back to 480 (with a reported warning from Slice 2 onward). Independently confirmed via the chunk-bound-config.test.ts "600" case and documented in both CLAUDE.md (Non-obvious decisions bullet) and README.md (config table), each diff read in full above.

---

## Would I ship this?

Yes, with Finding 1 filed as a follow-up (not a blocker): it is a real convention deviation worth fixing before the pattern gets copied again, but it does not violate any spec, does not fail any test, and does not change observable behavior. Findings 2 and 3 are recordkeeping notes, not defects.

## Result summary

- Status: PASS WITH FINDINGS
- CRITICAL: 0
- WARNING: 1 (Finding 1, hexagonal-boundary violation in get-overview.ts)
- SUGGESTION: 2 (Finding 2, additions-only import-line nuance; Finding 3, apply-progress.md not created)
