/**
 * Progress event stream for `compendio index` and `compendio sync`, and the
 * pure functions that decide what to show from it. Nothing here touches the
 * filesystem, SQLite,
 * transformers.js, or `process` — mode resolution and rendering are total
 * functions of injected inputs, never ambient reads. See
 * `openspec/changes/archive/2026-07-28-index-progress-reporting/design.md`.
 */

export type ProgressMode = "bar" | "plain" | "none";

export type ProgressEvent =
  | { phase: "discovery"; kind: "start" }
  | { phase: "files"; kind: "start"; total: number }
  | { phase: "files"; kind: "tick"; current: number; total: number; path: string }
  | { phase: "embedding"; kind: "start"; batches: number; chunks: number }
  | { phase: "embedding"; kind: "download"; loaded: number; total: number }
  | { phase: "embedding"; kind: "tick"; current: number; total: number }
  | { phase: "embedding"; kind: "failed"; reason: string };

export type ProgressReporter = (event: ProgressEvent) => void;

export interface ProgressState {
  phase: "idle" | "discovery" | "files" | "embedding";
  label: string;
  current: number;
  /** 0 means the phase's denominator is degenerate: render no ratio. */
  total: number;
  download: { loaded: number; total: number } | null;
}

/**
 * Minimum elapsed run time, in ms, before `bar` mode draws anything.
 *
 * Anti-flash gate: a bar that appears and vanishes is noise, not information.
 * The value trades two failure modes against each other, and was lowered from
 * an initial 5 000 ms once real runs showed 5 s hid the bar from every ordinary
 * invocation. Measured warm-cache durations: ~0.63 s for the 5-document
 * subprocess fixture, 3.24 s for this repo's own `docs/`, 3.94 s for
 * `ejemplos/`. At 1 500 ms the fixture still draws nothing (so subprocess tests
 * are unaffected) while both real corpora show a readable 1.7-2.4 s of bar.
 * A genuine flash is under ~0.5 s; that band stays suppressed.
 */
export const BAR_MIN_ELAPSED_MS = 1_500;
/** Minimum gap, in ms, between two bar redraws. */
export const BAR_REDRAW_MIN_MS = 100;
/**
 * Repaint interval, in ms, for `bar` mode while a phase is active — fires
 * independently of whether any event has arrived.
 *
 * A purely event-driven renderer draws nothing across a long silent `await`
 * (e.g. model load + a single embedding batch: `embedding/tick` is emitted
 * *before* the await, so a one-batch warm run emits every event within
 * ~25 ms and then blocks for seconds with nothing to report). That silence
 * is exactly the "looks hung" state this capability exists to eliminate.
 * 200 ms sits above `BAR_REDRAW_MIN_MS` so the heartbeat and the
 * event-driven coalescer never fight, and gives 5 visible updates per
 * second.
 */
export const BAR_REPAINT_MS = 200;
/** Download-progress report cadence for `bar` mode, in percent of `total`. */
export const DOWNLOAD_STEP_PERCENT_BAR = 1;
/** Download-progress report cadence for `plain` mode, in percent of `total`. */
export const DOWNLOAD_STEP_PERCENT_PLAIN = 5;
/** Rendered bar width is capped here so it never wraps a terminal line. */
export const BAR_MAX_WIDTH = 80;

/**
 * Resolves the render mode from exactly two injected inputs — never reads
 * `process.env` or `process.stderr.isTTY` itself. An unset variable and an
 * unrecognized value both behave as `auto`, never as an error.
 */
export function resolveProgressMode(raw: string | undefined, isTTY: boolean): ProgressMode {
  if (raw === "bar" || raw === "plain" || raw === "none") return raw;
  return isTTY ? "bar" : "plain";
}

/** Label for the embedding phase, shared by `start` and `tick` so a tick can
 * restore it after a download has overwritten it. */
const EMBEDDING_LABEL = "Embedding chunks";

/** The state a run starts in, before any event has been reported. */
export function initialProgressState(): ProgressState {
  return { phase: "idle", label: "", current: 0, total: 0, download: null };
}

/**
 * Pure state transition: folds one event into the accumulated state. Never
 * draws anything — rendering is entirely the caller's decision, made from
 * the returned state.
 */
export function advanceProgress(state: ProgressState, event: ProgressEvent): ProgressState {
  switch (event.phase) {
    case "discovery":
      return { phase: "discovery", label: "Discovering documents", current: 0, total: 0, download: null };
    case "files":
      if (event.kind === "start") {
        return { phase: "files", label: "Indexing documents", current: 0, total: event.total, download: null };
      }
      return {
        phase: "files",
        label: event.path,
        current: event.current,
        total: event.total,
        download: null,
      };
    case "embedding":
      switch (event.kind) {
        case "start":
          return {
            phase: "embedding",
            label: EMBEDDING_LABEL,
            current: 0,
            total: event.batches,
            download: null,
          };
        case "tick":
          // Clearing `download` (and restoring the label) is what keeps this a
          // transition rather than a dead end. The model is fetched lazily
          // inside the first `embed()` await, so the real event order is
          // tick 1 -> download... -> tick 2. Spreading `download` forward left
          // it non-null for the rest of the run, and both `progressRatio` and
          // `renderDetail` give it priority over `current`/`total` — so every
          // batch after the download rendered as "100% downloading model",
          // frozen for the whole embedding phase. A tick arriving after a
          // download means the download is over and CPU inference has begun.
          return {
            phase: "embedding",
            label: EMBEDDING_LABEL,
            current: event.current,
            total: event.total,
            download: null,
          };
        case "download":
          return {
            ...state,
            phase: "embedding",
            label: "downloading model",
            download: { loaded: event.loaded, total: event.total },
          };
        case "failed":
          // Same reason as `tick`: a stale download would outrank the reason
          // in the rendered detail.
          return { ...state, phase: "embedding", label: event.reason, download: null };
      }
  }
}

