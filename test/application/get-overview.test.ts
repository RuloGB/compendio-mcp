import { describe, expect, it } from "vitest";
import { formatOverview, GetOverview, toSyncInfo, type Overview } from "../../src/application/get-overview";
import type { SyncReport } from "../../src/application/sync-index";
import type { DocumentMeta } from "../../src/domain/model";
import type { ConfigWarning } from "../../src/domain/ports";
import { SqliteIndexStore } from "../../src/infrastructure/sqlite/sqlite-index-store";

function fakeReport(overrides: Partial<SyncReport> = {}): SyncReport {
  return {
    mode: "hybrid",
    indexed: [],
    deleted: [],
    skipped: [],
    totalChunks: 0,
    durationMs: 1,
    reconciled: [],
    ...overrides,
  };
}

function seed(store: SqliteIndexStore, overrides: Partial<DocumentMeta> & { path: string }): void {
  const meta: DocumentMeta = {
    path: overrides.path,
    title: overrides.title ?? overrides.path,
    summary: overrides.summary ?? "content",
    tags: overrides.tags ?? [],
    hash: overrides.hash ?? overrides.path,
    ...(overrides.type !== undefined ? { type: overrides.type } : {}),
    ...(overrides.module !== undefined ? { module: overrides.module } : {}),
    ...(overrides.status !== undefined ? { status: overrides.status } : {}),
  };
  store.saveDocument(meta, [{ heading: "H", content: "content", position: 0 }]);
}

describe("GetOverview — empty taxonomy omission", () => {
  it("omits the 'By type:' and 'By module:' lines when no document defines them", () => {
    const store = new SqliteIndexStore(":memory:");
    seed(store, { path: "a.md" });
    seed(store, { path: "b.md" });

    const overview = new GetOverview(store).execute();
    expect(overview.byType).toEqual({});
    expect(overview.byModule).toEqual({});

    const salida = formatOverview(overview);
    expect(salida).not.toContain("By type:");
    expect(salida).not.toContain("By module:");
    store.close();
  });
});

describe("GetOverview — partial type coverage", () => {
  it("counts only documents that define type, with no synthetic bucket", () => {
    const store = new SqliteIndexStore(":memory:");
    seed(store, { path: "a.md", type: "guia" });
    seed(store, { path: "b.md" }); // no type

    const overview = new GetOverview(store).execute();
    expect(overview.byType).toEqual({ guia: 1 });
    expect(overview.totalDocuments).toBe(2);

    const salida = formatOverview(overview);
    expect(salida).toContain("By type: guia (1)");
    expect(salida).not.toContain("undefined");
    store.close();
  });
});

describe("GetOverview — per-document line ordering and segment omission", () => {
  it("orders lines alphabetically by path and omits absent type/status segments", () => {
    const store = new SqliteIndexStore(":memory:");
    seed(store, { path: "z.md", type: "guia", status: "vigente" });
    seed(store, { path: "a.md" }); // no type, no status
    seed(store, { path: "m.md", type: "adr" }); // type only

    const overview = new GetOverview(store).execute();
    expect(overview.documents.map((d) => d.path)).toEqual(["a.md", "m.md", "z.md"]);

    const salida = formatOverview(overview);
    const lineas = salida.split("\n").filter((l) => l.startsWith("- "));
    expect(lineas[0]).toBe("- a.md — content");
    expect(lineas[1]).toBe("- [adr] m.md — content");
    expect(lineas[2]).toBe("- [guia] z.md — content (vigente)");
    store.close();
  });
});

describe("GetOverview summary fallback", () => {
  it("shows the title when the document has no intro paragraph", () => {
    const store = new SqliteIndexStore(":memory:");
    const meta: DocumentMeta = {
      path: "guias/transversal-no-summary.md",
      title: "Guide with no summary",
      summary: "",
      type: "guia",
      module: "transversal",
      status: "vigente",
      tags: [],
      hash: "abc",
    };
    store.saveDocument(meta, [{ heading: "Section", content: "## Section\n\nText.", position: 0 }]);

    const overview = new GetOverview(store).execute();
    expect(overview.documents[0]!.summary).toBe("Guide with no summary");
    expect(formatOverview(overview)).toContain(
      "- [guia] guias/transversal-no-summary.md — Guide with no summary (vigente)",
    );

    store.close();
  });
});

