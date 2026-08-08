import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContainer, type Container } from "../../src/composition";

// es-frozen: cites the real `ejemplos/` corpus name, not a leftover translation.
/**
 * design.md Decision 14 / Gates 1b + 1c, in one file.
 *
 * This is the FIRST test in the suite that goes through `createContainer`
 * (measured 2026-08-07: zero call sites before this file existed). Every
 * other integration test bypasses config + composition entirely via
 * `test/helpers/build.ts`'s direct `FileDocumentSource` construction, so the
 * suite was structurally blind to the zero-config path shape and to the
 * goldenset's own addressing going stale — both would stay green in
 * `npm test` while `compendio eval` silently reported MRR 0.
 *
 * Copies `ejemplos/` (docs + goldenset.yaml) into a temp directory rather
 * than indexing in place: `ejemplos/.compendio/compendio.db` is a real,
 * git-ignored artifact `scripts/excerpt-offset-distribution.mjs` reads, and
 * this test must not clobber it. `forceLexical: true` keeps the assertion
 * address-only — no model download, no network, no nondeterminism.
 */
const EXAMPLES_ROOT = fileURLToPath(new URL("../../ejemplos", import.meta.url));

describe("goldenset addresses — through real createContainer wiring", () => {
  let tmp: string;
  let container: Container;

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), "compendio-goldenset-"));
    await cp(EXAMPLES_ROOT, tmp, { recursive: true, filter: (src) => !src.includes(".compendio") });
    container = createContainer({ root: tmp, forceLexical: true });
    await container.indexDocuments.execute();
  });

  afterAll(async () => {
    container.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it("Gate 1b: every indexed path carries the docs/ prefix, with no config file at all", () => {
    const indexed = container.store.listDocuments().map((d) => d.path);
    expect(indexed.length).toBeGreaterThan(0);
    expect(indexed.every((p) => p.startsWith("docs/"))).toBe(true);
  });

  it("Gate 1c: every real goldenset esperado address is a real indexed path", async () => {
    const raw = await readFile(join(tmp, "goldenset.yaml"), "utf8");
    const cases = parseYaml(raw) as { pregunta: string; esperado: string }[];
    expect(cases.length).toBeGreaterThan(0);

    const indexed = new Set(container.store.listDocuments().map((d) => d.path));
    for (const item of cases) {
      expect(indexed).toContain(item.esperado);
    }
  });
});
