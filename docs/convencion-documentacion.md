---
tipo: guia
modulo: transversal
estado: borrador
propietario: ARQ
etiquetas: [documentacion, convencion, ia, busqueda]
actualizado: 2026-07-20
---

# Project documentation convention

This convention defines how we write and organize the project's documentation so it is easy to find both for people and for the harness's AI agents (OpenCode), spending the fewest tokens possible. All documentation lives in the repository, under `docs/`, and evolves alongside the code.

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
├── glosario.md       # Canonical project terms
├── funcional/        # Functional specifications         → written by BA
├── adr/              # Architecture decisions             → written by ARQ
├── api/              # Contracts, endpoints, models        → written by DEV
├── qa/               # Test plans and cases                → written by QA
└── guias/            # Operational and cross-cutting guides → anyone
```

- The first level is organized **by document type**, and each type has a natural owner role (the same roles the harness uses: BA, ARQ, DEV, QA). Owner does not mean sole author: it means the person responsible for keeping that folder up to date.
- The **module** a document belongs to is stated in the frontmatter and in the file name, not with subfolders. We avoid deep trees: two levels at most.

## 3. File names

- `kebab-case`, lowercase, no accents or ñ: `leadsviewer-validacion-formulario.md`.
- General pattern: `<modulo>-<tema>.md`.
- Numbered ADRs: `adr-0007-eleccion-base-datos.md`. The number is sequential and never reused, even if the ADR becomes obsolete.
- If a file exceeds ~400 lines, it is probably two topics: it is split.

## 4. Required frontmatter

Every document begins with a YAML block. It is the document's data contract: it lets you filter by type, module or state —for example, with a grep over the frontmatter— without spending a single token reading content.

```yaml
---
tipo: funcional            # required: funcional | adr | api | qa | guia
modulo: leadsviewer        # required: must exist in glosario.md
estado: vigente            # required: borrador | vigente | obsoleto
propietario: BA            # recommended: BA | ARQ | DEV | QA
etiquetas: [lead, validacion, formulario, rgpd]  # recommended: 3-6, lowercase and singular
actualizado: 2026-07-20    # recommended: YYYY-MM-DD
sustituido-por:            # only if estado: obsoleto (path to the doc that replaces it)
---
```

Rules:

- `tipo`, `estado` and `propietario` only accept the values in the list. We do not invent new values without updating this convention.
- `modulo` must be registered in `glosario.md`. If the module is new, it is added to the glossary first.
- `etiquetas` complement the module, they do not repeat it.

## 5. Internal document structure

1. **A single H1 title**, equal or nearly equal to the file name.
2. **The first paragraph is a 2-3 line summary**: what this document is and when to consult it. By reading it, a person or an agent decides whether they are in the right document without opening it whole, so it has to stand on its own.
3. **Descriptive and stable H2/H3 headings.** Agents locate content by headings and read only the section they need ("give me *Validation rules* from that document"). No generic headings ("Other topics", "More information") and sections are not renamed without reason.
4. **Self-contained sections.** Each H2 must be understandable without reading the rest of the document, because the agent may receive only that section. Avoid "as explained above"; instead, link: "see [Lead validation](leadsviewer-validacion-formulario.md#validación-de-leads)". Note: GitHub anchors keep the accents of the heading.
5. **Structured data in tables**, steps in numbered lists, code in fenced blocks with the language specified.
6. **Link, do not duplicate.** If something is already documented, link to it with a relative path. Duplicated information always drifts out of sync.

## 6. Writing

- **Language: Spanish** across all documentation. Mixing languages hurts both lexical and semantic search. Established English technical terms (endpoint, commit, pipeline) are valid.
- **Consistent terminology.** Each entity, module or concept has a single name, registered in `glosario.md`. If the same thing is called "cliente", "customer" and "cuenta" depending on the document, neither people nor agents will find it well.
- Short sentences, active voice, no filler.
- **Absolute dates** (2026-07-20), never relative ones ("last month", "recently").

## 7. Lifecycle

`borrador → vigente → obsoleto`

- **borrador** (draft): being written or pending review. Not a source of truth: agents must ignore it unless explicitly requested.
- **vigente** (current): source of truth. This is what the agent will use as context.
- **obsoleto** (obsolete): no longer applies, but is not deleted. It is marked, `sustituido-por` is filled in, and it stops being maintained.

## 8. INDEX.md

Index of all documentation: one line per document, in this format:

```
- [funcional] funcional/leadsviewer-validacion-formulario.md — Reglas de validación del formulario de Leads (vigente)
- [adr] adr/adr-0007-eleccion-base-datos.md — Por qué PostgreSQL frente a MongoDB (vigente)
```

By reading only this file, a person or an agent gets oriented across all the documentation. It is updated by hand, in the same PR that adds or changes a document.

## 9. Glossary

`docs/glosario.md` contains the canonical project terms: modules, business entities and acronyms, each with a one-line definition. Before naming something new in a document, check whether it already has a name. The glossary is the source of truth for the frontmatter `modulo` field.

## 10. Checklist for PRs with documentation

- [ ] Complete frontmatter with valid values
- [ ] The first paragraph summarizes the document and stands on its own
- [ ] Descriptive headings; self-contained sections
- [ ] Terminology per `glosario.md` (new modules registered)
- [ ] `INDEX.md` updated
- [ ] If the change affects documented behavior, the document is updated (or its owner is notified)

## 11. Templates

### Functional specification (`docs/funcional/`)

```markdown
---
tipo: funcional
modulo: <modulo>
estado: borrador
propietario: BA
etiquetas: []
actualizado: AAAA-MM-DD
---

