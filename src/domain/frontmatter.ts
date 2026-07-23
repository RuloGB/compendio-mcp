import type { DocumentMeta } from "./model.js";

export interface FrontmatterInput {
  /** Parsed YAML frontmatter, as returned by the markdown parser. */
  data: Record<string, unknown>;
  ruta: string;
  titulo: string;
  resumen: string;
  hash: string;
}

export type FrontmatterResult =
  | { ok: true; meta: DocumentMeta }
  | { ok: false; errores: string[] };

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export interface EtiquetasResult {
  etiquetas: string[];
  error?: string;
}

/**
 * Normalizes the `etiquetas` frontmatter field: lowercased, trimmed, empty
 * entries dropped. Reports an error when present but not a list of strings.
 */
export function resolveEtiquetas(data: Record<string, unknown>): EtiquetasResult {
  const raw = data["etiquetas"];
  if (raw === undefined || raw === null) return { etiquetas: [] };
  if (Array.isArray(raw) && raw.every((e) => typeof e === "string")) {
    return { etiquetas: raw.map((e) => e.trim().toLowerCase()).filter((e) => e.length > 0) };
  }
  return { etiquetas: [], error: "'etiquetas' debe ser una lista de cadenas" };
}

/**
 * Attaches the optional propietario/actualizado pass-through fields to a
 * `DocumentMeta` object literal in place. Shared by both convention policies
 * so the normalization (date -> `YYYY-MM-DD`, trimming) stays in one place.
 */
export function aplicarCamposOpcionales(meta: DocumentMeta, data: Record<string, unknown>): void {
  const propietario = data["propietario"];
  if (isNonEmptyString(propietario)) meta.propietario = propietario.trim();
  const actualizado = data["actualizado"];
  if (isNonEmptyString(actualizado)) {
    meta.actualizado = actualizado.trim();
  } else if (actualizado instanceof Date) {
    meta.actualizado = actualizado.toISOString().slice(0, 10);
  }
}
