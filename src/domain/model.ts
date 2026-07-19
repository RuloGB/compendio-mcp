/**
 * Core domain model. Field names in Spanish mirror the data contract defined
 * in docs/compendio-mvp.md (database columns and MCP tool responses).
 */

export const TIPOS = ["funcional", "adr", "api", "qa", "guia"] as const;
export type Tipo = (typeof TIPOS)[number];

export const ESTADOS = ["borrador", "vigente", "obsoleto"] as const;
export type Estado = (typeof ESTADOS)[number];

/** Metadata of an indexed markdown document (one per .md file). */
export interface DocumentMeta {
  /** Path relative to the docs directory, POSIX separators. */
  ruta: string;
  /** H1 title. */
  titulo: string;
  /** First paragraph after the H1. */
  resumen: string;
  tipo: Tipo;
  modulo: string;
  estado: Estado;
  propietario?: string;
  etiquetas: string[];
  actualizado?: string;
  /** SHA-256 of the raw file content (basis for future incremental indexing). */
  hash: string;
}

/** A section-level fragment of a document (one per H2/H3, after merging). */
export interface Chunk {
  /** Heading path, e.g. "Reglas de negocio > Reglas de duplicidad". */
  encabezado: string;
  /** Raw markdown of the section, including its heading line. */
  contenido: string;
  /** Position of the chunk within the document. */
  orden: number;
}

export interface IndexedDocument extends DocumentMeta {
  id: number;
}

export interface IndexedChunk extends Chunk {
  id: number;
  documentId: number;
}

export type SearchMode = "hibrido" | "lexico";

export interface SearchFilters {
  tipo?: Tipo;
  modulo?: string;
  etiquetas?: string[];
  /** Allowed estados; undefined means no restriction. */
  estados?: Estado[];
}

export interface SearchResultItem {
  ruta: string;
  titulo: string;
  seccion: string;
  extracto: string;
  estado: Estado;
  score: number;
}

export interface SearchResponse {
  modo: SearchMode;
  resultados: SearchResultItem[];
}
