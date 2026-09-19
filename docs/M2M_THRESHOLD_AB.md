# M2-M: THRESHOLD A/B EXPERIMENT

**Execution status:** `DIAG_RESULT = PARTIAL` — gates G4 and G7 failed, verdict B (see §7). Script `scripts/m2m-threshold-ab.mjs` run **twice** (2026-09-02 · run1 and run2 produced byte-identical output — cross-run repeatability PASS, see §9).

**Mode:** LIVE. Live Ollama embeddings (never persisted). One startup SELECT of M1 fixture for sanity. Zero DB writes · zero `touch_memories` calls · zero production file modifications.

---

## 1. Executive Summary

| Policy | Threshold | All-Top1 | Elig-Top1 | Elig.Fail | Rank.Fail | FP(neg) |
|---|:---|---:|---:|---:|---:|---:|
| P0 | 0.65 | 38.2979% | 50% | 19 | 14 | 1 |
| P0.50 | 0.50 | 38.2979% | 39.1304% | 1 | 28 | 2 |
| Delta | | 0pp | -10.87pp | -18 | 14 | 1 |

```
M2-M STATUS = COMPLETE
BASELINE_REPRODUCTION = PASS
DETERMINISM = PASS
READ_ONLY = PASS
FROZEN_CONTRACT = PASS
```

---

## 2. Corpus

| Component | Count | Notes |
|---|:---|:---|
| Total memories | 53 | 8 seed (M2-E) + 45 synthetic |
| Total queries | 60 | 15 seed (M2-E) + 45 synthetic |
| Target queries | 47 | Each has exactly one correct memory |
| Negative queries | 13 | No related memory in corpus |
| Near-neighbor clusters | 3 | Name (4), Location (3), Preference (3) |
| Metadata envelope | 5×4×2×2 | importance × type × confidence × usage |

---

## 3. Threshold Comparison

> **NOTICE — corrected presentation.** The script's console table mixed denominators in three rows. The rows below are the corrected, unambiguous equivalents. All counts come verbatim from the §8 raw JSON.

| Metric | P0 @ 0.65 | P0.50 @ 0.50 | Delta |
|---|---:|---:|---:|
| Target recall (eligible / all targets) | 28/47 = **59.57%** | 46/47 = **97.87%** | **+18 targets (+38.30pp)** |
| Eligible-target Top-1 accuracy | **50.00%** (14/28) | **39.13%** (18/46) | **−10.87pp** |
| All-target Top-1 accuracy | **38.30%** (18/47) | **38.30%** (18/47) | 0pp |
| All-target wrong Top-1 | 61.70% (29/47) | 61.70% (29/47) | 0pp |
| Eligibility failures (E1) | 19 | 1 | **−18** |
| Ranking failures (E2) | 14 | 28 | **+14** |
| Negative FP count (rate, /13) | 1 (7.69%) | 2 (15.38%) | **+1 (+7.69pp)** |
| MRR (eligible targets) | 0.5713 | 0.4649 | −0.1064 |
| Mean rank (eligible targets) | 9.0714 | 12.3261 | +3.2547 |
| Rank inversions (eligible targets) | 14 | 28 | +14 |

**Key correction vs the generated table:** the old `Target Recall` row printed the *eligible-Top-1 accuracy* (50% / 39.13%) inside the parentheses as if it were recall — it was not. True recall is 59.57% → 97.87%. The old `Top-1 Accuracy` row showed all-target accuracy (38.30%) in the columns but the eligible-target delta (−10.87pp) in the delta cell — resolved here into two explicit rows. The old `Eligibility Rate` row computed n/n (=100%) which is meaningless; real eligibility is captured by the recall and E1 rows. The `FP Rate` numerator is over all **13** negatives, not the 10 shown in §5.

---

## 4. Near-Neighbor Results

### Name cluster

| Query | Target | TgtCos | TgtRank@0.65 | TgtRank@0.50 | Winner@0.65 | Winner@0.50 | WinnerChanged |
|---|---|---|:---:|:---:|:---:|:---:|:---:|
| Q16 | S8 | 0.5254 | 1 | 1 | S8 | S8 | no |
| Q17 | S9 | 0.7308 | 1 | 1 | S9 | S9 | no |
| Q18 | S10 | 0.7622 | 12 | 12 | S41 | S41 | no |
| Q19 | S11 | 0.7505 | 2 | 2 | S41 | S41 | no |

### Location cluster

| Query | Target | TgtCos | TgtRank@0.65 | TgtRank@0.50 | Winner@0.65 | Winner@0.50 | WinnerChanged |
|---|---|---|:---:|:---:|:---:|:---:|:---:|
| Q20 | S12 | 0.5817 | 1 | 1 | S12 | S12 | no |
| Q21 | S13 | 0.6131 | 18 | 18 | S27 | S27 | no |
| Q22 | S14 | 0.6202 | 14 | 14 | S8 | S8 | no |

