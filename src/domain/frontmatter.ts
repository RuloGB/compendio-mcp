import type { DocumentMeta } from "./model.js";

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
 * Normalizes the `etiquetas` frontmatter field: lowercased, trimmed, empty
 * entries dropped. Reports an error when present but not a list of strings.
 */
export function resolveTags(data: Record<string, unknown>): TagsResult {
  const raw = data["etiquetas"];
  if (raw === undefined || raw === null) return { tags: [] };
  if (Array.isArray(raw) && raw.every((e) => typeof e === "string")) {
    return { tags: raw.map((e) => e.trim().toLowerCase()).filter((e) => e.length > 0) };
  }
  return { tags: [], error: "'etiquetas' debe ser una lista de cadenas" };
}

/**
 * Attaches the optional owner/updated pass-through fields to a
 * `DocumentMeta` object literal in place. Shared by both convention policies
 * so the normalization (date -> `YYYY-MM-DD`, trimming) stays in one place.
 */
export function applyOptionalFields(meta: DocumentMeta, data: Record<string, unknown>): void {
  const owner = data["propietario"];
  if (isNonEmptyString(owner)) meta.owner = owner.trim();
  const updated = data["actualizado"];
  if (isNonEmptyString(updated)) {
    meta.updated = updated.trim();
  } else if (updated instanceof Date) {
    meta.updated = updated.toISOString().slice(0, 10);
  }
}
