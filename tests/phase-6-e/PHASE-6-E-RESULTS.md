# PHASE 6-E — CONTROLLED REFLECTION MEASUREMENT — FINAL REPORT

**Status:** MEASUREMENT ONLY — no production behavior changed.
**Source of truth:** `tests/phase-6-e/results.json` (canonical raw dataset) and `tests/phase-6-e/eligibility.json`.
**Computed with:** `tests/phase-6-e/summarize.mjs` (experiment-matrix definition), `tests/phase-6-e/rubric.mjs` (deterministic quality rubric).
**Models:** `qwen2.5:3b` (production) and `qwen3:4b` (candidate) via local Ollama `http://127.0.0.1:11434/api/chat`.
**Sampling parameters (all cells):** temperature `0.1`, `num_predict` `300`, `top_p` `0.8`, `num_ctx` `4096`, `stream: false`. No `format:"json"` was set (matching production).

---

## 1. Executive Verdict

**The historical production `[]` problem was NOT reproduced on the controlled, grounded fixtures.**

| Question | Result |
|---|---|
| Did `qwen2.5:3b` under the production prompt (P0) return valid, evidence-backed reflections on grounded fixtures? | **YES — 14/15 runs produced reflections, all 14 classified GOOD (0 BAD).** |
| Did `qwen2.5:3b` "frequently choose `[]`"? | **NOT REPRODUCED.** Model-generated valid `[]` = 2/15 runs (13%) across scenarios A/B/C under P0. |
| Did any prompt variant monotonically reduce `[]` by reducing conservative wording? | **NO — behavior is non-monotonic.** The *least* conservative variant (P1) produced 100% `[]` (15/15). |
| Did type-grouping systematically block synthesis? | **NOT SUPPORTED.** Production-shaped grouped input produced reflections (B: 80%, C: 100%); the experiment "combined" representation produced 100% `[]`. |
| Did the alternative model produce usable output? | **No, but this is an invocation-configuration artifact, not a reasoning-capability measurement.** `qwen3:4b` under identical parameters emitted *empty text* (0% valid JSON, 0% literal `[]`) because its thinking mode consumed the entire `num_predict` token budget (`message.thinking` present, `done_reason: "length"`). |
| Was production eligibility throughput measured? | **NO — INDETERMINATE.** Read-only probe returned HTTP 200 with 0 rows; RLS blocks anon/no-session reads. |

**What is supported:** Controlled fixtures do not support the claim that `qwen2.5:3b` + the production prompt is *inherently unable* to produce grounded reflections.

**What is NOT supported / unmeasured:** Whether the production pipeline reliably produces useful reflections for real users (production candidate composition, eligibility pass-rate, real group sizes, and real extraction signals are all **unmeasured**).

**Conclusions must not overreach:** the controlled fixtures rule out some explanations for the historical `[]`, but they do NOT establish a production root cause. Mechanism A (no eligible candidates -> model never called) remains entirely plausible and is unmeasured.

---

## 2. Experiment Inventory

| Experiment | Conditions | Effective Runs | Stored unique records |
| --- | --- | ---: | ---: |
| A — Model A/B | `qwen2.5:3b` vs `qwen3:4b`, P0, scenarios A/B/C | 30 | 30 |
| B — Prompt A/B | P0/P1/P2/P3 × scenarios A/B/C on `qwen2.5:3b` | 60 | 60 |
| G — Grouping | grouped vs combined × scenarios B/C on `qwen2.5:3b`, P0 | 20 | 20 (10 shared) |
| **Total** | | **110** | **85** |

**Why 85 unique records represent 110 effective cells:** three conditions are identical by construction — Experiment A's `qwen2.5:3b|P0` arm (15 runs), Experiment B's `P0` arm (15 runs), and Experiment G's `grouped` arm (10 runs) all use the same model (`qwen2.5:3b`), the same production prompt (P0), the same grouped fixture input, and the same parameters. These records are stored once and intentionally shared (the runner deduplicates on `model|promptVariant|scenario|variant|run`). Every stored record retains its raw `rawOutput`.

