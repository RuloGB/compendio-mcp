# Design: Multiple Documentation Roots

## Revision note — 2026-08-07 (supersedes the union-based design)

The first version of this design was written against `docsDir: string | string[]`. The proposal was
revised the same day to **array-only** — `docsDir: string[]`, default `["docs"]`, every path
prefixed, from one root to ten — because the backward-compatibility argument that justified the union
protected an empty set: the project is in beta and nobody has it installed (`openspec/config.yaml`,
`rules.proposal`; user decision reaffirmed 2026-08-07).

**Removed by name.** Each was a *branch*, and each branch was a place the wrong side could run:

| Removed | Where it was | Why it is gone |
|---|---|---|
| `ResolvedRoots.multi` | old Decision 4 | there is no mode left to flag |
| the `multi === false` wiring branch | old Technical Approach, Flow notes | one unconditional wiring path |
| `docsDir: string \| string[]` | old Decisions 4 and 9, Interfaces | `resolveRoots` takes a plain `string[]`; no union survives anywhere |
| mode-dependent `exclude` | old Decision 7 | one rule: `exclude` matches the emitted path |
| Gate 1 "single-root is byte-identical", Gate 4′ as a standalone gate, and every "…and single-root still does the old thing" assertion | old gate matrix | the default path now exercises what the opt-in used to |

**Added, because array-only forces three questions the union deferred.** Decision 2 names the layer
that throws on an unreadable root and states what happens to `test/infrastructure/file-document-source.test.ts:99`.
Decision 13 makes `test/helpers/build.ts` prefix. Decision 14 re-addresses `ejemplos/goldenset.yaml`
and specifies the gate that would have caught its silent breakage.

**Carried forward unchanged, each verified against code:** the seeded prefix and the `isRoot`
parameter (Decision 1); the alias as `ReadError.path` (Decision 4); the ordered-pair collision sweep
in both directions (Decision 5); P1's resolved measurement (below the gate matrix); the three dead
`INDEX_FILE` equality checks (Decision 9); `scripts/vector-reach.mjs:204` (Decision 11);
`ReadDocument` settled as a test rather than an edit (Decision 12).

Superseded reasoning is recorded here rather than quietly overwritten, per this project's practice.

## Technical Approach

**The root prefix is applied by the walk that builds the path, not by anything downstream of it.**
That single choice dissolves the central collision the proposal identified: after it there is exactly
one path string in existence per file — the one `exclude` is tested against, the one that is emitted,
the one that is persisted. Array-only sharpens it, because there is no unprefixed shape left anywhere
for the question "which string did we test against?" to have a second answer.

```
createContainer
  │
  ├─ roots = resolveRoots(root, options.docsDir ? [options.docsDir] : config.docsDir)   NEW, config.ts
  │     └─ throws on empty / non-string / duplicate / nested / alias-clash   (Decisions 5, 6)
  │
  └─ source = new CompositeDocumentSource(
                 roots.map(r => ({ ...r, source:
                   new FileDocumentSource(r.dir, config.exclude, r.prefix) })))
```

There is no second branch. One root goes through the same composite as ten.

| Question the change owns | Answer | Where |
|---|---|---|
| Where does the prefix come from | `walk`'s seed, so it is *the* path from the first character | `FileDocumentSource`, one new constructor argument |
| How does the root-failure throw survive a seeded prefix | root-ness becomes an explicit `isRoot` parameter, never `prefix === ""` | `FileDocumentSource.walk` |
| Which layer throws on an unreadable root | the primitive throws; the composite converts and decides tolerance | Decision 2 |
| Who rejects a colliding root set, and when | `resolveRoots`, called before `new SqliteIndexStore` | `config.ts` + `composition.ts` |
| How aliases reach `inferModule` without a config key | an optional factory parameter carrying a `string[]` | `createConventionPolicy(cfg, rootPrefixes?)` |

`src/domain/ports.ts` is **unchanged**: the composite implements the existing `DocumentSource`, and
`DiscoverResult`/`DocumentFile`/`ReadError`/`EncodingNotice` keep their shapes. `src/domain/` gains one
optional parameter on two existing functions and no dependency — no SQLite, no transformers.js, no
filesystem (`openspec/config.yaml`, `rules.design`; precedent: `2026-08-07-addressable-chunks`
Decision 1, `2026-08-06-encoding-aware-reads` Decision 6).

## Architecture Decisions

### Decision 1: the prefix is seeded into the walk, and root detection stops riding on `prefix === ""`

**Choice.** `FileDocumentSource` gains a third constructor argument, `pathPrefix: string = ""`.
`discover()` seeds the recursion with it instead of `""`, and `walk` gains an explicit
`isRoot: boolean` that replaces the `prefix === ""` test at `file-document-source.ts:47`.

```ts
// discover()                                                       :31
await this.walk(this.docsDir, this.pathPrefix, true, files, readErrors, encodingNotices);

// walk(), the only changed line inside it                          :47
if (isRoot) { throw new Error(`cannot read the documentation directory "${this.docsDir}": ${reason}`); }
```

**Why this makes Approach 5's failure unrepresentable rather than merely mitigated.** Line 58 already
reads ``const path = prefix === "" ? entry.name : `${prefix}/${entry.name}` ``, and line 64 already
reads `if (this.isExcluded(path, entry.name)) continue;`. Both are untouched. With a seeded prefix,
`path` is the alias-prefixed path from the first directory entry onward, so the exclusion test **is**
run against the emitted path — not because a rule says so, but because there is one variable and both
lines use it. A post-hoc rewrite in the composite would keep two strings alive (the one filtered, the
one emitted) and the whole class of "which one did we test?" bugs alive with them.

The same seeding gives `readErrors.push({ path: prefix, … })` at line 53 the prefixed subtree path for
free — load-bearing, see Decision 4.

**`pathPrefix` stays optional, and the non-empty guarantee lives in `resolveRoots` instead.** The
primitive is a per-root walker; emitting root-relative paths is a legitimate primitive-level
configuration, and it is what the **20** existing `new FileDocumentSource(...)` sites in `test/`
(measured 2026-08-07; 18 of them the two-argument `(dir, [])` unit form) already rely on.
What must always hold is that *production wiring* prefixes, and that is enforced upstream:
`resolveRoots` never yields an empty `prefix` (it rejects a root that resolves to a filesystem root,
Decision 5). Making the parameter required would churn 20 call sites for no behavioural gain and would
put the invariant in the noisiest possible place. The drift risk this leaves — a *harness* that
constructs the primitive with no prefix — is closed by Decision 13, not by the signature.

**Rejected — seed the prefix and keep `prefix === ""`.** Correct paths, correct exclusion, and the
root-failure throw silently gone on **every** run, because under array-only every prefix is non-empty.
Under the union this was an opt-in trap; array-only makes it a default-path trap, which is worse and
is why the `isRoot` refactor lands in PR 1, before the PR that could disable it.

**Rejected — prefix in the composite after discovery.** Cheapest to write, and it ships the motivating
`exclude: ["openspec/changes/archive"]` as a no-op that indexes 79 archived files while looking
correct (Gate 2c). It also wastes the work: those 79 files are read from disk and decoded before being
discarded.

**Rejected — pass a pre-prefixed exclude list to each `FileDocumentSource`.** Requires knowing which
entries are root-relative and which are already prefixed — undecidable for an entry like
`changes/archive` — and multiplies one list into N.

### Decision 2: `FileDocumentSource` keeps the throw; the composite owns the corpus-level failure policy

**This is the question array-only forced into the open, and the proposal escalated to design
explicitly. Answer: the primitive throws, unchanged.**

**Choice.** `FileDocumentSource.discover()` continues to reject when its own root cannot be read
(via `isRoot`, Decision 1). `CompositeDocumentSource` catches that rejection, converts it into a
`ReadError` whose `path` is the root's alias, continues with the remaining roots, and rethrows a
single aggregate error only when **every** root threw.

**`test/infrastructure/file-document-source.test.ts:99` passes unchanged.** It constructs
`new FileDocumentSource(dir, [])` and asserts `discover()` rejects. The primitive's contract is
exactly what this decision preserves, so the test is not rewritten, not deleted, and not "discovered"
at verify time. Its intent — an unreadable root is a hard error *at this level* — is now the load-bearing
half of a two-layer policy rather than the whole policy. One test is **added** beside it, asserting the
same rejection with a non-empty prefix, so the `isRoot` refactor is falsifiable in isolation.

