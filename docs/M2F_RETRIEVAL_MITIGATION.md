# AETHER — M2-F RETRIEVAL MITIGATION EXPERIMENT REPORT

**Execution status:** `DIAG_RESULT = COMPLETE` (2026-09-01T10:55Z · script `scripts/m2f-retrieval-mitigation.mjs` · all measurement acceptance conditions met)

**Mode:** read-only measurement. Zero DB writes · zero `touch_memories` calls · service-role used for SELECT-only read of M1 embedding · M2-M8 embeddings generated locally via Ollama (never persisted) · no production file modified.

## 1. Executive Summary

| Strategy | Recall | FP Rate | Wrong Top-1 (floor) | Top-1 Acc | Production-Safe |
|---|---:|---:|---:|---:|:---:|
| **R0** (baseline) | **41.67%** | **0%** | **0%** | **83.33%** | baseline |
| R1 (global rewrite) | 83.33% | 58.33% | 25% | 66.67% | NO |
| R3Q (question-gated) | 83.33% | 58.33% | 25% | 66.67% | NO |
| R4 (dual-rep union) | 83.33% | 58.33% | 25% | 66.67% | NO |
| R5 (intersection) | 41.67% | 0% | 0% | 41.67% | NO |

**DECISION: `NO_PRODUCTION_SAFE_STRATEGY_FOUND`**

No strategy improves recall over R0 while simultaneously preserving all safety gates. R0 remains the precision-safe production baseline.

## 2. Scientific Question

Can retrieval recover question-form recall (lost under R0) while avoiding R1's multi-memory false-positive and wrong-Top-1 behavior — using only read-only measurement against the frozen M2-E fixture?

## 3. Existing Evidence

| Experiment | Finding |
|---|---|
| M2-R | question-declarative embedding geometry confirmed as dominant cause; 22.2% A-E clearance at 0.65 |
| M2-D | R1 (global rewrite) triples A-E clearance (66.7%) but admits 33.3% G false-positive rate |
| M2-E | R1 recall 83.3% but FP 58.3%, wrong-Top-1 33.3% in multi-memory regime; R1 NOT production-safe |

## 4. Experiment Design

### 4.1 Strategies tested

| Strategy | Representation | Ranking | Notes |
|---|---|---|---|
| R0 | `embed(query)` | cosine desc | Production baseline |
| R1 | `embed("The user asks: " + query)` | cosine desc | Global rewrite (unsafe per M2-E) |
| R3Q | R1 if question-detector fires, else R0 | cosine desc | Question-gated |
| R4 | R0-eligible ∪ R1-eligible | max(cos_R0, cos_R1) desc | Dual-representation union |
| R5 | R0 ∩ R1 (clear 0.65 under BOTH) | max(cos_R0, cos_R1) desc | Intersection |

### 4.2 Corpus (exact M2-E fixture)

- **M1**: real DB embedding (`25c3eed5-…`, content `"The user's name is Prince."`, 768-dim, loaded via SELECT)
- **M2-M8**: local Ollama embeddings (never persisted)
- **Queries**: 15 total (12 with targets, 3 negative controls)
- **Production floor**: 0.65
- **Model**: nomic-embed-text:latest, 768-dim

### 4.3 Acceptance gates

| # | Gate | Requirement | Result |
|---|---|---|---|
| 1 | Preflight | Ollama reachable, model present, DB ref correct | PASS |
| 2 | M1 sanity | cosine(fresh embed(content), stored) ≤ 1 + 1e-6 | PASS (1.000000000) |
| 3 | Repeatability R0 | max|run1 − run2| ≤ 1e-6 | PASS (0.000e+0) |
| 4 | Repeatability R1 | max|run1 − run2| ≤ 1e-6 | PASS (0.000e+0) |
| 5 | R0 reproduction | recall=41.7%, fpRate=0%, top1Acc=83.3% | PASS (all within 0.1%) |
| 6 | R1 reproduction | recall=83.3%, fpRate=58.3% | PASS (all within 0.1%) |
| 7 | Corpus completeness | 8 memories × 15 queries × 5 strategies | PASS |

