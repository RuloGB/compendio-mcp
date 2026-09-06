import { describe, expect, it, vi } from "vitest";
import { SearchDocuments } from "../../src/application/search-documents";
import type {
  Chunk,
  DocumentMeta,
  IndexedChunk,
  IndexedDocument,
  SearchFilters,
} from "../../src/domain/model";
import type {
  ChunkEmbedding,
  ChunkMissingVector,
  EmbeddingsProvider,
  IndexStore,
  SavedDocument,
} from "../../src/domain/ports";
import type { SearchTraceObserver } from "../../src/application/search-trace";

/**
 * A minimal, fully-controllable `IndexStore` double. Only the members
 * `SearchDocuments` actually calls are meaningful; the rest throw so an
 * accidental new dependency on them fails loudly instead of silently
 * returning nonsense.
 */
class FakeStore implements IndexStore {
  documents: IndexedDocument[] = [];
  chunks: IndexedChunk[] = [];
  lexicalIds: number[] = [];
  vectorIds: number[] = [];
  vectorsAvailable = true;
  lexicalCalls = 0;
  vectorCalls = 0;

  searchLexical(_query: string, filters: SearchFilters, _limit: number): number[] {
    this.lexicalCalls++;
    // No document in this fake declares "type" — mimic a real store's
    // behavior for a filter targeting an undeclared field so
    // `dropImpossibleFilters`'s retry path is genuinely exercised.
    if (filters.type !== undefined) return [];
    // Return the SAME array reference on every call, on purpose: a caller
    // that stored a copy is unaffected by later in-place mutation of it,
    // one a caller that stored the reference is not — this is exactly the
    // "copied arrays" property task 1.1 exists to pin.
    return this.lexicalIds;
  }

  searchVector(_embedding: Float32Array, filters: SearchFilters, _limit: number): number[] {
    this.vectorCalls++;
    if (filters.type !== undefined) return [];
    return this.vectorIds;
  }

  getChunksByIds(ids: number[]): IndexedChunk[] {
    return this.chunks.filter((c) => ids.includes(c.id));
  }

  getDocumentsByIds(ids: number[]): Map<number, IndexedDocument> {
    const map = new Map<number, IndexedDocument>();
    for (const doc of this.documents) {
      if (ids.includes(doc.id)) map.set(doc.id, doc);
    }
    return map;
  }

  listDocuments(): IndexedDocument[] {
    return this.documents;
  }

  hasVectors(): boolean {
    return this.vectorsAvailable;
  }

  // Unused by SearchDocuments — fail loudly if that ever changes.
  reset(): void {
    throw new Error("not implemented");
  }
  saveDocument(_meta: DocumentMeta, _chunks: Chunk[]): SavedDocument {
    throw new Error("not implemented");
  }
  saveEmbeddings(_items: ChunkEmbedding[]): void {
    throw new Error("not implemented");
  }
  deleteDocument(_path: string): void {
    throw new Error("not implemented");
  }
  upsertDocument(): SavedDocument {
    throw new Error("not implemented");
  }
  canPersistVectors(): boolean {
    throw new Error("not implemented");
  }
  listChunksMissingVectors(): ChunkMissingVector[] {
    throw new Error("not implemented");
  }
  replaceEmbeddings(_items: ChunkEmbedding[]): void {
    throw new Error("not implemented");
  }
  getDocumentByPath(): IndexedDocument | null {
    throw new Error("not implemented");
  }
  getChunksByDocument(): IndexedChunk[] {
    throw new Error("not implemented");
  }
  close(): void {
    // no-op
  }
}

function doc(id: number, path: string): IndexedDocument {
  return { id, path, title: path, summary: "", tags: [], hash: path };
}

function chunk(id: number, documentId: number, content: string, position = 0): IndexedChunk {
  return { id, documentId, heading: "H", content, position };
}

