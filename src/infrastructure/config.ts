import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ConvencionConfig } from "../domain/convencion.js";
import { INDEX_FILE } from "../domain/index-markdown.js";

export interface CompendioConfig {
  docsDir: string;
  exclude: string[];
  db: string;
  embeddings: {
    provider: "local";
    model: string;
  };
  chunk: {
    minTokens: number;
    maxTokens: number;
  };
  search: {
    k: number;
  };
  /**
   * Incremental-sync throttle: minimum interval, in milliseconds, between
   * throttled sync passes triggered by MCP tool calls (see Indexing spec's
   * "Incremental Sync Triggers"). A non-finite, negative, or zero declared
   * value falls back to the default, same as an absent key.
   */
  sync: {
    throttleMs: number;
  };
  /**
   * Documentation convention: zero-config `libre` inference vs opt-in
   * `estricto` linting. `excludedStatuses` (search deny-list) lives here,
   * not under `search` — the retired `search.estadosExcluidos` key is
   * warn-and-ignore, not a compatibility shim (see
   * `warnIfLegacyEstadosExcluidos`).
   */
  convencion: ConvencionConfig;
}

export const CONFIG_FILE = "compendio.config.json";

/** Files indexed as a single chunk (no heading-based chunking). */
export const SIN_CHUNKING = ["glosario.md"];

/** Default incremental-sync throttle: 30 seconds. */
export const DEFAULT_THROTTLE_MS = 30000;

export const DEFAULT_CONFIG: CompendioConfig = {
  docsDir: "docs",
  exclude: [INDEX_FILE],
  db: ".compendio/compendio.db",
  embeddings: { provider: "local", model: "Xenova/multilingual-e5-small" },
  chunk: { minTokens: 100, maxTokens: 800 },
  search: { k: 5 },
  sync: { throttleMs: DEFAULT_THROTTLE_MS },
  convencion: {
    modo: "libre",
    excludedStatuses: [],
    camposFrontmatter: { type: "tipo", module: "modulo", status: "estado" },
  },
};

/**
 * Loads compendio.config.json from the project root, merged over defaults.
 * Every key has a default: in a repo following the convention the tool works
 * with no config file at all.
 */
export function loadConfig(root: string): CompendioConfig {
  let raw: string;
  try {
    raw = readFileSync(join(root, CONFIG_FILE), "utf8");
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${CONFIG_FILE} no es JSON valido: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  warnIfLegacyEstadosExcluidos(parsed);
  return mergeConfig(structuredClone(DEFAULT_CONFIG), parsed as Partial<CompendioConfig>);
}

/**
 * Detects the retired top-level `search.estadosExcluidos` key and warns on
 * stderr. Warn-and-ignore, not a compatibility shim: the legacy value is
 * never read into the returned config, and no longer has any effect on
 * search, `docs_overview`, or `INDEX.md`.
 */
function warnIfLegacyEstadosExcluidos(parsed: unknown): void {
  if (typeof parsed !== "object" || parsed === null) return;
  const search = (parsed as Record<string, unknown>)["search"];
  if (typeof search !== "object" || search === null) return;
  if ("estadosExcluidos" in search) {
    console.error(
      `${CONFIG_FILE}: 'search.estadosExcluidos' esta obsoleto y ya no tiene ningun efecto; usa 'convencion.excludedStatuses'.`,
    );
  }
}

function mergeConfig(base: CompendioConfig, override: Partial<CompendioConfig>): CompendioConfig {
  return {
    docsDir: override.docsDir ?? base.docsDir,
    exclude: override.exclude ?? base.exclude,
    db: override.db ?? base.db,
    embeddings: { ...base.embeddings, ...override.embeddings },
    chunk: { ...base.chunk, ...override.chunk },
    // Explicit whitelist (not a spread): a raw parsed config may still carry
    // the retired `search.estadosExcluidos` key at runtime even though the
    // type no longer declares it — `warnIfLegacyEstadosExcluidos` warns, and
    // this line ensures it never leaks into the returned config.
    search: { k: override.search?.k ?? base.search.k },
    sync: { throttleMs: validThrottleMs(override.sync?.throttleMs) ?? base.sync.throttleMs },
    convencion: mergeConvencion(base.convencion, override.convencion),
  };
}

/** A declared `throttleMs` is valid only when it is a finite number greater
 * than 0; anything else (non-numeric, negative, zero) is treated the same as
 * an absent key and falls back to the default. */
function validThrottleMs(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Two-level merge: `modo`/`types`/`statuses`/`excludedStatuses` are
 * whole-value replaces (same pattern as `exclude`); `camposFrontmatter`
 * merges per key so declaring one mapped field never wipes its siblings'
 * identity defaults.
 */
function mergeConvencion(
  base: ConvencionConfig,
  override: Partial<ConvencionConfig> | undefined,
): ConvencionConfig {
  const types = override?.types ?? base.types;
  const statuses = override?.statuses ?? base.statuses;
  return {
    modo: override?.modo ?? base.modo,
    ...(types !== undefined ? { types } : {}),
    ...(statuses !== undefined ? { statuses } : {}),
    excludedStatuses: override?.excludedStatuses ?? base.excludedStatuses,
    camposFrontmatter: { ...base.camposFrontmatter, ...override?.camposFrontmatter },
  };
}
