# Phase 6-AO-V19 — Evidence-Backed Embedding Hypothesis Audit

**Status:** `PENDING`
**Mode:** Read-only audit. Zero-write to production. **DB_WRITES: 0.**
**Recorded:** 2026-09-13 · harness `tests/phase-6-ao/v19-embedding-hypothesis-audit.test.ts`
**Result:** `tests/phase-6-ao/results/v19-embedding-hypothesis-audit.json`

## 1. Evidence summary

Current best experimental result (V14):
- Model: `mxbai-embed-large:latest` + `"query: "` prefix
- TP = 18 / 22, fixedRecall = 81.82%, FCR = 0%
- Remaining gap: 1 TP to reach promotion target (TP >= 19)

Residual false negatives (V14/V15):
| Pair | factKey | V14 sim | Gap to 0.85 | Failure mode |
|------|---------|---------|-------------|--------------|
| pair-005 | programming-language | 0.821145 | +0.028855 | RETRIEVAL_ELIGIBILITY |
| pair-007 | project | 0.837367 | +0.012633 | RETRIEVAL_ELIGIBILITY |
| pair-011 | technology-preference | 0.865164 | eligible | VERIFIER_DECISION |
| pair-034 | tools | 0.865992 | eligible | VERIFIER_DECISION |

V18 established POLICY_B is non-generalizing. Pair-011/034 remain verifier-layer problems.

## 2. Current model inventory

Installed embedding-capable models:
- `nomic-embed-text:latest` (768 dim, production)
- `mxbai-embed-large:latest` (1024 dim, tested in V13/V14)

Installed non-embedding models (NO-GO):
- `qwen2.5-coder:7b`, `qwen2.5:3b`, `qwen3:4b`

External candidates (not installed, not measured):
- `bge-m3`, `all-minilm`

## 3. Pair-005 forensic analysis

- **Text A:** "Programming is something I spend a lot of time doing."
- **Text B:** "Writing software is a regular part of my work."
- **Structure:** Abstract activity paraphrase; high conceptual overlap, low lexical overlap
- **V14 sim:** 0.000000
- **Gap:** +0.029 from V14 to 0.85
- **Interpretation:** The pair is semantically equivalent but lexically distant. Embeddings must bridge 'programming' → 'writing software' and 'spend a lot of time' → 'regular part of my work'.

## 4. Pair-007 forensic analysis

- **Text A:** "I am working on Aether as my main AI project."
- **Text B:** "Aether is the project I am currently developing for persistent memory capabilities."
- **Structure:** Entity-centric paraphrase with appositive restructuring
- **V14 sim:** 0.000000
- **Gap:** +0.013 from V14 to 0.85
- **Interpretation:** The pair shares the entity 'Aether' and the project concept, but textB adds 'persistent memory capabilities' which is extra context not in textA.

## 5. Hypothesis matrix

| Hypothesis | Evidence Strength | Credible Path to TP=19 |
|------------|-------------------|-----------------------|
| H1: Different embedding model | MODERATE | No |
| H2: Additional/different prefix | WEAK | No |
| H3: Asymmetric encoding | RULED_OUT | — |
| H4: Retrieval-optimized model family | MODERATE | No |
| H5: Dimension/normalization change | INCONCLUSIVE | No |
| H6: Corpus/text-length effect | INCONCLUSIVE | No |

**Conclusion:** No hypothesis reaches EVIDENCE_STRONG for a specific model or configuration change.

## 6. Safety sentinel set

From V14 frozen corpus, the following DIFFERENT pairs are the most dangerous regression sentinels:

| Pair | factKey | V14 sim | Risk |
|------|---------|---------|------|

Any future embedding experiment must report the similarity delta for all five sentinels.

## 7. Recommended future experiment

If a specific candidate model/configuration is proposed with documented retrieval strengths for short paraphrases, design a V20 controlled evaluation:

- Use exact frozen 43-pair corpus
- Preserve labels, threshold 0.85, verifier SYS_V5, qwen2.5:3b
- Compare 3 arms: production (nomic bare), V14 best (mxbai + prefix), candidate (new model + documented config)
- Gates: TP >= 19, fixedRecall >= 86.36%, recall gain vs V11 >= +18.18pp, FCR <= 5%, repeatability >= 18/20

## 8. Installation requirements

No model installation occurs in V19. A future V20 requires:
1. Explicit approval to install candidate model(s) on local Ollama
2. Candidate model must be embedding-capable
3. Installation must not modify production code or dataset

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Speculative model selection | High | Wasted experiment | Require documented model strengths before V20 |
| Safety sentinel regression | Medium | FP increase | Mandatory sentinel reporting in V20 |
| Threshold reopening pressure | Low | Scientific integrity | V11/V12 closure stands |
| Verifier-layer confusion | Medium | Misattributed failure | V18 closed POLICY_B; V19 focuses on embedding only |

## 10. Explicit NO-GO candidates

- `qwen2.5-coder:7b` — chat model, not embedding-capable
- `qwen2.5:3b` — chat model, not embedding-capable
- `qwen3:4b` — chat model, not embedding-capable
- `nomic-embed-text:latest` — already production baseline
- `mxbai-embed-large:latest` — already tested; no further prefix variants documented or evidence-based

## 11. Final recommendation

**NO-GO for V19 scientific execution.**

The evidence does not support a specific, evidence-backed embedding hypothesis with a credible chance of recovering an additional TRUE-SAME pair. The remaining gap (0.013–0.029) is small, the best available model has already been tested with its recommended configuration, and no installed alternative model exists.

If a future milestone wishes to pursue this path, it must:
1. Propose a specific external model (e.g., `bge-m3`, `all-minilm`, or another retrieval-optimized embedding model)
2. Provide documented evidence of strength on short-paraphrase semantic similarity
3. Obtain installation approval
4. Run a controlled V20-style evaluation against the frozen corpus

Until then, the embedding layer is closed for this corpus under the current frozen constraints.

## 12. Production integrity

- Production code: untouched
- Production embedding: `nomic-embed-text:latest`, 768 dim, no prefix
- Threshold: 0.85 (unchanged)
- Verifier: SYS_V5 (unchanged)
- Dataset: unchanged
- DB_WRITES = 0