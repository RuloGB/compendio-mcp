import { isAbsolute, normalize, relative } from "node:path";

export function sameRealPath(a: string, b: string): boolean {
  return normalizeForRealPathComparison(a) === normalizeForRealPathComparison(b);
}

export function isSameOrInsideRealPath(rootRealPath: string, candidateRealPath: string): boolean {
  const root = normalizeForRealPathComparison(rootRealPath);
  const candidate = normalizeForRealPathComparison(candidateRealPath);
  const path = relative(root, candidate);
  return path === "" || (path !== ".." && !path.startsWith("..\\") && !path.startsWith("../") && !isAbsolute(path));
}

function normalizeForRealPathComparison(path: string): string {
  const normalized = normalize(path);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