describe("toSyncInfo — content-based omission", () => {
  it("is null when there is no report yet (lastReport is null)", () => {
    expect(toSyncInfo(null)).toBeNull();
  });

  it("is null when the most recent pass had nothing to report (empty skipped, no embeddingsWarning)", () => {
    expect(toSyncInfo(fakeReport())).toBeNull();
  });

  it("surfaces skipped items when the most recent pass skipped a document", () => {
    const report = fakeReport({ skipped: [{ path: "a.md", errors: ["motivo"] }] });
    expect(toSyncInfo(report)).toEqual({ skipped: [{ path: "a.md", errors: ["motivo"] }] });
  });

  it("surfaces embeddingsWarning when the most recent pass degraded to lexical-only", () => {
    const report = fakeReport({ embeddingsWarning: "embeddings unavailable: search runs in lexical mode" });
    expect(toSyncInfo(report)).toEqual({
      skipped: [],
      embeddingsWarning: "embeddings unavailable: search runs in lexical mode",
    });
  });

  it("is non-null for a pass whose only finding is a populated encodingNotices", () => {
    const report = fakeReport({ encodingNotices: [{ path: "cp1252.md", encoding: "windows-1252" }] });
    expect(toSyncInfo(report)).toEqual({
      skipped: [],
      encodingNotices: [{ path: "cp1252.md", encoding: "windows-1252" }],
    });
  });
});

describe("formatOverview — sync block", () => {
  it("omits the block entirely when sync is null or undefined", () => {
    const store = new SqliteIndexStore(":memory:");
    seed(store, { path: "a.md" });
    const overview = new GetOverview(store).execute();

    expect(formatOverview(overview)).not.toContain("Sync");
    expect(formatOverview(overview, null)).not.toContain("Sync");
    expect(formatOverview(overview, undefined)).not.toContain("Sync");
    store.close();
  });

  it("renders skipped items and embeddingsWarning when sync has content", () => {
    const store = new SqliteIndexStore(":memory:");
    seed(store, { path: "a.md" });
    const overview = new GetOverview(store).execute();

    const salida = formatOverview(overview, {
      skipped: [{ path: "roto.md", errors: ["permiso denegado"] }],
      embeddingsWarning: "embeddings unavailable: search runs in lexical mode",
    });

    expect(salida).toContain("Sync");
    expect(salida).toContain("roto.md");
    expect(salida).toContain("permiso denegado");
    expect(salida).toContain("embeddings unavailable: search runs in lexical mode");
    store.close();
  });

  it("renders an encoding-notice line when sync.encodingNotices is present", () => {
    const store = new SqliteIndexStore(":memory:");
    seed(store, { path: "a.md" });
    const overview = new GetOverview(store).execute();

    const salida = formatOverview(overview, {
      skipped: [],
      encodingNotices: [{ path: "cp1252.md", encoding: "windows-1252" }],
    });

    expect(salida).toContain("Sync");
    expect(salida).toContain("cp1252.md");
    expect(salida).toContain("windows-1252");
    store.close();
  });
});

/**
 * `Config:` block (design.md Decision 6, Slice 2, mcp-contract spec's
 * "Config-Warning Visibility in `docs_overview` Response"). Distinct from
 * `Sync:` -- a config-load report describes the running process' state, not
 * the outcome of the most recent sync pass -- and MUST NOT render empty
 * (Gate 6c: a clean/no-config project must show no `Config:` block, ever).
 */
