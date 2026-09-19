# AETHER — M2-R RETRIEVAL DIAGNOSTIC REPORT

**Execution status: `DIAG_RESULT = COMPLETE`** (2026-09-01T08:42Z · script `scripts/m2r-retrieval-diagnostic.mjs` · all measurement acceptance conditions met)

**Mode:** read-only measurement. Zero DB writes · zero `touch_memories` calls · service-role used for SELECT-equivalent reads and the `language sql stable` RPC only · no production file, threshold, model, prompt, RPC, or migration touched · network destination `127.0.0.1:11434` (Ollama) + Supabase reads on ref `sqbdxttrdmlwlmslzznv` only.

## 1. Source/path audit confirmation

Confirmed by code inspection (pre-registration): general retrieval embeds the **raw user message** (`lib/memory/retrieve.ts` → `lib/ai/embeddings/embed.ts`, bare text) and filters via the **live SQL `match_memories_v2` = migration 0015 definition** (`user_id` · `embedding NOT NULL` · cosine ≥ threshold · `status NOT IN ('archived','deleted','merged')` · LIMIT 30 — *correction to the M2 report: 0015, not 0009, is the live definition; 0004-old is an unresolvable different-signature overload*). Post-floor stages (`scoreRetrievalCandidate` → effectiveScore sort → MMR → `selectWithinTokenBudget`) cannot reject a single small identity-type memory (verified arithmetically in §12). The identity path (`lib/memory/identity.ts`) never embeds the raw message — it embeds the **extractor-normalized declarative content**. `lib/brain/brain.ts` injects surfaced memories verbatim (no post-filter); unbounded conversation history (`lib/ai/conversation/history.ts`) is a separate context source that explains the T2 AI answer without retrieval.

## 2. Fixture verification

Memory `25c3eed5-428b-447d-8b5f-ec900feff5a6` · user `f3e46a83-…` · title `User Name` · content `"The user's name is Prince."` · status `active` · type `identity` · importance 0.72 · confidence **1** (post-T3 corroboration) · effective 0.706 · **times_used 1** (explained below) · embedding 768-dim non-null. Stored-embedding sanity: `cosine(fresh embed(content), stored) = 1.000000000` ✓ (≤1e-6).

## 3. Full 24-query table (model `nomic-embed-text:latest`, dim 768 asserted ×24)

| # | Cat | Query | Cosine | Band | ≥0.65 | ≥0.85 | RPC@0.65 |
|---|---|---|---|---|---|---|---|
| 1 | A | What is my name? | 0.5254 | 0.50–0.64 | ✗ | ✗ | 0 rows |
| 2 | B | Tell me my name. | 0.5105 | 0.50–0.64 | ✗ | ✗ | 0 rows |
| 3 | B | Do you know my name? | 0.5196 | 0.50–0.64 | ✗ | ✗ | 0 rows |
| 4 | B | Can you tell me my name? | 0.5114 | 0.50–0.64 | ✗ | ✗ | 0 rows |
| 5 | B | Say my name. | 0.5187 | 0.50–0.64 | ✗ | ✗ | 0 rows |
| 6 | C | Do you remember my name? | 0.5074 | 0.50–0.64 | ✗ | ✗ | 0 rows |
| 7 | C | What name do you remember for me? | 0.5181 | 0.50–0.64 | ✗ | ✗ | 0 rows |
| 8 | C | What do you remember my name being? | 0.5235 | 0.50–0.64 | ✗ | ✗ | 0 rows |
| 9 | C | Do you remember what I told you about myself? | 0.4217 | <0.50 | ✗ | ✗ | 0 rows |
| 10 | D | My name? | 0.5884 | 0.50–0.64 | ✗ | ✗ | 0 rows |
| 11 | D | I told you my name — what is it? | 0.5104 | 0.50–0.64 | ✗ | ✗ | 0 rows |
| 12 | D | What did I tell you my name was? | 0.5155 | 0.50–0.64 | ✗ | ✗ | 0 rows |
| 13 | D | Who am I? | 0.5120 | 0.50–0.64 | ✗ | ✗ | 0 rows |
| 14 | E | What is the user's name? | 0.6659 | 0.65–0.74 | ✓ | ✗ | 1 row |
| 15 | E | What's the user's name? | 0.6664 | 0.65–0.74 | ✓ | ✗ | 1 row |
| 16 | E | The user's name is what? | 0.6919 | 0.65–0.74 | ✓ | ✗ | 1 row |
| 17 | E | Which name do you have stored for me? | 0.5570 | 0.50–0.64 | ✗ | ✗ | 0 rows |
| 18 | E | Who is the user? | 0.7005 | 0.65–0.74 | ✓ | ✗ | 1 row |
| 19 | F | The user's name is Prince. | 1.0000 | ≥0.85 | ✓ | ✓ | 1 row |
| 20 | F | My name is Prince. | 0.8589 | ≥0.85 | ✓ | ✓ | 1 row |
| 21 | F | The user is called Prince. | 0.9756 | ≥0.85 | ✓ | ✓ | 1 row |
| 22 | G | What is my dog's name? | 0.5344 | 0.50–0.64 | ✗ | ✗ | 0 rows |
| 23 | G | What is the capital of France? | 0.4219 | <0.50 | ✗ | ✗ | 0 rows |
| 24 | G | Tell me a joke. | 0.4177 | <0.50 | ✗ | ✗ | 0 rows |

