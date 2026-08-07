import {
  applyOptionalFields,
  isNonEmptyString,
  resolveTags,
  type FrontmatterInput,
  type FrontmatterResult,
} from "./frontmatter.js";
import type { IndexEntry } from "./index-markdown.js";
import type { DocumentMeta } from "./model.js";

/**
 * Project-level documentation convention configuration. Built from
 * `compendio.config.json`'s `convention` block by `src/infrastructure/config.ts`.
 */
export interface ConventionConfig {
  mode: "loose" | "strict";
  /** Declared type taxonomy; enforced only under strict. */
  types?: string[];
  /** Declared status taxonomy; enforced only under strict. */
  statuses?: string[];
  /** Deny-list applied by search; default []. */
  excludedStatuses: string[];
  /** Frontmatter source key per field; default identity ({ type: "type", ... }). */
  frontmatterFields: { type: string; module: string; status: string };
}

/** Resolves raw frontmatter+parse output into validated document metadata. */
export interface ConventionPolicy {
  resolver(input: FrontmatterInput): FrontmatterResult;
}

/** Reads a frontmatter field by its configured source key; empty string/null/non-string count as absent. */
function readField(data: Record<string, unknown>, key: string): string | undefined {
  const raw = data[key];
  return isNonEmptyString(raw) ? raw.trim() : undefined;
}

/**
 * First POSIX path segment within the document's containing declared root,
 * i.e. the folder-derived module; undefined for a file at its root's top
 * level. `rootPrefixes` are declared-root aliases (`ResolvedRoot.prefix`,
 * `resolveRoots`'s output) -- at most one matching `<prefix>/` is stripped
 * before taking the first remaining segment, so `module` keeps meaning "the
 * folder this document sits in within its own root" rather than degrading
 * into "which root it came from" (design.md Decision 7). "First match wins"
 * is unambiguous only because `resolveRoots` rejects nested roots -- two
 * prefixes can never both match the same path.
 *
 * With no `rootPrefixes` argument (or none matching), falls through to the
 * naive first-segment behavior unchanged -- this is what every existing
 * call site with no root context relies on.
 */
export function inferModule(path: string, rootPrefixes?: readonly string[]): string | undefined {
  const prefix = rootPrefixes?.find((p) => path.startsWith(`${p}/`));
  const rest = prefix !== undefined ? path.slice(prefix.length + 1) : path;
  const idx = rest.indexOf("/");
  return idx === -1 ? undefined : rest.slice(0, idx);
}

/** Basename minus `.md`, `-`/`_` -> space, collapse+trim whitespace, sentence-case the first character. */
export function humanizeFileName(path: string): string {
  const base = path.split("/").pop() ?? path;
  const withoutExtension = base.endsWith(".md") ? base.slice(0, -3) : base;
  const collapsed = withoutExtension.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return collapsed;
  return collapsed.charAt(0).toUpperCase() + collapsed.slice(1);
}

/**
 * `loose` (default): infers `title`/`module`, never invents `type`/`status`,
 * never hard-fails for metadata reasons.
 */
function createLoosePolicy(cfg: ConventionConfig, rootPrefixes?: readonly string[]): ConventionPolicy {
  return {
    resolver(input: FrontmatterInput): FrontmatterResult {
      const { data } = input;
      const tagsResult = resolveTags(data);
      if (tagsResult.error !== undefined) {
        return { ok: false, errors: [tagsResult.error] };
      }

      const title = isNonEmptyString(input.title)
        ? input.title.trim()
        : humanizeFileName(input.path);
      const type = readField(data, cfg.frontmatterFields.type);
      const status = readField(data, cfg.frontmatterFields.status);
      const module = readField(data, cfg.frontmatterFields.module) ?? inferModule(input.path, rootPrefixes);

      const meta: DocumentMeta = {
        path: input.path,
        title,
        summary: input.summary.trim(),
        tags: tagsResult.tags,
        hash: input.hash,
      };
      if (type !== undefined) meta.type = type;
      if (module !== undefined) meta.module = module;
      if (status !== undefined) meta.status = status;
      applyOptionalFields(meta, data);
      return { ok: true, meta };
    },
  };
}

/**
 * `strict`: linter against declared taxonomies (or presence-only when a
 * taxonomy isn't declared for that field). No inference of any kind.
 */
function createStrictPolicy(cfg: ConventionConfig): ConventionPolicy {
  return {
    resolver(input: FrontmatterInput): FrontmatterResult {
      const { data } = input;
      const errors: string[] = [];

      const type = readField(data, cfg.frontmatterFields.type);
      if (type === undefined) {
        errors.push(`frontmatter is missing required field '${cfg.frontmatterFields.type}'`);
      } else if (cfg.types !== undefined && !cfg.types.includes(type)) {
        errors.push(`invalid 'type': "${type}" (allowed: ${cfg.types.join(", ")})`);
      }

      const module = readField(data, cfg.frontmatterFields.module);
      if (module === undefined) {
        errors.push(`frontmatter is missing required field '${cfg.frontmatterFields.module}'`);
      }

      const status = readField(data, cfg.frontmatterFields.status);
      if (status === undefined) {
        errors.push(`frontmatter is missing required field '${cfg.frontmatterFields.status}'`);
      } else if (cfg.statuses !== undefined && !cfg.statuses.includes(status)) {
        errors.push(`invalid 'status': "${status}" (allowed: ${cfg.statuses.join(", ")})`);
      }

      if (!isNonEmptyString(input.title)) {
        errors.push("the document has no H1 title");
      }

      const tagsResult = resolveTags(data);
      if (tagsResult.error !== undefined) errors.push(tagsResult.error);

      if (errors.length > 0) {
        return { ok: false, errors };
      }

      const meta: DocumentMeta = {
        path: input.path,
        title: input.title.trim(),
        summary: input.summary.trim(),
        tags: tagsResult.tags,
        hash: input.hash,
      };
      if (type !== undefined) meta.type = type;
      if (module !== undefined) meta.module = module;
      if (status !== undefined) meta.status = status;
      applyOptionalFields(meta, data);
      return { ok: true, meta };
    },
  };
}

/**
 * Builds the convention policy selected by `cfg.mode`. `rootPrefixes`
 * (declared-root aliases) is threaded into `loose`'s folder-based `module`
 * inference only -- `strict` never infers `module` (it validates presence
 * only), so it ignores the parameter (design.md Decision 7). Optional so the
 * ~30 existing call sites with no root context compile and behave unchanged.
 */
export function createConventionPolicy(
  cfg: ConventionConfig,
  rootPrefixes?: readonly string[],
): ConventionPolicy {
  return cfg.mode === "strict" ? createStrictPolicy(cfg) : createLoosePolicy(cfg, rootPrefixes);
}

/**
 * Builds the INDEX.md / docs_overview ordering comparator: default
 * alphabetical by `path`; under `strict` with a declared `types` taxonomy,
 * declared-order-then-alphabetical-by-`path` tie-break.
 */
export function createIndexComparator(
  cfg: ConventionConfig,
): (a: IndexEntry, b: IndexEntry) => number {
  if (cfg.mode === "strict" && cfg.types !== undefined && cfg.types.length > 0) {
    const types = cfg.types;
    return (a, b) => {
      const diff = types.indexOf(a.type ?? "") - types.indexOf(b.type ?? "");
      if (diff !== 0) return diff;
      return a.path.localeCompare(b.path);
    };
  }
  return (a, b) => a.path.localeCompare(b.path);
}
