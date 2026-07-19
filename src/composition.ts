import { resolve } from "node:path";
import { EvaluateSearch } from "./application/evaluate-search.js";
import { GetOverview } from "./application/get-overview.js";
import { IndexDocuments } from "./application/index-documents.js";
import { ReadDocument } from "./application/read-document.js";
import { SearchDocuments } from "./application/search-documents.js";
import type { EmbeddingsProvider } from "./domain/ports.js";
import { loadConfig, SIN_CHUNKING, type CompendioConfig } from "./infrastructure/config.js";
import {
  LazyEmbeddings,
  TransformersEmbeddings,
} from "./infrastructure/embeddings/transformers-embeddings.js";
import { FileDocumentSource } from "./infrastructure/fs/file-document-source.js";
import { RemarkMarkdownParser } from "./infrastructure/markdown/remark-markdown-parser.js";
import { SqliteIndexStore } from "./infrastructure/sqlite/sqlite-index-store.js";

export interface ContainerOptions {
  /** Project root: configuration, docsDir and db paths resolve against it. */
  root: string;
  /** Overrides config.docsDir (CLI --dir). */
  docsDir?: string;
  /** Disables embeddings entirely (CLI --lexico). */
  forzarLexico?: boolean;
}

/** Composition root: wires adapters into use cases. */
export interface Container {
  config: CompendioConfig;
  store: SqliteIndexStore;
  indexDocuments: IndexDocuments;
  searchDocuments: SearchDocuments;
  getOverview: GetOverview;
  readDocument: ReadDocument;
  evaluateSearch: EvaluateSearch;
  close(): void;
}

export function createContainer(options: ContainerOptions): Container {
  const config = loadConfig(options.root);
  const docsDir = resolve(options.root, options.docsDir ?? config.docsDir);
  const store = new SqliteIndexStore(resolve(options.root, config.db));

  const embeddings: EmbeddingsProvider | null =
    options.forzarLexico === true
      ? null
      : new LazyEmbeddings(() => TransformersEmbeddings.create(config.embeddings.model));

  const indexDocuments = new IndexDocuments(
    new FileDocumentSource(docsDir, config.exclude),
    new RemarkMarkdownParser(),
    store,
    embeddings,
    { chunking: config.chunk, sinChunking: SIN_CHUNKING },
  );
  const searchDocuments = new SearchDocuments(store, embeddings, config.search);

  return {
    config,
    store,
    indexDocuments,
    searchDocuments,
    getOverview: new GetOverview(store),
    readDocument: new ReadDocument(store),
    evaluateSearch: new EvaluateSearch(searchDocuments, () => store.hasVectors()),
    close: () => store.close(),
  };
}
