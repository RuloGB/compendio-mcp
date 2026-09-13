/**
 * R6 (design.md revision 1): the manual stress probe for `read_doc`'s
 * outline. Moved here from `openspec/changes/read-doc-large-outline/` once
 * R1-R5 landed -- see `docs/manual-gates.md`'s "Outline stress probe" gate
 * for the exact command and budgets.
 *
 * Repo root is resolved from `import.meta.url` (never a hardcoded absolute
 * path, unlike the change-folder scratch version this replaces), and the
 * synthetic bench corpus lives under `os.tmpdir()` (never `process.cwd()`),
 * so this script runs unmodified on any checkout.
 *
 * No production code is modified to build this: it imports the compiled
 * output from `dist/`. Build first (`npm run build`), then run with
 * `node scripts/outline-stress-probe.mjs`, never a bare `compendio`
 * (AGENTS.md's manual-gates policy).
 *
 * Exits non-zero when any shape/size breaks the 2,300-estimated-token budget,
 * renders an outline that is not smaller than its document, serves a document
 * above the outline threshold whole, or fails to complete (OOM/throw) -- R4/R6's acceptance gate, not just an
 * observational report.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const { createContainer } = await import(pathToFileURL(join(repoRoot, "dist/composition.js")).href);
const { formatReadResult } = await import(pathToFileURL(join(repoRoot, "dist/server.js")).href);
const { OUTLINE_THRESHOLD_TOKENS } = await import(
  pathToFileURL(join(repoRoot, "dist/application/read-document.js")).href
);

const TOKEN_BUDGET = 2300;

const para = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore.";

// a) API reference: 20 H2 groups, N unique H3 entries, short bodies.
function apiRef(n) {
  let s = "# API reference\n\n";
  const perGroup = Math.ceil(n / 20);
  for (let i = 0; i < n; i++) {
    if (i % perGroup === 0) s += `## Module ${i / perGroup}\n\n${para}\n\n`;
    s += `### function_${i}()\n\n${para} ${para}\n\n`;
  }
  return s;
}
// b) flat: N unique H2, short bodies.
function flat(n) {
  let s = "# Flat\n\n";
  for (let i = 0; i < n; i++) s += `## Entry number ${i}\n\n${para} ${para}\n\n`;
  return s;
}
// c) changelog: n/3 versions, each "### Added/Fixed/Changed" (identical
// titles, R1's `repeated` group).
function changelog(n) {
  let s = "# Changelog\n\n";
  for (let v = 0; v < Math.ceil(n / 3); v++) {
    s += `## 1.${v}.0\n\n`;
    for (const t of ["Added", "Fixed", "Changed"]) s += `### ${t}\n\n- ${para}\n- ${para}\n\n`;
  }
  return s;
}

const shapes = { apiRef, flat, changelog };
const sizes = [105, 500, 1000, 2000, 5000];
const base = join(mkdtempSync(join(tmpdir(), "compendio-outline-probe-")), "bench-root");

let failed = false;

console.log("shape      headings  docTokens  level        rows(top)  execMs(med of 3)  outlineTokens  status");
for (const [name, gen] of Object.entries(shapes)) {
  for (const n of sizes) {
    rmSync(base, { recursive: true, force: true });
    mkdirSync(join(base, "docs"), { recursive: true });
    writeFileSync(join(base, "compendio.config.json"), JSON.stringify({ docsDir: ["docs"] }));
    writeFileSync(join(base, "docs", "big.md"), gen(n));
    const c = createContainer({ root: base, forceLexical: true });
    let status = "ok";
    let docTokens = "-";
    let level = "-";
    let rows = "-";
    let outlineTokens = "-";
    let execMs = "-";
    try {
      await c.indexDocuments.execute();
      const times = [];
      let r;
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        r = c.readDocument.execute({ path: "docs/big.md" });
        times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      execMs = times[1].toFixed(1);
      const text = formatReadResult(r);
      docTokens = r.tokens ?? Math.ceil((r.content ?? "").length / 4);
      // design.md's "Level": `full` / `subheadings` / `truncated` for an
      // outline, `document` when the body is served whole.
      level = r.type === "outline" ? (r.omitted.kind === "none" ? "full" : r.omitted.kind) : r.type;
      rows = r.sections?.length ?? "-";
      outlineTokens = Math.ceil(text.length / 4);
      // Every probe shape has 2+ addressable headings, so above the threshold
      // a whole-body response means the outline gate regressed, and that
      // response has no size bound at all.
      if (docTokens > OUTLINE_THRESHOLD_TOKENS && r.type !== "outline") {
        status = `FAIL (served whole above ${String(OUTLINE_THRESHOLD_TOKENS)} tokens)`;
        failed = true;
      } else if (r.type === "outline" && outlineTokens > TOKEN_BUDGET) {
        status = `FAIL (>${TOKEN_BUDGET} tokens)`;
        failed = true;
      } else if (r.type === "outline" && outlineTokens >= docTokens) {
        status = `FAIL (outline not smaller than the document)`;
        failed = true;
      }
    } catch (err) {
      status = `FAIL (threw: ${err instanceof Error ? err.message : String(err)})`;
      failed = true;
    } finally {
      c.close();
    }
    console.log(
      `${name.padEnd(10)} ${String(n).padStart(8)}  ${String(docTokens).padStart(9)}  ${level.padEnd(11)}  ` +
        `${String(rows).padStart(9)}  ${String(execMs).padStart(16)}  ${String(outlineTokens).padStart(13)}  ${status}`,
    );
  }
}
rmSync(base, { recursive: true, force: true });

if (failed) {
  console.error("\nOne or more shapes/sizes broke the outline stress budget -- see FAIL rows above.");
  process.exit(1);
}
console.log("\nAll shapes/sizes stayed within budget.");