## 5. Question Detector Classification

The deterministic question detector classifies a query as a question if:
1. It ends with `?`, OR
2. It begins with an interrogative word (`what`, `who`, `where`, `when`, `why`, `how`, `can`, `could`, `did`, `do`, `is`, `are`, `am`, `was`, `were`, `will`, `would`, `have`, `has`, `had`, `should`, `which`), OR
3. It begins with a question phrase (`tell me`, `my name`, `i told you`)

### Classification results

| Q | Query | Target | isQuestion | Reason |
|---|---|:---:|:---:|---|
| Q1 | What is my name? | M1 | Y | terminal ? |
| Q2 | Tell me my name. | M1 | Y | starts with "tell me" |
| Q3 | Do you remember my name? | M1 | Y | terminal ? |
| Q4 | What is my dog's name? | M2 | Y | terminal ? |
| Q5 | What name do you have for me? | M1 | Y | terminal ? |
| Q6 | Who am I? | M1 | Y | terminal ? |
| Q7 | What is my friend's name? | M5 | Y | terminal ? |
| Q8 | Where do I live? | M3 | Y | terminal ? |
| Q9 | What project am I building? | M6 | Y | terminal ? |
| Q10 | What do you know about my cricket interest? | M4 | Y | terminal ? |
| Q11 | What is my favorite color? | M7 | Y | terminal ? |
| Q12 | Do I own a laptop? | M8 | Y | terminal ? |
| Q13 | What is the capital of France? | null | Y | terminal ? |
| Q14 | Tell me a joke. | null | Y | starts with "tell me" |
| Q15 | What is the weather? | null | Y | terminal ? |

**Critical finding: ALL 15 queries classified as questions.**

- 12/12 target-bearing queries: questions
- 3/3 negative control queries: questions

**Implication:** Since the negative controls (Q13-Q15) are also questions, R3Q (question-gated R1) applies R1 to ALL queries, making R3Q identical to R1. The question detector cannot distinguish target-bearing from non-target questions in this corpus.

## 6. R0 Baseline Reproduction

| Metric | Measured | M2-E Expected | Δ | Pass? |
|---|---:|---:|---:|:---:|
| Target recall @0.65 | 41.67% | 41.7% | -0.03pp | PASS |
| FP rate | 0% | 0% | 0pp | PASS |
| Wrong Top-1 (global) | 16.67% | 16.7% | -0.03pp | PASS |
| Wrong Top-1 (floor-cond.) | 0% | 0% | 0pp | PASS |
- Top-1 accuracy | 83.33% | 83.3% | +0.03pp | PASS |
| Total false positives | 0 | 0 | 0 | PASS |

R0 baseline reproduced exactly.

### R0 per-query analysis (target memory)

| Q | Target | R0 cos | ≥0.65 | Top-1 | Wrong Top-1 | FP | Margin |
|---|---|---|---|---|---|---|---:|
| Q1 | M1 | 0.5254 | ✗ | M5 | true | 0 | -0.0026 |
| Q2 | M1 | 0.5105 | ✗ | M1 | false | 0 | +0.0129 |
| Q3 | M1 | 0.5074 | ✗ | M5 | true | 0 | -0.0008 |
| Q4 | M2 | 0.7308 | ✓ | M2 | false | 0 | +0.1964 |
| Q5 | M1 | 0.5502 | ✗ | M1 | false | 0 | +0.0217 |
| Q6 | M1 | 0.5120 | ✗ | M1 | false | 0 | +0.0176 |
| Q7 | M5 | 0.7622 | ✓ | M5 | false | 0 | +0.1420 |
| Q8 | M3 | 0.5817 | ✗ | M3 | false | 0 | +0.1170 |
| Q9 | M6 | 0.6113 | ✗ | M6 | false | 0 | +0.1327 |
| Q10 | M4 | 0.7358 | ✓ | M4 | false | 0 | +0.2059 |
| Q11 | M7 | 0.7557 | ✓ | M7 | false | 0 | +0.2898 |
| Q12 | M8 | 0.7641 | ✓ | M8 | false | 0 | +0.2934 |

