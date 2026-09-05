/**
 * Gate A/B measurement for `supporting-excerpt-anchoring` (design.md Decision 6).
 *
 * Follows the `excerpt-fence-drop-probe.mjs` / `vector-reach.mjs` precedent:
 * imports compiled `dist/`, widens no production surface, and drives the
 * REAL search pipeline through `createContainer` rather than replicating
 * `runSearch` (lexical + vector + RRF + `capPerDocument`) inside the probe —
 * replication drift measured at 0 today becomes drift discovered later.
 * Deliberately does NOT import `buildExcerpt` or `locateSpans`: the probe
 * observes the excerpt the pipeline produced, never recomputes one to
 * compare against itself.
 *
 * Usage:
 *   node dist/cli.js --root <root> index                      # hybrid, NOT --lexical
 *   node scripts/supporting-anchor-probe.mjs <root> [goldenset] [--query "<text>" ...]
 *              [--digest <path>] [--compare-digest <path>]
 *
 * `<root>` is the project root whose `.compendio/compendio.db` was already
 * built by a HYBRID `index` pass (never `--lexical` — that changes which
 * chunks occupy ranks 1-4 and makes the numbers non-comparable to the
 * measured baseline). `goldenset` defaults to `<root>/goldenset.yaml` and is
 * read only when no `--query` is given; at least one `--query` skips the
 * goldenset entirely (how Gate B runs a known-vacuous query set without a
 * committed nonsense fixture). The goldenset's `pregunta` key is Spanish and
 * frozen — es-frozen, per `cli.ts`'s own `loadGoldenset`.
 *
 * Search runs in HYBRID mode (`createContainer` without `forceLexical`) and
 * `k` is never passed (the config default, 5) — both binding parameters from
 * design.md Decision 6: a lexical-only or wider-`k` probe measures a
 * different population than the one this gate's numbers were pinned against.
 *
 * What it counts, over every SUPPORTING (rank >= 1) result of every query:
 *
 *   C7 — ambiguous chunk resolution. A result's `(path, section)` must
 *        resolve to EXACTLY ONE stored chunk (every chunk of that document
 *        whose `heading === section`). Zero or more than one candidate means
 *        the probe cannot say which chunk it measured: printed and excluded
 *        from every other counter. Checked FIRST — a probe that cannot
 *        identify its own population is not measuring anything.
 *   C2 — the anti-vacuity denominator: fragments whose FLATTENED chunk text
 *        (`flattenWithMap(content, true)`, falling back to
 *        `flattenWithMap(content, false)` on an empty result, exactly
 *        `buildExcerpt`'s own two-pass rule) contains at least one folded
 *        query term. NEVER computed over raw `chunk.content` — a term
 *        surviving only in a heading line inflates that denominator while
 *        being unreachable by any excerpt policy (the defect exploration
 *        §11.4 caught; C6 below keeps the correction visible).
 *   C1 — of the C2 population, fragments whose `excerpt` shows ZERO query
 *        terms (no folded term is a substring of the folded excerpt).
 *        Baseline (unmodified code) > 0; after the fix, must be 0.
 *   C3 — of the C2 population, fragments whose excerpt both starts AND ends
 *        with "…".
 *   C4 — mean number of distinct query terms visible in the excerpt, over
 *        the C2 population.
 *   C5 — of the C2 population, fragments with a hard mid-word edge: strip
 *        the excerpt's ellipses to get `body`, `idx = flat.indexOf(body)`; a
 *        leading cut is `excerpt` starting with "…" and `flat[idx - 1] !==
 *        " "`, a trailing cut is `excerpt` ending with "…" and
 *        `flat[idx + body.length] !== " "`. `idx === -1` is impossible in
 *        principle and is counted and reported separately, never silently
 *        skipped.
 *   C6 — fragments EXCLUDED from C2 because their query terms exist in raw
 *        `chunk.content` but not in the flattened text (the exact shape C2's
 *        flattened-only rule exists to exclude).
 *
 * Binding amendment (Review response, design.md): alongside C1-C7, the probe
 * emits an ORDERED DIGEST of the `(query, rank, path, section)` tuples of
 * every measured (non-C7) supporting result, in emission order, to
 * `--digest <path>` (default `<root>/.compendio/gate-a.digest`) — this is
 * how two separate invocations can be diffed. `--compare-digest <path>`
 * loads a prior run's digest and requires the two to match TUPLE FOR TUPLE,
 * not merely in count: a run-to-run swap of which chunk occupies a rank slot
 * can hold C2's size steady while corrupting every rate computed over it.
 *
 * Self-checks, in this exact order, never conflated (the precedent is
 * `excerpt-fence-drop-probe.mjs`):
 *   1. C7 > 0                          -> "CANNOT IDENTIFY THE MEASURED CHUNK"
 *   2. --compare-digest given and the
 *      digests differ                  -> "POPULATION DRIFTED BETWEEN RUNS"
 *   3. C2 === 0                        -> "GATE IS VACUOUS"
 *   4. C1 > 0                          -> "THE FIX DID NOT LAND"
 *   otherwise exit 0.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { createContainer } from "../dist/composition.js";
import { flattenWithMap } from "../dist/domain/flatten-map.js";
import { foldForMatch, tokenizeQuery } from "../dist/domain/match-location.js";

function usageError(message) {
  console.error(message);
  console.error(
    'usage: node scripts/supporting-anchor-probe.mjs <root> [goldenset] [--query "<text>" ...] ' +
      "[--digest <path>] [--compare-digest <path>]",
  );
  process.exit(1);
}

function parseArgs(argv) {
  const positional = [];
  const queries = [];
  let digestPath;
  let compareDigestPath;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--query") {
      const value = argv[++i];
      if (value === undefined) usageError("--query requires a value");
      queries.push(value);
    } else if (arg === "--digest") {
      digestPath = argv[++i];
      if (digestPath === undefined) usageError("--digest requires a value");
    } else if (arg === "--compare-digest") {
      compareDigestPath = argv[++i];
      if (compareDigestPath === undefined) usageError("--compare-digest requires a value");
    } else if (arg.startsWith("--")) {
      usageError(`unknown flag: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  const [rootArg, goldensetArg] = positional;
  if (rootArg === undefined) usageError("missing <root>");
  return { root: resolve(rootArg), goldensetArg, queries, digestPath, compareDigestPath };
}

// es-frozen: indexes into ejemplos/goldenset.yaml's real (frozen) key —
// the same key `cli.ts`'s own `loadGoldenset` reads.
function loadGoldensetQueries(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    console.error(`Goldenset not found at "${path}".`);
    process.exit(2);
  }
  const parsed = parseYaml(raw);
  if (!Array.isArray(parsed)) {
    console.error("The goldenset must be a YAML list of { pregunta, esperado } entries.");
    process.exit(2);
  }
  const queries = [];
  for (const entry of parsed) {
    const question = entry?.["pregunta"];
    if (typeof question === "string") queries.push(question);
  }
  return queries;
}

/** Distinct, non-empty folded forms of `terms` — the population C1/C4 test membership over. */
function distinctFoldedTerms(terms) {
  return Array.from(new Set(terms.map((t) => foldForMatch(t)).filter((t) => t.length > 0)));
}

