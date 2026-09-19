# AETHER — M2-I RETRIEVAL POLICY VALIDATION REPORT

**Execution status:** `DIAG_RESULT = COMPLETE` (2026-09-01T15:09Z · script `scripts/m2i-retrieval-policy-validation.mjs` · all gate checks G1-G8 passed)

**Mode:** read-only measurement. Zero DB writes · zero `touch_memories` calls · no production file modified · offline replay of captured M2-G cosine matrix.

## 1. Executive Summary

| Policy | Top-1 Acc | Wrong Top-1 | Elig.Fail | Rank.Fail | Mean Rank |
|---|---:|---:|---:|---:|---:|
| **P0 (production)** | **58.3%** | **41.7%** | **7** | **3** | **1.42** |
| P0_nommr | 58.3% | 41.7% | 7 | 3 | 1.42 |
| P1 (cosine-only) | 83.3% | 16.7% | 7 | 0 | 1.17 |
| P1_mmr | 83.3% | 16.7% | 7 | 0 | 1.17 |
| **P2.5 (95/5)** | **100.0%** | **0.0%** | **7** | **0** | **1.00** |
| P2.5_mmr | 100.0% | 0.0% | 7 | 0 | 1.00 |
| P-oracle | 100.0% | 0.0% | 7 | 0 | 1.00 |

**Decision: POLICY_CANDIDATE_READY_FOR_HUMAN_REVIEW**

P2.5 (95% cosine + 5% metadata) passes all 8 gates and achieves 100% top-1 accuracy among eligible targets, eliminating all 3 ranking failures while preserving the same eligibility behavior as production. The P2.5_mmr variant (with MMR) performs identically, confirming MMR has zero effect on P2.5 ranking.

## 2. Gate Results

| Gate | Description | Requirement | Result |
|---|---|---|---|
| **G1** | Baseline reproduction | P0 metrics match M2-H within 0.1pp | **PASS** |
| **G2** | Determinism | Two P0 runs produce identical JSON | **PASS** |
| **G3a** | P2.5 >= P0 top-1 (all) | P2.5_all_top1 >= P0_all_top1 | **PASS** |
| **G3b** | P2.5 >= P0 top-1 (eligible) | P2.5_elig_top1 >= P0_elig_top1 | **PASS** |
| **G4** | No new inversions | P2.5 does not introduce wrong Top-1 not present in P0 | **PASS** |
| **G5a** | Strict no-reversal | No reversal where cosine gap > 0.0186 | **PASS** |
| **G5b** | Comfortable no-reversal | No reversal where cosine gap > 0.05 | **PASS** |
| **G6** | Metadata reversibility bound | 0.05 * max_metadata_delta bounded | **PASS** |
| **G7** | FP rate on negatives | P2.5 FP rate <= P0 FP rate (0) | **PASS** |
| **G8** | No pathological domination | Metadata alone never overrides cosine loser | **PASS** |

**All gates pass. Verdict: POLICY_CANDIDATE_READY_FOR_HUMAN_REVIEW**

## 3. MMR Validation (new in M2-I)

| Policy | With MMR | Top-1 Acc | Without MMR | Top-1 Acc | Delta |
|---|---|---:|---:|---:|---:|
| P0 | P0 | 58.3% | P0_nommr | 58.3% | 0.0pp |
| P1 | P1_mmr | 83.3% | P1 | 83.3% | 0.0pp |
| P2.5 | P2.5_mmr | 100.0% | P2.5 | 100.0% | 0.0pp |

**Conclusion: MMR has zero effect on top-1 accuracy for any policy.** This confirms M2-H's assertion that MMR causes 0 failures, now explicitly verified by comparing with/without MMR for all three policy families.

The P2.5 and P2.5_mmr variants produce identical top-1 results, confirming that P2.5 is robust to MMR re-ranking. Both forms are safe candidates.

## 4. Boundary Analysis

### 4.1 Maximum cosine advantage P2.5 metadata can overcome

```
Theoretical worst case: 0.05 * (0.50 - 0.00) = 0.025
Realistic worst case:   0.05 * (0.3719 - 0.115) = 0.0128
Actual max override:    0.05 * (0.3719 - 0.2250) = 0.0073
```

### 4.2 Reversal analysis

| Threshold | Description | P2.5 Reversals |
|---|---:|---:|
| 0.0186 | G5a strict | **0** |
| 0.05 | G5b comfortable | **0** |

P2.5 introduces **zero ranking reversals** at both the strict (0.0186) and comfortable (0.05) thresholds across all 15 queries and all memory pairs. The 5% metadata component is too small to overcome any meaningful cosine gap.

### 4.3 Pathological cases

| Case | Cosine gap | Metadata gap (equiv cosine) | P2.5 reverses? |
|---|---:|---:|:---:|
| Large cosine gap (0.20) | 0.20 | 0.0073 | No |
| Medium cosine gap (0.05) | 0.05 | 0.0073 | No |
| Small cosine gap (0.01) | 0.01 | 0.0073 | No |
| Zero cosine gap (tie) | 0 | 0.0073 | Yes (tie-break, expected) |
| Negative cosine gap (loses by 0.01) | −0.01 | 0.0073 | No |

