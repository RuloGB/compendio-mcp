import {
  aplicarCamposOpcionales,
  isNonEmptyString,
  resolveTags,
  type FrontmatterInput,
  type FrontmatterResult,
} from "./frontmatter.js";
import type { IndexEntry } from "./index-markdown.js";
import type { DocumentMeta } from "./model.js";

/**
 * Project-level documentation convention configuration. Built from
 * `compendio.config.json`'s `convencion` block by `src/infrastructure/config.ts`.
 */
export interface ConvencionConfig {
  modo: "libre" | "estricto";
  /** Declared type taxonomy; enforced only under estricto. */
  types?: string[];
  /** Declared status taxonomy; enforced only under estricto. */
  statuses?: string[];
  /** Deny-list applied by search; default []. */
  excludedStatuses: string[];
  /** Frontmatter source key per field; default identity ({ type: "tipo", ... }). */
  camposFrontmatter: { type: string; module: string; status: string };
}

/** Resolves raw frontmatter+parse output into validated document metadata. */
export interface ConvencionPolicy {
  resolver(input: FrontmatterInput): FrontmatterResult;
}

/** Reads a frontmatter field by its configured source key; empty string/null/non-string count as absent. */
function leerCampo(data: Record<string, unknown>, key: string): string | undefined {
  const raw = data[key];
  return isNonEmptyString(raw) ? raw.trim() : undefined;
}

/** First POSIX path segment, i.e. the folder-derived module; undefined for root-level files. */
export function inferirModulo(path: string): string | undefined {
  const idx = path.indexOf("/");
  return idx === -1 ? undefined : path.slice(0, idx);
}

/** Basename minus `.md`, `-`/`_` -> space, collapse+trim whitespace, sentence-case the first character. */
export function humanizarNombreArchivo(path: string): string {
  const base = path.split("/").pop() ?? path;
  const sinExtension = base.endsWith(".md") ? base.slice(0, -3) : base;
  const colapsado = sinExtension.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (colapsado.length === 0) return colapsado;
  return colapsado.charAt(0).toUpperCase() + colapsado.slice(1);
}

/**
 * `libre` (default): infers `titulo`/`modulo`, never invents `tipo`/`estado`,
 * never hard-fails for metadata reasons.
 */
function crearPoliticaLibre(cfg: ConvencionConfig): ConvencionPolicy {
  return {
    resolver(input: FrontmatterInput): FrontmatterResult {
      const { data } = input;
      const tagsResult = resolveTags(data);
      if (tagsResult.error !== undefined) {
        return { ok: false, errores: [tagsResult.error] };
      }

      const titulo = isNonEmptyString(input.titulo)
        ? input.titulo.trim()
        : humanizarNombreArchivo(input.path);
      const type = leerCampo(data, cfg.camposFrontmatter.type);
      const status = leerCampo(data, cfg.camposFrontmatter.status);
      const module = leerCampo(data, cfg.camposFrontmatter.module) ?? inferirModulo(input.path);

      const meta: DocumentMeta = {
        path: input.path,
        titulo,
        resumen: input.resumen.trim(),
        tags: tagsResult.tags,
        hash: input.hash,
      };
      if (type !== undefined) meta.type = type;
      if (module !== undefined) meta.module = module;
      if (status !== undefined) meta.status = status;
      aplicarCamposOpcionales(meta, data);
      return { ok: true, meta };
    },
  };
}

/**
 * `estricto`: linter against declared taxonomies (or presence-only when a
 * taxonomy isn't declared for that field). No inference of any kind.
 */
function crearPoliticaEstricta(cfg: ConvencionConfig): ConvencionPolicy {
  return {
    resolver(input: FrontmatterInput): FrontmatterResult {
      const { data } = input;
      const errores: string[] = [];

      const type = leerCampo(data, cfg.camposFrontmatter.type);
      if (type === undefined) {
        errores.push(`frontmatter sin campo obligatorio '${cfg.camposFrontmatter.type}'`);
      } else if (cfg.types !== undefined && !cfg.types.includes(type)) {
        errores.push(`'type' invalido: "${type}" (permitidos: ${cfg.types.join(", ")})`);
      }

      const module = leerCampo(data, cfg.camposFrontmatter.module);
      if (module === undefined) {
        errores.push(`frontmatter sin campo obligatorio '${cfg.camposFrontmatter.module}'`);
      }

      const status = leerCampo(data, cfg.camposFrontmatter.status);
      if (status === undefined) {
        errores.push(`frontmatter sin campo obligatorio '${cfg.camposFrontmatter.status}'`);
      } else if (cfg.statuses !== undefined && !cfg.statuses.includes(status)) {
        errores.push(`'status' invalido: "${status}" (permitidos: ${cfg.statuses.join(", ")})`);
      }

      if (!isNonEmptyString(input.titulo)) {
        errores.push("el documento no tiene titulo H1");
      }

      const tagsResult = resolveTags(data);
      if (tagsResult.error !== undefined) errores.push(tagsResult.error);

      if (errores.length > 0) {
        return { ok: false, errores };
      }

      const meta: DocumentMeta = {
        path: input.path,
        titulo: input.titulo.trim(),
        resumen: input.resumen.trim(),
        tags: tagsResult.tags,
        hash: input.hash,
      };
      if (type !== undefined) meta.type = type;
      if (module !== undefined) meta.module = module;
      if (status !== undefined) meta.status = status;
      aplicarCamposOpcionales(meta, data);
      return { ok: true, meta };
    },
  };
}

/** Builds the convention policy selected by `cfg.modo`. */
export function crearConvencionPolicy(cfg: ConvencionConfig): ConvencionPolicy {
  return cfg.modo === "estricto" ? crearPoliticaEstricta(cfg) : crearPoliticaLibre(cfg);
}

/**
 * Builds the INDEX.md / docs_overview ordering comparator: default
 * alphabetical by `path`; under `estricto` with a declared `types` taxonomy,
 * declared-order-then-alphabetical-by-`path` tie-break.
 */
export function crearComparadorIndice(
  cfg: ConvencionConfig,
): (a: IndexEntry, b: IndexEntry) => number {
  if (cfg.modo === "estricto" && cfg.types !== undefined && cfg.types.length > 0) {
    const types = cfg.types;
    return (a, b) => {
      const diff = types.indexOf(a.type ?? "") - types.indexOf(b.type ?? "");
      if (diff !== 0) return diff;
      return a.path.localeCompare(b.path);
    };
  }
  return (a, b) => a.path.localeCompare(b.path);
}
