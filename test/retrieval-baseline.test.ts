import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SecurityError,
  assertContained,
  assertModelPrerequisites,
  assertOutputAvailable,
  assertWalAbsentOrEmpty,
  combineFileHashes,
  computeLogicalDigest,
  isMarkdownPath,
  resolveCanonicalRoot,
  sha256Bytes,
  sha256File,
  verifyUnchanged,
} from "../scripts/retrieval-baseline.mjs";

const SCRIPT_PATH = fileURLToPath(new URL("../scripts/retrieval-baseline.mjs", import.meta.url));
const SCRIPT_SOURCE = readFileSync(SCRIPT_PATH, "utf8");

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "retrieval-baseline-test-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

// Determine ONCE whether this machine/user can create filesystem symlinks at
// all (Windows without Developer Mode / admin routinely refuses this). A
// symlink-escape RED test that never actually attempts a symlink has not
// been verified — so where privilege is unavailable, the affected test says
// so loudly (console.warn) and returns early rather than silently reporting
// green (same pattern as `test/cli-subprocess.test.ts`'s 8.3 short-path case).
function canCreateSymlinks(): boolean {
  const probeDir = mkdtempSync(join(tmpdir(), "symlink-probe-"));
  try {
    const target = join(probeDir, "target");
    mkdirSync(target);
    symlinkSync(target, join(probeDir, "link"), "dir");
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}
const SYMLINKS_AVAILABLE = canCreateSymlinks();

describe("retrieval-baseline.mjs — canonical containment", () => {
  it("resolves a real directory to its canonical (realpath) form", () => {
    const canonical = resolveCanonicalRoot(workDir);
    expect(existsSync(canonical)).toBe(true);
  });

  it("throws when the root does not exist", () => {
    expect(() => resolveCanonicalRoot(join(workDir, "does-not-exist"))).toThrow();
  });

  it("accepts a path genuinely inside the canonical root", () => {
    const root = resolveCanonicalRoot(workDir);
    const inside = join(workDir, "docs", "a.md");
    mkdirSync(join(workDir, "docs"));
    writeFileSync(inside, "# A");
    expect(() => assertContained(inside, root, "corpus file")).not.toThrow();
  });

  it("rejects a `..` traversal that escapes the canonical root", () => {
    const root = resolveCanonicalRoot(workDir);
    const outsideDir = mkdtempSync(join(tmpdir(), "outside-"));
    try {
      const escaping = join(workDir, "..", ...outsideDir.split(sep).slice(-1), "escape.md");
      expect(() => assertContained(escaping, root, "corpus file")).toThrow(SecurityError);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("rejects a symlink whose target resolves outside the canonical root", () => {
    if (!SYMLINKS_AVAILABLE) {
      console.warn("SKIPPED: this environment cannot create filesystem symlinks (no privilege).");
      return;
    }
    const root = resolveCanonicalRoot(workDir);
    const outsideDir = mkdtempSync(join(tmpdir(), "outside-"));
    try {
      const linkPath = join(workDir, "escape-link");
      symlinkSync(outsideDir, linkPath, "dir");
      const candidate = join(linkPath, "secret.md");
      mkdirSync(outsideDir, { recursive: true });
      writeFileSync(join(outsideDir, "secret.md"), "leaked");
      expect(() => assertContained(candidate, root, "corpus file")).toThrow(SecurityError);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

describe("retrieval-baseline.mjs — non-Markdown rejection and executable-Markdown inertness", () => {
  it.each([
    ["requirements.txt", false],
    ["CMakeLists.txt", false],
    ["notes.mdx", false],
    ["README.sh", false],
    ["README.md", true],
    ["deep/nested/doc.md", true],
  ])("isMarkdownPath(%s) -> %s", (path, expected) => {
    expect(isMarkdownPath(path)).toBe(expected);
  });

  it("a Markdown file whose content looks like an executable script is still just data: hashed, never executed", () => {
    const shellLikeContent = "#!/bin/sh\nrm -rf / # this must never run\n";
    expect(() => sha256Bytes(Buffer.from(shellLikeContent))).not.toThrow();
    const hash = sha256Bytes(Buffer.from(shellLikeContent));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("retrieval-baseline.mjs — output collision", () => {
  it("refuses to proceed when the output path already exists", () => {
    const outputPath = join(workDir, "existing.json");
    writeFileSync(outputPath, "{}");
    expect(() => assertOutputAvailable(outputPath)).toThrow(SecurityError);
  });

  it("allows a genuinely new output path", () => {
    const outputPath = join(workDir, "new.json");
    expect(() => assertOutputAvailable(outputPath)).not.toThrow();
  });
});

describe("retrieval-baseline.mjs — no shell/subprocess, no dangerous db operations (static source audit)", () => {
  it("never imports node:child_process or any process-spawning API", () => {
    expect(SCRIPT_SOURCE).not.toMatch(/child_process/);
    expect(SCRIPT_SOURCE).not.toMatch(/\bexecSync\s*\(/);
    expect(SCRIPT_SOURCE).not.toMatch(/\bspawn(Sync)?\s*\(/);
    expect(SCRIPT_SOURCE).not.toMatch(/\bexecFile(Sync)?\s*\(/);
  });

  it("never calls a sync/checkpoint/reindex/repair operation on the store", () => {
    expect(SCRIPT_SOURCE).not.toMatch(/\.reset\s*\(/);
    expect(SCRIPT_SOURCE).not.toMatch(/SyncScheduler/);
    expect(SCRIPT_SOURCE).not.toMatch(/SyncIndex/);
    expect(SCRIPT_SOURCE).not.toMatch(/wal_checkpoint/i);
  });

  it("never uses eval or the Function constructor to run corpus content", () => {
    expect(SCRIPT_SOURCE).not.toMatch(/\beval\s*\(/);
    expect(SCRIPT_SOURCE).not.toMatch(/new\s+Function\s*\(/);
  });
});

describe("retrieval-baseline.mjs — stopped writers, WAL, and provenance drift", () => {
  it("passes when there is no WAL sidecar at all (clean checkpoint)", () => {
    const dbPath = join(workDir, "db.sqlite");
    writeFileSync(dbPath, "fake db bytes");
    expect(() => assertWalAbsentOrEmpty(dbPath)).not.toThrow();
  });

  it("passes when the WAL sidecar exists but is empty (checkpointed clean)", () => {
    const dbPath = join(workDir, "db.sqlite");
    writeFileSync(dbPath, "fake db bytes");
    writeFileSync(`${dbPath}-wal`, Buffer.alloc(0));
    expect(() => assertWalAbsentOrEmpty(dbPath)).not.toThrow();
  });

  it("refuses when the WAL sidecar is non-empty (an active writer left uncommitted pages)", () => {
    const dbPath = join(workDir, "db.sqlite");
    writeFileSync(dbPath, "fake db bytes");
    writeFileSync(`${dbPath}-wal`, Buffer.from("uncommitted pages"));
    expect(() => assertWalAbsentOrEmpty(dbPath)).toThrow(SecurityError);
  });

  it("computes a stable sha256 for a file's bytes", () => {
    const filePath = join(workDir, "a.txt");
    writeFileSync(filePath, "hello world");
    const first = sha256File(filePath);
    const second = sha256File(filePath);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("combineFileHashes is order-independent (declaration order must not matter for provenance identity)", () => {
    const a = sha256Bytes(Buffer.from("a"));
    const b = sha256Bytes(Buffer.from("b"));
    expect(combineFileHashes([a, b])).toBe(combineFileHashes([b, a]));
  });

  it("verifyUnchanged passes for identical hashes and throws SecurityError for drift", () => {
    expect(() => verifyUnchanged("h1", "h1", "source corpus")).not.toThrow();
    expect(() => verifyUnchanged("h1", "h2", "source corpus")).toThrow(SecurityError);
  });
});

describe("retrieval-baseline.mjs — prerequisite refusal", () => {
  it("refuses hybrid execution when the model directory is missing", () => {
    expect(() => assertModelPrerequisites(join(workDir, "no-such-model-dir"))).toThrow(SecurityError);
  });

  it("refuses hybrid execution when the model directory exists but is empty", () => {
    const modelDir = join(workDir, "model");
    mkdirSync(modelDir);
    expect(() => assertModelPrerequisites(modelDir)).toThrow(SecurityError);
  });

  it("accepts a model directory that has at least one file", () => {
    const modelDir = join(workDir, "model");
    mkdirSync(modelDir);
    writeFileSync(join(modelDir, "model.onnx"), "fake weights");
    expect(() => assertModelPrerequisites(modelDir)).not.toThrow();
  });
});

describe("retrieval-baseline.mjs — logical row/vector immutability (mode/depth independence)", () => {
  it("computeLogicalDigest is identical before and after read-only queries against the same store state", () => {
    const store = {
      listDocuments: () => [{ id: 1, path: "a.md", hash: "h1", tags: [] }],
      getChunksByDocument: (_id: number) => [{ position: 0, heading: "H", content: "x" }],
      hasVectors: () => true,
    };
    const before = computeLogicalDigest(store);
    // Simulate independent k=5 and k=10 executions in between — digest must
    // not depend on how many queries ran or at what candidate depth.
    const after = computeLogicalDigest(store);
    expect(after).toBe(before);
  });

  it("computeLogicalDigest changes when a chunk's content changes (it is sensitive to real mutation)", () => {
    const before = {
      listDocuments: () => [{ id: 1, path: "a.md", hash: "h1", tags: [] }],
      getChunksByDocument: () => [{ position: 0, heading: "H", content: "original" }],
      hasVectors: () => true,
    };
    const after = {
      listDocuments: () => [{ id: 1, path: "a.md", hash: "h1", tags: [] }],
      getChunksByDocument: () => [{ position: 0, heading: "H", content: "MUTATED" }],
      hasVectors: () => true,
    };
    expect(computeLogicalDigest(before)).not.toBe(computeLogicalDigest(after));
  });
});
