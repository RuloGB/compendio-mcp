import { describe, expect, it } from "vitest";
import { FakeEmbeddings } from "../helpers/fake-embeddings";
import { SyncIndex, type SyncIndexOptions } from "../../src/application/sync-index";
import { createConventionPolicy, type ConventionConfig } from "../../src/domain/convention";
import type { ProgressEvent, ProgressReporter } from "../../src/domain/progress";
import type {
  DiscoverResult,
  DocumentFile,
  DocumentSource,
  EmbeddingsProvider,
  EncodingNotice,
  ReadError,
} from "../../src/domain/ports";
import { RemarkMarkdownParser } from "../../src/infrastructure/markdown/remark-markdown-parser";
import { SqliteIndexStore } from "../../src/infrastructure/sqlite/sqlite-index-store";

/**
 * Progress-emission cases for `SyncIndex`, kept in their own file (design.md
 * "Testing Strategy") so `sync-index.test.ts`'s diff stays additions-only —
 * a Gate 3 requirement. This file needs its own `MutableSource` fake rather
 * than importing the one in `sync-index.test.ts`, for the same reason.
 */

const LOOSE: ConventionConfig = {
  mode: "loose",
  excludedStatuses: [],
  frontmatterFields: { type: "type", module: "module", status: "status" },
};

const STRICT: ConventionConfig = {
  mode: "strict",
  types: ["guide"],
  statuses: ["current"],
  excludedStatuses: [],
  frontmatterFields: { type: "type", module: "module", status: "status" },
};

const CHUNKING = { chunking: { minTokens: 10, maxTokens: 800 }, noChunking: [] };

class MutableSource implements DocumentSource {
  files: DocumentFile[] = [];
  readErrors: ReadError[] = [];
  encodingNotices: EncodingNotice[] = [];
  async discover(): Promise<DiscoverResult> {
    return { files: this.files, readErrors: this.readErrors, encodingNotices: this.encodingNotices };
  }
}

function buildSync(
  store: SqliteIndexStore,
  source: MutableSource,
  embeddings: EmbeddingsProvider | null,
  onProgress: ProgressReporter | undefined,
  convention: ConventionConfig = LOOSE,
): SyncIndex {
  const options: SyncIndexOptions = { ...CHUNKING };
  if (onProgress !== undefined) options.onProgress = onProgress;
  return new SyncIndex(
    source,
    new RemarkMarkdownParser(),
    store,
    embeddings,
    createConventionPolicy(convention),
    options,
  );
}

/** Raw SQL escape hatch (white-box), mirroring `sync-index.test.ts`'s helper
 * of the same name: removes exactly one chunk's `chunks_vec` row without
 * touching its hash, to manufacture a vector-coverage gap. */
function dropVector(store: SqliteIndexStore, chunkId: number): void {
  const db = (store as unknown as { db: { prepare: (sql: string) => { run: (...a: unknown[]) => unknown } } })
    .db;
  db.prepare(`DELETE FROM chunks_vec WHERE chunk_id = ?`).run(chunkId);
}

function isFilesTick(
  e: ProgressEvent,
): e is Extract<ProgressEvent, { phase: "files"; kind: "tick" }> {
  return e.phase === "files" && e.kind === "tick";
}

function isEmbeddingEvent(e: ProgressEvent): boolean {
  return e.phase === "embedding";
}

