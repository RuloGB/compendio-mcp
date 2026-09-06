/**
 * Builds a candidate goldenset for `scripts/retrieval-baseline.mjs` from an
 * authored intent table, resolving each intent's evidence quote to the stored
 * chunk that contains it.
 *
 * METHODOLOGY — the reason this script exists rather than a search-driven one:
 * every label here is derived from the DOCUMENTS ALONE. This script never runs
 * a search, never imports `SearchDocuments`, and never looks at a ranking. If
 * labels were derived from what the system retrieves, the measurement could no
 * longer fail — a miss would be relabelled into a hit by construction. Fixing
 * the labels before observing any ranking is what keeps the benchmark
 * falsifiable.
 *
 * The output is a CANDIDATE, not evidence. Every label carries
 * `reviewer: "UNREVIEWED"` until a human reads the quote against the document
 * and replaces it. Nothing in `src/domain/retrieval-evaluation.ts` gates on the
 * reviewer field, so that string is the only thing standing between a draft and
 * a number someone quotes — leave it loud.
 *
 * Usage (no build required — reads the index directly, like a probe script):
 *
 *   node scripts/build-goldenset.mjs <corpus-root> <output.json>
 *
 * Exits non-zero when any intent's quote does not resolve to exactly one chunk
 * in exactly one document: an unresolvable or ambiguous quote is an authoring
 * error to fix, never something to emit and let the runner discover.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * Authored intents. Each resolves to ONE document — `validateLabel` rejects a
 * label whose accepted chunks span more than one document as
 * `ambiguous-evidence`, so a fact stated in two documents must name its owner
 * here rather than list both as alternatives.
 *
 * `quote` is matched against chunk content with whitespace collapsed, so a
 * quote may be written across lines exactly as it appears in the source.
 */
