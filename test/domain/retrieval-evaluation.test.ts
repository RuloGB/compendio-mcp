import { describe, expect, it } from "vitest";
import {
  compareResults,
  runFalsifiabilityGates,
  summarizeAnswerMetrics,
  summarizeDocumentMetrics,
  validateLabel,
  type ChunkFingerprint,
  type QueryOutcome,
  type ReviewedLabel,
} from "../../src/domain/retrieval-evaluation";

function fingerprint(path: string, heading: string, position: number, contentHash: string): ChunkFingerprint {
  return { path, heading, position, contentHash };
}

function label(overrides: Partial<ReviewedLabel> = {}): ReviewedLabel {
  return {
    intentId: "refund-policy",
    variantId: 1,
    group: "refund-policy",
    reviewedDocumentPath: "docs/refund.md",
    reviewedDocumentHash: "docHash1",
    evidenceQuotes: [{ text: "refunds are processed within 14 days", occurrence: 0 }],
    acceptedChunkFingerprints: [fingerprint("docs/refund.md", "Refund window", 0, "chunkHashA")],
    reviewer: "someone",
    rationale: "explicit statement of the refund window",
    ...overrides,
  };
}

function outcome(overrides: Partial<QueryOutcome> = {}): QueryOutcome {
  return {
    intentId: "refund-policy",
    variantId: 1,
    group: "refund-policy",
    label: label(),
    emitted: [fingerprint("docs/refund.md", "Refund window", 0, "chunkHashA")],
    ...overrides,
  };
}

