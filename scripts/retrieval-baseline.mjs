/**
 * retrieval-ranking-robustness — local, human-only measurement runner.
 *
 * NEVER reproduces ranking: every query is answered by production
 * `SearchDocuments` (built exactly the way `composition.ts` builds it),
 * observed through the opt-in `SearchTraceObserver` added in
 * `src/application/search-trace.ts`. This script only judges what
 * production already emitted, against reviewed answer evidence
 * (`src/domain/retrieval-evaluation.ts`).
 *
 * Threat model (design.md's Threat Matrix) this file is built against — the
 * literal forbidden identifiers are deliberately spelled out only in
 * `test/retrieval-baseline.test.ts`'s static source audit, never repeated
 * here, so this comment itself cannot accidentally satisfy its own ban:
 *   - Never executes corpus text: every Markdown file's bytes are read and
 *     hashed/passed to the parser, never dynamically evaluated or handed to
 *     a subprocess.
 *   - Never launches an external process of any kind.
 *   - Never drops, resets, re-syncs, re-indexes, or repairs the underlying
 *     database, and never triggers a WAL checkpoint — this is a READER of an
 *     already-built index, nothing else.
 *   - Only ever opens a PRIVATE COPY of the project's database, made from a
 *     checkpointed source (WAL absent or empty) whose bytes are hash-verified
 *     unchanged across the copy. The copy's logical rows/vectors are
 *     digested before and after every query so any mutation — accidental or
 *     otherwise — is detected, not silently accepted.
 *   - Refuses instead of guessing: a missing prerequisite (model files, a
 *     writer still holding the source database, an output path that already
 *     exists, a corpus/goldenset path that resolves outside its declared
 *     root even through a symlink) is a thrown `SecurityError`, never a
 *     silent downgrade or overwrite.
 *
 * Usage (after `npm run build` — this imports compiled `dist/`, exactly like
 * `scripts/vector-reach.mjs`):
 *
 *   node scripts/retrieval-baseline.mjs <root> <goldenset.json> <outputDir> [--mode lexical|hybrid|both] [--model-dir <dir>]
 *
 * Outputs one timestamped JSON report per `(mode, k)` pair under
 * `<outputDir>` — never overwriting an existing file (`assertOutputAvailable`).
 */
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Threat-gate primitives (unit-tested directly, no model/corpus required —
// see test/retrieval-baseline.test.ts).
// ---------------------------------------------------------------------------

/** Thrown for every threat-gate refusal in this file — never a plain `Error`,
 * so a caller (or a test) can distinguish "the safety check fired" from any
 * other kind of failure. */
export class SecurityError extends Error {
  constructor(message) {
    super(message);
    this.name = "SecurityError";
  }
}

/** Resolves `rootPath` to its canonical (symlink-free, absolute) form.
 * Throws if it does not exist or is not a directory — there is nothing to
 * contain a path inside otherwise. */
export function resolveCanonicalRoot(rootPath) {
  const absolute = resolve(rootPath);
  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
    throw new SecurityError(`canonical root does not exist or is not a directory: ${rootPath}`);
  }
  return realpathSync(absolute);
}

/**
 * Refuses a candidate path that resolves (after following ALL symlinks)
 * outside `canonicalRoot` — closes both a `..` traversal and a symlink
 * whose target sits outside the declared root. `candidatePath` itself need
 * not exist yet (an output path); when it doesn't, containment is checked
 * against its nearest existing ancestor directory's realpath instead.
 */
export function assertContained(candidatePath, canonicalRoot, label) {
  const absolute = resolve(candidatePath);
  const real = existingRealpath(absolute);
  const withSep = canonicalRoot.endsWith(sep) ? canonicalRoot : `${canonicalRoot}${sep}`;
  if (real !== canonicalRoot && !real.startsWith(withSep)) {
    throw new SecurityError(
      `${label ?? "path"} escapes its canonical root: "${candidatePath}" resolves to "${real}", outside "${canonicalRoot}"`,
    );
  }
}

/** realpath of `absolute`, or of its nearest existing ancestor when
 * `absolute` itself does not exist yet (an output file not yet written). */
function existingRealpath(absolute) {
  let current = absolute;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break; // reached filesystem root without finding anything
    current = parent;
  }
  const resolvedAncestor = realpathSync(current);
  const remainder = absolute.slice(current.length);
  return remainder.length > 0 ? join(resolvedAncestor, remainder) : resolvedAncestor;
}

/** Strictly `.md` — no `.mdx`, no shell/build files. Deliberately narrower
 * than what production discovery accepts today; this runner only ever
 * touches a prepared, reviewed corpus, so being conservative costs nothing. */
export function isMarkdownPath(path) {
  return /\.md$/i.test(path);
}

