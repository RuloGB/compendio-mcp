---
type: guide
module: transversal
status: draft
owner: ARQ
tags: [documentation, convention, ai, search]
updated: 2026-07-20
---

# Project documentation convention

This convention defines how we write and organize the project's documentation so it is easy to find both for people and for the harness's AI agents (OpenCode), spending the fewest tokens possible. All documentation lives in the repository, under `docs/`, and evolves alongside the code.

**This convention is optional, from Compendio's point of view.** By default (no `compendio.config.json`, or `convention.mode: "loose"`) Compendio indexes any `.md` file with zero frontmatter at all — it infers what it can and never rejects a file for missing metadata. What follows is this project's own choice to declare `type`/`module`/`status`/`tags` on every document, for the filtering and orientation benefits described in section 4 below. A project can additionally ask Compendio to *enforce* this convention as a linter by declaring `convention.mode: "strict"` — see section 4 for exactly what Compendio does and does not validate.

## 1. Principles

1. **One topic per file.** A document answers one question or describes one thing. If it mixes topics, it is split.
2. **We write for two readers.** People and AI agents. What helps one helps the other: clear summaries, well-titled sections, consistent terminology.
3. **Documentation travels with the change.** Whoever changes a documented behavior makes sure the document is updated in the same task: they update it if they own that type of document, or they notify whoever does (usually the BA). What is not acceptable is delivering the change while silently leaving the documentation out of date.
4. **Metadata before content.** Each document declares what it is (frontmatter) so it can be filtered without having to read it.
5. **Nothing is deleted.** Obsolete documents are marked as such and point to their replacement. The history of decisions is valuable.

