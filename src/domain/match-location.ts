/**
 * Locates where a search query matched inside a chunk's own text, and
 * chooses which occurrence should centre the lead excerpt. Pure: no I/O, no
 * SQLite, no injectable dependency (design.md Decision 8).
 */

export interface MatchSpan {
  /** Inclusive start, in the coordinates of the string being searched. */
  start: number;
  /** Exclusive end. */
  end: number;
  /** The normalized query term this span matched; drives rarity weighting. */
  term: string;
}

/**
 * Query terms, byte-for-byte the split `toFtsQuery` has always used
 * (`sqlite-index-store.ts:430-433`). Not folded, not lowercased: the FTS5
 * MATCH string must not change (Gate 4) — `toFtsQuery` delegates here
 * (design.md Decision 2), so this regex is now the single definition of
 * "what a query term is."
 */
export function tokenizeQuery(query: string): string[] {
  return query
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

// Unicode "Combining Diacritical Marks" block: the range produced by
// normalizing a precomposed accented character to NFD (e.g. U+00E9 "e" ->
// "e" + U+0301). Written as numeric code-point bounds (0x0300-0x036f)
// rather than a regex literal holding the raw combining characters, so the
// source carries no non-ASCII bytes that could be silently corrupted by an
// encoding-unaware edit.
const COMBINING_MARK_RANGE_START = 0x0300;
const COMBINING_MARK_RANGE_END = 0x036f;

/**
 * Lowercase + NFD + combining-mark strip. Applied to both sides of a
 * comparison. Deliberately narrower than SQLite's `unicode61
 * remove_diacritics 2` — Probe P1 (apply notes) measures how narrow, over
 * the corpus alphabet actually in use.
 */
export function foldForMatch(text: string): string {
  const decomposed = text.toLowerCase().normalize("NFD");
  let result = "";
  for (const ch of decomposed) {
    const codePoint = ch.codePointAt(0)!;
    if (codePoint < COMBINING_MARK_RANGE_START || codePoint > COMBINING_MARK_RANGE_END) {
      result += ch;
    }
  }
  return result;
}

/**
 * Every occurrence of every term in `raw`, in raw coordinates, ascending by
 * start (then end). Comparison is case- and diacritic-folded per character
 * (the same granularity Probe P1 measures), so a folded raw text stays
 * index-aligned with `raw` one-for-one except where a single raw character
 * folds away entirely (a bare combining mark) or expands to more than one
 * folded character (rare Unicode special-casing) — both handled by mapping
 * every emitted folded character back to the raw character that produced it.
 */
export function locateSpans(raw: string, terms: readonly string[]): MatchSpan[] {
  if (terms.length === 0) return [];
  const { text: foldedRaw, map } = foldRawWithMap(raw);
  if (foldedRaw.length === 0) return [];

  const spans: MatchSpan[] = [];
  for (const term of terms) {
    const foldedTerm = foldForMatch(term);
    if (foldedTerm.length === 0) continue;
    let searchFrom = 0;
    while (searchFrom <= foldedRaw.length) {
      const idx = foldedRaw.indexOf(foldedTerm, searchFrom);
      if (idx === -1) break;
      const start = map[idx]!;
      const endFoldedIndex = idx + foldedTerm.length;
      const end = endFoldedIndex < map.length ? map[endFoldedIndex]! : raw.length;
      spans.push({ start, end, term });
      searchFrom = idx + 1;
    }
  }
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  return spans;
}

/**
 * Centre of the best budget-wide window, or null when `spans` is empty
 * (design.md Decision 4). Among all windows anchored at a match occurrence
 * whose cluster span (first occurrence's start to last occurrence's end)
 * fits within `budget`, picks the one maximizing
 *
 *   S(window) = sum over DISTINCT terms t in the window of w(t)
 *   w(t)      = log(1 + L / f(t))     f(t) = occurrences of t in this chunk,
 *                                      L = total occurrences of all terms
 *
 * — an in-chunk IDF: distinctness defeats repetition inflating a window;
 * rarity defeats a window packed with one very common term. Tie-breaks:
 * (1) total length of the window's distinct matched terms, (2) earliest
 * start. Two-pointer sweep over occurrences sorted by start — O(n log n)
 * for the sort, O(n) for the sweep, n bounded by one chunk's term count.
 */
export function selectMatchCentre(spans: readonly MatchSpan[], budget: number): number | null {
  if (spans.length === 0) return null;
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);

  const occurrenceCount = new Map<string, number>();
  for (const span of sorted) {
    occurrenceCount.set(span.term, (occurrenceCount.get(span.term) ?? 0) + 1);
  }
  const totalOccurrences = sorted.length;
  const weight = (term: string): number => {
    const f = occurrenceCount.get(term) ?? 1;
    return Math.log(1 + totalOccurrences / f);
  };

  let bestScore = -Infinity;
  let bestDistinctLength = -Infinity;
  let bestStart = Infinity;
  let bestWindow: { start: number; end: number } | null = null;

  const windowCounts = new Map<string, number>();
  let distinctScore = 0;
  let distinctLength = 0;
  let left = 0;

  for (let right = 0; right < sorted.length; right++) {
    // Shrink from the left until the cluster [left..right] fits the budget.
    while (sorted[right]!.end - sorted[left]!.start > budget) {
      const leaving = sorted[left]!;
      const count = windowCounts.get(leaving.term)!;
      if (count === 1) {
        windowCounts.delete(leaving.term);
        distinctScore -= weight(leaving.term);
        distinctLength -= leaving.term.length;
      } else {
        windowCounts.set(leaving.term, count - 1);
      }
      left++;
    }

    const entering = sorted[right]!;
    const enteringCount = windowCounts.get(entering.term) ?? 0;
    if (enteringCount === 0) {
      distinctScore += weight(entering.term);
      distinctLength += entering.term.length;
    }
    windowCounts.set(entering.term, enteringCount + 1);

    const clusterStart = sorted[left]!.start;
    const clusterEnd = sorted[right]!.end;
    const better =
      distinctScore > bestScore ||
      (distinctScore === bestScore && distinctLength > bestDistinctLength) ||
      (distinctScore === bestScore &&
        distinctLength === bestDistinctLength &&
        clusterStart < bestStart);
    if (better) {
      bestScore = distinctScore;
      bestDistinctLength = distinctLength;
      bestStart = clusterStart;
      bestWindow = { start: clusterStart, end: clusterEnd };
    }
  }

  if (bestWindow === null) return null;
  return Math.floor((bestWindow.start + bestWindow.end) / 2);
}

/**
 * Folds `raw` one character (code point) at a time, concatenating the
 * results, and records for every emitted folded character which raw
 * character produced it — so a match found in the folded string can be
 * mapped back to raw coordinates.
 */
function foldRawWithMap(raw: string): { text: string; map: number[] } {
  const chars: string[] = [];
  const map: number[] = [];
  let rawIndex = 0;
  for (const ch of raw) {
    const folded = foldForMatch(ch);
    for (const fc of folded) {
      chars.push(fc);
      map.push(rawIndex);
    }
    rawIndex += ch.length;
  }
  return { text: chars.join(""), map };
}