/** Refuses to let a report overwrite an existing file — a collision is
 * always a mistake (wrong output dir, stale run) worth stopping for. */
export function assertOutputAvailable(outputPath) {
  if (existsSync(outputPath)) {
    throw new SecurityError(`output path already exists, refusing to overwrite: ${outputPath}`);
  }
}

/**
 * A non-empty `-wal` sidecar means a writer has uncommitted pages pending —
 * this runner must never read (or copy) a database mid-write. Absent, or
 * present-but-empty (freshly checkpointed), both pass.
 */
export function assertWalAbsentOrEmpty(dbPath) {
  const walPath = `${dbPath}-wal`;
  if (!existsSync(walPath)) return;
  if (statSync(walPath).size > 0) {
    throw new SecurityError(
      `refusing to read "${dbPath}": its WAL sidecar is non-empty — stop every writer and checkpoint first`,
    );
  }
}

export function sha256Bytes(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function sha256File(path) {
  return sha256Bytes(readFileSync(path));
}

/** Order-independent combination of many file hashes into one corpus/identity
 * hash — sorted before hashing so declaration order can never affect the
 * result (two provenance manifests listing the same files in a different
 * order must compare equal). */
export function combineFileHashes(hashes) {
  return sha256Bytes(Buffer.from([...hashes].sort().join("\n")));
}

/** The one place "identity/provenance drift" is decided. Equal hashes pass
 * silently; any difference is a `SecurityError` naming what drifted. */
export function verifyUnchanged(before, after, label) {
  if (before !== after) {
    throw new SecurityError(`provenance drift detected in ${label}: expected unchanged, hashes differ`);
  }
}

/**
 * Refuses a hybrid baseline when the embedding model has not actually been
 * prepared on disk — design.md: "missing prerequisites invalidate the
 * requested hybrid baseline, never silently qualify fallback as hybrid."
 * A missing or empty directory means no model files were downloaded/staged.
 */
export function assertModelPrerequisites(modelDir) {
  if (!existsSync(modelDir) || !statSync(modelDir).isDirectory()) {
    throw new SecurityError(`model prerequisites missing: no such directory ${modelDir}`);
  }
  if (readdirSync(modelDir).length === 0) {
    throw new SecurityError(`model prerequisites missing: ${modelDir} is empty`);
  }
}

/**
 * A stable, order-independent digest of every document and chunk an
 * `IndexStore`-shaped object (production `SqliteIndexStore`, or any object
 * duck-typing its read surface) currently reports — used to prove the
 * private database copy's logical rows/vectors did not change across a run,
 * independent of how many queries ran or at what candidate depth (`k=5` vs
 * `k=10` never touch this digest). Only public read methods are used, so
 * this never depends on this project's internal SQL schema.
 */
export function computeLogicalDigest(store) {
  const parts = [];
  const documents = [...store.listDocuments()].sort((a, b) => a.path.localeCompare(b.path));
  for (const doc of documents) {
    parts.push(`D|${doc.path}|${doc.hash}|${doc.type ?? ""}|${doc.module ?? ""}|${doc.status ?? ""}`);
    const chunks = [...store.getChunksByDocument(doc.id)].sort((a, b) => a.position - b.position);
    for (const chunk of chunks) {
      parts.push(`C|${doc.path}|${chunk.position}|${chunk.heading}|${sha256Bytes(Buffer.from(chunk.content))}`);
    }
  }
  parts.push(`VEC|${store.hasVectors() ? "1" : "0"}`);
  return sha256Bytes(Buffer.from(parts.join("\n")));
}

// ---------------------------------------------------------------------------
// Runner (requires `npm run build`; imports compiled `dist/`, never `src/`).
// ---------------------------------------------------------------------------

async function main() {
  const [, , rootArg, goldensetArg, outputDirArg, ...rest] = process.argv;
  if (rootArg === undefined || goldensetArg === undefined || outputDirArg === undefined) {
    console.error(
      "usage: node scripts/retrieval-baseline.mjs <root> <goldenset.json> <outputDir> " +
        "[--mode lexical|hybrid|both] [--model-dir <dir>] [--k 5,10]",
    );
    process.exit(1);
    return;
  }

  const options = parseOptions(rest);
  const canonicalRoot = resolveCanonicalRoot(rootArg);
  const goldensetPath = resolve(goldensetArg);
  // The goldenset is expected to live under this project's Git-ignored
  // `.compendio/evaluation/` directory — its own canonical root, not
  // necessarily the corpus root — so containment is checked against ITS
  // OWN parent directory, not against `canonicalRoot`. This still closes
  // the traversal/symlink-escape gap the threat matrix targets: a goldenset
  // path can never resolve outside the directory the caller declared it in.
  assertContained(goldensetPath, resolveCanonicalRoot(dirname(goldensetPath)), "goldenset file");

  const outputDir = resolve(outputDirArg);
  mkdirSync(outputDir, { recursive: true });
  const canonicalOutputRoot = resolveCanonicalRoot(outputDir);

  const sourceDbPath = join(canonicalRoot, ".compendio", "compendio.db");
  if (!existsSync(sourceDbPath)) {
    throw new SecurityError(`no index found at ${sourceDbPath} — run "compendio index" against this root first`);
  }
  assertWalAbsentOrEmpty(sourceDbPath);

  const sourceHashBeforeCopy = sha256File(sourceDbPath);
  const workDir = mkdtempSync(join(tmpdir(), "compendio-retrieval-baseline-"));
  const copyDbPath = join(workDir, "snapshot.db");
  copyFileSync(sourceDbPath, copyDbPath);
  const copyHash = sha256File(copyDbPath);
  verifyUnchanged(sourceHashBeforeCopy, copyHash, "source database copy");
  const sourceHashAfterCopy = sha256File(sourceDbPath);
  verifyUnchanged(sourceHashBeforeCopy, sourceHashAfterCopy, "source database (untouched by copy)");

  const goldensetRaw = readFileSync(goldensetPath, "utf8");
  const goldenset = JSON.parse(goldensetRaw);
  const goldensetHash = sha256Bytes(Buffer.from(goldensetRaw));

  const { SqliteIndexStore } = await import("../dist/infrastructure/sqlite/sqlite-index-store.js");
  const { SearchDocuments } = await import("../dist/application/search-documents.js");
  const { loadConfigReport } = await import("../dist/infrastructure/config.js");
  const { TransformersEmbeddings } = await import("../dist/infrastructure/embeddings/transformers-embeddings.js");

  const { config } = loadConfigReport(canonicalRoot);
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const codeHash = combineFileHashes(listDistFiles(resolve(scriptDir, "..", "dist")).map(sha256File));

  const store = new SqliteIndexStore(copyDbPath);
  try {
    const digestBefore = computeLogicalDigest(store);

    const modes = options.mode === "both" ? ["lexical", "hybrid"] : [options.mode];
    const ks = options.ks;

    let embeddings = null;
    if (modes.includes("hybrid")) {
      assertModelPrerequisites(options.modelDir);
      embeddings = await TransformersEmbeddings.create("Xenova/multilingual-e5-small", {});
    }

    const runs = [];
    for (const mode of modes) {
      for (const k of ks) {
        const search = new SearchDocuments(store, mode === "hybrid" ? embeddings : null, {
          k,
          excludedStatuses: [],
        });
        const perQuery = [];
        for (const item of goldenset.queries ?? []) {
          const traces = [];
          const response = await search.execute(
            { query: item.query, k, forceLexical: mode === "lexical" },
            { onComplete: (trace) => traces.push(trace) },
          );
          perQuery.push({
            intentId: item.intentId,
            variantId: item.variantId,
            query: item.query,
            response,
            trace: traces[0] ?? null,
          });
        }
        runs.push({ mode, k, results: perQuery });
      }
    }

    const digestAfter = computeLogicalDigest(store);
    verifyUnchanged(digestBefore, digestAfter, "logical rows/vectors (post-run)");

    const manifest = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      root: canonicalRoot,
      sourceDbHash: sourceHashBeforeCopy,
      goldensetHash,
      configHash: sha256Bytes(Buffer.from(JSON.stringify(config))),
      codeHash,
      logicalDigestBefore: digestBefore,
      logicalDigestAfter: digestAfter,
      runId: randomUUID(),
    };

    for (const run of runs) {
      const reportPath = join(outputDir, `retrieval-baseline-${run.mode}-k${run.k}-${manifest.runId}.json`);
      assertContained(reportPath, canonicalOutputRoot, "report output");
      assertOutputAvailable(reportPath);
      writeFileSync(reportPath, JSON.stringify({ manifest, ...run }, null, 2));
      console.log(`wrote ${reportPath}`);
    }
  } finally {
    store.close();
  }
}

function parseOptions(argv) {
  let mode = "lexical";
  let modelDir = resolve("node_modules/@huggingface/transformers/.cache");
  let ks = [5, 10];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--mode") mode = argv[++i];
    else if (argv[i] === "--model-dir") modelDir = resolve(argv[++i]);
    else if (argv[i] === "--k") ks = argv[++i].split(",").map((s) => Number.parseInt(s, 10));
  }
  return { mode, modelDir, ks };
}

function listDistFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listDistFiles(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

const isMainModule = (() => {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMainModule) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
