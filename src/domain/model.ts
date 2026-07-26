/**
 * Core domain model. Field names in Spanish mirror the public data contract
 * (database columns and MCP tool responses).
 */

/** Metadata of an indexed markdown document (one per .md file). */
export interface DocumentMeta {
  /** Path relative to the docs directory, POSIX separators. */
  path: string;
  /** H1 title. */
  title: string;
  /** First paragraph after the H1. */
  summary: string;
  /** Open string, project-defined; absent when not declared/inferred. */
  type?: string;
  /** Open string, project-defined; absent for root-level files with no mapping/inference. */
  module?: string;
  /** Open string, project-defined; absent when not declared/inferred. */
  status?: string;
  owner?: string;
  tags: string[];
  updated?: string;
  /** SHA-256 of the raw file content (basis for future incremental indexing). */
  hash: string;
}

/** A section-level fragment of a document (one per H2/H3, after merging). */
export interface Chunk {
  /** Heading path, e.g. "Reglas de negocio > Reglas de duplicidad". */
  heading: string;
  /** Raw markdown of the section, including its heading line. */
  content: string;
  /** Position of the chunk within the document. */
  position: number;
}

export interface IndexedDocument extends DocumentMeta {
  id: number;
}

export interface IndexedChunk extends Chunk {
  id: number;
  documentId: number;
}

export type SearchMode = "hybrid" | "lexical";

export interface SearchFilters {
  /** Open string, project-defined; empty/whitespace treated as absent by callers. */
  type?: string;
  module?: string;
  tags?: string[];
  /** Deny-list: documents whose status is in this list are excluded; NULL status is never excluded. */
  excludedStatuses?: string[];
}

export interface SearchResultItem {
  path: string;
  title: string;
  section: string;
  excerpt: string;
  /** Absent when the document has no status (never rendered as "" or a placeholder). */
  status?: string;
  score: number;
}

export interface SearchResponse {
  mode: SearchMode;
  results: SearchResultItem[];
}
