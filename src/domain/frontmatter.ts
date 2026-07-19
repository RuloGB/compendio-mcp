import { ESTADOS, TIPOS, type DocumentMeta, type Estado, type Tipo } from "./model.js";

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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validates a document against the documentation convention: required
 * frontmatter fields (tipo, modulo, estado) with allowed values, plus an H1
 * title. Invalid documents are reported and skipped by the indexer, which
 * doubles as a free linter for the convention.
 */
export function validateFrontmatter(input: FrontmatterInput): FrontmatterResult {
  const errores: string[] = [];
  const { data } = input;

  const tipo = data["tipo"];
  if (!isNonEmptyString(tipo)) {
    errores.push("frontmatter sin campo obligatorio 'tipo'");
  } else if (!TIPOS.includes(tipo as Tipo)) {
    errores.push(`'tipo' invalido: "${tipo}" (permitidos: ${TIPOS.join(", ")})`);
  }

  const modulo = data["modulo"];
  if (!isNonEmptyString(modulo)) {
    errores.push("frontmatter sin campo obligatorio 'modulo'");
  }

  const estado = data["estado"];
  if (!isNonEmptyString(estado)) {
    errores.push("frontmatter sin campo obligatorio 'estado'");
  } else if (!ESTADOS.includes(estado as Estado)) {
    errores.push(`'estado' invalido: "${estado}" (permitidos: ${ESTADOS.join(", ")})`);
  }

  if (!isNonEmptyString(input.titulo)) {
    errores.push("el documento no tiene titulo H1");
  }

  const etiquetasRaw = data["etiquetas"];
  let etiquetas: string[] = [];
  if (etiquetasRaw !== undefined && etiquetasRaw !== null) {
    if (Array.isArray(etiquetasRaw) && etiquetasRaw.every((e) => typeof e === "string")) {
      etiquetas = etiquetasRaw.map((e) => e.trim().toLowerCase()).filter((e) => e.length > 0);
    } else {
      errores.push("'etiquetas' debe ser una lista de cadenas");
    }
  }

  if (errores.length > 0) {
    return { ok: false, errores };
  }

  const meta: DocumentMeta = {
    ruta: input.ruta,
    titulo: input.titulo.trim(),
    resumen: input.resumen.trim(),
    tipo: tipo as Tipo,
    modulo: (modulo as string).trim(),
    estado: estado as Estado,
    etiquetas,
    hash: input.hash,
  };
  const propietario = data["propietario"];
  if (isNonEmptyString(propietario)) meta.propietario = propietario.trim();
  const actualizado = data["actualizado"];
  if (isNonEmptyString(actualizado)) {
    meta.actualizado = actualizado.trim();
  } else if (actualizado instanceof Date) {
    meta.actualizado = actualizado.toISOString().slice(0, 10);
  }
  return { ok: true, meta };
}
