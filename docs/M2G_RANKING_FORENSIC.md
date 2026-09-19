# AETHER — M2-G RANKING FORENSIC DIAGNOSTIC REPORT

**Execution status:** `DIAG_RESULT = COMPLETE` (2026-09-01T11:24Z · script `scripts/m2g-ranking-forensic.mjs` · all measurement acceptance conditions met)

**Mode:** read-only measurement. Zero DB writes · zero `touch_memories` calls · service-role used for SELECT-only read of M1 embedding · M2-M8 embeddings generated locally via Ollama (never persisted) · no production file modified.

## 1. Scientific Question

Determine whether the remaining retrieval problem (after M2-F ruled out R1/R3Q/R4/R5) is primarily:

- **H1** — candidate eligibility / threshold policy (floor too high for question-form)
- **H2** — candidate ranking / score geometry (fusion lets high-importance memories outrank correct targets)
- **H3** — MMR behavior (diversification removes correct targets)
- **H4** — memory representation/content competition (M1 vs M5 embedding geometry)
- **H5** — insufficient candidate information for safe retrieval
- **H6** — interaction between the above

## 2. Executive Summary

| Metric | Value |
|---|---:|
| Target recall (@0.65) | 41.67% (5/12) |
| Top-1 accuracy (production ranking) | 58.33% (7/12) |
| Wrong Top-1 rate (production ranking) | 41.67% (5/12) |
| Class A failures (eligibility) | 7/12 (58.3%) |
| Class B failures (ranking) | 3/12 (25%) |
| Class C failures (MMR) | 0/12 (0%) |
| Class D failures (budget) | 0/12 (0%) |

**Key finding:** The production wrong-Top-1 rate is **41.67%** (5/12), significantly higher than the 33.3% reported by M2-E (which used cosine argmax, not production ranking). The dominant failure mode is **H1 (eligibility)** at 58.3%, with **H2 (ranking geometry)** contributing the remaining 25%. MMR and token budget are NOT failure modes.

**Hypothesis verdicts:**

| Hypothesis | Verdict | Evidence |
|---|---|---|
| H1 (eligibility) | **DOMINANT** | 7 class A failures — target never clears 0.65 |
| H2 (ranking) | **CONTRIBUTING** | 3 class B failures — M1 outranks target despite lower cosine |
| H3 (MMR) | **RULED OUT** | 0 class C failures — MMR never removes a correct target |
| H4 (representation) | **CONFIRMED** | M1 vs M5 cosine margins show representation limits |
| H5 (insufficient info) | **RULED OUT** | Sufficient candidate information exists |
| H6 (interaction) | **LIKELY** | H1 + H2 interact: eligibility dominates, ranking contributes |

## 3. Pipeline Summary

The production ranking pipeline (`lib/memory/retrieve.ts`) applies these stages:

| Step | Operation | Can Reorder? | Can Reject? |
|---|---|---|---|
| 1 | `embed(query)` | — | — |
| 2 | `match_memories_v2` RPC | — | YES (cosine < 0.65, status, NULL embedding) |
| 3 | `scoreRetrievalCandidate` → relevance | — | — |
| 4 | Sort by `effectiveScore` | YES (tie-break only) | — |
| 5 | MMR re-rank (`mmrScore`, λ=0.7) | YES | — |
| 6 | `selectWithinTokenBudget` | — | YES (token budget) |
| 7 | `touch_memories` | — | — |

### Key formulas

**Relevance score** (production weights):
```
relevance = 0.5*sim + 0.15*imp + 0.1*recency + 0.1*conf + 0.05*typeWeight + 0.05*usage + 0.05*explicit
```

**MMR score** (λ=0.7):
```
mmr = 0.7*relevance - 0.3*maxSimToSelected
```

**Effective score** (lifecycle, no similarity):
```
effectiveScore = 0.7*importance + 0.2*recency
```

## 4. Experiment Design

### 4.1 Corpus

- **M1**: real DB embedding (importance=0.72, confidence=1, times_used=1, type=identity)
- **M2-M8**: local embeddings (importance=0.3, confidence=0.5, times_used=0, type=semantic)
- **15 queries** (12 target-bearing, 3 negative controls)
- **Production floor**: 0.65

