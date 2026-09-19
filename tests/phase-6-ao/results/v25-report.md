# PHASE 6-AO-V25 - PAIR-005 / PAIR-007 FORENSIC ANALYSIS REPORT

- STATUS: COMPLETE
- MODE: READ-ONLY FORENSIC (no experiment performed)
- DATE: 2026-09-01
- PREDECESSOR: PHASE 6-AO-V24 (external-embedding evaluation; closed negative)
- COMPANION ARTIFACT: v25-pair-005-007-forensic-analysis.json (machine-readable)

## 1. V25 Status and Scientific Question

V25 is a forensic milestone. It determines, using repository evidence only, whether the
residual 1-TP gap (pair-005, pair-007) is:

- A) a genuine retrieval/embedding-geometry failure
- B) a verifier/identity-policy boundary
- C) a benchmark construction/labeling defect
- D) a benchmark SAME-definition vs AETHER identity-semantics mismatch
- E) another evidence-backed cause

VERDICT: **A.** Both pairs are legitimate SAME items that fail at retrieval eligibility
(below the frozen 0.85 candidate floor in every measured configuration). Hypotheses B, C
and D are excluded by recorded evidence; no other cause (E) was identified.

Context: BEST_TP = 18/22, REQUIRED_TP = 19, TP_GAP = 1. Only pair-005 or pair-007 can
provide the missing legitimate TP through retrieval. pair-011 is verifier-bound;
pair-034 is the V21/V23 SAFETY_DECOY and stays outside all recall reasoning.

## 2. Dataset Verification (frozen, unchanged)

- Path: tests/phase-6-ao/dataset.json
- SHA-256: 5B0C8493914AAF9A1E58358292DB8ADBF55B598D225692F1915DC49502DAF049
- Match against frozen contract: TRUE (verified live at V25 start and again after artifact creation)
- Composition: TOTAL 43 / SAME 22 / DIFFERENT 21
- Recall denominator (22 SAME): UNCHANGED. Dataset NOT modified by V25.

## 3. Exact Files Inspected

- tests/phase-6-ao/dataset.json (frozen corpus; pair-005/007 textA/textB, factKey, label extracted; SHA verified)
- tests/phase-6-ao/decoy-corpus.json (V23 SAFETY_DECOY manifest)
- tests/phase-6-ao/results/: v11-band-probe.json + v11-report.md; v13-embedding-model-evaluation.json + v13-report.md; v14-embedding-prefix-evaluation.json + v14-report.md; v15-error-boundary-diagnostic.json + v15-report.md; v16-verifier-forensic-audit.json + v16-report.md; v17-verifier-policy-evaluation.json; v18-verifier-policy-generalization.json + v18-report.md; v19-embedding-hypothesis-audit.json + v19-report.md; v20-asymmetric-instruction-evaluation.json + v20-report.md + v20-run-log.txt; v21-pair-034-forensic-audit.json + v21-report.md; v23-bench-contract-report.md; v24-external-embedding-evaluation.json + v24-report.md + v24-run-log.txt; v10-report.md + v10-post-adoption-observability.json
- lib/memory/identity.ts (threshold 0.85, candidate count 8, qwen2.5:3b, SYS_V5, resolveMemoryIdentity protocol L182-363)
- lib/ai/embeddings/embed.ts (nomic-embed-text:latest, bare text, 768-dim)
- tests/phase-6-ao/v20-asymmetric-instruction-evaluation.test.ts + v24-external-embedding-evaluation.test.ts (pinned SYS_V5 prompt text and hashes)
- NOTE: no standalone v12-* artifact exists in results/; the V12 geometry-closure conclusion is recorded inside the v13/v15 reports.

## 4. Pair-005 Forensic Result

