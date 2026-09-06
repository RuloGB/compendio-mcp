/**
 * Gate A/B/C measurement for `word-boundary-term-matching` (design.md Decision 1).
 *
 * Follows the `supporting-anchor-probe.mjs` / `excerpt-fence-drop-probe.mjs` precedent: imports
 * compiled `dist/` only, widens no production surface, and drives the REAL search pipeline through
 * `createContainer` (hybrid — `forceLexical` is NEVER passed, `k` is NEVER passed) rather than
 * replicating `runSearch` inside the probe.
 *
 * This probe recomputes spans by calling `dist/`'s own `locateSpans` on the resolved chunk's raw
 * content with the query's tokenized terms — design.md Decision 1, option (a). It deliberately does
 * NOT read `result.excerpt` to decide whether a term was "located" (option (c), rejected as
 * technically broken: excerpt text shows content, not the decision). It deliberately does NOT import
 * the production boundary predicate (`WORD_CHAR` in `match-location.ts` is not exported, by design)
 * — the probe's own classifier below is written independently, in RAW coordinates, so it can never
 * be a tautological echo of the code it is meant to falsify.
 *
 * Usage:
 *   node dist/cli.js --root <root> index                       # hybrid, NOT --lexical, no reindex
 *                                                                # needed between BEFORE/AFTER — only
 *                                                                # `npm run build` changes locateSpans
 *   node scripts/word-boundary-probe.mjs <root> [goldenset] [--mode before|after] [--query "<text>" ...]
 *              [--digest <path>] [--compare-digest <path>]
 *
 * `<root>` is the project root whose `.compendio/compendio.db` was already built by a HYBRID `index`
 * pass. `goldenset` defaults to `<root>/goldenset.yaml` and is read only when no `--query` is given
 * (its `pregunta` key is Spanish and frozen, per `cli.ts`'s own `loadGoldenset`). `--mode` selects
 * which of the two opposite-direction gates (W1 vs W2) applies to THIS run's classified spans — a
 * single script invocation cannot know, on its own, whether the `dist/` build it imported was built
 * before or after the fix; the caller states it. Default: `after`.
 *
 * What it counts, over every result of every query (both the lead result and every supporting one —
 * W3's functional-cost claim is not rank-scoped):
 *
 *   W0 — a result's `(path, section)` must resolve to EXACTLY ONE stored chunk. Checked first;
 *        anything else is excluded from every other counter and reported.
 *        Failure message: CANNOT IDENTIFY THE MEASURED CHUNK.
 *   W1 — (mode=before only) anti-vacuity denominator: of this run's pipeline-emitted spans
 *        (`locateSpans(chunk.content, terms)`), those the probe's OWN raw-coordinate classifier
 *        below calls non-exact (prefix / interior / suffix). Must be > 0, or there is nothing to
 *        falsify against. Failure message: GATE IS VACUOUS.
 *   W2 — (mode=after only) same classification, same computation, gated the other direction: of
 *        this run's pipeline-emitted spans, those classified non-exact. Must be 0.
 *        Failure message: THE FIX DID NOT LAND.
 *   W3 — (only when --compare-digest is given) fragments with >= 1 span in the PREVIOUS run's digest
 *        that have 0 spans in THIS run. Must be 0. Failure message: MATCH CENTRING WAS LOST.
 *   W4 — (only when --compare-digest is given) the ordered `(query, rank, path, section)` tuples of
 *        the previous run's digest must match THIS run's, tuple-for-tuple. Failure message:
 *        POPULATION DRIFTED BETWEEN RUNS.
 *   W5 — reported only, never gated: span retention % (this run's total spans / previous run's, when
 *        a baseline is available), class breakdown (exact/prefix/interior/suffix) of THIS run's
 *        spans, count of fragments whose excerpt text changed vs the previous digest, and — of the
 *        fragments that kept >= 1 span in BOTH runs (i.e. excluded from W3) — the sub-count whose
 *        excerpt text changed anyway (design.md Decision 5's "centre moved" signal), with up to two
 *        verbatim before/after excerpt pairs printed for eyeballing.
 *
 * Every digest entry also carries a span count and an excerpt hash so a later `--compare-digest` run
 * can compute W3 and W5 without re-running the earlier build. `--digest <path>` writes this run's
 * digest (default `<root>/.compendio/word-boundary-probe.digest`).
 *
 * Five distinct, never-conflated failure messages/exit codes — one job each, per counter. Checked in
 * this order: W0, W4 (population identity), W1/W2 (mode-dependent vacuity/landing), W3 (centring
 * loss).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { createContainer } from "../dist/composition.js";
import { locateSpans, tokenizeQuery } from "../dist/domain/match-location.js";

function usageError(message) {
  console.error(message);
  console.error(
    'usage: node scripts/word-boundary-probe.mjs <root> [goldenset] [--mode before|after] ' +
      '[--query "<text>" ...] [--digest <path>] [--compare-digest <path>]',
  );
  process.exit(1);
}

function parseArgs(argv) {
  const positional = [];
  const queries = [];
  let mode = "after";
  let digestPath;
  let compareDigestPath;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--query") {
      const value = argv[++i];
      if (value === undefined) usageError("--query requires a value");
      queries.push(value);
    } else if (arg === "--mode") {
      mode = argv[++i];
      if (mode !== "before" && mode !== "after") usageError('--mode must be "before" or "after"');
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
  return { root: resolve(rootArg), goldensetArg, queries, mode, digestPath, compareDigestPath };
}

// es-frozen: indexes into ejemplos/goldenset.yaml's real (frozen) key — the same key `cli.ts`'s own
// `loadGoldenset` reads.
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

// The probe's OWN classifier, written independently in RAW coordinates. It never imports
// `match-location.ts`'s private `WORD_CHAR` predicate (not exported, by design.md Decision 3) — this
// is the non-tautology guard: a probe that classified spans by calling the very predicate it exists
// to falsify could never observe a failure.
const RAW_WORD_CHAR = /[\p{L}\p{N}]/u;
function isRawWordChar(ch) {
  return ch !== undefined && RAW_WORD_CHAR.test(ch);
}

/** exact | prefix | interior | suffix, classified against `content` in RAW coordinates. */
function classifySpan(content, span) {
  const left = isRawWordChar(content[span.start - 1]);
  const right = isRawWordChar(content[span.end]);
  if (!left && !right) return "exact";
  if (!left && right) return "prefix";
  if (left && !right) return "suffix";
  return "interior";
}

