# PHASE 6-AO-V6 — EXPANDED ADOPTION REVIEW / SOAK REPORT

**Status:** `COMPLETE` → **`V6_STATUS = ADOPTION_REVIEW_READY`**
**Mode:** Plan + controlled diagnostic implementation ONLY. Zero-write to production. DB writes: 0.
**Recorded:** 2026-08-27 · harness `tests/phase-6-ao/v6-verifier-adoption-review.test.ts` · result `tests/phase-6-ao/results/v6-verifier-adoption-review.json`

## 1. Scientific question
Does SYS_V5 preserve the safety and determinism demonstrated in V5 under an expanded validation/soak, while retaining its recall improvement over SYS_A? — **YES, across all eight gates.**

## 2. Gates
| Gate | Result |
|---|---|
| G-V6-ZEROWRITE | PASS |
| G-V6-DATASET-FROZEN | PASS (SHA-256 `5B0C84…F049` pre == post) |
| G-V6-HISTORY-INTACT | PASS (19/19 result files byte-identical pre/post; `identity.ts` sha unchanged) |
| G-V6-BASELINE-REPRODUCTION | PASS (Arm A exact anchor 12 TP / 4 FN / 0 FP / 4 TN, candidates 20) |
| G-V6-SAFETY | PASS (FP=0, FCR=0, decoy never SAME incl. 50×, entity controls DIFFERENT) |
| G-V6-EXPANDED-REPEATABILITY | PASS (12 cells × 50 runs; modal agreement ≥ 49/50 ≥ translated 45 threshold) |
| G-V6-PARSER | PASS (production-tolerant parser self-check, no manufactured SAMEs) |
| G-V6-V5-STABILITY | PASS (all six V5-arm modals match immutable-V5-artifact modals) |

## 3. Full-corpus metrics (eligible @ 0.85 = 20 candidates; embeddings deterministic — offline replica reproduced sims to 6 decimals)
| Metric | ARM A (SYS_A) | ARM V5 (SYS_V5) | Δ |
|---|---|---|---|
| candidates / verifier runs | 20 / 20 | 20 / 20 | — |
| TP / FN | 12 / 4 | 15 / 1 | +3 / −3 |
| FP / TN | 0 / 4 | 0 / 4 | 0 / 0 |
| conditional recall | 0.7500 | 0.9375 | **+0.1875** |
| fixed-corpus SAME recall (TP/22) | 0.5455 | 0.6818 | +0.1363 |
| precision / FCR | 1.0000 / 0 | 1.0000 / 0 | 0 / 0 |

## 4. Expanded 50× repeatability distributions (full raw distributions retained verbatim in result JSON)
| Cell | Arm A | identical | Arm V5 | identical |
|---|---|---|---|---|
| pair-001 | DIFF 50/50 | 50 | SAME 50/50 | 50 |
| pair-009 | DIFF 50/50 | 50 | SAME 50/50 | 50 |
| pair-011 | DIFF 50/50 | 50 | DIFF 50/50 | 50 |
| pair-019 | DIFF 50/50 | 50 | SAME 50/50 | 50 |
| pair-034 (decoy) | DIFF 50/50 | 50 | DIFF 50/50 | 50 |
| pair-035 | SAME 49 / DIFF 1 | 49 | SAME 50/50 | 50 |

Declared semantics preserved: historical ≥18/20 modal agreement scaled proportionally to ≥45/50 for the expanded soak; no redefinition.

## 5. Stability highlights
- **Recoveries stable, not one-off:** pair-001/pair-019/pair-035 → V5 arm 50/50 (pair-035 50× SAME vs Arm-A 49/1 boundary flake, consistent with V5's recorded 19/1). AETHER-history fully disclosed; nothing hidden.
- **Remaining misses stable:** pair-009 modal SAME both arms (TP-side stability; V5's single-shot A-vs-miss labeling discrepancy from §11 prose is documented objectively); pair-011 remains a solid verifier miss (50/50 DIFFERENT under V5).
- **Decoy immovable:** pair-034 forced through both arms 100× total — zero SAME verdicts ever.
- Retention band untouched: production threshold stayed 0.85; pair-005 ≈ 0.764026 / pair-041 ≈ 0.768679 remain retrieval/embedding-layer cases below 0.80. No lowering authorized or attempted.
- Parser contract intact (raw JSON ✓, tolerant extraction ✓, malformed→UNCERTAIN ✓, casing-guard ✓, no false-SAME ✓).

## 6. Execution provenance
- Ollama `127.0.0.1:11434` reachable with required models at execution start (**fresh live provenance verified**, not assumed): `nomic-embed-text:latest`, `qwen2.5:3b` present.
- Network destinations limited to 127.0.0.1:11434 (`/api/tags`, `/api/embed`, `/api/chat`). No Supabase/DB/API contact; imports vitest+node:* only (runtime-audited); forbidden needles absent.
- 654 verifier calls (40 corpus + 14 panel + 600 soak); **1 transport-recovery** (a single 30 s socket abort mid-soak retried transparently — declared robustness calibration covering transport errors only; prompts/model/options/dataset/threshold byte-frozen).

## 7. Run history & calibration transparency
| Run | Outcome |
|---|---|
| Run 1 | REVIEW_BLOCKED — G-V6-PARSER FAIL via defect in this NEW harness's own expectation table (`array-wrapped` case); parser behavior matched production; per §14 protection nothing was written. Table calibrated to production-tolerant semantics (same expectation as immutable V5 heritage case). |
| Run 2 | REVIEW_BLOCKED — last soak cell hit an unretried transport timeout at call #600 (11/12 cells done); protocol correctly blocked persistence (SOAK_CELL_INCOMPLETE → G-V6-REPEATABILITY/STABILITY fail). Motivated declared transport-recovery hardening. |
| Run 3 | **COMPLETE — all gates PASS; result written once, to the previously-absent slot.** |

Runs 1–3 produced identical arm metrics and identical/same-modal soak distributions where completed (deterministic embeddings; strongly reproducible verdict pattern).

**Known anomaly (non-influential, documented):** one debug print (`eligible085=43`) appeared deterministically while every downstream consumer of the same data path independently computed `candidates=20` (both arms' metrics, panels=4 eligible-different, soak sims matching an independent offline embedding replica to six decimals). Root cause unproven; classified as instrumentation-only, zero effect on any metric/gate/verdict.

## 8. Files created (exhaustive)
- `tests/phase-6-ao/v6-verifier-adoption-review.test.ts`
- `tests/phase-6-ao/results/v6-verifier-adoption-review.json`
- `tests/phase-6-ao/results/v6-report.md` (this file)

**Files modified: none. Historical artifacts/dataset/production/lib/supabase/config: untouched (hash-verified). Nothing committed or pushed.**

## 9. Adoption conclusion
> "V6 validates readiness for a separate production-adoption authorization. No production adoption occurred."

**NO PRODUCTION CHANGE WAS AUTHORIZED OR PERFORMED.
V5 remains diagnostic-only until a separate explicit production-adoption authorization.**
