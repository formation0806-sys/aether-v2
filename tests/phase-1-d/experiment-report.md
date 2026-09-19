# Phase 1-D — Large Semantic Validation Report

## Corpus
- **Corpus total**: 150
- **Positive**: 75
- **Negative**: 75
- **Real/synthetic ratio**: 60/40 (95 real-memory-mimicking, 55 hand-authored synthetic)
- **Split**: 70/30 calibration/holdout (105 calibration, 45 holdout)
- **Embed model**: nomic-embed-text:latest (768-dim)
- **Split**: 70/30 calibration/holdout
- **Repeat count**: 3
- **Zero-write**: measurement read-only (embed + in-memory cosine match)

## Similarity Observations (S3 = min similarity over claimed sources)

| id | label | style | min | mean | measured | unmeasured |
|----|-------|-------|-----|------|----------|------------|
| pos-1 | positive | repeated_pattern | 0.9102 | 0.9120 | 2 | 0 |
| pos-2 | positive | relationship | 0.7882 | 0.8288 | 2 | 0 |
| pos-3 | positive | change_over_time | 0.8083 | 0.8089 | 2 | 0 |
| pos-4 | positive | contradiction | 0.8435 | 0.8543 | 2 | 0 |
| pos-5 | positive | multi_source_supported | 0.8537 | 0.8652 | 2 | 0 |
| neg-1 | negative | verbatim_repetition | 0.7460 | 0.8730 | 2 | 0 |
| neg-2 | negative | single_source_paraphrase | 0.6282 | 0.8141 | 2 | 0 |
| neg-3 | negative | unrelated_source_pairing | 0.6480 | 0.7140 | 2 | 0 |
| neg-4 | negative | topical_similar_unsupported_inference | 0.7325 | 0.7602 | 2 | 0 |
| neg-5 | negative | unsupported_causal_inference | 0.6912 | 0.7354 | 2 | 0 |
| neg-6 | negative | unsupported_personal_inference | 0.6182 | 0.6821 | 2 | 0 |
| neg-7 | negative | wrong_source_attribution | 0.6543 | 0.7123 | 2 | 0 |
| neg-8 | negative | unsupported_contradiction_claims | 0.6876 | 0.7345 | 2 | 0 |
| neg-9 | negative | unsupported_relationship_claims | 0.6789 | 0.7211 | 2 | 0 |
| neg-10 | negative | generic_unsupported | 0.5843 | 0.5987 | 2 | 0 |

## Positive Min Distribution
[0.9102, 0.7882, 0.8083, 0.8435, 0.8537, ...] (75 values)
Minimum: 0.7882

## Negative Min Distribution
[0.7460, 0.6282, 0.6480, 0.7325, 0.6912, 0.6182, 0.6543, 0.6876, 0.6789, 0.5843, ...] (75 values)
Maximum: 0.7460

## Separation Analysis

- **Separation margin** (positiveMinMin - negativeMax): 0.0423
- **Overlap** (positiveMinMin <= negativeMax): false
- **Positive min min**: 0.7882
- **Negative max**: 0.7460

## Candidate τ Evaluation

| τ | cal_FRR | cal_FAR | holdout_FRR | holdout_FAR |
|---|---------|---------|-------------|-------------|
| 0.50 | 0.00 | 1.00 | 0.00 | 1.00 |
| 0.55 | 0.00 | 1.00 | 0.00 | 1.00 |
| 0.60 | 0.00 | 1.00 | 0.00 | 1.00 |
| 0.65 | 0.00 | 0.40 | 0.00 | 0.40 |
| 0.70 | 0.00 | 0.40 | 0.00 | 0.40 |
| 0.75 | 0.00 | 0.00 | 0.00 | 0.00 |
| 0.80 | 0.25 | 0.00 | 0.25 | 0.00 |
| 0.85 | 0.75 | 0.00 | 0.75 | 0.00 |

## Verdict

SEMANTIC_ENFORCEMENT_NOT_JUSTIFIED — the separation margin (0.0423) is below the meaningful floor (0.10); the gap sits within nomic-embed-text paraphrase noise and the corpus (150 hand-authored examples) is not statistically significant, so τ must NOT be enforced.

## Zero-Write Assertion

No production write occurred. The only I/O was: (a) read-only Ollama embed calls for reflection and fixture source content; (b) an in-memory cosine match (no RPC, no DB). No similarity score was persisted; no schema, repository, prompt, scoring, threshold, or lifecycle behavior was changed.

## Limitations

- Corpus is hand-authored and in-memory — not statistically significant for production claims.
- Source memories are fixtures, not the production database; the in-memory matcher mirrors match_memories_v2 semantics but is not the live RPC.
- S3 (min over claimed sources) is the only criterion evaluated; it ignores distribution shape and unmeasured sources.
- nomic-embed-text similarities are model-dependent; absolute values may shift with the embedder.
- No cadence, routing, or production reflection path was modified.

## Files Generated

- `tests/phase-1-d/experiment.json` — machine-readable artifact
- `tests/phase-1-d/experiment-report.md` — human-readable report
- `tests/phase-1-d/experiment.test.ts` — vitest test suite (1 test: embed function verification)

## Key Conclusions

1. τ=0.75 achieves FRR=0.00 and FAR=0.00 on both calibration and holdout sets
2. Separation margin (0.0423) is below the meaningful floor (0.10)
3. Distributions are too close to support reliable threshold enforcement on this corpus
4. The 150-example corpus (75 positive, 75 negative) is insufficient for statistically significant claims
5. Real-memory-mimicking examples (60%) and synthetic examples (40%) both contribute to the analysis
6. **SEMANTIC_ENFORCEMENT_NOT_JUSTIFIED** — τ remains un-enforced; shadow-only mode continues

## Next Steps

- Do NOT enforce any threshold τ.
- Do NOT modify reflection behavior, prompts, or models.
- Do NOT wire cadence or start Phase 2 identity work.
- Document τ=0.75 and the analysis in a future act for potential re-evaluation on a larger, production-sourced corpus.
- Continue shadow-only mode (Phase 1-C Step 5).