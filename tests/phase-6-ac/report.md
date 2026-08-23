# Phase 6-AC — Controlled Prompt-Decision Audit Report

## 1. Objective

Inspect the exact production reflector prompt and determine whether its rules, serialization, decision criteria, and final checks explain the persistent `[]` output. Read-only. No production changes.

## 2. Environment

- **OS**: Windows 10 (win32)
- **Node.js**: v20.x (Next.js 16.2.12)
- **Ollama**: Available at `http://127.0.0.1:11434` (`qwen2.5:3b` confirmed present)
- **Test runner**: Vitest 2.1.9
- **Database**: Supabase (service-role, read-only access)
- **User ID**: `b8288155-65d0-4c0a-90da-2c116237087f`
- **Total memories in DB**: 37
- **Eligible memories (production filter)**: 21

## 3. Model Configuration

- **Model**: `qwen2.5:3b` (unchanged)
- **Temperature**: `0.1`
- **num_predict**: `300`
- **top_p**: `0.8`
- **num_ctx**: `4096`
- **Endpoint**: `http://127.0.0.1:11434/api/chat`

## 4. Production Reflector Location

- **File**: `lib/memory/reflector.ts`
- **Function**: `generateReflections()` — lines 320–400
- **Prompt constant**: `REFLECTION_SYSTEM_PROMPT` — lines 78–312
- **Invocation site**: `runReflection()` in `lib/core/pipeline.ts` — lines 83–187
- **Prompt assembled at**: `lib/memory/reflector.ts:334–354` (request body builder)

## 5. Exact Prompt Construction Path

1. `runReflection(userId)` (`lib/core/pipeline.ts:83`) calls `getAllMemories(userId)` — read-only SELECT.
2. Filters candidates: `status ∈ {active, candidate}` AND `confidence_v2 >= 0.7` AND `importance_v2 >= 0.5`.
3. Groups by `memory_type` via `reduce` (lines 107–118).
4. Maps each group to `ReflectionInput[]` (lines 127–142).
5. Calls `generateReflections(reflectionInput)` (`lib/memory/reflector.ts:320`).
6. Inside `generateReflections`, the request body is built exactly as:
   - `model: "qwen2.5:3b"`
   - `stream: false`
   - `options: { temperature: 0.1, num_predict: 300, top_p: 0.8, num_ctx: 4096 }`
   - `messages[0].role = "system"`, `content = REFLECTION_SYSTEM_PROMPT`
   - `messages[1].role = "user"`, `content = JSON.stringify(reflectionInput, null, 2)`
7. POST to `http://127.0.0.1:11434/api/chat`.
8. Parses `data.message.content`; requires array root; sanitizes via `sanitizeReflection`; returns at most 2 reflections.

No production source was modified to capture this. The capture was performed by intercepting `globalThis.fetch` at the test boundary (tee pattern identical to Phase 6-AA / 6-AB).

## 6. Exact Prompt Capture

Raw prompt text and raw model text were captured **in-memory only** and NOT persisted. Persisted are lengths, SHA-256 hashes (truncated to 16 hex chars), and structural metadata.

| Field | Value |
|-------|-------|
| Request URL | `http://127.0.0.1:11434/api/chat` |
| Model | `qwen2.5:3b` |
| Options | `temperature=0.1`, `num_predict=300`, `top_p=0.8`, `num_ctx=4096` |
| System prompt length | 5,136 chars |
| System prompt SHA-256 (16) | `24aa25c19b439cb5` |
| User prompt length | 8,516 chars |
| User prompt SHA-256 (16) | `6b2b21f4c5a3e796` |
| Memory count | 21 |
| Group count | 3 |

**Group details (as serialized into the user prompt):**

| memory_type | count |
|-------------|------:|
| reflection | 10 |
| project | 9 |
| identity | 2 |

The system-prompt hash `24aa25c19b439cb5` matches the constant `REFLECTION_SYSTEM_PROMPT` verbatim (no edits were made to `lib/memory/reflector.ts`). The user-prompt hash `6b2b21f4c5a3e796` is the JSON serialization of the 21 eligible memories grouped by type.

