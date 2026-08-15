import type { DocumentMeta } from "./model.js";
import { normalizeTags } from "./tags.js";

export interface FrontmatterInput {
  /** Parsed YAML frontmatter, as returned by the markdown parser. */
  data: Record<string, unknown>;
  path: string;
  title: string;
  summary: string;
  hash: string;
}

export type FrontmatterResult =
  | { ok: true; meta: DocumentMeta }
  | { ok: false; errors: string[] };

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export interface TagsResult {
  tags: string[];
  error?: string;
}

/**
 * Normalizes the `tags` frontmatter field: lowercased, trimmed, empty
 * entries dropped. Reports an error when present but not a list of strings.
 */
export function resolveTags(data: Record<string, unknown>): TagsResult {
  const raw = data["tags"];
  if (raw === undefined || raw === null) return { tags: [] };
  if (Array.isArray(raw) && raw.every((e) => typeof e === "string")) {
    return { tags: normalizeTags(raw) };
  }
  return { tags: [], error: "'tags' must be a list of strings" };
}

/**
 * Attaches the optional owner/updated pass-through fields to a
 * `DocumentMeta` object literal in place. Shared by both convention policies
 * so the normalization (date -> `YYYY-MM-DD`, trimming) stays in one place.
 */
export function applyOptionalFields(meta: DocumentMeta, data: Record<string, unknown>): void {
  const owner = data["owner"];
  if (isNonEmptyString(owner)) meta.owner = owner.trim();
  const updated = data["updated"];
  if (isNonEmptyString(updated)) {
    meta.updated = updated.trim();
  } else if (updated instanceof Date) {
    meta.updated = updated.toISOString().slice(0, 10);
  }
}