# <Nombre de la funcionalidad>

<Resumen de 2-3 líneas: qué hace, para quién y cuándo consultar este documento.>

## Contexto y objetivo
## Reglas de negocio
## Casos de uso
## Fuera de alcance
## Referencias
```

### Architecture decision (`docs/adr/`)

```markdown
---
tipo: adr
modulo: <modulo o transversal>
estado: vigente
propietario: ARQ
etiquetas: []
actualizado: AAAA-MM-DD
---

# ADR-NNNN: <Decisión en una frase>

<Resumen: qué se decidió y la razón principal.>

## Contexto
## Decisión
## Alternativas consideradas
## Consecuencias
```

### API contract (`docs/api/`)

```markdown
---
tipo: api
modulo: <modulo>
estado: borrador
propietario: DEV
etiquetas: []
actualizado: AAAA-MM-DD
---

# API <módulo>: <recurso>

<Resumen: qué expone esta API y quién la consume.>

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|

## Modelos de datos
## Errores
## Ejemplos
```

### Test plan (`docs/qa/`)

```markdown
---
tipo: qa
modulo: <modulo>
estado: borrador
propietario: QA
etiquetas: []
actualizado: AAAA-MM-DD
---

# Plan de pruebas: <funcionalidad>

<Resumen: qué se prueba y con qué criterio de salida.>

## Alcance

## Casos de prueba

| ID | Descripción | Pasos | Resultado esperado |
|----|-------------|-------|--------------------|

## Datos de prueba
## Criterios de salida
```

## Appendix: technical rationale (why these rules)

Each rule of this convention either reduces the tokens an agent spends consulting the documentation, or improves the precision with which it finds what it is looking for:

| Rule | Effect when consulting the documentation |
|-------|--------------------------------------|
| Frontmatter with tipo/modulo/estado | Filtering by metadata (for example, with grep) discards most of the corpus at zero cost |
| First paragraph = summary | A few lines are enough to decide whether the document is the right one, without reading it whole |
| Stable, descriptive headings | Selective reading: the agent jumps to the section it needs, it does not load the whole file |
| Self-contained sections | A section read on its own is understandable by itself, without dragging in extra context |
| Glossary and single terminology | Keyword search works; accidental synonyms break it |
| INDEX.md | Orientation across the whole corpus for a few hundred tokens, before any search |
| Lifecycle states | Drafts and obsolete docs do not pollute the agent's context |
| Consistent Spanish | Searching in Spanish finds what was written in Spanish; mixing languages breaks search |