**Rationale, in the order that decides it.**

1. **The primitive cannot make the decision.** "Continue on the remaining roots" requires knowing how
   many roots exist. `FileDocumentSource` knows about one directory. Tolerance is a composition
   concern, and putting it where the information is is the whole point of the seam.
2. **The alternative re-creates the defect this design removes.** If the primitive returned
   `{ files: [], readErrors: [{ path: alias }], … }` instead of throwing, the composite would have to
   detect "this root failed *as a root*" by testing `e.path === root.prefix` — string-matching a
   control-flow fact, in the same change that removes `prefix === ""` from `walk` for being exactly
   that. An exception is unambiguous; a sentinel `ReadError` is not distinguishable from a subtree
   failure except by a string comparison that the next refactor can quietly break.
3. **A direct consumer of the primitive fails loudly.** Under the alternative, anything constructing
   `FileDocumentSource` against a missing directory gets a silently empty corpus. That is the shape of
   this project's recorded worst failures.

**The observable change, stated so verify does not have to find it.** With a one-root set whose root
is unreadable, the error the CLI's top-level `.catch()` prints is now the composite's aggregate
message, not the primitive's raw one:

```
no documentation root could be read: "docs" (C:\p\docs): ENOENT: no such file or directory …
```

That is strictly better than today's message, which is also one of the two pre-existing Spanish
strings (`file-document-source.ts:49`); the primitive's own message is rewritten in English by this
change regardless.

**Rejected — move the throw to the composite entirely.** Point 2 above. It also forces
`file-document-source.test.ts:99` to be rewritten in a change that has no other reason to touch it,
which is how an intentional guarantee becomes an accidental deletion.

### Decision 3: `CompositeDocumentSource` merges and sorts; it never rewrites a path

**Choice.** New adapter at `src/infrastructure/fs/composite-document-source.ts`, implementing the
existing `DocumentSource` port. It takes already-built per-root sources plus their identity:

```ts
export interface RootSource {
  declared: string;   // exactly as written in config or --dir, for messages
  dir: string;        // absolute, for messages
  prefix: string;     // the alias this source emits; also its ReadError path when it fails
  source: DocumentSource;
}
```

`discover()` awaits each root **sequentially**, in declaration order, inside a `try`/`catch`:

1. Success — concatenate its `files`, `readErrors` and `encodingNotices`.
2. Throw — push `{ path: root.prefix, error: 'declared documentation root "<declared>" (<dir>) could
   not be read: <reason>' }` into `readErrors` and continue (Decisions 2, 4).
3. After the loop — if **every** root threw, rethrow one aggregate error listing each declared root
   and its reason.
4. `files.sort((a, b) => a.path.localeCompare(b.path))`, preserving `file-document-source.ts:32`'s
   sorted-output contract. `readErrors` and `encodingNotices` stay in declaration-then-walk order,
   which is already deterministic; `file-document-source.ts` sorts neither, and sorting them here
   would be a contract this change did not need to invent.

**It runs for a one-element root set too, and that is what removes the branch.** No `multi` flag, no
`roots.length === 1` shortcut. A shortcut would mean the single most common configuration takes a code
path the multi-root tests never touch — reintroducing the dual-mode blindness array-only exists to
delete.

**Why it depends on the port, not on `FileDocumentSource`.** The composite imports nothing from
`node:` at all. Merge, sort, failure conversion and all-fail rethrow are testable against a three-line
fake `DocumentSource` that throws on demand — no filesystem, no temp directories, no `readdir`
mocking. That is what makes Gate 4 cheap enough to assert exhaustively (one fails, some fail, all
fail, none fail) instead of once.