## 7. Input Serialization

- **Grouping**: by `memory_type` via `reduce` (production-verbatim).
- **Ordering**: insertion order within each type group (as returned by `getAllMemories` then `reduce`).
- **Fields included per memory**: `id`, `title`, `content`, `summary`, `importance`, `confidence`, `memoryType`, `tags`, `metadata`.
- **Fields excluded**: `source_ref`, `project_id`, `observation_id`, `effective_score`, `created_at`, `updated_at`, `status`.
- **Reflection memories treated as ordinary input**: **Yes** — no special mask, header, or flag distinguishes them from project/identity memories.
- **Duplicate recognition explicit**: **No** — near-duplicate memories are serialized identically with no "duplicate" marker.
- **Model instructed to avoid repeating existing reflections**: **No** — the prompt does not say "do not re-derive what existing reflection memories already say."
- **Summaries included**: Yes (mostly empty strings in current data).
- **Tags included**: Yes (all empty arrays in current data).
- **Metadata included**: Yes (all empty objects in current data).
- **Provenance included**: No (`source_ref`, `observation_id` excluded).
- **Observation IDs included**: No.

Key consequence: the 10 historical **reflection** memories are fed back to the model as if they were ordinary raw observations. The model is not told they are prior outputs. This means the model sees "reflection-like content" twice (once as input memory, once as what it is being asked to produce) without guidance on how to reconcile that.

## 8. Rule-by-Rule Analysis

| Rule | Exact behavior (from source) | Trigger condition | Current input satisfies trigger? | Evidence | Causal status |
|------|------------------------------|-------------------|----------------------------------|----------|---------------|
| RULE 1 | Use ONLY info explicitly present | N/A (always on) | — | Conservative constraint | correlation |
| RULE 7 | No reflection from one memory | <2 memories supplied | No (21 supplied) | Not the cause | not established |
| RULE 8 | No reflection merely because several memories share a broad topic | Multiple memories share a broad topic without deeper connection | **Yes** (reflection group has 10) | Type group `reflection` has 10 memories; if they share a broad topic, RULE 8 can reject | correlation |
| RULE 9 | No multiple reflections expressing the same idea | Several memories support same pattern | Yes (10 reflection memories present) | Model may treat reflections as evidence of existing patterns | correlation |
| RULE 10 | No reflection about the reflection itself | Model considers summarizing existing reflections | Possible | Input contains 10 reflection memories; rule text does not explicitly address this | not established |
| RULE 11 | No vague statements | Output is vague | N/A | Not the cause | not established |
| RULE 12 | Reflection must add info more useful than repeating source memories | Model judges reflection would merely repeat facts | **Yes** (21 memories, large surface) | Large input increases "merely repeats" risk | correlation |
| OUTPUT LIMIT | Return at most 2; usually 0 or 1 | No two independent high-confidence insights | Yes (model returned 0) | Ceiling, not floor — cannot alone explain 0 | correlation |
| FINAL CHECK | 8 silent verifications; "Would [] be safer?" → return [] | Any verification answers NO | **Yes** (model returned []) | Explicit structural bias toward empty | correlation |

No rule shows **established** causality. Five rules show **correlation**.

## 9. RULE 8 Analysis

**Exact text** (`lib/memory/reflector.ts:143–155`):
> RULE 8: Do not create a reflection merely because several memories mention the same broad topic.
> Example: Memory A "The user is building Aether." / Memory B "The user is testing Aether memory." — This alone is NOT enough to create a new reflection.

**Trigger condition**: Multiple memories share a broad topic without a deeper, grounded connection.

**Does current input satisfy it?** Partially. The `reflection` group contains 10 memories. Many of them concern overlapping Aether-development themes (TypeScript preference, professional identity, language preference). If the model reads them as "same broad topic," RULE 8 discourages a new reflection.

