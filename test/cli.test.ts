import { describe, expect, it, vi } from "vitest";
import { parseTipo } from "../src/cli.js";

/**
 * Smoke-level contract test for the CLI's `--tipo` open-string passthrough.
 * `parseTipo` used to validate against the closed `TIPOS` list and call
 * `process.exit(2)` on a mismatch; it is now a plain passthrough (tipo is a
 * project-defined, config-driven, open string — no closed list to validate
 * against at the CLI layer per the hexagonal boundary).
 */
describe("parseTipo", () => {
  it("passes through a value outside any closed taxonomy unchanged", () => {
    expect(parseTipo("playbook")).toBe("playbook");
  });

  it("passes through a recognized-looking value unchanged too", () => {
    expect(parseTipo("guia")).toBe("guia");
  });

  it("never calls process.exit for an unrecognized value", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit must not be called for an unrecognized tipo");
    });
    try {
      expect(() => parseTipo("notarealtype")).not.toThrow();
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("trims surrounding whitespace", () => {
    expect(parseTipo("  guia  ")).toBe("guia");
  });
});
