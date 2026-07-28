/**
 * Progress event stream for `compendio index`, and the pure functions that
 * decide what to show from it. Nothing here touches the filesystem, SQLite,
 * transformers.js, or `process` — mode resolution and rendering are total
 * functions of injected inputs, never ambient reads. See
 * `openspec/changes/index-progress-reporting/design.md`.
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

/** Minimum elapsed run time, in ms, before `bar` mode draws anything. */
export const BAR_MIN_ELAPSED_MS = 5_000;
/** Minimum gap, in ms, between two bar redraws. */
export const BAR_REDRAW_MIN_MS = 100;
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
            label: "Embedding chunks",
            current: 0,
            total: event.batches,
            download: null,
          };
        case "tick":
          return { ...state, phase: "embedding", current: event.current, total: event.total };
        case "download":
          return {
            ...state,
            phase: "embedding",
            label: "downloading model",
            download: { loaded: event.loaded, total: event.total },
          };
        case "failed":
          return { ...state, phase: "embedding", label: event.reason };
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
 * Renders one `bar`-mode frame, ASCII only (`=`/`-`, never box-drawing — the
 * reporting machine's terminal can be a non-UTF-8 code page). Contains no
 * `\r`, `\n`, or ANSI escape: the sink owns the redraw byte and the erase
 * padding. Width is clamped without touching the terminal; the caller passes
 * `Math.min(columns - 1, BAR_MAX_WIDTH)`.
 */
export function renderBar(state: ProgressState, width: number): string {
  const ratio = progressRatio(state);
  const percent = ratio !== null ? ` ${Math.round(ratio * 100)}%` : "";
  const overhead = 2 + percent.length; // "[" + "]" + percent
  const maxDetailLen = Math.max(width - overhead, 0);
  const detail = renderDetail(state).slice(0, maxDetailLen);

  const barLen = Math.max(width - overhead - detail.length, 0);
  const filled = ratio !== null ? Math.min(barLen, Math.round(ratio * barLen)) : 0;
  const bar = "=".repeat(filled) + "-".repeat(barLen - filled);

  // Safety cap: guarantees the invariant even at pathological widths where
  // brackets + percent alone would exceed it.
  return `[${bar}]${percent}${detail}`.slice(0, width);
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