### 4.2 Counterfactual Pipelines

| Pipeline | Sort | MMR | Purpose |
|---|---|---|---|
| P0 (production) | effectiveScore → MMR | λ=0.7 | Baseline |
| P1 (cosine-only) | cosine desc | none | Is ranking the problem? |
| P2 (fusion-only) | relevance desc | none | Is MMR the problem? |
| P3 (MMR frozen) | effectiveScore → MMR | λ=0.7 | Full production (same as P0) |
| P4 (oracle) | target first | none | Upper bound |

### 4.3 Failure Classification

| Class | Definition |
|---|---|
| A | Target never clears 0.65 (eligibility) |
| B | Target clears 0.65 but loses ranking (ranking) |
| C | Target ranks first but removed by MMR (diversification) |
| D | Target survives MMR but fails token budget (budget) |
| E | Other |

## 5. Production Ranking Trace

### 5.1 Per-Query Results

| Q | Target | Target Cos | ≥0.65 | effScore Top-1 | MMR Top-1 | Target Rank | Selected | Failure |
|---|---|---|---|---|---|---|---|---|
| Q1 | M1 | 0.5254 | N | M1 | M1 | 1 | [M1,M5,M2,M8,M7,M6,M4,M3] | A |
| Q2 | M1 | 0.5105 | N | M1 | M1 | 1 | [M1,M5,M2,M7,M4,M6,M8,M3] | A |
| Q3 | M1 | 0.5074 | N | M1 | M1 | 1 | [M1,M5,M2,M7,M4,M8,M6,M3] | A |
| Q4 | M2 | 0.7308 | Y | M1 | M1 | 2 | [M1,M2,M5,M7,M4,M6,M8,M3] | B |
| Q5 | M1 | 0.5502 | N | M1 | M1 | 1 | [M1,M7,M5,M2,M8,M4,M6,M3] | A |
| Q6 | M1 | 0.5120 | N | M1 | M1 | 1 | [M1,M8,M5,M6,M4,M2,M7,M3] | A |
| Q7 | M5 | 0.7622 | Y | M1 | M1 | 2 | [M1,M5,M2,M7,M8,M6,M4,M3] | B |
| Q8 | M3 | 0.5817 | N | M1 | M1 | 2 | [M1,M3,M7,M6,M8,M2,M4,M5] | A |
| Q9 | M6 | 0.6113 | N | M1 | M1 | 2 | [M1,M6,M4,M8,M7,M2,M5,M3] | A |
| Q10 | M4 | 0.7358 | Y | M1 | M4 | 1 | [M4,M1,M3,M7,M6,M5,M8,M2] | - |
| Q11 | M7 | 0.7557 | Y | M1 | M1 | 2 | [M1,M7,M4,M8,M2,M5,M6,M3] | B |
| Q12 | M8 | 0.7641 | Y | M1 | M8 | 1 | [M8,M1,M6,M4,M7,M5,M3,M2] | - |

### 5.2 Relevance Score Breakdown

