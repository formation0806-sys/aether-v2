# Phase 6-AO-V15 — Embedding Model Diagnostic / Error-Boundary Analysis Report

**Status:** `COMPLETE`
**Mode:** Read-only diagnostic. Zero-write to production. **DB_WRITES: 0.**
**Recorded:** 2026-08-31 · harness `tests/phase-6-ao/v15-error-boundary-diagnostic.test.ts`
result `tests/phase-6-ao/results/v15-error-boundary-diagnostic.json`

## 1. Scientific question

Why does the best tested configuration (mxbai-embed-large:latest + "query: " prefix)
stop at TP=18 instead of the required TP=19 for the +15pp promotion gate?

## 2. Outcome — `V15 = COMPLETE`

The diagnostic completed without running new embeddings. It analyzed the existing V13/V14
artifacts and produced a forensic classification of the remaining recall gap.

```
STATUS = COMPLETE
REMAINING_TP_GAP = 1
H1 = CONFIRMED
H2 = CONFIRMED
H3 = RULED_OUT
H4 = CONFIRMED
H5 = INCONCLUSIVE
H6 = INCONCLUSIVE
```

## 3. Verified Artifact Metrics

| Metric | V11 | V13 | V14 |
|---|---|---|---|
| TP | 15 | 17 | 18 |
| Fixed recall | 68.18% | 77.27% | 81.82% |
| Recall gain vs baseline | — | +9.09pp | +13.64pp |
| FCR | 0% | 0% | 0% |
| Repeatability | PASS | PASS | PASS |

V14 fidelity check: PASS (bare-text mxbai reproduced V13 TP=17 exactly).
V14 overall gate: FAIL (recall gain +13.64pp < required +15pp).

## 4. Remaining False Negatives (V14)

| pairId | factKey | V14 similarity | Distance to 0.85 | Failure mode |
|---|---|---|---|---|
| pair-005 | programming-language | 0.821145 | +0.028855 | RETRIEVAL_ELIGIBILITY |
| pair-007 | project | 0.837367 | +0.012633 | RETRIEVAL_ELIGIBILITY |
| pair-011 | technology-preference | 0.865164 | -0.015164 | VERIFIER_DECISION |
| pair-034 | tools | 0.865992 | -0.015992 | VERIFIER_DECISION |

The 1 TP gap is split:
- 2 pairs below 0.85 (embedding geometry floor)
- 2 pairs eligible but verifier-rejected (frozen SYS_V5)

## 5. Similarity Movement Analysis

### SAME pairs (22)

| Statistic | Value |
|---|---|
| Mean delta (V14 vs V13) | +0.017126 |
| Median delta (V14 vs V13) | +0.016615 |
| Max positive delta | +0.032062 (pair-013) |
| Max negative delta | -0.002679 (pair-011) |

### DIFFERENT pairs (21)

| Statistic | Value |
|---|---|
| Mean delta (V14 vs V13) | +0.034903 |
| Median delta (V14 vs V13) | +0.037855 |
| Max positive delta | +0.086343 (pair-032) |
| Max negative delta | -0.029484 (pair-036) |

The prefix produced a general distributional upward shift for both SAME and DIFFERENT pairs.

## 6. Boundary Analysis

### SAME pairs by band

| Band | V11 | V13 | V14 |
|---|---|---|---|
| <0.80 | 2 | 0 | 0 |
| 0.80–<0.85 | 4 | 3 | 2 |
| 0.85–<0.90 | 16 | 10 | 4 |
| >=0.90 | 0 | 9 | 16 |

### DIFFERENT pairs by band

| Band | V11 | V13 | V14 |
|---|---|---|---|
| <0.80 | 11 | 15 | 10 |
| 0.80–<0.85 | 6 | 4 | 6 |
| 0.85–<0.90 | 4 | 2 | 5 |
| >=0.90 | 0 | 0 | 0 |

V14 shifted SAME pairs strongly toward higher similarity bands while also shifting
some DIFFERENT pairs upward. No DIFFERENT pair reached >=0.90 under V14.

## 7. Safety Analysis

Max DIFFERENT similarity under V14: 0.875855 (pair-042, project-management)
- pair-042 was already eligible under baseline (0.870898)
- Verdict: DIFFERENT (correct)

Newly eligible DIFFERENT pairs under V14:
- pair-002: 0.856616 → DIFFERENT verdict (correct)
- pair-024: 0.864874 → DIFFERENT verdict (correct)
- pair-028: 0.859088 → DIFFERENT verdict (correct)
- pair-032: 0.869871 → DIFFERENT verdict (correct)
- pair-042: 0.875855 → DIFFERENT verdict (correct)

FP count = 0. FCR = 0%. Safety remains robust.

## 8. Verifier Analysis

The verifier (SYS_V5, qwen2.5:3b) returned DIFFERENT on 2 eligible SAME pairs in both V13 and V14:
- pair-011 (technology-preference): eligible in both, verdict=DIFFERENT
- pair-034 (tools): eligible in both, verdict=DIFFERENT

Verifier behavior is identical across V13 and V14. The prefix does not change verifier outcomes.
These are a confounding factor, not an addressable variable.

## 9. Hypothesis Classification

| Hypothesis | Status | Evidence |
|---|---|---|
| H1: embedding similarity below 0.85 | CONFIRMED | pair-005 (0.821145), pair-007 (0.837367) remain below threshold |
| H2: verifier rejects eligible SAME | CONFIRMED | pair-011, pair-034 eligible but verdict=DIFFERENT |
| H3: prefix doesn't separate SAME/DIFFERENT | RULED_OUT | FCR=0%, no DIFFERENT pairs got SAME verdict |
| H4: gap concentrated in factKeys | CONFIRMED | remaining misses in programming-language, project, technology-preference, tools |
| H5: dataset evaluator disagreement | INCONCLUSIVE | cannot determine from artifacts alone |
| H6: other embedding configuration issue | INCONCLUSIVE | no other configuration tested |

## 10. Scientific Conclusion

The best tested configuration (mxbai-embed-large:latest + "query: " prefix) stops at TP=18
because the remaining 1 TP gap is split between:

1. Two SAME pairs (pair-005, pair-007) with embedding similarity below 0.85 despite the
   recommended prefix. These represent an embedding geometry floor.
2. Two SAME pairs (pair-011, pair-034) that are eligible but rejected by the frozen SYS_V5
   verifier. These represent a verifier-layer constraint.

The prefix provided a general distributional improvement (20/22 SAME pairs improved, mean
delta +0.017) but did not push the two geometrically hard pairs above 0.85. No further
embedding configuration has been tested or hypothesized that would recover the missing
0.013–0.029 similarity without changing a frozen constraint.

The promotion gate (TP >= 19, recall gain >= +15pp) is not attainable under the current
frozen constraints with the tested candidate.

## 11. Production Safety

Production remains unchanged:
- embedding = nomic-embed-text:latest
- threshold = 0.85
- verifier = qwen2.5:3b
- SYS_V5 = b999aa8f...93e2d

No adoption is authorized.
No migration is authorized.
No dataset change is authorized.

## 12. Next Steps

If a future milestone wishes to pursue this path, it must address one of:
- A new evidence-backed hypothesis for embedding configuration changes that specifically
  targets the remaining hard pairs (pair-005, pair-007)
- OR a verifier audit (separate milestone with separate scientific question)
- OR a threshold re-examination (requires formal closure of V11 and reopening with new
  evidence — a major scientific event)
- OR a new embedding model with demonstrated superior performance on this specific dataset
  (requires installation approval and full V13-style evaluation)