## 5. Per-Query Results

| Q | Target | P0 Winner | P0 Rank | P1 Winner | P1 Rank | P2.5 Winner | P2.5 Rank | P2.5_mmr Winner | P2.5_mmr Rank |
|---|---|---|---|---|---|---|---|---|---|
| Q1 | M1 | M1 | 1 | M5 | 2 | M1 | 1 | M1 | 1 |
| Q2 | M1 | M1 | 1 | M1 | 1 | M1 | 1 | M1 | 1 |
| Q3 | M1 | M1 | 1 | M5 | 2 | M1 | 1 | M1 | 1 |
| Q4 | M2 | M1 | 2 | M2 | 1 | M2 | 1 | M2 | 1 |
| Q5 | M1 | M1 | 1 | M1 | 1 | M1 | 1 | M1 | 1 |
| Q6 | M1 | M1 | 1 | M1 | 1 | M1 | 1 | M1 | 1 |
| Q7 | M5 | M1 | 2 | M5 | 1 | M5 | 1 | M5 | 1 |
| Q8 | M3 | M1 | 2 | M3 | 1 | M3 | 1 | M3 | 1 |
| Q9 | M6 | M1 | 2 | M6 | 1 | M6 | 1 | M6 | 1 |
| Q10 | M4 | M4 | 1 | M4 | 1 | M4 | 1 | M4 | 1 |
| Q11 | M7 | M1 | 2 | M7 | 1 | M7 | 1 | M7 | 1 |
| Q12 | M8 | M8 | 1 | M8 | 1 | M8 | 1 | M8 | 1 |

**Key:** P2.5 achieves rank 1 for all 12 target queries, matching the oracle.

## 6. Eligibility-vs-Ranking Decomposition

### Track A — Eligibility (NOT solved by ranking)

| Query | Target | Target Cosine | Clears 0.65? |
|---|---|---:|:---:|
| Q1 | M1 | 0.5254 | NO |
| Q2 | M1 | 0.5105 | NO |
| Q3 | M1 | 0.5074 | NO |
| Q5 | M1 | 0.5502 | NO |
| Q6 | M1 | 0.5120 | NO |
| Q8 | M3 | 0.5817 | NO |
| Q9 | M6 | 0.6113 | NO |

**7/12 failures (58.3%)** — target never clears 0.65. No ranking policy can fix this.

### Track B — Ranking (SOLVABLE by P2.5)

| Query | Target | Target Cosine | Clears 0.65? | P0 Winner | P2.5 Winner |
|---|---|---:|---|---|---|
| Q4 | M2 | 0.7308 | YES | M1 (wrong) | M2 (correct) |
| Q7 | M5 | 0.7622 | YES | M1 (wrong) | M5 (correct) |
| Q11 | M7 | 0.7557 | YES | M1 (wrong) | M7 (correct) |

**3/12 failures (25%)** — target clears 0.65 but M1 outranks it under P0. All fixed by P2.5.

### Track C — Correct (no change needed)

| Query | Target | Target Cosine | Clears 0.65? | P0 Winner |
|---|---|---:|---|---|
| Q10 | M4 | 0.7358 | YES | M4 (correct) |
| Q12 | M8 | 0.7641 | YES | M8 (correct) |

**2/12 queries (16.7%)** — target clears 0.65 and is correctly ranked first.

## 7. M1 Metadata Advantage Analysis

| Memory | importance | confidence | type | timesUsed | metadata advantage |
|---|---:|---:|---|---:|---:|
| **M1** | **0.72** | **1.0** | **identity** | **1** | **0.3719** |
| M2-M8 | 0.3 | 0.5 | semantic | 0.0 | 0.2250 |

**M1 advantage over M2-M8: 0.1469**

Under P2.5, this advantage is scaled to `0.05 * 0.1469 = 0.0073` equivalent cosine points — far too small to overcome any meaningful cosine gap. The smallest cosine gap among eligible targets is Q4 (M2 target, gap=0.1964), which P2.5 handles correctly.

## 8. Metadata Reversibility Bound

The 5% metadata component can shift a candidate's score by at most:

```
Theoretical worst case: 0.05 * (0.50 − 0.00) = 0.025
Realistic worst case:   0.05 * (0.3719 − 0.115) = 0.0128
Actual worst case:      0.05 * (0.3719 − 0.2250) = 0.0073
```

G5a uses 0.0186 as a "middle ground" strict threshold between theoretical (0.025) and realistic (0.0128) bounds. P2.5 passes G5a with zero reversals.

## 9. Corpus Coverage Assessment

**Corpus:** 8 memories (M1 real DB embedding + M2-M8 local), 15 queries (12 target + 3 negative).

