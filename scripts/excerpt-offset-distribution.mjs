/**
 * Recorded observation (proposal.md "Decision: SUPPORTING_EXCERPT_CHARS
 * fragments stay prefixes", design.md task 16.1) — NOT a gate on this
 * change. Over `ejemplos/` + its 22-query `goldenset.yaml`, for every
 * non-lead (rank >= 1) result, records the flattened offset of its
 * earliest located match span and reports the fraction landing past
 * `SUPPORTING_EXCERPT_CHARS` (120) — i.e. a fraction a 120-char
 * start-anchored prefix could never show, however it were centred.
 *
 * "Earliest span" (not the span `selectMatchCentre` would pick for a
 * 1400-char lead budget) is the deliberately conservative measure: it is
 * the position closest to being visible in a small prefix, so if even the
 * earliest match sits past 120, no reasonable centring choice would have
 * helped either.
 *
 * Per the proposal: if more than half of supporting fragments' earliest
 * match spans start past 120, that is evidence the "stay prefixes" decision
 * should be reopened as a separate, narrow follow-up — not evidence to act
 * on inside this change. Below that, the decision stands on the record.
 *
 * No production code is modified to build this: it imports the compiled
 * output from `dist/`, following `scripts/vector-reach.mjs`'s pattern. Run
 * with `node scripts/excerpt-offset-distribution.mjs` after `npm run build`
 * — never a bare `compendio` (CLAUDE.md's dist-vs-global-install note).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { flattenWithMap, toFlatOffset } from "../dist/domain/flatten-map.js";
import { locateSpans, tokenizeQuery } from "../dist/domain/match-location.js";
import { SUPPORTING_EXCERPT_CHARS } from "../dist/domain/excerpt.js";
import { SearchDocuments } from "../dist/application/search-documents.js";
import { SqliteIndexStore } from "../dist/infrastructure/sqlite/sqlite-index-store.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const dbPath = resolve(root, "ejemplos/.compendio/compendio.db");
const goldensetPath = resolve(root, "ejemplos/goldenset.yaml");

const store = new SqliteIndexStore(dbPath);
try {
  const search = new SearchDocuments(store, null, { k: 5, excludedStatuses: [] });
  const cases = parseYaml(readFileSync(goldensetPath, "utf8"));

  let totalSupporting = 0;
  let withNoLexicalMatch = 0;
  let withinBudget = 0;
  let pastBudget = 0;
  const pastBudgetSamples = [];

  for (const item of cases) {
    const query = item.pregunta;
    // Lexical-only and deterministic: locateSpans only ever finds lexical
    // term occurrences, so a hybrid-only (vector-surfaced) supporting
    // result would always show as "no lexical match" here regardless —
    // forcing lexical avoids a network call/model download in this script
    // while measuring the identical population for this specific question.
    const response = await search.execute({ query, k: 5, forceLexical: true });
    const terms = tokenizeQuery(query);
    const supporting = response.results.slice(1); // rank >= 1

    for (const result of supporting) {
      totalSupporting++;
      const chunk = store
        .getChunksByDocument(store.getDocumentByPath(result.path)?.id ?? -1)
        .find((c) => c.heading === result.section);
      if (chunk === undefined) continue;

      const flat = flattenWithMap(chunk.content, true);
      const rawSpans = locateSpans(chunk.content, terms);
      const flatStarts = rawSpans
        .map((s) => toFlatOffset(flat, s.start))
        .filter((offset) => offset < flat.text.length);

      if (flatStarts.length === 0) {
        withNoLexicalMatch++;
        continue;
      }
      const earliest = Math.min(...flatStarts);
      if (earliest <= SUPPORTING_EXCERPT_CHARS) {
        withinBudget++;
      } else {
        pastBudget++;
        pastBudgetSamples.push({ query, path: result.path, earliest });
      }
    }
  }

  console.log(`Total non-lead results measured: ${totalSupporting}`);
  console.log(`  No lexical match at all: ${withNoLexicalMatch}`);
  console.log(`  Earliest match within ${SUPPORTING_EXCERPT_CHARS} chars: ${withinBudget}`);
  console.log(`  Earliest match PAST ${SUPPORTING_EXCERPT_CHARS} chars: ${pastBudget}`);
  const measured = withinBudget + pastBudget;
  const fraction = measured === 0 ? 0 : pastBudget / measured;
  console.log(
    `  Fraction past budget (of results WITH a lexical match): ${(fraction * 100).toFixed(1)}%`,
  );
  if (pastBudgetSamples.length > 0) {
    console.log("\nSamples past budget:");
    for (const s of pastBudgetSamples) {
      console.log(`  query="${s.query}" path=${s.path} earliestOffset=${s.earliest}`);
    }
  }
  console.log(
    `\nReopen trigger: fraction past budget > 50%. Measured: ${(fraction * 100).toFixed(1)}% -> ${
      fraction > 0.5 ? "TRIGGERED (reopen as follow-up)" : "not triggered (decision stands)"
    }`,
  );
} finally {
  store.close();
}