**Why sequential, not `Promise.allSettled`.** Discovery is not the bottleneck this project measures:
`bounded-chunk-size` recorded a 31 s full index dominated by `onnxruntime-node` inference blocking the
main thread (`CLAUDE.md`). Parallel fan-out would buy a fraction of a second, multiply peak memory by
the number of roots (every file's decoded content is held), and make failure attribution
order-dependent. Revisit only with a measurement.

**Rejected — one `FileDocumentSource` that walks N directories.** It would fold the alias, the
per-root failure policy and the merge into the primitive, and delete the seam that makes Decision 1's
two properties independently testable.

### Decision 4: a failed root reports its **alias** as `ReadError.path`, not its declared path

**This is the decision that keeps `src/application/sync-index.ts` unchanged, and getting it wrong is
silent data loss rather than a visible error.** Neither the exploration nor the first proposal named
it; the first proposal said the opposite.

`SyncIndex.deleteMissingDocuments` (`sync-index.ts:165-178`) protects a subtree from delete-on-absence
via `isProtected` (`:225-227`):

```ts
failedPaths.some((failed) => path === failed || path.startsWith(`${failed}/`));
```

`path` there is the **persisted, prefixed** document path. So:

- `ReadError.path = "openspec"` → `"openspec/specs/indexing/spec.md".startsWith("openspec/")` → every
  document of that root is protected. A transiently unreadable root (a network mount, a `chmod`, a
  checkout in flight) reports itself and leaves the corpus alone.
- `ReadError.path = "packages/app/docs"` (the declared string, for a nested root aliased `docs`) →
  matches nothing → **`deleteMissingDocuments` purges every document of that root on the very next
  throttled sync pass of a running `serve`**, then re-indexes them minutes later when the mount
  returns. Green suite throughout.

The declared string is not lost: it goes in the message text, which is where a human reads it. The
`path` field is machine-consumed by exactly one rule, and that rule needs the prefix.

**Consequence worth a spec scenario**: an unreadable root behaves *differently* from a removed root,
and the contrast is what makes both comprehensible. Unreadable → a `ReadError`, documents survive.
Removed from `docsDir` → no `ReadError`, documents deleted on the next pass. Both correct; only
together explicable.

**Rejected — a new `rootErrors` field on `DiscoverResult`.** It would need its own protection rule in
`SyncIndex`, its own reporting path in three use cases, and a `ports.ts` change, to re-derive a
behaviour the existing `ReadError` prefix rule already produces.

### Decision 5: `resolveRoots` normalizes and validates a `string[]` in one pass

**Choice.** One exported function in `src/infrastructure/config.ts` (it needs `node:path`, so it
cannot live in `src/domain/`; and it is config normalization, which is that module's job):

```ts
export interface ResolvedRoot {
  declared: string;   // exactly as written in config or --dir
  dir: string;        // absolute, resolve(projectRoot, declared)
  prefix: string;     // the alias: basename(dir), never empty
}
export function resolveRoots(projectRoot: string, docsDir: string[]): ResolvedRoot[];  // length >= 1
```

No wrapper object and no `multi` flag: there is nothing left for one to carry. `roots[0]` is the first
declared root — the `INDEX.md` target (Decision 9).

**The alias is `basename(dir)` — of the *resolved absolute* path, not of the declared string.** One
call normalizes trailing separators, `.`, `..` and Windows separators together: `"docs/"`, `"./docs"`
and `"docs"` all yield `"docs"`. `basename` cannot return a value containing a separator, so an alias
is always exactly one path segment — the property `inferModule` and `isProtected` both rely on.

**Duplicate and nesting are one predicate, swept over ordered pairs in both directions.**

```ts
for (const a of roots) for (const b of roots) {
  if (a === b) continue;
  const rel = relative(a.dir, b.dir);
  if (rel === "") throw duplicate(a, b);
  if (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`)) throw nested(b /*inner*/, a /*outer*/);
}
```

Three details, each load-bearing and each measured or reasoned rather than assumed:

- **`relative`, never `resolve(a) === resolve(b)`.** Measured 2026-08-07 on win32 / Node v22.22.0:
  `resolve('C:\A\docs') === resolve('C:\a\docs')` is **`false`**, so a guard written to the prose
  "two roots that resolve to the same absolute path" misses case-differing duplicates on the
  development platform and lets the UNIQUE-constraint crash through. `relative` **is**
  case-insensitive there (`relative('C:\A\docs','C:\a\docs')` → `""`), so no `toLowerCase()` clause
  is needed. Implement the predicate, not the prose.
- **Both directions.** Measured: `relative('C:\A\docs\adr', 'C:\A\docs')` → `".."`, which a
  one-directional containment test reads as *not* contained. `docsDir: ["docs/adr", "docs"]` — the
  inner root declared **first** — therefore passes a one-directional sweep and reproduces exactly the
  double-discovery the guard exists to reject. Its own test case, inner root first.
- **`rel !== ".." && !rel.startsWith("..${sep}")`, not `rel.startsWith("..")`.** A nested root whose
  directory name begins with two dots (`docs/..cache`) yields `rel === "..cache"`, which the loose
  form reads as not contained. The strict form costs one comparison and closes it.
  **Measured by the orchestrator, 2026-08-07** (win32, Node v22.22.0), so this is proven rather than
  argued: `relative('C:\A\docs', 'C:\A\docs\..cache')` → `"..cache"`; the loose form returns *not
  contained* (wrong), the strict form returns *contained* (right). The other four cases — `docs\adr`,
  the prefix-sharing sibling `docs-old`, the parent, and the identical directory — are classified
  identically by both forms, so the strict form is a pure gain with no behaviour to re-check.

**Validation order and messages** (all English, all naming the offending declared strings):

| Case | Message |
|---|---|
| not an array | `docsDir must be an array of documentation root paths` |
| empty array | `docsDir must declare at least one documentation root` |
| non-string entry | `docsDir entries must be strings; entry <i> is <typeof>` |
| duplicate | `docsDir declares the same documentation root twice: "<a>" and "<b>" both resolve to <dir>` |
| nested | `docsDir declares nested documentation roots: "<inner>" (<dir>) lies inside "<outer>" (<dir>); every file under the inner root would be discovered twice under the same path` |
| alias clash | `docsDir declares two roots with the same directory name: "<a>" and "<b>" both use the path prefix "<alias>"` |
| alias empty | `docsDir root "<declared>" resolves to a filesystem root (<dir>) and has no directory name to use as a path prefix` |

Containment is checked before alias clash because a duplicate is also an alias clash, and "you
declared the same root twice" is the more useful sentence.

**On the type checks, against this loader's deliberate minimal-validation style.** `loadConfig` is a
bare cast over `JSON.parse` (`config.ts:88`) and validates nothing but JSON syntax and `throttleMs`.
The two type guards here are bounded to one field and earn their place the same way the collision
guard does: without them a declared string or array-of-numbers reaches `path.resolve` and produces
`TypeError [ERR_INVALID_ARG_TYPE]` from inside Node, naming neither `docsDir` nor the offending entry.
Nothing else in the config gains validation — `chunk.maxTokens: "big"` still sails through, exactly as
today. **`mergeConfig`'s `docsDir: override.docsDir ?? base.docsDir` is unchanged** — it is a
whole-value replace already, which is the correct semantics for an array.

**Rejected — validating in `loadConfig`.** It cannot see the `--dir` override, applied afterwards at
`composition.ts:58`; a config with colliding roots would then reject a run the user explicitly scoped
away from them. It would also make a function that returns `DEFAULT_CONFIG` without reading a file
into a function that can throw about the file's contents.

### Decision 6: the guard runs in `createContainer`, before the store is constructed

**Choice.** `resolveRoots(options.root, options.docsDir !== undefined ? [options.docsDir] : config.docsDir)`
is the statement immediately after `loadConfig`, replacing `composition.ts:58` and therefore **before**
`new SqliteIndexStore(...)` on line 59.

**Why that exact position, not merely "before `reset()`".** `SqliteIndexStore`'s constructor runs
`migrate()` on every container construction (`CLAUDE.md`), creating `.compendio/` and the database file
if absent. Placing the guard before line 59 makes Gate 5's second bullet — *no `.compendio/` directory
exists afterwards* — literally true, which is stronger than "the database is not reset". There is no
ordering to get wrong at apply time, and every CLI command (`index`, `search`, `serve`, `overview`,
`eval`, `index-md`) goes through `createContainer`, so a colliding config fails all of them
identically.

**Consequence, accepted:** a colliding `docsDir` makes `compendio search` fail too, not just
`compendio index`. Intended posture — a corpus that cannot be built coherently should not be queried
as though it were.

### Decision 7: `inferModule` takes an optional `readonly string[]`, threaded through the policy factory

**Choice.** Two optional parameters, no new type, no new config key:

```ts
export function inferModule(path: string, rootPrefixes?: readonly string[]): string | undefined;
export function createConventionPolicy(cfg: ConventionConfig, rootPrefixes?: readonly string[]): ConventionPolicy;
```

`createLoosePolicy` closes over `rootPrefixes` and passes it at `convention.ts:71`. `createStrictPolicy`
ignores it — strict never infers `module` (`convention.ts:106-109`), so there is nothing to strip.
`composition.ts:74` now passes `roots.map(r => r.prefix)` **unconditionally**; there is no
`undefined` case in production any more, and the parameter stays optional only so the ~30 existing
`createConventionPolicy` call sites and `convention.test.ts:50,54` compile and pass unchanged.

**Why the factory and not `FrontmatterInput`.** `FrontmatterInput.path` is populated by `transformFile`
(`index-pipeline.ts`) and `GenerateIndexMd` from `DocumentFile.path`. Neither knows which root a file
came from — by design, since Decision 1 makes the prefix part of the path and nothing else carries
root identity. Putting the alias on `FrontmatterInput` means putting it on `DocumentFile`, i.e. a
`ports.ts` change plus every in-memory `DocumentSource` fake in the suite, to transport a value the
policy can close over once.

**Why not `ConventionConfig`.** Proposal Approach 6 as a hard boundary: `ConventionConfig` is the shape
`mergeConfig` builds from a project's JSON under an explicit-whitelist discipline (`config.ts:98-101`).
Aliases are derived from `docsDir`, never declared. A key there would be declarable, and a project
writing `convention.rootAliases: ["x"]` would silently change module inference with no root named `x`
in existence.

**Semantics** — strip at most one matching prefix, then take the first segment:

```
rest = first p in rootPrefixes with path.startsWith(p + "/")  ?  path.slice(p.length + 1)  :  path
return rest.indexOf("/") === -1 ? undefined : rest.slice(0, rest.indexOf("/"))
```

**"First match wins" is unambiguous only because of Decision 5.** Two prefixes could both match a path
only if one root were nested inside another — the case `resolveRoots` rejects. The guard is not just a
crash preventer; it is the precondition that makes this function well-defined. Two decisions, one
invariant, stated here so neither gets relaxed without the other.

Gate 3 falls out arithmetically: `docs/documentation-convention.md` with prefixes `["docs","openspec"]`
→ rest `documentation-convention.md` → no `/` → `undefined`. `openspec/specs/indexing/spec.md` → rest
`specs/indexing/spec.md` → `"specs"`.

### Decision 8: `exclude` is three clauses, and its one meaning is "the emitted path"

**Choice.** `isExcluded` (`file-document-source.ts:84-86`) becomes:

```ts
const entry = raw.replace(/\/+$/, "");
return entry === path || entry === basename || path.startsWith(`${entry}/`);
```

The trailing-slash strip is not cosmetic: `exclude: ["openspec/changes/archive/"]` is the form a user
writes half the time, and without it the entry matches nothing at all — a silent no-op of exactly the
shape this change exists to eliminate. The explicit `/` in the third clause is what stops `docs` from
excluding `docs-old/x.md`.

**One rule, no mode.** The old design had to defend an entry meaning root-relative paths under a string
`docsDir` and prefixed paths under an array. Array-only deletes that: `exclude` matches **what
`search_docs` returns**, always, and that sentence is the whole specification. `README.md` states it
once, not as a footnote to a mode.

Two consequences worth one line each. The default `exclude: [INDEX_FILE]` still works, through the
**basename** clause, and therefore excludes `INDEX.md` in every root — including a hand-written
`openspec/INDEX.md`. And `exclude: ["docs"]` now excludes an entire root; that is expressible, not
guarded, and is the user's own statement.

**Scope held.** No glob engine, no `*`, no `**`, no negation, no per-root lists. Three string
comparisons.

### Decision 9: `GenerateIndexMd` learns its own path, retiring all three dead equality checks

**Choice.** A sixth constructor parameter, `selfPath: string = INDEX_FILE`, and all three sites compare
against it:

| Line | Today | After |
|---|---|---|
| `generate-index-md.ts:41` | `e.path !== INDEX_FILE` | `e.path !== this.selfPath` |
| `:46` | `file.path === INDEX_FILE` | `file.path === this.selfPath` |
| `:77` | `n.path !== INDEX_FILE` | `n.path !== this.selfPath` |

`composition.ts` passes `` `${roots[0].prefix}/${INDEX_FILE}` `` — unconditionally, no branch — and the
writer targets `roots[0].dir` with an unchanged `FileIndexWriter`.

Under prefixing all three checks are dead by default *and hidden*: the basename `exclude` keeps
`INDEX.md` out of `files` entirely, so they fail only when a project overrides `exclude`. A silent,
conditional dead guard is precisely what this project refuses to leave in place — which is why Gate 6
runs with `exclude: []`.

**Why identity and not `basename(p) === "INDEX.md"`.** Basename comparison is shorter and wrong in a
way the project would have to come back to: it silently omits a hand-written `openspec/INDEX.md` from
the combined index. Identity excludes exactly the file being written.

**The combined file lists project-root-relative paths from inside `docs/`.** `docs/INDEX.md` will
contain a line naming `openspec/specs/indexing/spec.md`. That reads as odd for exactly as long as it
takes to notice these are the same strings `search_docs` returns and `read_doc` accepts, and that
`index-markdown.ts:41` renders them as plain text, not links — so nothing is broken, only unusual.

### Decision 10: `--dir` normalizes to a one-element root set

`ContainerOptions.docsDir?: string` (`composition.ts:29`) and the commander option
(`cli.ts:35,76`) are **unchanged**. `composition.ts` wraps it:
`options.docsDir !== undefined ? [options.docsDir] : config.docsDir`. `resolveRoots` therefore takes a
plain `string[]` and **no union type survives anywhere in the codebase** — a Gate 7 grep assertion,
not a claim.

`--dir docs` produces `docs/x.md`, identical to declaring `["docs"]`; `--dir ../notes` produces
`notes/x.md`. Safe because `compendio index` calls `reset()` before writing, so two root sets can never
coexist in one database. The one genuinely surprising thing about the flag still needs documenting:
it **replaces** the corpus, it does not add a root.

### Decision 11: `scripts/vector-reach.mjs` calls the same `resolveRoots`

`scripts/vector-reach.mjs:204` does `resolve(root, config.docsDir, markerChunk.path)`. Under an array
`docsDir` it throws `TypeError [ERR_INVALID_ARG_TYPE]` — now **unconditionally**, since no string form
survives — and even if it did not, `markerChunk.path` is already prefixed, so the join would be wrong
twice over. Left alone it silently disables the manual chunking gate.

The script already imports from the same module (`import { loadConfig } from
"../dist/infrastructure/config.js"`, `:95`), so importing `resolveRoots` beside it is free:

```js
const roots = resolveRoots(root, loadConfig(root).docsDir);
const owner = roots.find((r) => markerChunk.path.startsWith(`${r.prefix}/`)) ?? roots[0];
const docPath = resolve(owner.dir, markerChunk.path.slice(owner.prefix.length + 1));
```

**Why not `config.docsDir[0]`.** Three characters cheaper, and it creates a second implementation of
root resolution inside a manual gate that runs once per chunking change — the exact place a divergence
survives longest. Gate 7 keeps running the script against `test/fixtures/vector-reach`, whose single
root now aliases to `docs`, so `owner.prefix === "docs"` and the resolved absolute path is identical
to today's.

### Decision 12: `ReadDocument` is a test, not an edit — with the residual case named

`ReadDocument.resolve` (`read-document.ts:44-50`) tries the literal path first and only then strips one
leading segment. With every indexed path alias-prefixed:

- **The motivating case becomes the exact branch.** A caller holding the on-disk `docs/func/x.md` now
  hits the literal match instead of the strip fallback. The heuristic gets strictly more useful.
- **No indexed path is a bare basename**, so the strip can never resolve `docs/x.md` into a
  corpus-level `x.md`. The old design stopped here and claimed no false hit is representable. **That
  claim was too strong**, and the revision corrects it rather than repeating it.
- **The residual case, precisely.** The strip yields `<first>/<rest>`, which *is* a valid indexed path
  when `<first>` happens to equal another root's alias. With `docsDir: ["docs", "adr"]`, a request for
  a non-existent `docs/adr/x.md` strips to `adr/x.md` and resolves to a real, different document.

**Accepted, not fixed.** It fires only when the requested path does not exist, so the alternative
outcome is `path-not-found` plus three closest matches, and returning a plausible neighbour is the
recovery posture this tool already documents (`CLAUDE.md`: "a genuine document at `a/b.md` always wins
over stripping into `b.md`"). It is the same heuristic ambiguity that exists today, one segment
further in. The design's obligation is that it be **pinned by a test and named in the spec**, not
discovered later. `sdd-spec` owns whether the scenario is normative.

So: no edit to `read-document.ts`, three new tests (exact hit, over-prefixed hit, the aliased-collision
case above), and the bare-basename miss (`read_doc({ path: "x.md" })` → `path-not-found`) as a fourth.

### Decision 13: `test/helpers/build.ts` prefixes, and derives its alias from `resolveRoots`

**Confirmed — the proposal's argument holds, and the mechanism matters more than the decision.**

`buildHarness` (`build.ts:80-89`) documents itself as *"In-memory composition over a docs corpus,
mirroring production wiring"* and then constructs `new FileDocumentSource(docsDir, ["INDEX.md"])` with
no prefix. After this change that comment is false on the single most visible thing production wiring
does, and a helper that diverges from production on the most visible contract is what produced
finding 2 (Decision 14).

**Choice.** The harness calls the production function rather than reimplementing it:

```ts
const [root] = resolveRoots(REPO_ROOT, [docsDir]);          // docsDir is absolute; resolve() passes it through
new FileDocumentSource(root!.dir, ["INDEX.md"], root!.prefix)
```

**Why `resolveRoots` and not `basename(docsDir)`.** Basename is one line and correct today. It is also
a second implementation of alias derivation, in the file whose job is to not diverge from production —
the same argument as Decision 11. Calling the real function means a future change to alias derivation
reaches the harness automatically instead of being a bug report.

**The measured cost, and one correction to the proposal's figure.** All four corpus constants in
`build.ts` end in `/docs` (`ejemplos/docs`, `test/fixtures/{strict,excerpt-window,vector-reach}/docs`),
so every harness prefix is the same string, `docs`, and every affected literal gains the same
`docs/` prefix. The proposal recorded 19 unprefixed path literals across **3** files; verified
2026-08-07, the shared harness has **26 call sites across 5 files** — `evaluate.test.ts` (2),
`index-and-search.test.ts` (5), `read-document.test.ts` (1), `excerpt-window.test.ts` (4),
`heading-less-round-trip.test.ts` (1), plus 13 in `sync-index.test.ts` which define their **own** local
`buildHarness` (`sync-index.test.ts:53`) over a fake source and are unaffected. The last two files
assert **bare-basename** literals (`alpha.md`) that the proposal's `<dir>/<file>.md` count did not
match, so the churn is larger than 19. The forecast below carries the correction; the number is
recorded rather than smoothed.

`index-progress.test.ts:19` constructs `FileDocumentSource(EXAMPLES_DOCS, ["INDEX.md"])` directly. It
asserts progress events, not paths, so it needs no change — but it is the second harness-shaped
divergence in the suite and should be prefixed in the same commit for the same reason.

**Sequencing.** Harness + literals + goldenset land together, in PR 2, in one commit. Splitting them
leaves an intermediate state with a red suite and no reviewer able to tell mechanical re-addressing
from a real regression.

**Rejected — correct the comment instead and leave the harness unprefixed.** Honest, cheap, and it
keeps every integration test running against a path shape production never produces. The comment was
not the defect; the divergence was.

### Decision 14: the goldenset is re-addressed, and one container-level test is the gate

**The verified finding.** `ejemplos/goldenset.yaml` carries **22** `esperado` values, all unprefixed
(`leadsviewer/validacion-formulario.md`), and `EvaluateSearch` compares them by exact string
(`evaluate-search.ts:49`, `rankedDocs.indexOf(normalizePath(item.expected))`). Under unconditional
prefixing all 22 miss and `compendio eval` reports MRR 0 / recall 0 — **while `npm test` stays green**,
because no test reads that file (`evaluate.test.ts` uses three inline cases through the unprefixed
harness) and **`createContainer` appears zero times in `test/`** (both verified 2026-08-07).

**Choice — the re-addressing.** Each `esperado` gains the `docs/` prefix:
`leadsviewer/validacion-formulario.md` → `docs/leadsviewer/validacion-formulario.md`. Twenty-two lines,
addresses only. **Not a translation**: no `pregunta`, no prose, no filename, no frontmatter value
changes, and the same document is still expected for the same question, so the published quality
numbers stay comparable and the Spanish control group survives intact (`openspec/config.yaml`'s
language contract). The three inline `CASES` in `evaluate.test.ts:9,13,18` are re-addressed with them.

`scripts/excerpt-offset-distribution.mjs:43` also reads the goldenset but uses only `item.pregunta`
(`:52`) — verified; it needs no change.

**Choice — the gate.** One new test file, `test/application/goldenset-addresses.test.ts`, which is
**also** Gate 1b. It must exercise the real wiring, because the harness is precisely what was blind:

```ts
// beforeAll: copy ejemplos/ (docs + goldenset.yaml) into a temp dir — no config file
await cp(EXAMPLES_ROOT, tmp, { recursive: true });
const container = createContainer({ root: tmp, forceLexical: true });
await container.indexDocuments.execute();
const indexed = new Set(container.store.listDocuments().map((d) => d.path));

