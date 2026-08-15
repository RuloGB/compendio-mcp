/**
 * Core domain model.
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

/**
 * Filters applied to a search, after normalization: every value present here
 * is one the caller meaningfully asked for.
 *
 * The three caller-supplied fields carry an obligation on whoever constructs
 * this object. `type` and `module` MUST be trimmed, and omitted entirely —
 * never set to `""` — when the result is blank. `tags` MUST be passed through
 * `normalizeTags` (`domain/tags.ts`), the same canonical form the indexer
 * stores them in. A blank value is a client mistake, never a request to match
 * the empty string, and it is dropped silently.
 *
 * `SearchDocuments.buildFilters` is the only producer in production code and
 * the only place the rule is enforced. Consumers — `IndexStore.searchLexical`
 * and `searchVector`, `buildFilterSql`, `dropImpossibleFilters`,
 * `explainEmptyResult` — trust it and deliberately do not re-check. A new
 * producer inherits the obligation, not the enforcement.
 *
 * `excludedStatuses` is exempt: it comes from the project's config, not from
 * the request.
 */
export interface SearchFilters {
  /** Open string, project-defined; matched verbatim and case-sensitively. */
  type?: string;
  /** Open string, project-defined; matched verbatim and case-sensitively — never lowercased. */
  module?: string;
  /** Canonical tag values (trimmed, lowercased); an empty array means no tag filter. */
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
  /**
   * Why an empty `results` is empty, when a filter or the project's own status
   * deny-list is the likely cause. Absent whenever there are results, and
   * absent on an unfiltered miss — a bare query that matches nothing needs no
   * explanation, and inventing one would be noise on every empty search.
   */
  noMatchReason?: string;
  /**
   * Set when a filter targeting a field no document declares was dropped so the
   * query could return something. Names what was ignored and how to fix the
   * project's config — a dropped filter is never silent.
   */
  filterWarning?: string;
}
