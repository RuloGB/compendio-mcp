# Archive Report: multiple-doc-roots

**Change**: multiple-doc-roots
**Archived**: 2026-08-08 — spec merge only, see Scope Note below
**Status**: SPEC MERGE COMPLETE; FOLDER MOVE / BUILD RE-VERIFICATION / GIT COMMIT NOT PERFORMED BY THIS PHASE (toolset limited to Read, Edit, Write, Glob — no Bash/shell/git — see Scope Note)

Artifact store this cycle: openspec (file-based). Engram MCP tools were confirmed unavailable again
this batch (per `proposal.md`'s Resolved Decisions table and `verify-report.md`'s own header) — no
`mem_*` calls made or available in this phase's toolset.

## Executive Summary

The `multiple-doc-roots` change (4-PR chain, 70/70 tasks, `verify-report.md` verdict **PASS — 0
CRITICAL, 0 WARNING**, 2 low-priority suggestions) has had its four delta specs merged into the main
specs. `docsDir` is now formally specified as a non-empty array of declared roots (default `["docs"]`,
no single-string form), every document `path` carries its declared root's alias prefix unconditionally,
a collision guard rejects duplicate/nested/alias-clashing root sets before any write, `exclude` matches
a directory prefix against the emitted path, and the "unreadable docs root always throws" MUST is
narrowed to "throws only when every declared root fails" — the proposal's own named required spec
amendment. This report documents the merge, the two destructive replacements it performed (both
intentional, both required by the change), the Spanish-vocabulary scan, and — per this project's own
established precedent for this identical tool constraint — what this phase's toolset could not do
(folder move, `npm test`/`typecheck`/`build` re-execution, `git` operations).

## Task Completion Gate

70/70 tasks in `tasks.md` are marked `[x]` (verified by reading the file directly, all four PR
sections). `verify-report.md`'s verdict is **PASS**, 0 CRITICAL, 0 WARNING. The gate passes — nothing
blocks archiving on completeness or on unresolved CRITICAL findings.

---

## Merge Summary

| Spec | Action | Requirements added | Requirements modified | Placement |
|---|---|---|---|---|
| `openspec/specs/configuration/spec.md` | Merged | 4 | 0 | Inserted as the first four requirements, before "Optional `convention` Configuration Block" — `docsDir` is the more foundational config surface ("where do documents live") that `convention`/`frontmatterFields`/`sync`/`chunk` all sit downstream of |
| `openspec/specs/indexing/spec.md` | Merged | 3 | 2 | "Root-Alias-Prefixed Document `path`, Always" inserted directly before "Field Inference in `loose` Mode" (which now references alias-stripping). "Removing a Declared Root Purges Its Indexed Documents on the Next Sync Pass" inserted directly after "Read Failures Protect…" — the design's own explicit contrast pair (unreadable root ≠ removed root). "The Retrieval Evaluation Corpus Stays Addressable After a Path-Shape Change" appended at the end, beside "English Contract Preserves the `ejemplos/`…" (both concern the goldenset) |
| `openspec/specs/index-md/spec.md` | Merged | 2 | 0 | Appended at the end, after "No Compatibility Ordering Path" |
| `openspec/specs/mcp-contract/spec.md` | Merged | 2 | 0 | "Root-Alias-Prefixed `path` Flows Through…" inserted after "Renamed MCP Tool Signatures…", before "Unknown `path` Suggests…"; "`read_doc` Tolerates Exactly One Extra Leading Path Segment" inserted directly after "Unknown `path` Suggests…", before the excerpt-budget requirement group |

### Requirements After Merge (counted directly against the merged files, not assumed)

| Domain | Previous | Added | Modified (in place) | Total |
|---|---|---|---|---|
| configuration | 6 | 4 | 0 | **10** |
| indexing | 26 | 3 | 2 | **29** |
| index-md | 5 | 2 | 0 | **7** |
| mcp-contract | 16 | 2 | 0 | **18** |

Every requirement's text was copied **verbatim** from the delta specs (proposal.md's own "Required
spec action" and design.md's per-requirement guidance were cross-checked against the delta files
before merging, not re-derived).

---

### Destructive Delta Merges (Per `openspec/config.yaml` `rules.archive`: "Warn before merging destructive deltas")

