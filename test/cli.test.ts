import { describe, expect, it, vi } from "vitest";
import { parseType } from "../src/cli.js";

/**
 * Smoke-level contract test for the CLI's `--tipo` open-string passthrough.
 * `parseType` used to validate against the closed `TIPOS` list and call
 * `process.exit(2)` on a mismatch; it is now a plain passthrough (type is a
 * project-defined, config-driven, open string — no closed list to validate
 * against at the CLI layer per the hexagonal boundary).
 */
describe("parseType", () => {
  it("passes through a value outside any closed taxonomy unchanged", () => {
    expect(parseType("playbook")).toBe("playbook");
  });

  it("passes through a recognized-looking value unchanged too", () => {
    expect(parseType("guia")).toBe("guia");
  });

  it("never calls process.exit for an unrecognized value", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit must not be called for an unrecognized type");
    });
    try {
      expect(() => parseType("notarealtype")).not.toThrow();
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("trims surrounding whitespace", () => {
    expect(parseType("  guia  ")).toBe("guia");
  });
});
