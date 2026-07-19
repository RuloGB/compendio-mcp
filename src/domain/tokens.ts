/**
 * Rough token estimate (~4 characters per token). Chunk size limits do not
 * need tokenizer precision; a stable approximation keeps the domain
 * dependency-free.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