describe("SyncIndex — progress emission", () => {
  it("P1: discovery/start is event 0; every files/tick follows the single files/start", async () => {
    const store = new SqliteIndexStore(":memory:");
    const source = new MutableSource();
    const events: ProgressEvent[] = [];
    const sync = buildSync(store, source, new FakeEmbeddings(), (e) => events.push(e));
    source.files = [{ path: "a.md", content: "# A\n\nText.\n" }];

    await sync.execute();

    expect(events[0]).toEqual({ phase: "discovery", kind: "start" });
    const startIndex = events.findIndex((e) => e.phase === "files" && e.kind === "start");
    expect(startIndex).toBeGreaterThan(0);
    const tickIndexes = events
      .map((e, i) => ({ isTick: isFilesTick(e), i }))
      .filter(({ isTick }) => isTick)
      .map(({ i }) => i);
    expect(tickIndexes.length).toBeGreaterThan(0);
    for (const i of tickIndexes) expect(i).toBeGreaterThan(startIndex);

    store.close();
  });

  it("P2: 3 indexed, then 1 edited -> files/start.total === 1, exactly one tick {current:1,total:1,path}", async () => {
    const store = new SqliteIndexStore(":memory:");
    const source = new MutableSource();
    source.files = [
      { path: "a.md", content: "# A\n\nText one.\n" },
      { path: "b.md", content: "# B\n\nText two.\n" },
      { path: "c.md", content: "# C\n\nText three.\n" },
    ];
    const seedSync = buildSync(store, source, new FakeEmbeddings(), undefined);
    await seedSync.execute();

    source.files = [
      { path: "a.md", content: "# A\n\nText one.\n" },
      { path: "b.md", content: "# B\n\nEDITED text two.\n" },
      { path: "c.md", content: "# C\n\nText three.\n" },
    ];
    const events: ProgressEvent[] = [];
    const sync = buildSync(store, source, new FakeEmbeddings(), (e) => events.push(e));
    await sync.execute();

    const start = events.find((e) => e.phase === "files" && e.kind === "start");
    expect(start).toEqual({ phase: "files", kind: "start", total: 1 });
    const ticks = events.filter(isFilesTick);
    expect(ticks).toEqual([{ phase: "files", kind: "tick", current: 1, total: 1, path: "b.md" }]);

    store.close();
  });

  it("P3: an all-unchanged pass -> files/start.total === 0, zero files/tick", async () => {
    const store = new SqliteIndexStore(":memory:");
    const source = new MutableSource();
    source.files = [{ path: "a.md", content: "# A\n\nText.\n" }];
    const seedSync = buildSync(store, source, new FakeEmbeddings(), undefined);
    await seedSync.execute();

    const events: ProgressEvent[] = [];
    const sync = buildSync(store, source, new FakeEmbeddings(), (e) => events.push(e));
    await sync.execute();

    const start = events.find((e) => e.phase === "files" && e.kind === "start");
    expect(start).toEqual({ phase: "files", kind: "start", total: 0 });
    expect(events.filter(isFilesTick)).toEqual([]);

    store.close();
  });

  it("P4: 2 changed, 1 rejected by policy.resolver under strict -> total: 2, ticks 1/2 and 2/2 both fire", async () => {
    const store = new SqliteIndexStore(":memory:");
    const source = new MutableSource();
    const events: ProgressEvent[] = [];
    const sync = buildSync(store, source, new FakeEmbeddings(), (e) => events.push(e), STRICT);

    source.files = [
      { path: "a.md", content: "---\ntype: guide\nmodule: m\nstatus: current\n---\n\n# A\n\nText.\n" },
      { path: "b.md", content: "---\ntype: invalid\n---\n\n# B\n\nText.\n" },
    ];

    await sync.execute();

    const start = events.find((e) => e.phase === "files" && e.kind === "start");
    expect(start).toEqual({ phase: "files", kind: "start", total: 2 });
    const ticks = events.filter(isFilesTick).map((e) => `${e.current}/${e.total}`);
    expect(ticks).toEqual(["1/2", "2/2"]);

    store.close();
  });

  it("P5: at the moment each files/tick fires, the document is already committed to the store", async () => {
    const store = new SqliteIndexStore(":memory:");
    const source = new MutableSource();
    source.files = [
      { path: "a.md", content: "# A\n\nText one.\n" },
      { path: "b.md", content: "# B\n\nText two.\n" },
    ];
    const seen: { path: string; committed: boolean }[] = [];
    const onProgress: ProgressReporter = (e) => {
      if (isFilesTick(e)) {
        seen.push({ path: e.path, committed: store.getDocumentByPath(e.path) !== null });
      }
    };
    const sync = buildSync(store, source, new FakeEmbeddings(), onProgress);

    await sync.execute();

    expect(seen).toHaveLength(2);
    expect(seen.every((s) => s.committed)).toBe(true);

    store.close();
  });

  it("P8: a SyncIndex built with no onProgress completes a full pass without throwing", async () => {
    const store = new SqliteIndexStore(":memory:");
    const source = new MutableSource();
    source.files = [{ path: "a.md", content: "# A\n\nText.\n" }];
    const sync = buildSync(store, source, new FakeEmbeddings(), undefined);

    await expect(sync.execute()).resolves.toBeDefined();

    store.close();
  });
});
