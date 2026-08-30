# Verify Report: auto-discover-markdown-roots

## Verdict

**PASS** (no CRITICAL findings; two SUGGESTION-level notes recorded)

## Mode

Full artifact set present: proposal, design, 4 spec deltas, tasks (17/17 checked), apply-progress (4 remediation addenda). All four dimensions verified: completeness, correctness, coherence, evidence quality. Runtime evidence re-collected independently in this pass, not merely quoted from apply-progress.md.

## Completeness (Task Checklist vs Implementation)

All 17 tasks in tasks.md are checked. Cross-checked each against actual source/test diffs (not just the checkbox):

| Task | Claim | Verified against |
|---|---|---|
| 1.1-1.3 | Config: DocumentationRootSelection, ENOENT-only discovery, no hidden default | src/infrastructure/config.ts:79-157 - DEFAULT_CONFIG has no docsDir; resolveRootSelection throws on non-array/non-string docsDir; isNotFoundError gates ENOENT only |
| 1.4-1.6 | Discovery helper: deterministic order, case-insensitive .md, technical ignores, symlink refusal, abort-vs-empty | src/infrastructure/fs/discover-markdown-roots.ts - compareRaw raw code-point sort, toLowerCase().endsWith(".md"), DISCOVERY_IGNORED_DIRECTORY_NAMES, stat.isSymbolicLink() skip, real fs-backed tests in test/infrastructure/discover-markdown-roots.test.ts (only the abort-vs-continue regression is legitimately mocked) |
| 2.1-2.3 | Discovery-only FileDocumentSource options | src/infrastructure/fs/file-document-source.ts:24-27,41,69-71,96-98 - discoveryMode/trustedRootRealPath, throws (not readErrors.push) on discovery-mode traversal/read failure |
| 2.4-2.6 | Composition wiring, index-md placement, MCP surface, dynamic OpenSpec gate | src/composition.ts:70-133, test/composition.test.ts (23 tests in the "auto-discovered markdown roots" describe block), test/server.test.ts (real Client/InMemoryTransport round trip) |
| 3.1-3.3 | Path round-trips, self-exclusion, three-tool surface | Confirmed live below |
| 4.1-4.2 | Docs updated; build/typecheck/test green | Confirmed live below |

No task found checked-but-unimplemented.

## Spec Compliance Matrix

| Requirement (spec file) | Implementing code | Covering test | Verdict |
|---|---|---|---|
| docsDir explicit array authoritative, no single-string form (configuration) | config.ts:350-406 resolveRoots | test/composition.test.ts "collision guard" describe block | PASS |
| Malformed/wrong-typed docsDir fails, no fallback (configuration) | config.ts:142-157 resolveRootSelection | config.test.ts malformed-docsDir cases | PASS |
| Missing/omitted/[] docsDir -> discovery (configuration) | config.ts:104,155 | config.test.ts:670-682 | PASS |
| Config read failure (EACCES/EIO) fails, does not broaden (configuration) | config.ts:100-109 non-ENOENT rethrow | config.test.ts mocked EACCES case | PASS |
| Non-object top-level JSON shape rejected (configuration, remediation) | config.ts:118-120 | config.test.ts:684-695 it.each(literal, 42, empty array, null) | PASS - genuinely falsifiable, toThrow on 4 distinct malformed shapes |
| Root-alias-prefixed path, always (indexing) | dynamic-discovery-document-source.ts + FileDocumentSource(root.dir, exclude, root.prefix, ...) | composition.test.ts:234-248 round-trip test | PASS |
| Discovery scans top-level only, ignores technical dirs, no symlinks, aborts on scan failure (indexing) | discover-markdown-roots.ts:23-41,74-91 | discover-markdown-roots.test.ts (6 tests, including a real symlink test and a mocked EACCES-mid-scan test) | PASS |
| exclude semantics unchanged for discovery roots (indexing) | FileDocumentSource.isExcluded shared between modes (file-document-source.ts:114-119) | No dedicated discovery-mode exclude test, but the same isExcluded method is used unconditionally regardless of discoveryMode -- structurally guaranteed rather than independently tested | PASS structural |
| Whole current OpenSpec corpus discoverable, dynamically counted (indexing) | composition.ts discovery wiring | composition.test.ts:286-298 copies real openspec tree, computes expected set via collectMarkdownPaths, asserts exact equality | PASS - strong, non-vacuous, would fail if even one nested or archived file were dropped |
| Nested roots not created independently (indexing) | discoverMarkdownRootDetails only scans top-level readdirSync(projectRoot), recursion happens inside containsMarkdown/traversal, never re-registers a root | discover-markdown-roots.test.ts "ignores technical directory names recursively without ignoring openspec" | PASS |
| Unreadable existing root aborts sync, no mutation (indexing) | file-document-source.ts:61-71 root ENOENT/EACCES throw in discovery mode; composite-document-source.ts:85-91 failOnRootError | composition.test.ts:300-329,420-445 (4 distinct abort-preserves-rows tests) | PASS |
| INDEX.md self-exclusion under any root count/discovery (index-md) | composition.ts:123-133 indexTarget.selfPath computed from mode | cli-subprocess.test.ts:503-524, composition.test.ts:260-284 | PASS |
| Discovery mode writes project-root INDEX.md; --dir and explicit mode write inside their root (index-md) | composition.ts:123-133 | composition.test.ts:260-284, cli-subprocess.test.ts:513-524 | PASS |
| Root-alias-prefixed path flows through all 3 MCP tools, round-trips (mcp-contract) | server.ts unchanged surface plus discovery-shaped path from composition.ts | server.test.ts:265-303 real MCP Client and InMemoryTransport, search-then-read round trip | PASS - strongest evidence in the suite, a real protocol-level client not a direct handler call |
| Exactly 3 tools exposed (mcp-contract) | server.ts tool registration (unchanged) | server.test.ts tool list assertions, internals check plus live client.listTools() | PASS |

