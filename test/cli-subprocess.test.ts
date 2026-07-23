import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
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
const FIXTURE = join(REPO_ROOT, "test", "fixtures", "estricto");

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

function runCli(args: string[], entry: string = CLI): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [entry, ...args], { encoding: "utf8" });
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
  // `--lexico` throughout: the real embeddings provider would download a model
  // on first use. Lexical mode keeps these tests hermetic and offline.
  indexRun = runCli(["--root", workdir, "index", "--lexico"]);
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
    expect(indexRun.stdout).toMatch(/Indexados 5 documentos \(\d+ chunks\)/);
  });

  it("search exits 0 and writes parseable JSON to stdout", () => {
    const run = runCli(["--root", workdir, "search", "onboarding de un servicio", "--lexico"]);
    expect(run.status).toBe(0);
    const payload = JSON.parse(run.stdout) as { modo: string; resultados: { ruta: string }[] };
    expect(payload.modo).toBe("lexico");
    expect(payload.resultados.length).toBeGreaterThan(0);
    expect(payload.resultados.map((r) => r.ruta)).toContain("guia-onboarding.md");
  });
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

    const run = runCli(["--root", workdir, "search", "onboarding de un servicio", "--lexico"], link.cli);

    // Asserting the exit code alone would NOT catch the regression: with the
    // broken guard the process exits 0 too. The tell is empty stdout — the
    // command parsed nothing and did nothing. Assert on the output.
    expect(run.status).toBe(0);
    expect(run.stdout.trim().length).toBeGreaterThan(0);
    const payload = JSON.parse(run.stdout) as { resultados: { ruta: string }[] };
    expect(payload.resultados.map((r) => r.ruta)).toContain("guia-onboarding.md");
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
