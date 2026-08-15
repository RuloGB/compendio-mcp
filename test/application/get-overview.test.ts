import { describe, expect, it } from "vitest";
import { formatOverview, GetOverview, toSyncInfo, type Overview } from "../../src/application/get-overview";
import type { SyncReport } from "../../src/application/sync-index";
import { createConventionPolicy, type ConventionConfig } from "../../src/domain/convention";
import type { DocumentMeta } from "../../src/domain/model";
import type { ConfigWarning } from "../../src/domain/ports";
import { SqliteIndexStore } from "../../src/infrastructure/sqlite/sqlite-index-store";

const LOOSE: ConventionConfig = {
  mode: "loose",
  excludedStatuses: [],
  frontmatterFields: { type: "type", module: "module", status: "status" },
};

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

/**
 * Spec: `docs_overview` Taxonomy Counters Are Safe For Any `type`/`module`
 * Value (specs/mcp-contract/spec.md), all 5 scenarios. Design: Decisions 1, 5.
 * Gate 1 (design.md Testing Strategy table).
 *
 * NOTE on assertion direction: tasks.md Task 2 (2.1/2.3) literally describes
 * asserting *absence* of the `__proto__` bucket and calls that the failure
 * to reproduce on the unfixed tree. Measured against this repo's actual
 * runtime (`Annex B [[Set]]` on a non-object value is a silent no-op), that
 * assertion is TRUE pre-fix -- it is the bug itself, not a red test for it --
 * so it passes immediately on the unfixed tree, which is tasks.md's own
 * declared STOP condition ("If it passes on the unfixed tree, STOP"). The
 * spec (Scenario 1: "includes a __proto__ (1) entry, not an omitted bucket")
 * and design.md's Testing Strategy table (Gate 1's "After" row) are
 * unambiguous and agree with each other on the opposite direction: presence,
 * with the correct value. These tests assert the spec-required outcome, which
 * genuinely fails pre-fix and passes post-fix. See apply-progress.md for the
 * full diagnosis.
 */