5/12 = 41.67% recall. 0 FP. 2/12 = 16.67% wrong top-1 (Q1, Q3).

## 7. Per-Strategy Results

### 7.1 R1 — Global Declarative Rewrite (`embed("The user asks: " + query)`)

| Metric | Value | vs R0 |
|---|---:|---:|
| Target recall | 83.33% | +41.67pp |
| FP rate | 58.33% | +58.33pp |
| Wrong Top-1 (global) | 33.33% | +16.67pp |
| Wrong Top-1 (floor-cond.) | 25% | +25pp |
| Top-1 accuracy | 66.67% | -16.67pp |
| Total false positives | 10 | +10 |

R1 improves recall by lifting 5 additional targets above 0.65 (Q1, Q2, Q5, Q8, Q9), but also lifts non-target memories above 0.65 in 7 of 12 target queries.

### 7.2 R3Q — Question-Gated R1

| Metric | Value | vs R1 |
|---|---:|---:|
| Target recall | 83.33% | 0pp |
| FP rate | 58.33% | 0pp |
| Wrong Top-1 (floor) | 25% | 0pp |
| Top-1 accuracy | 66.67% | 0pp |

**R3Q is identical to R1.** Since all 15 queries (including 3 negative controls) are classified as questions, the detector always selects R1. Question-gating provides zero mitigation.

### 7.3 R4 — Dual-Representation Union

| Metric | Value | vs R1 |
|---|---:|---:|
| Target recall | 83.33% | 0pp |
| FP rate | 58.33% | 0pp |
| Wrong Top-1 (floor) | 25% | 0pp |
| Top-1 accuracy | 66.67% | 0pp |

**R4 is identical to R1.** Since R1's candidate set at 0.65 is a strict superset of R0's (every memory that clears under R0 also clears under R1), the union R0 ∪ R1 = R1.

### 7.4 R5 — Intersection (clear 0.65 under BOTH R0 and R1)

| Metric | Value | vs R0 |
|---|---:|---:|
| Target recall | 41.67% | 0pp |
| FP rate | 0% | 0pp |
| Wrong Top-1 (floor-cond.) | 0% | 0pp |
| Wrong Top-1 (global) | 58.33% | +41.67pp |
| Top-1 accuracy | 41.67% | -41.67pp |

R5 preserves R0's recall and FP rate exactly. However, the **global** wrong-Top-1 rate is 58.33% because R5 has NO eligible candidates for queries where R0 doesn't clear (Q1, Q2, Q3, Q5, Q6, Q8, Q9), producing a null top-1 that is counted as "wrong."

The **floor-conditioned** wrong-Top-1 for R5 is 0% (same as R0) — among queries where at least one candidate clears, the target is always top-ranked.

The global wrong-Top-1 metric is misleading for R5 because it counts queries with no retrieval as failures. The floor-conditioned metric (which measures "among queries where retrieval happened, was the top-1 wrong?") is the meaningful one, and R5 passes it.

**However**, R5 does NOT improve recall over R0 — it exactly preserves R0's 41.67%. The intersection can only reduce candidates, never add new ones.

## 8. Threshold Sweep