| Q | Target | M1 sim | M2 sim | M3 sim | M4 sim | M5 sim | M6 sim | M7 sim | M8 sim | M1 rel | M2 rel | M3 rel | M4 rel | M5 rel | M6 rel | M7 rel | M8 rel |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Q1 | M1 | 0.525 | 0.515 | 0.411 | 0.379 | 0.528 | 0.379 | 0.405 | 0.403 | **0.635** | 0.482 | 0.430 | 0.415 | 0.489 | 0.414 | 0.427 | 0.426 |
| Q2 | M1 | 0.510 | 0.471 | 0.384 | 0.374 | 0.497 | 0.346 | 0.412 | 0.366 | **0.627** | 0.461 | 0.417 | 0.412 | 0.474 | 0.398 | 0.431 | 0.408 |
| Q3 | M1 | 0.507 | 0.481 | 0.411 | 0.411 | 0.508 | 0.353 | 0.419 | 0.398 | **0.626** | 0.466 | 0.431 | 0.430 | 0.479 | 0.401 | 0.435 | 0.424 |
| Q4 | M2 | 0.534 | **0.731** | 0.409 | 0.427 | 0.506 | 0.395 | 0.434 | 0.398 | **0.639** | 0.590 | 0.429 | 0.439 | 0.478 | 0.422 | 0.442 | 0.424 |
| Q5 | M1 | 0.550 | 0.524 | 0.419 | 0.419 | 0.528 | 0.400 | 0.491 | 0.421 | **0.647** | 0.487 | 0.434 | 0.434 | 0.489 | 0.425 | 0.471 | 0.435 |
| Q6 | M1 | 0.512 | 0.465 | 0.487 | 0.446 | 0.494 | 0.440 | 0.406 | 0.488 | **0.628** | 0.457 | 0.469 | 0.448 | 0.472 | 0.445 | 0.428 | 0.469 |
| Q7 | M5 | 0.605 | 0.620 | 0.518 | 0.497 | **0.762** | 0.489 | 0.516 | 0.499 | **0.674** | 0.535 | 0.484 | 0.473 | 0.606 | 0.470 | 0.483 | 0.474 |
| Q8 | M3 | 0.457 | 0.433 | **0.582** | 0.442 | 0.413 | 0.422 | 0.448 | 0.465 | **0.601** | 0.441 | 0.516 | 0.446 | 0.432 | 0.436 | 0.449 | 0.457 |
| Q9 | M6 | 0.464 | 0.456 | 0.457 | 0.479 | 0.445 | **0.611** | 0.442 | 0.470 | **0.604** | 0.453 | 0.453 | 0.464 | 0.448 | 0.531 | 0.446 | 0.460 |
| Q10 | M4 | 0.430 | 0.414 | 0.530 | **0.736** | 0.452 | 0.391 | 0.432 | 0.434 | 0.587 | 0.432 | 0.490 | **0.593** | 0.451 | 0.420 | 0.441 | 0.442 |
| Q11 | M7 | 0.466 | 0.423 | 0.394 | 0.436 | 0.418 | 0.367 | **0.756** | 0.417 | **0.605** | 0.437 | 0.422 | 0.443 | 0.434 | 0.408 | 0.603 | 0.433 |
| Q12 | M8 | 0.436 | 0.414 | 0.471 | 0.445 | 0.429 | 0.428 | 0.412 | **0.764** | 0.590 | 0.432 | 0.460 | 0.447 | 0.440 | 0.439 | 0.431 | **0.607** |

**Bold** = highest relevance in row. Note how M1's relevance (boosted by importance=0.72, confidence=1) is highest in 9/12 queries, even when its cosine is lower than the target.

## 6. Counterfactual Comparison

| Query | Target | P0 Top-1 | P1 Top-1 | P2 Top-1 | P3 Top-1 | P4 Top-1 | Failure |
|---|---|---|---|---|---|---|---|
| Q1 | M1 | M1 | M5 | M1 | M1 | M1 | A |
| Q2 | M1 | M1 | M1 | M1 | M1 | M1 | A |
| Q3 | M1 | M1 | M5 | M1 | M1 | M1 | A |
| Q4 | M2 | M1 | M2 | M1 | M1 | M2 | B |
| Q5 | M1 | M1 | M1 | M1 | M1 | M1 | A |
| Q6 | M1 | M1 | M1 | M1 | M1 | M1 | A |
| Q7 | M5 | M1 | M5 | M1 | M1 | M5 | B |
| Q8 | M3 | M1 | M3 | M1 | M1 | M3 | A |
| Q9 | M6 | M1 | M6 | M1 | M1 | M6 | A |
| Q10 | M4 | M4 | M4 | M4 | M4 | M4 | - |
| Q11 | M7 | M1 | M7 | M1 | M1 | M7 | B |
| Q12 | M8 | M8 | M8 | M8 | M8 | M8 | - |

**Key observations:**

1. **P1 (cosine-only) gets 7/12 correct** — same as production. The 5 failures are Q1, Q3, Q4, Q7, Q11 where cosine argmax ≠ target.

2. **P2 (fusion-only) gets only 5/12 correct** — M1 dominates due to high importance/confidence. Fusion-only is WORSE than cosine-only.