Matrix completeness (verified by `summarize.mjs`): **17/17 required cells at 5/5 runs, 0 duplicate keys.**

---

## 3. Experiment A — Model A/B

Condition: P0 prompt, grouped (production-shaped) input, 5 runs per cell. All raw output is in `results.json`.

### `qwen2.5:3b` (production baseline)

| Scenario | Runs | valid `[]` rate | valid JSON | malformed/non-array | empty text | sanitizer acceptance | final count (mean) | GOOD | BAD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A (2 semantic) | 5 | 0% | 100% | 0% | 0% | 100% (5/5) | 1.000 | 5/5 | 0/5 |
| B (identity+semantic) | 5 | 20% (1/5) | 100% | 0% | 0% | 100% (4/4) | 0.800 | 4/4 | 0/4 |
| C (3 semantic + 2 identity) | 5 | 0% | 100% | 0% | 0% | 100% (5/5) | 1.000 | 5/5 | 0/5 |

Aggregate `qwen2.5:3b`: **valid `[]` 2/15 (13%)**, valid JSON 100%, malformed 0%, empty text 0%, GOOD 14/14 accepted, BAD 0/14.

### `qwen3:4b` (candidate, identical invocation)

| Scenario | Runs | valid `[]` rate | valid JSON | malformed/non-array | empty text | sanitizer acceptance | final count (mean) | GOOD | BAD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 5 | 0% | 0% | 0% | 100% (5/5) | n/a (no parsed items) | 0.000 | 0/0 | 0/0 |
| B | 5 | 0% | 0% | 0% | 100% (5/5) | n/a | 0.000 | 0/0 | 0/0 |
| C | 5 | 0% | 0% | 0% | 100% (5/5) | n/a | 0.000 | 0/0 | 0/0 |

### Interpretation

- **The candidate is NOT measurably "better" — it produced nothing usable under identical parameters.** This is a measured *invocation-configuration behavior*: qwen3:4b (Ollama 0.32.14) enables thinking mode by default; on a minimal probe it returned `message.content: ""` with `message.thinking` populated and `done_reason: "length"`, i.e. the 300-token budget was consumed by reasoning before any content token was emitted. Diagnostically (outside this matrix), with `num_predict: 600` it produced reasoning plus a final valid JSON array — consistent with a token-budget interaction, **not** a claim about qwen3's reasoning capability.
- **Do NOT read the A/B result as "qwen2.5:3b beats qwen3:4b".** The honest statement is: under the production parameter set, qwen2.5:3b produces valid output and qwen3:4b produces empty text. The A arm therefore **cannot discriminate model capability**; it discriminates *model + invocation configuration behavior*.
- Distinct outcomes to keep separate: valid `[]` (2 runs, qwen2.5:3b) != empty text (15 runs, qwen3:4b) != malformed JSON (0 runs) != valid useful reflection (35 runs overall).

---

## 4. Experiment B — Prompt A/B

Condition: `qwen2.5:3b`, grouped (production-shaped) input, 5 runs per cell.

| Prompt | Scenario | Runs | valid `[]` rate | valid JSON | GOOD | BAD |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| P0 (production) | A | 5 | 0% | 100% | 5/5 | 0/5 |
| P0 | B | 5 | 20% | 100% | 4/4 | 0/4 |
| P0 | C | 5 | 0% | 100% | 5/5 | 0/5 |
| P1 (reduced conservatism) | A | 5 | **100%** | 100% | 0/0 | 0/0 |
| P1 | B | 5 | **100%** | 100% | 0/0 | 0/0 |
| P1 | C | 5 | **100%** | 100% | 0/0 | 0/0 |
| P2 (evidence-backed + example) | A | 5 | 0% | 100% | 0/5 | **5/5** |
| P2 | B | 5 | 80% | 100% | 1/1 | 0/1 |
| P2 | C | 5 | 80% | 100% | 0/1 | **1/1** |
| P3 (two-stage) | A | 5 | 0% | 100% | 4/5 | 1/5 |
| P3 | B | 5 | **0%** | 100% | 5/5 | 0/5 |
| P3 | C | 5 | 20% | 100% | 2/4 | 2/4 |

