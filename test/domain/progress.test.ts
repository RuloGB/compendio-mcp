import { describe, expect, it } from "vitest";
import {
  advanceProgress,
  createDownloadThrottle,
  formatPlainLine,
  initialProgressState,
  renderBar,
  resolveProgressMode,
  shouldDrawBar,
  type ProgressEvent,
  type ProgressState,
} from "../../src/domain/progress";

describe("resolveProgressMode", () => {
  it("auto resolves to bar on a TTY", () => {
    expect(resolveProgressMode("auto", true)).toBe("bar");
  });

  it("auto resolves to plain off a TTY", () => {
    expect(resolveProgressMode("auto", false)).toBe("plain");
  });

  it("explicit bar forces bar under a pipe (isTTY: false)", () => {
    expect(resolveProgressMode("bar", false)).toBe("bar");
  });

  it("explicit plain forces plain in a TTY (isTTY: true)", () => {
    expect(resolveProgressMode("plain", true)).toBe("plain");
  });

  it("none silences regardless of isTTY", () => {
    expect(resolveProgressMode("none", true)).toBe("none");
    expect(resolveProgressMode("none", false)).toBe("none");
  });

  it("undefined behaves as auto", () => {
    expect(resolveProgressMode(undefined, true)).toBe("bar");
    expect(resolveProgressMode(undefined, false)).toBe("plain");
  });

  it("an unrecognized value falls back to auto rather than throwing or defaulting to none", () => {
    expect(resolveProgressMode("verbose", true)).toBe("bar");
    expect(resolveProgressMode("verbose", false)).toBe("plain");
  });
});

describe("initialProgressState", () => {
  it("starts idle, at zero, with no download in progress", () => {
    expect(initialProgressState()).toEqual({
      phase: "idle",
      label: "",
      current: 0,
      total: 0,
      download: null,
    });
  });
});

describe("advanceProgress", () => {
  it("accumulates the files phase without any rendering side effect", () => {
    let state = initialProgressState();
    state = advanceProgress(state, { phase: "discovery", kind: "start" });
    expect(state.phase).toBe("discovery");

    state = advanceProgress(state, { phase: "files", kind: "start", total: 5 });
    expect(state).toMatchObject({ phase: "files", current: 0, total: 5 });

    state = advanceProgress(state, {
      phase: "files",
      kind: "tick",
      current: 3,
      total: 5,
      path: "guide.md",
    });
    expect(state).toMatchObject({ phase: "files", current: 3, total: 5 });
  });

  it("moves into the embedding phase and tracks batch progress", () => {
    let state = initialProgressState();
    state = advanceProgress(state, { phase: "embedding", kind: "start", batches: 3, chunks: 40 });
    expect(state).toMatchObject({ phase: "embedding", current: 0, total: 3 });

    state = advanceProgress(state, { phase: "embedding", kind: "tick", current: 2, total: 3 });
    expect(state).toMatchObject({ phase: "embedding", current: 2, total: 3 });
  });

  it("a download event updates state.download while phase stays embedding", () => {
    let state: ProgressState = {
      phase: "embedding",
      label: "Embedding chunks",
      current: 1,
      total: 3,
      download: null,
    };
    state = advanceProgress(state, {
      phase: "embedding",
      kind: "download",
      loaded: 40_000_000,
      total: 129_000_000,
    });
    expect(state.phase).toBe("embedding");
    expect(state.download).toEqual({ loaded: 40_000_000, total: 129_000_000 });
    // Batch progress (current/total) is a different axis and must not be
    // clobbered by a download event.
    expect(state.current).toBe(1);
    expect(state.total).toBe(3);
  });

  it("an embedding/failed event does not throw and keeps the embedding phase", () => {
    const state: ProgressState = {
      phase: "embedding",
      label: "Embedding chunks",
      current: 1,
      total: 3,
      download: null,
    };
    const next = advanceProgress(state, {
      phase: "embedding",
      kind: "failed",
      reason: "embeddings unavailable",
    });
    expect(next.phase).toBe("embedding");
  });
});

describe("formatPlainLine", () => {
  it("files/start renders 'Indexing {total} documents'", () => {
    expect(formatPlainLine({ phase: "files", kind: "start", total: 5 })).toBe(
      "Indexing 5 documents",
    );
  });

  it("files/tick renders a [{current}/{total}]-shaped line", () => {
    const line = formatPlainLine({
      phase: "files",
      kind: "tick",
      current: 1,
      total: 5,
      path: "guide.md",
    });
    expect(line).toContain("[1/5]");
    expect(line).toContain("guide.md");
  });

  it("renders one line per remaining event kind", () => {
    expect(formatPlainLine({ phase: "discovery", kind: "start" })).toContain("Discovering");
    expect(
      formatPlainLine({ phase: "embedding", kind: "start", batches: 3, chunks: 40 }),
    ).toContain("40");
    expect(
      formatPlainLine({ phase: "embedding", kind: "tick", current: 2, total: 3 }),
    ).toContain("[2/3]");
    expect(
      formatPlainLine({ phase: "embedding", kind: "download", loaded: 40_000_000, total: 129_000_000 }),
    ).toMatch(/MB/);
    expect(
      formatPlainLine({ phase: "embedding", kind: "failed", reason: "provider unavailable" }),
    ).toContain("provider unavailable");
  });

  it("total === 0 renders no malformed ratio", () => {
    const line = formatPlainLine({ phase: "embedding", kind: "start", batches: 0, chunks: 0 });
    expect(line).not.toContain("0/0");
  });

  it("no rendered line ever contains a carriage return or an ANSI escape", () => {
    const events: ProgressEvent[] = [
      { phase: "discovery", kind: "start" },
      { phase: "files", kind: "start", total: 5 },
      { phase: "files", kind: "tick", current: 1, total: 5, path: "guide.md" },
      { phase: "embedding", kind: "start", batches: 3, chunks: 40 },
      { phase: "embedding", kind: "download", loaded: 1, total: 100 },
      { phase: "embedding", kind: "tick", current: 1, total: 3 },
      { phase: "embedding", kind: "failed", reason: "boom" },
    ];
    for (const event of events) {
      const line = formatPlainLine(event);
      expect(line).not.toContain("\r");
      expect(line).not.toContain("\x1b");
    }
  });
});