describe("validateLabel — reviewed evidence must resolve to sufficient chunks", () => {
  it("a label with no accepted chunks is invalid: unresolvable evidence", () => {
    const result = validateLabel(label({ acceptedChunkFingerprints: [] }));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("no-accepted-chunks");
  });

  it("a label with no evidence quotes is invalid", () => {
    const result = validateLabel(label({ evidenceQuotes: [] }));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("no-evidence-quotes");
  });

  it("accepted chunks split across two different documents is ambiguous evidence", () => {
    const result = validateLabel(
      label({
        acceptedChunkFingerprints: [
          fingerprint("docs/refund.md", "Refund window", 0, "chunkHashA"),
          fingerprint("docs/other.md", "Something else", 0, "chunkHashB"),
        ],
      }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("ambiguous-evidence");
  });

  it("two overlapping sufficient chunks in the SAME document are valid alternatives", () => {
    const result = validateLabel(
      label({
        acceptedChunkFingerprints: [
          fingerprint("docs/refund.md", "Refund window", 0, "chunkHashA"),
          fingerprint("docs/refund.md", "Refund exceptions", 1, "chunkHashB"),
        ],
      }),
    );
    expect(result.valid).toBe(true);
  });
});

describe("summarizeAnswerMetrics — alternative chunks, ties, missing ranks, empty denominator", () => {
  it("either alternative chunk emitted in the top five counts as an answer hit", () => {
    const alt = label({
      acceptedChunkFingerprints: [
        fingerprint("docs/refund.md", "Refund window", 0, "chunkHashA"),
        fingerprint("docs/refund.md", "Refund exceptions", 1, "chunkHashB"),
      ],
    });
    const result = summarizeAnswerMetrics([
      outcome({
        label: alt,
        // Only the SECOND alternative was actually emitted.
        emitted: [fingerprint("docs/refund.md", "Refund exceptions", 1, "chunkHashB")],
      }),
    ]);
    expect(result.hits).toBe(1);
    expect(result.hitRateAt5).toBe(1);
    expect(result.perQuery[0]!.answerHit).toBe(true);
  });

  it("a missing answer rank is represented as null, never fabricated", () => {
    const result = summarizeAnswerMetrics([
      outcome({ emitted: [fingerprint("docs/refund.md", "Unrelated", 2, "chunkHashZ")] }),
    ]);
    expect(result.perQuery[0]!.answerHit).toBe(false);
    expect(result.perQuery[0]!.firstAnswerRank).toBeNull();
  });

  it("ties: when multiple accepted fingerprints are emitted, first-answer rank is the EARLIEST rank", () => {
    const alt = label({
      acceptedChunkFingerprints: [
        fingerprint("docs/refund.md", "Refund window", 0, "chunkHashA"),
        fingerprint("docs/refund.md", "Refund exceptions", 1, "chunkHashB"),
      ],
    });
    const result = summarizeAnswerMetrics([
      outcome({
        label: alt,
        emitted: [
          fingerprint("docs/other.md", "Noise", 9, "noiseHash"), // rank 1
          fingerprint("docs/refund.md", "Refund exceptions", 1, "chunkHashB"), // rank 2 — first match
          fingerprint("docs/refund.md", "Refund window", 0, "chunkHashA"), // rank 3 — also matches
        ],
      }),
    ]);
    expect(result.perQuery[0]!.firstAnswerRank).toBe(2);
  });

  it("empty denominator: zero outcomes report a zero rate, not NaN or a thrown error", () => {
    const result = summarizeAnswerMetrics([]);
    expect(result.totalQueries).toBe(0);
    expect(result.hits).toBe(0);
    expect(result.hitRateAt5).toBe(0);
    expect(result.allVariantSuccessRate).toBe(0);
  });

  it("an intent counts as all-variant success only when every one of its three reformulations hits", () => {
    const group = "billing-cycle";
    const makeVariant = (variantId: number, hit: boolean) =>
      outcome({
        intentId: "billing-cycle",
        variantId,
        group,
        label: label({ intentId: "billing-cycle", variantId, group }),
        emitted: hit
          ? [fingerprint("docs/refund.md", "Refund window", 0, "chunkHashA")]
          : [fingerprint("docs/other.md", "Noise", 9, "noiseHash")],
      });

    const allHit = summarizeAnswerMetrics([makeVariant(1, true), makeVariant(2, true), makeVariant(3, true)]);
    expect(allHit.allVariantSuccessGroups).toBe(1);
    expect(allHit.allVariantSuccessRate).toBe(1);

    const oneMiss = summarizeAnswerMetrics([makeVariant(1, true), makeVariant(2, false), makeVariant(3, true)]);
    expect(oneMiss.allVariantSuccessGroups).toBe(0);
    expect(oneMiss.allVariantSuccessRate).toBe(0);
  });

  it("excludes queries with an invalid label from the hit-rate denominator", () => {
    const result = summarizeAnswerMetrics([
      outcome({ label: label({ acceptedChunkFingerprints: [] }) }),
      outcome({ intentId: "second", variantId: 1, group: "second" }),
    ]);
    expect(result.totalQueries).toBe(1);
    expect(result.hits).toBe(1);
    expect(result.hitRateAt5).toBe(1);
  });
});

describe("summarizeDocumentMetrics — separate from answer-bearing chunk metrics", () => {
  it("an expected document retrieved with no sufficient chunk counts as a document hit but NOT an answer hit", () => {
    const outcomes: QueryOutcome[] = [
      outcome({
        // The expected document IS emitted, but the specific accepted chunk is not.
        emitted: [fingerprint("docs/refund.md", "Unrelated section", 5, "chunkHashOther")],
      }),
    ];
    const answers = summarizeAnswerMetrics(outcomes);
    const documents = summarizeDocumentMetrics(outcomes);
    expect(answers.hits).toBe(0);
    expect(documents.hits).toBe(1);
    expect(documents.hitRateAt5).toBe(1);
  });

  it("zero outcomes report a zero rate", () => {
    const result = summarizeDocumentMetrics([]);
    expect(result.totalQueries).toBe(0);
    expect(result.hitRateAt5).toBe(0);
  });
});

describe("runFalsifiabilityGates — vacuous measurement, invalid labels, known-bad relevance, passing control", () => {
  it("fails as a vacuity failure when no evaluated query has resolvable answer evidence", () => {
    const result = runFalsifiabilityGates([
      outcome({ label: label({ acceptedChunkFingerprints: [] }) }),
      outcome({
        intentId: "second",
        variantId: 1,
        group: "second",
        label: label({ intentId: "second", variantId: 1, group: "second", acceptedChunkFingerprints: [] }),
      }),
    ]);
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.kind === "vacuous")).toBe(true);
  });

  it("fails with an invalid-label reason for a specific unresolvable label, without being vacuous when others are fine", () => {
    const result = runFalsifiabilityGates([
      outcome({ label: label({ acceptedChunkFingerprints: [] }) }),
      outcome({ intentId: "second", variantId: 1, group: "second" }),
    ]);
    expect(result.passed).toBe(false);
    const invalid = result.failures.find((f) => f.kind === "invalid-label");
    expect(invalid).toBeDefined();
    if (invalid?.kind === "invalid-label") {
      expect(invalid.intentId).toBe("refund-policy");
      expect(invalid.reason).toBe("no-accepted-chunks");
    }
    expect(result.failures.some((f) => f.kind === "vacuous")).toBe(false);
  });

  it("a known-bad relevance fixture — valid label, but the accepted chunk is never emitted — fails for the declared relevance reason", () => {
    const knownBad = outcome({
      intentId: "known-bad",
      variantId: 1,
      group: "known-bad",
      label: label({ intentId: "known-bad", variantId: 1, group: "known-bad" }),
      emitted: [fingerprint("docs/wrong.md", "Wrong section", 0, "wrongHash")],
    });
    const passingControl = outcome({
      intentId: "control",
      variantId: 1,
      group: "control",
      label: label({ intentId: "control", variantId: 1, group: "control" }),
    });

    const result = runFalsifiabilityGates([knownBad, passingControl]);
    expect(result.passed).toBe(false);
    const relevanceFailure = result.failures.find(
      (f) => f.kind === "relevance-miss" && f.intentId === "known-bad",
    );
    expect(relevanceFailure).toBeDefined();
    expect(result.failures.some((f) => f.kind === "relevance-miss" && f.intentId === "control")).toBe(false);
  });

  it("passes with zero failures when every label is valid and every accepted chunk is emitted", () => {
    const result = runFalsifiabilityGates([outcome()]);
    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  });
});