function excerptHash(excerpt) {
  return createHash("sha1").update(excerpt).digest("hex").slice(0, 12);
}

function digestKey(entry) {
  return `${entry.query}\t${entry.rank}\t${entry.path}\t${entry.section}`;
}

function digestLine(entry) {
  return `${digestKey(entry)}\t${entry.spanCount}\t${entry.excerptHash}\t${entry.excerptSnippet}`;
}

function parseDigestLine(line) {
  const [query, rank, path, section, spanCount, hash, ...snippetParts] = line.split("\t");
  return {
    query,
    rank: Number(rank),
    path,
    section,
    spanCount: Number(spanCount),
    excerptHash: hash,
    excerptSnippet: snippetParts.join("\t"),
  };
}

function readDigestFile(path) {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map(parseDigestLine);
}

function pct(count, total) {
  return total === 0 ? "n/a" : `${((count / total) * 100).toFixed(1)}%`;
}

async function main() {
  const {
    root,
    goldensetArg,
    queries: cliQueries,
    mode,
    digestPath: digestArg,
    compareDigestPath,
  } = parseArgs(process.argv.slice(2));

  const queries =
    cliQueries.length > 0 ? cliQueries : loadGoldensetQueries(resolve(goldensetArg ?? join(root, "goldenset.yaml")));

  const digestPath =
    digestArg === undefined ? join(root, ".compendio", "word-boundary-probe.digest") : resolve(digestArg);

  const container = createContainer({ root }); // hybrid: forceLexical NOT passed, k NOT passed

  let w0 = 0; // (path, section) does not resolve to exactly one chunk
  let nonExactSpans = 0; // W1 (mode=before) / W2 (mode=after) — same computation, opposite gate
  let totalSpans = 0;
  const classCounts = { exact: 0, prefix: 0, interior: 0, suffix: 0 };
  const digest = [];

  try {
    for (const query of queries) {
      const terms = tokenizeQuery(query);
      const response = await container.searchDocuments.execute({ query });

      for (let rank = 0; rank < response.results.length; rank++) {
        const result = response.results[rank];
        const doc = container.store.getDocumentByPath(result.path);
        const candidates =
          doc === null
            ? []
            : container.store.getChunksByDocument(doc.id).filter((c) => c.heading === result.section);

        if (candidates.length !== 1) {
          w0++;
          console.error(
            `W0 (cannot identify chunk): query=${JSON.stringify(query)} path=${result.path} ` +
              `section=${JSON.stringify(result.section)} candidateCount=${candidates.length}`,
          );
          continue;
        }
        const chunk = candidates[0];
        const spans = locateSpans(chunk.content, terms);
        totalSpans += spans.length;
        for (const span of spans) {
          const cls = classifySpan(chunk.content, span);
          classCounts[cls]++;
          if (cls !== "exact") nonExactSpans++;
        }

        digest.push({
          query,
          rank,
          path: result.path,
          section: result.section,
          spanCount: spans.length,
          excerptHash: excerptHash(result.excerpt),
          // Tabs/newlines stripped — the digest is tab-delimited.
          excerptSnippet: result.excerpt.replace(/[\t\r\n]+/g, " ").slice(0, 200),
        });
      }
    }
  } finally {
    container.close();
  }

  console.log(`root: ${root}   mode: ${mode}   queries: ${queries.length}`);
  console.log(`W0 (cannot identify measured chunk): ${w0}`);
  console.log(`total spans emitted: ${totalSpans}`);
  console.log(`  exact word match      : ${classCounts.exact} (${pct(classCounts.exact, totalSpans)})`);
  console.log(`  prefix of longer word : ${classCounts.prefix} (${pct(classCounts.prefix, totalSpans)})`);
  console.log(`  word interior         : ${classCounts.interior} (${pct(classCounts.interior, totalSpans)})`);
  console.log(`  suffix of longer word : ${classCounts.suffix} (${pct(classCounts.suffix, totalSpans)})`);
  if (mode === "before") {
    console.log(`W1 (non-exact spans, anti-vacuity denominator): ${nonExactSpans}`);
  } else {
    console.log(`W2 (non-exact spans among AFTER-run emissions): ${nonExactSpans}`);
  }

  mkdirSync(dirname(digestPath), { recursive: true });
  writeFileSync(digestPath, digest.map(digestLine).join("\n") + (digest.length > 0 ? "\n" : ""), "utf8");
  console.log(`Digest (${digest.length} tuples) written to ${digestPath}`);

  let populationDrifted = false;
  let w3 = null;
  let excerptChanged = 0;
  let centreMoved = 0;
  const centreMovedExamples = [];

  if (compareDigestPath !== undefined) {
    const previous = readDigestFile(compareDigestPath);
    if (previous === null) {
      populationDrifted = true;
      console.error(`POPULATION DRIFTED BETWEEN RUNS (no prior digest at ${compareDigestPath})`);
    } else {
      const currentKeys = digest.map(digestKey);
      const previousKeys = previous.map(digestKey);
      if (previousKeys.length !== currentKeys.length || previousKeys.some((k, i) => k !== currentKeys[i])) {
        populationDrifted = true;
        console.error("POPULATION DRIFTED BETWEEN RUNS");
        console.error(`Compared against ${compareDigestPath}: ${previousKeys.length} tuples before, ${currentKeys.length} now.`);
        const firstDiff = previousKeys.findIndex((k, i) => k !== currentKeys[i]);
        if (firstDiff !== -1) {
          console.error(`First difference at index ${firstDiff}:`);
          console.error(`  before: ${previousKeys[firstDiff] ?? "(missing)"}`);
          console.error(`  after:  ${currentKeys[firstDiff] ?? "(missing)"}`);
        }
      } else {
        w3 = 0;
        let previousTotalSpans = 0;
        for (let i = 0; i < digest.length; i++) {
          const before = previous[i];
          const after = digest[i];
          previousTotalSpans += before.spanCount;
          if (before.spanCount >= 1 && after.spanCount === 0) {
            w3++;
            console.error(
              `W3 (lost match-centring): ${digestKey(after)} — spanCount ${before.spanCount} -> 0`,
            );
          }
          if (before.excerptHash !== after.excerptHash) {
            excerptChanged++;
            if (before.spanCount >= 1 && after.spanCount >= 1) {
              centreMoved++;
              if (centreMovedExamples.length < 2) {
                centreMovedExamples.push({ key: digestKey(after), before, after });
              }
            }
          }
        }
        console.log(`\nW3 (fragments that lost ALL spans between the two runs): ${w3}`);
        console.log(
          `W5 span retention: ${totalSpans}/${previousTotalSpans} kept ` +
            `(${pct(totalSpans, previousTotalSpans)})`,
        );
        console.log(`W5 fragments whose excerpt text changed: ${excerptChanged} (${pct(excerptChanged, digest.length)})`);
        console.log(
          `W5 of those, fragments that kept >=1 span in BOTH runs (centre moved, not fallback): ` +
            `${centreMoved} (${pct(centreMoved, digest.length)})`,
        );
        for (const example of centreMovedExamples) {
          console.log(`\n  centre-moved example: ${example.key}`);
          console.log(`    before: ${example.before.excerptSnippet}`);
          console.log(`    after:  ${example.after.excerptSnippet}`);
        }
      }
    }
  }

  // Checked in this exact order — one job each, never conflated: W0, W4 (population identity),
  // W1/W2 (mode-dependent vacuity/landing), W3 (centring loss).
  let failureMessage = null;
  if (w0 > 0) failureMessage = "CANNOT IDENTIFY THE MEASURED CHUNK";
  else if (populationDrifted) failureMessage = "POPULATION DRIFTED BETWEEN RUNS";
  else if (mode === "before" && nonExactSpans === 0) failureMessage = "GATE IS VACUOUS";
  else if (mode === "after" && nonExactSpans > 0) failureMessage = "THE FIX DID NOT LAND";
  else if (w3 !== null && w3 > 0) failureMessage = "MATCH CENTRING WAS LOST";

  if (failureMessage !== null) {
    console.error(`\n${"!".repeat(70)}`);
    console.error(failureMessage);
    console.error("!".repeat(70));
    process.exit(1);
  }
}

await main();