const INTENTS = [
  {
    id: "auth-hold-duration",
    group: "payments-capture",
    doc: "demo-docs/reference/billing-rules.md",
    quote: "An authorization holds for seven days on card networks and expires silently after that.",
    rationale: "Section 5 states the hold duration outright; no other document gives a number for it.",
    queries: [
      "how long does an authorization hold last before it expires",
      "when does a card authorization expire if we never capture it",
      "what is the authorization validity period on card networks",
    ],
  },
  {
    id: "auto-capture-threshold",
    group: "payments-capture",
    doc: "demo-docs/reference/billing-rules.md",
    quote: "The default threshold is 250,000 minor units; merchants may raise or lower it.",
    rationale: "Section 5 names the default threshold and its adjustability.",
    queries: [
      "what is the default auto-capture threshold",
      "above what amount is an invoice left for manual capture",
      "default limit before a capture needs manual approval",
    ],
  },
  {
    id: "invoice-rounding-policy",
    group: "billing-amounts",
    doc: "demo-docs/reference/billing-rules.md",
    quote:
      "Rounding happens exactly once per invoice, at the invoice total, using banker's rounding (round-half-to-even).",
    rationale:
      "Section 3 owns the rule. ADR-0004 restates it as a consequence of the integer-money decision; the reference is the owner, so alternatives are not listed across both.",
    queries: [
      "how is rounding applied to an invoice total",
      "do you round each line item or only the invoice total",
      "which rounding mode is used for invoice amounts",
    ],
  },
  {
    id: "tax-rate-effective-date",
    group: "billing-tax",
    doc: "demo-docs/reference/billing-rules.md",
    quote:
      "Tax is computed at finalization against the tax rates in force on the finalization date, not the rates in force on the due date or the payment date.",
    rationale: "Section 4's first sentence answers which date governs the rate.",
    queries: [
      "which tax rates apply to an invoice",
      "if the tax rate changes after finalization does the invoice change",
      "what date determines the tax rate on an invoice",
    ],
  },
  {
    id: "expired-exemption-certificate",
    group: "billing-tax",
    doc: "demo-docs/reference/billing-rules.md",
    quote: "An expired certificate is treated as no certificate: tax is applied.",
    rationale: "Section 4 states the expiry consequence directly.",
    queries: [
      "what happens if a tax exemption certificate has expired",
      "does an expired exemption still exempt the customer from tax",
      "customer exemption certificate lapsed, do we still charge tax",
    ],
  },
  {
    id: "vies-unreachable",
    group: "billing-tax",
    doc: "demo-docs/reference/billing-rules.md",
    quote:
      "When VIES is unreachable at finalization, Meridian applies tax rather than assuming exemption.",
    rationale: "Section 4 names the fallback when VAT validation is unavailable.",
    queries: [
      "what happens when VIES cannot be reached during finalization",
      "reverse charge when the VAT validation service is down",
      "is tax applied if we cannot validate the VAT number",
    ],
  },
  {
    id: "finalize-without-address",
    group: "billing-invoice-lifecycle",
    doc: "demo-docs/use-cases/uc-create-invoice.md",
    quote:
      "Finalization is refused with `tax_jurisdiction_unknown`. The invoice stays a draft.",
    rationale:
      "UC-01's alternate flow A1 is the only place the error code is named; billing-rules states the policy but not the code.",
    queries: [
      "what happens if the customer has no billing or shipping address",
      "error when an invoice has no address to resolve the tax jurisdiction",
      "can you finalize an invoice without any address on the customer",
    ],
  },
  {
    id: "partial-payment-invoice-state",
    group: "billing-invoice-lifecycle",
    doc: "demo-docs/reference/billing-rules.md",
    quote:
      "An invoice with an outstanding balance of even one minor unit remains **open** until the balance reaches zero.",
    rationale: "Section 2 answers whether partial payment moves an invoice to paid.",
    queries: [
      "does a partial payment mark the invoice as paid",
      "what state is an invoice in when only part of the balance is paid",
      "when does an invoice move to paid",
    ],
  },
  {
    id: "settled-amount-authoritative",
    group: "settlement",
    doc: "demo-docs/reference/billing-rules.md",
    quote:
      "Meridian records the settled amount as authoritative and books the difference to a reconciliation account.",
    rationale:
      "Section 6's 'cleared for a different amount' outcome names which amount wins and where the difference is booked.",
    queries: [
      "which amount wins when settlement differs from the requested capture",
      "the acquirer settled a different amount than we asked for",
      "where does the difference go when a capture clears for another amount",
    ],
  },
  {
    id: "idempotency-key-retention",
    group: "api-idempotency",
    doc: "demo-docs/decisions/0003-idempotency-keys.md",
    quote: "Keys are retained for twenty-four hours from first use",
    rationale:
      "ADR-0003 is the deciding document for key retention; handling-failures repeats the figure as integration advice.",
    queries: [
      "how long are idempotency keys kept",
      "what is the retention window for an idempotency key",
      "after how long is an idempotency key forgotten",
    ],
  },
  {
    id: "idempotency-key-reuse",
    group: "api-idempotency",
    doc: "demo-docs/decisions/0003-idempotency-keys.md",
    quote:
      "A key replayed with a different body is rejected with `idempotency_key_reuse` rather than being processed",
    rationale:
      "ADR-0003's decision section states the rejection and its reasoning; api-errors lists the code without the rationale.",
    queries: [
      "what happens if the same idempotency key is sent with a different body",
      "error for reusing an idempotency key on a different request",
      "idempotency key sent twice with a changed payload",
    ],
  },
  {
    id: "rate-limit-money-moving",
    group: "api-rate-limits",
    doc: "demo-docs/reference/rate-limits.md",
    quote: "Money-moving (captures, refunds) | 10 req/s | 20",
    rationale: "The limits table gives the sustained and burst figures for money-moving endpoints.",
    queries: [
      "what is the rate limit for captures and refunds",
      "how many money-moving requests per second are allowed",
      "throughput ceiling on the capture endpoint",
    ],
  },
  {
    id: "rate-limit-scope",
    group: "api-rate-limits",
    doc: "demo-docs/reference/rate-limits.md",
    quote: "Limits are per API key, not per merchant and not per IP.",
    rationale: "The document's opening sentence defines the scope of a budget.",
    queries: [
      "are rate limits per merchant or per API key",
      "does each API key get its own rate limit budget",
      "what is a rate limit scoped to",
    ],
  },
  {
    id: "deduplicated-request-consumes-token",
    group: "api-rate-limits",
    doc: "demo-docs/reference/rate-limits.md",
    quote: "A request rejected as a duplicate by the idempotency layer still consumes a token.",
    rationale:
      "The 'deduplicated requests' section answers whether a replay costs budget; the ordering of limiter and dedup store is the reason.",
    queries: [
      "does a deduplicated request still count against the rate limit",
      "do replayed idempotent requests consume rate limit budget",
      "how are duplicate requests rate limited",
    ],
  },
  {
    id: "webhook-retry-schedule",
    group: "webhooks-delivery",
    doc: "demo-docs/reference/webhooks.md",
    quote:
      "Failed deliveries retry with exponential backoff over twenty-four hours: after 5 seconds, 30 seconds, 2 minutes, 10 minutes, 1 hour, 6 hours, and 24 hours.",
    rationale: "The retries section enumerates the full schedule.",
    queries: [
      "what is the webhook retry schedule",
      "how many times is a failed webhook delivery retried and when",
      "webhook delivery backoff intervals",
    ],
  },
  {
    id: "webhook-endpoint-auto-disable",
    group: "webhooks-delivery",
    doc: "demo-docs/reference/webhooks.md",
    quote:
      "An endpoint failing every delivery for seventy-two hours is disabled automatically and the account owner is emailed.",
    rationale: "The retries section states the auto-disable threshold and its notification.",
    queries: [
      "when is a webhook endpoint disabled automatically",
      "how long can an endpoint keep failing before it is turned off",
      "automatic deactivation of a broken webhook endpoint",
    ],
  },
  {
    id: "webhook-signature-verification",
    group: "webhooks-security",
    doc: "demo-docs/reference/webhooks.md",
    quote: "Compute HMAC-SHA256 with your signing secret and compare in constant time.",
    rationale: "The signature section names the algorithm and the comparison requirement.",
    queries: [
      "how do I verify a webhook signature",
      "what algorithm signs webhook deliveries",
      "validating the Meridian-Signature header",
    ],
  },
  {
    id: "event-cursor-retention",
    group: "events-polling",
    doc: "demo-docs/decisions/0002-polling-over-webhooks.md",
    quote:
      "Events are strictly ordered by cursor, never duplicated, and retained for thirty days.",
    rationale:
      "ADR-0002 is the deciding document for the events cursor's properties, retention included.",
    queries: [
      "how long are events retained on the events endpoint",
      "what is the event cursor retention period",
      "how far back can I resume from a stored cursor",
    ],
  },
  {
    id: "client-retry-backoff",
    group: "integration-resilience",
    doc: "demo-docs/guides/handling-failures.md",
    quote:
      "Use exponential backoff with full jitter, starting at 200ms, doubling, capped at 30 seconds, with a total of five attempts.",
    rationale: "The retry policy section gives the complete recommended backoff.",
    queries: [
      "what retry backoff should my client use",
      "recommended retry policy for failed requests",
      "how many attempts before giving up on a request",
    ],
  },
  {
    id: "refund-does-not-reopen-invoice",
    group: "refunds",
    doc: "demo-docs/use-cases/uc-refund-invoice.md",
    quote: "The invoice remains **paid**. Refunding never returns an invoice to **open**.",
    rationale: "UC-07's postconditions answer the invoice's state after a refund.",
    queries: [
      "does refunding an invoice reopen it",
      "what state is an invoice in after a refund",
      "what happens to a paid invoice when money is refunded",
    ],
  },
];

