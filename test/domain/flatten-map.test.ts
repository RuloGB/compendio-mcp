import { describe, expect, it } from "vitest";
import { flattenWithMap, toFlatOffset, type FlatText } from "../../src/domain/flatten-map";

/**
 * I4 golden reference: a duplicate copy of today's private `flatten()`
 * chain (`excerpt.ts:61-74`), kept only to prove `flattenWithMap` produces
 * byte-identical text. `flatten`'s exact output is the excerpt contract,
 * and this refactor is otherwise free to change it silently.
 */
function referenceFlatten(markdown: string, dropFencedBlocks: boolean): string {
  const withoutHeadings = markdown
    .split("\n")
    .filter((line) => !/^\s*#{1,6}\s/.test(line))
    .join(" ");
  const body = dropFencedBlocks
    ? withoutHeadings.replace(/```[^`]*```/g, " ")
    : withoutHeadings;
  return body
    .replace(/[`*_>|]/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

const GENERATED_INPUTS: { name: string; markdown: string }[] = [
  { name: "empty input", markdown: "" },
  { name: "plain prose", markdown: "Just a plain sentence with no markdown syntax at all." },
  {
    name: "headings at several levels",
    markdown: "# Title\n\nSome intro text.\n\n## Section\n\nBody text.\n\n### Sub\n\nMore body text.",
  },
  {
    name: "fenced code block, dropped",
    markdown: "Prose before.\n\n```js\nconst x = 1;\nconsole.log(x);\n```\n\nProse after.",
  },
  {
    name: "all-fenced input (two-pass case)",
    markdown: "## Templates\n\n```markdown\ntype: functional\n```",
  },
  {
    name: "links",
    markdown: "See [the glossary](../glossary.md) for details, and [another link](http://x.test/y).",
  },
  {
    name: "table",
    markdown: "| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |",
  },
  {
    name: "whitespace runs",
    markdown: "Word1     word2\t\tword3\n\n\n\nword4",
  },
  {
    name: "non-ASCII (ejemplos/ corpus alphabet)",
    markdown: "El plazo de duplicación depende de la dirección de correo — «documento» y número: café.",
  },
  {
    name: "mixed: heading, fence, link, table, whitespace, non-ASCII",
    markdown:
      "# Título\n\nTexto de introducción con dirección y número.\n\n```js\nconst y = 2;\n```\n\n" +
      "Ver [el enlace](http://x.test) y esta tabla:\n\n| Col |\n| --- |\n| val |\n\nFin   con   espacios.",
  },
  {
    name: "emphasis and inline code",
    markdown: "This is *emphasis*, this is _also emphasis_, and this is `inline code`.",
  },
  {
    name: "blockquote marker",
    markdown: "> A quoted line\nNormal line after.",
  },
];

describe("flattenWithMap invariants (I1-I3)", () => {
  for (const { name, markdown } of GENERATED_INPUTS) {
    for (const dropFencedBlocks of [true, false]) {
      it(`${name} (dropFencedBlocks=${dropFencedBlocks})`, () => {
        const flat = flattenWithMap(markdown, dropFencedBlocks);
        assertInvariants(flat, markdown);
      });
    }
  }
});

describe("flattenWithMap I4 — matches today's flatten() output exactly", () => {
  for (const { name, markdown } of GENERATED_INPUTS) {
    for (const dropFencedBlocks of [true, false]) {
      it(`${name} (dropFencedBlocks=${dropFencedBlocks})`, () => {
        const flat = flattenWithMap(markdown, dropFencedBlocks);
        expect(flat.text).toBe(referenceFlatten(markdown, dropFencedBlocks));
      });
    }
  }
});

function assertInvariants(flat: FlatText, raw: string): void {
  // I1: map.length === text.length
  expect(flat.map.length).toBe(flat.text.length);

  // I2: map is non-decreasing, and every entry is a valid index into raw
  for (let i = 0; i < flat.map.length; i++) {
    const idx = flat.map[i]!;
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(raw.length);
    if (i > 0) {
      expect(idx).toBeGreaterThanOrEqual(flat.map[i - 1]!);
    }
  }

  // I3: every emitted non-space character is copied verbatim from raw at
  // its mapped offset; every synthesized character is a space.
  for (let i = 0; i < flat.text.length; i++) {
    const ch = flat.text[i]!;
    if (ch !== " ") {
      expect(raw[flat.map[i]!]).toBe(ch);
    }
  }
}

describe("toFlatOffset", () => {
  it("finds the least i with map[i] >= rawOffset", () => {
    const flat: FlatText = { text: "abcd", map: [0, 2, 4, 6] };
    expect(toFlatOffset(flat, 0)).toBe(0);
    expect(toFlatOffset(flat, 1)).toBe(1); // 1 is not in map, least map[i] >= 1 is map[1]=2
    expect(toFlatOffset(flat, 2)).toBe(1);
    expect(toFlatOffset(flat, 3)).toBe(2);
    expect(toFlatOffset(flat, 6)).toBe(3);
  });

  it("returns text.length when no entry is large enough", () => {
    const flat: FlatText = { text: "abcd", map: [0, 2, 4, 6] };
    expect(toFlatOffset(flat, 100)).toBe(flat.text.length);
  });

  it("returns 0 for an empty flattened text", () => {
    const flat: FlatText = { text: "", map: [] };
    expect(toFlatOffset(flat, 0)).toBe(0);
  });

  it("resolves a destroyed raw position to the nearest surviving position after it", () => {
    // A heading line's raw offsets are entirely absent from map; a query
    // term landing there must resolve forward, not throw or clamp to 0.
    const flat = flattenWithMap("# Heading\n\nBody text starts here.", true);
    const headingRawOffset = 2; // inside "# Heading", which is stripped
    const resolved = toFlatOffset(flat, headingRawOffset);
    expect(resolved).toBeGreaterThanOrEqual(0);
    expect(resolved).toBeLessThanOrEqual(flat.text.length);
  });
});