describe("renderBar", () => {
  const filesState: ProgressState = {
    phase: "files",
    label: "guide.md",
    current: 3,
    total: 5,
    download: null,
  };
  const downloadState: ProgressState = {
    phase: "embedding",
    label: "downloading model",
    current: 0,
    total: 3,
    download: { loaded: 40_000_000, total: 129_000_000 },
  };
  const zeroState: ProgressState = {
    phase: "files",
    label: "",
    current: 0,
    total: 0,
    download: null,
  };

  it("never exceeds the given width", () => {
    for (const width of [20, 40, 80, 200]) {
      expect(renderBar(filesState, width).length).toBeLessThanOrEqual(width);
      expect(renderBar(downloadState, width).length).toBeLessThanOrEqual(width);
      expect(renderBar(zeroState, width).length).toBeLessThanOrEqual(width);
    }
  });

  it("never contains a carriage return, newline, or ANSI escape", () => {
    for (const state of [filesState, downloadState, zeroState]) {
      const line = renderBar(state, 80);
      expect(line).not.toContain("\r");
      expect(line).not.toContain("\n");
      expect(line).not.toContain("\x1b");
    }
  });

  it("total === 0 renders no ratio", () => {
    expect(renderBar(zeroState, 80)).not.toMatch(/%/);
  });

  it("a download state shows MB, not chunk counts", () => {
    const line = renderBar(downloadState, 80);
    expect(line).toMatch(/MB/);
  });
});

/** Simulates a caller loop: advances `loaded`, calling the throttle and
 * committing `lastReported` only on a `true` result — the exact contract
 * `progress-sink.ts` will use in Phase 2. Returns the count of `true`s. */
function countReports(
  throttle: (loaded: number, total: number, lastReported: number) => boolean,
  total: number,
  stepBytes: number,
): number {
  let lastReported = 0;
  let reports = 0;
  for (let loaded = 0; loaded <= total; loaded += stepBytes) {
    if (throttle(loaded, total, lastReported)) {
      lastReported = loaded;
      reports += 1;
    }
  }
  return reports;
}

describe("createDownloadThrottle", () => {
  const TOTAL = 129_000_000;

  it("below the step produces no report", () => {
    const throttle = createDownloadThrottle(5);
    expect(throttle(1_000_000, TOTAL, 0)).toBe(false);
  });

  it("crossing the step produces exactly one report per crossing in a caller loop", () => {
    const throttle = createDownloadThrottle(10);
    const reports = countReports(throttle, TOTAL, 1_000_000);
    // 10% of 129 MB ~= 12.9 MB steps -> about 10 crossings, not one per 1 MB tick.
    expect(reports).toBeGreaterThan(5);
    expect(reports).toBeLessThan(15);
  });

  it("non-monotonic loaded (moving backwards) never reports", () => {
    const throttle = createDownloadThrottle(1);
    expect(throttle(5_000_000, TOTAL, 10_000_000)).toBe(false);
  });

  it("total <= 0 never reports", () => {
    const throttle = createDownloadThrottle(1);
    expect(throttle(1_000_000, 0, 0)).toBe(false);
    expect(throttle(1_000_000, -1, 0)).toBe(false);
  });

  it("1% reports roughly 5x more often than 5% over the same synthetic stream", () => {
    const onePercent = countReports(createDownloadThrottle(1), TOTAL, 500_000);
    const fivePercent = countReports(createDownloadThrottle(5), TOTAL, 500_000);
    // Design table: 1% ~= 100 reports, 5% ~= 20 reports over a full download.
    expect(onePercent).toBeGreaterThan(80);
    expect(onePercent).toBeLessThan(120);
    expect(fivePercent).toBeGreaterThan(15);
    expect(fivePercent).toBeLessThan(25);
    expect(onePercent).toBeGreaterThan(fivePercent);
  });
});

describe("shouldDrawBar", () => {
  it("refuses to draw below the elapsed-time threshold", () => {
    expect(shouldDrawBar(0, 4_999, null)).toBe(false);
  });

  it("draws on the first call after crossing the threshold", () => {
    expect(shouldDrawBar(0, 5_000, null)).toBe(true);
  });

  it("refuses a second redraw less than the minimum gap after the last one", () => {
    expect(shouldDrawBar(0, 5_050, 5_000)).toBe(false);
  });

  it("allows a redraw once the minimum gap has passed", () => {
    expect(shouldDrawBar(0, 5_150, 5_000)).toBe(true);
  });
});