/** Formats one appended, newline-free `plain`-mode line for a single event. */
export function formatPlainLine(event: ProgressEvent): string {
  switch (event.phase) {
    case "discovery":
      return "Discovering documents";
    case "files":
      if (event.kind === "start") return `Indexing ${event.total} documents`;
      return event.total > 0
        ? `[${event.current}/${event.total}] ${event.path}`
        : event.path;
    case "embedding":
      switch (event.kind) {
        case "start":
          return event.batches > 0
            ? `Embedding ${event.chunks} chunks in ${event.batches} batches`
            : `Embedding ${event.chunks} chunks`;
        case "tick":
          return event.total > 0
            ? `[${event.current}/${event.total}] embedding batch`
            : "embedding batch";
        case "download": {
          const loadedMb = formatMb(event.loaded);
          return event.total > 0
            ? `downloading model: ${loadedMb}/${formatMb(event.total)} MB`
            : `downloading model: ${loadedMb} MB`;
        }
        case "failed":
          return `embeddings unavailable: ${event.reason}`;
      }
  }
}

function formatMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/** Fraction complete for `state`, or `null` when the denominator is degenerate. */
function progressRatio(state: ProgressState): number | null {
  if (state.download !== null) {
    return state.download.total > 0 ? state.download.loaded / state.download.total : null;
  }
  return state.total > 0 ? state.current / state.total : null;
}

/** Trailing label text: MB for a download, an item count otherwise. */
function renderDetail(state: ProgressState): string {
  if (state.download !== null) {
    return ` ${state.label} ${formatMb(state.download.loaded)}/${formatMb(state.download.total)} MB`;
  }
  if (state.label.length === 0) return "";
  return state.total > 0 ? ` ${state.label} ${state.current}/${state.total}` : ` ${state.label}`;
}

/**
 * Elapsed-time indicator segment, rendered to one decimal (e.g. ` 3.2s`).
 * Always present, independent of whether `state` has a renderable ratio —
 * it is the liveness signal for the repaint heartbeat, not a progress metric.
 */
function formatElapsed(elapsedMs: number): string {
  return ` ${(elapsedMs / 1000).toFixed(1)}s`;
}

/**
 * Renders one `bar`-mode frame, ASCII only (`=`/`-`, never box-drawing — the
 * reporting machine's terminal can be a non-UTF-8 code page). Contains no
 * `\r`, `\n`, or ANSI escape: the sink owns the redraw byte and the erase
 * padding. Width is clamped without touching the terminal; the caller passes
 * `Math.min(columns - 1, BAR_MAX_WIDTH)`.
 *
 * `elapsedMs` renders as a one-decimal seconds indicator (e.g. `3.2s`) —
 * the signal the repaint heartbeat exists to deliver. A repainted
 * byte-identical frame communicates nothing; the advancing number is what
 * separates "working" from "hung".
 */
export function renderBar(state: ProgressState, width: number, elapsedMs: number): string {
  const ratio = progressRatio(state);
  const percent = ratio !== null ? ` ${Math.round(ratio * 100)}%` : "";
  const elapsed = formatElapsed(elapsedMs);
  const overhead = 2 + percent.length + elapsed.length; // "[" + "]" + percent + elapsed
  const maxDetailLen = Math.max(width - overhead, 0);
  const detail = renderDetail(state).slice(0, maxDetailLen);

  const barLen = Math.max(width - overhead - detail.length, 0);
  const filled = ratio !== null ? Math.min(barLen, Math.round(ratio * barLen)) : 0;
  const bar = "=".repeat(filled) + "-".repeat(barLen - filled);

  // Safety cap: guarantees the invariant even at pathological widths where
  // brackets + percent + elapsed alone would exceed it.
  return `[${bar}]${percent}${elapsed}${detail}`.slice(0, width);
}

/**
 * A pure predicate, never a timer: throttles download-progress reporting to
 * once per `stepPercent` of `total`. The caller commits `lastReported` to
 * `loaded` only when this returns `true` — the whole cadence policy is this
 * one comparison, closed over the step.
 */
export function createDownloadThrottle(
  stepPercent: number,
): (loaded: number, total: number, lastReported: number) => boolean {
  return (loaded, total, lastReported) => {
    if (total <= 0) return false;
    if (loaded <= lastReported) return false;
    const stepBytes = (stepPercent / 100) * total;
    return loaded - lastReported >= stepBytes;
  };
}

/**
 * A coalescer, not an animator: refuses to draw before `BAR_MIN_ELAPSED_MS`
 * has passed (so a short run never flashes a bar), then refuses a redraw
 * within `BAR_REDRAW_MIN_MS` of the last one. `lastDrawMs === null` means no
 * frame has been drawn yet, so the first call after crossing the threshold
 * always draws — carrying whatever progress has already accumulated.
 */
export function shouldDrawBar(startedMs: number, nowMs: number, lastDrawMs: number | null): boolean {
  if (nowMs - startedMs < BAR_MIN_ELAPSED_MS) return false;
  if (lastDrawMs === null) return true;
  return nowMs - lastDrawMs >= BAR_REDRAW_MIN_MS;
}
