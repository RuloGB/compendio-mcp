import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BAR_MIN_ELAPSED_MS, BAR_REPAINT_MS } from "../../src/domain/progress";
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
  // The repaint heartbeat uses a real `setInterval` internally. Fake timers
  // let tests control it deterministically without waiting on real wall
  // time; the injected `now()` clock is a *separate* piece of state, so
  // every test that advances the fake timer must also advance `clock` by
  // the same amount in the same step — otherwise the timer fires but
  // `now()` still reports the old elapsed time.
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("writes nothing when the run never exceeds BAR_MIN_ELAPSED_MS, even as the repaint timer ticks", () => {
    const stream = new FakeStream();
    let clock = 0;
    const sink = createProgressSink("bar", stream, () => clock);

    // Each step is a quarter of the threshold, so the run ends at 3/4 of it
    // however the constant is later retuned — this test is about the gate, not
    // about today's value. The fake timer is advanced in lockstep at each
    // step too, proving the repaint heartbeat itself stays silent below the
    // threshold rather than merely never having been exercised.
    const step = Math.floor(BAR_MIN_ELAPSED_MS / 4);
    sink.onProgress({ phase: "discovery", kind: "start" });
    clock += step;
    vi.advanceTimersByTime(step);
    sink.onProgress({ phase: "files", kind: "start", total: 5 });
    clock += step;
    vi.advanceTimersByTime(step);
    sink.onProgress({ phase: "files", kind: "tick", current: 1, total: 5, path: "a.md" });
    clock += step;
    vi.advanceTimersByTime(step);
    sink.finish();

    expect(stream.writes).toEqual([]);
  });

  it("draws its first frame purely from the repaint timer when no event ever arrives after the threshold is crossed (the reported production bug: a one-batch corpus emits every event within ~25 ms then blocks in silence)", () => {
    const stream = new FakeStream(80);
    let clock = 0;
    const sink = createProgressSink("bar", stream, () => clock);

    // Every event fires while `clock` is still 0 — reproducing the exact
    // production shape: `embedding/tick` before the `await`, so the whole
    // burst lands inside the first ~25 ms.
    sink.onProgress({ phase: "files", kind: "start", total: 1 });
    sink.onProgress({ phase: "files", kind: "tick", current: 1, total: 1, path: "a.md" });
    sink.onProgress({ phase: "embedding", kind: "start", batches: 1, chunks: 1 });
    sink.onProgress({ phase: "embedding", kind: "tick", current: 1, total: 1 });
    expect(stream.writes).toEqual([]); // still below the threshold

    // No further event ever arrives — the run is blocked inside `await
    // embed()`. Only real time passes, advanced through the repaint
    // interval, in lockstep with the injected clock.
    while (clock < BAR_MIN_ELAPSED_MS) {
      clock += BAR_REPAINT_MS;
      vi.advanceTimersByTime(BAR_REPAINT_MS);
    }

    expect(stream.writes).toHaveLength(1);
    expect(stream.writes[0]!).toContain("1/1"); // accumulated state, not idle

    sink.finish();
  });

  it("the first frame after crossing the threshold shows accumulated state, not zero", () => {
    const stream = new FakeStream(80);
    let clock = 0;
    const sink = createProgressSink("bar", stream, () => clock);

    sink.onProgress({ phase: "files", kind: "start", total: 5 });
    sink.onProgress({ phase: "files", kind: "tick", current: 3, total: 5, path: "c.md" });
    clock = BAR_MIN_ELAPSED_MS + 100; // crosses the threshold
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
    clock = BAR_MIN_ELAPSED_MS + 100;
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
    clock = BAR_MIN_ELAPSED_MS + 100;
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

  it("repaints on a timer while no new event arrives, and consecutive frames differ in elapsed", () => {
    const stream = new FakeStream(80);
    let clock = 0;
    const sink = createProgressSink("bar", stream, () => clock);

    sink.onProgress({ phase: "files", kind: "start", total: 5 });
    clock = BAR_MIN_ELAPSED_MS + 100; // crosses the threshold
    sink.onProgress({ phase: "files", kind: "tick", current: 2, total: 5, path: "b.md" });
    expect(stream.writes).toHaveLength(1); // first frame, event-driven; arms the heartbeat
    const firstFrame = stream.writes[0]!;

    // No further event arrives — only the repaint heartbeat fires. Advance
    // the fake timer and the injected clock together, in lockstep.
    clock += BAR_REPAINT_MS;
    vi.advanceTimersByTime(BAR_REPAINT_MS);
    expect(stream.writes).toHaveLength(2);
    const secondFrame = stream.writes[1]!;
    expect(secondFrame).not.toBe(firstFrame);

    clock += BAR_REPAINT_MS;
    vi.advanceTimersByTime(BAR_REPAINT_MS);
    expect(stream.writes).toHaveLength(3);
    const thirdFrame = stream.writes[2]!;
    expect(thirdFrame).not.toBe(secondFrame);

    sink.finish();
  });

  it("finish() stops the repaint timer: no further frame is written after it fires", () => {
    const stream = new FakeStream(80);
    let clock = 0;
    const sink = createProgressSink("bar", stream, () => clock);

    sink.onProgress({ phase: "files", kind: "start", total: 5 });
    clock = BAR_MIN_ELAPSED_MS + 100;
    sink.onProgress({ phase: "files", kind: "tick", current: 1, total: 5, path: "a.md" });
    expect(stream.writes).toHaveLength(1); // first frame arms the heartbeat

    sink.finish();
    expect(vi.getTimerCount()).toBe(0); // the repaint interval was cleared
    const writesAfterFinish = stream.writes.length;

    clock += BAR_REPAINT_MS * 3;
    vi.advanceTimersByTime(BAR_REPAINT_MS * 3);

    expect(stream.writes.length).toBe(writesAfterFinish);
  });
});

describe("createProgressSink — no repaint timer outside bar mode", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("plain mode never creates a timer, even with no new event for longer than the repaint interval", () => {
    const stream = new FakeStream();
    const sink = createProgressSink("plain", stream);
    sink.onProgress({ phase: "discovery", kind: "start" });
    const before = stream.writes.length;

    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(BAR_REPAINT_MS * 5);

    expect(vi.getTimerCount()).toBe(0);
    expect(stream.writes.length).toBe(before);
  });

  it("none mode never creates a timer, even with no new event for longer than the repaint interval", () => {
    const stream = new FakeStream();
    const sink = createProgressSink("none", stream);
    sink.onProgress({ phase: "discovery", kind: "start" });

    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(BAR_REPAINT_MS * 5);

    expect(vi.getTimerCount()).toBe(0);
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
