/**
 * Gate 1 measurement (design.md Decision-below-D5, `excerpt-fence-aware-flatten`).
 *
 * Follows the `scripts/section-lookup.mjs` / `scripts/vector-reach.mjs`
 * precedent: import compiled output from `dist/`, no production surface
 * widened for a one-off gate, no model download (only `flattenWithMap` /
 * `buildExcerpt` / `isFenceDelimiter` and `SqliteIndexStore` are imported —
 * none of them touch `TransformersEmbeddings`).
 *
 * Usage:
 *   node dist/cli.js --root . index --lexical
 *   node scripts/excerpt-flatten-probe.mjs <root>
 *
 * `<root>` is the project root whose `.compendio/compendio.db` was already
 * built by `index --lexical`. This script targets this repository's own
 * `docs/documentation-convention.md`, "12. Templates" chunk — the live case
 * design.md's Flow notes and exploration.md §0b traced by hand.
 *
 * Gate 1, two checks against the STORED chunk (not a hand-extracted
 * section — exploration §0b's whole point was that the two can diverge):
 *   1. `dropFencedBlocks: true` is 0 chars (the fallback at excerpt.ts:68
 *      fires) — BOTH before and after this change, since the fix does not
 *      change WHICH pass produces the excerpt (design.md Flow notes).
 *   2. `dropFencedBlocks: false` contains "Business rules", "Use cases" and
 *      "Out of scope" — false before this change (S1 dropped every
 *      heading-pattern line unconditionally, fence-interior or not), true
 *      after.
 *
 * `buildExcerpt()` on the stored chunk is also printed, informationally —
 * called with NO spans (today's prefix path, design.md Decision 6), it is
 * NOT expected to contain the three phrases: they sit ~1000 chars into the
 * flattened text, well past the 120-char supporting budget's prefix window.
 * The real end-to-end proof — a MATCHED span centring the window on the
 * phrases — is task 4.5's live `search --lexical` run, not this script.
 *
 * The one asserted self-check: exits non-zero unless pass 1 is 0 chars AND
 * pass 2 contains all three phrases — this is what makes the script red
 * today (before the fix) and green after, rather than a report nobody has
 * to read.
 *
 * D5's M2 scan (measurement only, no pass/fail): over every stored chunk in
 * the database, count `#`-lines that are fence-interior (per
 * `isFenceDelimiter`, balanced chunks only — an unbalanced chunk's fence
 * state is never trusted, matching `stripHeadingLines`) AND carry an ODD
 * number of backticks — the shape that can break S2's
 * `/```[^`]*```/g` pairing (Gate 4's mechanism). Explicitly excludes
 * non-fence-interior `#`-lines carrying a backtick: exploration.md §0b named
 * this exact trap — a naive "any `#`-line with a backtick" filter returns 4
 * false hits on this repo's own corpus, all outside any fence and all
 * carrying an even backtick count.
 */
import { resolve } from "node:path";
import { buildExcerpt } from "../dist/domain/excerpt.js";
import { flattenWithMap } from "../dist/domain/flatten-map.js";
import { isFenceDelimiter } from "../dist/domain/split-text.js";
import { SqliteIndexStore } from "../dist/infrastructure/sqlite/sqlite-index-store.js";

const TARGET_PATH = "docs/documentation-convention.md";
const TARGET_HEADING_SUBSTRING = "Templates";
const REQUIRED_PHRASES = ["Business rules", "Use cases", "Out of scope"];

const [, , rootArg] = process.argv;
if (rootArg === undefined) {
  console.error("usage: node scripts/excerpt-flatten-probe.mjs <root>");
  process.exit(1);
}

const root = resolve(rootArg);
const dbPath = resolve(root, ".compendio/compendio.db");
const store = new SqliteIndexStore(dbPath);

let selfCheckFailed = false;

