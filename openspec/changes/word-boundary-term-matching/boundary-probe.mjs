import { resolve } from "node:path";
import { SqliteIndexStore } from "file:///C:/Users/Raul/Workspace/compendio-mcp/dist/infrastructure/sqlite/sqlite-index-store.js";
import { locateSpans, tokenizeQuery, foldForMatch } from "file:///C:/Users/Raul/Workspace/compendio-mcp/dist/domain/match-location.js";

const [, , root, query] = process.argv;
const store = new SqliteIndexStore(resolve(root, ".compendio/compendio.db"));
const terms = tokenizeQuery(query);
const isWordChar = (c) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

let exact = 0, prefix = 0, interior = 0, suffix = 0;
const examples = { prefix: new Map(), interior: new Map(), suffix: new Map() };
for (const doc of store.listDocuments()) {
  for (const chunk of store.getChunksByDocument(doc.id)) {
    const folded = foldForMatch(chunk.content);
    for (const s of locateSpans(chunk.content, terms)) {
      const left = isWordChar(chunk.content[s.start - 1]);
      const right = isWordChar(chunk.content[s.end]);
      const word = folded.slice(Math.max(0, s.start - 12), s.end + 12);
      const bucket = !left && !right ? "exact" : !left && right ? "prefix" : left && !right ? "suffix" : "interior";
      if (bucket === "exact") exact++;
      else {
        if (bucket === "prefix") prefix++; else if (bucket === "suffix") suffix++; else interior++;
        const k = `${s.term} -> ...${word}...`;
        examples[bucket].set(k, (examples[bucket].get(k) ?? 0) + 1);
      }
    }
  }
}
const total = exact + prefix + suffix + interior;
console.log(`query terms: [${terms.join(", ")}]`);
console.log(`total spans over the whole corpus: ${total}`);
console.log(`  exact word match      : ${exact} (${(100*exact/total).toFixed(1)}%)`);
console.log(`  prefix of longer word : ${prefix} (${(100*prefix/total).toFixed(1)}%)`);
console.log(`  suffix of longer word : ${suffix} (${(100*suffix/total).toFixed(1)}%)`);
console.log(`  word interior         : ${interior} (${(100*interior/total).toFixed(1)}%)`);
for (const b of ["prefix", "suffix", "interior"]) {
  const top = [...examples[b].entries()].sort((a, c) => c[1] - a[1]).slice(0, 8);
  if (top.length) { console.log(`\ntop ${b}:`); for (const [k, n] of top) console.log(`  ${n}x  ${k}`); }
}
