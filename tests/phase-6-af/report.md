# Phase 6-AF Report — Input Composition and Relationship Structure Audit

**Date:** 2026-08-22  
**Experiment:** phase-6-af-input-audit  
**Production writes:** 0  
**Production files modified:** 0  
**Raw model text persisted:** false  

---

## Executive Summary

Phase 6-AF executed 8 read-only probes against the 21-memory production input pool. The diagnostic confirms `INPUT_DOMINANT`: the 21 memories genuinely lack sufficient cross-memory relationships for any valid reflection under the current reflector contract. Phase 6-AE already proved prompt relaxation does not help.

---

## Probe Results

### Probe 1: Eligibility Audit

- **Total memories:** 37
- **Eligible:** 21
- **Ineligible:** 16
- **Filter:** `status IN (active,candidate) AND confidence_v2 >= 0.7 AND importance_v2 >= 0.5`
- **Ineligible breakdown:**
  - 10 memories failed `confidence_v2 < 0.7` (all `active`, all `semantic` type)
  - 6 memories failed `importance_v2 < 0.5` (mix of `reflection`, `working`, `candidate`)

### Probe 2: Grouping Structure Audit

- **Groups:** 3 (reflection: 10, project: 9, identity: 2)
- **Grouping mechanism:** `reduce` by `memory_type` only (`pipeline.ts:107-120`)
- **Cross-type near-duplicate pairs (sim > 0.85):** 0
- **Near-duplicate pairs within groups:** 11 (all within-type)

### Probe 3: Content Inspection (Full 21)

- **ALL 21 memories have:** `summary=""`, `tags=[]`, `metadata={}`
- **Reflection-type memories:** 10
- **Reflection content depth:**
  - `hasSynthesizedContent: true`: 4/10
  - `hasSynthesizedContent: false`: 6/10
- **Cross-check with Phase 6-AA:** Phase 6-AA found 4/10 reflections with `hasSynthesizedContent: true`. This probe independently reproduces the same finding.

### Probe 4: Duplicate / Near-Duplicate Analysis

- **Threshold:** similarity > 0.85 (Levenshtein)
- **Total near-duplicate pairs:** 11
- **Within-type:** 11
- **Cross-type:** 0
- **Memories involved in near-duplicates:** 7
- **Phase 6-AA reproduction:** Phase 6-AA reported 12 near-duplicate pairs. This independent reproduction found 11. The difference may be due to threshold rounding or content changes since Phase 6-AA was run.

**Near-duplicate breakdown:**
- **Project group (9 pairs):** 5 memories with near-identical "User Project: Aether" content (sim ~0.90-0.93)
- **Reflection group (1 pair):** 2 identical "Professional Identity Consistency" / "Professional Role Consistency" reflections (sim = 1.0)
- **Identity group:** 0 near-duplicates

### Probe 5: Provenance Chain Audit

- **Reflection memories with `source_ref` populated:** 0/10
- **Reflection memories with `observation_id` populated:** 0/10
- **Orphaned reflections:** 10/10
- **Semantic matching results:** All 10 orphaned reflections found high-similarity matches (top similarity >= 0.78) within the eligible pool, but ALL top matches are other reflection memories. No reflection found a close non-reflection source memory.
- **Non-reflection memories with `source_ref` populated:** 0

### Probe 6: Cross-Type Relationship Potential (Two-Tier)

- **Tier A (sim > 0.85, near-duplicate):** 0 pairs
- **Tier B (0.5 < sim <= 0.85, related):** 1 pair
  - `632d72c7` (reflection, "Professional Identity") + `0be6f80c` (project, "Aether Secret Test Phrase") — sim 0.567
- **Note:** Tier B pairs are descriptive relationship candidates only. They do NOT constitute evidence of blocked reflection by themselves.

### Probe 7: Semantic Diversity Audit

| Group | Group Size | Distinctive Tokens | Classification |
|---|---|---|---|
| reflection | 10 | 36 | DIVERSE |
| project | 9 | 20 | DIVERSE |
| identity | 2 | 0 | HOMOGENEOUS |

- **All groups HOMOGENEOUS:** false
- **Any group DIVERSE:** true

### Probe 8: Identity Resolution Simulation (Prompt Reproduction)