## Design Coherence

| Design decision | Followed? | Evidence |
|---|---|---|
| Discovery-mode fail-closed traversal (vs explicit tolerance) | Yes | composite-document-source.ts:85-91 failOnRootError only set true from dynamic-discovery-document-source.ts:40; explicit mode's CompositeDocumentSource construction in composition.ts:100-110 passes no options, defaulting to per-root tolerance |
| Per-pass rediscovery (not frozen at container construction) | Yes | DynamicDiscoveryDocumentSource.discover() calls discoverMarkdownRootDetails fresh every invocation, not cached; composition.test.ts:331-351 "discovers a new top-level markdown root on a later sync pass without rebuilding the container" genuinely exercises this |
| Previously-indexed-alias revalidation on fresh containers | Yes | dynamic-discovery-document-source.ts:23-27,44-51 unions current discovery with indexedRootAliases() derived from store.listDocuments(), validates each via validateDiscoveredRootAlias; composition.test.ts:353-373 closes the container and reopens before asserting the abort, the correct test shape since a cached in-memory root list would pass a same-process test but fail this one |
| Alias prefixing of every emitted path (both modes) | Yes | verified above |
| Explicit-mode invariance (unchanged tolerance/traversal) | Yes | file-document-source.ts gates every discovery-only branch behind this.options.discoveryMode === true; explicit-mode tests in composition.test.ts's collision-guard and docsDir-override blocks remain green with no discovery-mode leakage |
| Root-replacement-after-construction protection (late-added addendum) | Yes | path-containment.ts plus trusted-realpath pinning in discover-markdown-roots.ts, file-document-source.ts and composition.ts; composition.test.ts:447-474 creates a real junction replacing an indexed root mid-session and asserts the sync rejects and preserves rows, independently re-run in this verify pass, completed in 41ms, took the real code path and not the Windows early-return escape hatch |
| rootPrefixes mutable-array live sharing for module inference | Yes | composition.ts:83,99 passes the same array reference into both createConventionPolicy (closed over by createLoosePolicy, domain/convention.ts:73-87) and DynamicDiscoveryDocumentSource, which splices it in place (dynamic-discovery-document-source.ts:53-55), correctly live-updating rather than a stale snapshot |

No design deviations found beyond the ones already self-disclosed in apply-progress.md's four addenda, which are accurate and match the code as it stands.

## Evidence Quality (adversarial pass, this repo's documented failure mode)

Checked specifically for vacuous tests, since this repo has prior incidents of false-green reports:

- No it.only or describe.only anywhere in test/ (repo-wide grep, zero matches); CI=true's forbidOnly guard is also structurally redundant-safe here.
- discover-markdown-roots.test.ts's symlink-refusal test uses a real fs.symlink junction against a real temp directory, not a mock; the assertion (toEqual with a positive array) is a positive, falsifiable claim, not existence-only.
- composition.test.ts's dynamic OpenSpec path-set gate computes its expected set by walking the actual copied openspec tree at test-run time and asserts exact array equality against the indexed document paths; this cannot pass by accident, a single missed nested or archived file breaks it.
- The MCP contract test goes through a real SDK Client plus InMemoryTransport, not a direct handler function call; materially harder to fake green than a unit-level call into the registered tool handler.
- Re-ran the root-replacement junction test standalone; passed in 41ms, confirming it takes the real assertion path on this Windows machine rather than silently short-circuiting through the documented platform-permission escape hatch.
- One grep-based check exists in apply-progress.md for locating stale docs prose, but it was used only to find text for a human/agent edit, not as the actual regression gate; the real gates are the code/test pairs above, so this does not carry the grep-blind-to-camelCase risk this repo has hit before.

