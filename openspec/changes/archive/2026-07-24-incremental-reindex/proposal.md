# Proposal: Incremental Reindex — keep a running `serve` fresh

Make `compendio serve` notice `.md` files that were added, edited, or deleted while it runs,
without a manual `compendio index`. Today the index is built exclusively by that explicit CLI
command (a full drop-and-recreate), and a long-lived `serve` process answers every tool call from
the SQLite snapshot captured at startup. Anyone who edits docs mid-session gets stale answers
forever. This change adds an in-process, fingerprint-based incremental sync so the three MCP tools
stay current with zero new dependencies and zero re-embedding of unchanged content.

## Why now

Compendio's entire pitch is zero-config, local, always-available RAG over a project's docs. "You
edited a doc and the assistant still quotes the old version" is the single most credibility-damaging
failure that pitch can have — it silently makes the tool look broken while reporting success. The
fix cannot be "remember to run `compendio index`"; nobody will, and asking them to defeats the
zero-friction promise. The fingerprint primitive this needs (`sha256` per document, already stored
in `documents.hash`) was written into the schema for exactly this purpose and has never been read.
This change finally uses it.

## Intent (success looks like)

- A doc edited while `serve` runs is reflected in `search_docs`/`read_doc`/`docs_overview` within
  one throttle window, without restarting the process or running any command.
- A deleted doc stops appearing in results; a new doc starts appearing — both without a full rebuild.
- Only changed documents are re-parsed and re-embedded; an unchanged corpus costs a cheap diff.
- `compendio index` still exists and still does the authoritative full rebuild.

## Scope (in this change — Phase 1)

| Piece | What it does |
|---|---|
| Diff primitive | Compare the discovered corpus against `listDocuments()` by `ruta`+`hash`. New/changed `ruta` -> (re)index it; DB `ruta` absent on disk -> delete it. |
| Per-document writes | New `IndexStore` operations to delete-by-`ruta` and to (re)index a single document (an upsert path), replacing today's INSERT-only `saveDocument` for the incremental case. |
| Correct SQLite teardown | Per-document delete that correctly removes rows from the FTS5 external-content table and the `vec0` table, and does not orphan `chunks` (see Risks). |
| Triggers | One sync at `serve` startup, plus a lazy throttled staleness check shared by all three tool handlers (they all read the same store per call, so one hook makes every tool fresh). |
| Sync config | A new `sync` config section with a per-project throttle default, following the existing "every key has a default" / "warn-and-ignore retired keys" conventions. |
| Sync visibility | A sync-status field in the `docs_overview` response surfacing incremental `omitidos`/degradation info to the agent. |
| `compendio index` | Unchanged: still the forced full `reset()` rebuild, still the schema-upgrade guarantee. |

## Non-goals (explicitly out of scope)

- **No filesystem watcher (chokidar or similar).** Deferred to a separate future change to isolate
  the new-dependency and cross-platform (inotify limits, editor atomic-save-via-temp, duplicate
  events on Windows) reliability risk. Startup + throttled polling bridges the gap dependency-free.
- **No rename detection.** A rename is delete-old-`ruta` + insert-new-`ruta`. No history/lineage is
  preserved across a rename, by design — the directory walk gives no rename signal.
- **No mtime/size prefilter.** Content-hash-only diff; the `DocumentSource` port keeps its eager
  full-read shape. Splitting it into stat-then-read is real surgery and is deferred until profiling
  shows the read+hash pass is actually slow (unlikely at hundreds of markdown files).
- **External-process concurrency stays a non-goal.** A manual `compendio index` racing a live
  `serve` (two OS processes) remains the existing spec non-goal; this change only defines the new
  *in-process* sync guarantees, and reaffirms rather than drops the external-process caveat.
- **No `INDEX.md` regeneration on the sync cadence.** `compendio index-md` already reads the
  filesystem directly and never lags the DB, so it needs nothing from this change.

## Approach summary

The diff is deliberately simple because the hard part already exists. For each discovered file,
recompute its `sha256` and compare against the stored `hash` for that `ruta` (both already available
from `listDocuments()`): mismatch or unknown `ruta` -> re-index that one document; stored `ruta`
missing on disk -> delete it. No schema change and no `DocumentSource` change are needed for the
diff itself — only new *write* operations on the port.

Triggering is startup + throttle: `serve` runs one sync when it boots, then a shared pre-tool-call
hook runs at most one diff per throttle window. All three tool handlers read the same `IndexStore`
per call with no cache in between, so a single hook point keeps every tool fresh for that window.
The synchronous SQLite work stays strictly proportional to *changed* documents (never a full-corpus
rewrite), which is what keeps the inline diff safe on the same event loop that services the stdio
JSON-RPC transport; re-embedding reuses the already-resident model and is proportional to changed
chunks only.