- **Near-duplicate pairs identified:** 11
- **Selection rule:** Top 6 by similarity descending
- **Pairs tested:** 6
- **Ollama calls made:** 6
- **Prompt fidelity:** SHA256 hashes match (`productionPromptHash === reproducedPromptHash`)
- **Decisions:**
  - SAME: 0
  - DIFFERENT: 0
  - UNCERTAIN: 6
- **Interpretation:** The identity verifier classified all 6 tested near-duplicate pairs as UNCERTAIN. This is consistent with the conservative prompt instructions ("Be very conservative. When in doubt choose DIFFERENT or UNCERTAIN."). The near-duplicate pairs in the production input are not being merged by the identity layer.

---

## Hypothesis Evaluation

### H1: Input is semantically impoverished (empty summaries/tags/metadata)

- **Evidence:** ALL 21 memories have `summary=""`, `tags=[]`, `metadata={}` ✓
- **Diversity check:** Probe 7 classifies reflection as DIVERSE, project as DIVERSE, identity as HOMOGENEOUS. NOT all groups are HOMOGENEOUS.
- **Verdict:** H1 is **partially established** — the input lacks semantic scaffolding (all summaries/tags/metadata empty), but the raw content is not uniformly homogeneous.

### H2: Type-only grouping blocks cross-type synthesis

- **Tier A pairs (sim > 0.85) across types:** 0
- **Tier B pairs (0.5 < sim <= 0.85) across types:** 1
- **Verdict:** H2 is **inconclusive** — no cross-type near-duplicates exist, but 1 Tier B pair suggests potential cross-type topical overlap. This is NOT sufficient evidence to claim grouping blocks reflection. Document as open question.

### H3: Near-duplicate project memories trigger RULE 8 suppression

- **Within-project near-duplicates:** 10 pairs (5 near-identical "User Project: Aether" memories + related project memories)
- **Phase 6-AE finding:** RULE 8 relaxation proved zero effect on output.
- **Verdict:** H3 is **established but NOT binding** — RULE 8 suppression is active, but Phase 6-AE proved it is not the causal factor.

### H4: Historical reflection memories lack provenance

- **All 10 reflections have `source_ref = null` and `observation_id = null`** ✓
- **Semantic matching:** All 10 reflections found high-similarity matches (top similarity >= 0.78) within the pool. No reflection has top similarity < 0.7.
- **Verdict:** H4 is **falsified** — reflections are NOT semantically orphaned. They match other reflections closely. The provenance chain is broken (no source_ref/observation_id), but the semantic content persists in the pool via other reflections.

### H5: 21 memories genuinely have no valid reflection (INPUT_DOMINANT confirmed)

- **Evidence:**
  - No cross-type near-duplicates (Tier A = 0)
  - 11 within-type near-duplicates, all suppressed by RULE 8 within their groups
  - 1 cross-type Tier B pair (insufficient for reflection)
  - All 21 memories have empty summary/tags/metadata
  - Phase 6-AE proved prompt relaxation doesn't help
- **Verdict:** H5 is **established** — INPUT_DOMINANT is confirmed. The 21 memories genuinely lack sufficient cross-memory relationships for any valid reflection under the current reflector contract.

---

## Combined Findings

- **H1 partially established + H2 inconclusive + H3 established (not binding) + H4 falsified + H5 established**
- The binding constraint is **INPUT_DOMINANT**: the 21 memories genuinely do not contain relationship-rich content that satisfies the reflector's reflection type definitions.
- The near-duplicate project memories (H3) and empty metadata (H1) are symptoms, not causes.
- Future phase should focus on **enriching extraction** (summaries, tags, cross-type grouping) as a production change — justified by evidence.

---

## Artifacts

- `tests/phase-6-af/input-audit.test.ts` — read-only test harness
- `tests/phase-6-af/measurement.json` — all probe measurements
- `tests/phase-6-af/report.md` — this report

---

## Verification

```bash
npx vitest run tests/phase-6-af/input-audit.test.ts --testTimeout=120000  # PASSED
npx tsc --noEmit                                                          # PASSED
npm run build                                                             # PASSED
```

---

## Git Safety

- No production files modified by this phase.
- Only new files created under `tests/phase-6-af/`.
- Baseline git status confirmed before implementation.
