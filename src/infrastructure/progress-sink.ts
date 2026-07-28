import {
  advanceProgress,
  BAR_MAX_WIDTH,
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

  const onProgress: ProgressReporter = (event) => {
    if (event.phase === "embedding" && event.kind === "download") {
      if (!throttle(event.loaded, event.total, lastReportedLoaded)) return;
      lastReportedLoaded = event.loaded;
    }
    state = advanceProgress(state, event);

    const nowMs = now();
    if (!shouldDrawBar(startedMs, nowMs, lastDrawMs)) return;
    lastDrawMs = nowMs;

    const content = renderBar(state, width);
    const padded =
      content.length < lastLineLength
        ? content + " ".repeat(lastLineLength - content.length)
        : content;
    stream.write(`\r${padded}`);
    lastLineLength = content.length;
  };

  const finish = (): void => {
    if (lastLineLength === 0) return;
    stream.write(`\r${" ".repeat(lastLineLength)}\r`);
    lastLineLength = 0;
  };

  return { onProgress, finish };
}