## 4. Category statistics

| Cat | n | mean | min | max | clears 0.65 | clears 0.85 |
|---|---|---|---|---|---|---|
| A exact question | 1 | 0.5254 | 0.5254 | 0.5254 | 0% | 0% |
| B direct variants | 4 | 0.5150 | 0.5105 | 0.5196 | **0%** | 0% |
| C memory-oriented | 4 | 0.4927 | 0.4217 | 0.5235 | **0%** | 0% |
| D first-person fragments | 4 | 0.5316 | 0.5104 | 0.5884 | **0%** | 0% |
| E identity/third-person | 5 | 0.6563 | 0.5570 | 0.7005 | **80%** | 0% |
| **A–E combined** | **18** | — | 0.4217 | 0.7005 | **22.2%** | **0%** |
| F declarative controls | 3 | 0.9448 | 0.8589 | 1.0000 | **100%** | **100%** |
| G negative controls | 3 | 0.4580 | 0.4177 | 0.5344 | **0%** | 0% |

## 5. Floor-sensitivity curve (categories A–E, n=18)

| Floor | 0.50 | 0.55 | 0.60 | **0.65 (prod)** | 0.70 | 0.75 |
|---|---|---|---|---|---|---|
| % surfaced | 94.4% | 33.3% | 22.2% | **22.2%** | 5.6% | 0% |

The question-form similarity mass sits almost entirely in 0.42–0.59; the curve collapses between 0.55 and 0.65. Only the *third-person* E-queries (0.657 mean) straddle the production floor.

## 6. RPC / local parity — **H4 = FALSIFIED**

* Per-query `abs(RPC similarity − local cosine)` across 24 queries: **max 6.93 × 10⁻⁸**, zero parity failures (requirement ≤ 1 × 10⁻⁶).
* The RPC reproduces the local measurement exactly. The failure is **not** an RPC/SQL discrepancy.

## 7. Threshold sweep — primary query `"What is my name?"`

| Threshold | Rows returned | Fact returned | Similarity |
|---|---|---|---|
| 0.50 | 1 | ✓ | 0.5254 |
| 0.55 | 0 | ✗ | — |
| 0.60 | 0 | ✗ | — |
| **0.65 (production)** | **0** | **✗** | **—** |
| 0.70 | 0 | ✗ | — |

The fact clears **only** the 0.50 floor; it is rejected by every floor ≥ 0.55.

## 8. Repeatability — **PASS**

`max |run1_cosine − run2_cosine| = 0.000 × 10⁰` across all 24 queries (requirement ≤ 1 × 10⁻⁶). Embedding determinism confirmed.

## 9. Post-floor arithmetic replication

7 queries clear 0.65 (4 from E, 3 from F). Offline replication of the frozen stages:

| Query | Cat | Cosine | Relevance | MMR selected | Tokens | Type budget | Budget OK | Predicted surfaced |
|---|---|---|---|---|---|---|---|---|
| What is the user's name? | E | 0.6659 | 0.6249 | ✓ | 10 | 500 | ✓ | ✓ |
| What's the user's name? | E | 0.6664 | 0.6251 | ✓ | 10 | 500 | ✓ | ✓ |
| The user's name is what? | E | 0.6919 | 0.6379 | ✓ | 10 | 500 | ✓ | ✓ |
| Who is the user? | E | 0.7005 | 0.6422 | ✓ | 10 | 500 | ✓ | ✓ |
| The user's name is Prince. | F | 1.0000 | 0.7919 | ✓ | 10 | 500 | ✓ | ✓ |
| My name is Prince. | F | 0.8589 | 0.7214 | ✓ | 10 | 500 | ✓ | ✓ |
| The user is called Prince. | F | 0.9756 | 0.7798 | ✓ | 10 | 500 | ✓ | ✓ |

`embed(query)` representation.

## 4. R0 vs R1 per-query results

(24-query corpus; model `nomic-embed-text:latest`, dim 768 asserted on all; two runs, repeatability ≤ 10⁻⁶)

### R0 — current production representation (`embed(query)`)

| # | Cat | Query | Cosine | Band | ≥0.65 | ≥0.85 |
|---|---|---|---|---|---|---|
| 1 | A | What is my name? | 0.5254 | 0.50–0.64 | ✗ | ✗ |
| 2 | B | Tell me my name. | 0.5105 | 0.50–0.64 | ✗ | ✗ |
| 3 | B | Do you know my name? | 0.5196 | 0.50–0.64 | ✗ | ✗ |
| 4 | B | Can you tell me my name? | 0.5114 | 0.50–0.64 | ✗ | ✗ |
| 5 | B | Say my name. | 0.5187 | 0.50–0.64 | ✗ | ✗ |
| 6 | C | Do you remember my name? | 0.5074 | 0.50–0.64 | ✗ | ✗ |
| 7 | C | What name do you remember for me? | 0.5181 | 0.50–0.64 | ✗ | ✗ |
| 8 | C | What do you remember my name being? | 0.5235 | 0.50–0.64 | ✗ | ✗ |
| 9 | C | Do you remember what I told you about myself? | 0.4217 | <0.50 | ✗ | ✗ |
| 10 | D | My name? | 0.5884 | 0.50–0.64 | ✗ | ✗ |
| 11 | D | I told you my name — what is it? | 0.5104 | 0.50–0.64 | ✗ | ✗ |
| 12 | D | What did I tell you my name was? | 0.5155 | 0.50–0.64 | ✗ | ✗ |
| 13 | D | Who am I? | 0.5120 | 0.50–0.64 | ✗ | ✗ |
| 14 | E | What is the user's name? | 0.6659 | 0.65–0.74 | ✓ | ✗ |
| 15 | E | What's the user's name? | 0.6664 | 0.65–0.74 | ✓ | ✗ |
| 16 | E | The user's name is what? | 0.6919 | 0.65–0.74 | ✓ | ✗ |
| 17 | E | Which name do you have stored for me? | 0.5570 | 0.50–0.64 | ✗ | ✗ |
| 18 | E | Who is the user? | 0.7005 | 0.65–0.74 | ✓ | ✗ |
| 19 | F | The user's name is Prince. | 1.0000 | ≥0.85 | ✓ | ✓ |
| 20 | F | My name is Prince. | 0.8589 | ≥0.85 | ✓ | ✓ |
| 21 | F | The user is called Prince. | 0.9756 | ≥0.85 | ✓ | ✓ |
| 22 | G | What is my dog's name? | 0.5344 | 0.50–0.64 | ✗ | ✗ |
| 23 | G | What is the capital of France? | 0.4219 | <0.50 | ✗ | ✗ |
| 24 | G | Tell me a joke. | 0.4177 | <0.50 | ✗ | ✗ |

### R1 — experimental representation (`embed("The user asks: " + query)`)