try {
  const doc = store.getDocumentByPath(TARGET_PATH);
  if (doc === null) {
    console.error(`Document not found in the index: ${TARGET_PATH}`);
    console.error("Did you run: node dist/cli.js --root . index --lexical ?");
    process.exit(1);
  }

  const chunks = store.getChunksByDocument(doc.id);
  const target = chunks.find((c) => c.heading.includes(TARGET_HEADING_SUBSTRING));
  if (target === undefined) {
    console.error(`No chunk of ${TARGET_PATH} has a heading containing "${TARGET_HEADING_SUBSTRING}"`);
    console.error(`Headings present: ${chunks.map((c) => c.heading).join(" | ")}`);
    process.exit(1);
  }

  console.log(`Target chunk ${target.id} — heading: "${target.heading}"`);
  console.log(`Stored content length: ${target.content.length} chars`);

  const passTrue = flattenWithMap(target.content, true).text;
  const passFalse = flattenWithMap(target.content, false).text;
  const excerpt = buildExcerpt(target.content);

  console.log(`\ndropFencedBlocks: true  -> ${passTrue.length} chars`);
  console.log(`dropFencedBlocks: false -> ${passFalse.length} chars`);
  console.log(`buildExcerpt() -> ${excerpt.length} chars: ${JSON.stringify(excerpt)}`);

  const pass1Empty = passTrue.length === 0;
  const phrasesInPass2 = REQUIRED_PHRASES.filter((p) => passFalse.includes(p));
  const phrasesInExcerpt = REQUIRED_PHRASES.filter((p) => excerpt.includes(p));

  console.log(`\nPass 1 (dropFencedBlocks: true) is 0 chars: ${pass1Empty}`);
  console.log(
    `Phrases present in pass 2 (dropFencedBlocks: false): ${phrasesInPass2.length}/${REQUIRED_PHRASES.length} — ${phrasesInPass2.join(", ") || "(none)"}`,
  );
  console.log(
    `Phrases present in buildExcerpt() output (informational — no spans, prefix path): ` +
      `${phrasesInExcerpt.length}/${REQUIRED_PHRASES.length} — ${phrasesInExcerpt.join(", ") || "(none)"}`,
  );

  if (!pass1Empty || phrasesInPass2.length !== REQUIRED_PHRASES.length) {
    selfCheckFailed = true;
    console.error(`\n${"!".repeat(70)}`);
    console.error("SELF-CHECK FAILED: Gate 1 requires pass 1 to stay 0 chars (proof S2");
    console.error("still recognizes and drops the four fences) AND all three phrases to");
    console.error("appear in pass 2. See design.md's Flow notes and exploration.md §0b.");
    console.error("!".repeat(70));
  }

  // D5's M2 scan — measurement only, over every stored chunk in the DB.
  console.log("\n--- D5 M2 scan: fence-interior heading lines with an odd backtick count ---");
  let totalFenceInteriorHeadingLines = 0;
  let totalOddBacktickFenceInteriorLines = 0;
  const documents = store.listDocuments();
  for (const document of documents) {
    for (const chunk of store.getChunksByDocument(document.id)) {
      const lines = chunk.content.split("\n");
      const balanced = lines.filter(isFenceDelimiter).length % 2 === 0;
      if (!balanced) continue;
      let inFence = false;
      for (const line of lines) {
        if (isFenceDelimiter(line)) {
          inFence = !inFence;
          continue;
        }
        if (!inFence) continue;
        if (!/^\s*#{1,6}\s/.test(line)) continue;
        totalFenceInteriorHeadingLines++;
        const backtickCount = (line.match(/`/g) ?? []).length;
        if (backtickCount % 2 === 1) {
          totalOddBacktickFenceInteriorLines++;
          console.log(`  odd-backtick hit: ${document.path} chunk ${chunk.id}: ${JSON.stringify(line)}`);
        }
      }
    }
  }
  console.log(`\nFence-interior heading-pattern lines (balanced chunks only): ${totalFenceInteriorHeadingLines}`);
  console.log(`Of those, with an odd backtick count: ${totalOddBacktickFenceInteriorLines}`);
  console.log("(Measurement only — no pass/fail. See design.md Decision 5.)");
} finally {
  store.close();
}

if (selfCheckFailed) process.exit(1);
