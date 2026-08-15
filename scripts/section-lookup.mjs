/**
 * Gate 1 measurement (design.md Decision 6, read-doc-fence-aware-sections).
 *
 * `read_doc` is MCP-only — `cli.ts` registers `index`, `sync`, `index-md`,
 * `search`, `overview`, `eval`, `serve`, no `read` — so this script drives
 * `ReadDocument` directly, following the `scripts/vector-reach.mjs`
 * precedent: import from `dist/`, no production surface widened for a
 * one-off gate.
 *
 * No embeddings, no model download: it constructs `SqliteIndexStore` and
 * `ReadDocument` only. (Sanity check for readers: neither import below is
 * `TransformersEmbeddings` — confirming the "no model download" dependency
 * claim design.md and the proposal both make for this gate.)
 *
 * Usage:
 *   node scripts/section-lookup.mjs <root> "<path>" "<section>"
 *
 * `<root>` is the project root whose `.compendio/compendio.db` was already
 * built by `node dist/cli.js index --lexical` (or `--root <root> index
 * --lexical` from elsewhere). `<path>` is the already-indexed, root-alias-
 * prefixed document path (e.g. `docs/documentation-convention.md`).
 *
 * Output:
 *   - The `ReadResult` discriminant (`document` / `section` / `path-not-found`
 *     / `section-not-found` / `no-sections`).
 *   - For `type: "section"`: the stored `heading` of every matched chunk
 *     (matched chunks are identified by substring — `ReadDocument.execute`
 *     joins each matching chunk's own `content` verbatim with `"\n\n"`, so a
 *     chunk whose content is contained in the returned `content` is exactly
 *     the set of chunks that matched), a leading excerpt of each, and each
 *     matched chunk's fence-delimiter-line count (Task 2.2 — computed with
 *     the exported `isFenceDelimiter`, a direct measurement rather than an
 *     assumed one, since this is exactly what the balanced-delimiter guard
 *     (design.md Decision 3) reads to decide whether to suppress a heading
 *     inside that chunk).
 *   - For `type: "section-not-found"`: the full sorted `availableSections`
 *     list, with a count.
 *
 * The one asserted self-check (Decision 6, mirroring `vector-reach.mjs`'s
 * monotonicity self-check — a manual gate that can only be read by eye is a
 * manual gate that gets misread): when the result is `type: "section"` and
 * NO matched chunk's stored `heading` (normalized) contains the requested
 * section (normalized), this is the defect's exact shape — a match that came
 * only from a line inside the chunk's *content* (potentially a fenced,
 * phantom heading) rather than from the chunk's own real heading — and the
 * script prints a clearly-marked failure banner and exits non-zero. This is
 * deliberately NOT achieved by exporting `headingsIn` from
 * `read-document.ts` to call directly (design.md Decision 6, "Rejected") —
 * `availableSections` and the matched-chunk-heading check above already
 * expose every phantom without widening production surface for this gate.
 */
import { resolve } from "node:path";
import { ReadDocument } from "../dist/application/read-document.js";
import { isFenceDelimiter } from "../dist/domain/split-text.js";
import { normalize } from "../dist/domain/similarity.js";
import { SqliteIndexStore } from "../dist/infrastructure/sqlite/sqlite-index-store.js";

const [, , rootArg, pathArg, sectionArg] = process.argv;
if (rootArg === undefined || pathArg === undefined || sectionArg === undefined) {
  console.error('usage: node scripts/section-lookup.mjs <root> "<path>" "<section>"');
  process.exit(1);
}

const root = resolve(rootArg);
const dbPath = resolve(root, ".compendio/compendio.db");
const store = new SqliteIndexStore(dbPath);

try {
  const read = new ReadDocument(store);
  const result = read.execute({ path: pathArg, section: sectionArg });

  console.log(`Result type: ${result.type}`);

  if (result.type === "section") {
    const doc = store.getDocumentByPath(pathArg);
    const allChunks = doc === null ? [] : store.getChunksByDocument(doc.id);
    const matchedChunks = allChunks.filter((c) => result.content.includes(c.content));

    console.log(`\nMatched ${matchedChunks.length} chunk(s):\n`);
    const wanted = normalize(sectionArg);
    let anyHeadingMatches = false;
    for (const chunk of matchedChunks) {
      const delimiterCount = chunk.content.split("\n").filter(isFenceDelimiter).length;
      const headingMatches = normalize(chunk.heading).includes(wanted);
      if (headingMatches) anyHeadingMatches = true;
      console.log(`- chunk ${chunk.id}`);
      console.log(`  heading: "${chunk.heading}" (matches requested section: ${headingMatches})`);
      console.log(`  fence-delimiter-line count: ${delimiterCount}`);
      console.log(`  content (leading 200 chars): ${chunk.content.slice(0, 200).replace(/\n/g, "\\n")}`);
    }

    if (!anyHeadingMatches) {
      console.error(`\n${"!".repeat(70)}`);
      console.error("SELF-CHECK FAILED: the result resolved to type \"section\", but no");
      console.error("matched chunk's OWN stored heading matches the requested section.");
      console.error("The match came only from a line inside chunk CONTENT — the exact");
      console.error("shape of the fence-blindness defect this gate exists to catch.");
      console.error("See design.md Decision 6 / read-doc-fence-aware-sections.");
      console.error("!".repeat(70));
      process.exit(1);
    }
  } else if (result.type === "section-not-found") {
    const sorted = [...result.availableSections].sort();
    console.log(`\navailableSections (${sorted.length}):`);
    for (const name of sorted) {
      console.log(`- ${name}`);
    }
  } else if (result.type === "path-not-found") {
    console.log(`\nsuggestions: ${result.suggestions.join(", ")}`);
  } else if (result.type === "no-sections") {
    console.log(`\nno sections at all for "${result.section}"`);
  } else {
    console.log(`\n(document result — ${result.content.length} chars)`);
  }
} finally {
  store.close();
}