class CountingEmbeddings implements EmbeddingsProvider {
  calls = 0;
  vectors: Float32Array[] = [new Float32Array([1, 0])];
  async embed(texts: string[]): Promise<Float32Array[]> {
    this.calls++;
    return texts.map(() => this.vectors[0]!);
  }
}

class ThrowingEmbeddings implements EmbeddingsProvider {
  async embed(): Promise<Float32Array[]> {
    throw new Error("embeddings runtime broke (simulated)");
  }
}

class EmptyEmbeddings implements EmbeddingsProvider {
  async embed(): Promise<Float32Array[]> {
    return [];
  }
}

function baseStore(): FakeStore {
  const store = new FakeStore();
  store.documents = [doc(1, "one.md"), doc(2, "two.md")];
  store.chunks = [chunk(1, 1, "alpha content"), chunk(2, 2, "beta content")];
  store.lexicalIds = [1, 2];
  store.vectorIds = [2, 1];
  return store;
}

describe("search-trace — observer does not alter production behavior", () => {
  it("produces a byte-identical response whether or not an observer is attached", async () => {
    const embeddings = new CountingEmbeddings();
    const storeOff = baseStore();
    const searchOff = new SearchDocuments(storeOff, embeddings, { k: 10, excludedStatuses: [] });
    const responseOff = await searchOff.execute({ query: "alpha" });

    const storeOn = baseStore();
    const searchOn = new SearchDocuments(storeOn, embeddings, { k: 10, excludedStatuses: [] });
    const attempts: unknown[] = [];
    const observer: SearchTraceObserver = { onComplete: (trace) => attempts.push(trace) };
    const responseOn = await searchOn.execute({ query: "alpha" }, observer);

    expect(responseOn).toEqual(responseOff);
    expect(attempts.length).toBe(1);
  });

  it("triggers no extra inference: embed() call count is identical with and without an observer", async () => {
    const embeddingsOff = new CountingEmbeddings();
    const searchOff = new SearchDocuments(baseStore(), embeddingsOff, { k: 10, excludedStatuses: [] });
    await searchOff.execute({ query: "alpha" });

    const embeddingsOn = new CountingEmbeddings();
    const searchOn = new SearchDocuments(baseStore(), embeddingsOn, { k: 10, excludedStatuses: [] });
    await searchOn.execute({ query: "alpha" }, { onComplete: () => {} });

    expect(embeddingsOn.calls).toBe(embeddingsOff.calls);
  });

  it("does not build a trace at all when no observer is given (no onComplete call to fail to make)", async () => {
    const search = new SearchDocuments(baseStore(), null, { k: 10, excludedStatuses: [] });
    // No observer argument at all — must not throw, must behave exactly like
    // the pre-existing single-argument call sites elsewhere in this repo.
    const response = await search.execute({ query: "alpha" });
    expect(response.results.length).toBeGreaterThan(0);
  });

  it("copies observed arrays: later in-place mutation of the store's returned array does not retroactively change the trace", async () => {
    const store = baseStore();
    const search = new SearchDocuments(store, null, { k: 10, excludedStatuses: [] });
    let captured: import("../../src/application/search-trace").SearchTrace | undefined;
    await search.execute({ query: "alpha" }, { onComplete: (t) => (captured = t) });

    const before = [...captured!.attempts[0]!.lexicalIds];
    // Mutate the SAME array FakeStore.searchLexical keeps returning.
    store.lexicalIds.push(999);
    expect(captured!.attempts[0]!.lexicalIds).toEqual(before);
    expect(captured!.attempts[0]!.lexicalIds).not.toContain(999);
  });

  it("a throwing observer callback does not affect the returned response", async () => {
    const search = new SearchDocuments(baseStore(), null, { k: 10, excludedStatuses: [] });
    const response = await search.execute(
      { query: "alpha" },
      {
        onComplete: () => {
          throw new Error("observer exploded (simulated)");
        },
      },
    );
    expect(response.results.length).toBeGreaterThan(0);
  });

  it("records one attempt per filter-drop retry, with the retry's filterWarning surfaced on the trace", async () => {
    const store = baseStore();
    // No document declares "type", so a type filter is structurally
    // impossible — dropImpossibleFilters drops it and SearchDocuments retries.
    const search = new SearchDocuments(store, null, { k: 10, excludedStatuses: [] });
    let captured: import("../../src/application/search-trace").SearchTrace | undefined;
    const response = await search.execute(
      { query: "alpha", type: "uc" },
      { onComplete: (t) => (captured = t) },
    );

    expect(response.filterWarning).toBeDefined();
    expect(captured!.attempts.length).toBe(2);
    expect(captured!.attempts[0]!.filters.type).toBe("uc");
    expect(captured!.attempts[1]!.filters.type).toBeUndefined();
    expect(captured!.filterWarning).toBe(response.filterWarning);
  });

  it("surfaces noMatchReason on the trace when the final attempt matches nothing", async () => {
    const store = baseStore();
    store.lexicalIds = [];
    store.vectorIds = [];
    const search = new SearchDocuments(store, null, { k: 10, excludedStatuses: [] });
    let captured: import("../../src/application/search-trace").SearchTrace | undefined;
    const response = await search.execute(
      { query: "nothing matches this" },
      { onComplete: (t) => (captured = t) },
    );
    expect(response.results).toHaveLength(0);
    expect(captured!.noMatchReason).toBe(response.noMatchReason);
  });
});

