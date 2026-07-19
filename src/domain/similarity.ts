/** Levenshtein edit distance, used to suggest close paths on broken links. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const previous = new Array<number>(b.length + 1);
  const current = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) previous[j] = j;
  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + cost);
    }
    for (let j = 0; j <= b.length; j++) previous[j] = current[j]!;
  }
  return previous[b.length]!;
}

/**
 * Returns the `limit` candidates closest to `target`, best first. Distance is
 * normalized by length so long paths are not unfairly penalized.
 */
export function closestMatches(target: string, candidates: string[], limit: number): string[] {
  const normalizedTarget = normalize(target);
  return candidates
    .map((candidate) => ({
      candidate,
      distance:
        levenshtein(normalizedTarget, normalize(candidate)) /
        Math.max(normalizedTarget.length, candidate.length, 1),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map((entry) => entry.candidate);
}

/** Lowercase and strip diacritics, for accent-insensitive comparisons. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}
