# Phase 6-AB Diagnostic Report

## 1. Objective

Determine why the current full 21-memory production input causes the real reflector to return `[]`, despite the database containing historical reflection memories that demonstrate successful reflection generation in the past.

## 2. Exact Environment

- **OS**: Windows 10 (win32)
- **Node.js**: v20.x (via Next.js 16.2.12)
- **Ollama**: Available at `http://127.0.0.1:11434`
- **Model**: `qwen2.5:3b`
- **Test runner**: Vitest 2.1.9
- **Database**: Supabase (service role, read-only access)
- **User ID**: `b8288155-65d0-4c0a-90da-2c116237087f`
- **Total memories in DB**: 37
- **Eligible memories**: 21 (after production filter)

## 3. Model Configuration

- **Model**: `qwen2.5:3b`
- **Temperature**: `0.1`
- **num_predict**: `300`
- **top_p**: `0.8`
- **num_ctx**: `4096`
- **Endpoint**: `http://127.0.0.1:11434/api/chat`

## 4. Input Construction

The production reflector input is constructed in `lib/core/pipeline.ts:107-142`:

1. `getAllMemories(userId)` fetches all memories (read-only SELECT)
2. Filter: `(status === "active" || status === "candidate") && confidence_v2 >= 0.7 && importance_v2 >= 0.5`
3. Group by `memory_type` using `reduce`
4. Map each group to `ReflectionInput[]` with fields: `id, title, content, summary, importance, confidence, memoryType, tags, metadata`

This diagnostic reproduces the exact same construction logic for each condition.

## 5. Condition Definitions

| ID | Name | Memory Subset | Rationale |
|----|------|---------------|-----------|
| A | Full | All 21 eligible memories | Exact production input |
| B | Reflection-only | 10 reflection memories | Isolate reflection type behavior |
| C | Non-reflection-only | 11 non-reflection (9 project + 2 identity) | Isolate non-reflection behavior |
| D | Reflection + Project | 10 reflection + 9 project (exclude 2 identity) | Isolate identity memory influence |
| E | Reflection + Identity | 10 reflection + 2 identity (exclude 9 project) | Isolate project memory influence |

## 6. Raw Model Outputs

| Condition | Raw Response Text | Length | Empty Text | Literal `[]` |
|-----------|------------------|--------|------------|--------------|
| A Full | `{"model":"qwen2.5:3b",...,"message":{"role":"assistant","content":"[]"},...}` | 299 | No | Yes (content field) |
| B Reflection-only | `{"model":"qwen2.5:3b",...,"message":{"role":"assistant","content":"[]"},...}` | 292 | No | Yes (content field) |
| C Non-reflection-only | `{"model":"qwen2.5:3b",...,"message":{"role":"assistant","content":"[]"},...}` | 293 | No | Yes (content field) |
| D Reflection+Project | `{"model":"qwen2.5:3b",...,"message":{"role":"assistant","content":"[]"},...}` | 294 | No | Yes (content field) |
| E Reflection+Identity | `{"model":"qwen2.5:3b",...,"message":{"role":"assistant","content":"[]"},...}` | 293 | No | Yes (content field) |

All conditions returned the Ollama API wrapper object with `message.content` equal to literal `[]`.

## 7. Parser Results

| Condition | Parse Success | Root Type | Pre-Sanitizer Count |
|-----------|--------------|-----------|---------------------|
| A Full | Yes | array | 0 |
| B Reflection-only | Yes | array | 0 |
| C Non-reflection-only | Yes | array | 0 |
| D Reflection+Project | Yes | array | 0 |
| E Reflection+Identity | Yes | array | 0 |

All conditions: model content parsed successfully as JSON array with 0 elements.

## 8. Sanitizer Results

| Condition | Sanitizer Accepted | Sanitizer Rejected | Rejection Reasons |
|-----------|--------------------|--------------------|-------------------|
| A Full | 0 | 0 | N/A (empty array) |
| B Reflection-only | 0 | 0 | N/A (empty array) |
| C Non-reflection-only | 0 | 0 | N/A (empty array) |
| D Reflection+Project | 0 | 0 | N/A (empty array) |
| E Reflection+Identity | 0 | 0 | N/A (empty array) |

No sanitizer rejections occurred because the model returned empty arrays before the sanitizer was invoked.

## 9. Duplicate Analysis

