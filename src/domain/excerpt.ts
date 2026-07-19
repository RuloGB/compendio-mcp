const MAX_EXCERPT_CHARS = 240;

/**
 * Builds the 2-3 line excerpt returned by search: strips heading lines and
 * light markdown syntax, collapses whitespace, and cuts at a word boundary.
 * Keeps `search_docs` responses inside the token budget.
 */
export function buildExcerpt(markdown: string, maxChars: number = MAX_EXCERPT_CHARS): string {
  const text = markdown
    .split("\n")
    .filter((line) => !/^\s*#{1,6}\s/.test(line))
    .join(" ")
    .replace(/```[^`]*```/g, " ")
    .replace(/[`*_>|]/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > maxChars / 2 ? lastSpace : maxChars)}…`;
}
