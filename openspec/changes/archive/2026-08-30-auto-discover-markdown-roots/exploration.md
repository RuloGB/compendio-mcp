## Exploration: auto-discover-markdown-roots

### Current State
Today, the config layer resolves `docsDir` from `compendio.config.json` or defaults it to `['docs']` when the file is absent. `resolveRoots()` requires a non-empty string array, rejects duplicates/nesting/alias collisions, and assigns each root an alias from `basename(dir)`. `createContainer()` then builds one `FileDocumentSource` per root and wraps them in `CompositeDocumentSource`, so every discovered document path is root-alias-prefixed (`docs/x.md`, `openspec/y.md`). `FileDocumentSource` recursively walks the configured root, skips hidden directories, and applies `exclude` against the emitted prefixed path. `index-md` writes to the first declared root, and `sync` relies on the alias-prefixed path shape for subtree protection. For the proposed change, the intended behavior is now clear: if config is absent, or `docsDir` is omitted or empty, the system should discover Markdown-bearing folders automatically; if `docsDir` is present and valid/non-empty, it remains authoritative; if `docsDir` is malformed or wrong-typed, that is an error. In this repo specifically, `openspec` contains 170 `.md` files total: 1 top-level file (`openspec/testing-capabilities.md`) and 169 nested files under specs, active changes, and archive.

### Affected Areas
- `src/infrastructure/config.ts` — `loadConfigReport()`, `mergeConfig()`, and `resolveRoots()` currently assume a declared root array and reject empty sets.
- `src/composition.ts` — root selection wires config roots directly into `FileDocumentSource`, `CompositeDocumentSource`, convention policy, and `INDEX.md` targeting.
- `src/infrastructure/fs/file-document-source.ts` — discovery currently recurses from one concrete directory and assumes the path prefix is already decided.
- `src/infrastructure/fs/composite-document-source.ts` — merges multiple per-root discovery results and preserves prefixed paths.
- `openspec/specs/configuration/spec.md` — explicitly documents `docsDir` as a non-empty array of declared roots.
- `openspec/specs/indexing/spec.md` — assumes every discovered path is root-alias-prefixed and stable.
- `test/infrastructure/config.test.ts` and `test/infrastructure/composite-document-source.test.ts` — encode the current root-array and alias behavior.
- `test/application/*` integration tests — will likely need updates wherever they assume default `['docs']` or prefixed path shapes.

### Approaches
1. **Implicit discovery only when no effective `docsDir` exists** — If config is absent, or `docsDir` is missing/empty in the effective config, discover top-level markdown roots automatically; if config explicitly provides roots, use only those.
   - Pros: preserves explicit config authority; gives a clean fallback for zero-config projects; least surprising migration path.
   - Cons: still needs a crisp rule for discovery boundaries and generated/internal folder exclusions.
   - Effort: Medium

2. **Always auto-discover roots unless `docsDir` is explicitly set** — Any declared `docsDir` overrides discovery, but the absence of the key means scan the repo for markdown-bearing folders.
   - Pros: simple mental model; minimizes configuration for new projects.
   - Cons: changes current default behavior more aggressively; higher compatibility risk for existing repos that rely on implicit `['docs']` semantics.
   - Effort: Medium

3. **Introduce an explicit discovery mode/config flag** — Keep `docsDir` semantics unchanged and add a separate switch controlling auto-discovery.
   - Pros: clearest compatibility story; avoids ambiguity.
   - Cons: does not match the user's requested behavior; adds another config surface and more branching.
   - Effort: High

### Recommendation
Use approach 1: auto-discover markdown roots only when there is no effective configured root set. That keeps explicit `docsDir` authoritative, limits surprise, and gives a reasonable zero-config experience. The resolved rule is: absent config or omitted/empty `docsDir` falls back to discovery; malformed or wrong-typed `docsDir` fails fast. The feature replaces the old implicit `['docs']` default while retaining explicit valid `docsDir` behavior.

### Risks
- Path aliasing is a core invariant today; auto-discovery may change aliases, which cascades into `exclude`, `module` inference, `INDEX.md` output, and sync protection.
- The current specification says `docsDir` is a non-empty array; auto-discovery requires either a spec exception or a broader contract rewrite.
- Need to define discovery boundaries precisely so generated/internal folders, hidden directories, and build artifacts do not become accidental roots. The current `openspec` tree is evidence that archive and active-change folders are legitimate content, so any default exclusion policy must not blanket-exclude `openspec/changes/archive`.

### Ready for Proposal
Yes — the approved scope is: recursive top-level-root discovery replaces the old implicit `['docs']` default when config is absent or `docsDir` is omitted/empty, while explicit valid `docsDir` remains authoritative and malformed or wrong-typed `docsDir` still fails fast.
