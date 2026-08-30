# Design: Auto-discover Markdown Roots

## Technical Approach

Add root-mode selection before the existing root-resolution/source pipeline. Config classifies explicit or discovery mode. Explicit mode resolves its declared `ResolvedRoot[]` at container construction, preserving the existing configured-root behavior. Discovery mode uses a dynamic `DocumentSource` that re-runs top-level Markdown-root discovery on every `index`, `sync`, `serve` sync, and `index-md` discovery pass before delegating to the existing composite/file-source pipeline. Discovery failures occur before `IndexDocuments` resets the store or `SyncIndex` applies upserts/deletes, so they cannot mutate an existing index.

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|---|---|---|---|
| Root mode representation | Add `DocumentationRootSelection = { mode: "explicit"; docsDir: string[] } | { mode: "discovery" }`. `loadConfigReport` returns `{ config, rootSelection, warnings }`; `loadConfig` intentionally remains a config-only compatibility wrapper. Root-selection-sensitive callers must use `loadConfigReport`. `CompendioConfig` no longer carries fake default `docsDir`. | Discovery as `docsDir: []` or hidden `["docs"]`. | Callers distinguish absence from a populated root list. |
| Config failure boundary | Only config-file ENOENT selects discovery. JSON errors, EACCES, EIO, malformed `docsDir`, non-array `docsDir`, or non-string entries throw before discovery. | Catch all read errors as “no config”. | Permission/I/O failures are not intent to broaden indexing. |
| Effective explicit mode | Populated config `docsDir` and CLI `--dir` both produce explicit mode. `--dir notes` controls aliases (`notes/...`) and writes `notes/INDEX.md`. | Treat `--dir` as discovery or only source override. | CLI override semantics must control source and index-md placement together. |
| Discovery ownership | Create `src/infrastructure/fs/discover-markdown-roots.ts`. It scans top-level directories only, skips symlink candidate roots, and selects roots whose real tree contains case-insensitive `.md`. Ordering uses raw JavaScript string/code-point comparison, not locale or `readdir` order. | Put discovery in domain or rely on `exclude`. | Filesystem probing belongs in infrastructure; order must not vary by OS locale. |
| Discovery safety | During probing, abort on candidate stat/read permission or I/O failures; return empty roots only when scanning succeeds and finds none. During selected-root traversal, discovery mode rejects root, nested traversal, and Markdown read I/O failures instead of converting them to `ReadError`. | Convert discovery failures into `ReadError`. | Discovery mode has no user-declared partial root set to tolerate, so partial mutation would make the index less trustworthy than the existing stale index. |
| Symlink and technical ignore policy | Discovery mode never follows symlink roots, directories, or `.md` files. Add discovery-only `FileDocumentSource` options to skip `Dirent.isSymbolicLink()` and recursively ignore `.git`, `.compendio`, `node_modules`, `dist`, `build`, `coverage` case-insensitively. Explicit mode keeps current traversal/exclude behavior. | Change explicit traversal globally. | Prevents external-content exposure without breaking configured projects. |
| Dynamic discovery source | Use `DynamicDiscoveryDocumentSource` in discovery mode. It discovers current Markdown-bearing top-level roots per pass, unions them with previously indexed root aliases that still exist as readable in-project directories, updates the mutable `rootPrefixes` used by loose module inference, then builds a one-pass `CompositeDocumentSource` over `FileDocumentSource` instances with trusted realpaths pinned for that pass. | Freeze discovered roots at `createContainer`; couple the filesystem adapter directly to SQLite. | Long-running `serve` must see newly added top-level Markdown roots, while fresh containers must still fail closed when a previously indexed discovered root disappeared or became a symlink/junction. The source depends only on the `IndexStore.listDocuments()` port shape. |
| Existing pipeline reuse | Pass discovered names through `resolveRoots`, then use `CompositeDocumentSource`, alias-prefixed paths, `createConventionPolicy(rootPrefixes)`, `IndexDocuments`, `SyncIndex`, and `GenerateIndexMd`. `CompositeDocumentSource([])` returns empty results. | Build a separate indexer. | Preserves validation, excludes, module inference, explicit unreadable-root sync behavior, and no-docs lazy DB behavior. |
| Project-root Markdown | Project-root `.md` files are not indexed in discovery mode. | Make project root a synthetic root. | Specs select top-level folders; widening scope would change paths and expose root/generated docs. |
| `INDEX.md` target | Discovery writes project-root `INDEX.md` with `selfPath = "INDEX.md"`; explicit config and `--dir` write into effective first/override root with prefixed selfPath. | First discovered root as writer target. | Discovery has no user-declared first root; explicit modes do. |