### Preference cluster

| Query | Target | TgtCos | TgtRank@0.65 | TgtRank@0.50 | Winner@0.65 | Winner@0.50 | WinnerChanged |
|---|---|---|:---:|:---:|:---:|:---:|:---:|
| Q23 | S15 | 0.622 | 3 | 3 | S31 | S31 | no |
| Q24 | S16 | 0.7513 | 1 | 1 | S16 | S16 | no |
| Q25 | S17 | 0.7221 | 15 | 15 | S8 | S8 | no |

**Near-neighbor interpretation (explicit).** Name-cluster entity mapping: S8 = *user name* (Prince), S9 = *dog's name* (Bruno), S10 = *friend's name* (Rahul), S11 = *cat's name* (Whiskers). Location: S12 = India, S13 = New York (work), S14 = Texas (upbringing). Preference: S15 = cricket, S16 = football, S17 = tennis.

- **user name vs dog name** (Q16 vs Q17): both retain their correct winner at 0.50 (S8, S9) — no swap.
- **user name vs friend name** (Q16 vs Q18): Q18's winner stays S41 (a write-time cross-category decoy) at both thresholds — a **pre-existing ranking failure unrelated to the threshold**, not a new regression.
- **user name vs pet name** (Q16 vs Q19): Q19's winner stays S41 at both thresholds — same pre-existing failure, unchanged.
- Every cluster query keeps its exact target rank and winner at 0.65 vs 0.50 (`winnerChanged = false` for all 10 cluster queries). **Zero near-neighbor regressions** from lowering the floor.

## 5. Negative-Control Results

| Query | Text | Cnt@0.65 | Cnt@0.50 | Winner@0.65 | Winner@0.50 | Harmful FP? |
|---|---|:---:|:---:|:---:|:---:|:---:|
| Q51 | What is the capital of France? | 0 | 0 | S8 | S8 | no |
| Q52 | Tell me a joke. | 0 | 0 | S8 | S8 | no |
| Q53 | What is the weather? | 0 | 0 | S8 | S8 | no |
| Q54 | Who is the president of Brazil? | 0 | 15 | S8 | S8 | YES |
| Q55 | What is my mother's maiden name? | 0 | 8 | S8 | S8 | no |
| Q56 | Do I have a sister? | 0 | 2 | S8 | S8 | no |
| Q57 | What is my favorite movie? | 1 | 3 | S29 | S29 | no |
| Q58 | What car do I drive? | 0 | 6 | S8 | S8 | no |
| Q59 | What is my blood type? | 0 | 0 | S8 | S8 | no |
| Q60 | Do I have any allergies? | 0 | 0 | S8 | S8 | no |

**Negative-control interpretation.** 13 negatives total (seed Q13 "What is the capital of France?", Q14 "Tell me a joke.", Q15 "What is the weather?" + the 10 synthetic above; the 3 seed negatives have 0 candidates ≥ 0.50 and never win). FP = a negative whose **MMR winner's cosine ≥ floor** (winner is the fused relevance/MMR ranking champion, not merely any candidate — the pool is full-corpus, see §10 notes). Under that definition:

- **@ 0.65: 1 FP (Q57 "What is my favorite movie?" → winner S29, cosine ≥ 0.65).** S8 (identity metadata champion) is displaced here only because S29 clears the 0.65 floor with a high cosine.
- **@ 0.50: 2 FPs — Q57 (S29) + Q54 "Who is the president of Brazil?" (winner S8, cosine now ≥ 0.50).** Q54 is the harmful one: 15 memories cross the 0.50 floor for an irrelevant query, and its ranking winner (S8 = the user's name) would be surfaced as context for that query.
- Q55/Q56/Q58 gain candidates at 0.50 **but their winner S8's cosine stays below 0.50**, so they do not count as FPs under the harness definition — the additional candidates raise pollution potential but do not change the surfaced Top-1.

The winner `S8` column for most negatives is the M2-L "M1 metadata advantage" effect: the identity memory wins the fused ranking across unrelated queries despite low cosine — a pre-existing production-ranking behavior, visible at 0.65 too.

---

## 6. Gate Results

G1 (baseline reproduction) = PASS — seed reproduction PASS
G2 (determinism) = PASS — identical
G3 (recall improvement) = PASS — delta=18 (28 -> 46)
G4 (FP rate = 0%) = FAIL — fpCount=2, fpRate=15.3846%
G5 (Top-1 degradation) = PASS — rawDelta=0pp (PASS for human review, no arbitrary tolerance)
G6 (near-neighbor regression) = PASS — nnRegressions=0
G7 (negative safety) = FAIL — harmfulNegFp=1/10
G8 (frozen contract) = PASS — verified via frozen-contract check

---

## 7. Interpretation

THRESHOLD_EFFECT = Lowering threshold from 0.65 to 0.50 improves target recall by 18 queries.
PRECISION_EFFECT = False positives detected at 0.50 (15.3846% FP rate).
RANKING_EFFECT = Ranking failures increased by 14.
NEAR_NEIGHBOR_EFFECT = No near-neighbor winner changes. Safe.
ELIGIBILITY_EFFECT = Eligibility failures reduced by 18.

FINAL_VERDICT = B) THRESHOLD_RECALL_PRECISION_TRADEOFF

