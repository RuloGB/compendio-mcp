import { fileURLToPath } from "node:url";
import { EvaluateSearch } from "../../src/application/evaluate-search";
import { GetOverview } from "../../src/application/get-overview";
import { IndexDocuments } from "../../src/application/index-documents";
import { ReadDocument } from "../../src/application/read-document";
import { SearchDocuments } from "../../src/application/search-documents";
import type { EmbeddingsProvider } from "../../src/domain/ports";
import { FileDocumentSource } from "../../src/infrastructure/fs/file-document-source";
import { RemarkMarkdownParser } from "../../src/infrastructure/markdown/remark-markdown-parser";
import { SqliteIndexStore } from "../../src/infrastructure/sqlite/sqlite-index-store";

export const EJEMPLOS_DOCS = fileURLToPath(new URL("../../ejemplos/docs", import.meta.url));

export interface TestHarness {
  store: SqliteIndexStore;
  index: IndexDocuments;
  search: SearchDocuments;
  read: ReadDocument;
  overview: GetOverview;
  evaluate: EvaluateSearch;
  close(): void;
}

/** In-memory composition over the ejemplos corpus, mirroring production wiring. */
export function buildHarness(embeddings: EmbeddingsProvider | null): TestHarness {
  const store = new SqliteIndexStore(":memory:");
  const index = new IndexDocuments(
    new FileDocumentSource(EJEMPLOS_DOCS, ["INDEX.md"]),
    new RemarkMarkdownParser(),
    store,
    embeddings,
    { chunking: { minTokens: 100, maxTokens: 800 }, sinChunking: ["glosario.md"] },
  );
  const search = new SearchDocuments(store, embeddings, {
    k: 5,
    estadosExcluidos: ["borrador", "obsoleto"],
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
