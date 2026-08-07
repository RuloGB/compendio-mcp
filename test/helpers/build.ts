import { fileURLToPath } from "node:url";
import { EvaluateSearch } from "../../src/application/evaluate-search";
import { GetOverview } from "../../src/application/get-overview";
import { IndexDocuments } from "../../src/application/index-documents";
import { ReadDocument } from "../../src/application/read-document";
import { SearchDocuments } from "../../src/application/search-documents";
import { createConventionPolicy, type ConventionConfig } from "../../src/domain/convention";
import type { EmbeddingsProvider } from "../../src/domain/ports";
import { DEFAULT_CONFIG, NO_CHUNKING, resolveRoots } from "../../src/infrastructure/config";
import { FileDocumentSource } from "../../src/infrastructure/fs/file-document-source";
import { RemarkMarkdownParser } from "../../src/infrastructure/markdown/remark-markdown-parser";
import { SqliteIndexStore } from "../../src/infrastructure/sqlite/sqlite-index-store";

// es-frozen: cites the real `ejemplos/` corpus name, not a leftover translation.
/** Project root, for `resolveRoots`'s alias derivation (design.md Decision 13). */
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

// es-frozen: path into the Spanish `ejemplos/` reference corpus, which stays
// Spanish as the retrieval regression suite.
export const EXAMPLES_DOCS = fileURLToPath(new URL("../../ejemplos/docs", import.meta.url));

// es-frozen: cites the real `ejemplos/` corpus name, not a leftover translation.
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

// es-frozen: cites the real `ejemplos/` corpus name, not a leftover translation.
/**
 * Secondary synthetic fixture (D1.3) reproducing the full-convention
 * behavior `ejemplos/` used to demonstrate before the zero-config migration:
 * declared `types`/`statuses` matching the retired closed-taxonomy
 * constants, and the same `excludedStatuses` deny-list.
 */
export const STRICT_FIXTURE_DOCS = fileURLToPath(
  new URL("../fixtures/strict/docs", import.meta.url),
);
export const STRICT_FIXTURE_CONVENTION: ConventionConfig = {
  mode: "strict",
  types: ["functional", "adr", "api", "qa", "guide"],
  statuses: ["draft", "current", "deprecated"],
  excludedStatuses: ["draft", "deprecated"],
  frontmatterFields: { type: "type", module: "module", status: "status" },
};

/**
 * `match-centred-excerpt` fixture corpus (design.md "The gates"): five
 * English documents, one chunk each, driving Gates 1/2/3/5 lexical-only
 * (via a null embeddings provider) so the assertions are deterministic with
 * no model and no vector leg.
 */
export const EXCERPT_WINDOW_DOCS = fileURLToPath(
  new URL("../fixtures/excerpt-window/docs", import.meta.url),
);

/**
 * `addressable-chunks` fixture corpus (design.md "Gate 1"): six committed
 * heading-less documents (~30 KB) already reproducing the reported defect —
 * no new fixture corpus is required. Reused here (not modified) as the
 * regression harness for the non-empty-heading invariant.
 */
export const VECTOR_REACH_DOCS = fileURLToPath(
  new URL("../fixtures/vector-reach/docs", import.meta.url),
);

export interface TestHarness {
  store: SqliteIndexStore;
  index: IndexDocuments;
  search: SearchDocuments;
  read: ReadDocument;
  overview: GetOverview;
  evaluate: EvaluateSearch;
  close(): void;
}

/**
 * In-memory composition over a docs corpus, mirroring production wiring.
 *
 * Calls the real `resolveRoots` (not a reimplemented `basename(docsDir)`) so
 * this harness's alias derivation can never drift from production's — the
 * same argument as `scripts/vector-reach.mjs` calling it too (Decision 11).
 * Every corpus constant in this file resolves to a directory literally named
 * `docs`, so every harness-emitted path is prefixed `docs/...`.
 */
export function buildHarness(
  embeddings: EmbeddingsProvider | null,
  convention: ConventionConfig = EXAMPLES_CONVENTION,
  docsDir: string = EXAMPLES_DOCS,
): TestHarness {
  const [root] = resolveRoots(REPO_ROOT, [docsDir]);
  const store = new SqliteIndexStore(":memory:");
  const policy = createConventionPolicy(convention);
  const index = new IndexDocuments(
    new FileDocumentSource(root!.dir, ["INDEX.md"], root!.prefix),
    new RemarkMarkdownParser(),
    store,
    embeddings,
    policy,
    // Mirrors production config exactly (imported, not re-typed) so this
    // harness can never drift from `DEFAULT_CONFIG.chunk` again.
    { chunking: DEFAULT_CONFIG.chunk, noChunking: NO_CHUNKING },
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