describe("GetOverview — byType/byModule counter safety (spec: Taxonomy Counters Are Safe)", () => {
  it("counts a `__proto__` type value as a genuine own entry, not an omitted bucket (Scenario 1)", () => {
    const store = new SqliteIndexStore(":memory:");
    seed(store, { path: "a.md", type: "__proto__" });

    const overview = new GetOverview(store).execute();

    // Layer 2 (design.md Decision 2) -- against the RETURNED object, never
    // the internal Map. An assigning conversion yields `undefined` here.
    const descriptor = Object.getOwnPropertyDescriptor(overview.byType, "__proto__");
    expect(descriptor).toBeDefined();
    expect(descriptor).toMatchObject({ value: 1, enumerable: true });

    expect(formatOverview(overview)).toContain("__proto__ (1)");
    store.close();
  });

  it("counts a `constructor` type value as a number, not garbled function source text (Scenario 2)", () => {
    const store = new SqliteIndexStore(":memory:");
    seed(store, { path: "a.md", type: "constructor" });

    const overview = new GetOverview(store).execute();

    // Assert the type, not presence alone -- a garbled string is also
    // "present" pre-fix.
    expect(typeof overview.byType.constructor).toBe("number");
    expect(overview.byType.constructor).toBe(1);

    const salida = formatOverview(overview);
    expect(salida).toContain("constructor (1)");
    expect(salida).not.toContain("native code");
    store.close();
  });

  it("counts a `__proto__` module value, reached via a folder name through the production route, as a genuine own entry (Scenario 3)", () => {
    // Production route, no fixture directory on disk (design.md Decision 5):
    // inferModule genuinely produces "__proto__" from the path string alone.
    const policy = createConventionPolicy(LOOSE, ["docs"]);
    const result = policy.resolver({
      path: "docs/__proto__/a.md",
      title: "A",
      summary: "content",
      data: {},
      hash: "h",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable: resolver rejected a loose-mode input");
    expect(result.meta.module).toBe("__proto__");

    const store = new SqliteIndexStore(":memory:");
    store.saveDocument(result.meta, [{ heading: "H", content: "content", position: 0 }]);

    const overview = new GetOverview(store).execute();
    const descriptor = Object.getOwnPropertyDescriptor(overview.byModule, "__proto__");
    expect(descriptor).toBeDefined();
    expect(descriptor).toMatchObject({ value: 1, enumerable: true });

    expect(formatOverview(overview)).toContain("By module: __proto__ (1)");
    store.close();
  });

  it("counts a `constructor` module value, reached via a folder name through the production route, as a number (Scenario 4)", () => {
    const policy = createConventionPolicy(LOOSE, ["docs"]);
    const result = policy.resolver({
      path: "docs/constructor/a.md",
      title: "A",
      summary: "content",
      data: {},
      hash: "h",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable: resolver rejected a loose-mode input");
    expect(result.meta.module).toBe("constructor");

    const store = new SqliteIndexStore(":memory:");
    store.saveDocument(result.meta, [{ heading: "H", content: "content", position: 0 }]);

    const overview = new GetOverview(store).execute();
    expect(typeof overview.byModule.constructor).toBe("number");
    expect(overview.byModule.constructor).toBe(1);

    const salida = formatOverview(overview);
    expect(salida).toContain("By module: constructor (1)");
    expect(salida).not.toContain("native code");
    store.close();
  });

  it("does not let a __proto__/constructor type affect an ordinary value's count in the same corpus (Scenario 5)", () => {
    const store = new SqliteIndexStore(":memory:");
    seed(store, { path: "a.md", type: "__proto__" });
    seed(store, { path: "b.md", type: "constructor" });
    seed(store, { path: "c.md", type: "guide" });

    const overview = new GetOverview(store).execute();

    expect(Object.getOwnPropertyDescriptor(overview.byType, "__proto__")).toMatchObject({ value: 1 });
    expect(typeof overview.byType.constructor).toBe("number");
    expect(overview.byType.constructor).toBe(1);
    expect(overview.byType.guide).toBe(1);

    const salida = formatOverview(overview);
    expect(salida).toContain("__proto__ (1)");
    expect(salida).toContain("constructor (1)");
    expect(salida).toContain("guide (1)");
    store.close();
  });
});

/**
 * Gate 1b (design.md Decision 5) -- rendered self-consistency for `byType`.
 * Every `type` shown in a per-document `[type]` segment MUST appear in the
 * `By type:` line with a matching count. Discriminates "correctly absent"
 * from "silently lost" without hard-coding any expected value.
 */
function assertByTypeSelfConsistency(overview: Overview, salida: string): void {
  const lines = salida.split("\n");
  const docLines = lines.filter((l) => l.startsWith("- "));

  // Mandatory anti-vacuity guard (design.md Decision 5): without this, a
  // regex matching nothing on both sides passes trivially and the whole
  // gate is noise. Do not delete this as "unused" -- it is the assertion
  // that keeps the gate from being vacuous.
  expect(docLines.length).toBe(overview.documents.length);

  const perDocCounts = new Map<string, number>();
  for (const line of docLines) {
    const match = /^- \[([^\]]+)\] /.exec(line);
    if (match) {
      const type = match[1]!;
      perDocCounts.set(type, (perDocCounts.get(type) ?? 0) + 1);
    }
  }

  const byTypeLine = lines.find((l) => l.startsWith("By type: "));
  for (const [type, count] of perDocCounts) {
    expect(byTypeLine).toBeDefined();
    expect(byTypeLine).toContain(`${type} (${count})`);
  }
}

describe("GetOverview — byType self-consistency invariant (Gate 1b, design.md Decision 5)", () => {
  it("agrees with itself on a hostile corpus (fails before the fix, holds after)", () => {
    const store = new SqliteIndexStore(":memory:");
    seed(store, { path: "a.md", type: "__proto__" });
    seed(store, { path: "b.md", type: "constructor" });
    seed(store, { path: "c.md", type: "guide" });

    const overview = new GetOverview(store).execute();
    const salida = formatOverview(overview);
    assertByTypeSelfConsistency(overview, salida);
    store.close();
  });

  it("holds on a genuinely typeless corpus (never fights the omission requirement it sits beside)", () => {
    const store = new SqliteIndexStore(":memory:");
    seed(store, { path: "a.md" });
    seed(store, { path: "b.md" });

    const overview = new GetOverview(store).execute();
    const salida = formatOverview(overview);
    assertByTypeSelfConsistency(overview, salida);
    store.close();
  });
});

/**
 * Gate 2 second half (design.md Decision 4) -- `byModule` twin-corpus
 * differential. `formatDocLine` never renders `module`, so there is no
 * per-document cross-check the way there is for `byType`; two otherwise-
 * identical corpora, differing only in the module value, are compared
 * instead. The falsifier is the *difference in `By module:` line presence*
 * between them, which is invisible to any assertion looking at the hostile
 * corpus alone.
 */
describe("GetOverview — byModule twin-corpus differential (Gate 2, design.md Decision 4)", () => {
  it("renders a By module: line for the hostile corpus exactly as it does for the control corpus", () => {
    const controlStore = new SqliteIndexStore(":memory:");
    seed(controlStore, { path: "a.md", module: "guides" });
    const controlSalida = formatOverview(new GetOverview(controlStore).execute());
    controlStore.close();

    const hostileStore = new SqliteIndexStore(":memory:");
    seed(hostileStore, { path: "a.md", module: "__proto__" });
    const hostileSalida = formatOverview(new GetOverview(hostileStore).execute());
    hostileStore.close();

    expect(controlSalida).toContain("By module: guides (1)");
    expect(hostileSalida).toContain("By module: __proto__ (1)");
  });
});