/** `buildExcerpt`'s exact flatten rule: drop fenced blocks, fall back to the un-dropped pass on an empty result. */
function flattenLikeBuildExcerpt(content) {
  let flat = flattenWithMap(content, true);
  if (flat.text.length === 0) flat = flattenWithMap(content, false);
  return flat;
}

function digestLine(entry) {
  return `${entry.query}\t${entry.rank}\t${entry.path}\t${entry.section}`;
}

function readDigestFile(path) {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.length > 0);
}

async function main() {
  const { root, goldensetArg, queries: cliQueries, digestPath: digestArg, compareDigestPath } = parseArgs(
    process.argv.slice(2),
  );

  const queries =
    cliQueries.length > 0 ? cliQueries : loadGoldensetQueries(resolve(goldensetArg ?? join(root, "goldenset.yaml")));

  const digestPath = digestArg === undefined ? join(root, ".compendio", "gate-a.digest") : resolve(digestArg);

  const container = createContainer({ root }); // hybrid: forceLexical NOT passed (design.md Decision 6)

  let c1 = 0; // C2 population: zero query terms visible in the excerpt
  let c2 = 0; // anti-vacuity denominator: flattened text holds >= 1 folded term
  let c3 = 0; // C2 population: both-ellipsis
  let c4Sum = 0; // C2 population: sum of distinct terms visible in the excerpt
  let c5 = 0; // C2 population: hard mid-word edge
  let c5Impossible = 0; // C2 population: idx === -1 (should never happen)
  let c6 = 0; // excluded from C2: term exists in raw content, not in flattened text
  let c7 = 0; // ambiguous (path, section) -> chunk resolution
  const digest = [];

  try {
    for (const query of queries) {
      const terms = distinctFoldedTerms(tokenizeQuery(query));
      const response = await container.searchDocuments.execute({ query });

      for (let rank = 1; rank < response.results.length; rank++) {
        const result = response.results[rank];
        const doc = container.store.getDocumentByPath(result.path);
        const candidates =
          doc === null ? [] : container.store.getChunksByDocument(doc.id).filter((c) => c.heading === result.section);

        if (candidates.length !== 1) {
          c7++;
          console.error(
            `C7 (ambiguous chunk): query=${JSON.stringify(query)} path=${result.path} ` +
              `section=${JSON.stringify(result.section)} candidateCount=${candidates.length}`,
          );
          continue;
        }
        const chunk = candidates[0];
        digest.push({ query, rank, path: result.path, section: result.section });

        const flat = flattenLikeBuildExcerpt(chunk.content);
        const flatFolded = foldForMatch(flat.text);
        const flatVisible = terms.filter((t) => flatFolded.includes(t));

        if (flatVisible.length === 0) {
          const rawFolded = foldForMatch(chunk.content);
          const rawVisible = terms.filter((t) => rawFolded.includes(t));
          if (rawVisible.length > 0) c6++;
          continue; // not in the C2 population
        }
        c2++;

        const excerptFolded = foldForMatch(result.excerpt);
        const excerptVisible = terms.filter((t) => excerptFolded.includes(t));
        if (excerptVisible.length === 0) c1++;
        c4Sum += excerptVisible.length;

        const leadingEllipsis = result.excerpt.startsWith("…");
        const trailingEllipsis = result.excerpt.endsWith("…");
        if (leadingEllipsis && trailingEllipsis) c3++;

        const body = result.excerpt.slice(
          leadingEllipsis ? 1 : 0,
          result.excerpt.length - (trailingEllipsis ? 1 : 0),
        );
        const idx = flat.text.indexOf(body);
        if (idx === -1) {
          c5Impossible++;
          console.error(
            `C5 IMPOSSIBLE: query=${JSON.stringify(query)} path=${result.path} ` +
              `section=${JSON.stringify(result.section)} — excerpt body not found in flattened text`,
          );
        } else {
          const leadingCut = leadingEllipsis && flat.text[idx - 1] !== " ";
          const trailingCut = trailingEllipsis && flat.text[idx + body.length] !== " ";
          if (leadingCut || trailingCut) c5++;
        }
      }
    }
  } finally {
    container.close();
  }

  const c4Mean = c2 === 0 ? NaN : c4Sum / c2;

  console.log(`Queries: ${queries.length}`);
  console.log(`C7 (ambiguous chunk resolution): ${c7}`);
  console.log(`C2 (flattened-text anti-vacuity denominator): ${c2}`);
  console.log(`C1 (zero query terms visible, of C2): ${c1} (${pct(c1, c2)})`);
  console.log(`C3 (both-ellipsis, of C2): ${c3} (${pct(c3, c2)})`);
  console.log(`C4 (mean distinct terms visible, of C2): ${c4Mean.toFixed(2)}`);
  console.log(`C5 (hard mid-word edge, of C2): ${c5} (${pct(c5, c2)})`);
  console.log(`C5 impossible (idx === -1, of C2): ${c5Impossible}`);
  console.log(`C6 (excluded from C2 — term in raw content only): ${c6}`);

  mkdirSync(dirname(digestPath), { recursive: true });
  writeFileSync(digestPath, digest.map(digestLine).join("\n") + (digest.length > 0 ? "\n" : ""), "utf8");
  console.log(`Digest (${digest.length} tuples) written to ${digestPath}`);

  let failureMessage = null;

  if (c7 > 0) {
    failureMessage = "CANNOT IDENTIFY THE MEASURED CHUNK";
  } else if (compareDigestPath !== undefined) {
    const previous = readDigestFile(compareDigestPath);
    const current = digest.map(digestLine);
    if (previous === null) {
      failureMessage = `POPULATION DRIFTED BETWEEN RUNS (no prior digest at ${compareDigestPath})`;
    } else if (previous.length !== current.length || previous.some((line, i) => line !== current[i])) {
      failureMessage = "POPULATION DRIFTED BETWEEN RUNS";
      console.error(`Compared against ${compareDigestPath}: ${previous.length} tuples before, ${current.length} now.`);
      const firstDiff = previous.findIndex((line, i) => line !== current[i]);
      if (firstDiff !== -1) {
        console.error(`First difference at index ${firstDiff}:`);
        console.error(`  before: ${previous[firstDiff] ?? "(missing)"}`);
        console.error(`  after:  ${current[firstDiff] ?? "(missing)"}`);
      }
    }
  }

  if (failureMessage === null && c2 === 0) failureMessage = "GATE IS VACUOUS";
  if (failureMessage === null && c1 > 0) failureMessage = "THE FIX DID NOT LAND";

  if (failureMessage !== null) {
    console.error(`\n${"!".repeat(70)}`);
    console.error(failureMessage);
    console.error("!".repeat(70));
    process.exit(1);
  }
}

function pct(count, total) {
  return total === 0 ? "n/a" : `${((count / total) * 100).toFixed(1)}%`;
}

await main();
