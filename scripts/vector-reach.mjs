/**
 * Gate 1b measurement (design.md Decision 5, amended twice: once after Work
 * Unit 1's first baseline run withdrew the top-10-membership criterion, and
 * again after that same baseline's cosines turned out to come from the wrong
 * vector population).
 *
 * `SearchDocuments` always fuses BM25 with the vector leg (Reciprocal Rank
 * Fusion), so a keyword match anywhere in the query can make a chunk surface
 * in `search_docs` even when the vector leg never found it — the exact trap
 * this gate exists to rule out. This script never touches `chunks_fts`: it
 * builds the real embeddings provider, embeds the query with the E5
 * `"query: "` prefix `SearchDocuments` uses, and calls
 * `IndexStore.searchVector` directly.
 *
 * No production code is modified to build this: it imports the compiled
 * output from `dist/`. Build first (`npm run build`), then run with
 * `node scripts/vector-reach.mjs`, never a bare `compendio` (CLAUDE.md's
 * "run `node dist/cli.js`, not `compendio`" rule applies here too — the bare
 * name resolves to whatever is installed globally from npm).
 *
 * Usage:
 *   node scripts/vector-reach.mjs <root> "<query>"
 *
 * **Second amendment — cosines must come from the STORED vectors, not a
 * re-embedding.** The first extended version (Work Unit 1, tasks 1.8–1.9)
 * displayed each chunk's cosine by re-embedding `chunk.content` one at a
 * time. That measures a different population from the one `searchVector`
 * ranks: stored vectors are written in batches by `IndexDocuments`
 * ("Embedding N chunks in 1 batches"), and batch padding shifts a vector by
 * up to ~0.002 against a one-at-a-time re-embedding of the same text. The
 * symptom was visible in the printed output itself — rank 5 showed a
 * *higher* cosine (0.8367) than ranks 3 and 4 (0.8360, 0.8350). That ordering
 * is impossible if rank and cosine come from the same vectors: with
 * normalized vectors `‖a−b‖² = 2 − 2·a·b`, so `vec0`'s ascending-L2 order
 * *is* descending-cosine order, exactly (stated as an invariant in
 * `CLAUDE.md`). This version reads every chunk's cosine from its vector as
 * actually stored in `chunks_vec` (`SELECT chunk_id, embedding FROM
 * chunks_vec`, decoding the FLOAT32 blob and copying it out of the row
 * buffer), so criteria A (rank) and B (cosine) measure the same objects, and
 * asserts the monotonicity invariant instead of trusting it by eye.
 *
 * This does not widen `IndexStore` for a one-off script: it opens its own
 * `better-sqlite3` connection to the same database file `SqliteIndexStore`
 * already opens, and loads the `sqlite-vec` extension itself — the same two
 * calls `SqliteIndexStore`'s constructor makes
 * (`src/infrastructure/sqlite/sqlite-index-store.ts:84-92`). Both packages
 * are already project dependencies.
 *
 * Output (amended Decision 5 — the original "no chunk containing the marker
 * appears in the vector top-10" criterion was withdrawn: `containsMarker` is
 * text containment, and on a 6-chunk fixture every chunk trivially satisfies
 * "in the top-10", so the criterion could never have failed either before or
 * after the split):
 *
 *   1. Per rank (1..10): chunk id, document path, heading, `estimateTokens`,
 *      `containsMarker` (locates the marker chunk — it is not itself a
 *      criterion), and that chunk's own cosine against the query, read from
 *      its STORED vector in `chunks_vec`.
 *   2. The filler band: min/max cosine across the ranked chunks that do NOT
 *      contain the marker.
 *   3. Criterion A: the marker chunk's rank in the vector-only ranking,
 *      found via a full scan independent of whether it lands in the
 *      top-10 window printed in step 1.
 *   4. Criterion B: the marker chunk's own cosine against the query, read
 *      from its STORED vector.
 *   5. Criterion C, the truncation probe:
 *      `cosine(embed("passage: " + first 384 words of the marker DOCUMENT,
 *                     read from disk),
 *             <marker chunk's STORED vector>)`.
 *      Validates the fixture, not the change (design.md Decision 5).
 *   6. Two diagnostics: the marker string's character offset inside its
 *      chunk, and that chunk's character length.
 *   7. A self-check: the printed per-rank cosines MUST be monotonically
 *      non-increasing down the ranking (rank and cosine now come from the
 *      same stored vectors, so this can never legitimately fail). If it
 *      does, the script prints a clearly-marked error and exits non-zero
 *      instead of printing a silently-wrong gate — a silent violation is
 *      exactly what hid the first-baseline defect.
 *
 * Pass/fail (design.md Decision 5, amended) — read by eye, not asserted here
 * (except the monotonicity self-check above, which IS asserted):
 *
 *   | Criterion | BEFORE (expected)            | AFTER (required)                      |
 *   |-----------|-------------------------------|----------------------------------------|
 *   | A rank    | not 1                         | 1                                      |
 *   | B cosine  | inside the filler band        | >= 0.855 AND strictly above that run's |
 *   |           |                                | own filler-band ceiling                |
 *   | C probe   | >= 0.99 (else fixture is void)| reported, expected <= 0.97, not gated  |
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { estimateTokens } from "../dist/domain/tokens.js";
import { loadConfig, resolveRoots } from "../dist/infrastructure/config.js";
import { TransformersEmbeddings } from "../dist/infrastructure/embeddings/transformers-embeddings.js";
import { SqliteIndexStore } from "../dist/infrastructure/sqlite/sqlite-index-store.js";

const MARKER = "QUETZAL-7731";
const MODEL = "Xenova/multilingual-e5-small";
const TOP_K = 10;
const PROBE_WORDS = 384;

const [, , rootArg, query] = process.argv;
if (rootArg === undefined || query === undefined) {
  console.error('usage: node scripts/vector-reach.mjs <root> "<query>"');
  process.exit(1);
}

const root = resolve(rootArg);
const dbPath = resolve(root, ".compendio/compendio.db");
const store = new SqliteIndexStore(dbPath);

try {
  console.log(`Model: ${MODEL}`);
  console.log("Loading embeddings provider (may download on first run)...");
  const embeddings = await TransformersEmbeddings.create(MODEL, {});

  const [queryVector] = await embeddings.embed([`query: ${query}`]);
  if (queryVector === undefined) {
    console.error("embeddings.embed returned no vector for the query");
    process.exit(1);
  }

  const storedVectors = readStoredVectors(dbPath);

  const ids = store.searchVector(queryVector, {}, TOP_K);
  const chunks = store.getChunksByIds(ids);
  const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const documents = store.getDocumentsByIds(chunks.map((chunk) => chunk.documentId));

  console.log(`\nVector-only top-${TOP_K} for query: "${query}"\n`);

  const fillerCosines = [];
  const rankCosines = [];
  let markerRankIndex = -1;

  ids.forEach((id, index) => {
    const chunk = chunkById.get(id);
    if (chunk === undefined) {
      rankCosines.push(null);
      return;
    }
    const doc = documents.get(chunk.documentId);
    const hasMarker = chunk.content.includes(MARKER);
    const vector = storedVectors.get(id);
    const cosine = vector === undefined ? null : cosineSimilarity(queryVector, vector);
    rankCosines.push(cosine);
    if (hasMarker) {
      markerRankIndex = index;
    } else if (cosine !== null) {
      fillerCosines.push(cosine);
    }
    console.log(
      `#${index + 1}\tchunk ${chunk.id}\t${doc?.path ?? "(unknown document)"}\t` +
        `heading="${chunk.heading}"\ttokens=${estimateTokens(chunk.content)}\t` +
        `containsMarker=${hasMarker}\tcosine=${cosine === null ? "n/a" : cosine.toFixed(4)}`,
    );
  });
  if (ids.length === 0) console.log("(no results — vector index empty or unavailable)");

  const monotonicityViolations = findMonotonicityViolations(rankCosines);
  if (monotonicityViolations.length > 0) {
    console.error(`\n${"!".repeat(70)}`);
    console.error("INVARIANT VIOLATION: per-rank cosines are not monotonically");
    console.error("non-increasing. Rank comes from vec0's ascending-L2 order over the");
    console.error("SAME stored vectors these cosines are computed from, so with");
    console.error("normalized vectors (‖a−b‖² = 2 − 2·a·b) ascending L2 order IS");
    console.error("descending cosine order, exactly. A violation here means rank and");
    console.error("cosine are reading two different vector populations again — see");
    console.error("design.md Decision 5 and CLAUDE.md's normalized-vectors invariant.");
    for (const violation of monotonicityViolations) {
      console.error(
        `  rank ${violation.rank} cosine ${violation.cosine.toFixed(4)} > ` +
          `rank ${violation.previousRank} cosine ${violation.previousCosine.toFixed(4)}`,
      );
    }
    console.error("!".repeat(70));
    process.exit(1);
  }

  const fillerBandLabel =
    fillerCosines.length === 0
      ? "n/a (no non-marker chunks ranked)"
      : `[${Math.min(...fillerCosines).toFixed(4)}, ${Math.max(...fillerCosines).toFixed(4)}]`;
  console.log(`\nFiller band (min/max cosine, non-marker chunks): ${fillerBandLabel}`);

  // Criteria A/B/C locate and measure the marker chunk independent of the
  // top-K window printed above (a full scan), so this still works on a
  // future run where the marker chunk does not land in the top-K.
  const markerChunk = findMarkerChunk(store, MARKER);
  if (markerChunk === null) {
    console.log(`\nNo indexed chunk contains ${MARKER} at all — was the fixture indexed?`);
  } else {
    const markerInTopK = markerRankIndex !== -1;
    const markerPassageVector = storedVectors.get(markerChunk.id);
    const markerCosine =
      markerPassageVector === undefined ? null : cosineSimilarity(queryVector, markerPassageVector);

    // Truncation probe: the marker DOCUMENT's first 384 words (read from the
    // raw file, not the indexed chunk — the two diverge once the splitter
    // lands) against the marker CHUNK's own STORED vector.
    //
    // `markerChunk.path` is already root-alias-prefixed (design.md Decision
    // 1), so it cannot be joined onto `config.docsDir` directly — that both
    // throws (docsDir is an array, not a directory string) and double-counts
    // the prefix even if it didn't. Calling the same `resolveRoots` production
    // wiring uses (design.md Decision 11) keeps this script from carrying a
    // second, divergence-prone implementation of root resolution.
    const config = loadConfig(root);
    const roots = resolveRoots(root, config.docsDir);
    const owner = roots.find((r) => markerChunk.path.startsWith(`${r.prefix}/`)) ?? roots[0];
    const docPath = resolve(owner.dir, markerChunk.path.slice(owner.prefix.length + 1));
    const docText = readFileSync(docPath, "utf8");
    const probeText = firstWords(docText, PROBE_WORDS);
    const [probeVector] = await embeddings.embed([`passage: ${probeText}`]);
    const probeCosine =
      markerPassageVector === undefined || probeVector === undefined
        ? null
        : cosineSimilarity(markerPassageVector, probeVector);

    const offset = markerChunk.content.indexOf(MARKER);

    console.log(`\nMarker chunk ${markerChunk.id} (${markerChunk.path})`);
    console.log(
      `Criterion A — rank of the marker chunk in the vector-only ranking: ` +
        `${markerInTopK ? `${markerRankIndex + 1} of ${ids.length}` : `not in top-${TOP_K}`}`,
    );
    console.log(
      `Criterion B — marker chunk cosine vs query: ` +
        `${markerCosine === null ? "n/a" : markerCosine.toFixed(4)}`,
    );
    console.log(
      `Criterion C — truncation probe (first ${PROBE_WORDS} words of the document vs ` +
        `the marker chunk): ${probeCosine === null ? "n/a" : probeCosine.toFixed(4)}`,
    );
    console.log(
      `Diagnostics — marker string offset inside its chunk: ${offset} chars; ` +
        `chunk length: ${markerChunk.content.length} chars`,
    );
  }
} finally {
  store.close();
}

/**
 * Reads every stored vector directly from `chunks_vec`, decoding the FLOAT32
 * blob `vec0` stores. Opens its own `better-sqlite3` connection (does not
 * widen `IndexStore` — this script already opens the same database file
 * through `SqliteIndexStore`, so a second read-only handle onto the same
 * file is not a new port). Each row's `embedding` Buffer is copied into a
 * fresh `Float32Array` rather than kept as a view over the row's buffer,
 * since that buffer is reused/reclaimed once `better-sqlite3` moves on to
 * the next row.
 */