| Field | Value |
|---|---|
| PAIR | pair-005 |
| FACT_KEY | programming-language |
| FROZEN_LABEL | SAME |
| TEXT_A | "Programming is something I spend a lot of time doing." |
| TEXT_B | "Writing software is a regular part of my work." |
| SEMANTIC_CLASSIFICATION | CLEAR_SAME |
| RETRIEVAL_STATUS | RETRIEVAL_ELIGIBILITY_FAILURE - below 0.85 in every measured configuration |
| VERIFIER_STATUS | NEVER_PRESENTED - zero verifier evidence exists; never eligible, so never reached SYS_V5 |
| BENCHMARK_PATTERN | CONFORMS - abstract activity-paraphrase SAME prototype (cf. pair-013, pair-017, pair-039, pair-041); factKey neighbor pair-006 is the value-contrast DIFFERENT (Python + negation) |
| IDENTITY_SEMANTICS_ALIGNMENT | ALIGNED - matches the SYS_V5 "same underlying fact, different wording" SAME class; no DIFFERENT trigger exists |
| EVIDENCE | Similarity ledger (all historical recorded values): nomic bare 0.764026 (V11/V20-A/V24); mxbai bare 0.807088 (V13/V24); mxbai symmetric query-prefix 0.821145 (V14/V20-B/V24-B, max); mxbai documented 0.745386/0.724381 (V20); nomic search_query/search_document 0.765555 (V20); bge-m3 bare 0.797833 (V24); bge-m3 documented 0.658307 (V24). All < 0.85. Absent from V16 audit, V17 pool, V18 policies, V20/V24 eligible sets. |
| ROOT_CAUSE | RETRIEVAL_FAILURE (A: embedding/retrieval-geometry deficit under the frozen 0.85 floor) |
| CONFIDENCE | HIGH |
| REMAINING_UNCERTAINTY | Mechanistic reason why similarity floors at 0.821145 under the best configuration is not established (out of read-only scope); does not affect failure-mode classification |

Semantic decomposition: no concrete entity, value, technology, project, tool, location,
time, scope, ownership, or capability appears on either side. The only difference is
surface wording for the same enduring activity-habit fact.

## 5. Pair-007 Forensic Result

| Field | Value |
|---|---|
| PAIR | pair-007 |
| FACT_KEY | project |
| FROZEN_LABEL | SAME |
| TEXT_A | "I am working on Aether as my main AI project." |
| TEXT_B | "Aether is the project I am currently developing for persistent memory capabilities." |
| SEMANTIC_CLASSIFICATION | CLEAR_SAME |
| RETRIEVAL_STATUS | RETRIEVAL_ELIGIBILITY_FAILURE - below 0.85 in every measured configuration; closest never-eligible SAME pair to the floor |
| VERIFIER_STATUS | NEVER_PRESENTED - zero verifier evidence exists; never eligible in any V11-V24 configuration |
| BENCHMARK_PATTERN | CONFORMS - same-entity scope-enrichment SAME prototype (cf. pair-021, pair-009, pair-023/025/027); the only entity swap in its factKey is DIFFERENT pair-008 (Aether vs separate stock-market AI) |
| IDENTITY_SEMANTICS_ALIGNMENT | ALIGNED - added purpose clause ("for persistent memory capabilities") does not change the underlying fact, entity, value, ownership, or scope in the SYS_V5 sense; no DIFFERENT trigger |
| EVIDENCE | Similarity ledger (all historical recorded values): nomic bare 0.804500 (V11/V20-A/V24); mxbai bare 0.806107 (V13/V24); mxbai symmetric query-prefix 0.837367 (V14/V20-B/V24-B, max); mxbai documented 0.777087/0.761467 (V20); nomic search_query/search_document 0.831195 (V20); bge-m3 bare 0.809384 (V24); bge-m3 documented 0.727506 (V24). All < 0.85. Absent from V16 audit, V17 pool, V18 policies, V20/V24 eligible sets. |
| ROOT_CAUSE | RETRIEVAL_FAILURE (A: embedding/retrieval-geometry deficit under the frozen 0.85 floor) |
| CONFIDENCE | HIGH |
| REMAINING_UNCERTAINTY | Mechanistic embedding-geometry reason for the 0.837367 ceiling not established (out of scope). A reviewer could argue textB is "more specific" than textA, but specificity-enrichment without fact change is a recognized SAME pattern in this corpus (pair-021, pair-023/025/027); classification unaffected. |

Semantic decomposition: same concrete entity (Aether) on both sides; same project role,
same ownership, same ongoing activity. B adds a purpose descriptor. No entity swap
(that is pair-008, correctly frozen DIFFERENT).

## 6. Identity-Contract Analysis (production semantics, static inspection)