## Binding product decisions (confirmed by the user 2026-07-24)

These were settled in the pre-proposal question round. They are inputs to this proposal, not open
questions.

| Decision | Choice | Rationale |
|---|---|---|
| Throttle default | **30 seconds**, configurable per project | At most one filesystem diff per 30s window (plus the startup sync). Balances freshness against the cost of re-reading+hashing the corpus on an idle event loop. |
| Sync visibility | **Sync-status field in `docs_overview`** | A long-lived `serve` process's stderr is invisible to most MCP clients; folding sync `omitidos`/degradation into a response the agent already reads makes skips and lexical-only fallbacks actually observable. Touches the `mcp-contract` domain. |
| Old-schema DB at serve | **WITHDRAWN 2026-07-24 — no detection, no mitigation; accepted risk** | Originally a `PRAGMA user_version` marker plus a transparent full rebuild on mismatch. Withdrawn by the user: compendio is in beta with effectively no installed base, so a database generated by an older build breaking is an uninteresting risk. Review also showed the premise was false — the current schema is already nullable and nothing stamps `user_version`, so the gate would have forced a full re-embed on *every* pre-existing database, not just legacy `NOT NULL` ones. Anyone who does hit it deletes `.compendio/` or runs `compendio index` once. A missing DB still needs no special-casing — `migrate()` creates the current schema and the first sync treats everything as new. |

## Impact / blast radius

| Spec domain | Touched? | Why |
|---|---|---|
| `indexing` | **Yes** | New requirements: fingerprint-based diffing, per-document upsert/delete semantics (incl. the FTS5 and foreign-key gotchas), the startup+throttled trigger, read-failure protection against deleting a still-present document or subtree, chunk-granular vector-coverage reconciliation, and a new in-process-sync guarantee split from the existing external-process non-goal. |
| `configuration` | **Yes** | New `sync` config section with a throttle default, following existing default/warn-and-ignore conventions. |
| `mcp-contract` | **Yes** | The new sync-status field in the `docs_overview` response shape. |
| `search` | No | `SearchDocuments` is unchanged; only the freshness of the store it queries improves. |
| `index-md` | No | `GenerateIndexMd` already reads the filesystem directly, independent of this change. |

## Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| **Inert `ON DELETE CASCADE`.** `PRAGMA foreign_keys` is never enabled on the connection, so a per-document `DELETE FROM documents` orphans `chunks`. Never manifested because only `reset()`'s whole-table drop deletes documents today. | CRITICAL (impl) | The delete path MUST either enable `foreign_keys` for the connection or explicitly delete dependent `chunks` (and their FTS/vec entries) by `document_id` first. Design phase decides which; both are covered by new delete tests. |
| **FTS5 external-content delete.** `chunks_fts` is an external-content FTS5 table; a plain `DELETE FROM chunks` desyncs its index (dangling rowids). No existing code or test ever deleted a single document. | CRITICAL (impl) | Use the FTS5 `'delete'` command form with the original row values before/around removing backing rows; `vec0` deletes are plain by comparison. This is genuinely new, non-trivial code and drives most of the size estimate. |
| **Event-loop blocking.** The throttled sync runs synchronous SQLite work inline with the stdio transport's event loop. | Medium | Keep the synchronous portion strictly proportional to *changed* documents; never a full-corpus rewrite on the hot path. Re-embedding (async) reuses the resident model and touches only changed chunks. |
| **Size crosses the review budget.** Estimated ~500–800 changed lines (diff + upsert/delete + trigger + config + tests), over the 400-line threshold that triggers a full 4R review. | Medium | Flag now: delivery may need slicing at the tasks phase (e.g., store-layer delete/upsert primitives landed and tested before the trigger/config/visibility layer). Keeping the watcher out of scope is part of holding this line. |

## Rollback plan

Reverting this change is cheap because `compendio index` remains an always-available full rebuild
that restores a coherent state from scratch. One residue can exist after this change has run:

1. **Per-document syncs already applied to the DB.** If a partial/incorrect incremental write ever
   left the FTS5 or `vec0` tables inconsistent, a single `compendio index` run's `reset()`
   drop-and-recreate re-derives the entire index from the filesystem, discarding any incremental
   residue.

The schema-marker residue this section originally listed no longer applies — that decision was
withdrawn (see the binding-decisions table), so nothing new is written to the database file itself.

So the rollback story is: revert the code, then run `compendio index` once. No data migration, no
manual `.compendio/` deletion, no bespoke downgrade tooling is required.
