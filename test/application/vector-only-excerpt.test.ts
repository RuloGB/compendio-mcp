import { describe, expect, it } from "vitest";
import { LEAD_EXCERPT_CHARS } from "../../src/domain/excerpt";
import { SearchDocuments } from "../../src/application/search-documents";
import type { EmbeddingsProvider } from "../../src/domain/ports";
import { SqliteIndexStore } from "../../src/infrastructure/sqlite/sqlite-index-store";

/**
 * Gate 5 (design.md): a chunk surfaced by the vector leg alone, with no
 * lexical match for the query, must still produce a well-formed excerpt.
 *
 * This does not reuse `test/fixtures/vector-reach/` (design.md leaves the
 * harness to `sdd-apply`'s discretion — "the behaviour is not optional").
 * That fixture's Spanish, procedurally-generated vocabulary shares no stem
 * with `FakeEmbeddings`' concept groups, so exercising it here would either
 * need the real `TransformersEmbeddings` provider (a model download,
 * breaking the offline/fast `npm test` run every other test in this suite
 * keeps) or fabricated stem overlap that fixture was never built to carry.
 * A synthetic same-shape scenario — a chunk whose stored vector is deemed
 * closest to the query's embedding, with vocabulary that shares no term
 * with the query at all — exercises the identical production path
 * (`SearchDocuments` -> `IndexStore.searchVector` -> `buildExcerpt`) without
 * that confound.
 */
class FixedQueryEmbeddings implements EmbeddingsProvider {
  constructor(private readonly vector: Float32Array) {}
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map(() => this.vector);
  }
}

const FILLER = "lorem ipsum dolor sit amet consectetur ".repeat(50); // > LEAD_EXCERPT_CHARS

describe("Gate 5 — vector-only result produces a well-formed excerpt", () => {
  it("a chunk with no lexical match for the query still gets a valid, in-budget excerpt", async () => {
    const store = new SqliteIndexStore(":memory:");
    try {
      const content = `${FILLER}the vector leg alone can still find this passage.`;
      const saved = store.saveDocument(
        { path: "vector-only.md", title: "Vector only", summary: "r", tags: [], hash: "h" },
        [{ heading: "H", content, position: 0 }],
      );
      const vector = new Float32Array([1, 0, 0]);
      store.saveEmbeddings([{ chunkId: saved.chunkIds[0]!, embedding: vector }]);
      expect(store.hasVectors()).toBe(true);

      // Query terms deliberately absent from `content` — no lexical match.
      const query = "gribblewhorten zibbowax";
      expect(store.searchLexical(query, {}, 10)).toEqual([]);

      const embeddings = new FixedQueryEmbeddings(vector);
      const search = new SearchDocuments(store, embeddings, { k: 10, excludedStatuses: [] });
      const response = await search.execute({ query });

      expect(response.mode).toBe("hybrid");
      expect(response.results.length).toBe(1);
      const lead = response.results[0]!;
      expect(lead.path).toBe("vector-only.md");
      expect(lead.excerpt.length).toBeGreaterThan(0);
      expect(lead.excerpt.length).toBeLessThanOrEqual(LEAD_EXCERPT_CHARS + 2);
      // No lexical match -> empty spans -> today's prefix path (Decision 7):
      // no leading ellipsis, and a trailing one since content exceeds budget.
      expect(lead.excerpt.startsWith("…")).toBe(false);
      expect(lead.excerpt.endsWith("…")).toBe(true);
    } finally {
      store.close();
    }
  });
});
