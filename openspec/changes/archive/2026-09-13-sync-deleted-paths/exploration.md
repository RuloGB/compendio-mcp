## Exploration: sync-deleted-paths

### Empirical reproduction (built CLI, `node dist/cli.js`, hybrid mode)

Fixture: `docs/alpha.md`, `docs/beta.md`, `docs/sub/{gamma,delta}.md`, `guides/{epsilon,zeta}.md`.

| Scenario | Command | Exit | Output | Stale rows left? |
|---|---|---|---|---|
| A. Discovery, delete `docs/beta.md` | `sync` | 0 | `Synced 0 documents (0 chunks), 1 deleted` | No |
| B. Discovery, delete `docs/sub/` | `sync` | 0 | `Synced 0 documents (0 chunks), 2 deleted` | No |
| **C. Discovery, delete `guides/`** | `sync` | **1** | error below | **Yes** — both `guides/` docs still returned by `search` and `overview` |
| C, repeated | `sync` / `index` | **1** | same error | Yes — no CLI command recovers |
| **D. Discovery, fresh fixture, delete `guides/`** | `index` | **1** | same error | **Yes** — `index` cannot rebuild |
| E. Explicit (`docsDir: ["docs","guides"]`), delete `guides/` | `sync` | 0 | `Synced 0 documents (0 chunks), 2 deleted` | No |
| F. Explicit, delete `guides/` | `index` | 0 | `Indexed 4 documents (4 chunks)` | No |
| G. Discovery, empty `guides/` but keep the folder | `sync` | 0 | `Synced 0 documents (0 chunks), 2 deleted` | No |

Error (stderr, no stack):

```
previously discovered documentation root "guides" could not be inspected: ENOENT: no such file or directory, lstat '<project>\guides'
```

Chunk and FTS row counts matched document counts in every scenario (no orphans). `serve` was not exercised; by code reading it hits the same path (see below).

### Current State

The reported bug is real and confined to **discovery mode, whole top-level root deleted**. Single-file and subfolder deletions, and explicit-mode root deletion, already purge correctly.

**Entry points**
- `compendio index` → `IndexDocuments.execute` (`src/application/index-documents.ts`): `source.discover()` first, then `store.reset()`. A `discover()` throw aborts before any mutation.
- `compendio sync` → `SyncIndex.execute` (`src/application/sync-index.ts`): same ordering.
- `serve` → every tool call runs `SyncScheduler.maybeSync()` (`src/application/sync-scheduler.ts`); a thrown error is swallowed to stderr (`incremental sync failed: ...`), `lastReport` stays the last good one. Net effect: a `serve` process silently keeps serving the stale index until the folder reappears.

**Where the bug lives**
- `DynamicDiscoveryDocumentSource.discover()` (`src/infrastructure/fs/dynamic-discovery-document-source.ts`) freshly enumerates top-level dirs with `discoverMarkdownRootDetails`, then re-validates every alias already in the index but absent from the fresh set via `validateDiscoveredRootAlias`.
- `validateDiscoveredRootAlias()` (`src/infrastructure/fs/discover-markdown-roots.ts`) wraps `lstatSync` and rethrows ANY error — ENOENT included — as `previously discovered documentation root "<alias>" could not be inspected`. Nothing catches it, so `discover()` rejects.
- `IndexDocuments` also depends on `discover()` succeeding, and discovery reads the aliases from the existing index, so `index` cannot reindex its way out: a lock with no CLI escape.

**Explicit mode, for contrast**: `FileDocumentSource.walk()` (`src/infrastructure/fs/file-document-source.ts`) returns zero files on ENOENT of a non-discovery root; `SyncIndex.deleteMissingDocuments()` then purges that alias. EACCES and other errors still throw per root and become a `ReadError` that protects the subtree (fail-closed).

### Contract: this is a spec change, not a silent bugfix

`openspec/specs/indexing/spec.md`, scenario **"Unreadable existing root aborts sync without mutation"**:

> GIVEN a discovery-mode index already contains documents for a root and that root becomes unreadable during the next sync
> WHEN discovery runs
> THEN the sync aborts before mutation and existing indexed documents remain

