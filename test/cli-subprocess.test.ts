import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Subprocess-level tests for the shipped CLI.
 *
 * Every other test in this suite imports modules directly, which leaves the
 * real entry path — `node dist/cli.js` — unverified. That gap already cost us
 * once: an entry-point guard compared `resolve(process.argv[1])` against
 * `fileURLToPath(import.meta.url)`. Node resolves symlinks for
 * `import.meta.url` but NOT for `process.argv[1]`, so under `npx compendio` or
 * a global install (npm installs `bin` entries as symlinks) the guard was
 * false and the CLI exited 0 having done nothing. The whole suite stayed green.
 *
 * These tests exercise `dist/`, not `src/`, because the symlink resolution
 * being guarded is a property of the published artifact.
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST_DIR = join(REPO_ROOT, "dist");
const CLI = join(DIST_DIR, "cli.js");
const FIXTURE = join(REPO_ROOT, "test", "fixtures", "strict");

/** Most recent mtime under `dir`, used to detect a stale `dist/`. */
function newestMtimeMs(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtimeMs(full) : statSync(full).mtimeMs);
  }
  return newest;
}

/**
 * Build on demand rather than behind an opt-in script: the regression this
 * file guards ships to users, and `prepublishOnly` runs `npm test`, so the
 * check has to be in the default suite to be worth anything. The staleness
 * comparison keeps the warm-run cost at one `readdir` sweep; only a changed
 * `src/` pays for `tsc`. Invoked through `node node_modules/typescript/bin/tsc`
 * instead of `npm run build` to avoid the npm/npm.cmd shell split on Windows.
 */
function ensureBuilt(): void {
  if (existsSync(CLI) && statSync(CLI).mtimeMs >= newestMtimeMs(join(REPO_ROOT, "src"))) return;
  execFileSync(process.execPath, [join(REPO_ROOT, "node_modules", "typescript", "bin", "tsc")], {
    cwd: REPO_ROOT,
    stdio: "pipe",
  });
}

/**
 * `env` merges ON TOP of `process.env` (never replaces it) — a bare
 * `{ COMPENDIO_PROGRESS }` would drop `PATH` and break the spawn on Windows.
 */
