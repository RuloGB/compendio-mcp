import { describe, expect, it } from "vitest";
import { createProgressSink } from "../../src/infrastructure/progress-sink";

/** Records every write, in order, without touching the real stdio streams. */
class FakeStream {
  writes: string[] = [];
  columns: number | undefined;

  constructor(columns: number | undefined = 80) {
    this.columns = columns;
  }

  write(chunk: string): boolean {
    this.writes.push(chunk);
    return true;
  }
}

const FULL_SEQUENCE = [
  { phase: "discovery", kind: "start" },
  { phase: "files", kind: "start", total: 5 },
  { phase: "files", kind: "tick", current: 1, total: 5, path: "a.md" },
  { phase: "embedding", kind: "start", batches: 2, chunks: 20 },
  { phase: "embedding", kind: "download", loaded: 1_000, total: 100_000 },
  { phase: "embedding", kind: "tick", current: 1, total: 2 },
  { phase: "embedding", kind: "failed", reason: "boom" },
] as const;

describe("createProgressSink — mode none", () => {
  it("writes nothing to the stream across a full event sequence", () => {
    const stream = new FakeStream();
    const sink = createProgressSink("none", stream);
    for (const event of FULL_SEQUENCE) sink.onProgress(event);
    sink.finish();
    expect(stream.writes).toEqual([]);
  });
});

describe("createProgressSink — mode plain", () => {
  it("appends one newline-terminated line per event, with no carriage return", () => {
    const stream = new FakeStream();
    let clock = 0;
    const sink = createProgressSink("plain", stream, () => clock);

    sink.onProgress({ phase: "discovery", kind: "start" });
    clock += 10;
    sink.onProgress({ phase: "files", kind: "start", total: 5 });
    clock += 10;
    sink.onProgress({ phase: "files", kind: "tick", current: 1, total: 5, path: "a.md" });

    expect(stream.writes).toHaveLength(3);
    for (const write of stream.writes) {
      expect(write).not.toContain("\r");
      expect(write.endsWith("\n")).toBe(true);
    }
    expect(stream.writes[1]).toContain("Indexing 5 documents");
    expect(stream.writes[2]).toContain("[1/5]");
  });
});

describe("createProgressSink — mode bar", () => {
  it("writes nothing when the run never exceeds BAR_MIN_ELAPSED_MS", () => {
    const stream = new FakeStream();
    let clock = 0;
    const sink = createProgressSink("bar", stream, () => clock);

    sink.onProgress({ phase: "discovery", kind: "start" });
    clock += 1_000;
    sink.onProgress({ phase: "files", kind: "start", total: 5 });
    clock += 1_000;
    sink.onProgress({ phase: "files", kind: "tick", current: 1, total: 5, path: "a.md" });
    clock += 1_000; // total elapsed: 3_000ms, below the 5_000ms threshold
    sink.finish();

    expect(stream.writes).toEqual([]);
  });

  it("the first frame after crossing the threshold shows accumulated state, not zero", () => {
    const stream = new FakeStream(80);
    let clock = 0;
    const sink = createProgressSink("bar", stream, () => clock);

    sink.onProgress({ phase: "files", kind: "start", total: 5 });
    sink.onProgress({ phase: "files", kind: "tick", current: 3, total: 5, path: "c.md" });
    clock = 5_100; // crosses BAR_MIN_ELAPSED_MS
    sink.onProgress({ phase: "files", kind: "tick", current: 4, total: 5, path: "d.md" });

    expect(stream.writes).toHaveLength(1);
    const frame = stream.writes[0]!;
    expect(frame.startsWith("\r")).toBe(true);
    expect(frame).not.toContain("\n");
    // Accumulated state (current 4/5), not a restart from zero.
    expect(frame).toContain("4/5");
  });

  it("finish() erases the active frame with \\r + spaces + \\r, never a trailing newline", () => {
    const stream = new FakeStream(80);
    let clock = 0;
    const sink = createProgressSink("bar", stream, () => clock);

    sink.onProgress({ phase: "files", kind: "start", total: 5 });
    clock = 5_100;
    sink.onProgress({ phase: "files", kind: "tick", current: 1, total: 5, path: "a.md" });
    const drawnLength = stream.writes[0]!.length - 1; // minus the leading \r

    sink.finish();

    expect(stream.writes).toHaveLength(2);
    const erase = stream.writes[1]!;
    expect(erase.startsWith("\r")).toBe(true);
    expect(erase.endsWith("\r")).toBe(true);
    expect(erase).not.toContain("\n");
    expect(erase.length).toBe(drawnLength + 2); // \r + spaces(drawnLength) + \r
  });

  it("finish() is idempotent: a second call does not throw or write again", () => {
    const stream = new FakeStream(80);
    let clock = 0;
    const sink = createProgressSink("bar", stream, () => clock);

    sink.onProgress({ phase: "files", kind: "start", total: 5 });
    clock = 5_100;
    sink.onProgress({ phase: "files", kind: "tick", current: 1, total: 5, path: "a.md" });

    sink.finish();
    const afterFirstFinish = stream.writes.length;
    expect(() => sink.finish()).not.toThrow();
    expect(stream.writes.length).toBe(afterFirstFinish);
  });

  it("finish() is a no-op when no frame was ever drawn (a run that stayed below the threshold)", () => {
    const stream = new FakeStream(80);
    let clock = 0;
    const sink = createProgressSink("bar", stream, () => clock);

    sink.onProgress({ phase: "files", kind: "start", total: 5 });
    sink.finish();

    expect(stream.writes).toEqual([]);
  });
});

describe("createProgressSink — finish() is a no-op in plain and none modes", () => {
  it("plain mode: finish() does not throw or write anything extra", () => {
    const stream = new FakeStream();
    const sink = createProgressSink("plain", stream);
    sink.onProgress({ phase: "discovery", kind: "start" });
    const before = stream.writes.length;
    expect(() => sink.finish()).not.toThrow();
    expect(stream.writes.length).toBe(before);
  });

  it("none mode: finish() does not throw or write anything", () => {
    const stream = new FakeStream();
    const sink = createProgressSink("none", stream);
    expect(() => sink.finish()).not.toThrow();
    expect(stream.writes).toEqual([]);
  });
});
