import {
  aplicarCamposOpcionales,
  isNonEmptyString,
  resolveEtiquetas,
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
  /** Declared tipo taxonomy; enforced only under estricto. */
  tipos?: string[];
  /** Declared estado taxonomy; enforced only under estricto. */
  estados?: string[];
  /** Deny-list applied by search; default []. */
  estadosExcluidos: string[];
  /** Frontmatter source key per field; default identity ({ tipo: "tipo", ... }). */
  camposFrontmatter: { tipo: string; modulo: string; estado: string };
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

/** First POSIX path segment, i.e. the folder-derived modulo; undefined for root-level files. */
export function inferirModulo(ruta: string): string | undefined {
  const idx = ruta.indexOf("/");
  return idx === -1 ? undefined : ruta.slice(0, idx);
}

/** Basename minus `.md`, `-`/`_` -> space, collapse+trim whitespace, sentence-case the first character. */
export function humanizarNombreArchivo(ruta: string): string {
  const base = ruta.split("/").pop() ?? ruta;
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
      const etiquetasResult = resolveEtiquetas(data);
      if (etiquetasResult.error !== undefined) {
        return { ok: false, errores: [etiquetasResult.error] };
      }

      const titulo = isNonEmptyString(input.titulo)
        ? input.titulo.trim()
        : humanizarNombreArchivo(input.ruta);
      const tipo = leerCampo(data, cfg.camposFrontmatter.tipo);
      const estado = leerCampo(data, cfg.camposFrontmatter.estado);
      const modulo = leerCampo(data, cfg.camposFrontmatter.modulo) ?? inferirModulo(input.ruta);

      const meta: DocumentMeta = {
        ruta: input.ruta,
        titulo,
        resumen: input.resumen.trim(),
        etiquetas: etiquetasResult.etiquetas,
        hash: input.hash,
      };
      if (tipo !== undefined) meta.tipo = tipo;
      if (modulo !== undefined) meta.modulo = modulo;
      if (estado !== undefined) meta.estado = estado;
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

      const tipo = leerCampo(data, cfg.camposFrontmatter.tipo);
      if (tipo === undefined) {
        errores.push(`frontmatter sin campo obligatorio '${cfg.camposFrontmatter.tipo}'`);
      } else if (cfg.tipos !== undefined && !cfg.tipos.includes(tipo)) {
        errores.push(`'tipo' invalido: "${tipo}" (permitidos: ${cfg.tipos.join(", ")})`);
      }

      const modulo = leerCampo(data, cfg.camposFrontmatter.modulo);
      if (modulo === undefined) {
        errores.push(`frontmatter sin campo obligatorio '${cfg.camposFrontmatter.modulo}'`);
      }

      const estado = leerCampo(data, cfg.camposFrontmatter.estado);
      if (estado === undefined) {
        errores.push(`frontmatter sin campo obligatorio '${cfg.camposFrontmatter.estado}'`);
      } else if (cfg.estados !== undefined && !cfg.estados.includes(estado)) {
        errores.push(`'estado' invalido: "${estado}" (permitidos: ${cfg.estados.join(", ")})`);
      }

      if (!isNonEmptyString(input.titulo)) {
        errores.push("el documento no tiene titulo H1");
      }

      const etiquetasResult = resolveEtiquetas(data);
      if (etiquetasResult.error !== undefined) errores.push(etiquetasResult.error);

      if (errores.length > 0) {
        return { ok: false, errores };
      }

      const meta: DocumentMeta = {
        ruta: input.ruta,
        titulo: input.titulo.trim(),
        resumen: input.resumen.trim(),
        etiquetas: etiquetasResult.etiquetas,
        hash: input.hash,
      };
      if (tipo !== undefined) meta.tipo = tipo;
      if (modulo !== undefined) meta.modulo = modulo;
      if (estado !== undefined) meta.estado = estado;
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
 * alphabetical by `ruta`; under `estricto` with a declared `tipos` taxonomy,
 * declared-order-then-alphabetical-by-`ruta` tie-break.
 */
export function crearComparadorIndice(
  cfg: ConvencionConfig,
): (a: IndexEntry, b: IndexEntry) => number {
  if (cfg.modo === "estricto" && cfg.tipos !== undefined && cfg.tipos.length > 0) {
    const tipos = cfg.tipos;
    return (a, b) => {
      const diff = tipos.indexOf(a.tipo ?? "") - tipos.indexOf(b.tipo ?? "");
      if (diff !== 0) return diff;
      return a.ruta.localeCompare(b.ruta);
    };
  }
  return (a, b) => a.ruta.localeCompare(b.ruta);
}