- Embedding: nomic-embed-text:latest (768-dim, bare text) via lib/ai/embeddings/embed.ts
- Identity candidate floor: 0.85 (IDENTITY_CANDIDATE_MIN_SIMILARITY); candidate count 8
- Verifier: qwen2.5:3b; SYS_V5 (sha256 b999aa8f...93e2d, pinned by V20/V24); temperature 0, num_predict 256, top_p 0.9 (deterministic)
- Resolution protocol (identity.ts L182-363): embed observation -> RPC match_memories_v2 (minSimilarity 0.85, matchCount 8) -> deterministic sort (similarity DESC, effective_score, confidence, id) -> verify each candidate in order via SYS_V5 -> clean all-SAME pool = corroborate the single canonical target; any DIFFERENT/UNCERTAIN = non-clean -> fail-safe create.
- What "same identity" means contractually: the candidate already records the same underlying user fact at the same scope and specificity, even if worded differently (SYS_V5).
- Corroboration: invoked by the caller when resolution returns SAME with a target; the identity layer performs no writes itself; it is an additive safety layer on top of the exact-match fast path in saveMemory (identity.ts header).
- Explicit conflict kinds (SYS_V5 DIFFERENT): different subject, different value, contradiction, temporal shift, different entity, different scope, or only a related-but-not-identical topic.
- Exact value equality: NOT required (paraphrase with different nouns/verbs = SAME when the fact is the same); concrete entity/value swaps = DIFFERENT.
- Retrieval similarity means candidate screening (a recall/cost-bounding floor), NOT an identity verdict; the verifier decides identity, conservatively (DIFFERENT/UNCERTAIN on doubt).
- CONCLUSION: AETHER production semantics would treat pair-005 and pair-007 as the same underlying fact. The stage that blocks them is retrieval eligibility (the 0.85 floor), not identity policy.

## 7. Verifier-Boundary Analysis

Verifier-bound cases (contrast set; both ELIGIBLE and both deterministically rejected):

| Pair | factKey | Similarity | Eligible | Modal verdict | Distribution (SAME/DIFF/UNC) | Note |
|---|---|---|---|---|---|---|
| pair-011 | technology-preference | 0.865164 | YES | DIFFERENT | 0/20/0 | SCOPE_MISMATCH per V16; V18 POLICY_B recovered it (20/20 SAME modal) but POLICY_NON_GENERALIZING (changedCount=1); not adopted |
| pair-034 | tools | 0.865992 | YES | DIFFERENT | 0/20/0 | CASE-E decoy per V21; SAFETY_DECOY per V23; 100% rejection across 150+ recorded evaluations; NOT a recall item |

pair-005 / pair-007 verifier evidence: **NONE.** Never eligible in any V11-V24
configuration, therefore never presented to SYS_V5. V16 audited only pair-011 and
pair-034. The V17 baseline verifier pool (25 pairs) does not include them. V18 policy
experiments never reached them. V20/V24 eligible sets did not include them. Per the
interpretation rule, NO verifier rejection is inferred for these pairs.

CONCLUSION: the verifier boundary (stage 2) is NOT the cause of the pair-005/pair-007
failures. Both fail at retrieval eligibility (stage 1). No verifier-policy change could
recover them because they never reach the verifier. The verifier-bound cases remain
exactly pair-011 (policy ceiling) and pair-034 (decoy).

## 8. Benchmark-Pattern Analysis

SAME construction patterns observed across the corpus:

1. Concrete entity/value held constant + paraphrase: pair-001/pair-003 (work-location, Mumbai), pair-013 (favorite-food, pizza), pair-029 (PostgreSQL), pair-033 (tools, GitHub/GitHub).
2. Abstract activity paraphrase (no concrete entity): pair-005, pair-017, pair-039, pair-041.
3. Same-entity scope/purpose enrichment: pair-007, pair-021, pair-009, pair-023, pair-025, pair-027.

DIFFERENT construction pattern: concrete entity/value contrast between A and B
(pair-002, pair-004, pair-006 Python + negation, pair-008 Aether vs separate
stock-market AI, pair-010, pair-012, pair-014, pair-016, pair-018, pair-020, pair-022,
pair-024, pair-026, pair-028, pair-030, pair-036, pair-038, pair-040, pair-042).

Known anomaly: pair-034 (GitHub vs GitLab) is frozen SAME but forensically
CLEAR_DIFFERENT (V21 CASE-E); V23 separated it as SAFETY_DECOY without modifying the
frozen dataset. It remains outside recall reasoning and outside this forensic
conclusion.

