/** Inverse of `src/infrastructure/fs/decode-text.ts`'s CP1252 override table,
 * test-only: encodes a string into the CP1252 bytes a document author's
 * editor would have written. Production code never encodes -- this exists
 * solely to build byte-exact fixtures without a committed binary file (the
 * temp-dir-at-test-time pattern the design deliberately prefers over a
 * `.gitattributes`-pinned fixture). */
const CP1252_ENCODE_OVERRIDES: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

export function cp1252Bytes(text: string): Buffer {
  const bytes: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    bytes.push(CP1252_ENCODE_OVERRIDES[code] ?? code);
  }
  return Buffer.from(bytes);
}