describe("search-trace — vector-leg branches are captured, never fabricated", () => {
  it("provider absent: no-provider", async () => {
    const search = new SearchDocuments(baseStore(), null, { k: 10, excludedStatuses: [] });
    let captured: import("../../src/application/search-trace").SearchTrace | undefined;
    await search.execute({ query: "alpha" }, { onComplete: (t) => (captured = t) });
    const vector = captured!.attempts[0]!.vector;
    expect(vector.available).toBe(false);
    if (!vector.available) expect(vector.reason).toBe("no-provider");
  });

  it("vectors absent from the store: no-vectors", async () => {
    const store = baseStore();
    store.vectorsAvailable = false;
    const search = new SearchDocuments(store, new CountingEmbeddings(), { k: 10, excludedStatuses: [] });
    let captured: import("../../src/application/search-trace").SearchTrace | undefined;
    await search.execute({ query: "alpha" }, { onComplete: (t) => (captured = t) });
    const vector = captured!.attempts[0]!.vector;
    expect(vector.available).toBe(false);
    if (!vector.available) expect(vector.reason).toBe("no-vectors");
  });

  it("embed() returns an empty array: empty-embedding", async () => {
    const search = new SearchDocuments(baseStore(), new EmptyEmbeddings(), { k: 10, excludedStatuses: [] });
    let captured: import("../../src/application/search-trace").SearchTrace | undefined;
    await search.execute({ query: "alpha" }, { onComplete: (t) => (captured = t) });
    const vector = captured!.attempts[0]!.vector;
    expect(vector.available).toBe(false);
    if (!vector.available) expect(vector.reason).toBe("empty-embedding");
  });

  it("embed() throws: embed-failed, response stays lexical, no invented rank", async () => {
    const search = new SearchDocuments(baseStore(), new ThrowingEmbeddings(), { k: 10, excludedStatuses: [] });
    let captured: import("../../src/application/search-trace").SearchTrace | undefined;
    const response = await search.execute({ query: "alpha" }, { onComplete: (t) => (captured = t) });
    expect(response.mode).toBe("lexical");
    const vector = captured!.attempts[0]!.vector;
    expect(vector.available).toBe(false);
    if (!vector.available) expect(vector.reason).toBe("embed-failed");
  });

  it("forceLexical skips the vector leg entirely: forced-lexical, zero embed calls", async () => {
    const embeddings = new CountingEmbeddings();
    const search = new SearchDocuments(baseStore(), embeddings, { k: 10, excludedStatuses: [] });
    let captured: import("../../src/application/search-trace").SearchTrace | undefined;
    await search.execute(
      { query: "alpha", forceLexical: true },
      { onComplete: (t) => (captured = t) },
    );
    expect(embeddings.calls).toBe(0);
    const vector = captured!.attempts[0]!.vector;
    expect(vector.available).toBe(false);
    if (!vector.available) expect(vector.reason).toBe("forced-lexical");
  });

  it("both legs available: vector.available is true and carries the store's own ranked ids", async () => {
    const store = baseStore();
    const search = new SearchDocuments(store, new CountingEmbeddings(), { k: 10, excludedStatuses: [] });
    let captured: import("../../src/application/search-trace").SearchTrace | undefined;
    const response = await search.execute({ query: "alpha" }, { onComplete: (t) => (captured = t) });
    expect(response.mode).toBe("hybrid");
    const vector = captured!.attempts[0]!.vector;
    expect(vector.available).toBe(true);
    if (vector.available) expect(vector.ids).toEqual(store.vectorIds);
  });
});

