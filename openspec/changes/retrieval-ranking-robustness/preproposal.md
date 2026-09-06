{
  "schema": "gentle-ai.sdd-preproposal/v1",
  "revision": 2,
  "change": "retrieval-ranking-robustness",
  "artifact_store": "openspec",
  "exploration": {
    "outcome": "done",
    "reference": "C:/Users/Raul/Workspace/compendio-mcp/openspec/changes/retrieval-ranking-robustness/exploration.md"
  },
  "research": {
    "selected": true,
    "request": {
      "change": "retrieval-ranking-robustness",
      "classes": [
        "documentation",
        "open-web"
      ],
      "questions": [
        "Q1: Evaluate answer-bearing chunk retrieval and reformulation robustness with overlapping acceptable chunks, intent groups, leakage-resistant splits, separate document/chunk metrics and a minimal reviewed goldenset.",
        "Q2: Establish primary evidence for RRF constant/weights, score-aware fusion and candidate-depth sensitivity; distinguish score compression from relevance failure.",
        "Q3: Propose controlled stage ablations faithful to production and resistant to overfitting a staged question.",
        "Q4: Compare rank-only tuning, score normalization, reranking and query expansion for entirely local CPU use without adopting a library or assuming performance."
      ]
    },
    "requested_classes": [
      "documentation",
      "open-web"
    ],
    "admission": {
      "outcome": "admitted",
      "declaration_origin": "Explicit host/orchestrator supplied, not CLI-generated",
      "capability": {
        "schema": "gentle-ai.sdd-research-capability/v1",
        "runtime": "codex",
        "grants": {
          "documentation": {
            "granted": true,
            "tool": "functions.exec/tools.web__run",
            "operations": [
              "search_query",
              "open",
              "find",
              "click"
            ]
          },
          "open-web": {
            "granted": true,
            "tool": "functions.exec/tools.web__run",
            "operations": [
              "search_query",
              "open",
              "find",
              "click"
            ]
          }
        },
        "constraints": [
          "Read-only public-source research",
          "Primary technical sources only",
          "Never transmit private corpus text, private paths, repository names or code in searches",
          "No remote publication"
        ]
      },
      "observed_exact_grants": {
        "documentation": {
          "granted": true,
          "tool": "functions.exec/tools.web__run",
          "operations": [
            "search_query",
            "open",
            "find",
            "click"
          ]
        },
        "open-web": {
          "granted": true,
          "tool": "functions.exec/tools.web__run",
          "operations": [
            "search_query",
            "open",
            "find",
            "click"
          ]
        }
      },
      "observation": "The named tools.web__run function was callable; public search_query/open/find calls returned source content. No undeclared capability was inferred. Request, declaration and canonical desired content intent were retained before source access.",
      "privacy": "Public method names only in searches. No private corpus text, code, repository name or local paths transmitted."
    },
    "outcome": "done",
    "evidence_valid": true,
    "evidence_references": {
      "openspec": "C:/Users/Raul/Workspace/compendio-mcp/openspec/changes/retrieval-ranking-robustness/research.md",
      "engram": null
    },
    "evidence_revision": 1
  },
  "product_decisions": {
    "status": "confirmed",
    "authoritative": true,
    "pending": [],
    "confirmed": [
      "Store goldenset and measurement results in a local Git-ignored directory inside Compendio; exact directory is a design detail.",
      "Initial goldenset: 20 distinct intents with 3 reformulations each (60 queries), including the refund case and other corpus topics.",
      "User permits creating necessary documents in the external test project previously identified as DocuTests2; verify canonical path and obtain filesystem permission before any external write. Keep synthetic diagnostics separate from the fixed baseline.",
      "Primary metric: any valid answer in top 5; report average success and intents for which all three reformulations succeed.",
      "Measurement-only stage: no ranking improvement required and no fusion algorithm changes. Preserve returned fragments and ordering for identical inputs.",
      "Measure time and memory descriptively; no performance thresholds imposed at this stage.",
      "Interactive SDD: user selects each phase model; local only, no commit/push/PR."
    ]
  },
  "store_readiness": {
    "mode": "openspec",
    "requires": "Successful write and readback of both schema artifacts; research claims map to present source IDs.",
    "engram_required": false
  },
  "proposal_ready": true,
  "blocking_reasons": [],
  "next_action": "Create proposal using user-selected gpt-5.6-sol/medium, then stop for interactive approval."
}
