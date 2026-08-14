import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { IndexDocuments } from "../../src/application/index-documents";
import { SearchDocuments } from "../../src/application/search-documents";
import { createConventionPolicy } from "../../src/domain/convention";
import { estimateTokens } from "../../src/domain/tokens";
import { CONFIG_FILE, NO_CHUNKING, loadConfig, resolveRoots } from "../../src/infrastructure/config";
import { FileDocumentSource } from "../../src/infrastructure/fs/file-document-source";
import { RemarkMarkdownParser } from "../../src/infrastructure/markdown/remark-markdown-parser";
import { SqliteIndexStore } from "../../src/infrastructure/sqlite/sqlite-index-store";
import { STRICT_FIXTURE_CONVENTION, STRICT_FIXTURE_DOCS } from "../helpers/build";
import { FakeEmbeddings } from "../helpers/fake-embeddings";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

interface ChunkProfile {
  totalChunks: number;
  maxObservedTokens: number;
}

/**
 * Indexes the `strict` fixture corpus (`test/fixtures/strict/docs`, 5 tiny
 * documents, reused unmodified per design.md's Testing Strategy) with the
 * given resolved `chunk` options, and reports the resulting chunk profile.
 */
async function indexFixture(chunk: { minTokens: number; maxTokens: number }): Promise<ChunkProfile> {
  const [root] = resolveRoots(REPO_ROOT, [STRICT_FIXTURE_DOCS]);
  const store = new SqliteIndexStore(":memory:");
  const policy = createConventionPolicy(STRICT_FIXTURE_CONVENTION, [root!.prefix]);
  const index = new IndexDocuments(
    new FileDocumentSource(root!.dir, ["INDEX.md"], root!.prefix),
    new RemarkMarkdownParser(),
    store,
    new FakeEmbeddings(),
    policy,
    { chunking: chunk, noChunking: NO_CHUNKING },
  );
  await index.execute();

  let totalChunks = 0;
  let maxObservedTokens = 0;
  for (const doc of store.listDocuments()) {
    for (const c of store.getChunksByDocument(doc.id)) {
      totalChunks += 1;
      maxObservedTokens = Math.max(maxObservedTokens, estimateTokens(c.content));
    }
  }
  store.close();
  return { totalChunks, maxObservedTokens };
}

/**
 * Writes `configJson` (or nothing, for the control row) as a temp project's
 * `compendio.config.json`, resolves it through the real `loadConfig` --
 * exercising the validation under test, not a reimplementation of it -- and
 * indexes the strict fixture corpus with the resolved `chunk` options.
 *
 * Takes raw JSON text rather than a JS value: `JSON.stringify(1e400)`
 * serializes to `"null"` (`Infinity` has no JSON representation), which would
 * silently defeat the one fixture row this design exists to cover. Writing
 * the literal `1e400` numeral is the only way to reproduce
 * `JSON.parse` overflowing to `Infinity` (design.md "one measurement to take
 * at apply time").
 */