describe("search-trace — fusion, ties, cap and missing rows", () => {
  it("fused carries the exact unrounded RRF scores production used, including a tie", async () => {
    const store = new FakeStore();
    store.documents = [doc(1, "a.md"), doc(2, "b.md")];
    store.chunks = [chunk(1, 1, "x"), chunk(2, 2, "x")];
    // Both ids at rank 1 of their own list — a genuine RRF tie.
    store.lexicalIds = [1];
    store.vectorIds = [2];
    const search = new SearchDocuments(store, new CountingEmbeddings(), { k: 10, excludedStatuses: [] });
    let captured: import("../../src/application/search-trace").SearchTrace | undefined;
    await search.execute({ query: "x" }, { onComplete: (t) => (captured = t) });

    const fused = captured!.attempts[0]!.fused;
    expect(fused.map((f) => f.id).sort()).toEqual([1, 2]);
    const RRF_K = 5;
    for (const entry of fused) {
      expect(entry.score).toBeCloseTo(1 / (RRF_K + 1), 10);
    }
  });

  it("records which fused ids the per-document cap removed, before the final k-slice", async () => {
    const store = new FakeStore();
    // Three chunks, all in the SAME document — the cap (2/document) must
    // remove exactly one, and the trace must say which.
    store.documents = [doc(1, "one.md")];
    store.chunks = [chunk(1, 1, "alpha"), chunk(2, 1, "alpha"), chunk(3, 1, "alpha")];
    store.lexicalIds = [1, 2, 3];
    store.vectorIds = [];
    const search = new SearchDocuments(store, null, { k: 10, excludedStatuses: [] });
    let captured: import("../../src/application/search-trace").SearchTrace | undefined;
    await search.execute({ query: "alpha" }, { onComplete: (t) => (captured = t) });

    const attempt = captured!.attempts[0]!;
    expect(attempt.capRemovals.map((r) => r.id)).toEqual([3]);
    expect(attempt.capRemovals[0]!.documentId).toBe(1);
    expect(attempt.cappedIds).toEqual([1, 2]);
  });

  it("a fused id with no corresponding chunk row is excluded from finalIds without crashing", async () => {
    const store = new FakeStore();
    store.documents = [doc(1, "one.md")];
    // Fused list references chunk id 99, which getChunksByIds will never
    // return — simulating a row that vanished between fusion and lookup.
    store.chunks = [chunk(1, 1, "alpha")];
    store.lexicalIds = [1, 99];
    store.vectorIds = [];
    const search = new SearchDocuments(store, null, { k: 10, excludedStatuses: [] });
    let captured: import("../../src/application/search-trace").SearchTrace | undefined;
    const response = await search.execute({ query: "alpha" }, { onComplete: (t) => (captured = t) });

    expect(response.results.map((r) => r.path)).toEqual(["one.md"]);
    expect(captured!.attempts[0]!.finalIds).toEqual([1]);
  });
});