| Floor | R0 rec/fp/wT1 | R1 rec/fp/wT1 | R3Q rec/fp/wT1 | R4 rec/fp/wT1 | R5 rec/fp/wT1 |
|---|---|---|---|---|---|
| 0.50 | 100/50/16.7 | 100/100/33.3 | 100/100/33.3 | 100/100/33.3 | 100/50/33.3 |
| 0.55 | 66.7/8.3/0 | 100/100/33.3 | 100/100/33.3 | 100/100/33.3 | 66.7/8.3/8.3 |
| 0.60 | 50/8.3/0 | 100/91.7/33.3 | 100/91.7/33.3 | 100/91.7/33.3 | 50/8.3/0 |
| **0.65** | **41.7/0/0** | **83.3/58.3/25** | **83.3/58.3/25** | **83.3/58.3/25** | **41.7/0/0** |
| 0.70 | 41.7/0/0 | 50/0/0 | 50/0/0 | 50/0/0 | 41.7/0/0 |
| 0.75 | 25/0/0 | 41.7/0/0 | 41.7/0/0 | 41.7/0/0 | 25/0/0 |
| 0.80 | 0/0/0 | 33.3/0/0 | 33.3/0/0 | 33.3/0/0 | 0/0/0 |
| 0.85 | 0/0/0 | 16.7/0/0 | 16.7/0/0 | 16.7/0/0 | 0/0/0 |

