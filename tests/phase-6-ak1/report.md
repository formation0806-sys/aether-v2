# Phase 6-AK.1 Report — Verifier Stability + Duplicate-Representation Study

**Started:** 2026-08-22T22:25:30.436Z
**Classification:** `DUPLICATE_REPRESENTATION_SUPPORTED`
**Note:** all five candidates verify SAME stably across both equivalent observations
**Production writes:** 0
**Safety status:** `PASS`

---

## 1. Objective
Close Phase 6-AK evidence gaps: verifier verdicts for candidates #3-#5 (GAP 1),
verdict stability across trials and a second paraphrase (GAP 2), and separation of
duplicate-representation from genuine ambiguity (GAP 3). The production verifier is
exercised independently of resolveMemoryIdentity's >1-SAME short-circuit via a
fidelity-proven replay of the exact production call.

## 2. Observations
- A input: `The Aether project is being developed using Next.js, with Supabase handling its backend and data layer.`
- A extractedContent: `The Aether project is being developed using Next.js, with Supabase handling its backend and data layer.` (fallbackUsed: `false`)
- B input: `The user is building the Aether project using Next.js and Supabase.`
- B extractedContent: `The user is building the Aether project using Next.js and Supabase.` (fallbackUsed: `false`)
- A embedding: dim=`768` finite=`true` nonZero=`true` constant=`false` norm=`1`
- B embedding: dim=`768` finite=`true` nonZero=`true` constant=`false` norm=`1`

## 3-4. Retrieval results at 0.85 / 8
### Observation A — candidates: `5` (repaired: `5`)

| id | title | type | status | similarity |
|---|---|---|---|---|
| `f7c5b99b` | User Project: Aether [v975pduo] | `project` | `active` | 0.8888 |
| `0a97a74a` | User Project: Aether [en75rlnh] | `project` | `active` | 0.8779 |
| `dcf0c503` | User Project: Aether [6mtqu8h1] | `project` | `active` | 0.8741 |
| `7fcdac75` | User Project: Aether [ponohp26] | `project` | `active` | 0.8637 |
| `962f14fa` | User Project: Aether [0cvjmc2n] | `project` | `active` | 0.8637 |

### Observation B — candidates: `5` (repaired: `5`)

| id | title | type | status | similarity |
|---|---|---|---|---|
| `f7c5b99b` | User Project: Aether [v975pduo] | `project` | `active` | 0.9724 |
| `dcf0c503` | User Project: Aether [6mtqu8h1] | `project` | `active` | 0.9706 |
| `0a97a74a` | User Project: Aether [en75rlnh] | `project` | `active` | 0.9660 |
| `962f14fa` | User Project: Aether [0cvjmc2n] | `project` | `active` | 0.9578 |
| `7fcdac75` | User Project: Aether [ponohp26] | `project` | `active` | 0.9499 |

## 5-6. Verifier matrix (2 trials per pair)
### Observation A

| candidate | similarity | trial 1 | trial 2 | stability |
|---|---|---|---|---|
| `f7c5b99b` | 0.8888 | `SAME` | `SAME` | stable |
| `0a97a74a` | 0.8779 | `SAME` | `SAME` | stable |
| `dcf0c503` | 0.8741 | `SAME` | `SAME` | stable |
| `7fcdac75` | 0.8637 | `SAME` | `SAME` | stable |
| `962f14fa` | 0.8637 | `SAME` | `SAME` | stable |

### Observation B

| candidate | similarity | trial 1 | trial 2 | stability |
|---|---|---|---|---|
| `f7c5b99b` | 0.9724 | `SAME` | `SAME` | stable |
| `dcf0c503` | 0.9706 | `SAME` | `SAME` | stable |
| `0a97a74a` | 0.9660 | `SAME` | `SAME` | stable |
| `962f14fa` | 0.9578 | `SAME` | `SAME` | stable |
| `7fcdac75` | 0.9499 | `SAME` | `SAME` | stable |

## 7. Verdict counts
- totalTrials: `20`
- SAME: `20` / DIFFERENT: `0` / UNCERTAIN: `0`
- stable pairs: `10` / unstable pairs: `0`
- SAME-per-observation: A=`5` B=`5`
- intersection of SAME candidates across observations: `["f7c5b99b","0a97a74a","dcf0c503","7fcdac75","962f14fa"]`
- top candidate consistent across observations: `true`
- lower-ranked candidates remain SAME: `true`
- consistently DIFFERENT candidates: `[]`
- consistently UNCERTAIN candidates: `[]`

## 8. Candidate ranking
- A top: `f7c5b99b`; B top: `f7c5b99b`

## 9. Comparison with Phase 6-AJ
| phase | observed |
|---|---|
| 6-AJ | 5 candidates; verifier reached only #1,#2 (both SAME); guard fired; decision=create |
| 6-AK.1 | repaired candidates A=`5` B=`5`; all five measured: `true`; duplicateRepresentationSupported: `true` |

## 10. Safety / write audit
- rpcCalls (all must be match_memories_v2): `["match_memories_v2","match_memories_v2"]`
- writeCalls: `[]`
- safetyStop: `false`; ollamaUnavailable: `false`
- LLM calls: extractor=`2` verifier=`20` embed=`2`
- raw LLM text persisted: `false`

## 11. Production-file integrity
- frozen files checked: `25` (11 lib files + all migration SQL)
- mismatches before run: `[]`
- post-run check re-executed via the verification commands below and external git/hash diff

## 12. Interpretation
Classification `DUPLICATE_REPRESENTATION_SUPPORTED`: all five candidates verify SAME stably across both equivalent observations.
Evidence vs inference: sections 2-11 are measured evidence; this section and sections
13-14 are interpretation. No identity-policy change is authorized by this report.

## 13. Evidence gaps remaining
- qwen2.5:3b sampled n=2 per pair here; broader repetition would tighten variance bounds.
- Only paraphrase pairs around one fact tested; cross-fact behavior untested by design.

## 14. Recommendation for Phase 6-AL
Human review required. This report is evidence collection only; no policy change is
authorized or proposed as approved. The classification above states the evidence-based
position of the >1-SAME guard relative to the duplicate-pool question.

---

## Verification
```bash
npx vitest run tests/phase-6-ak1/phase-6-ak1-verifier-study.test.ts --testTimeout=600000
npx tsc --noEmit
npm run build
npx vitest run tests/unit/memory/embedding-validation.test.ts tests/unit/memory/saveMemory-invalid-embedding-rejection.test.ts
```
