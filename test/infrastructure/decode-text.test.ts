import { describe, expect, it } from "vitest";
import { decodeText } from "../../src/infrastructure/fs/decode-text";

/**
 * All 27 assigned CP1252 code points in 0x80-0x9F, transcribed independently
 * for this test (not copied from the implementation) and verified against
 * both authorities during design:
 * https://www.unicode.org/Public/MAPPINGS/VENDORS/MICSFT/WINDOWS/CP1252.TXT
 * https://encoding.spec.whatwg.org/index-windows-1252.txt
 * This is the table that must fail for `latin1` (which maps every byte to
 * its own numeric code point, e.g. 0x93 -> U+0093) and for
 * `TextDecoder('windows-1252')` (measured broken on this project's Node
 * floor: decodes byte-for-byte identically to latin1).
 */
const CP1252_ASSIGNED: Array<[byte: number, codePoint: number]> = [
  [0x80, 0x20ac],
  [0x82, 0x201a],
  [0x83, 0x0192],
  [0x84, 0x201e],
  [0x85, 0x2026],
  [0x86, 0x2020],
  [0x87, 0x2021],
  [0x88, 0x02c6],
  [0x89, 0x2030],
  [0x8a, 0x0160],
  [0x8b, 0x2039],
  [0x8c, 0x0152],
  [0x8e, 0x017d],
  [0x91, 0x2018],
  [0x92, 0x2019],
  [0x93, 0x201c],
  [0x94, 0x201d],
  [0x95, 0x2022],
  [0x96, 0x2013],
  [0x97, 0x2014],
  [0x98, 0x02dc],
  [0x99, 0x2122],
  [0x9a, 0x0161],
  [0x9b, 0x203a],
  [0x9c, 0x0153],
  [0x9e, 0x017e],
  [0x9f, 0x0178],
];

/** Absence from CP1252_ASSIGNED is what marks these five as unassigned. */
const CP1252_UNASSIGNED = [0x81, 0x8d, 0x8f, 0x90, 0x9d];

function hex(byte: number): string {
  return `0x${byte.toString(16).toUpperCase().padStart(2, "0")}`;
}

describe("decodeText — all 27 CP1252 overrides (design Decision 1)", () => {
  it.each(CP1252_ASSIGNED)(
    "byte %s decodes to its exact CP1252 code point, not its latin1 identity",
    (byte, codePoint) => {
      // ASCII context on both sides: proves the buffer is not accidentally
      // valid UTF-8 and that surrounding bytes are unaffected.
      const result = decodeText(Buffer.from([0x41, byte, 0x42]));

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.encoding).toBe("windows-1252");
      expect(result.content).toBe(`A${String.fromCodePoint(codePoint)}B`);
      // The defect this change exists to catch: a latin1/TextDecoder('windows-1252')
      // reading would have produced String.fromCharCode(byte) instead.
      expect(result.content).not.toBe(`A${String.fromCharCode(byte)}B`);
    },
  );
});

describe("decodeText — the 5 unassigned CP1252 bytes are decode failures (design Decision 2)", () => {
  it.each(CP1252_UNASSIGNED)(
    "byte %s has no CP1252 character and is reported by byte and offset",
    (byte) => {
      const result = decodeText(Buffer.from([0x41, byte, 0x42]));

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe(
        `unrecognized encoding: not valid UTF-8, and byte ${hex(byte)} at offset 1 rules out windows-1252`,
      );
    },
  );
});

describe("decodeText — C0 controls and DEL reject a CP1252 fallback (design Decision 3)", () => {
  const rejected = [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x0b, 0x0e, 0x0f, 0x10, 0x1f, 0x7f];

  it.each(rejected)("byte %s is rejected, never transcoded into mojibake", (byte) => {
    // 0x93 forces the buffer to fail isUtf8 so the CP1252 reject scan runs.
    const result = decodeText(Buffer.from([0x93, byte]));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain(hex(byte));
  });
});

describe("decodeText — TAB, LF, FF, CR do not reject a CP1252 fallback", () => {
  it.each([0x09, 0x0a, 0x0c, 0x0d])("byte %s is accepted inside plausible CP1252 text", (byte) => {
    // 0x93 forces the buffer to fail isUtf8 so the CP1252 path is exercised.
    const result = decodeText(Buffer.from([0x93, byte, 0x41]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.encoding).toBe("windows-1252");
    expect(result.content).toBe(`“${String.fromCharCode(byte)}A`);
  });
});

describe("decodeText — 0xA0-0xFF accented range, ASCII, empty buffer, UTF-8 passthrough", () => {
  it("decodes an accented CP1252 byte to its correct code point", () => {
    const result = decodeText(Buffer.from([0xf3])); // lone continuation-shaped byte, invalid UTF-8

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.encoding).toBe("windows-1252");
    expect(result.content).toBe("ó"); // ó
  });

  it("passes plain ASCII through as UTF-8", () => {
    const result = decodeText(Buffer.from("Hello World", "utf8"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.encoding).toBe("utf-8");
    expect(result.content).toBe("Hello World");
  });

  it("decodes an empty buffer as UTF-8 with empty content", () => {
    const result = decodeText(Buffer.alloc(0));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.encoding).toBe("utf-8");
    expect(result.content).toBe("");
  });

  it("decodes valid UTF-8 (accents and multi-byte characters) byte-identically to today", () => {
    const original = "café 日本語 \u{1F600}"; // accents, CJK, an emoji (surrogate pair)
    const result = decodeText(Buffer.from(original, "utf8"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.encoding).toBe("utf-8");
    expect(result.content).toBe(original);
    expect(result.content).toBe(Buffer.from(original, "utf8").toString("utf8"));
  });
});

describe("decodeText — BOM handling (design Decision 4 and Decision 5)", () => {
  it("consumes a UTF-8 BOM and decodes the remaining content", () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("hello", "utf8")]);
    const result = decodeText(bytes);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.encoding).toBe("utf-8");
    expect(result.content).toBe("hello");
  });

  it("decodes a UTF-16LE BOM'd buffer and strips the BOM", () => {
    // BOM (FF FE) + "hi" in UTF-16LE (low byte first).
    const bytes = Buffer.from([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]);
    const result = decodeText(bytes);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.encoding).toBe("utf-16le");
    expect(result.content).toBe("hi");
  });

  it("decodes a UTF-16BE BOM'd buffer via swap16 and strips the BOM", () => {
    // BOM (FE FF) + "hi" in UTF-16BE (high byte first).
    const bytes = Buffer.from([0xfe, 0xff, 0x00, 0x68, 0x00, 0x69]);
    const result = decodeText(bytes);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.encoding).toBe("utf-16be");
    expect(result.content).toBe("hi");
  });

  it("fails on an odd-length buffer carrying a UTF-16 BOM", () => {
    const bytes = Buffer.from([0xff, 0xfe, 0x68]); // 3 bytes: cannot pair into UTF-16 code units
    const result = decodeText(bytes);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("rejects a UTF-8 BOM followed by invalid UTF-8, naming the contradiction", () => {
    const bytes = Buffer.from([0xef, 0xbb, 0xbf, 0xff]);
    const result = decodeText(bytes);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unrecognized encoding: declares a UTF-8 BOM but is not valid UTF-8");
  });
});
