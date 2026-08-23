# Phase 6-AG Report — Upstream Memory Identity/Deduplication Path Audit

**Date:** 2026-08-22  
**Experiment:** phase-6-ag-upstream-audit  
**Production writes:** 0  
**Production files modified:** 0  
**Raw model text persisted:** false  

---

## Executive Summary

Phase 6-AG executed 8 read-only probes tracing the production path from observation → extraction → identity resolution → duplicate/relationship decision → corroboration/merge/supersession → persistence → reflection input. The diagnostic identifies the binding constraint: **Gap C — the identity resolution stage is reachable but cannot retrieve useful candidates**. All 5 Aether project memories had 0 semantic candidates at insertion time, so the verifier was never given a chance to classify them as SAME. No corroboration events exist anywhere in the user's pool. No merge or supersession stages exist in TypeScript. All 10 reflection memories are eligible to re-enter the reflection pool, creating a closed loop without relationship linkage.

---

## Probe Results

### Probe 1: Production Call-Graph Audit

| Function | File | Status | Reachable | Currently Executed |
|---|---|---|---|---|
| `resolveMemoryIdentity` | `lib/memory/identity.ts:169-262` | active | yes | yes |
| `verifyIdentity` | `lib/memory/identity.ts:98-157` | active (internal) | yes | yes |
| `find_near_duplicates` | `supabase/migrations/0004_memory_v2_rpcs_old.sql:42-56` | malformed SQL | no | no |
| `merge_memories` | `supabase/migrations/0004_memory_v2_rpcs_old.sql:105-126` | dead-code (SQL-only) | no | no |
| `corroborateMemory` | `lib/repositories/memory.repository.ts:262-276` | active | yes (conditional) | yes |
| supersession | N/A | does-not-exist | no | no |
| contradiction/correction | `lib/memory/reflector.ts:134-138,178-204` | prompt-level-only | no | no |

**Key finding:** Only identity resolution and corroboration are reachable from the production write path. Merge, supersession, and contradiction handling do not exist in the TypeScript write path.

### Probe 2: Five Aether Duplicate Trace

**5 Aether project memories identified:**
- `0a97a74a` — "User Project: Aether [en75rlnh]" — created 2026-08-21T13:11:58
- `f7c5b99b` — "User Project: Aether [v975pduo]" — created 2026-08-21T13:09:01
- `962f14fa` — "User Project: Aether [0cvjmc2n]" — created 2026-08-21T13:13:53
- `7fcdac75` — "User Project: Aether [ponohp26]" — created 2026-08-21T13:10:26
- `dcf0c503` — "User Project: Aether [6mtqu8h1]" — created 2026-08-21T13:11:06

**Provenance:**
- All 5 have `observation_id` populated (proves `saveMemory` was called after identity resolution)
- All 5 have `source_ref = null`
- All 5 have distinct titles (exact-title fallback cannot merge them)
- **0 corroboration events** for any of the 5 memories
- **0 corroboration events** anywhere in the user's full memory pool

**Conclusion:** Identity resolution was called for all 5 (proven by non-null `observation_id`), but returned "create" or failed for all 5. No corroboration ever fired.

### Probe 3: Identity Candidate-Path Audit

**Critical finding:** `matchMemoriesV2` returned **0 candidates** for ALL 5 Aether memories at threshold 0.85.

| Memory | All Candidates | Temporal Candidates | Other Aether in Temporal |
|---|---|---|---|
| `0a97a74a` | 0 | 0 | 0 |
| `f7c5b99b` | 0 | 0 | 0 |
| `962f14fa` | 0 | 0 | 0 |
| `7fcdac75` | 0 | 0 | 0 |
| `dcf0c503` | 0 | 0 | 0 |

**Interpretation:** The identity resolver had NO candidates to evaluate. The LLM verifier was never invoked for these memories because `matchMemoriesV2` returned an empty result set. This is a **temporal/candidate-sparsity gap** — at insertion time, no existing memory in the pool had sufficient cosine similarity (>= 0.85) to the new Aether observation.

### Probe 4: Identity Decision Reproduction

**6 Ollama calls made** (top 6 project near-duplicate pairs by similarity descending).

| Pair | Content Sim | Identity Decision | Latency |
|---|---|---|---|
| `0a97a74a` + `f7c5b99b` | 0.927 | UNCERTAIN | 5368ms |
| `962f14fa` + `7fcdac75` | 0.915 | UNCERTAIN | 2556ms |
| `0a97a74a` + `962f14fa` | 0.902 | UNCERTAIN | 3185ms |
| `0a97a74a` + `7fcdac75` | 0.902 | UNCERTAIN | 2562ms |
| `0a97a74a` + `dcf0c503` | 0.902 | UNCERTAIN | 2681ms |
| `f7c5b99b` + `962f14fa` | 0.902 | UNCERTAIN | 3018ms |

**Prompt fidelity:** SHA256 hashes match (production hash === reproduced hash). PROMPT_HASH_MISMATCH did not occur.

**Interpretation:** Even when the verifier IS given near-duplicate pairs, it classifies all of them as UNCERTAIN. This is consistent with the conservative prompt instructions ("Be very conservative. When in doubt choose DIFFERENT or UNCERTAIN."). However, Probe 3 shows the verifier was never actually invoked for the 5 Aether memories at insertion time because no candidates were retrieved.

### Probe 5: Corroboration/Merge Reachability

| Stage | Reachable | Condition / Notes |
|---|---|---|
| `corroborateMemory` | yes | `pipeline.ts:257`, conditional on `identityDecision.decision === "corroborate"` |
| `merge_memories` | no | SQL-only, no TypeScript caller |
| supersession | no | Does not exist |
| contradiction/correction (write path) | no | Prompt-level only in `reflector.ts` |