NEXT_STEP = Human review of 0.50 as production threshold candidate. No production changes made.

---

## 8. Raw Summary JSON

```json
{
  "mode": "LIVE",
  "g1Pass": true,
  "detOk": true,
  "p0": {
    "allTarget": {
      "n": 47,
      "top1Accuracy": 38.2979,
      "wrongTop1": 61.7021,
      "mrr": 0.456,
      "meanRank": 12.5319,
      "rankInversions": 29
    },
    "eligibleTarget": {
      "n": 28,
      "top1Accuracy": 50,
      "wrongTop1": 50,
      "mrr": 0.5713,
      "meanRank": 9.0714,
      "rankInversions": 14
    },
    "eligibilityFailures": 19,
    "rankingFailures": 14,
    "negativeFpCount": 1,
    "negativeFpRate": 7.6923
  },
  "p050": {
    "allTarget": {
      "n": 47,
      "top1Accuracy": 38.2979,
      "wrongTop1": 61.7021,
      "mrr": 0.456,
      "meanRank": 12.5319,
      "rankInversions": 29
    },
    "eligibleTarget": {
      "n": 46,
      "top1Accuracy": 39.1304,
      "wrongTop1": 60.8696,
      "mrr": 0.4649,
      "meanRank": 12.3261,
      "rankInversions": 28
    },
    "eligibilityFailures": 1,
    "rankingFailures": 28,
    "negativeFpCount": 2,
    "negativeFpRate": 15.3846
  },
  "deltas": {
    "recall": 18,
    "eligTop1": -10.8696,
    "top1": 0,
    "rankFail": 14,
    "eligFail": -18,
    "fp": 1,
    "fpRate": 7.6923,
    "mrr": -0.1064,
    "meanRank": 3.2547
  },
  "gates": {
    "G1": true,
    "G2": true,
    "G3": true,
    "G4": false,
    "G5": true,
    "G6": true,
    "G7": false,
    "G8": true
  },
  "nearNeighborCount": {
    "name": 4,
    "location": 3,
    "preference": 3
  },
  "negativeHarmfulCount": 1
}
```

---

## 9. Cross-Run Repeatability

The script was executed **twice** in sequence against live Ollama with the identical 53-memory corpus and identical production ranking harness:

| Check | Result |
|---|---:|
| run1 vs run2 full logs (87 lines each, byte comparison) | **IDENTICAL** |
| In-run determinism (P0.50 executed a 2nd time; aggregate JSON compared) | **IDENTICAL (G2 PASS)** |
| Seed reproduction (M2-G 12-query frozen cosine matrix) | **PASS both runs** |

No timestamps are emitted inside the logs; the report file (last writer = run2) was regenerated at 2026-09-02T03:50:52.899Z. The §8 raw JSON in this file is therefore representative of **both** runs. Combined with the in- and cross-run identity, retrieval behavior under the harness is deterministic to the byte.

---

## 10. Consolidated Corrected Metrics (final)

> **Harness note (documented, not a defect):** per M2-J/M2-L methodology, the ranking pool is the **full 53-memory corpus** with the threshold applied as an *eligibility flag* (`clears`) plus the FP winner-cosine check — not a pre-filtered candidate list. This is exactly the harness that reproduced the M2-J P0 baseline (below), so both thresholds are measured on the same, validated footing. The production RPC would additionally drop sub-floor rows (making the E1 counts absolute *rejections* there); the direction of the effects is unchanged.

| Metric | P0 @ 0.65 | P0.50 @ 0.50 | Delta |
|---|---:|---:|---:|
| Target recall (eligible/all) | 59.57% (28/47) | 97.87% (46/47) | **+38.30pp (+18)** |
| Eligible-target Top-1 | 50.00% (14/28) | 39.13% (18/46) | **−10.87pp** |
| All-target Top-1 | 38.30% (18/47) | 38.30% (18/47) | 0pp |
| All-target wrong Top-1 | 61.70% (29/47) | 61.70% (29/47) | 0pp |
| Eligibility failures (E1) | 19 | 1 | **−18** |
| Ranking failures (E2) | 14 | 28 | **+14** |
| Negative FP count (rate /13) | 1 (7.69%) | 2 (15.38%) | **+1 (+7.69pp)** |
| Harmful negative FP | 0 | 1 (Q54 → S8) | **+1** |
| MRR (eligible) | 0.5713 | 0.4649 | −0.1064 |
| Mean rank (eligible) | 9.0714 | 12.3261 | +3.2547 |
| Rank inversions (eligible) | 14 | 28 | +14 |
| Near-neighbor winner changes | — | — | **0** |