Aggregates (all scenarios, 15 runs per prompt):

| Prompt | valid `[]` rate | accepted reflections | GOOD | BAD |
| --- | ---: | ---: | ---: | ---: |
| P0 | 6.7% (1/15) | 14 | 14 | 0 |
| P1 | **100% (15/15)** | 0 | 0 | 0 |
| P2 | 53.3% (8/15) | 7 | 1 | 6 |
| P3 | 6.7% (1/15) | 14 | 11 | 3 |

### Interpretation

- **"Less conservative wording => fewer `[]`" is NOT supported and is contradicted in the extreme:** P1, the most de-conservatized prompt (removed the `[]`-preference sentence, softened Rule 7, removed the final AND-gate checklist), produced `[]` in **100% of runs** (15/15 at temperature 0.1). The relationship between prompt wording and `[]` is **non-monotonic**; no causal claim is made beyond what is observed.
- **P2 introduced a different failure mode:** its added positive example mirrors Scenario A (dark mode + OLED). The model latched onto the in-prompt example and emitted it near-verbatim ("Dark Display Preference") in 5/5 A-runs; the automated rubric classified all 5 as BAD/HARMFUL (unsupported tokens sourced from the prompt example rather than the supplied memories). P2 also produced 80% `[]` on B and C. This is an *example-copy artifact*, not improved synthesis.
- **P3 (two-stage) is the only variant that reduced or matched P0's `[]` rate while keeping a high GOOD rate** — but it is not unambiguously better: GOOD rate fell to 11/14 (78.6%) vs P0's 14/14 (100%), and BAD rose from 0 to 3. At n=15 per prompt this is suggestive, not conclusive.
- **Reflection count alone is not the criterion.** P2 produced more non-empty runs than P1 but 6/7 of those reflections were BAD — a regression, not an improvement.

---

## 5. Experiment G — Grouping

Condition: `qwen2.5:3b`, P0, 5 runs per cell. Identical underlying memories; only the representation differs (production type-keyed `grouped` vs experiment-only single `combined` group).

| Cell | Runs | valid `[]` rate | valid JSON | accepted reflections | GOOD | BAD | final count (mean) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| B grouped (identity:[1], semantic:[1]) | 5 | 20% (1/5) | 100% | 4 | 4/4 | 0/4 | 0.800 |
| B combined (single group, 2 memories) | 5 | **100% (5/5)** | 100% | 0 | 0/0 | 0/0 | 0.000 |
| C grouped (semantic:[3], identity:[2]) | 5 | 0% | 100% | 5 | 5/5 | 0/5 | 1.000 |
| C combined (single group, 5 memories) | 5 | **100% (5/5)** | 100% | 0 | 0/0 | 0/0 | 0.000 |

### Interpretation

- **Type-grouping is NOT supported as a systematic blocker.** The production-shaped grouped representation produced reflections in 9/10 runs; the experiment's combined representation produced `[]` in 10/10.
- **The combined result is counter to the original grouping hypothesis** and shows that representation differences materially change output. However, it is **not a clean structural test**: the combined cell also changes the `memoryType` label (`"combined"` instead of `"identity"`/`"semantic"`) and the full JSON message structure, so the 100% `[]` cannot be attributed purely to "one group vs many groups." The measurement is therefore:
  - consistent with "grouping is not the cause of `[]` under P0 on these fixtures";
  - INCONCLUSIVE about the mechanism behind the combined-cell `[]` (label artifact? structure artifact? other?).
- The model already synthesizes across type-keyed groups in one request (Scenario B grouped produced "Morning Coffee Routine" from identity + semantic memories), so cross-type evidence was **not** invisible to the model.

---

## 6. Eligibility Probe

Source: `tests/phase-6-e/eligibility.json` (run read-only once).

| Field | Value |
| --- | --- |
| Status | **INDETERMINATE** |
| DB query attempted | Single `limit=1` SELECT against `memories` via Supabase REST (anon key, no user session) |
| HTTP response | 200 |
| Rows returned | 0 |
| Candidate throughput measured | **NO** |

