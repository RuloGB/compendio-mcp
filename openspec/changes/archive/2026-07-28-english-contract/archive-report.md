# Archive Report: English Contract

Archived 2026-07-28. Implementation branch `refactor/english-contract` (merged to `main`); closure
branch `chore/close-english-contract`.

## Why this change stayed open so long

The 11-commit implementation landed and merged, but § Final Verification was never run and commits
6–12 were left unchecked in `tasks.md`. The change looked done and was not. Two items marked complete
were in fact incomplete (the strict fixture's Spanish filenames, and a `README` line documenting a
`--lexico` flag that no longer existed), and four Spanish runtime strings survived in production
source — one of them leaking into `embeddingsWarning`, an English field of the MCP contract. The
sweeps existed precisely to catch this class, and skipping them is what let it through.

## Delta specs merged

The MODIFIED requirements were already reflected in `openspec/specs/` from the closure pass's
vocabulary work. Three ADDED requirements were genuinely absent and were merged verbatim:

| Spec | Requirement |
|---|---|
| `indexing` | English Contract Preserves the `ejemplos/` Multilingual Retrieval Baseline |
| `mcp-contract` | Renamed MCP Tool Signatures And Response Field Names |
| `mcp-contract` | Unknown `path` Suggests the 3 Closest Matches |

**No destructive merge occurred.** A naive whole-file overwrite of the main specs with the deltas was
rejected after inspection: the deltas are ADDED/MODIFIED sections, not full replacements, and
`openspec/specs/indexing/spec.md` carries requirements the delta never lists — notably "Concurrent
Readers During `compendio index` Are Out of Scope", which a blind overwrite would have deleted.

## Final verification

| Gate | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm test` | Pass — 25 files, 247 tests |
| `npm run build` | Pass |
| Sweep A | 43 hits, all enumerated in `design.md` § "Allow-list — final" |
| Sweep B (post-merge) | 29 hits, 9 of them in `openspec/specs/` — all justified below |
| Eval baseline V0–V4 | Reproduced exactly: hybrid, 11 docs / 27 chunks, hybrid recall@5 1.00 / MRR 0.943 / 0 failures, lexical 0.95 / 0.857 / 1 failure at position 9 |

## Archive-rule exceptions, recorded deliberately

`openspec/config.yaml`'s archive rule allows residual Spanish in `openspec/specs/` only "where it
quotes the `ejemplos/` corpus". Nine hits remain; four meet that wording literally, five do not and
are accepted here with reasons:

- `indexing/spec.md:321,323,327,334` — quote the `ejemplos/` corpus. Covered by the rule as written.
- `mcp-contract/spec.md:109,120` — **negative requirements**. They name the retired params (`tipo`,
  `modulo`, `etiquetas`, `ruta`, `seccion`, `incluir_no_vigentes`, `omitidos`, `indexados`,
  `avisoEmbeddings`) in order to require that they are *not* reachable. A requirement forbidding a name
  cannot be written without the name.
- `configuration/spec.md:65,71,73` — the worked example of `convention.frontmatterFields` mapping
  `{ "type": "tipo" }`. The Spanish is example data demonstrating the remap; writing it as
  `{ "type": "type" }` would be an identity mapping that demonstrates nothing.

## Contract amendment carried into the archive

`design.md`'s Sweep A acceptance criterion gained a fourth bucket during closure: correct English
identifiers containing a Spanish root as a substring (`textOf` ⊃ "texto", `documentOf` ⊃ "documento",
`extractor` ⊃ "extracto", idiomatic "modulo"). These are enumerated in the allow-list, never marked
`es-frozen` — that marker asserts the text was once Spanish, and recording that claim in production
source to satisfy a grep would be false. The criterion "zero unmarked, un-enumerated hits" is met by
enumeration; only the mechanical `| rg -v 'es-frozen'` shortcut does not survive, and it was never the
criterion.

## Not done here

`compendio serve` holding `ejemplos/.compendio` open meant 12.10's literal `rm -rf` could not run; the
baseline was reproduced on an isolated copy of the corpus with no database at all, which is a stricter
starting condition. No push and no pull request — the closure branch is local for review.
