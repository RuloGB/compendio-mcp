import { fileURLToPath } from "node:url";
import { EvaluateSearch } from "../../src/application/evaluate-search";
import { GetOverview } from "../../src/application/get-overview";
import { IndexDocuments } from "../../src/application/index-documents";
import { ReadDocument } from "../../src/application/read-document";
import { SearchDocuments } from "../../src/application/search-documents";
import { createConventionPolicy, type ConventionConfig } from "../../src/domain/convention";
import type { EmbeddingsProvider } from "../../src/domain/ports";
import { FileDocumentSource } from "../../src/infrastructure/fs/file-document-source";
import { RemarkMarkdownParser } from "../../src/infrastructure/markdown/remark-markdown-parser";
import { SqliteIndexStore } from "../../src/infrastructure/sqlite/sqlite-index-store";

// es-frozen: path into the Spanish `ejemplos/` reference corpus, which stays
// Spanish as the retrieval regression suite.
export const EXAMPLES_DOCS = fileURLToPath(new URL("../../ejemplos/docs", import.meta.url));

/**
 * ejemplos/ is the product's zero-config pitch corpus (post-D1 migration):
 * no declared taxonomy, folder-as-module inference, mostly frontmatter-free.
 * `ejemplos/` ships NO config file at all, so this mirrors what `loadConfig`
 * returns for it: `DEFAULT_CONFIG.convention`, i.e. `loose` with nothing
 * excluded. Keep the two in sync if the defaults ever change.
 */
export const EXAMPLES_CONVENTION: ConventionConfig = {
  mode: "loose",
  excludedStatuses: [],
  frontmatterFields: { type: "type", module: "module", status: "status" },
};

/**
 * Secondary synthetic fixture (D1.3) reproducing the full-convention
 * behavior `ejemplos/` used to demonstrate before the zero-config migration:
 * declared `types`/`statuses` matching the retired `TIPOS`/`ESTADOS`
 * constants, and the same `excludedStatuses` deny-list.
 */
export const STRICT_FIXTURE_DOCS = fileURLToPath(
  new URL("../fixtures/estricto/docs", import.meta.url),
);
export const STRICT_FIXTURE_CONVENTION: ConventionConfig = {
  mode: "strict",
  types: ["funcional", "adr", "api", "qa", "guia"],
  statuses: ["borrador", "vigente", "obsoleto"],
  excludedStatuses: ["borrador", "obsoleto"],
  frontmatterFields: { type: "type", module: "module", status: "status" },
};

export interface TestHarness {
  store: SqliteIndexStore;
  index: IndexDocuments;
  search: SearchDocuments;
  read: ReadDocument;
  overview: GetOverview;
  evaluate: EvaluateSearch;
  close(): void;
}

/** In-memory composition over a docs corpus, mirroring production wiring. */
export function buildHarness(
  embeddings: EmbeddingsProvider | null,
  convention: ConventionConfig = EXAMPLES_CONVENTION,
  docsDir: string = EXAMPLES_DOCS,
): TestHarness {
  const store = new SqliteIndexStore(":memory:");
  const policy = createConventionPolicy(convention);
  const index = new IndexDocuments(
    new FileDocumentSource(docsDir, ["INDEX.md"]),
    new RemarkMarkdownParser(),
    store,
    embeddings,
    policy,
    { chunking: { minTokens: 100, maxTokens: 800 }, noChunking: ["glosario.md"] },
  );
  const search = new SearchDocuments(store, embeddings, {
    k: 5,
    excludedStatuses: convention.excludedStatuses,
  });
  return {
    store,
    index,
    search,
    read: new ReadDocument(store),
    overview: new GetOverview(store),
    evaluate: new EvaluateSearch(search, () => store.hasVectors()),
    close: () => store.close(),
  };
}
