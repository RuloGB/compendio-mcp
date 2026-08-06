import { isUtf8 } from "node:buffer";

/** The three encodings this decoder recognizes; nothing else is guessed. */
export type DecodedEncoding = "utf-8" | "windows-1252" | "utf-16le" | "utf-16be";

export type DecodeResult =
  | { ok: true; content: string; encoding: DecodedEncoding }
  | { ok: false; reason: string };

/**
 * CP1252's `0x80-0x9F` block. Transcribed from
 * https://www.unicode.org/Public/MAPPINGS/VENDORS/MICSFT/WINDOWS/CP1252.TXT
 * and cross-checked against
 * https://encoding.spec.whatwg.org/index-windows-1252.txt (both authorities
 * agree on all 27 entries below).
 *
 * Exactly 27 entries, not 32: `0x81`, `0x8D`, `0x8F`, `0x90`, `0x9D` have no
 * CP1252 character. The two authorities disagree on those five (Unicode
 * marks them UNDEFINED; WHATWG maps them to the same-numbered C1 control,
 * i.e. plain latin1 identity) -- this decoder deliberately takes the
 * Unicode reading (see design.md Decision 2): they are decode failures, not
 * silently-identity-mapped control characters. Absence from this map is
 * what marks a byte as unassigned; there is no second list to keep in sync.
 */
const CP1252_OVERRIDES = new Map<number, number>([
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
]);

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/** Built via `fromCharCode`, not a literal character in source, so the
 * byte-order mark can never be silently mangled by an editor or a re-save --
 * the exact class of bug this file exists to stop. */
const BOM_CHAR = String.fromCharCode(0xfeff);

/**
 * Decodes raw file bytes on evidence rather than an assumption. Detection
 * order (design.md's "Decode flow"): a UTF-16 byte-order mark, then valid
 * UTF-8, then a plausible-CP1252 fallback gated by a deterministic reject
 * byte-set -- never a statistical guess. `TextDecoder` is never used: it is
 * measurably wrong for `windows-1252` on this project's Node floor (decodes
 * byte-for-byte identically to latin1 -- see design.md's repro command). A
 * leading `U+FEFF` is stripped from the result regardless of encoding.
 */
export function decodeText(bytes: Buffer): DecodeResult {
  const bom = detectUtf16Bom(bytes);
  if (bom !== null) {
    if (bytes.length % 2 !== 0) {
      return {
        ok: false,
        reason:
          `unrecognized encoding: ${bom} byte-order mark detected but the buffer has an odd ` +
          `length (${bytes.length} bytes), which cannot pair into UTF-16 code units`,
      };
    }
    const content = bom === "utf-16le" ? bytes.toString("utf16le") : Buffer.from(bytes).swap16().toString("utf16le");
    return { ok: true, content: stripBom(content), encoding: bom };
  }

  if (isUtf8(bytes)) {
    return { ok: true, content: stripBom(bytes.toString("utf8")), encoding: "utf-8" };
  }

  if (bytes.subarray(0, 3).equals(UTF8_BOM)) {
    return { ok: false, reason: "unrecognized encoding: declares a UTF-8 BOM but is not valid UTF-8" };
  }

  const rejection = findRejectedByte(bytes);
  if (rejection !== null) {
    return {
      ok: false,
      reason:
        `unrecognized encoding: not valid UTF-8, and byte ${formatByte(rejection.byte)} ` +
        `at offset ${rejection.offset} rules out windows-1252`,
    };
  }

  return { ok: true, content: stripBom(decodeCp1252(bytes)), encoding: "windows-1252" };
}

function detectUtf16Bom(bytes: Buffer): "utf-16le" | "utf-16be" | null {
  if (bytes.length < 2) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  return null;
}

/** Bytes that can never appear in plausible CP1252 text (design.md Decision
 * 3): C0 controls other than TAB/LF/FF/CR, DEL, and the 5 unassigned C1
 * bytes. Scans the whole buffer, not a prefix -- the file already failed
 * `isUtf8`, so this pass is paid only by non-UTF-8 files. */
function findRejectedByte(bytes: Buffer): { byte: number; offset: number } | null {
  for (let offset = 0; offset < bytes.length; offset++) {
    const byte = bytes[offset]!;
    if (isRejectedCp1252Byte(byte)) return { byte, offset };
  }
  return null;
}

function isRejectedCp1252Byte(byte: number): boolean {
  if (byte === 0x09 || byte === 0x0a || byte === 0x0c || byte === 0x0d) return false; // TAB, LF, FF, CR
  if (byte <= 0x1f) return true; // remaining C0 controls
  if (byte === 0x7f) return true; // DEL
  if (byte >= 0x80 && byte <= 0x9f && !CP1252_OVERRIDES.has(byte)) return true; // unassigned C1
  return false;
}

/** Identity outside `0x80-0x9F` (same as latin1), with the 27 overrides
 * applied inside that block. `bytes.toString("latin1")` already produces a
 * one-code-unit-per-byte string, so the override pass is a simple lookup. */
function decodeCp1252(bytes: Buffer): string {
  const identity = bytes.toString("latin1");
  let out = "";
  for (let i = 0; i < identity.length; i++) {
    const code = identity.charCodeAt(i);
    const override = CP1252_OVERRIDES.get(code);
    out += override !== undefined ? String.fromCharCode(override) : identity[i];
  }
  return out;
}

function stripBom(content: string): string {
  return content.startsWith(BOM_CHAR) ? content.slice(1) : content;
}

function formatByte(byte: number): string {
  return `0x${byte.toString(16).toUpperCase().padStart(2, "0")}`;
}
