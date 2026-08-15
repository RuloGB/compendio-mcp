import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContainer, type Container } from "../../src/composition";

// es-frozen: cites the real `ejemplos/` corpus name, not a leftover translation.
/**
 * Phase 4 (Gate 3), read-doc-fence-aware-sections. Re-asserts the existing
 * `section` round-trip requirement (`mcp-contract/spec.md:47-69`, unedited by
 * this change) still holds after `headingsIn`'s fence-aware rewrite
 * (design.md Decision 5's invariant: `search_docs`'s `section` values are
 * copies of the chunk's stored `heading`, which comes from remark and is
 * therefore already fence-free -- they match on the untouched first `||`
 * branch, so this test's role is confirmation rather than a red-first case).
 *
 * Harness shape follows `goldenset-addresses.test.ts`, not the "Gate 1 / Gate
 * 3" describe block in `index-and-search.test.ts` (that block's own "Gate 3"
 * label is about alias-aware module inference, unrelated to round-trip --
 * orchestrator note, tasks.md Phase 4). Copies `ejemplos/` into a temp
 * directory rather than indexing in place, since
 * `ejemplos/.compendio/compendio.db` is a real, git-ignored artifact other
 * scripts read and must not be clobbered by this test. `forceLexical: true`
 * keeps the run hermetic -- no model download, no network, no nondeterminism
 * -- and the goldenset's own `pregunta` questions are reused verbatim as a
 * curated, already-existing query list rather than inventing a new one.
 */
const EXAMPLES_ROOT = fileURLToPath(new URL("../../ejemplos", import.meta.url));

describe("read_doc's section round-trip survives headingsIn's fence-aware rewrite (Gate 3)", () => {
  let tmp: string;
  let container: Container;

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), "compendio-fence-roundtrip-"));
    await cp(EXAMPLES_ROOT, tmp, { recursive: true, filter: (src) => !src.includes(".compendio") });
    container = createContainer({ root: tmp, forceLexical: true });
    await container.indexDocuments.execute();
  });

  afterAll(async () => {
    container.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it("every search_docs result's section, passed verbatim to read_doc, resolves to a section (never section-not-found)", async () => {
    const raw = await readFile(join(tmp, "goldenset.yaml"), "utf8");
    // es-frozen: reads the real `pregunta` key, does not rename or translate it.
    const cases = parseYaml(raw) as { pregunta: string; esperado: string }[];
    expect(cases.length).toBeGreaterThan(0);

    let checked = 0;
    for (const item of cases) {
      const response = await container.searchDocuments.execute({ query: item.pregunta });
      for (const result of response.results) {
        checked += 1;
        const read = container.readDocument.execute({ path: result.path, section: result.section });
        expect(read.type).toBe("section");
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