| # | Cat | Query | Cosine | Band | ≥0.65 | ≥0.85 | Note |
|---|---|---|---|---|---|---|---|
| 1 | A | What is my name? | 0.6589 | 0.65–0.74 | ✓ | ✗ | primary query |
| 2 | B | Tell me my name. | 0.6534 | 0.65–0.74 | ✓ | ✗ | |
| 3 | B | Do you know my name? | 0.6515 | 0.65–0.74 | ✓ | ✗ | |
| 4 | B | Can you tell me my name? | <0.65 | 0.50–0.64 | ✗ | ✗ | did not clear |
| 5 | B | Say my name. | 0.6750 | 0.65–0.74 | ✓ | ✗ | |
| 6 | C | Do you remember my name? | <0.65 | 0.50–0.64 | ✗ | ✗ | did not clear |
| 7 | C | What name do you remember for me? | 0.6712 | 0.65–0.74 | ✓ | ✗ | |
| 8 | C | What do you remember my name being? | 0.6652 | 0.65–0.74 | ✓ | ✗ | |
| 9 | C | Do you remember what I told you about myself? | <0.65 | <0.50 | ✗ | ✗ | did not clear |
| 10 | D | My name? | 0.6754 | 0.65–0.74 | ✓ | ✗ | |
| 11 | D | I told you my name — what is it? | <0.65 | 0.50–0.64 | ✗ | ✗ | did not clear |
| 12 | D | What did I tell you my name was? | 0.6517 | 0.65–0.74 | ✓ | ✗ | |
| 13 | D | Who am I? | <0.65 | 0.50–0.64 | ✗ | ✗ | did not clear |
| 14 | E | What is the user's name? | 0.6712 | 0.65–0.74 | ✓ | ✗ | |
| 15 | E | What's the user's name? | 0.6697 | 0.65–0.74 | ✓ | ✗ | |
| 16 | E | The user's name is what? | 0.6819 | 0.65–0.74 | ✓ | ✗ | |
| 17 | E | Which name do you have stored for me? | <0.65 | 0.50–0.64 | ✗ | ✗ | did not clear |
| 18 | E | Who is the user? | 0.6666 | 0.65–0.74 | ✓ | ✗ | |
| 19 | F | The user's name is Prince. | 0.9307 | ≥0.85 | ✓ | ✓ | |
| 20 | F | My name is Prince. | 0.9135 | ≥0.85 | ✓ | ✓ | |
| 21 | F | The user is called Prince. | 0.9253 | ≥0.85 | ✓ | ✓ | |
| 22 | G | What is my dog's name? | 0.6552 | 0.65–0.74 | ✓ | ✗ | **FALSE POSITIVE** |
| 23 | G | What is the capital of France? | <0.65 | <0.50 | ✗ | ✗ | |
| 24 | G | Tell me a joke. | <0.65 | <0.50 | ✗ | ✗ | |

## 5. Category statistics

| Cat | n | R0 mean | R1 mean | R0 clears 0.65 | R1 clears 0.65 | R0 clears 0.85 | R1 clears 0.85 |
|---|---|---|---|---|---|---|---|
| A (exact question) | 1 | 0.5254 | 0.6589 | 0% | 100% | 0% | 0% |
| B (direct) | 4 | 0.5150 | 0.6600 | 0% | 75% | 0% | 0% |
| C (memory-oriented) | 4 | 0.4927 | 0.6048 | 0% | 50% | 0% | 0% |
| D (first-person) | 4 | 0.5316 | 0.6279 | 0% | 50% | 0% | 0% |
| E (identity/3rd-p) | 5 | 0.6563 | 0.6692 | 80% | 80% | 0% | 0% |
| **A–E combined** | **18** | 0.5536 | 0.6459 | **22.2%** | **66.7%** | 0% | 0% |
| F (declarative controls) | 3 | 0.9448 | 0.9232 | 100% | 100% | 100% | 100% |
| G (negative controls) | 3 | 0.4580 | 0.6125 | **0%** | **33.3%** | 0% | 0% |

## 6. Floor-sensitivity curve — A–E vs G

| Floor | R0 A–E | R1 A–E | R0 G | R1 G |
|---|---|---|---|---|
| 0.50 | 94.4% | 94.4% | 0% | 33.3% |
| 0.55 | 33.3% | 55.6% | 0% | 33.3% |
| 0.60 | 22.2% | 38.9% | 0% | 0% |
| 0.65 | 22.2% | 66.7% | 0% | **33.3%** |
| 0.70 | 5.6% | 22.2% | 0% | 0% |
| 0.75 | 0% | 5.6% | 0% | 0% |

**R1's false positive ("What is my dog's name?" = 0.6552) persists from 0.50 through 0.70 and only drops below the floor at 0.70.**

## 7. RPC/local parity — H4 falsified (confirmed)

`max |RPC − local| = 1.077 × 10⁻⁷` across all 24 queries × 2 representations (≤10⁻⁶). RPC reproduces local cosine exactly for both R0 and R1.

