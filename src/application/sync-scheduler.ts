import { describeError } from "./index-pipeline.js";
import type { SyncReport } from "./sync-index.js";

/** The subset of `SyncIndex` the scheduler depends on — kept narrow so tests
 * can stub it without a real store/source/parser. */
export interface Syncer {
  execute(): Promise<SyncReport>;
}

/**
 * Throttled trigger for incremental sync, with in-flight promise dedupe —
 * the load-bearing correctness property against an async double-sync (see
 * design.md's "Trigger = startup + throttled scheduler" decision).
 *
 * `startup()` and `maybeSync()` share one `inFlight: Promise<void> | null`
 * field via the private `runTracked()` helper: whichever entry point runs
 * first assigns its promise to `inFlight` SYNCHRONOUSLY (no `await` between
 * the check and the assignment), so a second call arriving before that pass
 * resolves always finds `inFlight` already set and awaits the SAME promise
 * instead of starting a second `Syncer.execute()` against the same tables.
 */
export class SyncScheduler {
  /** `-Infinity` so the very first call (whether `startup()` or an early
   * `maybeSync()`) always triggers a pass, regardless of the clock's
   * absolute starting value. */
  private lastRunAt = -Infinity;
  private currentReport: SyncReport | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly syncer: Syncer,
    private readonly throttleMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** The last known-good `SyncReport`, or `null` if no pass has completed
   * yet. Left untouched by a failed pass — it always holds the last
   * successful report, or `null` if none exists yet. */
  get lastReport(): SyncReport | null {
    return this.currentReport;
  }

  /** Called once, before `server.connect()`. Synchronously assigns the
   * startup pass to `inFlight` and returns without awaiting its completion —
   * only `inFlight` being populated synchronously matters for safety here. */
  startup(): void {
    this.runTracked();
  }

  /** Called by every tool handler on every call. Joins an already-running
   * pass (from `startup()` or an earlier `maybeSync()`); otherwise starts a
   * new pass only if the throttle window has elapsed; otherwise is a no-op
   * and the caller proceeds against the current index. */
  async maybeSync(): Promise<void> {
    if (this.inFlight !== null) {
      await this.inFlight;
      return;
    }
    if (this.now() - this.lastRunAt < this.throttleMs) return;
    await this.runTracked();
  }

  /** Assigns `inFlight` synchronously (before any `await`), then runs the
   * sync. A failure is stderr-only and never propagates: `lastReport` stays
   * untouched, but `lastRun` still advances (no hot-loop retry within the
   * same window), and `inFlight` is always cleared in a `finally`. */
  private runTracked(): Promise<void> {
    const promise = (async (): Promise<void> => {
      try {
        this.currentReport = await this.syncer.execute();
      } catch (error) {
        console.error(`incremental sync failed: ${describeError(error)}`);
      } finally {
        this.lastRunAt = this.now();
        this.inFlight = null;
      }
    })();
    this.inFlight = promise;
    return promise;
  }
}
