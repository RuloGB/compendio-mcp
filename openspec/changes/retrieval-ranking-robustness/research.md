{
  "schema": "gentle-ai.sdd-research/v1",
  "revision": 1,
  "outcome": "done",
  "change": "retrieval-ranking-robustness",
  "created_at": "2026-09-06",
  "executive_summary": "Measure answer-bearing retrieval and reformulation robustness before selecting a ranking change. Primary evidence supports separate passage judgments, intent-grouped evaluation, explicit candidate depth, and controlled fusion comparisons; it does not establish an optimal algorithm or project success threshold.",
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
  "questions": [
    "Q1: Evaluate answer-bearing chunk retrieval and reformulation robustness with overlapping acceptable chunks, intent groups, leakage-resistant splits, separate document/chunk metrics and a minimal reviewed goldenset.",
    "Q2: Establish primary evidence for RRF constant/weights, score-aware fusion and candidate-depth sensitivity; distinguish score compression from relevance failure.",
    "Q3: Propose controlled stage ablations faithful to production and resistant to overfitting a staged question.",
    "Q4: Compare rank-only tuning, score normalization, reranking and query expansion for entirely local CPU use without adopting a library or assuming performance."
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
  "sources": [
    {
      "id": "S1",
      "class": "open-web",
      "title": "Reciprocal Rank Fusion outperforms Condorcet and individual Rank Learning Methods",
      "publisher": "Cormack, Clarke, Buettcher; ACM SIGIR 2009; author-hosted paper",
      "URL": "https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf",
      "accessed_at": "2026-09-06",
      "excerpt": "k = 60 was fixed during a pilot investigation",
      "locator": "Page 1, equation and pilot description; page 2, Table 1",
      "freshness": "Historical original study, not a contemporary local benchmark."
    },
    {
      "id": "S2",
      "class": "open-web",
      "title": "An Analysis of Fusion Functions for Hybrid Retrieval",
      "publisher": "Bruch, Gai, Ingber; author-submitted arXiv v2 (2023-05-04); related ACM DOI 10.1145/3596512",
      "URL": "https://arxiv.org/abs/2210.11934v2",
      "accessed_at": "2026-09-06",
      "excerpt": "we find RRF to be sensitive to its parameters",
      "locator": "Abstract only; full-text retrieval failed",
      "freshness": "Claims limited to author abstract; no numerical gains, dataset details or optimal parameters inferred."
    },
    {
      "id": "S3",
      "class": "open-web",
      "title": "Overview of the TREC 2019 Deep Learning Track",
      "publisher": "Craswell et al.; TREC/NIST track overview; author-hosted paper",
      "URL": "https://bhaskar-mitra.github.io/files/OVERVIEW.DL_2019.pdf",
      "accessed_at": "2026-09-06",
      "excerpt": "The passage seems related to the query but does not answer it.",
      "locator": "Pages 3 and 15, passage judgment rubric and binary relevance threshold",
      "freshness": "Historical benchmark methodology, not a project labeling mandate."
    },
    {
      "id": "S4",
      "class": "open-web",
      "title": "Evaluating the Robustness of Retrieval Pipelines with Query Variation Generators",
      "publisher": "Penha, Camara, Hauff; ECIR 2022; arXiv v3",
      "URL": "https://arxiv.org/abs/2111.13057",
      "accessed_at": "2026-09-06",
      "excerpt": "different variations in queries that do not change the queries' semantics",
      "locator": "Abstract",
      "freshness": "Version 3 corrected Table 2; no table-derived claims used."
    },
    {
      "id": "S5",
      "class": "documentation",
      "title": "Cross-validation: evaluating estimator performance",
      "publisher": "scikit-learn developers",
      "URL": "https://scikit-learn.org/stable/modules/cross_validation.html",
      "accessed_at": "2026-09-06",
      "excerpt": "The i.i.d. assumption is broken if the underlying generative process yields groups of dependent samples.",
      "locator": "Section 3.1.2.4, grouped data",
      "freshness": "Live documentation accessed on stated date; grouping principle used without library adoption."
    },
    {
      "id": "S6",
      "class": "documentation",
      "title": "Reciprocal rank fusion",
      "publisher": "OpenSearch project",
      "URL": "https://docs.opensearch.org/latest/vector-search/ai-search/hybrid-search/rrf/",
      "accessed_at": "2026-09-06",
      "excerpt": "Avoid comparing RRF scores across queries.",
      "locator": "Sections: Controlling fusion depth; Interpreting RRF scores; Tuning the rank constant; Weighting query clauses",
      "freshness": "Live latest documentation; only inspected formula, weighting and truncation semantics used, not version-specific adoption advice."
    },
    {
      "id": "S7",
      "class": "documentation",
      "title": "Reciprocal rank fusion",
      "publisher": "Elastic",
      "URL": "https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion",
      "accessed_at": "2026-09-06",
      "excerpt": "If rank_window_size changes, then the order of the results might change as well",
      "locator": "Pagination in RRF and rank_window_size parameter",
      "freshness": "Live documentation; broad relevance promises are not treated as universal evidence."
    },
    {
      "id": "S8",
      "class": "documentation",
      "title": "Retrieve & Re-Rank",
      "publisher": "Sentence Transformers maintainers",
      "URL": "https://www.sbert.net/examples/sentence_transformer/applications/retrieve_rerank/README.html",
      "accessed_at": "2026-09-06",
      "excerpt": "the query and the document",
      "locator": "Retrieve & Re-Rank Pipeline and Re-Ranker: Cross-Encoder",
      "freshness": "Live documentation; no model choice, probability calibration or CPU latency extrapolation."
    },
    {
      "id": "S9",
      "class": "open-web",
      "title": "Query2doc: Query Expansion with Large Language Models",
      "publisher": "Wang, Yang, Wei; ACL EMNLP 2023",
      "URL": "https://aclanthology.org/2023.emnlp-main.585/",
      "accessed_at": "2026-09-06",
      "excerpt": "generates pseudo-documents by few-shot prompting large language models",
      "locator": "Abstract; linked PDF page 1, introduction",
      "freshness": "Historical method; paper uses text-davinci-003 in experiments, not evidence for a local CPU implementation."
    },
    {
      "id": "S10",
      "class": "open-web",
      "title": "Revisiting Query Variation Robustness of Transformer Models",
      "publisher": "Hagen, Scells, Potthast; ACL Findings EMNLP 2024",
      "URL": "https://aclanthology.org/2024.findings-emnlp.248/",
      "accessed_at": "2026-09-06",
      "excerpt": "focusing on a single category of query variation may even degrade the effectiveness on others",
      "locator": "Abstract",
      "freshness": "Research results scoped to studied models, not a measurement of this project's E5 model."
    },
    {
      "id": "S11",
      "class": "open-web",
      "title": "BEIR: A Heterogenous Benchmark for Zero-shot Evaluation of Information Retrieval Models",
      "publisher": "Thakur et al.; NeurIPS 2021; arXiv v4",
      "URL": "https://arxiv.org/abs/2104.08663",
      "accessed_at": "2026-09-06",
      "excerpt": "BM25 is a robust baseline",
      "locator": "Abstract",
      "freshness": "Historical heterogeneous benchmark; not a local performance forecast."
    }
  ],
  "validated_claims": [
    {
      "id": "C1",
      "source_ids": [
        "S1"
      ],
      "claim": "The original RRF study fixed c=60 after pilots, retained it for validation, and found nearby values competitive in its multi-system TREC setting. It did not establish a universal optimum for two-leg local chunk retrieval."
    },
    {
      "id": "C2",
      "source_ids": [
        "S2"
      ],
      "claim": "The later fusion study reports parameter sensitivity for RRF and better convex-combination performance in its in-domain and out-of-domain experiments, with sample-efficient tuning. This is a reason to compare methods, not evidence that score fusion will improve this corpus."
    },
    {
      "id": "C3",
      "source_ids": [
        "S3"
      ],
      "claim": "TREC distinguishes answer-bearing passages from merely related passages; its passage binary metrics count grades 2 and 3, while graded nDCG can credit grade 1. Document and passage judgments are different evaluation targets."
    },
    {
      "id": "C4",
      "source_ids": [
        "S4",
        "S10"
      ],
      "claim": "Query-variation studies evaluate meaning-preserving reformulations and find robustness failures. The later study reports that focusing training on one variation category can harm another; one wording or category is not a sufficient robustness test."
    },
    {
      "id": "C5",
      "source_ids": [
        "S5"
      ],
      "claim": "For dependent grouped samples, validation groups should not overlap training groups when estimating generalization to unseen groups."
    },
    {
      "id": "C6",
      "source_ids": [
        "S6",
        "S7"
      ],
      "claim": "RRF weights multiply reciprocal-rank contributions; weights and the rank constant are tuning controls. Truncating input lists changes available contributions and can change fused order even for the same query. Output size and fusion depth need explicit separation during comparisons."
    },
    {
      "id": "C7",
      "source_ids": [
        "S1",
        "S6"
      ],
      "claim": "Rank-only RRF discards score magnitudes. A large constant compresses adjacent contributions; a narrow RRF score band is not a relevance probability or independent evidence of bad ordering."
    },
    {
      "id": "C8",
      "source_ids": [
        "S8"
      ],
      "claim": "A cross-encoder reranker jointly processes each query-candidate pair after candidate retrieval. Pairwise inference adds work beyond retrieving precomputed document embeddings; the candidate set bounds what it can rerank."
    },
    {
      "id": "C9",
      "source_ids": [
        "S9"
      ],
      "claim": "Query2doc expands queries using generated pseudo-documents and reports retrieval gains in its experiments. Its reported LLM-backed setup is not proof that local CPU expansion meets this project's constraints."
    },
    {
      "id": "C10",
      "source_ids": [
        "S11"
      ],
      "claim": "BEIR evaluates heterogeneous tasks rather than one narrow domain. Its original study found BM25 a robust baseline and strong average reranking results at higher computational cost; it provides no host-specific latency estimate."
    }
  ],
  "question_coverage": [
    {
      "question": "Q1",
      "claim_ids": [
        "C3",
        "C4",
        "C5",
        "C10"
      ],
      "answer": "Use reviewed answer evidence, not a single path or unstable chunk ID; accept any independently sufficient overlapping chunk. Group reformulations by information need and keep groups together across tuning/evaluation splits. Report answer-hit and first-answer rank separately from document metrics. The operational recommendations below are project-specific synthesis, not published thresholds."
    },
    {
      "question": "Q2",
      "claim_ids": [
        "C1",
        "C2",
        "C6",
        "C7"
      ],
      "answer": "Treat c, leg weights and candidate depth as independent experimental factors. c=60 is a defensible baseline, not a theorem. Score-aware fusion is a candidate backed by other datasets, not a selected replacement. Neither narrow absolute RRF scores nor a four-decimal gap establishes confidence."
    },
    {
      "question": "Q3",
      "claim_ids": [
        "C3",
        "C4",
        "C5",
        "C6",
        "C8"
      ],
      "answer": "Freeze inputs and collect production stage outputs; compare legs, their union, fusion, cap and final slice separately. A bounded reranker cannot recover absent candidates. Hold out whole intent groups and include multiple corpus slices; repeat the chosen configuration end-to-end at the actual request k."
    },
    {
      "question": "Q4",
      "claim_ids": [
        "C2",
        "C6",
        "C8",
        "C9",
        "C10"
      ],
      "answer": "Rank-only changes need no extra model. Score fusion requires validated score semantics. Reranking introduces query-passage inference; expansion introduces additional queries or generation and may change intent. Benefit, local compatibility and CPU cost remain unmeasured; no dependency or algorithm is chosen."
    }
  ],
  "local_evidence": {
    "reference": "C:/Users/Raul/Workspace/compendio-mcp/openspec/changes/retrieval-ranking-robustness/exploration.md",
    "provenance": "Inherited verified exploration, read directly; not independently re-run in research.",
    "facts": [
      "Both known answer chunks were lexically within the top four for the two recorded wordings; lexical candidate loss does not explain that local observation.",
      "The document cap preserves order; it cannot promote the retained rank-eight answer into the top five when removed.",
      "The current evaluator targets document paths and requests 3*k chunks, changing candidate depth relative to normal search.",
      "The recorded k=10 trace is not the exact k=5 population. Current vector ranks, end-to-end baseline and algorithm benefit remain unmeasured."
    ],
    "scope_note": "The exploration's prose 'Ready for Proposal: Yes' is not current admission: selected research is now done, but product decisions remain pending."
  },
  "project_synthesis": {
    "authority": "Non-authoritative recommendations for orchestrator-owned product discovery; no implementation requirements or user-approved thresholds.",
    "minimal_reviewed_goldenset": [
      "Record corpus/config identity, label revision, intent_id, variant_id, natural query, language, variant category, split, expected document set, answer-evidence set, reviewer and rationale. Author questions from genuine information needs rather than copying answer phrases into queries.",
      "Represent an answer evidence item with a document-relative path plus reviewed contextual span or phrase, optional heading constraint and source-content identity. Resolve it against current stored chunks and assert a nonempty acceptable set for answerable cases. Heading alone can collide; numeric database IDs are transient. Re-review after corpus/chunking changes rather than silently remapping.",
      "Treat overlapping chunks that independently answer the same need as alternatives, not separate required successes. If several facts are jointly necessary, model required evidence groups explicitly; do not incorrectly accept a chunk containing only one fact.",
      "Review meaning preservation of variants and adjudicate ambiguous labels. Pool candidates from lexical/vector/baseline and selected alternatives for additional human judgments; record unjudged items, avoid assuming a pooled set is exhaustive, and rejudge newly surfaced potential positives without changing criteria to favor a run.",
      "Cover distinct intents and documents, natural paraphrase and shorter/longer wording, lexical exactness and semantic mismatch, repeated headings/overlap, and near-topic distractors. Keep existing Spanish regression material unchanged. Keep unanswerable cases separate from answer-retrieval aggregates.",
      "Assign near-duplicate intents and all their variants to one split before tuning. When claiming document-family/domain generalization, also group those families; overlap of an indexed corpus across query splits is not itself label leakage. Keep the staged failure in the diagnostic set, not as the sole held-out test.",
      "Use a frozen held-out intent set, or grouped outer validation if independent groups are too few. Do not choose parameters or thresholds on held-out results. Report number of independent intents, not only inflated variant counts. No minimum sample count is established by these sources."
    ],
    "metric_contract": [
      "For query q, let A_q be the nonempty set of chunks independently sufficient for its answer; let T_k be the exact emitted chunk list. AnswerHit@k = 1 if A_q intersects T_k, else 0. This is an any-answer success rate, not set Recall@k = |A_q intersect T_k|/|A_q|; the latter can punish retrieving only one of two redundant alternatives.",
      "AnswerRR@k = 1/r for the first acceptable emitted chunk at rank r <= k, otherwise 0. Average first within intent, then across intents, so heavily paraphrased intents do not dominate. Report Hit@1 and Hit@5; k=10 is a separate diagnostic request, not an inferred suffix.",
      "Report per-intent variant success fraction, all-variants-hit@k and worst-variant RR@k. Missing answers have RR=0 and rank >k/censored, never a fabricated measured rank k+1. Rank spread is descriptive only where actual ranks are observed; an identical bad ranking can be stable yet useless.",
      "Keep document Hit/MRR and unique-document diversity as a separate layer, with explicit deduplication and search-depth rules. Retain historical eval as compatibility evidence while labeling its different request population. A document hit cannot substitute for an answer hit.",
      "Use graded nDCG only after defining reviewed gains and a relevance unit; naive chunk nDCG can reward redundant overlap. Evidence-group coverage is preferable when multiple distinct facts are required. The primary outcome and permitted regressions need user approval.",
      "Publish paired per-intent win/loss/tie counts and individual failure cases alongside aggregates. Any confidence interval should resample independent intent groups rather than treating paraphrases as independent; small sets provide limited precision, not proof of generality."
    ],
    "measurement_first_gate": [
      "Freeze corpus files, indexed chunk/vector population, model/config/version, query/label/split revision and production code identity. Baseline hybrid and lexical-degraded modes separately; do not silently report lexical fallback as hybrid.",
      "Validate diagnostic fidelity against the same production search execution: identical ordered final chunk identities at the same requested k, filters, candidate depth, cap and tie policy. A reimplementation that happens to use the same formula is not enough.",
      "Capture exact per-leg membership/ranks, list lengths, overlap, per-document counts, fused unrounded scores/ranks, cap removals and final ranks. Mark absence as outside retrieved depth, not absolute corpus rank.",
      "Verify label resolution and stage population anti-vacuity, then challenge the gate with a controlled wrong-answer top-k/known-bad ranking and invalid-label case. The expected failure reason must be relevance or label integrity, not missing executable or generic exit code.",
      "Establish fresh baselines on both corpora before parameter selection. Lock target metric, required benefit, regression tolerances and CPU/memory budget with the user before comparing winners. A gate specification must not backfill thresholds from the best observed result.",
      "No goldenset construction, new harness, experiment, model initialization or cache/database mutation was performed by this research phase."
    ],
    "controlled_ablations": [
      {
        "factor": "Candidate availability",
        "control": "Same corpus/query/model and fixed per-leg depth D",
        "comparison": "Lexical only, vector only, union candidate answer availability",
        "attribution": "Absent from both: fusion cannot recover the answer. Absent from one: candidate recall or rank truncation matters. Inspect deeper lists only in a separately authorized diagnostic."
      },
      {
        "factor": "Vector rank versus fusion",
        "control": "Freeze exact leg lists, membership, deterministic ties and cap",
        "comparison": "Inspect each acceptable chunk's lexical/vector ranks; replay baseline fusion versus lexical-only/vector-only order",
        "attribution": "Distinguishes a weak vector rank pulling against a strong lexical rank from answer absence. Retain all acceptable overlapping chunks in attribution."
      },
      {
        "factor": "RRF constant",
        "control": "Same frozen lists and equal weights",
        "comparison": "A small predeclared c grid including baseline c=60; no parameter selected here",
        "attribution": "Tests top-rank emphasis; a larger score spread is not the success metric."
      },
      {
        "factor": "Leg weights",
        "control": "Same frozen lists and c",
        "comparison": "A bounded predeclared lexical/vector weight grid, then only planned c-by-weight interaction checks",
        "attribution": "Tests contribution balance without changing input candidates; do not grow an unlimited sweep after viewing outcomes."
      },
      {
        "factor": "Document cap",
        "control": "Identical fused list",
        "comparison": "Existing cap versus no cap; retain pre/post ranks and document coverage",
        "attribution": "Measures actual removals and diversity tradeoff. Cannot claim that removing an order-preserving cap improves a surviving answer's numeric position."
      },
      {
        "factor": "Candidate depth",
        "control": "Same final output k; unchanged query/model/fusion/cap",
        "comparison": "Predeclared depths including production depth; replay only within the captured maximum and verify leg prefix identity before truncating",
        "attribution": "Depth changes both membership and second-leg contribution. Growing k instead confounds depth with output allowance; rerun if retrieval isn't prefix-stable."
      },
      {
        "factor": "Score fusion, if authorized later",
        "control": "Same candidate union and final output policy",
        "comparison": "Capture actual adapter scores/distances; establish score direction, missing-leg behavior, normalization population and constant-score fallback before comparing",
        "attribution": "Rank traces alone cannot evaluate score-aware fusion; normalized scores are not automatically calibrated answer probabilities."
      }
    ],
    "local_cpu_tradeoffs": [
      {
        "candidate": "Rank-only c/weight tuning",
        "benefit": "Reuses existing ranks and requires no new model inference.",
        "cost_or_risk": "Does not recover discarded score margins; still needs held-out judgment evidence. No measured latency bound.",
        "adoption": "Not selected."
      },
      {
        "candidate": "Score-aware convex combination",
        "benefit": "Can retain relative score margins that ranks discard.",
        "cost_or_risk": "Needs score-bearing port/adapter changes, direction checks, normalization and missing-score policy; distribution shifts require evaluation. No evidence that the resulting score is calibrated confidence.",
        "adoption": "Not selected."
      },
      {
        "candidate": "Local reranking",
        "benefit": "Joint query-passage evidence may correct ordering within available candidates.",
        "cost_or_risk": "Additional model footprint and pair inference; candidate count and passage length matter. Benchmark warm/cold p50/p95, peak memory and offline compatibility on target CPU before any commitment.",
        "adoption": "Not selected; no model download."
      },
      {
        "candidate": "Query expansion",
        "benefit": "May bridge vocabulary differences or expose alternate candidates.",
        "cost_or_risk": "Multiple searches/generation add work; expansions may change intended constraints. Keep original-query baseline and review semantic fidelity. A remote LLM paper does not establish local feasibility.",
        "adoption": "Not selected; network query-time behavior remains out of scope."
      }
    ]
  },
  "contradictions": [
    {
      "source_ids": [
        "S1",
        "S2"
      ],
      "issue": "Original RRF pilots found c relatively insensitive; later hybrid research reports sensitivity and convex-combination gains.",
      "resolution": "Different systems/data/settings. Preserve both observations and use local held-out comparisons; neither is universal."
    },
    {
      "source_ids": [
        "S7",
        "S2",
        "S6"
      ],
      "issue": "Elastic introductory text calls RRF tuning-free and broadly describes larger windows as improving relevance.",
      "resolution": "Operational defaults are not a theorem of monotonic quality. Other evidence and the documented truncation mechanism require measurement; larger depth can change both good and bad agreement."
    },
    {
      "source_ids": [
        "S3"
      ],
      "issue": "Related passages can earn graded gain without answering the question.",
      "resolution": "Use explicit answer-hit metrics; do not interpret a higher topical nDCG or document MRR as proven answer-bearing success."
    }
  ],
  "uncertainty": [
    "Full fusion-paper PDF/HTML access returned Internal Error, including version-pinned PDF. Only its accessible primary author abstract supports C2; no full-text-specific claim is admitted. This bounds claim strength, not coverage of the methodological questions.",
    "Sources do not determine goldenset size, user-facing quality threshold, regression allowance, CPU budget, preferred algorithm or optimal fusion depth here.",
    "Overlapping answer sets and production-faithful ablation recommendations are explicit project synthesis from evidence and inherited exploration, not a published standard for this repository.",
    "No new corpus measurements were made; current vector ranks, exact default-k failure reproduction and all proposed gains remain unknown.",
    "Query expansion's semantic-drift risk is an experimental threat to check, not a measured defect in this project."
  ],
  "freshness": {
    "accessed_at": "2026-09-06",
    "policy": "Original papers support historical results; live official pages support inspected mechanics as of access. Recheck dynamic documentation before later implementation. This is focused evidence research, not an exhaustive state-of-the-art survey.",
    "invalid_sources_excluded": "Secondary summaries, search snippets without verified primary support, and failed full-text responses did not become source claims."
  },
  "product_choices": {
    "status": "pending",
    "authoritative": false,
    "items": [
      "Goldenset ownership and permitted location",
      "Minimum independent intent and reformulation coverage",
      "Primary success criterion and average versus worst-case requirement",
      "Regression tolerance on both document and answer metrics",
      "CPU, latency and memory budget"
    ],
    "proposal_ready": false
  },
  "persistence": {
    "artifact_store": "openspec",
    "evidence_reference": "C:/Users/Raul/Workspace/compendio-mcp/openspec/changes/retrieval-ranking-robustness/research.md",
    "engram_evidence_reference": null,
    "readback_required": true
  }
}