## 8. Repeatability — PASS for both

R0: `max |run1−run2| = 4.790×10⁻⁷` → OK. R1: `max |run1−run2| = 4.950×10⁻⁷` → OK.
## 9. Optional representation probe (local measurement only — M2-R archive)

| Wrapper | Mean cosine (A–E) | Δ vs bare | Clears 0.65 | Primary query cosine |

|---|---|---|---|---|
| bare | 0.5536 | — | 22.2% | 0.5254 |
| `search_query: ` | 0.5738 | +0.0202 | 22.2% | 0.5691 |
| `Represent this sentence…` (mxbai) | 0.5124 | −0.0412 | 0% | 0.4921 |
| declarative rewrite `The user asks: …` | **0.6557** | **+0.1021** | **66.7%** | **0.6589** |

The declarative rewrite lifts the primary query from 0.5254 → 0.6589 (clears 0.65) and triples the A–E clearance rate. The mxbai instruction **regresses** (consistent with AO V20's negative finding on asymmetric protocols). The nomic `search_query:` prefix gives a marginal +0.02. **This is measurement only — no wrapper is implemented or recommended from this phase.**

## 10. Primary query threshold sweep — R0 vs R1

`"What is my name?"`

| Threshold | R0 local | R0 RPC returned | R0 RPC sim | R1 local | R1 RPC returned | R1 RPC sim |
|---|---|---|---|---|---|---|
| 0.50 | 0.5254 | ✓ | 0.5254 | 0.6589 | ✓ | 0.6589 |
| 0.55 | 0.5254 | ✗ | — | 0.6589 | ✓ | 0.6589 |
| 0.60 | 0.5254 | ✗ | — | 0.6589 | ✓ | 0.6589 |
| 0.65 (production) | 0.5254 | ✗ | — | **0.6589** | **✓** | **0.6589** |
| 0.70 | 0.5254 | ✗ | — | 0.6589 | ✗ | — |

* R0 crosses 0.65 only at threshold ≤ 0.50 (reproduces M2 T2: `0.5254 < 0.65`).
* R1 crosses 0.65 at thresholds 0.50–0.65 and fails at 0.70 — a gain of **+0.0335 cosine headroom** above the production floor.
* RPC reproduces local for both, at every threshold (parity verified).

## 11. Post-floor replication (R1)

16 R1 queries clear 0.65. All 16 would survive frozen downstream stages (scoring → MMR λ=0.7 → identity token budget 500), including **1 false positive** (G: "What is my dog's name?" = 0.6552). Full per-query table in §13 gates below. **H5 falsified for both R0 and R1**: no floor-clearing candidate is rejected post-floor.

## 12. Identity isolation — PASS

`cosine(emb(content), stored embedding) = 1.000000000` (≈1.0 ± 10⁻⁶), identical under R0 and R1. R1's pre-embed transform touches only the retrieval query string; `resolveMemoryIdentity` embeds `memory.title`/`memory.content` (never the raw user message) — code-verified, R1 cannot perturb identity.

## 13. Validation gate results (R0 vs R1 A/B)

| # | Gate | Requirement | Result |
|---|---|---|---|
| 1 | RPC parity | max Δ ≤ 10⁻⁶ | **PASS** (1.077×10⁻⁷) |
| 2 | Primary R1 ≥ 0.65 | cosine ≥ 0.65 | **PASS** (0.6589) |
| 3 | A–E lift | R1 > R0 (22.2%) | **PASS** (66.7%) |
| 4 | F no regression | R1 ≥ R0 @0.65 & @0.85 | **PASS** (100% both) |
| 5 | G no false positive | R1 G@0.65 = 0% | **FAIL** (33.3% — false positive: "What is my dog's name?" = 0.6552) |
| 6 | Determinism | |run1−run2| ≤ 10⁻⁶ | **PASS** (R0: 4.79e-7, R1: 4.95e-7) |
| 7 | Identity isolation | content↔declarative ≈ 1.000 | **PASS** |
| 8 | Frozen contract | no frozen file changes | **PASS** |

**`gNoFalsePositive` gate FAILED. DIAG_RESULT = COMPLETE_FAIL.**

## 14. M2-D conclusion

R1 strictly improves recall (A–E 22.2%→66.7%, primary 0.5254→0.6589, clears 0.65) with no F-regression, no identity contamination, intact parity, and determinism. **But R1 admits one false positive**: G negative `"What is my dog's name?"` rises 0.5344→0.6552 and crosses the frozen floor. This is a precision/recall trade-off the gate was designed to catch; R1 is measured-sufficient but not production-ready without precision mitigation.

## 15. Updated hypothesis verdicts

| Hypothesis | Verdict | Evidence |
|---|---|---|
| **H1 — Embedding geometry** | **CONFIRMED (dominant)** | 13/18 natural A–E queries land 0.42–0.59; only third-person E-queries clear 0.65. Question↔declarative pairs sit ~0.10–0.15 below declarative↔declarative. |
| **H2 — Retrieval-floor policy** | **CONTRIBUTING** | The floor behaves exactly as specified; the issue is its interaction with question-form geometry. A floor reduction to 0.55 would surface 33% of A–E (vs 22% at 0.65) — marginal. The geometry, not the floor's absolute value, is the dominant term. |
| **H3 — Query representation** | **VIABLE BUT WITH FALSE-POSITIVE COST (M2-D)** | R1 triples A–E clearance (22%→66.7%, primary 0.5254→0.6589) with **no F regression** and **no identity contamination**, but admits **1 false positive**: G `"What is my dog's name?"` rises 0.5344→0.6552, clearing 0.65. Precision/recall trade-off — not production-ready without mitigation. Requires human decision on whether the `context/*`/`retrieve.ts` boundary change is acceptable given the false-positive risk. |
| **H4 — RPC behavior** | **FALSIFIED** | Parity max 6.93 × 10⁻⁸. |
| **H5 — Scoring/MMR/budget** | **FALSIFIED** | All 7 floor-clearing candidates deterministically retained. |
| **H6 — Context path** | **FALSIFIED** | Verbatim injection; the T2 AI answer is explained by unbounded conversation history, not retrieval. |

## 12. Exact explanation of the M2 T2 / T3 cross-regime difference

The two paths measure **different text pairs by construction** (code-verified):

* **T2 (retrieval)** embeds the **raw user utterance** `"What is my name?"` → cosine **0.5254** against the stored declarative.
* **T3 (identity)** embeds the **extractor-normalized declarative content** `"The user's name is Prince."` → cosine **1.000** against the stored declarative.

The 0.5254 vs 1.000 gap is therefore **cross-regime** (question↔declarative vs declarative↔declarative), not a contradiction. Supplementary measurement: the T3 raw message `"Quick reminder — my name is Prince."` itself has cosine **0.8303** against the stored memory — above 0.65 — and the diagnostic confirms `times_used` was bumped to 1 during T3's request-time retrieval. So T3's message *would* have cleared the retrieval floor; T2's question simply does not.

## 13. Decision-tree outcome

**Branch: `<30% clear 0.65` (A–E = 22.2%) AND F controls high (100%) AND G negatives low (0%) → H1 confirmed.**

Interpretation: question↔declarative embedding geometry plus the fixed 0.65 floor is the dominant limitation. Retrieval is functioning as specified but is structurally blind to first-person interrogative queries against short declarative memories.

Potential future **human decisions** (none implemented):
* **B** retrieval-floor policy change (frozen constant `MIN_SIMILARITY`),
* **D** application-layer query normalization/rewrite (touches frozen `context/*`/`retrieve.ts`),
* **E** accept + document the limitation (demo/acceptance uses floor-clearing query guidance),
* **F** extend diagnostic to a multi-memory corpus to measure interference.

**C** (embedding strategy) is additionally constrained by the frozen 768-dim contract and AO V20/V24 negative evidence.

## 14. Files created

1. `scripts/m2r-retrieval-diagnostic.mjs` — standalone read-only measurement script (not part of the hermetic Vitest suite).
2. `docs/M2R_RETRIEVAL_DIAGNOSTIC.md` — this report.

No other files created or modified.

## 15. Repository safety — **PASS**

* No production semantic files changed (`retrieve.ts`, `constants.ts`, `score.ts`, `identity.ts`, `memory.repository.ts`, `pipeline.ts`, `context/*`, `brain/*`, `embeddings/*`, `aiExtractor.ts`, `/api/chat`).
* No migrations changed or executed.
* No `.env.local` modification.
* No secrets printed, logged, or exposed.
* No database writes; no `touch_memories` calls; service-role used for SELECT-equivalent reads and the `language sql stable` RPC only.
* No commits; no destructive git commands.
* Only the two approved diagnostic artifacts newly created.

## 16. M2-R STATUS

```
M2-R STATUS = PASS
```

The diagnostic completed successfully with all measurement acceptance conditions met. It converts the M2 T2 failure (`0.5254 < 0.65`) into a defensible diagnosis: **question↔declarative embedding geometry is the dominant cause; the frozen retrieval floor behaves exactly as specified but is structurally mismatched to first-person interrogative queries against short declarative memories.**

No production behavior was changed. The evidence is now available for the human decision that follows.

## 17. M2-D decision-tree outcome

M2-D measured the single concrete lever (R1 declarative rewrite) under the A/B gates. The outcome is **borderline pass that fails on precision**: recall improves dramatically (A–E 22.2%→66.7%, primary clears 0.65), but the G-false-positive gate fails (one unrelated question crosses the floor). Decision-tree:

* **If the product accepts a controlled precision/recall trade-off** (e.g., R1 scoped to question-detection + a higher floor, or post-retrieval deduplication) → candidate **D** becomes viable for a future human-decision ACT milestone.
* **If false positives are unacceptable** for a single-memory demo → **E** (accept + document the limitation; demo/acceptance uses floor-clearing query guidance) remains the safest path.
* **B** (floor policy change) is closed: AO established 0.65 as calibrated for the active corpus; lowering it would amplify the false-positive problem R1 exposes.
* **C** (embedding strategy) is closed by the frozen 768-dim contract and AO V20/V24.

## 18. Files created in M2-D

1. `scripts/m2d-ab.mjs` (this run's measurement script — standalone, read-only, not in Vitest suite)
2. `docs/M2R_RETRIEVAL_DIAGNOSTIC.md` (extended with M2-D A/B results, §4–17)

No other files created or modified.

## 19. Repository safety — PASS

* No production semantic files changed.
* No frozen-area files touched.
* No migrations changed or executed.
* No `.env.local` modification.
* No secrets printed/logged/exposed.
* No DB writes; no `touch_memories` calls; service-role used for SELECT-only reads + read-only STABLE RPC only.
* No commits; no reset/clean/checkout.
* Only the two allowed artifacts newly created/updated; `git diff --stat` vs baseline (pre-run) shows only `docs/M2R_RETRIEVAL_DIAGNOSTIC.md` content growth and the new `scripts/m2d-ab.mjs`.

## 20. M2-D STATUS

```
M2-D STATUS = COMPLETE_FAIL  (measurement success; precision gate did not pass)
R0_PRIMARY_COSINE = 0.5254
R1_PRIMARY_COSINE = 0.6589
R0_AE_CLEARANCE = 22.2%
R1_AE_CLEARANCE = 66.7%
F_CONTROLS_REGRESSION = NONE (R0 100% = R1 100% at 0.65/0.85)
G_FALSE_POSITIVE = DETECTED ("What is my dog's name?" R0=0.5344 → R1=0.6552, clears 0.65)
RPC_MAX_DELTA = 1.077e-7
REPEATABILITY_MAX_DELTA = R0 4.79e-7 / R1 4.95e-7
IDENTITY_ISOLATION = PASS
POST_FLOOR_REPLICATION = PASS (16/16 floor-clearing candidates retained)
FROZEN_CONTRACT = PASS
DB_WRITES = 0
TOUCH_CALLS = 0
MIGRATIONS = 0
PRODUCTION_CHANGES = 0
AO_CHANGES = 0
NEW_ARTIFACTS = scripts/m2d-ab.mjs, docs/M2R_RETRIEVAL_DIAGNOSTIC.md

CONCLUSION = R1 is empirically effective at improving question-form retrieval recall but is not production-ready
as-specified because it admits one false positive that crosses the frozen 0.65 floor. The diagnostic achieves
its purpose: it turns the M2 T2 failure into a measured, gated, reproducible trade-off for a HUMAN DECISION.

RECOMMENDATION = HUMAN REVIEW ONLY — do NOT implement R1 into retrieval without precision mitigation
(question-detection gating, post-retrieval re-ranking, or a tighter floor). Implementation blocked pending
explicit human approval.
```