// Gate 1b — the zero-config path shape
expect([...indexed].every((p) => p.startsWith("docs/"))).toBe(true);

// Decision 14 — every goldenset address is a real indexed path
for (const c of parseYaml(readFileSync(join(tmp, "goldenset.yaml"), "utf8"))) {
  expect(indexed).toContain(c.esperado);
}
```

Four properties make this the right gate rather than a convenient one:

1. **It goes through `createContainer`**, so `loadConfig` (no config file → `["docs"]`), `resolveRoots`,
   the composite, the seeded prefix and the store are all real. It is the first test in the suite that
   does.
2. **It reads the real `ejemplos/goldenset.yaml`**, not a fixture. A gate over a copy of the addresses
   would pass while the shipped file was wrong — the same class of blindness it exists to close.
3. **It copies to a temp directory.** Running against `ejemplos/` in place would write
   `ejemplos/.compendio/compendio.db`, clobbering the manually-indexed database that
   `scripts/excerpt-offset-distribution.mjs:37` reads. A recursive copy of 11 documents is free.
4. **`forceLexical: true`.** The assertion is address-only, so no model download, no network, no
   nondeterminism. Retrieval *quality* stays where it belongs — the manual Gate 1 `compendio eval` run.

**It survives this change.** Any future edit to path shape, alias derivation or `docsDir` handling that
does not carry the goldenset with it now turns the suite red. That is the standing repair for
"tests green, function invisible", not a one-off.

**Two confounders ruled out, so Gate 1's *identity* assertion on the eval numbers is sound.** Both
verified against code, because a moved baseline would be read as "prefixing did more than prefix":

- `NO_CHUNKING = ["glosario.md"]` is matched by `isNoChunking` (`index-pipeline.ts:96-98`) as
  `entry === path || entry === basename`. The **basename clause** survives prefixing, so
  `docs/glosario.md` still bypasses heading chunking and the corpus chunk count does not move.
- The embedded string is `` `passage: ${chunk.heading}\n${chunk.content}` ``. Under `loose`,
  `documentHeading`'s path level (`index-pipeline.ts:81`) is unreachable while `meta.title` is
  non-empty, and `humanizeFileName` reads the **basename** (`convention.ts:46`), so no embedded string
  on `ejemplos/` changes. Every stored vector is bit-identical.

**Rejected — teach `EvaluateSearch` to tolerate a missing prefix.** It weakens the project's sharpest
falsifier to protect a file that is easier to edit than the instrument is to keep honest, and it would
make a genuinely mis-addressed goldenset unfalsifiable forever.

## Flow notes

Per `rules.design`. Line numbers are current, pre-change.

**Container construction — one path, no branch:**

```
createContainer(options)                                            composition.ts:56
  ├─ config = loadConfig(options.root)                                          :57
  ├─ roots  = resolveRoots(options.root,
  │             options.docsDir !== undefined ? [options.docsDir] : config.docsDir)  NEW, replaces :58
  │     ├─ normalize   ["docs","openspec"] → [{declared, dir, prefix: basename(dir)}, …]
  │     └─ validate    empty | non-string | duplicate | nested | alias clash → throw  (Decision 5)
  ├─ store = new SqliteIndexStore(...)         :59  ── unreached when the guard throws (Decision 6)
  ├─ source = new CompositeDocumentSource(roots.map(r => ({ ...r,                :72
  │             source: new FileDocumentSource(r.dir, config.exclude, r.prefix) })))
  ├─ policy = createConventionPolicy(config.convention, roots.map(r => r.prefix))  :74  (Decision 7)
  └─ generateIndexMd = new GenerateIndexMd(source, parser,
        new FileIndexWriter(roots[0].dir, INDEX_FILE), policy, comparator,
        `${roots[0].prefix}/${INDEX_FILE}`)                                      :79  (Decision 9)