The rationale (doc comment in `composite-document-source.ts`, `docs/design-decisions.md#unreadable-roots-fail-closed-in-discovery-mode`) is protection against a **transient** failure (unmounted share, permissions hiccup, AV lock) wiping a root's documents. "Unreadable" literally covers a deleted directory, so today's behaviour conforms to the letter of the spec. The spec never distinguishes "deleted" from "transiently inaccessible" in discovery mode, while explicit mode already does (requirement "Removing a Declared Root Purges Its Indexed Documents on the Next Sync Pass" plus the ENOENT-is-zero-files branch).

### Affected Areas

- `src/infrastructure/fs/discover-markdown-roots.ts` — `validateDiscoveredRootAlias()` must tell ENOENT apart from other `lstatSync` failures.
- `src/infrastructure/fs/dynamic-discovery-document-source.ts` — on ENOENT, do not re-add the alias; the normal path-presence diff purges it. Any other error still propagates.
- `src/infrastructure/fs/composite-document-source.ts` — likely untouched; re-read the doc comment so it describes the narrower abort condition.
- `src/application/sync-index.ts`, `index-documents.ts`, `sync-scheduler.ts` — expected untouched.
- `test/infrastructure/discover-markdown-roots.test.ts` — `validateDiscoveredRootAlias` has zero direct tests today.
- New real-filesystem integration test (discovery mode, `rmSync(root, { recursive: true })`) for both `sync` and `index` — nothing like it exists; mirror the single-file deletion test in `test/application/index-and-search.test.ts`.
- `openspec/specs/indexing/spec.md` — new discovery-mode scenario "a discovered root directory deleted from disk is purged without aborting"; the existing unreadable scenario stays, narrowed to non-ENOENT failures.
- `docs/design-decisions.md` — addendum to the fail-closed section.
- `AGENTS.md` — the one-line fail-closed bullet needs a clause for the deleted-root carve-out.

### Approaches

1. **Treat ENOENT of a previously discovered root as "removed"; keep fail-closed for everything else** (recommended)
   - Pros: surgical, confined to the discovery layer; reuses the tested `deleteMissingDocuments()` purge; keeps the data-loss guard for EACCES/EIO/EPERM/ENOTDIR/symlink/realpath mismatch; symmetric with explicit mode.
   - Cons: needs a spec delta; the touched function has no direct tests yet.
   - Effort: Low–Medium.
2. **Warn and purge on any root failure**
   - Pros: simplest code.
   - Cons: removes the fail-closed guarantee; an unmounted or permission-broken root would silently lose all its documents. Not recommended.
3. **CLI escape hatch (`sync --purge-root <alias>`)**
   - Pros: zero risk to the guard.
   - Cons: does not fix the report — deleting a folder is a normal action and must not require a flag. At most a complement for the EACCES case.

### Recommendation

Approach 1. ENOENT from `lstatSync` on a direct child of a project root that was itself just read successfully is an authoritative "does not exist", not a reachability problem — and discovery already rejects symlinked roots, so a top-level root cannot be a mount indirection that disappears transiently. Purge that alias via the existing diff with no error in CLI or `serve`; keep throw-and-abort for every other error code.

### Risks and open questions

- Only a clean `ENOENT` counts as deleted; every other `code` stays in the fail-closed path.
- **All discovered roots deleted** (verified by code reading): `DynamicDiscoveryDocumentSource.discover()` builds a `CompositeDocumentSource` with zero roots, whose `discover()` returns an empty result without throwing (`if (this.roots.length === 0) return ...`). With the ENOENT carve-out, deleting every root therefore empties the index silently on the next `sync`, and `index` rebuilds an empty index. Today it is masked because the first stale alias throws first.
- Explicit mode detects a missing root with `reason.includes("ENOENT")` on the message string (`FileDocumentSource.walk`); the new discovery check should test `error.code === "ENOENT"` rather than copy the string match.
- Delete-and-recreate-empty between the fresh scan and re-validation within one pass: already behaves like scenario G (purge); worth one unit test.
- `serve` should recover on its next throttled pass once `discover()` stops throwing — verify, don't assume.
- Whether a deleted root should be reported (e.g. an informational line in the sync report) or be silent like explicit mode — product decision for the proposal.

### Ready for Proposal

Yes. Route through `sdd-propose` → `sdd-spec` (delta on `indexing`) → `sdd-design` → `sdd-tasks`; the change amends an existing scenario and must not be applied as a silent patch.
