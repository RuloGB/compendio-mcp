/**
 * Gate 1 measurement for `excerpt-fence-drop-generalization` (design.md D6).
 *
 * Follows the `excerpt-flatten-probe.mjs` / `section-lookup.mjs` precedent:
 * imports compiled `dist/`, widens no production surface, downloads no
 * model. Deliberately imports ONLY `flattenWithMap` and `SqliteIndexStore` —
 * no `isFenceDelimiter`. S2 is not predicate-driven the way S1 is, so a
 * probe that imported the fence-delimiter predicate would quietly imply
 * otherwise.
 *
 * Usage:
 *   node dist/cli.js --root <root> index --lexical
 *   node scripts/excerpt-fence-drop-probe.mjs <root>
 *
 * `<root>` is the project root whose `.compendio/compendio.db` was already
 * built. Against `test/fixtures/excerpt-fence-drop`, this is Gate 1. Against
 * `test/fixtures/excerpt-window` (a corpus known to contain no fences at
 * all), this is Gate 1b — the anti-vacuity guard proved against a known-
 * empty corpus.
 *
 * What it counts, over every chunk of every document in the target
 * database:
 *
 *   C1 — chunks whose flattenWithMap(content, true).text still contains
 *        "~~~". Gate 1: > 0 before the fix, 0 after.
 *   C2 — chunks whose raw content contains a "~~~" line at all. The
 *        anti-vacuity denominator: must be > 0 in BOTH tree states, or the
 *        corpus has nothing to falsify against.
 *   C3 — chunks with >= 2 fence delimiter runs (backtick or tilde) whose
 *        `true` output is byte-identical to their `false` output. Gate 2 at
 *        corpus level: > 0 before the fix, 0 after.
 *   C4 — whether the two *-crlf.md documents' STORED chunk content contains
 *        "\r\n". Stronger than checking the file on disk — it proves CRLF
 *        survived decode-text.ts, the parser and chunking.
 *   C5 — control-backtick-fence.md's `true` output, printed verbatim.
 *        Reported, not gated — the before/after diff lives in
 *        verify-report.md, since one run cannot compare itself to another.
 *
 * Asserted self-check: exits non-zero UNLESS C2 > 0 AND C4 holds AND
 * C1 === 0 AND C3 === 0. Two distinct failure messages, deliberately not
 * conflated: a C2/C4 failure means the gate is vacuous (fix the corpus, do
 * not touch the regex); a C1/C3 failure means the fix has not landed (or
 * has regressed).
 */
import { resolve } from "node:path";
import { flattenWithMap } from "../dist/domain/flatten-map.js";
import { SqliteIndexStore } from "../dist/infrastructure/sqlite/sqlite-index-store.js";

const CRLF_DOC_SUFFIX = "-crlf.md";
const CONTROL_DOC_PATH = "docs/control-backtick-fence.md";

const [, , rootArg] = process.argv;
if (rootArg === undefined) {
  console.error("usage: node scripts/excerpt-fence-drop-probe.mjs <root>");
  process.exit(1);
}

const root = resolve(rootArg);
const dbPath = resolve(root, ".compendio/compendio.db");
const store = new SqliteIndexStore(dbPath);

let c1 = 0; // chunks whose `true` pass still contains "~~~"
let c2 = 0; // chunks whose raw content contains a "~~~" line at all
let c3 = 0; // chunks with >= 2 fence-delimiter runs whose true/false passes are byte-identical
let c4Total = 0; // number of *-crlf.md documents inspected for C4
let c4WithCrlf = 0; // of those, number whose stored content contains "\r\n"
let c5 = null; // control-backtick-fence.md's `true` pass, printed verbatim

const documents = store.listDocuments();
try {
  for (const document of documents) {
    const isCrlfDoc = document.path.endsWith(CRLF_DOC_SUFFIX);
    const chunks = store.getChunksByDocument(document.id);

    if (isCrlfDoc) {
      c4Total++;
      const anyChunkHasCrlf = chunks.some((chunk) => chunk.content.includes("\r\n"));
      if (anyChunkHasCrlf) c4WithCrlf++;
    }

    for (const chunk of chunks) {
      const raw = chunk.content;
      const passTrue = flattenWithMap(raw, true).text;
      const passFalse = flattenWithMap(raw, false).text;

      if (passTrue.includes("~~~")) c1++;

      const rawLines = raw.split("\n");
      const hasTildeLine = rawLines.some((line) => /^\s*~~~/.test(line));
      if (hasTildeLine) c2++;

      const delimiterRunCount = rawLines.filter((line) => /^\s*(```|~~~)/.test(line)).length;
      if (delimiterRunCount >= 2 && passTrue === passFalse) c3++;

      if (document.path === CONTROL_DOC_PATH) {
        c5 = passTrue;
      }
    }
  }
} finally {
  store.close();
}

const c4Holds = c4Total > 0 && c4WithCrlf === c4Total;

console.log(`Documents scanned: ${documents.length}`);
console.log(`C1 (chunks where "true" pass still contains "~~~"): ${c1}`);
console.log(`C2 (chunks whose raw content contains a "~~~" line): ${c2}`);
console.log(`C3 (chunks with >=2 delimiter runs, true === false): ${c3}`);
console.log(
  `C4 (*-crlf.md stored chunk content contains "\\r\\n"): ${c4WithCrlf}/${c4Total} — holds: ${c4Holds}`,
);
console.log(
  `C5 (${CONTROL_DOC_PATH}'s "true" pass, verbatim): ${c5 === null ? "(document not found)" : JSON.stringify(c5)}`,
);

const vacuous = c2 === 0 || !c4Holds;
const fixNotLanded = c1 > 0 || c3 > 0;

let selfCheckFailed = false;
if (vacuous) {
  selfCheckFailed = true;
  console.error(`\n${"!".repeat(70)}`);
  console.error("GATE IS VACUOUS — fix the corpus, do not touch the regex.");
  console.error(
    `Reason: ${c2 === 0 ? "C2 === 0 (no tilde-fence line in the corpus)" : ""}${
      c2 === 0 && !c4Holds ? " and " : ""
    }${!c4Holds ? "C4 does not hold (CRLF did not survive into stored chunk content)" : ""}`,
  );
  console.error("!".repeat(70));
} else if (fixNotLanded) {
  selfCheckFailed = true;
  console.error(`\n${"!".repeat(70)}`);
  console.error("THE FIX DID NOT LAND.");
  console.error(
    `Reason: ${c1 > 0 ? `C1 = ${c1} (a "~~~" fence still survives the excluded pass)` : ""}${
      c1 > 0 && c3 > 0 ? " and " : ""
    }${c3 > 0 ? `C3 = ${c3} (excluded pass still byte-identical to included pass for a >=2-delimiter chunk)` : ""}`,
  );
  console.error("!".repeat(70));
}

if (selfCheckFailed) process.exit(1);
