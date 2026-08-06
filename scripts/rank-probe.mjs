/**
 * Per-leg rank probe: where does a specific chunk land in each retrieval leg,
 * and does it survive into what `search_docs` actually returns?
 *
 * The question this exists to answer is NOT "what does search return" -- the
 * CLI's `search` command already shows that. It is "which stage lost the
 * result": BM25, the vector leg, Reciprocal Rank Fusion, or the per-document
 * cap. Those four have very different fixes, and a fused rank alone cannot
 * tell them apart.
 *
 * That distinction is not hypothetical. It was measured on a corpus where a
 * document's table-of-contents chunk was returned at rank 1 while the chunk
 * holding the answer was not returned at all. The obvious reading -- "the
 * table of contents outranks the content" -- was WRONG. Per-leg numbers showed
 * the vector leg ranking the answer ABOVE the table of contents (#10 vs #17)
 * and BM25 ranking it far below (#36 vs #8), which pointed at corrupted text
 * rather than at any property of tables of contents. Re-running against a
 * repaired copy of the same corpus flipped the result completely. A fused rank
 * would have confirmed the wrong conclusion.
 *
 * It also reports the per-document cap explicitly, because that stage removes
 * results *after* they have ranked. In the same measurement, 45 chunks from a
 * single large document entered the fused candidate list, `capPerDocument`
 * kept 2, and the answer -- which had ranked #6 -- was silently among the 43
 * dropped.
 *
 * No production code is modified to build this: it imports the compiled output
 * from `dist/`. Build first (`npm run build`), then run with
 * `node scripts/rank-probe.mjs`, never a bare `compendio` (CLAUDE.md's "run
 * `node dist/cli.js`, not `compendio`" rule applies here too -- the bare name
 * resolves to whatever is installed globally from npm).
 *
 * Usage:
 *   node scripts/rank-probe.mjs <root> "<query>" "<needle>" [k]
 *
 * `<needle>` is any literal string identifying the chunk(s) of interest -- a
 * section number, a marker, a distinctive phrase. EVERY chunk containing it is
 * probed and reported, never just the first: when several chunks match (a
 * section number appears both in a table of contents and at the section
 * itself), picking one by first-match silently probes the wrong object. That
 * mistake produced a confidently wrong measurement during this script's own
 * development.
 *
 * `k` defaults to the project's configured `search.k`.
 *
 * Reads only. Safe to run against a live index.
 */
import { resolve } from "node:path";
import { capPerDocument, reciprocalRankFusion } from "../dist/domain/fusion.js";
import { loadConfig } from "../dist/infrastructure/config.js";
import { TransformersEmbeddings } from "../dist/infrastructure/embeddings/transformers-embeddings.js";
import { SqliteIndexStore } from "../dist/infrastructure/sqlite/sqlite-index-store.js";

// Mirrors src/application/search-documents.ts. If those constants change
// there, they must change here -- this script's whole value is being a
// faithful replica of the real pipeline.
const CANDIDATE_FACTOR = 10;
const MIN_CANDIDATES = 50;
const MAX_CHUNKS_PER_DOCUMENT = 2;

const [, , rootArg, query, needle, kArg] = process.argv;
if (rootArg === undefined || query === undefined || needle === undefined) {
  console.error('usage: node scripts/rank-probe.mjs <root> "<query>" "<needle>" [k]');
  process.exit(1);
}

const root = resolve(rootArg);
const config = loadConfig(root);
const k = kArg === undefined ? config.search.k : Number.parseInt(kArg, 10);
if (!Number.isInteger(k) || k <= 0) {
  console.error(`invalid k: ${kArg}`);
  process.exit(1);
}

const store = new SqliteIndexStore(resolve(root, config.db));

/**
 * Fraction of lines shaped like a numbered outline entry ("3.3.7.3  Title").
 * A diagnostic, not a criterion: it distinguishes a list-like chunk (table of
 * contents, index, summary table) from a prose chunk at a glance, which is
 * usually what you need to know when a chunk ranks surprisingly high on BM25.
 */
const OUTLINE_RE = /^\s*\d+(\.\d+){1,}\s+\S/;
function outlineShape(text) {
  const lines = text.split("\n");
  const hits = lines.filter((line) => OUTLINE_RE.test(line)).length;
  return { lines: lines.length, hits, ratio: hits / Math.max(1, lines.length) };
}

/** 1-based rank of `id` in a ranked id list, or null when absent. */
function rankOf(ids, id) {
  const index = ids.indexOf(id);
  return index === -1 ? null : index + 1;
}

const fmtRank = (rank, total) => (rank === null ? `not in top-${total}` : `#${rank}`);