## Data Flow

```text
loadConfigReport -> rootSelection
  explicit -> resolveRoots at container construction -> CompositeDocumentSource -> index/sync/MCP/index-md
  discovery -> DynamicDiscoveryDocumentSource.discover()
    -> discover current roots + revalidate previously indexed aliases
    -> resolveRoots per pass
    -> CompositeDocumentSource -> index/sync/MCP/index-md
discovery scan/traversal/read failure -> throw before index/sync mutation
```

## File Changes

| File | Action | Description |
|---|---|---|
| `src/infrastructure/config.ts` | Modify | Add root selection, ENOENT-only absence handling, `docsDir` validation, remove fake default root. |
| `src/infrastructure/fs/discover-markdown-roots.ts` | Create | Deterministic discovery probe with symlink and technical-name skipping. |
| `src/infrastructure/fs/dynamic-discovery-document-source.ts` | Create | Per-pass discovery-mode source that rediscover roots, preserves previous alias fail-closed semantics, and keeps module-prefix state current without coupling the filesystem adapter to SQLite. |
| `src/infrastructure/fs/file-document-source.ts` | Modify | Add discovery-only traversal options; preserve explicit defaults. |
| `src/infrastructure/fs/composite-document-source.ts` | Modify | Return empty result for zero roots; keep existing unreadable-root handling. |
| `src/composition.ts` | Modify | Resolve mode before store; wire source options, policy prefixes, and writer/selfPath by mode. |
| `scripts/vector-reach.mjs` and config/docsDir tests | Modify | Migrate root-selection-sensitive non-container consumers to `loadConfigReport`; config-only consumers may keep `loadConfig`. |
| `test/**` | Modify | Add TDD coverage. |

## Interfaces / Contracts

```ts
type DocumentationRootSelection =
  | { mode: "explicit"; docsDir: string[] }
  | { mode: "discovery" };

interface ConfigLoadReport {
  config: CompendioConfig;
  rootSelection: DocumentationRootSelection;
  warnings: ConfigWarning[];
}

function loadConfigReport(root: string): ConfigLoadReport;
function loadConfig(root: string): CompendioConfig; // compatibility wrapper
```

`loadConfig` is not a source of root-selection state. Any caller that needs to branch on explicit vs discovery mode must consume `loadConfigReport(root).rootSelection`; callers that only need non-root configuration continue using `loadConfig`.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Config unit | ENOENT/omitted/[] discovery; EACCES/EIO/malformed fail | mocked `readFileSync`, no store. |
| Discovery unit | code-point order, case-insensitive `.md`, ignored names recursively, symlink roots/dirs/files skipped, scan failure abort vs empty result | temp fixtures, no embeddings. |
| Source integration | discovery-only `FileDocumentSource` skips symlink `.md` and technical dirs; explicit behavior unchanged | focused fs tests. |
| Composition | dynamic rediscovery after container creation; fresh-container preservation when a previously indexed discovered root disappeared; discovery-mode nested traversal/read failure causes zero mutation; zero roots keep lazy DB; `--dir` aliases and `INDEX.md` inside override root | `forceLexical: true`, plus fs mocks where ACL/symlink behavior is not portable. |
| Acceptance | current OpenSpec corpus | Count source `openspec/**/*.md` at test time, copy tree to temp, lexical index, compare exact `openspec/...` path set including top-level, nested, active, archive. |
| MCP | three-tool surface and discovery-shaped round-trip paths | lexical server harness. |

## Migration / Rollout

No data migration. Explicit config users keep behavior. Zero-config projects now discover Markdown-bearing folders. Update docs and non-container config consumers; rollback restores old default root.

## Open Questions

None.