`docs/` holds product and system documentation. It does not hold meeting minutes, personal notes or to-do items (the team's management tools are for that).

## 2. Folder structure

```
docs/
├── INDEX.md          # Index: one line per document
├── glossary.md       # Canonical project terms
├── functional/        # Functional specifications         → written by BA
├── adr/               # Architecture decisions             → written by ARQ
├── api/                # Contracts, endpoints, models        → written by DEV
├── qa/                 # Test plans and cases                → written by QA
└── guides/             # Operational and cross-cutting guides → anyone
```

- The first level is organized **by document type**, and each type has a natural owner role (the same roles the harness uses: BA, ARQ, DEV, QA). Owner does not mean sole author: it means the person responsible for keeping that folder up to date.
- The **module** a document belongs to is stated in the frontmatter (`module`), not inferred from the folder — because folders here already carry the document *type*. This is a deliberate choice, not the only valid one: Compendio's zero-config `loose` mode can instead infer `module` from the first folder segment when a project organizes folders *by module* (see the bundled `ejemplos/` corpus for that alternative layout). Either way, frontmatter always wins over inference when both are present.

## 3. File names

- `kebab-case`, lowercase, no accents or special characters: `leadsviewer-form-validation.md`.
- General pattern: `<module>-<topic>.md`.
- Numbered ADRs: `adr-0007-database-choice.md`. The number is sequential and never reused, even if the ADR becomes deprecated.
- If a file exceeds ~400 lines, it is probably two topics: it is split.

## 4. Compendio's convention modes: `loose` vs `strict`

Compendio's own metadata handling is driven by `convention.mode` in `compendio.config.json`, independently of how a project chooses to write its documents.

**`loose` (default, zero-config)** — never rejects a file for missing metadata:

| Field | Source | Fallback |
|---|---|---|
| `title` | First H1 | Humanized filename (strip `.md`, `-`/`_` → space, collapse+trim whitespace, sentence-case the first letter — e.g. `getting-started_with-search.md` → `"Getting started with search"`) |
| `summary` | First paragraph after the H1 | — |
| `module` | Mapped frontmatter field (or `module:` by default) | First folder segment under `docsDir`; absent for a file directly under `docsDir` |
| `type` | Mapped frontmatter field (or `type:` by default) | Absent — never invented |
| `status` | Mapped frontmatter field (or `status:` by default) | Absent — never invented |

An empty string or a YAML `null` for `type`/`module`/`status` in frontmatter is treated exactly as if the field were absent (so `module: ""` still falls through to folder inference, and `type: ""`/`status: null` stay absent, not empty strings). Under `loose`, only three things cause a file to be skipped (reported in `skipped`): the file cannot be read, its frontmatter fails to parse, or it yields zero indexable content — never a missing/unknown `type`/`module`/`status`.

**`strict` (opt-in)** — a linter, not an inference engine: no fallback of any kind applies, including the filename-humanization fallback above.

- Every document needs an H1 and a non-empty `type`/`module`/`status`.
- If the project declares `convention.types`/`convention.statuses`, `type`/`status` are each checked against their own declared list, independently of one another (one being declared does not affect the other's rule).
- If a taxonomy isn't declared for `type` or for `status`, that field falls back to presence-only validation (any non-empty value is accepted).
- `module` never has a declared taxonomy in Compendio — it is always presence-only, whatever is or isn't declared for `type`/`status`.
- A document that fails any of the above is skipped and reported in `skipped`, exactly like the three resilience reasons under `loose`.

Reproducing this project's own list (`type`/`status` restricted below, `draft`/`deprecated` hidden from search by default — see section 8) is an explicit opt-in, not the default:

```jsonc
{
  "convention": {
    "mode": "strict",
    "types": ["functional", "adr", "api", "qa", "guide"],
    "statuses": ["draft", "current", "deprecated"],
    "excludedStatuses": ["draft", "deprecated"]
  }
}
```

`convention.frontmatterFields` additionally lets a project remap `type`/`module`/`status` to non-standard YAML keys, e.g. `{ "type": "type" }` reads a document's `type:` field as `type`. A partial mapping merges per key against the identity defaults (`{ "type": "type", "module": "module", "status": "status" }`) — declaring only `type` never wipes the defaults for `module`/`status`. Two of the three fields may map to the same source key; both simply read that key's value, with no collision error. This project uses the identity mapping (the field names shown in section 5 below are the literal YAML keys), so it does not need to declare `frontmatterFields` at all.

## 5. Frontmatter

Every document in this project begins with a YAML block, by team convention — Compendio does not require it in its default `loose` mode (see section 4 above), but we keep it because it lets you filter by type, module or state — for example, with a grep over the frontmatter — without spending a single token reading content:

```yaml
---
type: functional             # this project's list: functional | adr | api | qa | guide
module: leadsviewer          # must exist in glossary.md
status: current               # this project's list: draft | current | deprecated
owner: BA                     # recommended: BA | ARQ | DEV | QA (not validated by Compendio)
tags: [lead, validation, form, gdpr]  # recommended: 3-6, lowercase and singular
updated: 2026-07-20          # recommended: YYYY-MM-DD
replaced-by:                   # only if status: deprecated (path to the doc that replaces it; a plain team convention, not modeled by Compendio)
---
```

Rules:

- `type` and `status` use the values listed above by team convention. Compendio only rejects a value outside that list when the project *also* declares `convention.mode: "strict"` with the matching `convention.types`/`convention.statuses` (see section 4) — without that declaration, Compendio accepts any value, and this list is enforced by review, not tooling.
- `module` must be registered in `glossary.md`. If the module is new, it is added to the glossary first. Compendio itself never validates `module` against a taxonomy (see section 4) — the glossary is this project's own registry.
- `tags` complement the module, they do not repeat it.

## 6. Internal document structure

1. **A single H1 title**, equal or nearly equal to the file name.
2. **The first paragraph is a 2-3 line summary**: what this document is and when to consult it. By reading it, a person or an agent decides whether they are in the right document without opening it whole, so it has to stand on its own.
3. **Descriptive and stable H2/H3 headings.** Agents locate content by headings and read only the section they need ("give me *Validation rules* from that document"). No generic headings ("Other topics", "More information") and sections are not renamed without reason.
4. **Self-contained sections.** Each H2 must be understandable without reading the rest of the document, because the agent may receive only that section. Avoid "as explained above"; instead, link: "see [Lead validation](leadsviewer-form-validation.md#lead-validation)". Note: GitHub anchors are derived from the heading text, including any accented characters it contains.
5. **Structured data in tables**, steps in numbered lists, code in fenced blocks with the language specified.
6. **Link, do not duplicate.** If something is already documented, link to it with a relative path. Duplicated information always drifts out of sync.

## 7. Writing

- **Language: English** across all documentation, matching the project's own contract (see `CLAUDE.md`). Mixing languages hurts both lexical and semantic search. The one deliberate exception is the bundled `ejemplos/` corpus, which stays Spanish as the retrieval regression suite.
- **Consistent terminology.** Each entity, module or concept has a single name, registered in `glossary.md`. If the same thing is called "customer", "client" and "account" depending on the document, neither people nor agents will find it well.
- Short sentences, active voice, no filler.
- **Absolute dates** (2026-07-20), never relative ones ("last month", "recently").

## 8. Lifecycle

`draft → current → deprecated`

- **draft**: being written or pending review. Not a source of truth: it is written here to be excluded from an agent's default search results, by convention.
- **current**: source of truth. This is what the agent will use as context.
- **deprecated**: no longer applies, but is not deleted. It is marked, `replaced-by` is filled in, and it stops being maintained.

**This lifecycle is only enforced by Compendio when a project declares it.** By default, `convention.excludedStatuses` is `[]` — nothing is excluded from search, and `include_excluded` is a no-op. To make `draft`/`deprecated` documents actually hidden from `search_docs` by default (the behavior implied above), a project must explicitly declare `convention.excludedStatuses: ["draft", "deprecated"]`, as shown in section 4's example. This document you're reading is itself marked `status: draft` and, in this repository's own zero-config index (no `compendio.config.json` at the repository root), it is fully searchable — a live example of the default, not-yet-declared behavior.

## 9. INDEX.md

Index of all documentation: one line per document, in this format:

```
- [adr] adr/adr-0007-database-choice.md — Why PostgreSQL over MongoDB (current)
- [functional] functional/leadsviewer-form-validation.md — Lead form validation rules (current)
```

By default (`loose`, or `strict` with no declared `convention.types`), entries are ordered alphabetically by `path`, as in the example above. Under `strict` with a declared `convention.types` list, entries instead follow that declared order, falling back to alphabetical by `path` within each `type` group. A document missing `type` or `status` simply omits the corresponding `[type]`/`(status)` segment from its line — never an empty bracket or `[undefined]`.

By reading only this file, a person or an agent gets oriented across all the documentation. It is kept up to date with `compendio index-md`, which regenerates it from each document's frontmatter and summary; run it in the same PR that adds or changes a document.

## 10. Glossary

`docs/glossary.md` contains the canonical project terms: modules, business entities and acronyms, each with a one-line definition. Before naming something new in a document, check whether it already has a name. The glossary is the source of truth for the frontmatter `module` field.

## 11. Checklist for PRs with documentation

- [ ] Complete frontmatter with valid values
- [ ] The first paragraph summarizes the document and stands on its own
- [ ] Descriptive headings; self-contained sections
- [ ] Terminology per `glossary.md` (new modules registered)
- [ ] `INDEX.md` regenerated (`compendio index-md`)
- [ ] If the change affects documented behavior, the document is updated (or its owner is notified)

## 12. Templates

### Functional specification (`docs/functional/`)

```markdown
---
type: functional
module: <module>
status: draft
owner: BA
tags: []
updated: YYYY-MM-DD
---

# <Feature name>

<2-3 line summary: what it does, for whom and when to consult this document.>

## Context and objective
## Business rules
## Use cases
## Out of scope
## References
```

### Architecture decision (`docs/adr/`)

```markdown
---
type: adr
module: <module or transversal>
status: current
owner: ARQ
tags: []
updated: YYYY-MM-DD
---

# ADR-NNNN: <Decision in one sentence>

<Summary: what was decided and the main reason.>

## Context
## Decision
## Alternatives considered
## Consequences
```

### API contract (`docs/api/`)

```markdown
---
type: api
module: <module>
status: draft
owner: DEV
tags: []
updated: YYYY-MM-DD
---

# API <module>: <resource>

<Summary: what this API exposes and who consumes it.>

## Endpoints

| Method | Route | Description |
|--------|-------|-------------|

## Data models
## Errors
## Examples
```

### Test plan (`docs/qa/`)

```markdown
---
type: qa
module: <module>
status: draft
owner: QA
tags: []
updated: YYYY-MM-DD
---

# Test plan: <feature>

<Summary: what is tested and the exit criteria.>

## Scope

## Test cases

| ID | Description | Steps | Expected result |
|----|--------------|-------|------------------|

## Test data
## Exit criteria
```

## Appendix: technical rationale (why these rules)

Each rule of this convention either reduces the tokens an agent spends consulting the documentation, or improves the precision with which it finds what it is looking for:

| Rule | Effect when consulting the documentation |
|-------|--------------------------------------|
| Frontmatter with type/module/status | Filtering by metadata (for example, with grep, or Compendio's own `type`/`module` filters and `strict` mode) discards most of the corpus at zero cost |
| First paragraph = summary | A few lines are enough to decide whether the document is the right one, without reading it whole |
| Stable, descriptive headings | Selective reading: the agent jumps to the section it needs, it does not load the whole file |
| Self-contained sections | A section read on its own is understandable by itself, without dragging in extra context |
| Glossary and single terminology | Keyword search works; accidental synonyms break it |
| INDEX.md | Orientation across the whole corpus for a few hundred tokens, before any search |
| Lifecycle states (with `convention.excludedStatuses` declared) | Drafts and deprecated docs do not pollute the agent's context |
| Consistent English | Searching in English finds what was written in English; mixing languages breaks search |
