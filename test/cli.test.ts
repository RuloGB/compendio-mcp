import { describe, expect, it, vi } from "vitest";
import { formatSyncSummary, parseType } from "../src/cli.js";
import type { SyncReport } from "../src/application/sync-index.js";

/**
 * Smoke-level contract test for the CLI's `--type` open-string passthrough.
 * `parseType` used to validate against a closed, fixed list of allowed types
 * and call `process.exit(2)` on a mismatch; it is now a plain passthrough
 * (type is a project-defined, config-driven, open string — no closed list
 * to validate against at the CLI layer per the hexagonal boundary).
 */
describe("parseType", () => {
  it("passes through a value outside any closed taxonomy unchanged", () => {
    expect(parseType("playbook")).toBe("playbook");
  });

  it("passes through a recognized-looking value unchanged too", () => {
    expect(parseType("guia")).toBe("guia");
  });

  it("never calls process.exit for an unrecognized value", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit must not be called for an unrecognized type");
    });
    try {
      expect(() => parseType("notarealtype")).not.toThrow();
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("trims surrounding whitespace", () => {
    expect(parseType("  guia  ")).toBe("guia");
  });
});

function fakeSyncReport(overrides: Partial<SyncReport> = {}): SyncReport {
  return {
    mode: "hybrid",
    indexed: [],
    deleted: [],
    skipped: [],
    totalChunks: 0,
    durationMs: 5,
    reconciled: [],
    ...overrides,
  };
}

describe("formatSyncSummary", () => {
  it("C1: no reconciliation, no skips -> exactly one line, byte-identical to the ordinary summary", () => {
    const report = fakeSyncReport({
      indexed: [{ path: "a.md", title: "A", chunks: 3 }],
      deleted: ["b.md"],
      totalChunks: 3,
      durationMs: 480,
    });
    expect(formatSyncSummary(report)).toEqual(["Synced 1 documents (3 chunks), 1 deleted in 480 ms [mode hybrid]"]);
  });

  it("C2: reconciled with two entries and nothing indexed -> two lines, line 2 sums the chunk counts", () => {
    const report = fakeSyncReport({
      reconciled: [
        { path: "a.md", chunks: 40 },
        { path: "b.md", chunks: 7 },
      ],
      durationMs: 900,
    });
    expect(formatSyncSummary(report)).toEqual([
      "Synced 0 documents (0 chunks), 0 deleted in 900 ms [mode hybrid]",
      "Filled 47 missing chunk vectors across 2 documents.",
    ]);
  });

  it("C3: changed documents AND reconciliation -> two lines, the two counts never merge", () => {
    const report = fakeSyncReport({
      indexed: [{ path: "a.md", title: "A", chunks: 18 }],
      totalChunks: 18,
      reconciled: [{ path: "c.md", chunks: 5 }],
      durationMs: 700,
    });
    expect(formatSyncSummary(report)).toEqual([
      "Synced 1 documents (18 chunks), 0 deleted in 700 ms [mode hybrid]",
      "Filled 5 missing chunk vectors across 1 documents.",
    ]);
  });

  it("C4: reconciliation AND skips -> three lines, in order summary -> Filled -> Skipped", () => {
    const report = fakeSyncReport({
      reconciled: [{ path: "a.md", chunks: 2 }],
      skipped: [{ path: "b.md", errors: ["bad frontmatter"] }],
      durationMs: 10,
    });
    expect(formatSyncSummary(report)).toEqual([
      "Synced 0 documents (0 chunks), 0 deleted in 10 ms [mode hybrid]",
      "Filled 2 missing chunk vectors across 1 documents.",
      "Skipped 1 documents with invalid frontmatter.",
    ]);
  });
});