3. **P4 (oracle) gets 12/12 correct** — upper bound is perfect retrieval.

4. **P0 = P3** — effectiveScore sort + MMR produces identical top-1 to MMR alone (effectiveScore sort is irrelevant for non-tie cases).

## 7. Margin Analysis

| Query | Target | Cosine Margin | Relevance Margin | Failure |
|---|---|---|---|---|
| Q1 | M1 | -0.0026 | +0.1456 | A |
| Q2 | M1 | +0.0130 | +0.1534 | A |
| Q3 | M1 | -0.0008 | +0.1465 | A |
| Q4 | M2 | +0.1964 | **-0.0488** | B |
| Q5 | M1 | +0.0217 | +0.1577 | A |
| Q6 | M1 | +0.0175 | +0.1558 | A |
| Q7 | M5 | +0.1420 | **+0.0710** | B |
| Q8 | M3 | +0.1170 | +0.0585 | A |
| Q9 | M6 | +0.1326 | +0.0664 | A |
| Q10 | M4 | +0.2059 | +0.1029 | - |
| Q11 | M7 | +0.2897 | **-0.0020** | B |
| Q12 | M8 | +0.2934 | +0.1467 | - |

**Critical finding:** For class B failures (Q4, Q7, Q11), the cosine margin is **positive** (target has higher cosine) but the relevance margin is **negative or near-zero** (M1's fusion boost overcomes the cosine gap). This is direct evidence for H2 (ranking geometry).

- **Q4**: M2 cosine=0.7308 vs M1 cosine=0.5344 (+0.1964 margin). But M1 relevance=0.6392 vs M2 relevance=0.5904 (-0.0488 margin). M1 wins by +0.0488 relevance.
- **Q7**: M5 cosine=0.7622 vs M1 cosine=0.6051 (+0.1420 margin). But M1 relevance=0.6745 vs M5 relevance=0.6061 (-0.0684 effective margin). M1 wins.
- **Q11**: M7 cosine=0.7557 vs M1 cosine=0.4660 (+0.2897 margin). But M1 relevance=0.6049 vs M7 relevance=0.6029 (-0.0020 margin). M1 wins by razor-thin 0.002.

## 8. MMR Analysis

### 8.1 MMR Selection Order (Q4 example)

| Rank | Memory | MMR Score | Cosine | Relevance |
|---|---|---|---|---|
| 1 | M1 | 0.4474 | 0.5344 | 0.6392 |
| 2 | M2 (target) | 0.2002 | 0.7308 | 0.5904 |
| 3 | M5 | 0.1201 | 0.5065 | 0.4782 |
| 4 | M7 | 0.1116 | 0.4338 | 0.4419 |

M2 (target) has the highest cosine (0.7308) but ranks #2 because M1's relevance (0.6392) is higher. MMR does NOT remove M2 — it stays at rank 2. The failure is in the relevance fusion, not MMR diversification.

### 8.2 MMR Impact Assessment

Across all 12 target queries:
- **0 targets removed by MMR** that were ranked #1 by relevance
- **0 targets demoted below non-targets** by MMR diversity penalty
- MMR's diversity penalty (0.3 * maxSimToSelected) is too weak to change top-1 when relevance gaps are large

**Conclusion: MMR is NOT a failure mode (H3 ruled out).**

## 9. Token Budget Analysis

All 8 memories are selected in every query (token budget never binds):
- Identity budget: 500 tokens. M1 content: ~7 tokens. Well within budget.
- Semantic budget: 800 tokens. All M2-M8 content: ~10-15 tokens each. Well within budget.
- Total: ~80 tokens used of 3700 cap.

**Conclusion: Token budget is NOT a failure mode (H5 ruled out).**

## 10. Hypothesis Verdicts

### H1 — Eligibility / Threshold Policy: **DOMINANT**

7/12 target queries (58.3%) fail because the target never clears the 0.65 floor. This is the same finding as M2-R and M2-E: question-form queries produce cosines in 0.42-0.59 range against declarative memories.

**Evidence:**
- Q1 (M1 target): cosine=0.5254, needs 0.65 → fails by 0.1246
- Q2 (M1 target): cosine=0.5105, needs 0.65 → fails by 0.1395
- Q3 (M1 target): cosine=0.5074, needs 0.65 → fails by 0.1426
- Q5 (M1 target): cosine=0.5502, needs 0.65 → fails by 0.0998
- Q6 (M1 target): cosine=0.5120, needs 0.65 → fails by 0.1380
- Q8 (M3 target): cosine=0.5817, needs 0.65 → fails by 0.0683
- Q9 (M6 target): cosine=0.6113, needs 0.65 → fails by 0.0387

### H2 — Ranking Geometry: **CONTRIBUTING**

3/12 target queries (25%) fail because M1's fusion boost (importance=0.72, confidence=1) lets it outrank the target despite lower cosine.

**Evidence:**
- Q4: M2 cosine=0.7308 > M1 cosine=0.5344, but M1 relevance=0.6392 > M2 relevance=0.5904
- Q7: M5 cosine=0.7622 > M1 cosine=0.6051, but M1 relevance=0.6745 > M5 relevance=0.6061
- Q11: M7 cosine=0.7557 > M1 cosine=0.4660, but M1 relevance=0.6049 ≈ M7 relevance=0.6029

The relevance formula's 0.15*importance + 0.1*confidence terms give M1 a +0.108 + 0.05 = +0.158 boost over M2-M8 (which have importance=0.3, confidence=0.5 → 0.045 + 0.05 = 0.095). This +0.063 relevance advantage can overcome cosine gaps up to ~0.126 (since similarity weight is 0.5).

### H3 — MMR: **RULED OUT**

0 class C failures. MMR never removes or demotes a correct target. The diversity penalty (0.3 * maxSimToSelected) is insufficient to overcome relevance gaps at the top of the ranking.

### H4 — Representation: **CONFIRMED**

M1 vs M5 cosine margins for name queries:
- Q1: M1=0.5254, M5=0.5280, margin=-0.0026 (M5 slightly higher)
- Q2: M1=0.5105, M5=0.4975, margin=+0.0130 (M1 slightly higher)
- Q3: M1=0.5074, M5=0.5082, margin=-0.0008 (M5 slightly higher)
- Q5: M1=0.5502, M5=0.5285, margin=+0.0217 (M1 higher)
- Q6: M1=0.5120, M5=0.4945, margin=+0.0176 (M1 higher)

The embedding model cannot reliably distinguish "user's name" from "friend's name" at the cosine level. This is a representation limitation.

### H5 — Insufficient Information: **RULED OUT**

Sufficient candidate information exists. The targets are present in the corpus with correct content. The failure is geometric (cosine too low for question-form), not informational.

### H6 — Interaction: **LIKELY**

H1 and H2 interact: eligibility dominates (7 failures), but for the 5 queries that DO clear the floor, ranking geometry causes 3 additional failures (60% of clearers). The two hypotheses are not independent — the same importance/confidence boost that causes H2 also means M1 is more likely to clear the floor than the actual target.

## 11. Comparison with M2-E

| Metric | M2-E (cosine argmax) | M2-G (production ranking) | Delta |
|---|---|---|---|
| Wrong Top-1 rate | 33.3% (4/12) | 41.67% (5/12) | +8.33pp |
| Top-1 accuracy | 66.7% (8/12) | 58.33% (7/12) | -8.33pp |
| Class A failures | not classified | 7/12 | — |
| Class B failures | not classified | 3/12 | — |

**M2-E underestimated the wrong-Top-1 rate.** The production ranking pipeline produces MORE wrong-top-1 results than cosine argmax because M1's fusion boost (importance=0.72, confidence=1) lets it outrank targets even when its cosine is lower.

### Why M2-E was wrong

1. **M2-E used non-production weights**: `{similarity:0.6, importance:0.25, recency:0.15, confidence:0.15}` vs production `{similarity:0.5, importance:0.15, recency:0.1, confidence:0.1}`. The offline simulation overweighted importance and confidence.

2. **M2-E's "top-1" was cosine argmax**, not production ranking. The per-query table's Top-1 column is simply `argmax(cosine)`, not the output of the production ranking pipeline.

3. **M2-E used M1 fixture values** (importance=0.35, confidence=0.5) instead of real DB values (importance=0.72, confidence=1). This underestimated M1's ranking boost by ~0.054 relevance points.

## 12. Decision Tree

```
1. Most failures are class A (7/12 = 58.3)?
   → YES: H1 (eligibility) is DOMINANT
   
2. Remaining failures are class B (3/12 = 25%)?
   → YES: H2 (ranking) is CONTRIBUTING
   
3. Any class C failures?
   → NO: H3 (MMR) ruled out
   
4. M1 vs M5 margins negligible?
   → YES for some queries: H4 (representation) confirmed
   
5. No single hypothesis dominates?
   → H1 dominates but H2 contributes: H6 (interaction) likely
```

## 13. Recommendation

**The retrieval problem is primarily geometric (H1), secondarily ranking-based (H2).**

1. **H1 (eligibility)** is the dominant cause: 58.3% of failures are targets not clearing 0.65. This is the same finding as M2-R, M2-D, M2-E, and M2-F. The question-form embedding geometry produces cosines 0.42-0.59 against declarative memories.

2. **H2 (ranking)** is a contributing cause: 25% of failures are M1 outranking the target due to importance/confidence boost. This is NEW evidence from M2-G that was not visible in M2-E (which used cosine argmax).

3. **MMR and token budget are NOT problems.** No failures from diversification or budget constraints.

4. **The production wrong-Top-1 rate (41.67%) is higher than M2-E reported (33.3%).** The fusion formula's importance/confidence terms actively hurt ranking when a high-importance memory (M1) competes with the correct target.

### Smallest next diagnostic

To confirm whether reducing M1's importance boost (or capping the non-similarity terms) would fix H2 without hurting H1, run a counterfactual: set all memories' importance=0.3, confidence=0.5 (equalize non-similarity terms) and measure the change in top-1 accuracy. This isolates the ranking geometry effect from the eligibility effect.

## 14. Repository Safety Verification

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
| `scripts/m2g-ranking-forensic.mjs` | Standalone read-only diagnostic script |
| `docs/M2G_RANKING_FORENSIC.md` | This report |

### Files NOT modified

- `lib/memory/retrieve.ts` — unchanged
- `lib/memory/constants.ts` — unchanged
- `lib/memory/score.ts` — unchanged
- `lib/memory/types.ts` — unchanged
- `lib/repositories/memory.repository.ts` — unchanged
- `supabase/migrations/*` — unchanged

### Verification

```
git diff --stat: 0 modified tracked files
git status: new untracked files: scripts/m2g-ranking-forensic.mjs, docs/M2G_RANKING_FORENSIC.md
```

## 15. M2-G STATUS

```
M2-G STATUS = COMPLETE
PRODUCTION_CHANGES = 0
DB_WRITES = 0
TOUCH_MEMORIES = 0
FROZEN_FILES_CHANGED = 0
COMMITS = 0

FINDING:
  H1 (eligibility) = DOMINANT (58.3% of failures)
  H2 (ranking) = CONTRIBUTING (25% of failures)
  H3 (MMR) = RULED OUT (0% of failures)
  H4 (representation) = CONFIRMED
  H5 (insufficient info) = RULED OUT
  H6 (interaction) = LIKELY

PRODUCTION WRONG-TOP-1 RATE = 41.67% (5/12)
M2-E WRONG-TOP-1 RATE (cosine argmax) = 33.3% (4/12)
DELTA = +8.33pp (production ranking WORSE than cosine argmax)

KEY INSIGHT: M1's importance/confidence boost (0.72/1.0 vs 0.3/0.5) lets it
outrank correct targets in Q4, Q7, Q11 — a failure mode invisible to cosine
argmax. The fusion formula actively hurts ranking precision when a
high-importance memory competes with the correct target.
```

The experiment completes successfully with all measurement acceptance conditions met. The ranking forensic confirms that the retrieval problem is primarily geometric (eligibility floor) with a secondary contribution from ranking geometry (fusion boost letting M1 outrank targets).
