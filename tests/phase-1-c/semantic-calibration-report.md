# Phase 1-C Step 6 — Semantic Grounding Threshold Calibration

ZERO-WRITE experiment. Observational only. τ is NOT enforced.

- Corpus total: 9
- Positive: 4
- Negative: 5
- Repeat count: 3
- Embed model: nomic-embed-text:latest (768-dim)
- Matcher: in-memory cosine mirror of read-only match_memories_v2 (threshold 0, top-K 200)

## Similarity observations (S3 = min similarity over claimed sources)

| id | label | style | min | mean | measured | unmeasured |
|----|-------|-------|-----|------|----------|------------|
| P1 | positive | repeated_pattern | 0.9102 | 0.9120 | 2 | 0 |
| P2 | positive | relationship | 0.7882 | 0.8288 | 2 | 0 |
| P3 | positive | change_over_time | 0.8083 | 0.8089 | 2 | 0 |
| P4 | positive | contradiction | 0.8435 | 0.8543 | 2 | 0 |
| N1 | negative | identical_to_source | 0.7460 | 0.8730 | 2 | 0 |
| N2 | negative | single_source_paraphrase | 0.6282 | 0.8141 | 2 | 0 |
| N3 | negative | unrelated_source_pairing | 0.6480 | 0.7140 | 2 | 0 |
| N4 | negative | topically_similar_unsupported_inference | 0.7325 | 0.7602 | 2 | 0 |
| N5 | negative | generic_unsupported | 0.6097 | 0.6269 | 2 | 0 |

## Positive min distribution
[0.9102, 0.7882, 0.8083, 0.8435]

## Negative min distribution
[0.7460, 0.6282, 0.6480, 0.7325, 0.6097]

## Candidate τ evaluation

| τ | posFR | negFA | FRR | FAR | zeroFR |
|---|-------|-------|-----|-----|--------|
| 0.5 | 0 | 5 | 0.00 | 1.00 | true |
| 0.55 | 0 | 5 | 0.00 | 1.00 | true |
| 0.6 | 0 | 5 | 0.00 | 1.00 | true |
| 0.65 | 0 | 2 | 0.00 | 0.40 | true |
| 0.7 | 0 | 2 | 0.00 | 0.40 | true |
| 0.75 | 0 | 0 | 0.00 | 0.00 | true |
| 0.8 | 1 | 0 | 0.25 | 0.00 | false |
| 0.85 | 3 | 0 | 0.75 | 0.00 | false |

## Separation analysis

- Selected τ (highest with zero false rejections): 0.75
- Overlap (positiveMinMin <= negativeMax): false
- Separation margin (positiveMinMin - negativeMax): 0.0423
- False-acceptance rate at τ: 0.00
- False-rejection rate at τ: 0.00
- Unmeasured cases: 0
- Enforcement justified: false

## Verdict

SEMANTIC_ENFORCEMENT_NOT_JUSTIFIED — the separation margin (0.0423) is below the meaningful floor (0.1); the gap sits within nomic-embed-text paraphrase noise and the corpus (9 hand-authored examples) is not statistically significant, so τ must NOT be enforced.

## Zero-write assertion

No production write occurred. The only I/O was: (a) read-only Ollama embed calls for reflection and fixture source content; (b) an in-memory cosine match (no RPC, no DB). No similarity score was persisted; no schema, repository, prompt, scoring, threshold, or lifecycle behavior was changed.

## Limitations

- Corpus is small (hand-authored, in-memory) — not statistically significant.
- Source memories are fixtures, not the production database; the in-memory matcher mirrors match_memories_v2 semantics but is not the live RPC.
- S3 (min over claimed sources) is the only criterion evaluated; it ignores distribution shape and unmeasured sources.
- nomic-embed-text similarities are model-dependent; absolute values may shift with the embedder.
- No cadence, routing, or production reflection path was modified.