**Production eligibility throughput remains unmeasured.** The probe cannot distinguish an empty `memories` table from RLS blocking unauthenticated reads (`memories_select ... using (auth.uid() = user_id)`, migration 0004). A user session or service key would be required to separate Mechanism A (no eligible candidates -> model never called) from Mechanism B (candidates exist but model returns `[]`). No DB rows were fabricated; no production data was written.

---

## 7. Quality Rubric

The Phase 6-E canonical rubric (`tests/phase-6-e/rubric.mjs`) was applied automatically to every accepted (sanitized, post-`slice(0,2)`) reflection, with the seven criteria:

1. **Evidence** — derives from >= 2 distinct supplied memories (keyword-based, deterministic on these fixtures).
2. **Support** — every content word traceable to a supplied memory or a small allowlist of neutral synthesis connectors.
3. **Synthesis** — adds a relationship/pattern, not a restatement of a single memory.
4. **Uncertainty handling** — fixtures contain no genuine conflicts; invented conflicts are caught by (2).
5. **Specificity** — contains a concrete grounded keyword; not vague.
6. **Duplication** — **DEFERRED** (no live DB; no cosine similarity invented).
7. **Future usefulness** — queryable title, meaningful content, no meta-language about reflecting.

Classification: **GOOD** = passes all applicable criteria (1,2,3,4,5,7); **BAD/HARMFUL** = fails 1, 2, or 3; **NEUTRAL** = fails only 4–7.

Overall, across all 85 stored runs (35 accepted reflections):

| Class | Count | Rate (of accepted) |
| --- | ---: | ---: |
| GOOD | 26 | 74.3% |
| BAD/HARMFUL | 9 | 25.7% |
| NEUTRAL | 0 | 0% |

Criterion-level notes:
- The 9 BAD reflections are concentrated in **P2-A (5, example-copy artifacts)**, **P2-C (1)**, **P3-A (1)**, and **P3-C (2)** — all failing via unsupported content (criterion 2) and/or weak evidence (criterion 1).
- P0 produced **0 BAD reflections** in 14 accepted.
- These are **automated heuristic ratings**; no human rating was performed. Raw outputs are stored for human audit.

---

## 8. Root-Cause Evidence Matrix

| Hypothesis | Evidence | Result |
| --- | --- | --- |
| Eligibility gates dominate (Mechanism A) | Eligibility probe — INDETERMINATE (0 rows, RLS-blocked anon) | **UNVERIFIABLE / UNMEASURED** |
| Prompt conservatism causes `[]` | Experiment B — non-monotonic; least-conservative P1 = 100% `[]`; P3 = 6.7% `[]` | **NOT SUPPORTED** (as a monotonic driver); **INCONCLUSIVE** overall |
| Model capability causes `[]` | Experiment A — `qwen2.5:3b` P0 produced GOOD reflections in 14/15 runs (13% `[]`); qwen3 arm confounded by invocation artifact | **NOT SUPPORTED** for qwen2.5:3b on controlled fixtures; qwen3 comparison **INCONCLUSIVE** (config artifact) |
| Grouping causes `[]` | Experiment G — grouped 10% `[]` (1/10) vs combined 100% `[]` (10/10) | **NOT SUPPORTED** as a blocker; combined-cell mechanism **INCONCLUSIVE** (label confound) |
| Historical production `[]` reproduced | Controlled fixtures under P0 | **NOT REPRODUCED** on these grounded fixtures |

---

## 9. Important Distinction

Two claims must NOT be conflated:

1. **"`qwen2.5:3b` can produce useful reflections under controlled fixtures."** — This is **ESTABLISHED** by Experiment A/B: under production P0 with well-formed, grounded input, the model produced valid JSON in 100% of runs and GOOD reflections in 14/15 runs (13% `[]`, 0 BAD).

