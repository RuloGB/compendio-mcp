# Design: Production-Owned Retrieval Measurements

## Technical Approach

Implement the approved retrieval-evaluation specification through an opt-in search observer and a local runner; never reproduce ranking. Existing `EvaluateSearch` remains the separate Spanish 22-case document baseline, including its `3*k` over-fetch.

## Architecture Decisions

| Option | Tradeoff | Decision |
|---|---|---|
| Observe production / extend rank-probe replay | Observation needs small application edits; replay can drift | Observe actual execution; preserve fusion, cap, excerpts, contracts and dependencies |
| Stable evidence / database IDs | Evidence needs review; IDs change with indexing | Review sufficient chunks using evidence and content identities |
| Isolated snapshot / live container | Snapshot preparation costs storage; live opening performs DDL and serve synchronizes | Runner uses existing adapters against a private database copy; never starts sync |

## Data Flow

Prepared corpus/index → validated snapshot → reviewed labels → independent production calls → trace/result pairing → pure metrics → local JSON.

Runner wires `SearchDocuments`, `SqliteIndexStore`, `LazyEmbeddings` and `TransformersEmbeddings.create` using `loadConfigReport` values, following `composition.ts`; it is not another search pipeline or public CLI/MCP feature.

Require stopped writers, an existing checkpointed database with absent/empty WAL, and identical source/DB hashes before/after copying. Otherwise refuse; never checkpoint, reindex or repair automatically. Open only the copy. Freeze logical rows/vectors after opening; reject their mutation. Do not invoke `SyncScheduler`. Later corpus preparation precedes freezing.

## File Changes

All creates below are planned, not implemented.

| File | Action | Responsibility |
|---|---|---|
| `src/application/search-documents.ts` | Modify | Optional per-execution observer |
| `src/application/search-trace.ts` | Create | Internal trace types |
| `src/domain/retrieval-evaluation.ts` | Create | Pure label validation/resolution and metrics |
| `scripts/retrieval-baseline.mjs` | Create | Runner, manifests, snapshot, reports |
| `test/application/search-trace.test.ts` | Create | Production parity |
| `test/domain/retrieval-evaluation.test.ts` | Create | Labels/metrics/canaries |
| `test/retrieval-baseline.test.ts` | Create | Runner isolation/threat checks |

## Interfaces / Contracts

`execute(query, observer?)` returns the unchanged `SearchResponse`. Execution-local trace captures every `runSearch` attempt, including filter relaxation and final warnings. Copy observed arrays; callback failures cannot affect search, but incomplete traces invalidate measurement. Disabled observation builds no trace and performs no extra inference.

Versioned JSON contains:
- Manifest: canonical roots; hashes of corpus bytes, raw/effective config, model artifacts, runtime/dependencies, source/compiled code, queries, labels, split assignments, stored chunks/vectors; result digest.
- Label: intent/variant IDs, group/split, reviewed document hash/path, evidence quotes with explicit occurrences, accepted chunk fingerprints `(path, heading, position, contentHash)`, reviewer and rationale. Resolve quotes against unchanged documents; reviewers approve each chunk's independent sufficiency. Overlaps are alternatives, not joint evidence.
- Trace: attempt/filters, candidate limit, ordered lexical/vector IDs, union, unrounded fused scores/ranks, capped IDs/removals, pre-emission slice, emitted chunk-to-result identity, final response.
- Mode: explicit lexical, hybrid, or embedding-fallback; capture existing vector branches (provider absent, vectors absent, empty embedding, caught failure), without extra probes or exposed error text. Empty successful vector lists remain hybrid. Missing ranks carry unavailable/not-in-captured-population reasons, never inferred global ranks.
- Metrics: answer Hit@5/mean, all-three success, nullable first-answer rank within returned results; document metrics separately; elapsed/RSS/peak-process-memory descriptively.

Run k=5 and k=10 independently (current limits 50/100); equal populations are valid. Pair observer-on/off responses exactly. Changed provenance means non-equivalent, even with equal output. Compare pre/post-instrumentation output as a separately labelled behavioral-parity check, never identical-input replay.

## Testing Strategy

Strict RED→GREEN→REFACTOR; `npm test`, Vitest forks. Deterministic tests cover alternative/ambiguous/invalid labels, document-only hits, empty denominator, ties, cap, missing rows, filter retry, all vector branches and observer failures. Known-bad synthetic ranking fails specifically for relevance, with a passing control. Real gates run both corpora separately; historical figures prove nothing new.

## Threat Matrix

| Boundary | Applicability; safe/failure behavior; RED |
|---|---|
| Documentation-like paths | Applicable: never execute corpus text; reject non-Markdown inputs. RED: requirements.txt, CMakeLists.txt, MDX, README.sh; executable Markdown stays inert |
| Git selection | N/A: no Git subprocesses; provenance uses file hashes |
| Commit state | N/A: no staging or commits |
| Push state | N/A: no pushes or refspecs |
| PR commands | N/A: no PR automation |
| Runner paths/process | Applicable: canonical containment, no shell/subprocess, exclusive local outputs; reject traversal/symlink escape before writes. RED each escape and existing-output collision |

## Migration / Rollout

No migration. Store JSON/goldenset/snapshots under Git-ignored `.compendio/evaluation/`, already excluded from discovery; reject overlap with explicit documentation roots. Review 20 intents×3 variants (including refund), freeze intent-group splits before measuring. Synthetic fixtures remain separate. Validate evidence before inspecting rankings; never relabel misses automatically. Real reports require nonempty resolved labels and complete traces, not an accuracy threshold. Compare semantic result digests excluding descriptive timing/memory; retain those observations separately. Preflight prepared model files before inference; missing prerequisites invalidate the requested hybrid baseline, never silently qualify fallback as hybrid.

## Open Questions

None architecturally. External DocuTests2 canonicalization/write authority and prepared model/index remain execution prerequisites; no external writes or measurements occurred.
