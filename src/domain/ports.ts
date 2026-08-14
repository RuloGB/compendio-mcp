import type {
  Chunk,
  DocumentMeta,
  IndexedChunk,
  IndexedDocument,
  SearchFilters,
} from "./model.js";
import type { DocOutline } from "./outline.js";

/** A raw markdown file discovered under the docs directory. */
export interface DocumentFile {
  /** Path relative to the docs directory, POSIX separators. */
  path: string;
  content: string;
}

/** A per-file read failure discovered while walking the docs directory. */
export interface ReadError {
  path: string;
  error: string;
}

/** A file successfully decoded under a non-UTF-8 encoding. Reportable, not a
 * failure: the document is indexed normally, but every consumer of the
 * discovery/report pipeline is told, even when the transcode was exact. */
export interface EncodingNotice {
  path: string;
  /** Open label, e.g. "windows-1252". The closed union lives in the adapter
   * (`decode-text.ts`'s `DecodedEncoding`) -- the domain must not import it. */
  encoding: string;
}

/** One fact the config loader had to ignore or override in the declared
 * config. Structured, never pre-rendered — the adapters own the wording, the
 * loader owns only what happened. Lives here for the same reason
 * `EncodingNotice` does: `application/` renders it (`formatConfigWarning`),
 * so the type cannot live in the adapter that produces it without inverting
 * the dependency direction. */
export interface ConfigWarning {
  kind: ConfigWarningKind;
  /** Dotted key path exactly as written in the file: `chunk.maxTokens`,
   * `chunk.maxtokens`. For `inverted-chunk-bounds`, names both keys, joined
   * by `/`. */
  key: string;
  /** `JSON.stringify` of the declared value. Absent for `unknown-key`. */
  declared?: string;
  /** The value actually in force. Absent when nothing fell back. */
  inEffect?: number;
}

export type ConfigWarningKind = "invalid-value" | "unknown-key" | "inverted-chunk-bounds";

/** Result of a discovery pass: successfully read files plus per-file read failures. */
export interface DiscoverResult {
  files: DocumentFile[];
  readErrors: ReadError[];
  /** Optional so existing in-memory `DocumentSource` fakes compile unchanged;
   * the production adapter always sets it (empty array when nothing was
   * transcoded). */
  encodingNotices?: EncodingNotice[];
}

/**
 * Discovers the markdown files to index (filesystem adapter). A single
 * unreadable file is collected into `readErrors` rather than aborting
 * the whole walk.
 */
export interface DocumentSource {
  discover(): Promise<DiscoverResult>;
}

export interface ParsedMarkdown {
  /** Parsed YAML frontmatter. */
  data: Record<string, unknown>;
  outline: DocOutline;
  /** Markdown body without the frontmatter block. */
  body: string;
}

/** Parses raw markdown into frontmatter plus a structural outline. */
export interface MarkdownParser {
  parse(raw: string): ParsedMarkdown;
}

/**
 * Text embedding provider. Implementations must return one vector per input
 * text, all with the same dimension. Task prefixes ("passage: ", "query: ")
 * are the caller's responsibility.
 */
export interface EmbeddingsProvider {
  embed(texts: string[]): Promise<Float32Array[]>;
}

export interface SavedDocument {
  documentId: number;
  chunkIds: number[];
}

export interface ChunkEmbedding {
  chunkId: number;
  embedding: Float32Array;
}

/** One indexed chunk with no corresponding `chunks_vec` row. */
export interface ChunkMissingVector {
  chunkId: number;
  path: string;
  heading: string;
  content: string;
}

/** Result of writing the generated index file. */
export interface IndexWriteResult {
  /** Path of the index file, as resolved by the adapter. */
  path: string;
  /** False when the file already had exactly the generated content. */
  changed: boolean;
}

/** Writes the generated INDEX.md into the docs directory (filesystem adapter). */
export interface IndexFileWriter {
  write(content: string): Promise<IndexWriteResult>;
}

/** Persistence port: SQLite (FTS5 + sqlite-vec) in production. */
export interface IndexStore {
  /** Drops all indexed data (full reindex model of the MVP). */
  reset(): void;
  saveDocument(meta: DocumentMeta, chunks: Chunk[]): SavedDocument;
  saveEmbeddings(items: ChunkEmbedding[]): void;
  /** Removes a document plus its chunks, FTS rows, and vector rows (no orphans).
   * A no-op when the path is not indexed. */
  deleteDocument(path: string): void;
  /** Atomically replaces a document (delete-if-exists, then insert):
   * documents + chunks + chunks_fts, plus chunks_vec when embeddings is
   * non-null. `embeddings`, when provided, must have one entry per chunk in
   * the same order. */
  upsertDocument(
    meta: DocumentMeta,
    chunks: Chunk[],
    embeddings: Float32Array[] | null,
  ): SavedDocument;
  /** Every indexed chunk with no `chunks_vec` row. `[]` when vectors are
   * unavailable or `chunks_vec` was never created. */
  listChunksMissingVectors(): ChunkMissingVector[];
  /** Idempotent vector write: delete-then-insert per `chunk_id` in one
   * transaction, so re-covering an already-vectorized chunk cannot violate
   * the vec0 PRIMARY KEY. Unlike `saveEmbeddings`, this MAY be called on a
   * chunk that already has a vector row. */
  replaceEmbeddings(items: ChunkEmbedding[]): void;
  listDocuments(): IndexedDocument[];
  getDocumentByPath(path: string): IndexedDocument | null;
  getChunksByDocument(documentId: number): IndexedChunk[];
  getChunksByIds(ids: number[]): IndexedChunk[];
  getDocumentsByIds(ids: number[]): Map<number, IndexedDocument>;
  /** BM25 ranked chunk ids (best first). */
  searchLexical(query: string, filters: SearchFilters, limit: number): number[];
  /** Nearest-neighbour ranked chunk ids (best first). Empty when the vector
   * index is unavailable. */
  searchVector(embedding: Float32Array, filters: SearchFilters, limit: number): number[];
  /** True when the vector index exists and holds at least one embedding. */
  hasVectors(): boolean;
  close(): void;
}
