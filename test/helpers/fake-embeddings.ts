import type { EmbeddingsProvider } from "../../src/domain/ports";
import { normalize } from "../../src/domain/similarity";

/**
 * Deterministic embeddings for tests: one dimension per concept group, valued
 * by stem presence. Texts sharing a concept ("duplicado" / "clonado") end up
 * close in vector space even with zero lexical overlap, which lets tests
 * exercise the semantic gap without downloading a real model.
 */
const CONCEPT_STEMS: string[][] = [
  ["duplicad", "duplicid", "repetid", "clonad"],
  ["postgres", "mongodb", "persistencia", "transaccion"],
  ["sso", "oidc", "autenticacion", "sesion", "credencial", "contrasen"],
  ["csv", "importacion", "carga masiva", "filas"],
  ["despliegue", "produccion", "rollback", "pipeline", "revertir", "migracion"],
  ["kpi", "panel", "metricas", "conversion", "indicador", "cuadro de mando"],
  ["validacion", "formulario", "obligatorio", "campos"],
  ["rgpd", "consentimiento", "privacidad"],
  ["email", "telefono", "correo", "contacto"],
];

export class FakeEmbeddings implements EmbeddingsProvider {
  async embed(textos: string[]): Promise<Float32Array[]> {
    return textos.map((texto) => vectorize(texto));
  }
}

export class BrokenEmbeddings implements EmbeddingsProvider {
  async embed(): Promise<Float32Array[]> {
    throw new Error("proveedor de embeddings roto (simulado)");
  }
}

function vectorize(texto: string): Float32Array {
  const normalized = normalize(texto);
  const vector = new Float32Array(CONCEPT_STEMS.length + 1);
  CONCEPT_STEMS.forEach((stems, i) => {
    for (const stem of stems) {
      if (normalized.includes(stem)) vector[i] += 1;
    }
  });
  // Small constant dimension so no vector is ever zero.
  vector[CONCEPT_STEMS.length] = 0.05;
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  for (let i = 0; i < vector.length; i++) vector[i]! /= norm;
  return vector;
}