Two MODIFIED requirements in the `indexing` delta replace existing normative text in place. Both are
declared in `proposal.md` as intentional and required by the change (not incidental churn), and both
carry `(Previously: …)` notes per this project's established convention. No `REMOVED Requirements`
section exists in any of the four delta files — nothing was deleted outright, only replaced in place.

**1. "Read Failures Protect the Affected `path` Subtree From Deletion"** — this is the proposal's own
named **"Required spec action"** (a normative MUST amendment, not optional). The live requirement's old
text —

> "A failure to read the ROOT docs directory MUST still throw, unchanged — an unreadable docs root is
> a configuration error, not a transient per-subtree hiccup."

— and its single scenario "Unreadable docs root still throws" were **replaced** with the per-root
policy: a failure to read one declared root's directory MUST NOT throw by itself (reported instead,
keyed by the root's alias, run continues on the remaining roots); the run throws only when **every**
declared root fails. Four scenarios replace the old one: "One of several declared roots is unreadable
— reported, run continues"; "The sole declared root failing is 'every root failing' and still throws"
(the N=1 degeneracy case, preserving the pre-existing always-throws behaviour for a single-root
project); "Every declared root fails to read"; and "A failed root's `ReadError.path` is its alias,
protecting its subtree from deletion" (the silent-data-loss guard — design Decision 4). Verified against
the live merged file: exactly one version of this requirement now exists, no contradicting duplicate.

**2. "Field Inference in `loose` Mode"** — the `module` inference table row and every scenario using
the pre-array-only `docsDir: "docs"` string-literal form were **replaced**. The old row read `First
path segment under docsDir | Absent for root-level files`; the new row reads `First path segment within
the document's containing root (alias prefix always stripped first) | Absent for a file at its root's
top level`. Five of the requirement's six scenarios were rewritten to the array/prefixed form (`docsDir`
defaults to `["docs"]`, `path` is `docs/auth/login.md`, etc.) and one new scenario ("`module` on a
deeper, second-root document") was added. Verified against the live merged file: exactly one version of
this requirement now exists, no contradicting duplicate, and no stray `docsDir: "docs"` string-literal
scenario remains anywhere in `indexing/spec.md`.

**One additional, non-delta consistency fix, disclosed for transparency.** `configuration/spec.md`'s
pre-existing "Optional `convention` Configuration Block" requirement (untouched by any of this change's
four delta files) carries a `docsDir`-only config example scenario that predates this change:

> `GIVEN a compendio.config.json containing only { "docsDir": "documentation" }`

Left as-is, this would directly contradict the newly merged "`docsDir` Is a Non-Empty Array of Declared
Roots" requirement two paragraphs above it — a single-string example next to a spec that says the
single-string form no longer exists. Corrected to `{ "docsDir": ["documentation"] }` (address-only, no
other wording changed) as part of the internal-consistency pass this task explicitly required. This is
not a delta-authored change and is called out separately from the two MODIFIED requirements above.

No other stale `docsDir: "..."` string-literal references were found anywhere in `openspec/specs/`
after the merge (checked by reading all four merged files in full).

---

## Spanish Contract Vocabulary Check

Per `rules.archive`: confirm `openspec/specs/` carries no residual Spanish contract vocabulary (`ruta`,
`tipo`, `modulo`, `estado`, `etiquetas`, `seccion`, `omitidos`, `indexados`, `avisoEmbeddings`,
`convencion`, `estadosExcluidos`, `camposFrontmatter`) except where it quotes the `ejemplos/` corpus.

**What was run**: no grep/shell tool is available in this phase's toolset (Read, Edit, Write, Glob
only, matching the identical constraint recorded in `openspec/changes/archive/2026-08-07-addressable-chunks/archive-report.md`).
The check was performed by reading all six files under `openspec/specs/**/*.md` in full —
`configuration`, `indexing`, `index-md`, `mcp-contract`, `search`, `index-progress` — and scanning each
for the eleven restricted terms.

**Result**: zero occurrences of the restricted terms introduced by this change's merge anywhere in
`openspec/specs/`. One pre-existing location contains several of the literal restricted words, and it
is named explicitly rather than silently passed over:

