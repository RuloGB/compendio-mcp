import { describe, expect, it, vi } from "vitest";
import { IndexDocuments } from "../../src/application/index-documents";
import { createConventionPolicy, type ConventionConfig } from "../../src/domain/convention";
import type { ProgressEvent, ProgressReporter } from "../../src/domain/progress";
import type { DiscoverResult, DocumentFile, DocumentSource, EmbeddingsProvider } from "../../src/domain/ports";
import { DEFAULT_CONFIG, NO_CHUNKING } from "../../src/infrastructure/config";
import { FileDocumentSource } from "../../src/infrastructure/fs/file-document-source";
import { RemarkMarkdownParser } from "../../src/infrastructure/markdown/remark-markdown-parser";
import { SqliteIndexStore } from "../../src/infrastructure/sqlite/sqlite-index-store";
import { EXAMPLES_CONVENTION, EXAMPLES_DOCS } from "../helpers/build";
import { BrokenEmbeddings, FakeEmbeddings } from "../helpers/fake-embeddings";

function buildExamplesIndexer(
  embeddings: EmbeddingsProvider | null,
  onProgress: ProgressReporter,
): { indexer: IndexDocuments; store: SqliteIndexStore } {
  const store = new SqliteIndexStore(":memory:");
  const indexer = new IndexDocuments(
    new FileDocumentSource(EXAMPLES_DOCS, ["INDEX.md"]),
    new RemarkMarkdownParser(),
    store,
    embeddings,
    createConventionPolicy(EXAMPLES_CONVENTION),
    // Mirrors production config exactly (imported, not re-typed) so this
    // harness can never drift from `DEFAULT_CONFIG.chunk` again.
    { chunking: DEFAULT_CONFIG.chunk, noChunking: NO_CHUNKING, onProgress },
  );
  return { indexer, store };
}

describe("IndexDocuments — progress emission over the ejemplos corpus", () => {
  it("emits discovery/start first, files/start.total before the first tick, and reports the right batch count", async () => {
    const onProgress = vi.fn<ProgressReporter>();
    const { indexer, store } = buildExamplesIndexer(new FakeEmbeddings(), onProgress);
    const report = await indexer.execute();
    store.close();

    const events = onProgress.mock.calls.map((call) => call[0]);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]).toEqual({ phase: "discovery", kind: "start" });

    const filesStartIndex = events.findIndex((e) => e.phase === "files" && e.kind === "start");
    const firstTickIndex = events.findIndex((e) => e.phase === "files" && e.kind === "tick");
    expect(filesStartIndex).toBeGreaterThanOrEqual(0);
    expect(firstTickIndex).toBeGreaterThan(filesStartIndex);
    const filesStart = events.find((e) => e.phase === "files" && e.kind === "start");
    if (filesStart === undefined || filesStart.phase !== "files" || filesStart.kind !== "start") {
      throw new Error("unreachable");
    }
    // INDEX.md is excluded, so files.length === report.indexed.length + report.skipped.length.
    expect(filesStart.total).toBe(report.indexed.length + report.skipped.length);

    const embeddingStart = events.find((e) => e.phase === "embedding" && e.kind === "start");
    expect(embeddingStart).toBeDefined();
    if (
      embeddingStart === undefined ||
      embeddingStart.phase !== "embedding" ||
      embeddingStart.kind !== "start"
    ) {
      throw new Error("unreachable");
    }
    expect(embeddingStart.batches).toBe(Math.ceil(report.totalChunks / 16));
  });

  it("--lexical (embeddings: null) emits zero embedding-phase events", async () => {
    const onProgress = vi.fn<ProgressReporter>();
    const { indexer, store } = buildExamplesIndexer(null, onProgress);
    await indexer.execute();
    store.close();

    const events = onProgress.mock.calls.map((call) => call[0]);
    expect(events.some((e) => e.phase === "embedding")).toBe(false);
  });

  it("a broken embeddings provider emits exactly one embedding/failed event; the run still finishes lexical", async () => {
    const onProgress = vi.fn<ProgressReporter>();
    const { indexer, store } = buildExamplesIndexer(new BrokenEmbeddings(), onProgress);
    const report = await indexer.execute();
    store.close();

    expect(report.mode).toBe("lexical");
    const events = onProgress.mock.calls.map((call) => call[0]);
    const failedEvents = events.filter((e) => e.phase === "embedding" && e.kind === "failed");
    expect(failedEvents).toHaveLength(1);
  });
});