```

**One discovery pass, `docsDir: ["docs", "openspec"]`, `openspec/` absent:**

```
CompositeDocumentSource.discover()
  ├─ root "docs"     → FileDocumentSource(/abs/docs, exclude, "docs").discover()
  │     └─ walk(/abs/docs, "docs", isRoot=true)
  │           ├─ documentation-convention.md → path "docs/documentation-convention.md"
  │           │        isExcluded(path, basename)?  ← the SAME string that will be emitted (Decision 1)
  │           └─ INDEX.md → excluded by basename (default exclude)
  ├─ root "openspec" → readdir throws ENOENT at isRoot=true → thrown by the primitive (Decision 2)
  │     └─ caught here → readErrors.push({ path: "openspec", error: 'declared documentation root
  │                       "openspec" (/abs/openspec) could not be read: ENOENT …' })   (Decision 4)
  ├─ not every root failed → no rethrow
  └─ files.sort(localeCompare)  →  { files, readErrors, encodingNotices }

IndexDocuments.execute()                                         index-documents.ts:83-89
  └─ skipped = readErrors.map(...)   → the missing root appears in `skipped` as path "openspec"

SyncIndex.execute()                                                  sync-index.ts:87,175
  └─ deleteMissingDocuments: isProtected("openspec/specs/x.md", ["openspec"]) → true → not deleted
```

**Every root unreadable (the only remaining throw):**

```
CompositeDocumentSource.discover()
  ├─ each root throws, each caught and recorded
  └─ failures === roots.length → throw new Error(
        'no documentation root could be read: "docs" (/abs/docs): ENOENT …')
        → propagates to cli.ts:297-300's top-level .catch()
```

**Module inference, same pass:**

```
transformFile → policy.resolver({ path: "openspec/specs/indexing/spec.md", … })
  └─ loose: module = frontmatter.module ?? inferModule(path, ["docs","openspec"])
                                            └─ strip "openspec/" → "specs/indexing/spec.md" → "specs"
```

## Interfaces / Contracts

```ts
// src/infrastructure/config.ts  (changed + added)
export interface CompendioConfig {
  docsDir: string[];            // was: string.  DEFAULT_CONFIG.docsDir = ["docs"]
  …
}
export interface ResolvedRoot { declared: string; dir: string; prefix: string }   // prefix never ""
export function resolveRoots(projectRoot: string, docsDir: string[]): ResolvedRoot[];  // length >= 1

// src/infrastructure/fs/file-document-source.ts  (one optional constructor argument)
constructor(docsDir: string, exclude: string[], pathPrefix?: string);   // default ""

// src/infrastructure/fs/composite-document-source.ts  (new)
export interface RootSource { declared: string; dir: string; prefix: string; source: DocumentSource }
export class CompositeDocumentSource implements DocumentSource {
  constructor(roots: RootSource[]);       // length >= 1
  discover(): Promise<DiscoverResult>;    // throws only when EVERY root throws
}

// src/domain/convention.ts  (two optional parameters)
export function inferModule(path: string, rootPrefixes?: readonly string[]): string | undefined;
export function createConventionPolicy(cfg: ConventionConfig, rootPrefixes?: readonly string[]): ConventionPolicy;

// src/application/generate-index-md.ts  (one optional constructor argument)
constructor(source, parser, writer, policy, compare, selfPath?: string);   // default INDEX_FILE

// src/composition.ts
export interface ContainerOptions { docsDir?: string; … }   // UNCHANGED — Decision 10
```

**Unchanged — asserted, not assumed** (Gate 7): `src/domain/ports.ts` in full; `SCHEMA_DDL` and
`documents(path TEXT UNIQUE NOT NULL)` (`sqlite-index-store.ts:48`); `src/application/sync-index.ts`;
`src/application/read-document.ts`; `src/infrastructure/fs/file-index-writer.ts`; `ConventionConfig`;
`mergeConfig`'s `docsDir` line; `src/cli.ts`.

## The gates, made mechanically checkable

Array-only collapses the dual-mode gates. Gate 1's "single-root is byte-identical" is meaningless with
no single-root mode, and **Gate 4′ folds into Gate 4**: it existed because under the union a non-empty
prefix was the opt-in case, so a seeded-prefix regression could hide in a suite that only ran the
default. Now every run carries a non-empty prefix, so if root detection were left on `prefix === ""`
no root would ever throw, and Gate 4's *all roots unreadable → still throws* bullet falsifies it on
the default path. **Gate 4″ does not fold** — `ReadError.path` carrying the alias is orthogonal to the
union, it is the silent-data-loss guard, and nothing else in the suite would notice it. It is promoted
to a standalone gate, 4b.

| Gate | What it now proves | Decision | Assertion, concretely |
|---|---|---|---|
| 1 — prefixing costs one segment and nothing else | the path change is a prefix, not a re-chunk or a re-embed | 1, 5, 7, 14 | `ejemplos/` paths = old value + `docs/`, same set/count/order; `compendio eval` MRR/recall/top-1 as **identity**, and the pre-re-addressing MRR 0.000 recorded first |
| 1b — the zero-config shape is asserted through real wiring | the suite is no longer blind to composition | 6, 14 | `createContainer` over a temp copy of `ejemplos/`, no config file → every indexed path starts `docs/`. **Same test file as the goldenset gate** |
| **1c — every goldenset address is a real indexed path** | the goldenset can never silently miss again | 14 | the real `ejemplos/goldenset.yaml`, 22 `esperado` values, `expect(indexed).toContain(...)`, lexical-only |
| 2a — no UNIQUE crash | identity was solved at discovery | 5, 6 | full `compendio index` on this repository, exit 0 |
| 2b — count | nothing was silently dropped or doubled | 1 | formula computed at gate time, both numbers into `verify-report.md` |
| **2c — zero archived paths** | `exclude` is matched against the emitted path | **1, 8** | `SELECT count(*) FROM documents WHERE path LIKE 'openspec/changes/archive/%'` → **0**. Reads **79** if prefixing were post-hoc. Also unit-level with no filesystem: `FileDocumentSource(dir, ["sub/deep"], "alias")` |
| 2d — every path prefixed | prefixing is unconditional | 1 | `… WHERE path NOT LIKE 'docs/%' AND path NOT LIKE 'openspec/%'` → 0 |
| 2e — round trip | the emitted path is a usable address | 12 | a `search_docs` hit under `openspec/`, its `path` verbatim into `read_doc` → `type: "document"` |
| 3 — `module` is a folder signal | alias-awareness landed | 7 | `docs/documentation-convention.md` → no `module`; `openspec/specs/indexing/spec.md` → `"specs"`; `byModule` has no `docs`/`openspec` bucket. Also a pure `inferModule` unit test |
| 4 — a missing root does not crash, and the layer is the named one | the failure policy sits where Decision 2 put it | 2, 3 | composite over a throwing fake: one of two fails → other root's files present + one `ReadError`; **all** fail → rejects with the aggregate message; `FileDocumentSource` against an unreadable root still rejects, **with and without a prefix**; `file-document-source.test.ts:99` **passes unchanged** |
| **4b — a failed root protects its subtree** | `ReadError.path` is the alias, so `serve` cannot purge a corpus | **4** | `SyncIndex` pass over a store holding `openspec/**`, source returns `readErrors: [{ path: "openspec" }]` and no files → `deleted` is empty. Fails if the declared path is carried |
| 5 — the collision guard fires before anything is written | the UNIQUE crash is unreachable | 5, 6 | `createContainer` throws for `["docs","docs/adr"]`, **`["docs/adr","docs"]` (inner first)**, `["docs","docs"]`, a case-differing duplicate on win32, `["a/docs","b/docs"]`, `[]`; message names both declared strings; **and `.compendio/` does not exist afterwards** in a fresh temp project |
| 6 — `INDEX.md` | the three dead checks are alive again | 9 | combined file in `roots[0]`, prefixed entries; never lists itself **with `exclude: []`** — the only case reaching lines 41/46/77 |
| 7 — nothing else moved | the design's asserted-unchanged list is true | — | `npm test`, `npm run typecheck`, `npm run build`; `sync-index.ts` and `SCHEMA_DDL` diffs empty; **`grep "string \| string\[\]"` finds nothing**; `scripts/vector-reach.mjs` runs end to end |

### P1 — the `path.relative` case-sensitivity probe — **RESOLVED, ran 2026-08-07**

> **Answered by the orchestrator, on the target platform** (win32, Node v22.22.0 — this repo's floor).
> `relative('C:\A\docs', 'C:\a\docs')` returns `""`: **`path.relative` is case-insensitive on win32**,
> so Decision 5's containment check is complete as designed and no `toLowerCase()` clause is needed.
> Nesting across a case difference is caught too (`relative('C:\A\docs', 'C:\a\docs\adr')` → `"adr"`).
>
> The probe also falsified a phrasing carried since `exploration.md`. `resolve(a) === resolve(b)` is
> **`false`** for that same pair — so the guard as worded in the exploration and proposal ("two roots
> that *resolve to the same absolute path*"), implemented literally with string equality, misses
> `["docs", "../Repo/DOCS"]` on Windows and lets the UNIQUE-constraint crash through on the platform
> this project is developed on. Decision 5's choice of `relative` over `===` is load-bearing, not
> stylistic: implement the predicate, not the prose.
>
> **One clause the predicate still needs: check ordered pairs, both directions.** `contained` answers
> only "does `b` lie inside `a`". Measured: `relative('C:\A\docs\adr', 'C:\A\docs')` → `".."`, which
> the predicate reads as *not* contained. So `docsDir: ["docs/adr", "docs"]` — the inner root declared
> first — passes a one-directional sweep and reproduces exactly the double-discovery this guard exists
> to reject. Iterate every ordered pair `(a, b)` with `a ≠ b`. This needs a test case of its own, with
> the inner root declared first.

The pre-resolution instructions that stood here (how to run the probe, and the branch to take if
`relative` had turned out case-sensitive) are **superseded** by the measurement above and removed.

## Spec delta guidance (for `sdd-spec`, which has not run yet)

| Domain | Requirement | Must compose with |
|---|---|---|
| `configuration` | `docsDir` is a non-empty **array** of strings, default `["docs"]`. There is no string form and no mode | new; state it as "array-only", never as "array or string" |
| `configuration` | A declared root set with duplicate, nested (**in either declaration order**), or alias-colliding roots MUST be rejected at container construction, before any database file is created or modified | new; Gate 5. Name all three cases in scenarios — a spec that only pins nesting invites the other two to regress |
| `configuration` | `exclude` entries match the full **emitted** path, the basename, or a directory prefix of the emitted path | amends today's exact-equality wording (`README.md:150`, "filenames to skip"). One rule, no mode |
| `configuration` | `--dir` replaces the corpus with one directory, normalized to a one-element root set with the same prefixed path shape | new; the one genuinely surprising thing about the flag |
| `indexing` | Every emitted `path` is `<alias>/<root-relative path>`, where `<alias>` is the declared root's directory name — **including with no config file** | new; composes with `mcp-contract`'s path shape |
| `indexing` | **AMENDS `spec.md:350` and its scenario at `:358-362`.** A declared root that cannot be read is reported as a read failure whose `path` is the root's **alias**, and the run continues on the remaining roots. The run throws only when **every** declared root fails | **The required spec action.** Do not delete the MUST — narrow it. The alias-as-`path` clause is normative: `spec.md`'s existing "Read Failures Protect the Affected `path` Subtree From Deletion" requirement is what consumes it (Decision 4) |
| `indexing` | `module` inference strips a matching declared root prefix before taking the first segment | amends `spec.md:106` ("First path segment under `docsDir`") |
| `indexing` | Removing a root from `docsDir` deletes its documents on the next sync pass; an unreadable root does not | new; best written as one requirement with both scenarios — the contrast is the explanation |
| `index-md` | One combined index is written into the **first** declared root, lists every document from every root under its prefixed path, and never lists itself regardless of `exclude` | amends the existing self-exclusion guarantee; the `exclude: []` scenario is the one with teeth |
| `mcp-contract` | `path` values returned by `search_docs`/`docs_overview` and accepted by `read_doc` carry the root prefix, always | new |
| `mcp-contract` | `read_doc` tolerates one leading path segment; a bare basename no longer resolves and returns `path-not-found` with the closest matches | **currently spec-silent** — pin it now (Decision 12). Include the residual aliased-collision case as a scenario or an explicit non-guarantee; an unspecified behaviour amended in passing is one a future cleanup deletes with a green suite |

## File Changes

| File | Action | Description |
|---|---|---|
| `src/infrastructure/config.ts` | Modify | `docsDir: string[]`, default `["docs"]`; `ResolvedRoot` + `resolveRoots` with the ordered-pair guard (Decision 5) |
| `src/infrastructure/fs/composite-document-source.ts` | **New** | Merge, sort, per-root failure → `ReadError`, all-fail rethrow (Decisions 2–4). Zero `node:` imports |
| `src/infrastructure/fs/file-document-source.ts` | Modify | `pathPrefix` argument; `isRoot` replacing `prefix === ""`; three-clause `isExcluded`; root-failure message rewritten in English (Decisions 1, 2, 8) |
| `src/composition.ts` | Modify | `resolveRoots` before the store; one unconditional wiring path; policy prefixes; writer target; `selfPath` (Decisions 6, 7, 9, 10) |
| `src/domain/convention.ts` | Modify | Optional `rootPrefixes` on `inferModule` and `createConventionPolicy`. **The only domain change**; no new dependency, no `ports.ts` change |
| `src/application/generate-index-md.ts` | Modify | `selfPath` parameter; three equality checks retargeted (Decision 9) |
| `src/domain/ports.ts` | **Unchanged** | The composite implements the existing `DocumentSource` |
| `src/application/sync-index.ts` | **Unchanged — asserted** | Decision 4 is what makes this true. An edit here means the failed-root `ReadError.path` is wrong |
| `src/application/read-document.ts` | **Unchanged — asserted** | Decision 12; covered by four tests, not an edit |
| `src/infrastructure/sqlite/sqlite-index-store.ts` | **Unchanged — asserted** | DDL byte-identical |
| `src/cli.ts` | **Unchanged** | `--dir` stays a single-value option; normalization happens in `composition.ts` (Decision 10) |
| `scripts/vector-reach.mjs` | Modify | `resolveRoots`-based marker path resolution (Decision 11) |
| `ejemplos/goldenset.yaml` | Modify (addresses only) | 22 `esperado` values gain `docs/`. Not a translation (Decision 14) |
| `test/helpers/build.ts` | Modify | Harness prefixes via `resolveRoots` (Decision 13) |
| `test/application/goldenset-addresses.test.ts` | **Create** | Gates 1b and 1c in one file, through `createContainer` (Decision 14) |
| `test/infrastructure/config.test.ts` | Extend | Array shape; all seven rejection messages incl. inner-root-first nesting and the case-differing duplicate. `:62-70`'s single-string round trip is **restated as an array** |
| `test/infrastructure/file-document-source.test.ts` | Extend | Prefixed emission; exclusion against the prefixed path; root throw with a non-empty prefix; `:99` **unchanged** |
| `test/infrastructure/composite-document-source.test.ts` | **Create** | Merge/sort, one-root failure, all-roots failure, `ReadError.path` is the alias — all over fakes |
| `test/domain/convention.test.ts` | Extend | `inferModule` with and without prefixes; root-level file → `undefined` |
| `test/application/sync-index.test.ts` | Extend | **Gate 4b** — a failed-root `ReadError` protects its subtree |
| `test/application/generate-index-md.test.ts` | Extend | Combined index, prefixed paths, self-exclusion with `exclude: []` |
| `test/application/read-document.test.ts` | Extend | Exact hit, over-prefixed hit, bare-basename miss, the aliased-collision case (Decision 12) |
| `test/application/index-and-search.test.ts` | Extend | Multi-root integration over a temp two-root corpus, lexical-only; re-addressed literals |
| `test/application/{evaluate,excerpt-window,heading-less-round-trip}.test.ts`, `index-progress.test.ts` | Extend | Re-addressed literals from the now-prefixed harness (Decision 13) |
| New container-construction test | **New** | Every collision case rejected, **and no `.compendio/`** afterwards |
| `openspec/specs/{configuration,indexing,index-md,mcp-contract}/spec.md` | Modify | Deltas above; check `search/spec.md` for path-shape claims |
| `README.md:132,148-150` · `CLAUDE.md` | Modify | `docsDir` as an array, the always-prefixed shape incl. zero-config, directory `exclude`, `--dir`, unreadable-vs-removed root |

## Testing Strategy

`strict_tdd: true`. Red first — and for the gates whose current state is *passing*, red means a
baseline test that is landed and then inverted (the `addressable-chunks` Gate 1 pattern).

| Layer | What | Where |
|---|---|---|
| Unit | `resolveRoots`: array normalization, alias from `"docs/"`/`"./docs"`/absolute, all seven rejection messages, ordered-pair nesting in both declaration orders | `config.test.ts` |
| Unit | `FileDocumentSource` with a prefix: emission, exclusion against the prefixed path, root throw with a non-empty prefix, `:99` unchanged | `file-document-source.test.ts` |
| Unit | `isExcluded` three clauses, incl. `docs` not excluding `docs-old/x.md` and the trailing-slash form | `file-document-source.test.ts` |
| Unit | Composite over fakes: merge order, sort, one failure, all failures, alias as `ReadError.path` | `composite-document-source.test.ts` (new) |
| Unit | `inferModule(path, prefixes)` — stripped, unstripped, root-level, no prefixes | `convention.test.ts` |
| Integration | A failed-root `ReadError` protects its subtree from `deleteMissingDocuments` | `sync-index.test.ts` |
| Integration | Two-root corpus: index → search → `read_doc` round trip, lexical-only | `index-and-search.test.ts` |
| Integration | Combined `INDEX.md`, prefixed entries, self-exclusion with `exclude: []` | `generate-index-md.test.ts` |
| **Container** | **Zero-config path shape + every goldenset address, through `createContainer`** | `goldenset-addresses.test.ts` (new) |
| Container | Every collision case rejected, leaving no `.compendio/` | new, beside the above |
| Manual | Gates 1, 2, 3 on this repository and on `ejemplos/`; recorded observations | `verify-report.md` |
| Manual | Gate 7's `scripts/vector-reach.mjs` against `test/fixtures/vector-reach` | `verify-report.md` |

Three baselines to land and invert, because today's suite is green on all three:

1. `exclude: ["sub"]` against a corpus containing `sub/x.md` — assert today that `sub/x.md` **is**
   discovered (exact equality only), then invert. Without it, Gate 2c could pass for the wrong reason
   on an empty fixture.
2. `docs_overview`'s `byModule` for a root-level file in a prefixed corpus — assert the naive `"docs"`
   bucket first, then invert to absent. Gate 3 made red before Decision 7 exists.
3. **The goldenset gate itself.** Land `goldenset-addresses.test.ts` *before* the goldenset is
   re-addressed and confirm it fails on all 22 entries. A gate that has never been red is a gate
   nobody has verified.

## Migration / Rollout

No migration, no schema marker, no shim — beta, no installed users (`openspec/config.yaml`,
`rules.proposal`), and the schema is unchanged by construction.

**What array-only changes about rollout: the default path shape moves, deliberately.** With no config
file, `docs/documentation-convention.md` becomes the indexed `path` where today it is
`documentation-convention.md`. This is not a side effect to be minimised; it is the decision. The
prefixed path *is* the project-root-relative path, so a caller holding the on-disk path now hits
`read_doc`'s exact branch (Decision 12). The cost is named in the proposal and reproduced here: a bare
basename stops resolving and degrades into `path-not-found` plus three closest matches.

The proposal's five-step rollback stands. Two design-level clarifications:

1. **Step 4 (full `compendio index`) is mandatory even for a project with no config file.** Persisted
   paths are prefixed; reverted code emits unprefixed ones and would see every document as absent from
   disk, so `deleteMissingDocuments` purges the corpus one `serve` sync pass later anyway. `index`'s
   `reset()` reaches the correct state in one step instead of by attrition. Under the union this step
   was only needed by projects that had opted in; it is now universal.
2. **Step 2 (revert array configs to strings) is the uncommon case, not the common one.** Under
   reverted code an array reaches `resolve(options.root, config.docsDir)` (`composition.ts:58`) and
   throws `TypeError [ERR_INVALID_ARG_TYPE]` at container **construction** — every command fails,
   `search` and `serve` included. But array-only means most projects never declare `docsDir` at all,
   and those need only steps 1, 3 and 4.

### Delivery size — a design-phase forecast

| Driver | Estimate |
|---|---|
| `config.ts` — `string[]`, `resolveRoots`, ordered-pair guard, seven messages | 55–85 |
| `composite-document-source.ts` (new) | 55–85 |
| `file-document-source.ts` — prefix, `isRoot`, `isExcluded`, English message | 20–35 |
| `composition.ts` — one wiring path, prefixes, writer target, `selfPath` | 15–30 |
| `convention.ts` — optional `rootPrefixes` | 15–25 |
| `generate-index-md.ts` — `selfPath` + three checks | 10–20 |
| `scripts/vector-reach.mjs` | 10–20 |
| `config.test.ts` — array shape + every rejection incl. inner-root-first | 90–140 |
| `file-document-source.test.ts` — prefix, exclusion, root throw, baselines | 80–120 |
| `composite-document-source.test.ts` (new) | 110–170 |
| `convention.test.ts` + `sync-index.test.ts` (Gate 4b) | 70–110 |
| `generate-index-md.test.ts` + `read-document.test.ts` (4 cases) | 80–130 |
| `build.ts` harness + re-addressed literals across **5** consumer files | 150–230 |
| `index-and-search.test.ts` multi-root integration | 60–100 |
| Container-construction rejection test | 40–60 |
| **`goldenset-addresses.test.ts` (Gates 1b + 1c)** | 45–70 |
| `ejemplos/goldenset.yaml` — 22 re-addressings | 22 |
| Spec deltas (`configuration` ×4, `indexing` ×4, `index-md`, `mcp-contract` ×2) | 320–520 |
| `README.md` + `CLAUDE.md` | 55–85 |

**1 302–2 057 changed lines**, against the proposal's 1 195–1 885. The code half is *below* the
proposal's figure — no post-hoc rewriting, one shared `resolveRoots`, optional parameters instead of
new types — and the test half is above it, for two measured reasons stated rather than smoothed: the
harness churn spans **5** consumer files, not 3 (Decision 13), and the goldenset gate is a new file
the proposal folded into an existing line item (Decision 14).

**A smaller estimate is still an estimate.** Unsmoothed history: `bounded-chunk-size` 240–420 →
555–695 → **773**; `match-centred-excerpt` 300–470 → 750–800 → **~1 521** (4x its proposal figure);
`incremental-reindex` missed by 2x. Applying that honestly puts this at **2 000–3 500 by apply**. A
single PR is not a live option.

**Decision needed before apply: Yes. Chained PRs recommended: Yes. 400-line budget risk: High.**

### Cut line — the proposal's four slices, with the composite split across two

- **PR 1 — `exclude` and the enabling refactor.** Three-clause `isExcluded`, the English root-failure
  message, **and Decision 1's `isRoot` parameter** (behaviour-preserving on its own: with no prefix
  seeded, `isRoot === true` ⟺ `prefix === ""`). Plus the `configuration` `exclude` delta.
  Independently valuable today — a single-root project currently cannot exclude a folder at all. The
  refactor belongs *before* the PR that could disable it; landing it alongside prefixing means one
  diff both creates and defuses the trap, which is how a trap gets waved through.
- **PR 2 — the structural core.** `docsDir: string[]`, `resolveRoots` + the ordered-pair guard,
  `pathPrefix`, `CompositeDocumentSource` **with no `try`/`catch`** (any root failure propagates,
  exactly as a missing `docs/` does today), composition wiring, the `configuration` deltas — and, in
  the same PR, `ejemplos/goldenset.yaml`, the harness and the re-addressed literals, because this is
  the slice where the path shape changes. Gates 1, 1b, 1c, 2c, 5.
- **PR 3 — the behavioural companions.** The composite's per-root `try`/`catch` and all-fail rethrow
  with the `indexing` MUST amendment, Decision 4's alias-as-`ReadError.path` with Gate 4b, alias-aware
  `inferModule`. Gates 3, 4, 4b.
- **PR 4 — surface and documentation.** Combined `INDEX.md`, the three retargeted equality checks,
  `index-md`/`mcp-contract` deltas, `scripts/vector-reach.mjs`, `README.md`, `CLAUDE.md`.

**Why the composite is split rather than landed whole in PR 2.** The class must exist in PR 2 — it is
how N roots are wired — but its *tolerance* is PR 3's subject. Landing PR 2 with no `catch` keeps that
slice shippable on its own terms: the default `["docs"]` set then behaves exactly as a missing `docs/`
does today, which is the proposal's stated condition for PR 2 being independently mergeable.

Two sequencing constraints, not negotiable by the task phase:

1. **Prefixing and the collision guard cannot land in separate PRs.** Separated, the intermediate state
   ships the uncaught SQLite UNIQUE-constraint crash at `index-documents.ts:106` this whole design
   exists to prevent.
2. **Multi-root is unusable until PR 3 lands** — after PR 2 alone a missing declared root still hard
   crashes the run. Nothing may document or announce the feature before PR 3, and Gates 2, 3, 4 and 4b
   cannot be run before it.

## Open Questions

- [ ] **Do `exclude` entries accept `\` separators on Windows?** Assumed **no** — emitted paths are
      POSIX and the rule stays three string comparisons. The cost is a Windows user writing
      `openspec\\changes\\archive` and getting a silent no-op, the failure shape this change dislikes
      most. Recommend `sdd-spec` pins "entries use `/` on every platform" so the behaviour is at least
      declared; separator normalization is a one-line follow-up if the trap is ever observed.
- [ ] **Where `CompositeDocumentSource` lives.** Placed in `src/infrastructure/fs/` beside the other
      `DocumentSource` adapters, although it imports nothing from `node:`. A reviewer preferring
      `src/infrastructure/` is not wrong; it is a rename with no consequence.
- [ ] **Whether the combined `INDEX.md` header names the roots it covers.** Assumed one added
      sentence, so a reader of `docs/INDEX.md` is not surprised by `openspec/...` lines. `sdd-spec` may
      rule the header out of scope; the paths themselves are not.
- [ ] **Is Decision 12's residual aliased-collision case a normative non-guarantee or a scenario?**
      Design accepts the behaviour and pins it with a test either way. `sdd-spec` owns whether
      `mcp-contract` states it as a guarantee, a documented limit, or stays silent — and silence is the
      one option this design argues against.
- [ ] **Should an alias-clashing set be rejected, or auto-disambiguated** (`docs`, `docs-2`)? Assumed
      **rejected**, per Decision 5. Auto-disambiguation makes a path shape depend on declaration order,
      which is worse than a message telling the user to declare an alias — the deferred object form
      (`[{ path, alias }]`) is the real answer if this is ever hit.
