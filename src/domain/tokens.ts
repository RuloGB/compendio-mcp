/**
 * Rough token estimate (~4 characters per token) from a character count.
 * Kept separate from `estimateTokens` so a caller that only knows a length
 * arithmetically (no string built yet -- read-document.ts's outline decision,
 * design.md R5) can reuse the exact same formula without allocating a string
 * just to measure it.
 */
export function tokensForLength(n: number): number {
  return Math.ceil(n / 4);
}

/**
 * Rough token estimate (~4 characters per token). Chunk size limits do not
 * need tokenizer precision; a stable approximation keeps the domain
 * dependency-free.
 */
export function estimateTokens(text: string): number {
  return tokensForLength(text.length);
}