No vacuous test or gate found in this pass.

## Documentation Claims (AGENTS.md, README.md)

Every new claim in the diffs was checked against the current code, not assumed:

- The root-selection and malformed-config claims match config.ts and its it.each malformed-shape test exactly.
- The dynamic per-pass rediscovery claim matches DynamicDiscoveryDocumentSource.discover() being called fresh on each pass.
- The alias-revalidation-on-fresh-container claim matches validateDiscoveredRootAlias and is directly exercised by the freshly-reconstructed-container test.
- The claim that a still-readable, now-empty discovered root is still traversed so legitimate deletions reconcile normally matches how aliases are kept in the selected-root set regardless of current Markdown content, and is logically consistent with resolveRoots and FileDocumentSource producing zero files without throwing.
- README's --dir and INDEX.md placement claims match the composition wiring and the placement tests.
- No false or stale claim found in either file's diff.

## Build, Typecheck, Test -- Re-run Independently in This Verify Pass

| Command | Result |
|---|---|
| npm run build | PASS, tsc clean |
| npm run typecheck | PASS, tsc --noEmit and tsc -p tsconfig.test.json clean |
| CI=true npm test | PASS, 52 test files, 908 tests passed, 1 skipped (a platform-specific off-Windows-only case, correctly skipped on this win32 machine) |

Numbers match the orchestrator's independently-reported pre-check and apply-progress.md's own final run exactly; no drift between claimed and actual state.

## Findings

No CRITICAL findings.

No WARNING findings.

SUGGESTION 1 -- The indexing spec's requirement that existing exclude semantics still apply to discovery-selected roots has no dedicated discovery-mode exclude test; compliance rests on FileDocumentSource.isExcluded being shared, unconditional code rather than an independently asserted behavior for the discovery path specifically. Low risk since the sharing is structural, not incidental, but a future refactor that special-cases discovery exclude handling would have no direct regression test to catch a mistake.

SUGGESTION 2 -- The root-replacement regression in composition.test.ts contains a documented early-return on Windows if junction creation fails due to permissions, which would silently pass without exercising the assertion. Verified independently in this pass that it does not take this path on the current machine (41ms real pass), but CI runners with different Windows privilege or Developer-Mode configuration could silently degrade this test to a no-op. Consider asserting junction creation succeeded (fail loudly) rather than warn-and-return, or gating via it.skipIf with an explicit skip reason so a silent pass is distinguishable from a real one in CI output.

## Working Tree State

Nothing committed (13 modified plus 6 untracked files remain in the working tree, as expected pre-archive). Verification performed read-only; no production code, tests, or docs were modified as part of this verify pass.

## Next Recommended

sdd-archive

## Post-Verify Remediation (2026-08-30)

SUGGESTION 2 is resolved. `test/composition.test.ts`'s "preserves indexed documents when a
discovered root is replaced by a link to external markdown" no longer warns-and-returns when
`symlink(..., "junction")` fails on win32. Junctions are creatable without elevation on Windows —
that is why `"junction"` was chosen over a plain symlink — so a failure there is a real environment
problem, not a permission tier to tolerate. The branch is removed and the call now throws on every
platform, symmetric with the previous non-win32 path. A silent `return` left the test green while
asserting nothing.

Non-vacuity was proven against a known-broken state, not assumed:

| Falsification attempt | Result |
|---|---|
| Replaced `symlink` alternative only: `/ZZZNOPE_symlink\|realpath\|trusted\|documentation root/i` | **PASSED — falsification invalid.** The surviving alternatives still matched. Breaking one branch of an alternation does not falsify the assertion. |
| Replaced the whole regex: `/ZZZ_IMPOSSIBLE_ZZZ/` | **RED, as required.** The assertion is genuinely reachable and can fail. |

Both edits were reverted; the committed assertion is unchanged.

| Command | Result |
|---|---|
| `npx vitest run test/composition.test.ts -t "replaced by a link to external markdown"` | Passed — real assertion path taken (the junction was created). |
| `npm run typecheck` | Passed. |
| `CI=true npm test` | Passed — 52 files, 908 tests, 1 skipped. |

SUGGESTION 1 (no dedicated discovery-mode `exclude` test) remains open as recorded debt.