const collapse = (s) => s.replace(/\s+/g, " ").trim();
const sha256 = (s) => createHash("sha256").update(Buffer.from(s)).digest("hex");

function main() {
  const [, , rootArg, outputArg] = process.argv;
  if (rootArg === undefined || outputArg === undefined) {
    console.error("usage: node scripts/build-goldenset.mjs <corpus-root> <output.json>");
    process.exit(2);
  }

  const root = resolve(rootArg);
  const dbPath = join(root, ".compendio", "compendio.db");
  const Database = require("better-sqlite3");
  const db = new Database(dbPath, { readonly: true });

  const chunkRows = db
    .prepare(
      "SELECT d.path AS path, c.heading AS heading, c.position AS position, c.content AS content " +
        "FROM chunks c JOIN documents d ON d.id = c.document_id",
    )
    .all();

  const byDoc = new Map();
  for (const row of chunkRows) {
    if (!byDoc.has(row.path)) byDoc.set(row.path, []);
    byDoc.get(row.path).push(row);
  }

  const problems = [];
  const labels = [];
  const queries = [];
  const resolved = [];

  for (const intent of INTENTS) {
    if (intent.queries.length !== 3) {
      problems.push(`${intent.id}: expected 3 reformulations, found ${intent.queries.length}`);
      continue;
    }
    const docChunks = byDoc.get(intent.doc);
    if (docChunks === undefined) {
      problems.push(`${intent.id}: document not indexed: ${intent.doc}`);
      continue;
    }
    const needle = collapse(intent.quote);
    const matches = docChunks.filter((c) => collapse(c.content).includes(needle));
    if (matches.length === 0) {
      problems.push(`${intent.id}: quote found in no chunk of ${intent.doc}`);
      continue;
    }
    if (matches.length > 1) {
      problems.push(
        `${intent.id}: quote found in ${matches.length} chunks of ${intent.doc} ` +
          `(positions ${matches.map((m) => m.position).join(", ")}) — not uniquely addressable`,
      );
      continue;
    }

    // Anti-vacuity check on the corpus, not just the document: a quote that
    // also appears verbatim in a filler document would make "did the right
    // chunk come back" undecidable at evaluation time.
    const elsewhere = chunkRows.filter(
      (c) => c.path !== intent.doc && collapse(c.content).includes(needle),
    );
    if (elsewhere.length > 0) {
      problems.push(
        `${intent.id}: quote also appears in ${elsewhere.length} chunk(s) outside ${intent.doc} ` +
          `(${[...new Set(elsewhere.map((e) => e.path))].join(", ")})`,
      );
      continue;
    }

    const chunk = matches[0];
    const fingerprint = {
      path: chunk.path,
      heading: chunk.heading,
      position: chunk.position,
      contentHash: sha256(chunk.content),
    };
    resolved.push({ intent, chunk });

    for (let variantId = 1; variantId <= 3; variantId++) {
      const query = intent.queries[variantId - 1];
      queries.push({ intentId: intent.id, variantId, query });
      labels.push({
        intentId: intent.id,
        variantId,
        group: intent.group,
        reviewedDocumentPath: intent.doc,
        reviewedDocumentHash: sha256(docChunks.map((c) => c.content).join("\n")),
        evidenceQuotes: [{ text: intent.quote, occurrence: 0 }],
        acceptedChunkFingerprints: [fingerprint],
        reviewer: "UNREVIEWED",
        rationale: intent.rationale,
      });
    }
  }

  db.close();

  if (problems.length > 0) {
    console.error("REFUSING TO EMIT — unresolved or ambiguous evidence:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  const goldenset = {
    schemaVersion: 1,
    corpusRoot: root,
    generatedAt: new Date().toISOString(),
    reviewStatus: "UNREVIEWED — machine-proposed candidate, not evidence",
    intentCount: INTENTS.length,
    queries,
    labels,
  };

  const outputPath = resolve(outputArg);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(goldenset, null, 2));

  const perDoc = new Map();
  for (const { intent } of resolved) perDoc.set(intent.doc, (perDoc.get(intent.doc) ?? 0) + 1);

  console.log(`wrote ${outputPath}`);
  console.log(`  intents: ${INTENTS.length}  queries: ${queries.length}  labels: ${labels.length}`);
  console.log(`  intent groups: ${new Set(INTENTS.map((i) => i.group)).size}`);
  console.log("  intents per document:");
  for (const [doc, n] of [...perDoc].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(2)}  ${doc}`);
  }
}

main();
