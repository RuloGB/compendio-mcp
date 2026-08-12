import { describe, expect, it, vi } from "vitest";
import { SyncScheduler, type Syncer } from "../../src/application/sync-scheduler";
import type { SyncReport } from "../../src/application/sync-index";

function fakeReport(overrides: Partial<SyncReport> = {}): SyncReport {
  return {
    mode: "hybrid",
    indexed: [],
    deleted: [],
    skipped: [],
    totalChunks: 0,
    durationMs: 1,
    reconciled: [],
    ...overrides,
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeSyncer(execute: Syncer["execute"]): Syncer {
  return { execute };
}

describe("SyncScheduler — throttle window", () => {
  it("syncs on the first call, skips within the window, then syncs again once it elapses", async () => {
    let clock = 1_000_000;
    const execute = vi.fn().mockResolvedValue(fakeReport());
    const scheduler = new SyncScheduler(fakeSyncer(execute), 1000, () => clock);

    await scheduler.maybeSync();
    expect(execute).toHaveBeenCalledTimes(1);

    clock += 500; // still inside the throttle window
    await scheduler.maybeSync();
    expect(execute).toHaveBeenCalledTimes(1); // no new diff triggered

    clock += 600; // 1100ms since lastRun: window elapsed
    await scheduler.maybeSync();
    expect(execute).toHaveBeenCalledTimes(2);
  });
});

describe("SyncScheduler — in-flight promise dedupe (load-bearing against async double-sync)", () => {
  it("two concurrent maybeSync() calls await the SAME promise; syncIndex.execute runs exactly once", async () => {
    const deferred = createDeferred<SyncReport>();
    const execute = vi.fn().mockReturnValue(deferred.promise);
    const scheduler = new SyncScheduler(fakeSyncer(execute), 1000, () => 0);

    const first = scheduler.maybeSync();
    const second = scheduler.maybeSync(); // arrives while the first pass is still in-flight

    expect(execute).toHaveBeenCalledTimes(1); // the second call joined, it did not start a new pass

    deferred.resolve(fakeReport());
    await Promise.all([first, second]);

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("a maybeSync() call arriving during startup() joins the SAME in-flight pass instead of starting a second one", async () => {
    const deferred = createDeferred<SyncReport>();
    const execute = vi.fn().mockReturnValue(deferred.promise);
    const scheduler = new SyncScheduler(fakeSyncer(execute), 1000, () => 0);

    scheduler.startup(); // synchronously assigns the in-flight promise, does not await it
    const arriving = scheduler.maybeSync(); // arrives before the startup pass resolves

    expect(execute).toHaveBeenCalledTimes(1);

    deferred.resolve(fakeReport());
    await arriving;

    expect(execute).toHaveBeenCalledTimes(1); // still exactly once, total, across startup() + maybeSync()
  });
});

describe("SyncScheduler — failure recovery", () => {
  it("a throwing sync never propagates to the caller, clears inFlight in a finally, leaves lastReport untouched, and still advances lastRun", async () => {
    let clock = 0;
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error("simulated sync failure"))
      .mockResolvedValue(fakeReport());
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const scheduler = new SyncScheduler(fakeSyncer(execute), 1000, () => clock);

    await expect(scheduler.maybeSync()).resolves.toBeUndefined(); // failure does not propagate
    expect(scheduler.lastReport).toBeNull(); // no known-good report yet
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1); // stderr-only, per design

    clock += 500; // still inside the throttle window
    await scheduler.maybeSync();
    expect(execute).toHaveBeenCalledTimes(1); // lastRun DID advance on failure: no hot-loop retry within the window

    clock += 600; // window elapsed since the failed attempt
    await scheduler.maybeSync();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(scheduler.lastReport).toEqual(fakeReport()); // now reflects the first successful pass

    consoleErrorSpy.mockRestore();
  });

  it("is not permanently wedged after a throwing sync — inFlight is cleared so a later call actually runs a new pass", async () => {
    let clock = 0;
    const execute = vi.fn().mockRejectedValueOnce(new Error("fallo")).mockResolvedValue(fakeReport());
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const scheduler = new SyncScheduler(fakeSyncer(execute), 1000, () => clock);

    await scheduler.maybeSync(); // fails
    clock += 1000;
    await scheduler.maybeSync(); // must run a genuinely NEW pass, not hang on a dead in-flight promise
    expect(execute).toHaveBeenCalledTimes(2);

    consoleErrorSpy.mockRestore();
  });
});

describe("SyncScheduler — lastReport", () => {
  it("starts as null before any sync pass has completed", () => {
    const scheduler = new SyncScheduler(fakeSyncer(vi.fn()), 1000, () => 0);
    expect(scheduler.lastReport).toBeNull();
  });

  it("reflects the last known-good pass after a successful sync", async () => {
    const report = fakeReport({ skipped: [{ path: "a.md", errors: ["x"] }] });
    const execute = vi.fn().mockResolvedValue(report);
    const scheduler = new SyncScheduler(fakeSyncer(execute), 1000, () => 0);

    await scheduler.maybeSync();
    expect(scheduler.lastReport).toEqual(report);
  });
});