2. **"The production pipeline reliably produces useful reflections for real users."** — This is **NOT ESTABLISHED** and remains unmeasured. The controlled fixtures cannot speak to:
   - production eligibility pass-rate (`confidence_v2 >= 0.7`, `importance_v2 >= 0.5`, status) — unmeasured (probe INDETERMINATE);
   - real candidate composition (what memories actually exist per user/type) — unmeasured;
   - real group sizes (single-memory groups prevalence) — unmeasured;
   - real extraction signal quality (the extractor's emitted `confidence`/`importance` distribution) — unmeasured;
   - whether Mechanism A (no candidates -> model never called) dominates production zeros.

The experiments prove the controlled fixtures, not the production pipeline.

---

## 10. Production Decision

**NO PRODUCTION CHANGE IN PHASE 6-E.**

| Candidate change | Decision | Basis |
| --- | --- | --- |
| Switch production model to `qwen3:4b` | **NO** | Under production parameters it emits empty text (0% valid output); switching would degrade output. Also confounded by invocation configuration, so no capability claim is made. |
| Change production prompt (any P1/P2/P3 direction) | **NO** | No variant is a clear win: P1 = 100% `[]`, P2 = example-copy BADs + high `[]`, P3 = matched `[]` but raised BAD from 0 to 3. P0 remains the best overall (14/14 GOOD, 0 BAD, 6.7% `[]`). |
| Change grouping | **NO** | Grouping is not supported as a blocker; combined representation performed worse (100% `[]`). |
| Loosen eligibility thresholds | **NO** | Thresholds were deliberately not touched; eligibility throughput is unmeasured, so any loosening would be unjustified. |

---

## 11. Next Recommended Step

Smallest evidence-based next phase (do NOT jump to a production fix):

**Phase 6-F: Production-side eligibility and candidate-composition measurement.**

Because the only decisive unmeasured mechanism is **Mechanism A** (eligibility throughput), Phase 6-F should:
- measure, read-only and with an authenticated session or service role (in-app instrumented query or an authorized read path), the production distribution of `status`, `confidence_v2`, `importance_v2`, `memory_type`, counts per type, and single-memory vs multi-memory eligible groups;
- determine whether `reflectionInput.length === 0` (model never called) is the dominant zero-reflection path in production;
- only if eligibility is healthy AND production `[]` persists should further prompt/model experiments be warranted (e.g., a larger-n P3 two-stage trial with careful BAD-rate tracking).

Until production eligibility is measured, no production change is justified by Phase 6-E.

---

## 12. Reproducibility

| Item | Location / Value |
| --- | --- |
| Canonical raw dataset | `tests/phase-6-e/results.json` — 85 unique records, 110 effective runs, 0 duplicate keys, 17/17 cells at 5/5 |
| Eligibility result | `tests/phase-6-e/eligibility.json` — INDETERMINATE |
| Runner | `tests/phase-6-e/run.mjs` (cumulative/idempotent; key = `model|promptVariant|scenario|variant|run`) |
| Prompt definitions | `tests/phase-6-e/prompts.mjs` (P0 = exact copy of production `REFLECTION_SYSTEM_PROMPT`; P1/P2/P3 experiment-only) |
| Fixtures | `tests/phase-6-e/fixtures.mjs` (scenarios A/B/C; grouped + combined) |
| Sanitizer copy | `tests/phase-6-e/sanitize.mjs` (exact copy of production `sanitizeReflection`) |
| Quality rubric | `tests/phase-6-e/rubric.mjs` (deterministic 7-criterion; criterion 6 deferred) |
| Summarizer | `tests/phase-6-e/summarize.mjs` (per-condition metrics + matrix completeness) |
| Models | `qwen2.5:3b` (baseline), `qwen3:4b` (candidate) |
| Parameters | temperature `0.1`, `num_predict` `300`, `top_p` `0.8`, `num_ctx` `4096`, `stream:false`, no `format` |
| Endpoint | `http://127.0.0.1:11434/api/chat` |
| Execution | 110 effective runs across Experiments A (30), B (60), G (20); all raw outputs retained |

---

*End of Phase 6-E report. Measurement only — no production file, prompt, model, threshold, migration, or database was changed.*