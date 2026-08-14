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
  return mergeConfig(structuredClone(DEFAULT_CONFIG), parsed as Partial<CompendioConfig>);
}

// Every branch below is an explicit key-by-key build, never a spread: a raw
// parsed config may carry keys the type does not declare (a typo, a retired
// key), and building explicitly ensures none of them leak into the returned
// config -- true of every branch here, not just `search`'s (design.md
// Decision 4).
function mergeConfig(base: CompendioConfig, override: Partial<CompendioConfig>): CompendioConfig {
  return {
    docsDir: override.docsDir ?? base.docsDir,
    exclude: override.exclude ?? base.exclude,
    db: override.db ?? base.db,
    embeddings: {
      provider: override.embeddings?.provider ?? base.embeddings.provider,
      model: override.embeddings?.model ?? base.embeddings.model,
    },
    chunk: {
      minTokens: positiveNumber(override.chunk?.minTokens) ?? base.chunk.minTokens,
      maxTokens: positiveNumber(override.chunk?.maxTokens) ?? base.chunk.maxTokens,
    },
    search: { k: positiveInteger(override.search?.k) ?? base.search.k },
    sync: { throttleMs: positiveNumber(override.sync?.throttleMs) ?? base.sync.throttleMs },
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
