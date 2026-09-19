# Phase 6-AO-V20 — Asymmetric Instruction Evaluation Report

**Status:** `COMPLETE` → **`V20_STATUS = FAIL` (GATE_RECALL = FAIL)**
**Mode:** Measurement only. Zero-write to production. **DB_WRITES: 0. SUPABASE_CONTACT: false.**
**Recorded:** 2026-08-31 · harness `tests/phase-6-ao/v20-asymmetric-instruction-evaluation.test.ts` · result `tests/phase-6-ao/results/v20-asymmetric-instruction-evaluation.json` · run log `v20-run-log.txt`
**Execution:** 2 runs (canonical + confirmation). Metrics identical across runs (temp-0 determinism), matching the V11 two-run protocol. 158 verifier calls, 688 embed calls, network destination `127.0.0.1:11434` only.

## 1. Scientific question

Does a **documented, role-asymmetric embedding instruction protocol** (instruction on the
query side only; document side bare or document-prefixed) recover >= 1 additional TP at the
frozen 0.85 identity boundary — specifically via pair-005 (+0.028855 gap) or pair-007
(+0.012633 gap) — without pushing any DIFFERENT sentinel into a false-SAME verdict, under
the frozen production contract (nomic-embed-text:latest, 768 dim, threshold 0.85, SYS_V5,
qwen2.5:3b)?

Motivation (established during V20 planning, before measurement):
- V14 applied `"query: "` **symmetrically** to both sides (verified in the V14 harness source);
  no V1–V19 artifact ever measured a one-sided application.
- V19's H3 ("Asymmetric query/document encoding" = RULED_OUT) was an analytical
  disposition, not a measurement.
- V19's "no further prefix variants documented" claim was contradicted by upstream
  documentation: mxbai-embed-large-v1 documents a query-only retrieval instruction
  (`Represent this sentence for searching relevant passages: `); nomic-embed-text-v1.5
  documents task prefixes (`search_query: ` / `search_document: `).

## 2. Pre-declared design (frozen before measurement)

Role mapping (mirrors production `resolveMemoryIdentity`): **textA = NEW OBSERVATION /
QUERY**, **textB = EXISTING CANDIDATE / DOCUMENT**. Dataset SHA-pinned
(`5B0C84…F049`, 43 pairs / 22 SAME / 21 DIFFERENT / 19 factKeys). SYS_V5 hash pinned
(`b999aa8f…93e2d`). Threshold literal 0.85 asserted in `lib/memory/identity.ts` source.
Sentinels fixed: pair-042, pair-032, pair-024, pair-028, pair-002. Denominator 22. No
pair-specific logic, no factKey logic, no extra prefixes, no threshold tuning.

## 3. Controls (both PASSED — experiment interpretable)

| Control | Configuration | Result |
|---|---|---|
| Control A | nomic bare/bare (production) | **TP=15**, candidates=20, pair-005=0.764026, pair-041=0.768679 — exact V11/V12 anchor reproduction (±1e-4) |
| Control B | mxbai + `"query: "` on BOTH sides (V14) | **TP=18**, candidates=25, FP=0, pair-005=0.821145, pair-007=0.837367, pair-042=0.875855 — exact V14 reproduction (±1e-4) |

## 4. Arm results (threshold 0.85, fixed denominator 22)

| Arm | Configuration | Candidates | TP | FN | FP | TN | fixedRecall | Gain vs V11 | FCR | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| Arm 1 | mxbai, `Represent this sentence for searching relevant passages: ` on query, bare document | 9 | **9** | 0 | 0 | 0 | 40.91% | **−27.27pp** | 0% | REGRESSION |
| Arm 2 | mxbai, `"query: "` on query, bare document | 10 | **10** | 0 | 0 | 0 | 45.45% | **−22.73pp** | 0% | REGRESSION |
| Arm 3 | nomic, `"search_query: "` on query, `"search_document: "` on document | 14 | **9** | 1 (pair-034) | 0 | 4 | 40.91% | **−27.27pp** | 0% | REGRESSION |

**No arm reached TP=18, let alone TP=19.** All three arms collapsed the eligible pool
below even the production baseline. GATE_RECALL = FAIL for every arm.

## 5. Target-pair movement (pair-005, pair-007)

| Pair | Control A (bare) | Arm 1 | Arm 2 | Arm 3 | Eligible anywhere? |
|---|---|---|---|---|---|
| pair-005 | 0.764026 | 0.745386 (−0.0186) | 0.724381 (−0.0396) | 0.765555 (+0.0015) | NO |
| pair-007 | 0.804500 | 0.777087 (−0.0274) | 0.761467 (−0.0430) | 0.831195 (+0.0267) | NO |

