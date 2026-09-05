# Verify Report: Anchor Supporting Excerpts on the Match

Recorded as apply proceeds, per tasks.md's instruction that Gate A/B/G2 evidence cannot be produced
after the fact.

## Phase 1 — Probe script, Gate B, Gate A baseline

Build: `npm run build` — clean, no errors.

Index (hybrid, once, reused through Phase 5):

```
node dist/cli.js --root ejemplos index
...
Indexed 11 documents (29 chunks) in 4250 ms [mode hybrid]
```

### Gate B — vacuity guard, verified failing (task 1.8)

```
node scripts/supporting-anchor-probe.mjs ejemplos --query "qwertzuiop plughxyzzy frobnicate" --query "blorptastic wibblefrotz"

Queries: 2
C7 (ambiguous chunk resolution): 0
C2 (flattened-text anti-vacuity denominator): 0
C1 (zero query terms visible, of C2): 0 (n/a)
C3 (both-ellipsis, of C2): 0 (n/a)
C4 (mean distinct terms visible, of C2): NaN
C5 (hard mid-word edge, of C2): 0 (n/a)
C5 impossible (idx === -1, of C2): 0
C6 (excluded from C2 — term in raw content only): 0
Digest (8 tuples) written to ...\ejemplos\.compendio\gate-a.digest

GATE IS VACUOUS
EXIT: 1
```

Required: exit 1, `GATE IS VACUOUS`, C2 = 0. **Matches.**

### Gate A — baseline on unmodified code (task 1.9)

```
node scripts/supporting-anchor-probe.mjs ejemplos --digest ejemplos/.compendio/gate-a-before.digest

Queries: 22
C7 (ambiguous chunk resolution): 0
C2 (flattened-text anti-vacuity denominator): 88
C1 (zero query terms visible, of C2): 8 (9.1%)
C3 (both-ellipsis, of C2): 0 (0.0%)
C4 (mean distinct terms visible, of C2): 2.40
C5 (hard mid-word edge, of C2): 0 (0.0%)
C5 impossible (idx === -1, of C2): 0
C6 (excluded from C2 — term in raw content only): 0
Digest (88 tuples) written to ...\ejemplos\.compendio\gate-a-before.digest

THE FIX DID NOT LAND
EXIT: 1
```

Required: C2 = 88, C1 = 8 (9.1%), C3 = 0, C4 = 2.40, C5 = 0, C6 = 0, C7 = 0, exit 1,
`THE FIX DID NOT LAND`. **Exact match to design's predicted table.** Digest saved as
`gate-a-before.digest` for the Phase 5.3 population-identity comparison.