Key observations:
- At floor 0.70, R1/R3Q/R4 have 0% FP and 0% wrong-Top-1 — but recall drops to 50% (only 6/12 targets)
- R5's recall is always ≤ R0's (intersection can't add candidates)
- R5's FP rate matches R0's at every threshold

## 9. R7 — Delta Analysis

`delta = cos_R1 - cos_R0` for each (query, memory) pair.

### Target-pair deltas (query → target memory, n=12)

| Stat | Value |
|---:|
| Mean | 0.1090 |
| Min | 0.0344 |
| Max | 0.1432 |

Per-query target deltas:

| Q | Query | Target | cos_R0 | cos_R1 | Delta |
|---|---|---|---:|---:|---:|
| Q1 | What is my name? | M1 | 0.5254 | 0.6589 | +0.1336 |
| Q2 | Tell me my name. | M1 | 0.5105 | 0.6534 | +0.1429 |
| Q3 | Do you remember my name? | M1 | 0.5074 | 0.6419 | +0.1345 |
| Q4 | What is my dog's name? | M2 | 0.7308 | 0.8244 | +0.0936 |
| Q5 | What name do you have for me? | M1 | 0.5502 | 0.6933 | +0.1432 |
| Q6 | Who am I? | M1 | 0.5120 | 0.6421 | +0.1301 |
| Q7 | What is my friend's name? | M5 | 0.7622 | 0.7967 | +0.0344 |
| Q8 | Where do I live? | M3 | 0.5817 | 0.7076 | +0.1258 |
| Q9 | What project am I building? | M6 | 0.6113 | 0.6930 | +0.0816 |
| Q10 | What do you know about my cricket interest? | M4 | 0.7358 | 0.8501 | +0.1143 |
| Q11 | What is my favorite color? | M7 | 0.7557 | 0.8513 | +0.0956 |
| Q12 | Do I own a laptop? | M8 | 0.7641 | 0.8422 | +0.0781 |

### Non-target-pair deltas (query → non-target memory, n=108)

| Stat | Value |
|---:|
| Mean | 0.1539 |
| Min | 0.0579 |
| Max | 0.2011 |

### Separability

| Metric | Value |
|---:|
| Target-pair range | [0.0344, 0.1432] |
| Non-target-pair range | [0.0579, 0.2011] |
| Ranges overlap | YES |
| Separable by delta threshold | NO |

**Conclusion:** The delta distributions overlap substantially. A delta threshold cannot structurally disambiguate target from non-target memories. R1's declarative wrapper lifts both target and non-target memories in a correlated fashion — the signal is not separable by a simple difference metric.

This proves that the recall improvement from R1 is inseparable from its false-positive cost at the embedding-geometry level. The same wrapper that lifts the target identity memory also lifts semantically related memories (M5 "friend's name" vs M1 "user's name").

## 10. M1 vs M5 Competition Analysis

The M1 vs M5 competition is the critical failure mode: M5 ("friend's name") outranks M1 ("user's name") for identity queries under R1.

| Query | M1 R0 | M1 R1 | M5 R0 | M5 R1 | R0 margin | R1 margin |
|---|---:|---:|---:|---:|---:|---:|
| Q1 "What is my name?" | 0.5254 | 0.6589 | 0.5280 | 0.6620 | -0.0026 | **-0.0031** |
| Q2 "Tell me my name." | 0.5105 | 0.6534 | 0.4975 | 0.6576 | +0.0129 | **-0.0042** |
| Q3 "Do you remember my name?" | 0.5074 | 0.6419 | 0.5082 | 0.6474 | -0.0008 | **-0.0056** |
| Q5 "What name do you have for me?" | 0.5502 | 0.6933 | 0.5285 | 0.6964 | +0.0217 | **-0.0031** |
| Q6 "Who am I?" | 0.5120 | 0.6421 | 0.4945 | 0.6308 | +0.0176 | +0.0113 |

Under R1, M5 outranks M1 in 4 of 5 name queries (Q1, Q2, Q3, Q5). The margin is small (-0.003 to -0.006) but sufficient to produce wrong-Top-1.

Under R0, M1 is outranked by M5 in Q1 and Q3 — but neither clears 0.65, so no memory is retrieved and the wrong-Top-1 is irrelevant.

R1 lifts both memories above 0.65, but lifts M5 slightly more, causing the wrong memory to be surfaced first.

## 11. Negative Query Analysis

| Query | Target | R0 clearers | R1 clearers | Notes |
|---|---|---|---|---|
| Q13 "What is the capital of France?" | null | none | none | Correct under both |
| Q14 "Tell me a joke." | null | none | none | Correct under both |
| Q15 "What is the weather?" | null | none | **M4 (0.6546)** | FALSE POSITIVE under R1 |

Q15 is the critical false positive. R1 lifts M4 ("The user likes playing cricket.") to 0.6546 for "What is the weather?" — a question with no related memory. This is the M2-E finding confirmed.

## 12. Gate Evaluation

Safety gates (must ALL pass for production-candidacy):

| Strategy | Recall > R0 | FP Rate ≤ 0% | wT1 Floor ≤ 0% | wT1 Global ≤ 16.7% | Top-1 ≥ 83.3% | ALL PASS |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| R0 | — | YES | YES | YES | YES | baseline |
| R1 | YES | **NO** (58.3%) | **NO** (25%) | **NO** (33.3%) | **NO** (66.7%) | **NO** |
| R3Q | YES | **NO** (58.3%) | **NO** (25%) | **NO** (33.3%) | **NO** (66.7%) | **NO** |
| R4 | YES | **NO** (58.3%) | **NO** (25%) | **NO** (33.3%) | **NO** (66.7%) | **NO** |
| R5 | NO (41.7%) | YES | YES | **NO** (58.3%) | **NO** (41.7%) | **NO** |

### Gate-by-gate explanation

- **R1, R3Q, R4**: Fail FP rate (58.3% > 0%), wrong-Top-1 floor (25% > 0%), wrong-Top-1 global (33.3% > 16.7%), top-1 accuracy (66.7% < 83.3%). R3Q and R4 are identical to R1 for this corpus.
- **R5**: Fails recall improvement (41.7% ≯ 41.7%), fails wrong-Top-1 global (58.3% > 16.7%), fails top-1 accuracy (41.7% < 83.3%). Note: R5's floor-conditioned wrong-Top-1 is 0% (passes), and its FP rate is 0% (passes), but it cannot improve recall.

## 13. Why Each Mitigation Failed

### R3Q (Question-gated) — FAILED because:
- The question detector classifies ALL queries as questions, including negative controls (Q13-Q15)
- R3Q reduces to R1 exactly
- The detector signal (interrogative form) is present in both target-bearing and non-target queries
- **Root cause:** Question-form detection cannot distinguish "asking about a stored fact" from "asking about an un-stored topic"

### R4 (Dual-representation union) — FAILED because:
- R1's candidate set at 0.65 is a strict superset of R0's
- Union R0 ∪ R1 = R1 (no new signal from R0 that isn't already in R1)
- **Root cause:** R1 is a recall-superset of R0 at the production floor; union adds nothing

### R5 (Intersection) — FAILED because:
- Intersection can only reduce candidates, never add new ones
- R5 = R0's candidates (since every R0 clearer also clears R1)
- Recall is capped at R0's 41.67%
- The global wrong-Top-1 metric is misleading (queries with no clearers counted as failures), but even ignoring that, recall doesn't improve
- **Root cause:** R0's candidates are a subset of R1's; intersection = R0

## 14. Recommendation

**DECISION: `NO_PRODUCTION_SAFE_STRATEGY_FOUND`**

No tested strategy improves recall over R0 while preserving all safety gates. The evidence indicates:

1. **R1's recall improvement is structurally inseparable from its FP cost.** The delta analysis proves that target and non-target deltas overlap — R1's wrapper lifts both in a correlated fashion.

2. **Question-gating cannot help** when the negative controls are themselves questions (as they are in natural usage). The interrogative form is not a signal for "has a stored answer."

3. **Dual-representation (union/intersection) cannot help** because R1 is a recall-superset of R0 at the production floor. Union = R1 (unsafe), intersection = R0 (no gain).

### Smallest next diagnostic

To distinguish whether the remaining problem is **representation**, **candidate competition**, **ranking**, or **retrieval policy**, the next experiment should test:

**Selective R1 with per-query margin filtering.** Instead of gating R1 by question-form, apply R1 globally but reject any candidate where `cos_R1 - cos_R0 < margin_threshold` AND the candidate is not the target. This tests whether the delta signal (even though overlapping) can be used as a post-filter to suppress R1-only false positives while retaining true targets.

Alternatively, investigate whether the embedding model's representation of interrogative vs declarative text can be improved via instruction-tuning or a different model, without changing the production architecture.

## 15. Repository Safety Verification

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
| `scripts/m2f-retrieval-mitigation.mjs` | Standalone read-only diagnostic script |
| `docs/M2F_RETRIEVAL_MITIGATION.md` | This report |

### Files NOT modified

- `lib/memory/retrieve.ts` — unchanged (still R0)
- `lib/memory/constants.ts` — unchanged (MIN_SIMILARITY=0.65)
- `lib/memory/score.ts` — unchanged
- `lib/memory/types.ts` — unchanged
- `lib/memory/identity.ts` — unchanged
- `lib/repositories/memory.repository.ts` — unchanged
- `lib/ai/embeddings/embed.ts` — unchanged
- `supabase/migrations/*` — unchanged
- All M2-R/M2-D/M2-E artifacts — unchanged
- All Phase 6-AO artifacts — unchanged

### Verification

```
git status: new untracked files: scripts/m2f-retrieval-mitigation.mjs, docs/M2F_RETRIEVAL_MITIGATION.md
git diff --stat: 0 modified files
git diff --name-only: (empty — no modifications to tracked files)
```

## 16. M2-F STATUS

```
M2-F STATUS = COMPLETE
DECISION = NO_PRODUCTION_SAFE_STRATEGY_FOUND
R0_RECALL = 41.67%
R1_FP_RATE = 58.33%
R3Q_IDENTICAL_TO_R1 = true
R4_IDENTICAL_TO_R1 = true
R5_RECALL_CAP = 41.67%
R0_BASELINE_REPRODUCED = true
R1_REPRODUCED = true
REPEATABILITY = PASS
PRODUCTION_CHANGES = 0
DB_WRITES = 0
TOUCH_MEMORIES = 0
FROZEN_FILES_CHANGED = 0
COMMITS = 0
```

The experiment completes successfully with all measurement acceptance conditions met. No production-safe retrieval mitigation was demonstrated. R0 remains the precision-safe baseline.