- The mxbai documented instruction (Arm 1) moved both targets **DOWN**.
- One-sided `"query: "` (Arm 2) moved both targets **DOWN** — the exact opposite of the
  symmetric application measured in V14 (which raised pair-005 to 0.821145).
- The nomic documented protocol (Arm 3) improved pair-007 by +0.0267 (to 0.831195) and
  pair-005 marginally (+0.0015) — real but far below the +0.0455/+0.086 needed for
  eligibility at 0.85.

## 6. Safety sentinel ledger (pre-declared set)

| Sentinel | Control A | Arm 1 | Arm 2 | Arm 3 | Arm-3 verdict |
|---|---|---|---|---|---|
| pair-042 (HIGH) | 0.870898 | 0.826260 | 0.845789 | **0.853784 eligible** | DIFFERENT (correct) |
| pair-032 | 0.890630 | 0.818392 | 0.780988 | **0.912399 eligible** | DIFFERENT (correct) |
| pair-024 | 0.803040 | 0.822474 | 0.805380 | 0.844211 (not eligible) | — |
| pair-028 | 0.854020 | 0.793533 | 0.806159 | **0.869170 eligible** | DIFFERENT (correct) |
| pair-002 | 0.804524 | 0.723930 | 0.756217 | 0.813946 (not eligible) | — |

**FP = 0 in every arm; FCR = 0% everywhere.** GATE_SAFETY = PASS for all arms — but
safety is moot because recall regressed everywhere.

## 7. Newly-eligible cells and repeatability soak (20× sequential, temp 0)

| Arm | Newly eligible | Soak result |
|---|---|---|
| Arm 1 | pair-013 (SAME, 0.893975), pair-039 (SAME, 0.882850) | 20/20 SAME both — PASS |
| Arm 2 | pair-039 (SAME, 0.879638) | 20/20 SAME — PASS |
| Arm 3 | **pair-034** (SAME, 0.863975 — the known frozen semantic decoy) | **DIFFERENT 20/20** — agreement PASS, consistent with V6/V11/V16 deterministic rejection |

GATE_REPEATABILITY = PASS for all arms (every soaked cell ≥ 18/20). Arm 3's only
newly-eligible SAME pair is pair-034, the documented verifier-frozen decoy — the verifier
rejected it 20/20 exactly as in V11/V16. No false corroboration occurred anywhere.

## 8. Orientation sensitivity (mirrored mapping, similarity-only, NOT gate-eligible)

| Arm | mean Δ (mirrored − forward) | max abs Δ | Interpretation |
|---|---|---|---|
| Arm 1 | −0.007602 | 0.067505 | asymmetric protocol is orientation-sensitive |
| Arm 2 | +0.000177 | 0.052558 | near-symmetric in the mean |
| Arm 3 | −0.009683 | 0.069516 | orientation-sensitive |

Mirrored per-pair results are in the JSON artifact. No gate conclusion rests on them.

## 9. Hypothesis verdicts (V19 matrix upgrade)

| Hypothesis | V19 disposition | V20 measured disposition |
|---|---|---|
| H2: Query/document instruction format | WEAK | **CLOSED (NEGATIVE)** — every documented/one-sided variant regresses; the symmetric `"query: "` (V14) remains the best formatting measured |
| H3: Asymmetric query/document encoding | RULED_OUT (analytical) | **MEASURED-CONFIRMED RULED_OUT** — one-sided application is strictly worse (TP 9–10 vs 18) |
| Nomic documented task protocol | unmeasured | **MEASURED-CLOSED for recall** — pair-007 +0.0267 but still 0.0188 short of 0.85; eligible pool collapses |

## 10. Gates

| Gate | Arm 1 | Arm 2 | Arm 3 |
|---|---|---|---|
| GATE_RECALL (TP ≥ 19) | FAIL | FAIL | FAIL |
| GATE_SAFETY (FCR ≤ 5%) | PASS (0%) | PASS (0%) | PASS (0%) |
| GATE_REPEATABILITY (≥ 18/20) | PASS | PASS | PASS |
| **OVERALL** | **FAIL** | **FAIL** | **FAIL** |

## 11. Scientific conclusion

**V20 = FAIL. The asymmetric-instruction hypothesis is measured-closed.**

1. Every documented role-asymmetric protocol produces a severe regression: TP drops from
   18 (V14 symmetric) to 9–10, and below even the production baseline of 15. One-sided
   instructions deflate the entire similarity distribution — including the DIFFERENT
   sentinels — but harm SAME pairs far more, collapsing the eligible pool.
