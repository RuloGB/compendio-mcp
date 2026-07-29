import {
  advanceProgress,
  BAR_MAX_WIDTH,
  BAR_REPAINT_MS,
  createDownloadThrottle,
  DOWNLOAD_STEP_PERCENT_BAR,
  DOWNLOAD_STEP_PERCENT_PLAIN,
  formatPlainLine,
  initialProgressState,
  renderBar,
  shouldDrawBar,
  type ProgressMode,
  type ProgressReporter,
} from "../domain/progress.js";

/**
 * The write surface `createProgressSink` targets. In production this is
 * `process.stderr`; tests inject a fake so no test ever touches real stdio.
 */
export interface ProgressStream {
  write(chunk: string): unknown;
  columns?: number | undefined;
}

export interface ProgressSink {
  onProgress: ProgressReporter;
  /** Idempotent: clears any in-progress bar line, a no-op otherwise. */
  finish(): void;
}

/**
 * Builds the one impure piece of the progress pipeline: owns the mutable
 * `ProgressState`, the injected clock, and the `\r` + space-padding erase
 * dance. Everything it decides is delegated to the pure functions in
 * `../domain/progress.js` — this module's only job is *when* to draw and
 * *where* the bytes go.
 *
 * In `bar` mode, an `unref()`'d `setInterval` repaints at `BAR_REPAINT_MS`,
 * armed from construction, so the bar keeps advancing during a silent
 * `await` with no events to react to — including when the elapsed-time
 * threshold is crossed with zero events left to trigger a draw. Every tick
 * still funnels through the same `shouldDrawBar` gate as event-driven draws,
 * so nothing is written before the threshold. The timer is stopped by
 * `finish()` and never created in `plain`/`none`.
 */
export function createProgressSink(
  mode: ProgressMode,
  stream: ProgressStream,
  now: () => number = Date.now,
): ProgressSink {
  if (mode === "none") {
    return { onProgress: () => {}, finish: () => {} };
  }

  if (mode === "plain") {
    const throttle = createDownloadThrottle(DOWNLOAD_STEP_PERCENT_PLAIN);
    let lastReportedLoaded = 0;
    const onProgress: ProgressReporter = (event) => {
      if (event.phase === "embedding" && event.kind === "download") {
        if (!throttle(event.loaded, event.total, lastReportedLoaded)) return;
        lastReportedLoaded = event.loaded;
      }
      stream.write(`${formatPlainLine(event)}\n`);
    };
    return { onProgress, finish: () => {} };
  }

  // mode === "bar"
  const startedMs = now();
  const throttle = createDownloadThrottle(DOWNLOAD_STEP_PERCENT_BAR);
  const width = Math.min((stream.columns ?? BAR_MAX_WIDTH) - 1, BAR_MAX_WIDTH);
  let state = initialProgressState();
  let lastReportedLoaded = 0;
  let lastDrawMs: number | null = null;
  let lastLineLength = 0;

  /**
   * The one place that decides whether to draw a frame — called both from
   * an incoming event and from the repaint heartbeat below, so both paths
   * share the same `shouldDrawBar` gate: event bursts stay coalesced to the
   * 100 ms floor, every tick before the elapsed threshold is a silent no-op
   * (no write), and no code path bypasses the other's decision.
   */
  const draw = (): void => {
    const nowMs = now();
    if (!shouldDrawBar(startedMs, nowMs, lastDrawMs)) return;
    lastDrawMs = nowMs;

    const content = renderBar(state, width, nowMs - startedMs);
    const padded =
      content.length < lastLineLength
        ? content + " ".repeat(lastLineLength - content.length)
        : content;
    stream.write(`\r${padded}`);
    lastLineLength = content.length;
  };

  // Armed unconditionally at construction, unref()'d so it can never hold
  // the process open by itself, and cleared by `finish()`. This is the only
  // way to observe elapsed time crossing the threshold when NO event ever
  // arrives after it: `IndexDocuments` emits `embedding/start` and then
  // blocks inside the first `await`, so a one-batch corpus fires every event
  // within ~25 ms and then goes silent for seconds (ticks now land *after*
  // each batch, so there is nothing at all to report in between). A timer
  // armed reactively by an event
  // would never fire in that case, leaving stderr silent for the exact
  // duration this heartbeat exists to cover — confirmed by reproducing it
  // against this repo's own `docs/` before adopting this shape. Every tick
  // funnels through `draw()`'s `shouldDrawBar` gate, so nothing is written
  // before the threshold regardless of how early the timer itself exists.
  const repaintTimer = setInterval(draw, BAR_REPAINT_MS);
  repaintTimer.unref();

  const onProgress: ProgressReporter = (event) => {
    if (event.phase === "embedding" && event.kind === "download") {
      if (!throttle(event.loaded, event.total, lastReportedLoaded)) return;
      lastReportedLoaded = event.loaded;
    }
    state = advanceProgress(state, event);
    draw();
  };

  const finish = (): void => {
    clearInterval(repaintTimer);
    if (lastLineLength === 0) return;
    stream.write(`\r${" ".repeat(lastLineLength)}\r`);
    lastLineLength = 0;
  };

  return { onProgress, finish };
}