describe("compareResults — identity drift beats output equality", () => {
  const baseIdentity = { corpusHash: "c1", configHash: "cfg1", modelHash: "m1", codeHash: "code1" };
  const emitted = [fingerprint("docs/refund.md", "Refund window", 0, "chunkHashA")];

  it("identical identities and identical fragments/order are equivalent", () => {
    const result = compareResults(
      { query: "q", identity: baseIdentity, emitted },
      { query: "q", identity: { ...baseIdentity }, emitted: [...emitted] },
    );
    expect(result.equivalent).toBe(true);
  });

  it("any differing identity marks the comparison non-equivalent, even with byte-identical output", () => {
    const result = compareResults(
      { query: "q", identity: baseIdentity, emitted },
      { query: "q", identity: { ...baseIdentity, modelHash: "m2" }, emitted: [...emitted] },
    );
    expect(result.equivalent).toBe(false);
    if (!result.equivalent) expect(result.reason).toBe("identity-drift");
  });

  it("identical identities but different fragment order is non-equivalent", () => {
    const other = [
      fingerprint("docs/other.md", "Other", 0, "otherHash"),
      fingerprint("docs/refund.md", "Refund window", 0, "chunkHashA"),
    ];
    const result = compareResults(
      { query: "q", identity: baseIdentity, emitted: [emitted[0]!, other[0]!] },
      { query: "q", identity: { ...baseIdentity }, emitted: [other[0]!, emitted[0]!] },
    );
    expect(result.equivalent).toBe(false);
    if (!result.equivalent) expect(result.reason).toBe("order-drift");
  });

  it("identical identities but a different fragment set is non-equivalent", () => {
    const result = compareResults(
      { query: "q", identity: baseIdentity, emitted },
      {
        query: "q",
        identity: { ...baseIdentity },
        emitted: [fingerprint("docs/refund.md", "Different heading", 3, "chunkHashDIFF")],
      },
    );
    expect(result.equivalent).toBe(false);
    if (!result.equivalent) expect(result.reason).toBe("fragment-drift");
  });
});