`mcp-contract/spec.md`'s "Renamed MCP Tool Signatures And Response Field Names" requirement (predates
this change — from the `english-contract` cycle, 2026-07-28; not touched by this merge, confirmed by
inspecting the merged file — the two new requirements this merge added sit two requirements away from
it) states: *"No retired Spanish param or field name (`tipo`, `modulo`, `etiquetas`, `ruta`, `seccion`,
`incluir_no_vigentes`, `omitidos`, `indexados`, `avisoEmbeddings`) MUST remain reachable through any
tool call or response."* Its "Retired Spanish param names are not recognized" scenario repeats
`tipo`/`modulo`/`etiquetas`/`incluir_no_vigentes`. This is documentation of **forbidden** vocabulary in
service of the English-contract requirement — a negative list — never a live param or field name. It
does not fit the `ejemplos/`-quoting exception literally (it is not quoting the `ejemplos/` corpus), but
it is the same distinguishable case the `addressable-chunks` archive report already made for the same
location: intent (forbidding vs. using) is what matters, not literal string presence. Recorded here
rather than reported as a bare "not found," so the distinction is visible rather than assumed, exactly
as this task's instructions required.

Every other spec file — `configuration`, `indexing`, `index-md`, `search`, `index-progress` — scanned
clean: zero occurrences of any restricted term, active or quoted, anywhere.

---

## Artifact Verification (present in the still-active change folder — not yet moved, see Scope Note)

- `openspec/changes/multiple-doc-roots/exploration.md` — present
- `openspec/changes/multiple-doc-roots/proposal.md` — present, read in full (includes the 2026-08-07
  revision note superseding the union-based `docsDir` design in favour of array-only)
- `openspec/changes/multiple-doc-roots/specs/configuration/spec.md` — present, 4 ADDED requirements,
  merged
- `openspec/changes/multiple-doc-roots/specs/indexing/spec.md` — present, 3 ADDED + 2 MODIFIED
  requirements, merged
- `openspec/changes/multiple-doc-roots/specs/index-md/spec.md` — present, 2 ADDED requirements, merged
- `openspec/changes/multiple-doc-roots/specs/mcp-contract/spec.md` — present, 2 ADDED requirements,
  merged
- `openspec/changes/multiple-doc-roots/design.md` — present, read in full (971 lines; the 2026-08-07
  revision note superseding the union-based design)
- `openspec/changes/multiple-doc-roots/tasks.md` — present, **70/70 tasks marked `[x]`** across all
  four PR sections (verified by reading the file directly; Task Completion Gate passes)