// --- A skipped file must still tick: the design's "top of the loop body" seam ---

class StaticSource implements DocumentSource {
  constructor(private readonly files: DocumentFile[]) {}
  async discover(): Promise<DiscoverResult> {
    return { files: this.files, readErrors: [] };
  }
}

const LOOSE: ConventionConfig = {
  mode: "loose",
  excludedStatuses: [],
  frontmatterFields: { type: "type", module: "module", status: "status" },
};

/** Wraps a real fake provider so the call order can be interleaved with events. */
class RecordingEmbeddings implements EmbeddingsProvider {
  private readonly inner = new FakeEmbeddings();
  constructor(private readonly log: string[]) {}
  async embed(texts: string[]): Promise<Float32Array[]> {
    this.log.push("embed");
    return this.inner.embed(texts);
  }
}

describe("IndexDocuments — an embedding tick reports completed work", () => {
  it("emits each embedding/tick only after its batch has been embedded", async () => {
    // Reporting the tick before the await made the bar read N/N while the last
    // batch had not started — on a corpus with one oversized chunk that is
    // minutes of apparent hang at 100%. `current` must count finished batches.
    const log: string[] = [];
    const store = new SqliteIndexStore(":memory:");
    // 20 single-chunk documents => 2 batches at the default batch size of 16.
    const files = Array.from({ length: 20 }, (_, i) => ({
      path: `doc-${i}.md`,
      content: `# Doc ${i}\n\nContenido suficiente para producir un chunk indexable.\n`,
    }));
    const onProgress: ProgressReporter = (event) => {
      if (event.phase === "embedding" && event.kind === "tick") {
        log.push(`tick:${event.current}/${event.total}`);
      }
    };
    const indexer = new IndexDocuments(
      new StaticSource(files),
      new RemarkMarkdownParser(),
      store,
      new RecordingEmbeddings(log),
      createConventionPolicy(LOOSE),
      { chunking: { minTokens: 10, maxTokens: 800 }, noChunking: [], onProgress },
    );
    await indexer.execute();
    store.close();

    // Every batch is embedded first and only then counted.
    expect(log).toEqual(["embed", "tick:1/2", "embed", "tick:2/2"]);
  });
});

describe("IndexDocuments — a skipped file still ticks", () => {
  it("emits files/tick for a document skipped for having no indexable content", async () => {
    const onProgress = vi.fn<ProgressReporter>();
    const store = new SqliteIndexStore(":memory:");
    const source = new StaticSource([
      { path: "ok.md", content: "# OK\n\nSome real text.\n" },
      { path: "empty.md", content: "# Only title\n\n" },
    ]);
    const indexer = new IndexDocuments(
      source,
      new RemarkMarkdownParser(),
      store,
      null,
      createConventionPolicy(LOOSE),
      { chunking: { minTokens: 10, maxTokens: 800 }, noChunking: [], onProgress },
    );
    const report = await indexer.execute();
    store.close();

    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0]!.path).toBe("empty.md");

    const ticks = onProgress.mock.calls
      .map((call) => call[0])
      .filter((e): e is Extract<ProgressEvent, { phase: "files"; kind: "tick" }> =>
        e.phase === "files" && e.kind === "tick",
      );
    expect(ticks).toHaveLength(2);
    expect(ticks.map((t) => t.path)).toEqual(["ok.md", "empty.md"]);
  });
});