**Baseline reproduction (M2-J P0):** 38.2979% all-target Top-1 · 50.00% eligible Top-1 · 19 E1 · 14 E2 · 1 FP re-produced exactly → **PASS**. (Script's formal G1 gate is the M2-G seed subset; the full-corpus row matches M2-J's documented P0 column on every metric.)

### Eligibility effect
The floor is the dominant pre-0.50 failure layer: 18 of 19 E1 failures are cleared. This confirms M2-K/M2-L's claim that **eligibility failures are threshold-driven representation geometry**, not ranking.

### Ranking effect
The 18 newly-eligible targets are admitted into the eligible-Top-1 denominator (28 → 46) while few of them reach rank 1. As a result **eligible-Top-1 accuracy drops** (50.0% → 39.1%), E2 failures rise 14 → 28, and MRR/mean-rank worsen. Ranking, not the floor, becomes the dominant failure layer at 0.50. This matches M2-M expected outcome **C-style separation**: eligibility improves, ranking is exposed as the next constraint — but the FP increase forces the verdict to **B**.

### Threshold effect
Recall ↑ +38.3pp at 0.50; FP rate doubles 7.69% → 15.38%; all-target Top-1 unchanged (0pp). 0.50 admits genuinely relevant memories (18 net) **and** some irrelevant ones into the candidate pool on the same queries.

### Top-1 effect
All-target Top-1 accuracy is exactly unchanged (38.2979%). With-in-eligible accuracy worsens because the denominator grows by 18 mostly-low-cosine targets while the top-1 count stays 18 overall.

### False-positive effect
From 1 → 2 FPs over 13 negatives, including a **new harmful FP**: Q54 ("Who is the president of Brazil?") would surface the user's name memory (S8) at 0.50.

---

## 11. Repository / Frozen-File Integrity

| Check | Result |
|---|---:|
| `lib/memory/constants.ts` · `score.ts` · `types.ts` · `retrieve.ts` · `identity.ts` · `aiExtractor.ts` · `lib/repositories/memory.repository.ts` | unchanged |
| `lib/ai/embeddings/*` · `lib/context/*` · `lib/brain/*` (recursive) | unchanged |
| `supabase/migrations/*` (0017/0018 are pre-existing untracked) | unchanged |
| SHA-256 baseline vs post-run (33 files) | **33/33 identical** |
| DB writes · `touch_memories` · migrations · commits | **0 / 0 / 0 / 0** |
| Pre-existing working-tree modifications | untouched (byte-identical `git diff --name-only` set vs session start) |
| New artifacts (diagnostic-only) | `docs/M2M_THRESHOLD_AB.md` (regenerated/corrected) · `.kilo/m2m/` (run logs + pre-run report archive + baseline hashes) |

Per the frozen contract, **the production eligibility floor in `lib/memory/constants.ts` remains 0.65** — no production change was made or is implied by this diagnostic.

---

## 12. Final Verdict

**Verdict: B) THRESHOLD_RECALL_PRECISION_TRADEOFF** — same as the original M2-M run, reproduced identically.

Gates: **G1 PASS** (baseline reproduction) · **G2 PASS** (determinism) · **G3 PASS** (recall Δ=+18) · **G4 FAIL** (FP count 2 ≠ 0) · **G5 PASS** (all-target wrong Top-1 Δ=0pp) · **G6 PASS** (0 near-neighbor regressions) · **G7 FAIL** (1 harmful negative FP) · **G8 PASS** (frozen contract).

**0.50 is NOT automatically the correct production threshold.** It is the best observed experimental operating point on the validated 53-memory corpus for *recall/eligibility*, but it is not production-safe on this evidence because:
1. FP rate doubles (1 → 2 / 13), including one harmful FP (Q54 → S8),
2. ranking failures (E2) double (14 → 28) and eligible-target Top-1 accuracy falls 10.87pp,
3. the ranking layer — not the floor — becomes the dominant failure mode, and the ranking policy itself (production fusion, P0) is already the worst performer documented by M2-J.

No production change is authorized by this experiment. Any future threshold adoption must be preceded by a human decision on the recall/precision/ranking tradeoff above — ideally with a separate ranking-policy change evaluated under the corrected 0.50 candidate set.