describe("formatOverview — Config: block (design.md Decision 6, Slice 2)", () => {
  function baseOverview(): Overview {
    const store = new SqliteIndexStore(":memory:");
    seed(store, { path: "a.md" });
    const overview = new GetOverview(store).execute();
    store.close();
    return overview;
  }

  it("omits the Config: block when configWarnings is not passed at all", () => {
    expect(formatOverview(baseOverview())).not.toContain("Config:");
  });

  it("omits the Config: block when configWarnings is an empty array (Gate 6c)", () => {
    expect(formatOverview(baseOverview(), undefined, [])).not.toContain("Config:");
  });

  it("renders a Config: block naming the key when configWarnings is non-empty", () => {
    const warnings: ConfigWarning[] = [
      { kind: "invalid-value", key: "chunk.maxTokens", declared: "0", inEffect: 480 },
    ];
    const salida = formatOverview(baseOverview(), undefined, warnings);
    expect(salida).toContain("Config:");
    expect(salida).toContain("chunk.maxTokens");
  });

  it("keeps Config: distinct from, and never folded into, Sync: -- both render when both have content", () => {
    const warnings: ConfigWarning[] = [{ kind: "unknown-key", key: "search.excludedStatuses" }];
    const salida = formatOverview(
      baseOverview(),
      { skipped: [{ path: "roto.md", errors: ["permiso denegado"] }] },
      warnings,
    );
    expect(salida).toContain("Sync:");
    expect(salida).toContain("Config:");
    expect(salida.indexOf("Sync:")).toBeLessThan(salida.indexOf("Config:"));
  });

  it("renders on every call, not only the first (config-load state is constant for the process' life)", () => {
    const overview = baseOverview();
    const warnings: ConfigWarning[] = [
      { kind: "invalid-value", key: "chunk.maxTokens", declared: "0", inEffect: 480 },
    ];
    const first = formatOverview(overview, undefined, warnings);
    const second = formatOverview(overview, undefined, warnings);
    expect(first).toContain("Config:");
    expect(second).toContain("Config:");
  });

  it("does not change search_docs' response shape -- formatOverview's own default 2-arg call is untouched", () => {
    // Regression guard for Gate 6e: every pre-existing call site that omits
    // the third argument keeps rendering exactly as before.
    const salida = formatOverview(baseOverview());
    expect(salida).not.toContain("Config:");
  });
});

/**
 * Gate 3 (design.md Decision 6): pins the *data-integrity, not security*
 * framing so a later reader cannot re-file this change as a security fix,
 * and so a later change cannot quietly introduce real pollution. This is a
 * standing invariant, not a reproduction -- it is expected to pass on both
 * the pre-fix and post-fix tree (declared exception to strict_tdd's
 * failing-first rule, tasks.md Task 1).
 */
describe("GetOverview — prototype integrity (non-regression, Gate 3)", () => {
  it("leaves Object.prototype untouched when counting __proto__/constructor type values", () => {
    const before = Object.getOwnPropertyNames(Object.prototype);

    const store = new SqliteIndexStore(":memory:");
    seed(store, { path: "a.md", type: "__proto__" });
    seed(store, { path: "b.md", type: "constructor" });
    new GetOverview(store).execute();
    store.close();

    // (a) no new own property appeared on Object.prototype.
    const after = Object.getOwnPropertyNames(Object.prototype);
    expect(after).toEqual(before);

    // (b) no enumerable inheritance leak on a fresh, unrelated object.
    expect(Object.keys({}).length).toBe(0);

    // (c) `constructor` is a writable DATA property of Object.prototype --
    // the exact member the `constructor` branch writes through. (a) alone
    // is blind to a *value* change on an existing own property; this row
    // is what turns the spec derivation into an observed fact.
    //
    // FORBIDDEN, on the record: `Object.prototype.hasOwnProperty('__proto__')
    // === false` MUST NOT be used as a pollution predicate here. `__proto__`
    // genuinely IS an own accessor property of a healthy `Object.prototype`,
    // so that probe reports pollution on an unmodified runtime -- it already
    // produced a false positive earlier in this project's history.
    expect(({}).constructor).toBe(Object);
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });
});
