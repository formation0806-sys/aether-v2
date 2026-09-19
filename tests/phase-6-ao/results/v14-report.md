# Phase 6-AO-V14 — Embedding Model Evaluation with Query Prefix Report

**Status:** `FAIL`
**Mode:** Measurement only. Zero-write to production. **DB_WRITES: 0.**
**Recorded:** 2026-08-31 · harness `tests/phase-6-ao/v14-embedding-prefix-evaluation.test.ts`
result `tests/phase-6-ao/results/v14-embedding-prefix-evaluation.json`

## 1. Scientific question

Does applying the model-recommended query prefix (`"query: "`) to `mxbai-embed-large:latest`
inputs improve SAME-pair retrieval at the FIXED production identity boundary 0.85 (SYS_V5
verifier) compared to bare-text drop-in (V13)?

The ONLY experimental variable is the input prefix; everything else (dataset, SYS_V5,
threshold 0.85, candidate count 8, verifier options) is frozen.

## 2. Outcome — `V14 = FAIL`

The harness ran cleanly through all stages:

```
STATUS = COMPLETE
FIDELITY = PASS (bare-text TP=17, matches V13)
PREFIX EXPERIMENT = MEASURED
OVERALL GATE = FAIL
```

## 3. Metrics

| Metric | V13 (bare) | V14 (prefix) | Delta |
|---|---|---|---|
| TP | 17 | 18 | +1 |
| TN | 2 | 5 | +3 |
| FP | 0 | 0 | 0 |
| FN | 2 | 2 | 0 |
| Fixed recall | 77.27% | 81.82% | +4.55pp |
| Recall gain vs baseline | +9.09pp | +13.64pp | +4.55pp |
| FCR | 0% | 0% | 0% |
| Repeatability | PASS | PASS | — |

## 4. Gate results

| Gate | V13 | V14 | Result |
|---|---|---|---|
| GATE_RECALL | FAIL | FAIL | FAIL |
| GATE_SAFETY | PASS | PASS | PASS |
| GATE_REPEATABILITY | PASS | PASS | PASS |
| **OVERALL** | **FAIL** | **FAIL** | **FAIL** |

Recall gain required: >= +15pp
V14 recall gain: +13.64pp
Shortfall: -1.36pp (equivalent to ~0.3 TP)

## 5. Pair-level analysis

### Pairs that improved with prefix

- **pair-041** (project-management, SAME): baseline 0.768679 → bare 0.843301 → prefixed **0.861730**
  - This pair crossed the 0.85 threshold with the prefix, contributing +1 TP.
- **pair-005** (programming-language, SAME): baseline 0.764026 → bare 0.807088 → prefixed **0.821145**
  - Improved but still below 0.85.
- **pair-007** (project, SAME): baseline 0.804500 → bare 0.806107 → prefixed **0.837367**
  - Improved but still below 0.85.

### Pairs that remain below 0.85 under prefix

- pair-005: 0.821145 (SAME, below threshold)
- pair-007: 0.837367 (SAME, below threshold)

### Verifier outcomes

The verifier (SYS_V5) returned DIFFERENT on 2 eligible SAME pairs, identical to V13:
- pair-011: eligible, verdict=DIFFERENT
- pair-034: eligible, verdict=DIFFERENT

The verifier also returned DIFFERENT on 2 eligible DIFFERENT pairs (correct):
- pair-024: eligible, verdict=DIFFERENT
- pair-028: eligible, verdict=DIFFERENT
- pair-032: eligible, verdict=DIFFERENT

Wait, let me check the actual V14 artifact for the verifier outcomes... Looking at the JSON:
- pair-011: verdict=DIFFERENT (SAME pair)
- pair-034: verdict=DIFFERENT (SAME pair)
- pair-024: verdict=DIFFERENT (DIFFERENT pair) - correct
- pair-028: verdict=DIFFERENT (DIFFERENT pair) - correct
- pair-032: verdict=DIFFERENT (DIFFERENT pair) - correct

So 5 eligible pairs got DIFFERENT verdict: 2 on SAME pairs (FN), 3 on DIFFERENT pairs (TN).
Plus 1 new DIFFERENT pair that became eligible (pair-002 in V14? Let me check).

Actually, looking at the V14 artifact pairs:
- pair-002: DIFFERENT, candidateSimilarity=0.856616, eligible=YES, verdict=DIFFERENT
- pair-024: DIFFERENT, candidateSimilarity=0.864874, eligible=YES, verdict=DIFFERENT
- pair-028: DIFFERENT, candidateSimilarity=0.859088, eligible=YES, verdict=DIFFERENT
- pair-032: DIFFERENT, candidateSimilarity=0.869871, eligible=YES, verdict=DIFFERENT
- pair-042: DIFFERENT, candidateSimilarity=0.875855, eligible=YES, verdict=DIFFERENT

So 5 DIFFERENT pairs are eligible under prefix, and all got DIFFERENT verdict (all correct).

Wait, but the run metrics say:
- verifierSame: 18
- verifierDifferent: 7
- verifierUncertain: 0
- verifierRuns: 25

So 18 SAME verdicts and 7 DIFFERENT verdicts out of 25 verifier runs.
TP = 18 (SAME pairs with SAME verdict)
TN = 5 (DIFFERENT pairs with DIFFERENT verdict)
FN = 2 (SAME pairs with DIFFERENT verdict: pair-011, pair-034)
FP = 0 (no DIFFERENT pairs with SAME verdict)

This matches.

## 6. Band analysis

Newly promoted band cells (eligible under candidate, not under baseline):
- pair-013 (SAME): candidate 0.958759, agreement 20/20
- pair-039 (SAME): candidate 0.929731, agreement 20/20
- pair-034 (SAME): candidate 0.865992, agreement 20/20 (but modal=DIFFERENT)
- pair-024 (DIFFERENT): candidate 0.864874, agreement 20/20
- pair-041 (SAME): candidate 0.861730, agreement 20/20
- pair-002 (DIFFERENT): candidate 0.856616, agreement 20/20

6 band cells total, all with 20/20 agreement. Repeatability PASS.

## 7. What changed from V13

The query prefix:
- Improved similarities for most SAME pairs
- Specifically pushed pair-041 above 0.85 (the key +1 TP gain)
- Did NOT push pair-005 or pair-007 above 0.85
- Did NOT change verifier behavior on pair-011 or pair-034

The prefix provided measurable benefit but insufficient to close the recall gap.

## 8. Remaining gap analysis

Current: TP = 18, fixed recall = 81.82%, gain = +13.64pp
Gate requires: TP >= 19, gain >= +15pp
Gap: -1 TP, -1.36pp

To reach TP=19, one of the following must happen:
1. pair-005 or pair-007 crosses 0.85 (requires different model or different prefix)
2. Verifier changes behavior on pair-011 or pair-034 (frozen, not addressable)
3. A different embedding model is tried

## 9. Conclusion

V14 demonstrated that the query prefix provides a measurable benefit (+1 TP, +4.55pp recall gain)
but does not close the promotion gap. The prefix-assisted mxbai embedding is still insufficient
at the frozen 0.85 threshold with the SYS_V5 verifier.

Production remains unchanged:
- embedding = nomic-embed-text:latest
- threshold = 0.85
- verifier = qwen2.5:3b
- SYS_V5 = b999aa8f...93e2d

No adoption is authorized by this result.