Verdicts:
- pair-005: CONFORMS to the abstract-paraphrase SAME prototype; no value-contrast or entity-swap elements; no anomaly or decoy treatment documented in V11-V24.
- pair-007: CONFORMS to the same-entity enrichment SAME prototype; the only entity swap in its factKey is DIFFERENT pair-008; no anomaly or decoy treatment documented in V11-V24.
- Label-defect evidence found for pair-005 or pair-007: NONE.

## 9. Root-Cause Classification

- pair-005: category **A_RETRIEVAL_EMBEDDING_GEOMETRY**. Excluded: B (never reached the verifier), C (label conforms to the corpus SAME construction pattern), D (matches the SYS_V5 same-fact-different-wording SAME class), E (no other cause identified in V11-V24).
- pair-007: category **A_RETRIEVAL_EMBEDDING_GEOMETRY**. Excluded: B (never reached the verifier), C (label conforms), D (same-entity enrichment matches SYS_V5 SAME semantics), E (no other cause identified).
- OVERALL: The residual 1-TP gap is a genuine retrieval/embedding-geometry failure on two legitimate SAME pairs under the frozen 0.85 candidate floor. The benchmark construction and the identity semantics are aligned for these pairs; the verifier boundary is not implicated.

INTERPRETATION RULE (binding): this forensic conclusion does NOT authorize lowering the
threshold, changing the embedding model or dimensions, changing verifier policy,
changing the dataset, or any pair-specific hack. Any such change requires a separate
milestone and explicit approval.

## 10. Final Matrix

| Category | pair-005 | pair-007 |
|---|---|---|
| CLEAR_SAME | YES | YES |
| CLEAR_DIFFERENT | NO | NO |
| RETRIEVAL_FAILURE | YES (root cause) | YES (root cause) |
| VERIFIER_FAILURE | NO (never eligible; never presented to SYS_V5) | NO (never eligible; never presented to SYS_V5) |
| BENCHMARK_DEFECT | NO | NO |
| SEMANTIC_MISMATCH | NO | NO |
| OTHER | NO | NO |
| INSUFFICIENT_EVIDENCE | PARTIAL - mechanistic embedding-geometry explanation only | PARTIAL - mechanistic embedding-geometry explanation only |

## 11. Evidence Limitations

1. Corpus-wide source/rationale field mojibake (noted in V21): the original label-author rationale is unrecoverable for all pairs; classification rests on the frozen textA/textB, factKey, and label facts plus recorded artifacts.
2. No verifier evidence exists for pair-005 or pair-007 by construction (never eligible); verifier hypotheses about these pairs are unfalsifiable from recorded artifacts; classification rests on retrieval status.
3. The mechanistic embedding-geometry reason why similarity floors at 0.821145 (pair-005) and 0.837367 (pair-007) under the best measured configuration is not established; geometry experiments are outside V25 read-only scope.
4. The original construction intent (whether pair-005/007 were deliberately designed as difficult-but-valid SAME items) cannot be proven from artifacts; conformity to corpus construction patterns is the available evidence.

## 12. Integrity Statements

- NO experiment was performed in V25. Every similarity value cited in this report is a historical recorded value from V11-V24 artifacts, not a new measurement.
- NO embedding runs, NO verifier runs, NO Ollama contact, NO model installation.
- NO network contact. NO database writes (DB_WRITES = 0). NO Supabase contact.
- Production remains unchanged: nomic-embed-text:latest (768-dim, bare text), threshold 0.85, candidate count 8, verifier qwen2.5:3b, SYS_V5 frozen, candidate count 8.
- Dataset unchanged (SHA-256 verified before and after): 5B0C8493914AAF9A1E58358292DB8ADBF55B598D225692F1915DC49502DAF049.
- No V1-V24 historical artifact was modified. No relabeling of pair-005, pair-007, or pair-034. Recall denominator remains 22 SAME.
- FILES_CREATED: v25-pair-005-007-forensic-analysis.json, v25-report.md, v25-run-log.txt. FILES_MODIFIED: none.

## 13. Next Action

HUMAN_REVIEW. V25 is complete. Do not start V26 automatically. Any retrieval-geometry
investigation, production-contract revision, or benchmark decision identified by this
report requires a separate planned milestone and explicit approval.


