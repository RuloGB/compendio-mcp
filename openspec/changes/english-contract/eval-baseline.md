# Eval Baseline — captured before the first rename commit

Captured on branch `refactor/english-contract` with the working tree still functionally identical to
`main` (only `openspec/` artifacts and `openspec/config.yaml` differed; no source file had been
touched). This is the falsifiability anchor for the change's behavior-preservation guarantee: after
the rename, these numbers must match **exactly**.

## How it was produced

```bash
npm run dev -- --root ejemplos index
npm run dev -- --root ejemplos eval
```

Index run reported: `Indexados 11 documentos (27 chunks) en 4408 ms [modo hibrido]` — hybrid mode
confirmed, so the embeddings path was exercised, not the lexical-only degraded path.

## Baseline

Goldenset: 22 questions, k = 5.

| mode | recall@5 | MRR | failures |
|---|---|---|---|
| `hibrido` | **1.00** | **0.943** | **0** |
| `lexico` | **0.95** | **0.857** | **1** |

Known lexical-mode failure (expected, part of the baseline — not a defect to fix in this change):

- `"¿Qué endpoint hay que llamar para crear un lead?"` → `leadsviewer/alta-leads.md` at position 9.

## Post-rename acceptance criterion

Re-run the same two commands against the renamed tree. Every cell in the table above must be
identical, and the lexical failure must remain that same single case at that same position. Any
movement means the rename changed behavior and is a defect, not a new baseline.

Note that the index run's own output line will legitimately change wording (`Indexados …` becomes its
English equivalent, `modo hibrido` becomes `mode hybrid`). Only the metrics are frozen, not the
strings that report them.

## Why these numbers cannot move in principle

Three structural facts, each verified against code rather than assumed:

1. `RemarkMarkdownParser` calls `matter(raw)` and destructures `{ data, content }`
   (`src/infrastructure/markdown/remark-markdown-parser.ts:26`) — only `content` is chunked and
   embedded, so frontmatter keys never reach the index.
2. `chunks_fts` uses `tokenize='unicode61 remove_diacritics 2'`
   (`src/infrastructure/sqlite/sqlite-index-store.ts:67`) — stemmer-free, hence language-neutral.
3. `EvaluateSearch.execute` passes only `{ query, k, forzarLexico }` with zero metadata filters
   (`src/application/evaluate-search.ts:43-47`) — the goldenset never exercises `type`/`module`/
   `tags`/`status` filtering.

Together these make behavior preservation structural. The eval re-run is therefore a check on the
reasoning, not the reasoning itself — if it moves, one of the three facts above was violated by the
implementation.
