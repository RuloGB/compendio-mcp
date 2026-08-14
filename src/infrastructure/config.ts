import { readFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ConventionConfig } from "../domain/convention.js";
import { INDEX_FILE } from "../domain/index-markdown.js";

export interface CompendioConfig {
  /**
   * Declared documentation roots. Non-empty, always an array — there is no
   * single-string form and no "multi-root mode". Every discovered document
   * `path` is prefixed with its root's alias (see `resolveRoots`), including
   * with the single-element default.
   */
  docsDir: string[];
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
   * Documentation convention: zero-config `loose` inference vs opt-in
   * `strict` linting. `excludedStatuses` (the search deny-list) lives here,
   * not under `search`.
   */
  convention: ConventionConfig;
}

export const CONFIG_FILE = "compendio.config.json";

/**
 * File names (relative path or basename) exempt from heading-based
 * chunking -- split by size only, via `splitToBound`, never by internal
 * headings. Still emits a single chunk when the body fits within
 * `maxTokens`; splits into several bounded chunks otherwise.
 */
// es-frozen: filename in the Spanish `ejemplos/` reference corpus; translating
// it would change the corpus chunk count and move the eval baseline.
export const NO_CHUNKING = ["glosario.md"];

/** Default incremental-sync throttle: 30 seconds. */
export const DEFAULT_THROTTLE_MS = 30000;

export const DEFAULT_CONFIG: CompendioConfig = {
  docsDir: ["docs"],
  exclude: [INDEX_FILE],
  db: ".compendio/compendio.db",
  embeddings: { provider: "local", model: "Xenova/multilingual-e5-small" },
  chunk: { minTokens: 100, maxTokens: 480 },
  search: { k: 5 },
  sync: { throttleMs: DEFAULT_THROTTLE_MS },
  convention: {
    mode: "loose",
    excludedStatuses: [],
    frontmatterFields: { type: "type", module: "module", status: "status" },
  },
};

/**
 * One thing `loadConfig` had to ignore or override in the declared config.
 * Structured rather than pre-rendered, mirroring `EncodingNotice` /
 * `formatEncodingNotice` (`domain/ports.ts`, `application/index-documents.ts`)
 * -- the adapters own the wording, never the loader (design.md Decision 5).
 */
export type ConfigWarningKind = "invalid-value" | "unknown-key" | "inverted-chunk-bounds";

export interface ConfigWarning {
  kind: ConfigWarningKind;
  /** Dotted key path exactly as written in the file: `chunk.maxTokens`,
   * `chunk.maxtokens`. For `inverted-chunk-bounds`, names both keys, joined
   * by `/`. */
  key: string;
  /** `JSON.stringify` of the declared value. Absent for `unknown-key`. */
  declared?: string;
  /** The value actually in force. Absent when nothing fell back. */
  inEffect?: number;
}

export interface ConfigLoadReport {
  config: CompendioConfig;
  /** Empty on a clean load; never absent. */
  warnings: ConfigWarning[];
}

/**
 * Loads compendio.config.json from the project root, merged over defaults,
 * plus every `ConfigWarning` the load produced: an invalid declared numeric
 * value, an unrecognized key under a whitelisted branch, or an inverted
 * `chunk.minTokens`/`chunk.maxTokens` pair (design.md Decision 5).
 * `warnings` is always an array, never absent -- empty on a clean load,
 * including when no `compendio.config.json` exists at all.
 */
