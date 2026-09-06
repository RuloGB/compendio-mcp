/**
 * Cost measurement for the strict-token-matching candidate.
 * Over the REAL pipeline's returned fragments (createContainer, hybrid, default k):
 *   S0 — fragments whose (path, section) does not resolve to exactly one chunk (excluded)
 *   S1 — fragments with >=1 span today
 *   S2 — of S1, fragments that would have ZERO spans under word-boundary matching
 *        (i.e. lose match-centring and fall back to a start-anchored prefix)
 *   S3 — span attrition: total spans today vs total spans kept
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContainer } from "file:///C:/Users/Raul/Workspace/compendio-mcp/dist/composition.js";
import { locateSpans, tokenizeQuery } from "file:///C:/Users/Raul/Workspace/compendio-mcp/dist/domain/match-location.js";

const args = process.argv.slice(2);
const root = args[0];
const queries = [];
for (let i = 1; i < args.length; i++) if (args[i] === "--query") queries.push(args[++i]);
if (queries.length === 0) {
  const yaml = readFileSync(resolve(root, "goldenset.yaml"), "utf8");
  for (const line of yaml.split(/\r?\n/)) {
    const m = /^\s*-?\s*pregunta:\s*"?(.+?)"?\s*$/.exec(line);
    if (m) queries.push(m[1]);
  }
}

const isWordChar = (c) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
const strict = (content, spans) =>
  spans.filter((s) => !isWordChar(content[s.start - 1]) && !isWordChar(content[s.end]));

let ambiguous = 0;
const container = createContainer({ root: resolve(root) });
let s0 = 0, s1 = 0, s2 = 0, spansNow = 0, spansKept = 0, frags = 0;
const losers = [];
for (const q of queries) {
  const res = await container.searchDocuments.execute({ query: q });
  const terms = tokenizeQuery(q);
  for (const r of res.results) {
    frags++;
    const doc = container.store.getDocumentByPath(r.path);
    const cands = doc === null ? [] : container.store.getChunksByDocument(doc.id).filter((c) => c.heading === r.section);
    if (cands.length === 0) { s0++; continue; }
    if (cands.length > 1) ambiguous++;
    // Ambiguous (path, section): measure EVERY candidate, and count the fragment
    // as losing all spans only if every candidate does — never silently excluded.
    const per = cands.map((c) => ({ c, spans: locateSpans(c.content, terms) })).filter((x) => x.spans.length > 0);
    if (per.length === 0) continue;
    const spans = per[0].spans;
    const allLose = per.every((x) => strict(x.c.content, x.spans).length === 0);
    if (spans.length === 0) continue;
    s1++;
    const kept = strict(per[0].c.content, spans);
    spansNow += spans.length;
    spansKept += kept.length;
    if (allLose) { s2++; losers.push(`${q} | ${r.path} §${r.section}`); }
  }
}
console.log(`root: ${root}   queries: ${queries.length}   fragments: ${frags}`);
console.log(`S0 path not indexed            : ${s0}`);
console.log(`   ambiguous (path,section), measured across ALL candidates: ${ambiguous}`);
console.log(`S1 fragments with >=1 span     : ${s1}`);
console.log(`S2 of S1, would lose ALL spans : ${s2} (${s1 ? (100*s2/s1).toFixed(1) : "n/a"}%)`);
console.log(`S3 spans ${spansNow} -> ${spansKept} kept (${spansNow ? (100*spansKept/spansNow).toFixed(1) : "n/a"}% retained)`);
for (const l of losers.slice(0, 10)) console.log(`   lost: ${l}`);