- `openspec/changes/multiple-doc-roots/apply-progress.md` — present (Batch 1/PR 1 read in full; Batches
  2-4 cross-checked via `verify-report.md`'s own independent re-derivation of every claim, per its
  stated methodology of not trusting apply's report on trust)
- `openspec/changes/multiple-doc-roots/verify-report.md` — present, verdict **PASS**, **0 CRITICAL**,
  **0 WARNING** (all three warnings carried over from an earlier partial verification pass confirmed
  closed), 2 low-priority SUGGESTIONs (archive is not blocked; CRITICAL issues would have blocked it,
  per `sdd-archive`'s non-negotiable rule — none exist)

---

## Measurements Carried Forward From Verification (not re-run by this phase — see Scope Note)

| Metric | Value | Source |
|---|---|---|
| `npm test` | **648/648** passed, 43 test files, 7.06s | `verify-report.md`, re-run independently there on 2026-08-08 (same day) |
| `npm run typecheck` | clean (`tsc --noEmit && tsc -p tsconfig.test.json`, no output, exit 0) | `verify-report.md` |
| `npm run build` | clean (`tsc`, no output, exit 0) | `verify-report.md` |
| Gate 7 (nothing else moved) | `sync-index.ts`, `sqlite-index-store.ts` (`SCHEMA_DDL`), `read-document.ts`, `ports.ts` all zero-diff vs `main`; zero `string \| string[]` in `src/` | `verify-report.md`, diffed directly against `main` |
| Gate 1 (goldenset identity, `ejemplos/`) | hybrid recall@5 = 1.00, MRR = 0.943 — identity with the documented pre-change baseline | `verify-report.md` |
| Gate 2 (motivating case, this repo) | formula-computed `indexed` count matched exactly (18 = 18); zero indexed paths under `openspec/changes/archive/` | `verify-report.md` |
| Gate 4b (silent-data-loss guard) | independently re-falsified in the verify pass by breaking `root.prefix` → `root.declared` and confirming exactly the two expected tests fail | `verify-report.md` |

This phase did not re-execute `npm test`/`npm run typecheck`/`npm run build` itself (no shell tool
available — see Scope Note). The merge performed by this phase touched **only** four
`openspec/specs/**/*.md` files — zero `src/` files, zero `test/` files — so there is no code-level
mechanism by which it could change any of the above results. That is a structural argument, not a
substitute for actually running the commands; a shell-capable follow-up step must still run them before
the cycle is considered fully closed, per this task's own instructions.

---

## Scope Note: Folder Move, Build Re-Verification, and Git Commit Not Performed by This Phase

This phase's available toolset is **Read, Edit, Write, Glob only** — no Bash/shell, no file-delete, no
file-move/rename, no git capability of any kind. This is the identical constraint already recorded for
this project's `sdd-archive` phase at
`openspec/changes/archive/2026-08-07-addressable-chunks/archive-report.md`'s own "Scope Note: Folder
Move Left to the Orchestrator" section, and it is the exact failure mode described in
`openspec/changes/archive/2026-08-06-match-centred-excerpt/archive-report.md`'s "Incident during this
archive phase, recorded not smoothed" section — a prior archive phase claimed a folder move, a `git
commit`, and a completed cycle that had not actually happened, and the orchestrator only caught it by
listing the archive folder directly rather than accepting the completion claim. This report is written
to avoid repeating that pattern: **nothing below is claimed to have happened that did not happen.**

**Performed by this phase:**
1. Merged the four delta specs into the main specs (`openspec/specs/{configuration,indexing,index-md,mcp-contract}/spec.md`)
   — real, verified by reading each merged file back in full after editing.
2. Ran the Spanish-vocabulary scan and the destructive-merge identification above — real, by direct
   reading of all six spec files (not by tool-assisted grep, since none is available).
3. Fixed one pre-existing internal-consistency gap in `configuration/spec.md` exposed by the merge
   (the `docsDir`-only example scenario), disclosed above.
4. Wrote this report **inside the still-active working folder**
   (`openspec/changes/multiple-doc-roots/archive-report.md`) — not inside an archive folder, because
   that folder does not yet exist and this phase cannot create it via a move/rename.

**NOT performed, and not claimed to have been performed:**
- **Moving** `openspec/changes/multiple-doc-roots/` to
  `openspec/changes/archive/2026-08-08-multiple-doc-roots/` — requires a filesystem move/rename
  capability this phase's toolset does not have. The change folder remains at its original,
  pre-archive path.
- **Re-running** `npm test` / `npm run typecheck` / `npm run build` — requires shell execution this
  phase's toolset does not have. See "Measurements Carried Forward" above for what is known from the
  same-day `verify-report.md` run, and why the structural argument (docs-only diff) does not substitute
  for actually re-running them.
- **`git add` / `git commit` / `git status`** — requires shell/git execution this phase's toolset does
  not have. No commit was made; the working tree's git state is unchanged by this phase beyond the file
  edits themselves (four spec files modified, one new file written).

**A follow-up step with shell/git access must, in order:**
1. `git mv openspec/changes/multiple-doc-roots openspec/changes/archive/2026-08-08-multiple-doc-roots`
   (carries this report and every artifact with it in one atomic move).
2. `npm test && npm run typecheck && npm run build` — confirm the merge introduced no regression
   (expected: 648/648, clean, clean, since only markdown moved).
3. `git add -A && git commit -m "docs(sdd): archive multiple-doc-roots"` (no `Co-Authored-By` trailer,
   per this repository's standing rule) — commit locally only, do not push.
4. `git status` — confirm clean.

---

## Cycle Status

- Proposed, specified, designed, tasked, implemented, and verified — all prior phases complete, per
  the artifacts read above.
- Delta specs merged into main specs — source of truth updated
  (`openspec/specs/configuration/spec.md`, `openspec/specs/indexing/spec.md`,
  `openspec/specs/index-md/spec.md`, `openspec/specs/mcp-contract/spec.md`).
- Spanish-vocabulary check run and reported above — clean, with the one pre-existing negative-list
  exception named explicitly.
- Destructive merges identified and described above (2 MODIFIED requirements, both intentional and
  required by the change; 1 additional non-delta consistency fix, disclosed).
- **Folder move, build re-verification, and `git` commit pending — require a shell/git-capable
  follow-up. Not performed by this phase, and not claimed to have been performed.**