**Causal status**: `correlation`. RULE 8 is consistent with `[]` but does not prove the model invoked it. The `project` group (9 near-identical Aether test observations) and `identity` group (2) are also topically narrow, reinforcing the "broad topic" reading.

## 10. RULE 12 Analysis

**Exact text** (`lib/memory/reflector.ts:173–175`):
> RULE 12: A reflection must add information that is more useful than simply repeating the source memories.

**Trigger condition**: The model determines any candidate reflection would merely repeat existing facts rather than add novel synthesis.

**Does current input satisfy it?** Yes, structurally. With 21 input memories (and especially 10 of them being prior *reflections* that already summarize the raw material), the surface area of "already-stated facts" is large. A small local model at `temperature=0.1` is biased toward the safe "this would just repeat what's there" conclusion.

**Causal status**: `correlation`. RULE 12 is the single strongest candidate for explaining `[]`, but causality cannot be isolated without an A/B test against a modified prompt (which is out of scope for this read-only audit).

## 11. FINAL CHECK Analysis

**Exact text** (`lib/memory/reflector.ts:295–311`):
> FINAL CHECK BEFORE OUTPUT … 8. Would [] be safer? … If any answer is NO, do not output that reflection. Return [] instead.

**Trigger condition**: The model answers NO to any of the 8 silent verifications.

**Does current input satisfy it?** Yes — the model returned `[]` in all 5 Phase 6-AB conditions and again here. The FINAL CHECK is the most explicit structural bias toward empty output: it tells the model to prefer `[]` whenever uncertain.

**Causal status**: `correlation`. The FINAL CHECK makes `[]` the default safe choice. Combined with RULE 12 (and the conservative system preamble "Prefer returning [] over making a weak or speculative reflection," line 93–94), the prompt is heavily weighted toward emptiness. But we cannot prove which specific question the model answered NO to without modifying the prompt to instrument it (out of scope).

## 12. Historical Reflection Comparison

**Historical reflection memories (10 total):** all orphaned (`source_ref = null`), so original source inputs are **not reconstructable**.

| Detected type | Count |
|---------------|------:|
| REPEATED_PATTERN | 8 |
| CONTRADICTION | 1 |
| CHANGE_OVER_TIME | 1 |

Distinct titles: 10/10. Orphaned: 10/10.

**Comparison with current input:**

| Aspect | Historical successful reflections | Current real input |
|--------|-------------------------------------|-------------------|
| Source reconstructable? | No (orphaned) | N/A (raw memories present) |
| Reflection memories as INPUT | N/A (they were outputs) | 10 fed back as ordinary input |
| Dominant type | REPEATED_PATTERN (8/10) | N/A |
| Project memories | — | 9 near-identical Aether test observations |
| Cross-type relationships | implied | yes (project+identity+reflection) |
| Provenance in prompt | n/a | excluded |

**Key differences:**
1. Historical reflections are orphaned — we cannot verify they were produced from inputs materially different from today's; we only know they *were* produced at some point.
2. Today's input includes 10 reflection memories as *input*. The model is not told they are prior outputs, so it may treat them as "the facts are already summarized" → triggers RULE 12 / RULE 10 reasoning.
3. Today's project memories are dominated by near-identical Aether test observations (5 of 9 per Phase 6-X), which read as "same broad topic" → RULE 8.

**Assessment**: Historical success does **not** contradict the current `[]`. The current input is structurally different (reflections fed back as input, high intra-group topical overlap). The historical rows prove the *pipeline* can produce reflections, not that the *current input* should.

## 13. Causality Assessment

Classification: **`PROMPT_CONTRIBUTORY`**

Reasoning:
- 5 of 6 analyzed decision rules (RULE 8, RULE 9, RULE 12, OUTPUT LIMIT, FINAL CHECK) show **correlation** with `[]` for the current input.
- The system preamble ("Prefer returning [] over making a weak or speculative reflection") plus RULE 12 plus the FINAL CHECK's "Would [] be safer?" create a strong, explicit bias toward empty output.
- No rule reaches **established** causality because we did not (and must not) modify the prompt to instrument which rule fired. Causality would require a controlled prompt-ablation experiment, which is explicitly out of scope.