2. The symmetric `"query: "` prefix (V14) remains the single best embedding-input
   configuration ever measured on this corpus. Symmetry is not a defect of V14; it is the
   reason V14 is the best result.
3. Arm 3 (nomic documented protocol) does lift pair-007 by +0.0267 and pushes pair-034
   across 0.85 — but the newly-eligible SAME pair is pair-034 (verifier-rejected decoy,
   20/20) and nothing else helps. The required pair-007 eligibility (+0.0455 from
   production bare) is not achieved.
4. Combined with V11 (threshold closed), V12 (embedding geometry), V13/V14 (model +
   symmetric prefix), V16/V18 (verifier closed), and V19 (no model candidate), the
   embedding layer is now **fully closed for this corpus under the frozen production
   constraints**: threshold, embedding model, input formatting (symmetric and asymmetric),
   and verifier have each been measured, and no configuration reaches TP=19.
5. The remaining 1-TP gap is structural: it requires either a corpus/label review
   (the pair-034 decoy is labeled SAME but deterministically rejected by the frozen
   verifier — a dataset/verifier disagreement outside embedding scope) or a genuinely new
   embedding model (installation approval required; V19 found no evidence-backed candidate).

**No production change is authorized or warranted by this result. Production remains:
nomic-embed-text:latest, bare text, 768 dim, threshold 0.85, SYS_V5, qwen2.5:3b.**

## 12. Production integrity

- DB_WRITES = 0 · SUPABASE_CONTACT = false · network = `127.0.0.1:11434` only
- Production threshold remained 0.85; SYS_V5 hash pinned before and after
- Dataset SHA unchanged; `lib/memory/identity.ts` SHA unchanged (asserted in-harness)
- All V1–V19 artifacts byte-identical pre/post (SHA-256 ledger of 40 files asserted in-harness)
- No model installed; no migrations touched; no commits/pushes

## 13. Files created (additive only)

```text
tests/phase-6-ao/v20-asymmetric-instruction-evaluation.test.ts
tests/phase-6-ao/results/v20-asymmetric-instruction-evaluation.json
tests/phase-6-ao/results/v20-report.md
tests/phase-6-ao/results/v20-run-log.txt
```

## 14. Verification

- `npx vitest run tests/phase-6-ao/v20-asymmetric-instruction-evaluation.test.ts` → **12/12 PASS** (×2 runs, identical metrics)
- `npx tsc --noEmit --incremental false --pretty false` → **NEW errors = 0** (10 pre-existing
  baseline errors unchanged: v4-decision-boundary ×7, verifier-contract-v2 ×2, v19 harness ×1;
  note: the actual historical baseline is 10, not the 9 quoted in earlier handoffs, because
  the protected V19 harness carries one — untouched per artifact rules)
- `npm run build` → PASS (see final verification)
- `git status --short` → only the new V20 files added

## 15. Final classification

```text
V20_STATUS = FAIL
HYPOTHESIS = documented role-asymmetric embedding instruction protocols
HYPOTHESIS_VERDICT = MEASURED_CLOSED (negative)

BASELINE_TP = 15
BEST_EXPERIMENTAL_TP (prior) = 18 (V14, symmetric)
CANDIDATE_TP (V20 best arm) = 10
RECALL_GAIN_PP = -22.73 (best V20 arm) vs required +18.18

FCR = 0% (all arms)
REPEATABILITY = PASS (all soaked cells 20/20)

PAIR_005 = not recovered (best V20 movement +0.0015, Arm 3)
PAIR_007 = not recovered (best V20 movement +0.0267 -> 0.831195, still < 0.85)

SAFETY_SENTINELS = no FP; Arm 3 lifted pair-028/032/042 into eligibility,
                   all correctly rejected DIFFERENT

GATE_RECALL = FAIL
GATE_SAFETY = PASS
GATE_REPEATABILITY = PASS
OVERALL_GATE = FAIL

DB_WRITES = 0
SUPABASE_CONTACT = false
PRODUCTION_CHANGED = NO
DATASET_CHANGED = NO
V1_V19_ARTIFACTS_CHANGED = NO

SCIENTIFIC_CONCLUSION = Asymmetric instruction protocols regress severely
(TP 9-10 vs 18 symmetric). V19 H3 is now measured-confirmed. The symmetric
"query: " prefix remains the best measured configuration. The embedding
layer is closed for this corpus under the frozen production constraints.

NEXT_SEPARATE_MILESTONE = none justified on embedding evidence. Any future
progress requires a different scientific question (dataset/label review of
the pair-034 decoy disagreement, or an installation-approved external
embedding model with documented short-paraphrase strength).
```



