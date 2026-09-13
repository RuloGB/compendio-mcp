import { describe, expect, it } from "vitest";
import { estimateTokens, tokensForLength } from "../../src/domain/tokens";

// design.md revision 1, R5/File Changes: "the formula stays in one place" --
// tokensForLength(n) is the single source of the chars/4 estimate;
// estimateTokens delegates to it for s.length.

describe("tokensForLength", () => {
  it("[7.1] rounds up to the nearest whole token (chars/4)", () => {
    expect(tokensForLength(0)).toBe(0);
    expect(tokensForLength(4)).toBe(1);
    expect(tokensForLength(5)).toBe(2);
    expect(tokensForLength(24000)).toBe(6000);
    expect(tokensForLength(24001)).toBe(6001);
  });
});

describe("estimateTokens", () => {
  it("[7.1] delegates to tokensForLength for the string's own length", () => {
    expect(estimateTokens("")).toBe(tokensForLength(0));
    expect(estimateTokens("abcd")).toBe(tokensForLength(4));
    const s = "x".repeat(4001);
    expect(estimateTokens(s)).toBe(tokensForLength(s.length));
  });
});