async function resolveAndIndex(
  configJson: string | undefined,
): Promise<ChunkProfile & { resolvedMaxTokens: number }> {
  const projectDir = await mkdtemp(join(tmpdir(), "compendio-chunk-bound-"));
  try {
    if (configJson !== undefined) {
      await writeFile(join(projectDir, CONFIG_FILE), configJson, "utf8");
    }
    const config = loadConfig(projectDir);
    const profile = await indexFixture(config.chunk);
    return { ...profile, resolvedMaxTokens: config.chunk.maxTokens };
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
}

describe("chunk.maxTokens bound survives an invalid declared value (Gate 1)", () => {
  let control: ChunkProfile & { resolvedMaxTokens: number };

  beforeAll(async () => {
    control = await resolveAndIndex(undefined);
  });

  it("control (no chunk block) resolves chunk.maxTokens to the documented default", () => {
    expect(control.resolvedMaxTokens).toBe(480);
  });

  it("maxTokens: 0 falls back to the default instead of exploding into one chunk per code point", async () => {
    const result = await resolveAndIndex(`{"chunk":{"maxTokens":0}}`);
    expect(result.resolvedMaxTokens).toBe(480);
    expect(result.totalChunks).toBe(control.totalChunks);
    expect(result.maxObservedTokens).toBeLessThanOrEqual(result.resolvedMaxTokens);
  });

  it('maxTokens: "abc" (non-numeric string, coerces to NaN) falls back to the default', async () => {
    const result = await resolveAndIndex(`{"chunk":{"maxTokens":"abc"}}`);
    expect(result.resolvedMaxTokens).toBe(480);
    expect(result.totalChunks).toBe(control.totalChunks);
    expect(result.maxObservedTokens).toBeLessThanOrEqual(result.resolvedMaxTokens);
  });

  it("maxTokens: null (coerces to 0) falls back to the default", async () => {
    const result = await resolveAndIndex(`{"chunk":{"maxTokens":null}}`);
    expect(result.resolvedMaxTokens).toBe(480);
    expect(result.totalChunks).toBe(control.totalChunks);
    expect(result.maxObservedTokens).toBeLessThanOrEqual(result.resolvedMaxTokens);
  });

  it("maxTokens: 1e400 (JSON-parses to Infinity) falls back to the default", async () => {
    const result = await resolveAndIndex(`{"chunk":{"maxTokens":1e400}}`);
    expect(result.resolvedMaxTokens).toBe(480);
    expect(result.totalChunks).toBe(control.totalChunks);
    expect(result.maxObservedTokens).toBeLessThanOrEqual(result.resolvedMaxTokens);
  });

  it('maxTokens: "600" (a quoted number) falls back to the default rather than being honored', () => {
    // The one row whose "before" state is correct behavior (design.md's
    // fixture table): today "600" coerces and chunks correctly at 600. After
    // this change only a genuine `number` is accepted, so it falls back to
    // 480 -- silently in this slice, reported starting in Slice 2 (design.md
    // Decision 1's whole argument). No chunk-count comparison against the
    // control here: every document in this fixture is already well under
    // both 480 and 600, so an equal count would hold either way and could
    // not distinguish "honored at 600" from "fell back to 480" -- only the
    // resolved value can.
    return resolveAndIndex(`{"chunk":{"maxTokens":"600"}}`).then((result) => {
      expect(result.resolvedMaxTokens).toBe(480);
      expect(result.maxObservedTokens).toBeLessThanOrEqual(result.resolvedMaxTokens);
    });
  });

  it("maxTokens: 600 (a genuine number) is honored, not clamped", async () => {
    const result = await resolveAndIndex(`{"chunk":{"maxTokens":600}}`);
    expect(result.resolvedMaxTokens).toBe(600);
  });

  it("maxTokens: 1 (a genuine number) is honored, not clamped to a floor", async () => {
    const result = await resolveAndIndex(`{"chunk":{"maxTokens":1}}`);
    expect(result.resolvedMaxTokens).toBe(1);
  });
});

describe("search.k config default (Gate 2)", () => {
  const MATCHING_TEXT = "unique unrepeatable gate two content marker";

  async function buildSearchWithConfigK(
    configJson: string | undefined,
  ): Promise<{ search: SearchDocuments; store: SqliteIndexStore; resolvedK: number }> {
    const projectDir = await mkdtemp(join(tmpdir(), "compendio-search-k-"));
    try {
      if (configJson !== undefined) {
        await writeFile(join(projectDir, CONFIG_FILE), configJson, "utf8");
      }
      const config = loadConfig(projectDir);
      const store = new SqliteIndexStore(":memory:");
      store.saveDocument(
        { path: "a.md", title: "A", summary: "r", tags: [], hash: "h" },
        [{ heading: "A", content: MATCHING_TEXT, position: 0 }],
      );
      const search = new SearchDocuments(store, null, { k: config.search.k, excludedStatuses: [] });
      return { search, store, resolvedK: config.search.k };
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  }

  it("search.k: 0 falls back to the default instead of truncating every result away", async () => {
    const { search, store, resolvedK } = await buildSearchWithConfigK(`{"search":{"k":0}}`);
    expect(resolvedK).toBe(5);
    const response = await search.execute({ query: MATCHING_TEXT });
    expect(response.results.length).toBeGreaterThan(0);
    expect(response.noMatchReason).toBeUndefined();
    store.close();
  });

  it('search.k: "abc" falls back to the default instead of reaching the store as an unbindable NaN limit', async () => {
    const { search, store, resolvedK } = await buildSearchWithConfigK(`{"search":{"k":"abc"}}`);
    expect(resolvedK).toBe(5);
    const response = await search.execute({ query: MATCHING_TEXT });
    expect(response.results.length).toBeGreaterThan(0);
    store.close();
  });

  it("search.k: 5.01 (non-integer) falls back to the default", async () => {
    const { resolvedK } = await buildSearchWithConfigK(`{"search":{"k":5.01}}`);
    expect(resolvedK).toBe(5);
  });

  it("search.k: 3 (a valid integer) is honored, not clamped", async () => {
    const { resolvedK } = await buildSearchWithConfigK(`{"search":{"k":3}}`);
    expect(resolvedK).toBe(3);
  });

  it("an explicit per-call k overrides an invalid config default either way", async () => {
    const { search, store } = await buildSearchWithConfigK(`{"search":{"k":"abc"}}`);
    const response = await search.execute({ query: MATCHING_TEXT, k: 5 });
    expect(response.results.length).toBeGreaterThan(0);
    store.close();
  });
});
