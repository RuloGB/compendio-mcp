import { resolve } from "node:path";
import { EvaluateSearch } from "./application/evaluate-search.js";
import { GenerateIndexMd } from "./application/generate-index-md.js";
import { GetOverview } from "./application/get-overview.js";
import { IndexDocuments, type IndexDocumentsOptions } from "./application/index-documents.js";
import { ReadDocument } from "./application/read-document.js";
import { SearchDocuments } from "./application/search-documents.js";
import { SyncIndex, type SyncIndexOptions } from "./application/sync-index.js";
import { SyncScheduler } from "./application/sync-scheduler.js";
import { createIndexComparator, createConventionPolicy } from "./domain/convention.js";
import { INDEX_FILE } from "./domain/index-markdown.js";
import type { ConfigWarning, EmbeddingsProvider } from "./domain/ports.js";
import type { ProgressReporter } from "./domain/progress.js";
import {
  loadConfigReport,
  resolveRoots,
  NO_CHUNKING,
  type CompendioConfig,
} from "./infrastructure/config.js";
import {
  LazyEmbeddings,
  TransformersEmbeddings,
  type TransformersEmbeddingsOptions,
} from "./infrastructure/embeddings/transformers-embeddings.js";
import { CompositeDocumentSource } from "./infrastructure/fs/composite-document-source.js";
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
  /** Every fact `loadConfigReport` had to ignore or override in the declared
   * config -- empty on a clean load, including no config file at all
   * (design.md Decision 5). Rendered by the CLI (stderr) and `docs_overview`
   * (`Config:` block), never by `search_docs` (design.md Decision 6). */
  configWarnings: ConfigWarning[];
  store: SqliteIndexStore;
  indexDocuments: IndexDocuments;
  generateIndexMd: GenerateIndexMd;
  searchDocuments: SearchDocuments;
  getOverview: GetOverview;
  readDocument: ReadDocument;
  evaluateSearch: EvaluateSearch;
  /** Incremental diff engine. Triggered two ways: `syncScheduler`'s
   * startup + throttled pre-tool-call check (`serve`), and directly by the
   * `sync` CLI action, which bypasses the scheduler entirely. */
  syncIndex: SyncIndex;
  /** Owns the startup + throttled trigger for `syncIndex`, with in-flight
   * dedupe (see `SyncScheduler`). */
  syncScheduler: SyncScheduler;
  close(): void;
}

export function createContainer(options: ContainerOptions): Container {
  const { config, warnings: configWarnings } = loadConfigReport(options.root);
  // Runs, and can throw, before `new SqliteIndexStore` below: `migrate()`
  // creates `.compendio/` on every construction, so an invalid root set must
  // be rejected first (design.md Decision 6) — this is what makes "no
  // `.compendio/` afterward" literally true for a colliding config.
  const roots = resolveRoots(
    options.root,
    options.docsDir !== undefined ? [options.docsDir] : config.docsDir,
  );
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

  // One unconditional wiring path: a one-element root set runs through the
  // same composite as ten (design.md Decision 3) — no `multi` flag, no
  // shortcut for the single-root case.
  const source = new CompositeDocumentSource(
    roots.map((root) => ({
      ...root,
      source: new FileDocumentSource(root.dir, config.exclude, root.prefix),
    })),
  );
  const parser = new RemarkMarkdownParser();
  // rootPrefixes threaded in unconditionally: every discovered path already
  // carries a root alias, so `module` inference must always strip it first
  // (design.md Decision 7) -- there is no "undefined" case in production.
  const policy = createConventionPolicy(
    config.convention,
    roots.map((root) => root.prefix),
  );
  const comparator = createIndexComparator(config.convention);
  const indexDocumentsOptions: IndexDocumentsOptions = { chunking: config.chunk, noChunking: NO_CHUNKING };
  if (onProgress !== undefined) indexDocumentsOptions.onProgress = onProgress;
  const indexDocuments = new IndexDocuments(source, parser, store, embeddings, policy, indexDocumentsOptions);
  const generateIndexMd = new GenerateIndexMd(
    source,
    parser,
    // Writer target stays the first declared root (design.md Decision 9).
    new FileIndexWriter(roots[0]!.dir, INDEX_FILE),
    policy,
    comparator,
    // `selfPath` is the prefixed value of the file this same call writes —
    // never the bare literal, which no discovered `path` equals once every
    // root is aliased (design.md Decision 9).
    `${roots[0]!.prefix}/${INDEX_FILE}`,
  );
  const searchDocuments = new SearchDocuments(store, embeddings, {
    k: config.search.k,
    excludedStatuses: config.convention.excludedStatuses,
  });
  const syncIndexOptions: SyncIndexOptions = { chunking: config.chunk, noChunking: NO_CHUNKING };
  if (onProgress !== undefined) syncIndexOptions.onProgress = onProgress;
  const syncIndex = new SyncIndex(source, parser, store, embeddings, policy, syncIndexOptions);
  const syncScheduler = new SyncScheduler(syncIndex, config.sync.throttleMs);

  return {
    config,
    configWarnings,
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