try {
  const limit = Math.max(MIN_CANDIDATES, k * CANDIDATE_FACTOR);

  // --- locate every chunk containing the needle ----------------------------
  const documents = store.listDocuments();
  const docById = new Map(documents.map((doc) => [doc.id, doc]));
  const targets = [];
  for (const doc of documents) {
    for (const chunk of store.getChunksByDocument(doc.id)) {
      if (chunk.content.includes(needle)) targets.push({ ...chunk, path: doc.path });
    }
  }

  console.log(`root:    ${root}`);
  console.log(`query:   "${query}"`);
  console.log(`needle:  "${needle}"`);
  console.log(`k:       ${k}  (over-fetch limit ${limit})`);
  console.log(`vectors: ${store.hasVectors() ? "available" : "UNAVAILABLE (lexical-only run)"}`);

  console.log(`\nChunks containing the needle: ${targets.length}`);
  for (const target of targets) {
    const shape = outlineShape(target.content);
    console.log(
      `  chunk=${target.id} pos=${target.position} chars=${target.content.length} ` +
        `heading="${target.heading}" lines=${shape.lines} outlineLines=${shape.hits} ` +
        `outlineRatio=${shape.ratio.toFixed(2)}  ${target.path}`,
    );
  }
  if (targets.length === 0) {
    console.log("\nNothing to measure: no indexed chunk contains the needle. Was the corpus indexed?");
    process.exit(1);
  }

  // --- replicate SearchDocuments.execute exactly ---------------------------
  const lexicalIds = store.searchLexical(query, {}, limit);

  let vectorIds = [];
  if (store.hasVectors()) {
    const embeddings = await TransformersEmbeddings.create(config.embeddings.model, {});
    // The "query: " prefix is required by the E5 embedding family, and
    // SearchDocuments applies it -- omitting it here would probe a different
    // vector than the one production ranks against.
    const [queryVector] = await embeddings.embed([`query: ${query}`]);
    if (queryVector === undefined) {
      console.error("embeddings.embed returned no vector for the query");
      process.exit(1);
    }
    vectorIds = store.searchVector(queryVector, {}, limit);
  }

  const lists = vectorIds.length > 0 ? [lexicalIds, vectorIds] : [lexicalIds];
  const fused = reciprocalRankFusion(lists);
  const fusedIds = fused.map((entry) => entry.id);

  const chunks = store.getChunksByIds(fusedIds);
  const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const capped = capPerDocument(
    fused,
    (id) => chunkById.get(id)?.documentId ?? -1,
    MAX_CHUNKS_PER_DOCUMENT,
  );
  const cappedIds = capped.map((entry) => entry.id);
  const returnedIds = cappedIds.slice(0, k);

  console.log(
    `\nCandidates: lexical=${lexicalIds.length} vector=${vectorIds.length} fused=${fusedIds.length}`,
  );

  // --- the point of the script: rank at every stage ------------------------
  console.log(`\n${"=".repeat(78)}`);
  console.log("RANK PER STAGE");
  console.log("=".repeat(78));
  for (const target of targets) {
    const shape = outlineShape(target.content);
    console.log(
      `\nchunk ${target.id} (pos ${target.position}, ` +
        `${shape.hits > 0 ? "list-like" : "prose"}, outlineRatio=${shape.ratio.toFixed(2)})`,
    );
    console.log(`  lexical (BM25)  : ${fmtRank(rankOf(lexicalIds, target.id), limit)}`);
    console.log(
      `  vector          : ${
        vectorIds.length === 0 ? "n/a (lexical-only run)" : fmtRank(rankOf(vectorIds, target.id), limit)
      }`,
    );
    console.log(`  fused (RRF)     : ${fmtRank(rankOf(fusedIds, target.id), fusedIds.length)}`);
    console.log(`  after cap       : ${fmtRank(rankOf(cappedIds, target.id), cappedIds.length)}`);
    const returnedRank = rankOf(returnedIds, target.id);
    console.log(
      `  RETURNED to the caller (top-${k}): ${returnedRank === null ? "NO" : `YES at #${returnedRank}`}`,
    );
  }

  // --- what search_docs actually returns -----------------------------------
  console.log(`\n${"=".repeat(78)}`);
  console.log(`FINAL top-${k} (what search_docs returns)`);
  console.log("=".repeat(78));
  returnedIds.forEach((id, index) => {
    const chunk = chunkById.get(id);
    const doc = chunk === undefined ? undefined : docById.get(chunk.documentId);
    const shape = chunk === undefined ? null : outlineShape(chunk.content);
    const marker = targets.some((target) => target.id === id) ? "  <-- needle" : "";
    console.log(
      `#${index + 1} chunk=${id} outlineRatio=${shape === null ? "n/a" : shape.ratio.toFixed(2)} ` +
        `${doc?.path ?? "(unknown document)"}${marker}`,
    );
  });

  // --- per-document cap: what ranked but was dropped anyway ----------------
  console.log(`\n${"=".repeat(78)}`);
  console.log(`PER-DOCUMENT CAP (keeps ${MAX_CHUNKS_PER_DOCUMENT} per document)`);
  console.log("=".repeat(78));
  const needleDocIds = new Set(
    targets.map((target) => chunkById.get(target.id)?.documentId).filter((id) => id !== undefined),
  );
  for (const docId of needleDocIds) {
    const fromDoc = fusedIds.filter((id) => chunkById.get(id)?.documentId === docId);
    const kept = fromDoc.filter((id) => cappedIds.includes(id));
    const dropped = fromDoc.filter((id) => !cappedIds.includes(id));
    console.log(`\n${docById.get(docId)?.path ?? `document ${docId}`}`);
    console.log(`  chunks in the fused list : ${fromDoc.length}`);
    console.log(`  kept by the cap          : ${kept.join(", ") || "(none)"}`);
    console.log(`  dropped despite ranking  : ${dropped.length}`);
    const droppedNeedles = targets.filter((target) => dropped.includes(target.id));
    if (droppedNeedles.length > 0) {
      console.log(
        `  *** a needle chunk was dropped by the CAP, not by ranking: ` +
          `${droppedNeedles.map((target) => target.id).join(", ")}`,
      );
    }
  }
} finally {
  store.close();
}