export function loadConfigReport(root: string): ConfigLoadReport {
  let raw: string;
  try {
    raw = readFileSync(join(root, CONFIG_FILE), "utf8");
  } catch {
    return { config: structuredClone(DEFAULT_CONFIG), warnings: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${CONFIG_FILE} no es JSON valido: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const warnings: ConfigWarning[] = [];
  const config = mergeConfig(structuredClone(DEFAULT_CONFIG), parsed as Partial<CompendioConfig>, warnings);
  return { config, warnings };
}

/**
 * Loads compendio.config.json from the project root, merged over defaults.
 * Every key has a default: in a repo following the convention the tool works
 * with no config file at all. Thin wrapper over `loadConfigReport` -- see it
 * for the warnings a caller that needs them should read instead
 * (`createContainer` is the one caller that does; the two `scripts/*.mjs`
 * probes and every other call site want `CompendioConfig` alone).
 */
export function loadConfig(root: string): CompendioConfig {
  return loadConfigReport(root).config;
}

/**
 * `${key}: ...` -- one rendered line per warning kind, mirroring
 * `formatEncodingNotice` (`application/index-documents.ts`). Exact wording is
 * not spec-pinned (design.md Open Question 3): the contract pins only that a
 * report is produced and where it surfaces, never the string.
 */
export function formatConfigWarning(warning: ConfigWarning): string {
  switch (warning.kind) {
    case "invalid-value":
      return `${warning.key}: invalid declared value ${warning.declared} -- falling back to ${warning.inEffect}`;
    case "unknown-key":
      return `${warning.key}: unrecognized config key -- ignored`;
    case "inverted-chunk-bounds":
      return `${warning.key}: chunk.minTokens is greater than chunk.maxTokens (declared ${warning.declared}) -- both honored unchanged`;
  }
}

/** One numeric key's resolution: the value in force, and whether a declared
 * value was present but rejected by its predicate -- distinct from "not
 * declared at all", which also resolves to `value: fallback` but is not
 * itself a fact worth reporting or worth guarding the inverted-bounds check
 * against. */
interface NumericResolution {
  value: number;
  invalid: boolean;
}

function resolveNumeric(
  key: string,
  declared: unknown,
  fallback: number,
  predicate: (value: unknown) => number | undefined,
  warnings: ConfigWarning[],
): NumericResolution {
  if (declared === undefined) return { value: fallback, invalid: false };
  const validated = predicate(declared);
  if (validated !== undefined) return { value: validated, invalid: false };
  warnings.push({ kind: "invalid-value", key, declared: JSON.stringify(declared), inEffect: fallback });
  return { value: fallback, invalid: true };
}

/** Pushes one `unknown-key` warning per key present in `raw` but absent from
 * `recognized` -- the enumeration side of the same whitelists `mergeConfig`'s
 * explicit key-by-key builds already apply (design.md Decision 4 built the
 * whitelist; Decision 5 is what makes it observable). */
function collectUnknownKeys(
  prefix: string,
  raw: unknown,
  recognized: readonly string[],
  warnings: ConfigWarning[],
): void {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return;
  for (const key of Object.keys(raw)) {
    if (!recognized.includes(key)) {
      warnings.push({ kind: "unknown-key", key: `${prefix}.${key}` });
    }
  }
}

// Every branch below is an explicit key-by-key build, never a spread: a raw
// parsed config may carry keys the type does not declare (a typo, a retired
// key), and building explicitly ensures none of them leak into the returned
// config -- true of every branch here, not just `search`'s (design.md
// Decision 4). `warnings` accumulates every fact this function had to ignore
// or override (design.md Decision 5); `loadConfig` never reads it.
function mergeConfig(
  base: CompendioConfig,
  override: Partial<CompendioConfig>,
  warnings: ConfigWarning[],
): CompendioConfig {
  collectUnknownKeys("chunk", override.chunk, ["minTokens", "maxTokens"], warnings);
  collectUnknownKeys("embeddings", override.embeddings, ["provider", "model"], warnings);
  collectUnknownKeys("search", override.search, ["k"], warnings);
  collectUnknownKeys(
    "convention.frontmatterFields",
    override.convention?.frontmatterFields,
    ["type", "module", "status"],
    warnings,
  );

  const minTokens = resolveNumeric(
    "chunk.minTokens",
    override.chunk?.minTokens,
    base.chunk.minTokens,
    positiveNumber,
    warnings,
  );
  const maxTokens = resolveNumeric(
    "chunk.maxTokens",
    override.chunk?.maxTokens,
    base.chunk.maxTokens,
    positiveNumber,
    warnings,
  );
  // Only checked when both keys resolved to a genuinely valid state (default
  // or a validly declared value): an already-invalid key's fallback is
  // reported on its own, and comparing an arbitrary fallback against the
  // other key would be a second, confusing warning about the same mistake
  // (design.md Decision 8).
  if (!minTokens.invalid && !maxTokens.invalid && minTokens.value > maxTokens.value) {
    warnings.push({
      kind: "inverted-chunk-bounds",
      key: "chunk.minTokens/chunk.maxTokens",
      declared: JSON.stringify({ minTokens: minTokens.value, maxTokens: maxTokens.value }),
    });
  }

  return {
    docsDir: override.docsDir ?? base.docsDir,
    exclude: override.exclude ?? base.exclude,
    db: override.db ?? base.db,
    embeddings: {
      provider: override.embeddings?.provider ?? base.embeddings.provider,
      model: override.embeddings?.model ?? base.embeddings.model,
    },
    chunk: { minTokens: minTokens.value, maxTokens: maxTokens.value },
    search: {
      k: resolveNumeric("search.k", override.search?.k, base.search.k, positiveInteger, warnings).value,
    },
    sync: {
      throttleMs: resolveNumeric(
        "sync.throttleMs",
        override.sync?.throttleMs,
        base.sync.throttleMs,
        positiveNumber,
        warnings,
      ).value,
    },
    convention: mergeConvention(base.convention, override.convention),
  };
}

/** A declared numeric config value is honored only when it is a finite
 * number greater than 0. Anything else -- non-numeric (a quoted number,
 * `null`, a boolean, an array, an object), zero, negative, or `Infinity`
 * (reachable as `1e400`; `NaN` is not, the JSON grammar has no literal for
 * it) -- is treated the same as an absent key and falls back to the default.
 * NEVER clamps: any finite positive value, however small, is accepted
 * (configuration/spec.md's `throttleMs` MUST, generalized to every numeric
 * key). */
function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** `search.k` additionally: a whole number. It is a result count, and both
 * input adapters already require an integer -- `z.number().int().min(1).max(20)`
 * (server.ts) and `parsePositiveInt` (cli.ts). The config path is the only
 * one that did not, which is this change's whole premise. No ceiling: 20 is
 * the MCP adapter's per-call cap, not a config bound, and adding one here
 * would be the clamping configuration/spec.md forbids. */
function positiveInteger(value: unknown): number | undefined {
  const n = positiveNumber(value);
  return n !== undefined && Number.isInteger(n) ? n : undefined;
}

/**
 * Two-level merge: `mode`/`types`/`statuses`/`excludedStatuses` are
 * whole-value replaces (same pattern as `exclude`); `frontmatterFields`
 * merges per key so declaring one mapped field never wipes its siblings'
 * identity defaults.
 */
function mergeConvention(
  base: ConventionConfig,
  override: Partial<ConventionConfig> | undefined,
): ConventionConfig {
  const types = override?.types ?? base.types;
  const statuses = override?.statuses ?? base.statuses;
  return {
    mode: override?.mode ?? base.mode,
    ...(types !== undefined ? { types } : {}),
    ...(statuses !== undefined ? { statuses } : {}),
    excludedStatuses: override?.excludedStatuses ?? base.excludedStatuses,
    // Explicit whitelist, not a spread (design.md Decision 4): each key
    // falls back independently, so declaring one mapped field never wipes
    // its siblings' identity defaults, and an unrecognized key (e.g. a
    // mistyped `maxtokens`) can never leak into the returned config.
    frontmatterFields: {
      type: override?.frontmatterFields?.type ?? base.frontmatterFields.type,
      module: override?.frontmatterFields?.module ?? base.frontmatterFields.module,
      status: override?.frontmatterFields?.status ?? base.frontmatterFields.status,
    },
  };
}

/** One declared documentation root, normalized and given its path-prefix alias. */
export interface ResolvedRoot {
  /** Exactly as written in config or `--dir`. */
  declared: string;
  /** Absolute, `resolve(projectRoot, declared)`. */
  dir: string;
  /** The alias every document under this root is prefixed with: `basename(dir)`. Never empty. */
  prefix: string;
}

/**
 * Normalizes and validates a declared `docsDir` array in one pass: resolves
 * each entry to an absolute directory and derives its path-prefix alias
 * (`basename` of the resolved path), then rejects — before any document is
 * discovered or written — a set that is empty, wrongly typed, contains a
 * duplicate or nested pair (checked as an ordered pair in both directions,
 * via `path.relative` rather than string equality of resolved paths — see
 * design.md Decision 5), or derives a colliding alias.
 *
 * Returns at least one `ResolvedRoot`; `roots[0]` is the first declared root
 * (the `INDEX.md` target, see design.md Decision 9).
 */
export function resolveRoots(projectRoot: string, docsDir: string[]): ResolvedRoot[] {
  if (!Array.isArray(docsDir)) {
    throw new Error("docsDir must be an array of documentation root paths");
  }
  if (docsDir.length === 0) {
    throw new Error("docsDir must declare at least one documentation root");
  }
  docsDir.forEach((entry: unknown, index) => {
    if (typeof entry !== "string") {
      throw new Error(`docsDir entries must be strings; entry ${index} is ${typeof entry}`);
    }
  });

  const roots: ResolvedRoot[] = docsDir.map((declared) => {
    const dir = resolve(projectRoot, declared);
    const prefix = basename(dir);
    if (prefix === "") {
      throw new Error(
        `docsDir root "${declared}" resolves to a filesystem root (${dir}) and has no directory name to use as a path prefix`,
      );
    }
    return { declared, dir, prefix };
  });

  // Ordered-pair sweep, both directions: a one-directional containment check
  // misses the inner-root-declared-first case (design.md Decision 5, P1).
  for (const a of roots) {
    for (const b of roots) {
      if (a === b) continue;
      const rel = relative(a.dir, b.dir);
      if (rel === "") {
        throw new Error(
          `docsDir declares the same documentation root twice: "${a.declared}" and "${b.declared}" both resolve to ${a.dir}`,
        );
      }
      if (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`)) {
        throw new Error(
          `docsDir declares nested documentation roots: "${b.declared}" (${b.dir}) lies inside "${a.declared}" (${a.dir}); every file under the inner root would be discovered twice under the same path`,
        );
      }
    }
  }

  for (let i = 0; i < roots.length; i += 1) {
    for (let j = i + 1; j < roots.length; j += 1) {
      const a = roots[i]!;
      const b = roots[j]!;
      if (a.prefix === b.prefix) {
        throw new Error(
          `docsDir declares two roots with the same directory name: "${a.declared}" and "${b.declared}" both use the path prefix "${a.prefix}"`,
        );
      }
    }
  }

  return roots;
}