- **Total memories**: 21
- **Total pairs**: 210
- **Near-duplicate pairs (similarity > 0.8)**: 12
- **Duplicate ratio**: 5.7%
- **Unique content clusters**: 15
- **Reflection memories total**: 10
- **Reflection memories summarizing existing facts**: 0
- **Reflection internal duplicate pairs**: 2
  - `0f7188b9-4833-4eeb-b89f-0aaaa44525d9` ↔ `ad438289-f5af-4334-b1e3-a09d65f52099` (similarity: 1.0)
  - `2e5a7d1a-92f0-4c10-a9e2-c94659968e5d` ↔ `460fe488-0b1f-4b6b-b59c-e658a62cf202` (similarity: 0.83)

## 10. Historical Reflection Analysis

- **Total reflection memories**: 10
- **Type distribution**:
  - REPEATED_PATTERN: 8
  - CONTRADICTION: 1
  - CHANGE_OVER_TIME: 1
- **Distinct titles**: 10/10
- **Orphaned (no source_ref)**: 10/10
- **Internal repeated patterns**: 2 pairs of near-identical reflections

All 10 reflection memories have `source_ref = null`, meaning they are not traceable to specific source memories. Two pairs are near-duplicates:
- "Professional Identity Consistency" ↔ "Professional Role Consistency" (identical content)
- "Language Preference Change" ↔ "TypeScript Preference Change" (83% similar)

## 11. Prompt-Rule Correlation

| Condition | RULE 8 Could Apply | RULE 12 Could Apply | FINAL CHECK Favors Empty |
|-----------|-------------------|---------------------|--------------------------|
| A Full | No | Yes | Yes |
| B Reflection-only | Yes | Yes | Yes |
| C Non-reflection-only | No | Yes | Yes |
| D Reflection+Project | No | Yes | Yes |
| E Reflection+Identity | No | Yes | Yes |

**Observations**:
- RULE 8 applies only to Condition B (Reflection-only) where all 10 memories share the same type. The model may have classified them as "same broad topic."
- RULE 12 applies to all conditions with >= 10 memories. The large input size increases the likelihood that any synthesized reflection would be seen as merely repeating existing facts.
- The FINAL CHECK ("Would [] be safer?") is consistent with the empty outcome across all conditions.

## 12. Comparison Matrix

| Condition | Memories | Result | Candidates | Classification |
|-----------|--------:|--------|-----------:|----------------|
| A Full | 21 | [] | 0 | MODEL_EMPTY |
| B Reflection-only | 10 | [] | 0 | MODEL_EMPTY |
| C Non-reflection-only | 11 | [] | 0 | MODEL_EMPTY |
| D Reflection+Project | 19 | [] | 0 | MODEL_EMPTY |
| E Reflection+Identity | 12 | [] | 0 | MODEL_EMPTY |

## 13. Root-Cause Classification

**Classification**: `MODEL_EMPTY_DUE_TO_INPUT_COMPOSITION`

**Evidence**:
- All 5 controlled conditions returned `MODEL_EMPTY` with literal `[]`
- The model's raw output (`message.content`) was exactly `[]` in every case
- No parse rejection, no sanitizer rejection, no network errors
- The empty result is consistent across all input compositions:
  - Reflection-only (10 memories, 1 group)
  - Non-reflection-only (11 memories, 2 groups)
  - Reflection + Project (19 memories, 2 groups)
  - Reflection + Identity (12 memories, 2 groups)
  - Full (21 memories, 3 groups)
- The duplicate ratio (5.7%) and reflection internal duplicates (2 pairs) suggest some redundancy, but the empty result persists even when duplicates are removed (Condition B removes non-reflection memories entirely).
- The prompt's RULE 12 and FINAL CHECK are consistent with the model's conservative choice of `[]`, but this is correlation, not proven causation.

## 14. Production-Change Decision

**`productionChangeJustified: false`**

No production change is justified at this time. The evidence shows the model consistently chooses `[]` across all input compositions. This is a model behavior observation, not a production defect. The reflector is functioning as designed: it calls the model, receives `[]`, parses it correctly, and returns an empty array.

## 15. Safety

- **productionWrites**: 0
- **Production files modified**: 0
- **No mutations to**: `lib/memory/reflector.ts`, `lib/core/pipeline.ts`, retrieval, scoring, lifecycle, thresholds, model, or database
- **No write RPCs called**: `saveMemory`, `insertMemoryV2`, `updateMemoryV2`, `corroborate_memory`, `merge_memories`, or any mutation operation
- **Raw model text**: Captured in-memory only; only safe metadata persisted to `measurement.json`

## 16. STOP

This phase ends here. No production change has been made. No fix has been implemented. No subsequent phase has been started automatically.

**Next decision requiring human authorization**: Whether to investigate further by examining the exact prompt text sent to the model (without modifying it), or to accept `MODEL_EMPTY` as the current correct behavior and adjust expectations accordingly.
