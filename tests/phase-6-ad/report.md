# Phase 6-AE — Report: Controlled Prompt Sensitivity Experiment

## Status: COMPLETE — INPUT_DOMINANT

**Date:** 2026-08-22
**Phase:** 6-AE — Controlled Prompt Sensitivity Experiment
**Safety:** productionWrites = 0 — no production files modified, no DB writes

---

## 1. Objective

Determine whether specific conservative rules in the production reflection prompt
(`lib/memory/reflector.ts:78-312`, `REFLECTION_SYSTEM_PROMPT`) are **causally
responsible** for the model returning `[]` on the real 21-memory production
input. Hold input, model, config, and all pipeline logic constant; vary ONLY
the prompt rule being relaxed.

---

## 2. Environment

- **OS:** Windows 10 (win32)
- **Ollama:** Available at `http://127.0.0.1:11434`
- **Model:** `qwen2.5:3b`
- **Test runner:** Vitest 2.1.9

---

## 3. Model Configuration

| Parameter     | Value                        |
|---------------|------------------------------|
| Model         | `qwen2.5:3b`                 |
| Temperature   | 0.1                          |
| num_predict   | 300                          |
| top_p         | 0.8                          |
| num_ctx       | 4096                         |
| Endpoint      | `http://127.0.0.1:11434`     |

No model parameters changed from production defaults.

---

## 4. Input Construction

- **Total memories in DB:** 37
- **Eligible after production filter:** 21
- **Filter:** `status IN (active,candidate) AND confidence_v2 >= 0.7 AND importance_v2 >= 0.5`
- **Grouping:** by `memory_type` (production-verbatim reduce from `pipeline.ts:107-142`)

| Type Group | Count |
|---|---|
| reflection | 10 |
| project | 9 |
| identity | 2 |

No memories added, removed, reordered, or altered.

---

## 5. Prompt Fidelity Check

| Field | Value |
|---|---|
| Baseline prompt length | 5136 chars |
| Baseline prompt hash (sha256) | `24aa25c19b439cb5fa988729535a90ebf756498e132e4c5c6157a7a516970975` |
| Expected hash (Phase 6-AC) | `24aa25c19b439cb5fa988729535a90ebf756498e132e4c5c6157a7a516970975` |
| **Hash match** | **YES** — no prompt drift |

The reproduced baseline prompt matches the production prompt captured in
Phase 6-AC exactly. No drift detected.

---

## 6. Conditions

| ID | Prompt | Change vs Baseline |
|----|--------|---------------------|
| A | Baseline (production prompt) | none |
| B | RULE 8 block replaced | "Do not reject based on broad topic" relaxed to permit synthesis |
| C | RULE 12 block replaced | "Must add info" relaxed to accept restatement+connection |
| D | FINAL CHECK block replaced | Removed "Would [] be safer?" and "Return [] instead" |
| E | B + C + D combined | all three edits together |

All other prompt text (RULE 1-7, 9-10, OUTPUT LIMIT, OUTPUT FORMAT, examples)
preserved unchanged in B/C/D/E.

---

## 7. Raw Model Outputs

| Condition | Raw Text | Length | Literal `[]` | Parse Success | Root Type |
|---|---|---|---|---|---|
| A Baseline | `[]` | 2 | Yes | Yes | array |
| B RULE 8 | `[]` | 2 | Yes | Yes | array |
| C RULE 12 | `[]` | 2 | Yes | Yes | array |
| D FINAL CHECK | `[]` | 2 | Yes | Yes | array |
| E Combined | `[]` | 2 | Yes | Yes | array |

All 5 conditions returned the literal string `[]` from the Ollama API.

---

## 8. Parser Results

| Condition | Parse Success | Root Type | Candidate Count |
|---|---|---|---|
| A | Yes | array | 0 |
| B | Yes | array | 0 |
| C | Yes | array | 0 |
| D | Yes | array | 0 |
| E | Yes | array | 0 |

---

## 9. Sanitizer Results

| Condition | Sanitizer Accepted | Sanitizer Rejected | Rejection Reasons |
|---|---|---|---|
| A | 0 | 0 | N/A (empty array) |
| B | 0 | 0 | N/A (empty array) |
| C | 0 | 0 | N/A (empty array) |
| D | 0 | 0 | N/A (empty array) |
| E | 0 | 0 | N/A (empty array) |

---

## 10. Final Results

| Condition | Final Reflection Count | Latency (ms) | Classification |
|---|---|---|---|
| A Baseline | 0 | 315 | — |
| B RULE 8 | 0 | 1385 | — |
| C RULE 12 | 0 | 1422 | — |
| D FINAL CHECK | 0 | 1159 | — |
| E Combined | 0 | 1404 | — |

**All 5 conditions returned zero reflections.**

---

## 11. Invocation Budget

| Category | Count |
|---|---|
| Primary calls (A–E) | 5 |
| Confirmation calls | 0 |
| **Total** | **5** |

No confirmation calls needed since no variant produced non-empty output.

