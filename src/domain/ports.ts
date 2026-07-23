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
  ruta: string;
  contenido: string;
}

/** A per-file read failure discovered while walking the docs directory. */
export interface ReadError {
  ruta: string;
  error: string;
}

/** Result of a discovery pass: successfully read files plus per-file read failures. */
export interface DiscoverResult {
  files: DocumentFile[];
  erroresLectura: ReadError[];
}

/**
 * Discovers the markdown files to index (filesystem adapter). A single
 * unreadable file is collected into `erroresLectura` rather than aborting
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
  embed(textos: string[]): Promise<Float32Array[]>;
}

export interface SavedDocument {
  documentId: number;
  chunkIds: number[];
}

export interface ChunkEmbedding {
  chunkId: number;
  embedding: Float32Array;
}

/** Result of writing the generated index file. */
export interface IndexWriteResult {
  /** Path of the index file, as resolved by the adapter. */
  ruta: string;
  /** False when the file already had exactly the generated content. */
  cambiado: boolean;
}

/** Writes the generated INDEX.md into the docs directory (filesystem adapter). */
export interface IndexFileWriter {
  write(contenido: string): Promise<IndexWriteResult>;
}

/** Persistence port: SQLite (FTS5 + sqlite-vec) in production. */
export interface IndexStore {
  /** Drops all indexed data (full reindex model of the MVP). */
  reset(): void;
  saveDocument(meta: DocumentMeta, chunks: Chunk[]): SavedDocument;
  saveEmbeddings(items: ChunkEmbedding[]): void;
  listDocuments(): IndexedDocument[];
  getDocumentByRuta(ruta: string): IndexedDocument | null;
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