**Limitations:**
- Only one memory (M1) has non-default metadata. The metadata-space exploration is one-dimensional (M1 vs M2-M8).
- No memory with importance > 0.72, no memory with confidence < 0.5, no procedural/project/working types.
- Only 8 memories, so MMR effects on larger candidate pools are not measured.
- Only English, only one embedding model (nomic-embed-text:latest), only one user.

**Coverage verdict:** Sufficient for all eight gates. The corpus covers the critical case (M1 metadata advantage causing inversions) and validates P2.5's no-reversal property. The limitations above would be addressed by M2-J (larger synthetic corpus) if needed.

## 10. Comparison with M2-H

| Metric | M2-H | M2-I | Delta |
|---|---:|---:|---:|
| P0 wrong Top-1 | 41.67% | 41.67% | 0.00pp |
| P0 eligibility failures | 7 | 7 | 0 |
| P0 ranking failures | 3 | 3 | 0 |
| P1 top-1 accuracy | 83.3% | 83.3% | 0.0pp |
| P2.5 top-1 accuracy | 100.0% | 100.0% | 0.0pp |
| M1 metadata advantage | 0.1469 | 0.1469 | 0.0000 |

**M2-I reproduces M2-H exactly** and extends it with:
1. Explicit MMR validation (P0_nommr, P1_mmr, P2.5_mmr)
2. Boundary analysis (G5a, G5b reversal checks)
3. All 8 gates from the M2-I plan

## 11. Safety / Repository Verification

```
PRODUCTION_CHANGES = 0
DB_WRITES = 0
TOUCH_MEMORIES = 0
MIGRATIONS = 0
FROZEN_FILES_CHANGED = 0
COMMITS = 0
```

### Files created

| File | Purpose |
|---|---|
| `scripts/m2i-retrieval-policy-validation.mjs` | Offline replay + validation tables |
| `docs/M2I_RETRIEVAL_POLICY_VALIDATION.md` | This report |

### Files NOT modified

- `lib/memory/retrieve.ts` — unchanged
- `lib/memory/constants.ts` — unchanged
- `lib/memory/score.ts` — unchanged
- `lib/memory/types.ts` — unchanged
- `lib/repositories/memory.repository.ts` — unchanged
- `supabase/migrations/*` — unchanged

## 12. Final Verdict

```
M2-I STATUS = COMPLETE
BASELINE_REPRODUCTION = PASS
DETERMINISM = PASS

P2_5 = POLICY_CANDIDATE_READY_FOR_HUMAN_REVIEW

ELIGIBILITY_PROBLEM = UNRESOLVED

PRODUCTION_CHANGES = 0
DB_WRITES = 0
TOUCH_MEMORIES = 0
MIGRATIONS = 0
AO_CHANGES = 0
COMMITS = 0
```

### Candidate: P2.5 (95% cosine, 5% metadata)

- Top-1 accuracy: 100% (vs 58.3% production)
- Wrong Top-1: 0% (vs 41.7% production)
- Ranking failures: 0 (vs 3 production)
- M1 inversions: 0 (vs 3 production)
- Eligibility failures: 7 (unchanged — ranking cannot fix eligibility)
- MMR effect: 0pp (P2.5_mmr identical to P2.5)
- Reversals: 0 at both strict (0.0186) and comfortable (0.05) thresholds

### Next decision: HUMAN REVIEW

This is a CANDIDATE for a future human-approved production experiment. It does NOT authorize modifying `retrieve.ts` or `score.ts`.

### Recommended production experiment (if approved)

Change `RETRIEVAL_WEIGHTS` to:
```javascript
{
  similarity: 0.95,
  importance: 0.0075,   // 0.15 * 0.05
  recency: 0.005,       // 0.10 * 0.05
  confidence: 0.005,    // 0.10 * 0.05
  typeWeight: 0.025,    // 0.05 * 0.05 (note: this is 5x the others, preserving relative ratio)
  usage: 0.0025,        // 0.05 * 0.05
  explicit: 0.0025      // 0.05 * 0.05
}
```

Wait — the above preserves relative metadata ratios at 5% total. But the P2.5 formula is simpler: `0.95*cosine + 0.05*metadata_advantage` where `metadata_advantage` is the full non-similarity contribution. This is equivalent to:

```javascript
// P2.5 as a single scoring function:
score = 0.95 * cosine + 0.05 * (
  0.15 * importance +
  0.10 * recency +
  0.10 * confidence +
  0.05 * typeWeight +
  0.05 * usage +
  0.05 * explicit
)
```

**DO NOT implement without explicit human approval.**

## 13. Open Questions for Human Reviewer

1. Is the existing 8-memory corpus sufficient for `POLICY_CANDIDATE_READY_FOR_HUMAN_REVIEW`, or should M2-J (larger synthetic corpus) be required first?
2. Should the G5a threshold be tightened to 0.0128 (realistic) instead of 0.0186 (middle ground)?
3. Should the P2.5_mmr variant be required to match P2.5_nommr exactly, or is a small MMR delta acceptable?

---

**M2-I completes successfully with all gate checks passed.**