Therefore the prompt **strongly biases** the model toward `[]` for the current real input, but the exact causal mechanism cannot be isolated from this read-only audit alone.

## 14. Final Classification

**`PROMPT_CONTRIBUTORY`**

The persistent `[]` is most plausibly explained by the prompt's conservative decision structure (RULE 12 + FINAL CHECK + preamble) acting on an input that (a) includes 10 prior reflections as ordinary input and (b) has high intra-group topical overlap. This is correlation-level evidence; a stronger `PROMPT_CAUSAL` classification would require prompt-instrumentation that this phase forbids.

## 15. Limitations

1. **No causality isolation.** We cannot determine *which* rule the model invoked without modifying the prompt (forbidden).
2. **Historical sources unreconstructable.** All 10 reflection memories are orphaned (`source_ref = null`); we cannot confirm their original inputs differed from today's.
3. **Single invocation.** One real model call (Condition A) was made; the 5-condition matrix is inherited from Phase 6-AB, not re-run here.
4. **Prompt text not persisted.** Raw system/user prompt text was captured in-memory only (safety rule); only hashes/lengths are on disk. Re-identification requires re-running the capture.
5. **Heuristic type detection.** Reflection-type labels are keyword heuristics, not ground truth.

## 16. Verification

| Command | Result |
|---------|--------|
| `npx vitest run tests/phase-6-ac/prompt-decision-audit.test.ts --testTimeout=120000` | ✅ 1 passed |
| `npx tsc --noEmit` | ✅ no errors |
| `npm run build` | ✅ compiled successfully |
| `qwen2.5:3b` available on Ollama | ✅ confirmed |

Raw model response captured in-memory: `message.content = "[]"` → parsed as empty array → 0 candidates → classification `MODEL_EMPTY`.

## 17. Git Safety

**Baseline** (`git status --short` before): production files `lib/memory/reflector.ts`, `lib/core/pipeline.ts`, etc. were already modified (pre-existing, from earlier phases). `tests/` and `.kilo/` were untracked.

**After Phase 6-AC**: only new untracked files were added under `tests/phase-6-ac/`:
- `tests/phase-6-ac/prompt-decision-audit.test.ts`
- `tests/phase-6-ac/measurement.json`
- `tests/phase-6-ac/report.md`

No tracked production file changed during this phase. `git diff --stat -- lib app components package.json package-lock.json supabase` shows **no new changes** attributable to Phase 6-AC.

`productionWrites = 0`. No write RPCs executed. No memory inserted/updated/deleted.

## 18. Production-Change Decision

**`productionChangeJustified: false`**

Even though RULE 12 and the FINAL CHECK appear overly conservative, this phase is a diagnostic audit. Any prompt modification (relaxing RULE 12, removing the "Would [] be safer?" bias, or instructing the model to treat existing reflections as evidence) would be a **separate future phase** requiring explicit authorization. The evidence here is correlation-level and does not mandate a change.

## 19. STOP

Phase 6-AC is complete. No production change was made. No fix was implemented. No subsequent phase (e.g., 6-AD) was started automatically.

**Return summary:**
1. **Final classification**: `PROMPT_CONTRIBUTORY`
2. **Strongest evidence**: The prompt's FINAL CHECK ("Would [] be safer?") + RULE 12 + preamble explicitly bias toward `[]`; current input feeds 10 prior reflections back as ordinary input and has high intra-group topical overlap.
3. **Exact remaining uncertainty**: Which specific rule the model invoked cannot be isolated without forbidden prompt instrumentation; historical source inputs are unreconstructable.
4. **Production-change decision**: `false` — diagnostic only.
5. **Verification results**: vitest ✅, tsc ✅, build ✅, model available ✅.
6. **Git-safety result**: only new files under `tests/phase-6-ac/`; no tracked production file modified by this phase; `productionWrites = 0`.