function readStoredVectors(path) {
  const db = new Database(path, { readonly: true });
  try {
    sqliteVec.load(db);
    const rows = db.prepare(`SELECT chunk_id, embedding FROM chunks_vec`).all();
    const vectors = new Map();
    for (const row of rows) {
      const buf = row.embedding;
      const view = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
      vectors.set(Number(row.chunk_id), Float32Array.from(view));
    }
    return vectors;
  } catch {
    // chunks_vec may not exist yet (lexical-only index) — treat as "no
    // stored vectors" rather than crashing; downstream cosines read "n/a".
    return new Map();
  } finally {
    db.close();
  }
}

/**
 * Cosine similarity, normalizing both vectors defensively rather than
 * assuming they already are: the provider normalizes today
 * (`transformers-embeddings.ts`), but the identity this script's
 * monotonicity check depends on (`‖a−b‖² = 2 − 2·a·b`) only holds for unit
 * vectors, so this stays correct even if a future provider stops
 * normalizing.
 */
function cosineSimilarity(a, b) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dotProduct += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Scans a list of per-rank cosines (in rank order, `null` where a chunk has
 * no stored vector) and returns every point where a later rank's cosine is
 * strictly greater than an earlier rank's — impossible for normalized
 * vectors when rank and cosine come from the same stored vectors. `null`
 * entries are skipped (compared against the nearest earlier non-null value)
 * rather than treated as a violation, since a missing vector is a distinct,
 * already-reported condition ("n/a"), not an ordering defect.
 */
function findMonotonicityViolations(cosines) {
  const violations = [];
  let previousCosine = null;
  let previousRank = null;
  cosines.forEach((cosine, index) => {
    const rank = index + 1;
    if (cosine === null) return;
    if (previousCosine !== null && cosine > previousCosine) {
      violations.push({ rank, previousRank, cosine, previousCosine });
    }
    previousCosine = cosine;
    previousRank = rank;
  });
  return violations;
}

/** Scans every indexed chunk for the marker — independent of the top-K search above. */
function findMarkerChunk(store, marker) {
  for (const doc of store.listDocuments()) {
    for (const chunk of store.getChunksByDocument(doc.id)) {
      if (chunk.content.includes(marker)) return { ...chunk, path: doc.path };
    }
  }
  return null;
}

/** First `count` whitespace-separated words of `text`, rejoined with single spaces. */
function firstWords(text, count) {
  return text.trim().split(/\s+/).slice(0, count).join(" ");
}
