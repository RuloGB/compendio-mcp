import { resolve } from "node:path";
import { EvaluateSearch } from "./application/evaluate-search.js";
import { GenerateIndexMd } from "./application/generate-index-md.js";
import { GetOverview } from "./application/get-overview.js";
import { IndexDocuments, type IndexDocumentsOptions } from "./application/index-documents.js";
import { ReadDocument } from "./application/read-document.js";
import { SearchDocuments } from "./application/search-documents.js";
import { SyncIndex } from "./application/sync-index.js";
import { SyncScheduler } from "./application/sync-scheduler.js";
import { createIndexComparator, createConventionPolicy } from "./domain/convention.js";
import { INDEX_FILE } from "./domain/index-markdown.js";
import type { EmbeddingsProvider } from "./domain/ports.js";
import type { ProgressReporter } from "./domain/progress.js";
import { loadConfig, NO_CHUNKING, type CompendioConfig } from "./infrastructure/config.js";
import {
  LazyEmbeddings,
  TransformersEmbeddings,
  type TransformersEmbeddingsOptions,
} from "./infrastructure/embeddings/transformers-embeddings.js";
import { FileDocumentSource } from "./infrastructure/fs/file-document-source.js";
import { FileIndexWriter } from "./infrastructure/fs/file-index-writer.js";
import { RemarkMarkdownParser } from "./infrastructure/markdown/remark-markdown-parser.js";
import { SqliteIndexStore } from "./infrastructure/sqlite/sqlite-index-store.js";

export interface ContainerOptions {
  /** Project root: configuration, docsDir and db paths resolve against it. */
  root: string;
  /** Overrides config.docsDir (CLI --dir). */
  docsDir?: string;
  /** Disables embeddings entirely (CLI --lexical). */
  forceLexical?: boolean;
  /** Optional progress observability hook, fanned out to `IndexDocuments` and,
   * on a cold model cache, to the download seam inside `LazyEmbeddings`. */
  onProgress?: ProgressReporter;
}

/** Composition root: wires adapters into use cases. */
export interface Container {
  config: CompendioConfig;
  store: SqliteIndexStore;
  indexDocuments: IndexDocuments;
  generateIndexMd: GenerateIndexMd;
  searchDocuments: SearchDocuments;
  getOverview: GetOverview;
  readDocument: ReadDocument;
  evaluateSearch: EvaluateSearch;
  /** Incremental diff engine (unwired from any trigger by itself — see
   * `syncScheduler`, which is what `cli.ts`/`server.ts` actually call). */
  syncIndex: SyncIndex;
  /** Owns the startup + throttled trigger for `syncIndex`, with in-flight
   * dedupe (see `SyncScheduler`). */
  syncScheduler: SyncScheduler;
  close(): void;
}

export function createContainer(options: ContainerOptions): Container {
  const config = loadConfig(options.root);
  const docsDir = resolve(options.root, options.docsDir ?? config.docsDir);
  const store = new SqliteIndexStore(resolve(options.root, config.db));
  const onProgress = options.onProgress;

  const embeddings: EmbeddingsProvider | null =
    options.forceLexical === true
      ? null
      : new LazyEmbeddings(() =>
          TransformersEmbeddings.create(
            config.embeddings.model,
            buildEmbeddingsOptions(onProgress),
          ),
        );

  const source = new FileDocumentSource(docsDir, config.exclude);
  const parser = new RemarkMarkdownParser();
  const policy = createConventionPolicy(config.convention);
  const comparator = createIndexComparator(config.convention);
  const indexDocumentsOptions: IndexDocumentsOptions = { chunking: config.chunk, noChunking: NO_CHUNKING };
  if (onProgress !== undefined) indexDocumentsOptions.onProgress = onProgress;
  const indexDocuments = new IndexDocuments(source, parser, store, embeddings, policy, indexDocumentsOptions);
  const generateIndexMd = new GenerateIndexMd(
    source,
    parser,
    new FileIndexWriter(docsDir, INDEX_FILE),
    policy,
    comparator,
  );
  const searchDocuments = new SearchDocuments(store, embeddings, {
    k: config.search.k,
    excludedStatuses: config.convention.excludedStatuses,
  });
  const syncIndex = new SyncIndex(source, parser, store, embeddings, policy, {
    chunking: config.chunk,
    noChunking: NO_CHUNKING,
  });
  const syncScheduler = new SyncScheduler(syncIndex, config.sync.throttleMs);

  return {
    config,
    store,
    indexDocuments,
    generateIndexMd,
    searchDocuments,
    getOverview: new GetOverview(store),
    readDocument: new ReadDocument(store),
    evaluateSearch: new EvaluateSearch(searchDocuments, () => store.hasVectors()),
    syncIndex,
    syncScheduler,
    close: () => store.close(),
  };
}

/**
 * `exactOptionalPropertyTypes: true` forbids spreading `ProgressReporter |
 * undefined` into `onDownloadProgress?:` — build the options object
 * conditionally instead (hop 2 of the two-hop `onProgress` wiring; hop 1 is
 * `IndexDocumentsOptions.onProgress` above).
 */
function buildEmbeddingsOptions(onProgress: ProgressReporter | undefined): TransformersEmbeddingsOptions {
  if (onProgress === undefined) return {};
  return {
    onDownloadProgress: ({ loaded, total }) =>
      onProgress({ phase: "embedding", kind: "download", loaded, total }),
  };
}