function runCli(
  args: string[],
  entry: string = CLI,
  env?: Record<string, string | undefined>,
): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [entry, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

let workdir: string;
let indexRun: SpawnSyncReturns<string>;

beforeAll(() => {
  ensureBuilt();
  workdir = mkdtempSync(join(tmpdir(), "compendio-cli-"));
  // Copy the corpus out of the repo: `index` writes `.compendio/compendio.db`
  // next to the config, and the fixture must stay pristine.
  cpSync(join(FIXTURE, "docs"), join(workdir, "docs"), { recursive: true });
  cpSync(join(FIXTURE, "compendio.config.json"), join(workdir, "compendio.config.json"));
  // `--lexical` throughout: the real embeddings provider would download a model
  // on first use. Lexical mode keeps these tests hermetic and offline.
  indexRun = runCli(["--root", workdir, "index", "--lexical"]);
}, 120_000);

afterAll(() => {
  if (workdir !== undefined) rmSync(workdir, { recursive: true, force: true });
});

describe("CLI subprocess: basic contract", () => {
  it("--version exits 0 and prints the version declared in package.json", () => {
    const run = runCli(["--version"]);
    expect(run.status).toBe(0);

    // The shipped binary must report the real version, not merely something
    // version-shaped: it was hardcoded to "0.1.0" against a published 0.1.2 for
    // several releases. This runs the compiled `dist/` entry point, so it also
    // covers the emitted layout's `../package.json` resolution — the unit test
    // in server.test.ts exercises the `src/` path only.
    const manifest = new URL("../package.json", import.meta.url);
    const { version } = JSON.parse(readFileSync(manifest, "utf8")) as { version: string };
    expect(run.stdout.trim()).toBe(version);
  });

  it("--help exits 0 and lists the commands", () => {
    const run = runCli(["--help"]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("compendio");
    for (const command of ["index", "index-md", "search", "overview", "eval", "serve"]) {
      expect(run.stdout).toContain(command);
    }
  });

  it("exits non-zero on an unknown command", () => {
    const run = runCli(["--root", workdir, "noexiste"]);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("unknown command");
  });
});

describe("CLI subprocess: corpus commands", () => {
  it("index exits 0 and reports the indexed documents", () => {
    expect(indexRun.status).toBe(0);
    // The fixture ships 5 documents; INDEX.md is excluded by the indexer.
    expect(indexRun.stdout).toMatch(/Indexed 5 documents \(\d+ chunks\)/);
  });

  it("search exits 0 and writes parseable JSON to stdout", () => {
    const run = runCli(["--root", workdir, "search", "onboarding a new service", "--lexical"]);
    expect(run.status).toBe(0);
    const payload = JSON.parse(run.stdout) as { mode: string; results: { path: string }[] };
    expect(payload.mode).toBe("lexical");
    expect(payload.results.length).toBeGreaterThan(0);
    expect(payload.results.map((r) => r.path)).toContain("guide-service-onboarding.md");
  });

  it("excludedStatuses deny-list: a draft document is hidden by default and surfaced with --all", () => {
    // The fixture declares excludedStatuses: ["draft", "deprecated"] and
    // ships test-plan-inventory-alerts.md in status draft specifically to
    // exercise this deny-list. "test plan" is unique to that document
    // within the fixture (checked against the other 4 docs' prose).
    const denied = runCli(["--root", workdir, "search", "inventory alerts test plan", "--lexical"]);
    expect(denied.status).toBe(0);
    const deniedPayload = JSON.parse(denied.stdout) as { results: { path: string }[] };
    expect(deniedPayload.results.map((r) => r.path)).not.toContain("test-plan-inventory-alerts.md");

    const allowed = runCli([
      "--root",
      workdir,
      "search",
      "inventory alerts test plan",
      "--lexical",
      "--all",
    ]);
    expect(allowed.status).toBe(0);
    const allowedPayload = JSON.parse(allowed.stdout) as { results: { path: string }[] };
    expect(allowedPayload.results.map((r) => r.path)).toContain("test-plan-inventory-alerts.md");
  });
});

describe("CLI subprocess: index progress reporting", () => {
  // `spawnSync` gives the child no TTY (stdio defaults to "pipe"), so
  // COMPENDIO_PROGRESS is what makes every mode reachable under a pipe.
  it("COMPENDIO_PROGRESS=none: stderr carries no progress output", () => {
    const run = runCli(["--root", workdir, "index", "--lexical"], CLI, { COMPENDIO_PROGRESS: "none" });
    expect(run.status).toBe(0);
    // --lexical still emits the pre-existing embeddingsWarning on stderr —
    // that WARNING line is unrelated to progress reporting. What "none"
    // guarantees is the ABSENCE of progress-shaped text.
    expect(run.stderr).not.toContain("Indexing");
    expect(run.stderr).not.toMatch(/\[\d+\/\d+\]/);
    expect(run.stderr).not.toContain("\r");
  });

  it("COMPENDIO_PROGRESS=plain: stderr shows 'Indexing N documents' and [i/N]-shaped ticks, no \\r", () => {
    const run = runCli(["--root", workdir, "index", "--lexical"], CLI, { COMPENDIO_PROGRESS: "plain" });
    expect(run.status).toBe(0);
    expect(run.stderr).toContain("Indexing 5 documents");
    expect(run.stderr).toMatch(/\[1\/5\]/);
    expect(run.stderr).not.toContain("\r");
  });

  it("stdout is identical across none/plain/bar modes, modulo the pre-existing real duration figure", () => {
    const none = runCli(["--root", workdir, "index", "--lexical"], CLI, { COMPENDIO_PROGRESS: "none" });
    const plain = runCli(["--root", workdir, "index", "--lexical"], CLI, { COMPENDIO_PROGRESS: "plain" });
    const bar = runCli(["--root", workdir, "index", "--lexical"], CLI, { COMPENDIO_PROGRESS: "bar" });
    expect(none.status).toBe(0);
    expect(plain.status).toBe(0);
    expect(bar.status).toBe(0);
    expect(none.stdout).toMatch(/Indexed 5 documents \(\d+ chunks\)/);
    // `report.durationMs` is a real wall-clock measurement, not a progress
    // concern: it already varied between separate runs before this change.
    // Normalize it out so this test asserts what "stdout is byte-for-byte
    // identical across modes" actually means: the reporting mode changes
    // nothing about stdout's shape or content. This tiny 5-document fixture
    // never crosses the bar's 5 s anti-flash threshold, so bar mode never
    // draws here either -- irrelevant to this assertion, since stdout is
    // never touched by the sink regardless of whether it draws.
    const normalize = (stdout: string): string => stdout.replace(/in \d+ ms/, "in N ms");
    expect(normalize(plain.stdout)).toBe(normalize(none.stdout));
    expect(normalize(bar.stdout)).toBe(normalize(none.stdout));
  });

  /**
   * `bar` mode is additionally gated by `BAR_MIN_ELAPSED_MS` (5 s of real
   * elapsed run time) — a deliberate anti-flash gate (design decision D3),
   * not just a mode-selection concern. `COMPENDIO_PROGRESS=bar` makes the
   * renderer reachable under a pipe (proposal's stated fix for the
   * exploration's TTY-detection gap), but crossing the *time* gate is a
   * property of real wall-clock duration, which this suite cannot control
   * deterministically the way `test/infrastructure/progress-sink.test.ts`
   * does with an injected fake clock (that file already covers this exact
   * branch, deterministically, for every case: sub-threshold silence,
   * first-frame-shows-accumulated-state, and the erase on `finish()`).
   *
   * This test still attempts a REAL, non-deterministic end-to-end
   * confirmation: index a large synthetic corpus (many small files — file
   * count, not content size, is what drives wall time here per the
   * IndexDocuments per-file loop) and check whether the real run crossed the
   * threshold. On a slow enough disk/CPU it does, and `\r` must appear. On
   * an unusually fast machine the run may finish under 5 s despite ~4 000
   * files, in which case the environment cannot exercise this path at all —
   * exactly the pattern this suite already uses for symlink-unavailable
   * platforms below (`ctx.skip(...)`), not a false pass.
   */
  it("COMPENDIO_PROGRESS=bar: stderr contains \\r once a real run crosses the 5 s threshold", (ctx) => {
    const bigDir = mkdtempSync(join(tmpdir(), "compendio-bar-corpus-"));
    const bigDocs = join(bigDir, "docs");
    mkdirSync(bigDocs, { recursive: true });
    const FILE_COUNT = 4_000;
    for (let i = 0; i < FILE_COUNT; i++) {
      writeFileSync(
        join(bigDocs, `doc${i}.md`),
        `# Doc ${i}\n\nSynthetic body text for document number ${i}, sized only to force real ` +
          `per-file indexing work across enough files to cross the anti-flash threshold.\n`,
      );
    }

    try {
      const run = runCli(["--root", bigDir, "index", "--lexical"], CLI, { COMPENDIO_PROGRESS: "bar" });
      expect(run.status).toBe(0);
      const durationMatch = /in (\d+) ms/.exec(run.stdout);
      const durationMs = durationMatch !== null ? Number(durationMatch[1]) : 0;
      if (durationMs < 5_000) {
        ctx.skip(
          `this machine indexed ${FILE_COUNT} files in ${durationMs} ms, under the 5 000 ms ` +
            "anti-flash threshold -- too fast on this environment to exercise the bar redraw " +
            "end-to-end. The exact same code path is covered deterministically with a fake " +
            "clock in test/infrastructure/progress-sink.test.ts.",
        );
        return;
      }
      expect(run.stderr).toContain("\r");
    } finally {
      rmSync(bigDir, { recursive: true, force: true });
    }
  }, 30_000);
});

/**
 * Creates a link through which `dist/cli.js` can be invoked, mirroring how the
 * `bin` entry is installed. Returns the reason instead of throwing so the test
 * can report an explicit skip rather than passing silently.
 */
let linkCounter = 0;

function linkToCli(dir: string): { cli: string } | { unavailable: string } {
  // Unique per call: a link path that already exists fails with EEXIST, which
  // would surface as an unrelated "unavailable" skip.
  const linkPath = join(dir, `linked-bin-${(linkCounter += 1)}`);
  try {
    if (process.platform === "win32") {
      // A directory junction, not a symlink: file symlinks on Windows need
      // elevation or Developer Mode, junctions do not. It reproduces the same
      // defect class — `process.argv[1]` keeps the link path, `import.meta.url`
      // is resolved to the real one.
      execFileSync("cmd.exe", ["/c", "mklink", "/J", linkPath, DIST_DIR], { stdio: "pipe" });
      return { cli: join(linkPath, "cli.js") };
    }
    // POSIX: a file symlink, exactly what npm creates for a `bin` entry.
    symlinkSync(CLI, linkPath, "file");
    return { cli: linkPath };
  } catch (error) {
    return { unavailable: error instanceof Error ? error.message : String(error) };
  }
}

describe("CLI subprocess: invoked through a link (npx / global install)", () => {
  it("still runs the command instead of silently exiting 0", (ctx) => {
    const link = linkToCli(workdir);
    if ("unavailable" in link) {
      // Never let an un-creatable link read as a pass.
      ctx.skip(`cannot create a link to dist/ on this platform: ${link.unavailable}`);
      return;
    }

    const run = runCli(["--root", workdir, "search", "onboarding a new service", "--lexical"], link.cli);

    // Asserting the exit code alone would NOT catch the regression: with the
    // broken guard the process exits 0 too. The tell is empty stdout — the
    // command parsed nothing and did nothing. Assert on the output.
    expect(run.status).toBe(0);
    expect(run.stdout.trim().length).toBeGreaterThan(0);
    const payload = JSON.parse(run.stdout) as { results: { path: string }[] };
    expect(payload.results.map((r) => r.path)).toContain("guide-service-onboarding.md");
  });

  it("reports --version through the link too", (ctx) => {
    const link = linkToCli(workdir);
    if ("unavailable" in link) {
      ctx.skip(`cannot create a link to dist/ on this platform: ${link.unavailable}`);
      return;
    }
    const run = runCli(["--version"], link.cli);
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
