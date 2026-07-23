/**
 * Core domain model. Field names in Spanish mirror the public data contract
 * (database columns and MCP tool responses).
 */

/** Metadata of an indexed markdown document (one per .md file). */
export interface DocumentMeta {
  /** Path relative to the docs directory, POSIX separators. */
  ruta: string;
  /** H1 title. */
  titulo: string;
  /** First paragraph after the H1. */
  resumen: string;
  /** Open string, project-defined; absent when not declared/inferred. */
  tipo?: string;
  /** Open string, project-defined; absent for root-level files with no mapping/inference. */
  modulo?: string;
  /** Open string, project-defined; absent when not declared/inferred. */
  estado?: string;
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
  /** Open string, project-defined; empty/whitespace treated as absent by callers. */
  tipo?: string;
  modulo?: string;
  etiquetas?: string[];
  /** Deny-list: documents whose estado is in this list are excluded; NULL estado is never excluded. */
  estadosExcluidos?: string[];
}

export interface SearchResultItem {
  ruta: string;
  titulo: string;
  seccion: string;
  extracto: string;
  /** Absent when the document has no estado (never rendered as "" or a placeholder). */
  estado?: string;
  score: number;
}

export interface SearchResponse {
  modo: SearchMode;
  resultados: SearchResultItem[];
}