---

## 12. Causal Classification

**Classification: `INPUT_DOMINANT`**

### Rationale

- **Baseline A** returned `[]` (confirms Phase 6-AB/6-AC finding).
- **None of the single-rule variants (B, C, D)** produced any output — even with
  individual suppression rules relaxed.
- **The combined variant E** (which applies ALL three relaxations simultaneously)
  also returned `[]`.
- Since relaxing the prompt rules individually AND in combination failed to
  change behavior, the persistent `[]` output is NOT explained by the prompt
  rules alone. The input itself is the dominant factor.
- Per Phase 6-Z audit: the 21 eligible memories have empty `summary`, `tags`,
  `metadata`, `source_ref`, and `observation_id` fields. The 10 reflection-type
  memories may be near-identical to source input. The 7 project memories include
  5 near-identical post-repair duplicates (same fact + unique hash). Grouping by
  `memory_type` prevents cross-type synthesis.

This strengthens the conclusion from Phase 6-AC: while prompt rules show
*correlation* with `[]`, they are not the *cause*. The input composition is
insufficient to satisfy any reflection — even with suppression rules removed.

---

## 13. Comparison with Phase 6-AB

| Criterion | Phase 6-AB | Phase 6-AE |
|---|---|---|
| Conditions tested | 5 input compositions (A–E) | 5 prompt variants (A–E) |
| Prompt changes | None (all baseline) | B/C/D/E relax specific rules |
| Baseline A result | `[]` | `[]` |
| Variants result | All `[]` | All `[]` |
| Classification | `MODEL_EMPTY_DUE_TO_INPUT_COMPOSITION` | `INPUT_DOMINANT` |
| productionWrites | 0 | 0 |

Phase 6-AB varied the **input**; Phase 6-AE varied the **prompt**. Both
converge on the same conclusion: the input composition is the primary driver.

---

## 14. Comparison with Phase 6-AC

| Aspect | Phase 6-AC | Phase 6-AE |
|---|---|---|
| Causality assigned | `PROMPT_CONTRIBUTORY` (correlation) | `INPUT_DOMAIN` (dominant) |
| Rule analysis | RULE 8/12/FINAL CHECK correlated | Tested all three — no effect |
| Prompt hash | Captured `24aa25c19b439cb5` | Verified match (no drift) |
| Conclusion | Rules are contributory, not causal | Input is dominant, rules are not causal |

Phase 6-AE resolves the Phase 6-AC open question: testing the specific rules
identified as candidates confirms they are NOT causally responsible.

---

## 15. Production Integration Notes

The experiment confirms:

1. `generateReflections()` (production path, Condition A) returns `[]` — behavior reproduced.
2. The `REFLECTION_SYSTEM_PROMPT` is faithfully reproduced (hash matches).
3. Relaxing RULE 8, RULE 12, FINAL CHECK, or any combination does NOT change
   the output.
4. Identity resolution (Phase 6-AD) operates correctly — it is not a factor.

**No production change is justified.** The reflector is functioning as designed
for the available input. The input itself lacks the content diversity and
relationship signals needed to produce reflections, as documented in Phase 6-Z.

---

## 16. Raw Outputs (summary)

All conditions received the same 21-memory input as `ReflectionInput[]`. The
model returned the 2-character string `[]` in every case. No raw model text
beyond `[]` was produced (rawModelTextLength: 2 for all non-production-path
conditions).

---

## 17. Historical Reflection Analysis

The Phase 6-AB/6-AC historical analysis identified 10 reflection-type memories
(all created 2026-08-15, all orphaned with `source_ref = null`). These were
NOT individually inspected in Phase 6-AE (that was a Phase 6-Z audit finding,
not a new experiment). The experiment tests their collective effect as input.

---

## 18. Limitations

- The experiment tests prompt relaxation only. It does NOT test whether
  providing `summary`, `tags`, or `metadata` (currently empty for all memories)
  would change behavior — that requires a production code change.
- The experiment does NOT test cross-type grouping (currently blocked by
  `memory_type` grouping in `pipeline.ts:107-120`) — that also requires a
  production code change.
- No confirmation calls were needed (no variant was non-empty).

---

## 19. Constraints Verified

| Constraint | Verified |
|---|---|
| productionWrites = 0 | YES |
| productionFilesModified = 0 | YES |
| promptsModified = 0 | YES (only local test variants) |
| thresholdsModified = 0 | YES |
| retrievalModified = 0 | YES |
| schemaModified = 0 | YES |

---

## Conclusion

**Phase 6-AE: INPUT_DOMINANT.**

Relaxing individual prompt rules (RULE 8, RULE 12, FINAL CHECK) and their
combined relaxation had NO effect on the model's `[]` output for the real
21-memory production input. The prompt rules are correlated with but not
causal for the empty output. The input composition is the dominant factor.

No production change is justified based on this phase. The correct next step
would be to enrich the input data (summaries, tags, cross-type grouping) —
but that requires production code changes that are out of scope for diagnostic
phases.