**Corroboration events:** 0 total across the user's full memory pool.

**Interpretation:** Corroboration IS reachable but has never fired for this user. This is because identity resolution has never returned exactly-1-SAME (Probe 3 shows 0 candidates, Probe 4 shows UNCERTAIN).

### Probe 6: Duplicate Persistence Explanation

| Memory | Primary Classification | Evidence |
|---|---|---|
| `0a97a74a` | NO_CANDIDATE_RETRIEVAL | Probe 3 returned 0 temporal candidates |
| `f7c5b99b` | NO_CANDIDATE_RETRIEVAL | Probe 3 returned 0 temporal candidates |
| `962f14fa` | NO_CANDIDATE_RETRIEVAL | Probe 3 returned 0 temporal candidates |
| `7fcdac75` | NO_CANDIDATE_RETRIEVAL | Probe 3 returned 0 temporal candidates |
| `dcf0c503` | NO_CANDIDATE_RETRIEVAL | Probe 3 returned 0 temporal candidates |

**Global observations:**
- `MERGE_PATH_NOT_REACHED`: No merge stage exists in TypeScript. `merge_memories` RPC is SQL-only with no TS caller.
- `RELATIONSHIP_STAGE_MISSING`: No `memory_edges` writes, no `source_ref` linkage, no relationship metadata for any memory in the pool.

**Annotation:** Every memory carries `RELATIONSHIP_STAGE_MISSING` as a cross-cutting architectural observation.

### Probe 7: Reflection Feedback-Loop Audit

**All 10 reflection memories are eligible** to re-enter the reflection pool:
- All have `status = "active"`
- All have `confidence_v2 >= 0.7` (range: 0.7–0.9)
- All have `importance_v2 >= 0.5` (range: 0.53–0.63)
- All 10 have `times_used > 0` (range: 2–26)
- All 10 have `last_used` populated

**Grouping logic:** `reduce` by `memory_type` only (`pipeline.ts:107-120`). No `memory_type !== "reflection"` exclusion.

**Feedback loop risk:** If eligible reflections re-enter, they form their own `reflection` group and are fed back to the reflector. No relationship/source linkage connects them to original observations.

### Probe 8: Architecture Gap Determination

**Classification:** Gap C — stage is reachable but cannot retrieve useful candidates

**Evidence chain:**
1. Probe 3 shows 0 temporal candidates for all 5 Aether memories at insertion time
2. Identity resolution cannot evaluate what it cannot retrieve — the LLM verifier was never invoked for these memories
3. No merge stage exists in TypeScript
4. Reflections can re-enter the reflection pool (Probe 7)
5. No relationship/source linkage connects reflections to original observations

**Mixed evidence:** No. Probe 3 shows 0 candidates for ALL 5 memories consistently. No mixed pattern.

**Note:** While the dominant gap for the Aether duplicates is Gap C (candidate retrieval failure), the broader architecture also exhibits Gap F characteristics (no effective consolidation/relationship stage exists). The decision tree selects Gap C as the MOST SPECIFIC classification for the duplicate-persistence question, with Gap F as a secondary architectural observation.

---

## Combined Findings

| Question | Answer | Evidence |
|---|---|---|
| Is identity resolution reachable? | Yes | `pipeline.ts:235-260` |
| Did identity resolution run for the 5 Aether memories? | Yes | All have non-null `observation_id` |
| Did corroboration fire for the 5 Aether memories? | No | 0 corroboration events in pool |
| Why didn't corroboration fire? | 0 candidates retrieved | Probe 3: `matchMemoriesV2` returned 0 candidates for all 5 |
| What would the verifier decide if given the pairs? | UNCERTAIN (all 6) | Probe 4: 6/6 UNCERTAIN |
| Is there a merge stage? | No | No TypeScript caller for `merge_memories` |
| Is there a supersession stage? | No | Does not exist |
| Do reflections re-enter the pool? | Yes | All 10 are eligible, all have `times_used > 0` |
| Is there relationship linkage? | No | No `memory_edges` writes, no `source_ref` linkage |

**Binding constraint:** The identity resolution stage is reachable and functional, but `matchMemoriesV2` returned 0 candidates for all 5 Aether memories at insertion time. The verifier was never given a chance to classify them. This is a temporal candidate-sparsity gap: when the memories were inserted, no prior memory in the pool had sufficient cosine similarity (>= 0.85) to trigger candidate retrieval.

**Secondary constraint:** Even if candidates were retrieved, the verifier classifies all near-duplicate pairs as UNCERTAIN (Phase 6-AF and Phase 6-AG both confirm this). So the system has TWO weaknesses: (1) candidate retrieval fails for near-duplicates with different titles, and (2) the verifier is overly conservative.

**Architectural gap summary:**
- Gap C dominates for the Aether duplicates: candidate retrieval fails
- Gap D is a secondary verifier-quality issue: even when candidates exist, verifier returns UNCERTAIN
- Gap F describes the broader architecture: no merge stage, no relationship edges, reflections re-enter without linkage

---

## Artifacts

- `tests/phase-6-ag/upstream-audit.test.ts` — read-only test harness
- `tests/phase-6-ag/measurement.json` — all probe measurements
- `tests/phase-6-ag/report.md` — this report

---

## Verification

```bash
npx vitest run tests/phase-6-ag/upstream-audit.test.ts --testTimeout=300000  # PASSED
npx tsc --noEmit                                                          # PASSED
npm run build                                                             # PASSED
```

---

## Git Safety

- No production files modified by this phase.
- Only new files created under `tests/phase-6-ag/`.
- Baseline git status confirmed before implementation.
