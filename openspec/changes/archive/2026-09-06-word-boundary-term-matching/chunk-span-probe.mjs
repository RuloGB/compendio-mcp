/**
 * One-off measurement for exploration §4 of `rarity-weighted-match-centre`.
 *
 * Answers the two questions the exploration declared blocking:
 *   M1 — the real (term, in-chunk frequency, offsets) multiset of the
 *        motivating chunks, so the candidate formulas can be traced against
 *        the actual numbers instead of assumed ones.
 *   M2 — whether `billing-rules.md § 9. Refunds` contains refund-timing
 *        content at all.
 *
 * Imports compiled `dist/` only; no production surface widened.
 *
 * Usage: node chunk-span-probe.mjs <root> <docPath> "<query>"
 */
import { resolve } from "node:path";
import { SqliteIndexStore } from "file:///C:/Users/Raul/Workspace/compendio-mcp/dist/infrastructure/sqlite/sqlite-index-store.js";
import {
  locateSpans,
  selectMatchCentre,
  tokenizeQuery,
} from "file:///C:/Users/Raul/Workspace/compendio-mcp/dist/domain/match-location.js";
import {
  buildExcerpt,
  LEAD_EXCERPT_CHARS,
  SUPPORTING_EXCERPT_CHARS,
} from "file:///C:/Users/Raul/Workspace/compendio-mcp/dist/domain/excerpt.js";

const [, , rootArg, docArg, queryArg] = process.argv;
const store = new SqliteIndexStore(resolve(rootArg, ".compendio/compendio.db"));

console.log(`vectors present in this database: ${store.hasVectors()}`);

const doc = store.getDocumentByPath(docArg);
if (doc === null) {
  console.error(`document not indexed: ${docArg}`);
  process.exit(2);
}
const chunks = store.getChunksByDocument(doc.id);
console.log(`document: ${docArg}  (${chunks.length} chunks)\n`);

const terms = tokenizeQuery(queryArg);
console.log(`query: ${queryArg}`);
console.log(`tokenizeQuery -> [${terms.join(", ")}]\n`);

for (const chunk of chunks) {
  const spans = locateSpans(chunk.content, terms);
  const f = new Map();
  for (const s of spans) f.set(s.term, (f.get(s.term) ?? 0) + 1);
  const L = spans.length;

  console.log("=".repeat(78));
  console.log(`chunk #${chunk.position}  heading: ${JSON.stringify(chunk.heading)}`);
  console.log(`content length: ${chunk.content.length}  |  total term occurrences L = ${L}`);
  if (L === 0) {
    console.log("(no query terms in this chunk)\n");
    continue;
  }
  console.log("term          f    w = log(1+L/f)   offsets");
  for (const [term, count] of [...f.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))) {
    const w = Math.log(1 + L / count);
    const offsets = spans.filter((s) => s.term === term).map((s) => s.start);
    console.log(
      `${term.padEnd(13)} ${String(count).padEnd(4)} ${w.toFixed(4).padEnd(16)} ${offsets.join(", ")}`,
    );
  }
  for (const budget of [SUPPORTING_EXCERPT_CHARS, LEAD_EXCERPT_CHARS]) {
    const centre = selectMatchCentre(spans, budget);
    console.log(`  budget ${budget}: selectMatchCentre -> ${centre}`);
    console.log(`  excerpt: ${JSON.stringify(buildExcerpt(chunk.content, budget, spans))}`);
  }
  console.log();
}
