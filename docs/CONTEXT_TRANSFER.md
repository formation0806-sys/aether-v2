# AETHER — CONTEXT TRANSFER DOCUMENT

> Handoff/state document for resuming work in a **new ChatGPT chat**. Read fully before writing any code.
> Supersedes the stale `docs/MASTER_PLAN.md`, `docs/CURRENT_STATE.md`, `docs/NEXT_TASK.md`, `docs/DECISIONS.md` (those still describe Milestone 2 / Phase 1 and are out of date).

---

## 1. Quick Facts

| Item | Value |
|---|---|
| Project | **Aether** — AI operating system with persistent human-like memory |
| Stack | Next.js **16.2.12** (Turbopack, App Router), React 19.2.4, TypeScript 5 (strict), Tailwind v4 |
| Data | Supabase (`@supabase/ssr` 0.12.4, `@supabase/supabase-js` 2.112.0) |
| AI | Local **Ollama** at `http://127.0.0.1:11434` — all calls are direct `fetch` |
| Chat model | `qwen2.5:3b` (temperature 0.2, `num_predict` 200, `top_p` 0.9, `num_ctx` 2048) |
| Embedding model | `nomic-embed-text` (768-dim vector) |
| Migration status | `supabase/migrations/0000`–`0006`, all **applied live** |
| Verify commands | `npx tsc --noEmit` then `npm run build` |
| ⚠️ Next.js version | This repo's Next.js has **breaking changes** vs training data — read `node_modules/next/dist/docs/` before writing Next-specific code |

**Environment note:** `.env.local` is loaded by `npm run build`. The only build warning is the deprecated `middleware` file convention (Next suggests `proxy`) — pre-existing and non-blocking.

---

## 2. Git State (EXACT)

- **Branch:** `feature/memory-v2-foundation`
- **HEAD:** `3069473` — `Sprint 14 - Build Reflection Input`
- **CRITICAL — Sprint 18 and Sprint 19 are NOT committed.** Working tree has 3 modified files:

| File | Sprint | What changed |
|---|---|---|
| `lib/memory/aiExtractor.ts` | 18 | Shared `ExtractedMemory` return type, optional-signal prompt, sanitizer |
| `lib/memory/memory.ts` | 19 | `saveMemory` uses `scoreExtractedMemory` + `insertMemoryV2` / `updateMemoryV2` |
| `lib/core/pipeline.ts` | 19 | `saveMemory(...)` forwards `memoryType/importance/confidence/explicit` |

**Commit history (newest first):** Sprint 14 → Sprint 13 → Sprint 12 → Sprint 10 → "Wire Memory V2 writer into chat pipeline" → "feat(memory): migrate retriever to Memory V2" → "Milestone 2: Memory repository bridge" → milestone 1 foundation → "Sprint 8 - AI Memory Extraction Working" → "Sprint 7 - Brain connected to memory retrieval" → "Sprint 6 - Brain v1 architecture complete" → auth cleanup commits.

Sprints 15, 16, 17 were **inspection-only** (no code changes, no commits).

---

## 3. Repository Map (`lib/`)

### Core
- `core/pipeline.ts` — `runPipeline(runtime)` (full chat flow) + `runReflection(userId)` (§4).
- `core/runtime.ts` — `Runtime` class holding mutable state (message, context, prompt, response).
- `core/types.ts`, `core/index.ts` — runtime types / re-exports.

### AI
- `ai/provider.ts`, `ai/bootstrap.ts`, `ai/index.ts` — singleton `AIProvider`.
- `ai/providers/ollama.ts` — `chat()` + `embed()` via Ollama fetch.
- `ai/providers/dummy.ts` — fallback provider.
- `ai/embeddings/embed.ts` — `embed(text)` → `{ embedding: number[] }` (768-dim, nomic-embed-text).
- `ai/conversation/manager.ts` + `history.ts` — save/build conversation messages.

### Brain & Context
- `brain/brain.ts` — `buildBrain({ context })` → `{ prompt }`; plain template: IDENTITY/MEMORIES/KNOWLEDGE/PLANNER sections + RULES.
- `context/builder.ts` — `buildContext(userId, message)`: `Promise.all` of identity, `retrieveMemories`, knowledge, planner.

### Memory (main focus)
- `memory/aiExtractor.ts` — **Sprint 18 state** (§4c).
- `memory/memory.ts` — **Sprint 19 state** — `saveMemory`, `getRelevantMemories` (§4d).
- `memory/score.ts` — deterministic scoring: `scoreExtractedMemory`, `importanceScore`, `retrievalScore`, `effectiveScore`, `mmrScore`, `usageFactor`, `clamp01`/`clamp`, `normalizeExtractedImportance`. **DO NOT modify.**
- `memory/types.ts` — shared types: `MemoryType` (8), `MemoryStatus` (5), `MemorySource` (8), `MemoryRow`, `ExtractedMemory`, `RetrievalCandidate`, weights. **DO NOT modify.**
- `memory/constants.ts` — thresholds, weights, half-lives, `DEFAULT_EXTRACTED_IMPORTANCE=5`, `DEFAULT_CONFIDENCE=0.5`. **DO NOT modify.**
- `memory/retrieve.ts` — `retrieveMemories(userId, query)`: V2 RPC → fusion scoring → effectiveScore sort → MMR → token budget → `touchMemories`.
- `memory/upsertMemory.ts` — **second, legacy write path** (`insertMemory`/`updateMemoryById`) — NOT wired to V2 (§8, E1).
- `memory/extractor.ts` — legacy regex-based `extractMemories` (superseded; unused by pipeline).
- `memory/index.ts` — re-exports `memory`, `retrieve`, `upsertMemory`.

### Repositories
- `repositories/memory.repository.ts` — the ONLY data-access layer for memories. Contains legacy `findMemoryByTitle`, `getMemoryByTitle`, `insertMemory`, `updateMemoryById`, `matchMemories`, `incrementMemoryUsage`; V2 `matchMemoriesV2`, `touchMemories`, `insertMemoryV2`, `updateMemoryV2`, `getAllMemories`; typed inputs `InsertMemoryV2Input`, `UpdateMemoryV2Input`, `MatchMemoriesV2Options`. **DO NOT modify.**
- `repositories/identity.repository.ts`, `knowledge.repository.ts`, `planner.repository.ts`, `conversation.repository.ts`.

### Other
- `supabase/client.ts`, `supabase/server.ts`, `supabase/middleware.ts` — SSR client.
- `identity/`, `knowledge/`, `planner/` — modules used by the context builder.
- `utils.ts` — shared helpers.

---
## 4. Current Code Behavior — The Pipeline

### 4a. `runPipeline(runtime)` — ordered steps (`lib/core/pipeline.ts`)
1. `console.time("TOTAL")`, read runtime state.
2. `buildContext(userId, message)` (time "Context") → `runtime.update({ context })`.
3. `buildBrain({ message, context })` (time "Brain") → `runtime.update({ prompt })`.
4. `saveUserMessage` (time "Save User").
5. `buildConversation(userId)` (time "Conversation"); `system` message = brain prompt prepended.
6. `getProvider().chat(conversation)` (time "LLM") → response.
7. `saveAssistantMessage` (time "Save Assistant") → `runtime.update({ response })`.
8. **Memory extraction** (time "Extract memories"): gate `shouldExtractMemory(message)` = trimmed length ≥ 15 AND not in `MEMORY_GATE_SKIP` (`hi/hello/hey/thanks/ok`...). If it passes → `aiExtractMemories(message)` → per memory `await saveMemory({...})` (inner try/catch → `MEMORY SAVE FAILED`); `didExtractMemory = memories.length > 0`. Outer try/catch → `MEMORY EXTRACTION FAILED`.
9. **Reflection hook:** `if (didExtractMemory) await runReflection(userId)` (try/catch → `REFLECTION FAILED`).
10. `console.timeEnd("TOTAL")`, `return runtime.get()`.

**Sprint 19 change (exact):** step 8's call:
```ts
await saveMemory({
  userId: state.userId,
  title: memory.title,
  content: memory.content,
  memoryType: memory.memoryType,
  importance: memory.importance,
  confidence: memory.confidence,
  explicit: memory.explicit,
});
```
Extraction loop, `didExtractMemory` guard, and reflection call unchanged.

### 4b. `runReflection(userId)` — EXACT current state
1. `getAllMemories(userId)` (selects `id,title,content,summary,memory_type,status,importance_v2,confidence_v2,created_at,updated_at` — **no status filter**, returns all rows). On `error` → `REFLECTION LOAD FAILED`, return.
2. `safeMemories = memories ?? []` → log `REFLECTION MEMORIES <count>`.
3. **Candidate filter (Sprint 12 — thresholds are frozen):**
   ```ts
   const reflectionCandidates = safeMemories.filter(
     (m) =>
       m.status === "active" &&
       m.confidence_v2 >= 0.7 &&
       m.importance_v2 >= 0.5
   );
   ```
   Log `REFLECTION CANDIDATES <count>`.
4. **Group (Sprint 13):** `reflectionGroups = reflectionCandidates.reduce(...)` keyed by actual `memory.memory_type`. Log `REFLECTION GROUPS <count>`.
5. **Input (Sprint 14):** `reflectionInput = Object.entries(reflectionGroups).map(([memoryType, memories]) => ({ memoryType, memories: memories.map(...{ id, title, content, summary }) }))`. Log `REFLECTION INPUT GROUPS <count>`.
6. `return;` — **NO AI, no DB writes, no lifecycle changes.**

Expected log sequence:
```
MEMORY INSERTED / MEMORY UPDATED
REFLECTION MEMORIES 13
REFLECTION CANDIDATES <n>
REFLECTION GROUPS <n>
REFLECTION INPUT GROUPS <n>
```

### 4c. `aiExtractMemories()` — Sprint 18 state (`lib/memory/aiExtractor.ts`)
- Imports shared `ExtractedMemory`, `MemoryType`, `MEMORY_TYPES` from `./types` (local duplicate interface removed).
- Prompt requires strict JSON `[{ "title", "content", "memoryType", "importance": 1-10, "confidence": 0-1, "explicit": true|false }]`; `memoryType` restricted to the 8 enum values; `explicit` true only when the user explicitly asked to remember.
- `sanitizeExtractedMemory(raw)`: `title`/`content` must be strings (else item dropped); optional fields kept ONLY if `memoryType` ∈ enum list, `importance` ∈ [1,10], `confidence` ∈ [0,1], `explicit` boolean. **Invalid → omitted (undefined). No defaults assigned in the extractor.**
- Invalid JSON → `[]` (unchanged). Logs `OLLAMA RAW:` + raw text.

### 4d. `saveMemory()` — Sprint 19 state (`lib/memory/memory.ts`)
Input:
```ts
export interface SaveMemoryInput {
  userId: string;
  title: string;
  content: string;
  role?: string;          // kept for API compat; no longer written (DB default 'system')
  memoryType?: MemoryType;
  importance?: number;    // raw 1..10
  confidence?: number;    // 0..1
  explicit?: boolean;
}
```
Behavior:
1. `embed(content)`.
2. **Sole source of V2 scores:** `const { importance: importanceV2, confidence: confidenceV2 } = scoreExtractedMemory({ title, content, memoryType, importance, confidence, explicit });`
3. `findMemoryByTitle(userId, title)`:
   - identical content → `MEMORY SKIPPED`, return.
   - different content → `updateMemoryV2(id, { content, embedding: vector.embedding, memory_type: memoryType, importance_v2: importanceV2, confidence_v2: confidenceV2 })`; `if (error) throw error`; `MEMORY UPDATED`; return.
4. New → `insertMemoryV2({ user_id, title, content, embedding: vector.embedding, memory_type: memoryType, importance_v2: importanceV2, confidence_v2: confidenceV2, source_v2: "extractor" })`; `if (error) throw error`; `MEMORY INSERTED`.

Notes:
- **`status` is never set** → DB default `candidate`.
- `undefined` optional fields are dropped by the Supabase client's JSON serialization → DB defaults apply (e.g., `memory_type` → `semantic`).
- `explicit` feeds the scorer only; **not persisted** (no DB column).
- Error handling shape unchanged: every writer's `error` is rethrown; the pipeline catches per-memory.

---
## 5. Memory V2 — Schema & Migrations (all applied live)

### Enums (`0001_memory_v2_enums.sql`)
- `memory_type`: `semantic, identity, procedural, project, episodic, reflection, conversation, working`
- `memory_status`: `candidate, active, fading, archived, deleted`
- `memory_source`: `user, assistant, system, extractor, reflection, consolidation, import, merge`

### V2 columns on `memories` (`0002_memory_v2_tables.sql`) — all NOT NULL with defaults:

| Column | Type | Default |
|---|---|---|
| `memory_type` | `memory_type` | `semantic` |
| `status` | `memory_status` | **`candidate`** |
| `summary` | `text` | `''` |
| `tags` | `text[]` | `{}` |
| `importance_v2` | `numeric(3,2)` | **`0.5`** |
| `confidence_v2` | `numeric(3,2)` | **`0.5`** |
| `source_v2` | `memory_source` | `extractor` |
| `metadata` | `jsonb` | `{}` |
| `effective_score` | `numeric(4,3)` | `0.5` |
| `source_ref` / `cluster_id` / `project_id` | nullable | null |
| `last_scored` | `timestamptz` | `now()` |

Legacy baseline columns (`0000`): `id, user_id, role (default 'system'), title, content, embedding vector(768), times_used 0, last_used, created_at`.

Other tables in 0002: `memory_clusters`, `memory_edges`, `memory_events`, `memory_jobs`; `messages.session_id`, `messages.token_count`. Indexes in `0003`.

### RPCs
- `0004_memory_v2_rpcs_old.sql` — **fragile**: `match_memories_v2` (old signature; references non-existent `m.importance` / `m.confidence` columns), `find_near_duplicates` (**MALFORMED — missing closing `$$;`**, its body bleeds into `apply_memory_decay` — see §8, E3), `apply_memory_decay`.
- `0006_match_memories.sql` — **the live definition**: redefines `match_memories_v2(p_user_id, p_query_embedding, p_match_threshold default 0.75, p_match_count default 10)`, returns `memory_type`/`status` enums + `importance = importance_v2`, `confidence = confidence_v2`. **Has NO status filter.** Also defines `touch_memories(p_ids)` (increments `times_used`, sets `last_used`).
- Repository `matchMemoriesV2` passes `p_match_threshold = options.minSimilarity ?? MIN_SIMILARITY (0.65)`, `p_match_count = options.matchCount ?? RETRIEVAL_TOP_K (30)`.

### Backfill (`0005_memory_v2_backfill.sql`)
One-time: for rows matching `status='candidate' AND source_v2='extractor' AND memory_type='semantic'` sets `memory_type='semantic'`, `status='active'`, `summary` from content, `importance_v2=0.50`, `confidence_v2=0.50`, `source_v2='import'`, `effective_score=0.50`. Creates `migration_meta`. **Note: it sets `confidence_v2` to 0.50, NOT ≥ 0.7 — so even backfilled "active" rows still fail the reflection filter.**

---

## 6. Scoring Module (`lib/memory/score.ts`) — the deterministic scorer

Key exported fns: `clamp01`, `clamp`, `normalizeExtractedImportance`, `daysBetween`, `decayFactor`, `importanceScore`, `retrievalScore`, `usageFactor`, `scoreRetrievalCandidate`, `mmrScore`, `effectiveScore`, `effectiveScoreForType`, `scoreExtractedMemory`.

`scoreExtractedMemory(candidate: ExtractedMemory): { importance: number; confidence: number }`:
```ts
const memoryType = candidate.memoryType ?? "semantic";
const importance = importanceScore({ memoryType, extractedImportance: candidate.importance, confidence: candidate.confidence, explicit: candidate.explicit });
const confidence = clamp01(candidate.confidence ?? DEFAULT_CONFIDENCE); // 0.5
return { importance, confidence };
```
`importanceScore` weighted composite (all 0..1): `0.35*explicitImportance + 0.25*typeWeight + 0.15*confidence + 0.10*explicitFlag + 0.10*feedbackDelta + 0.05*novelty`, where `normalized = clamp((importance ?? 5)/10,0,1)`.

**Concrete computed values for a bare extractor output `{ title, content }` (no optional signals):**
- `importance_v2 = 0.35*0.5 + 0.25*0.6 + 0.15*0.5 + 0.10*0.5 + 0.05*0 = 0.45`
- `confidence_v2 = clamp01(undefined ?? 0.5) = 0.5`

**➡ Both fall BELOW the reflection bar (`importance >= 0.5`, `confidence >= 0.7`) — this is the structural reason `REFLECTION CANDIDATES` stays 0 even after Sprint 19.** Getting real extractor signals (good `confidence`, higher `importance`, a type) is what will move these up; see §9.

Relevant constants (`constants.ts`): `DEFAULT_EXTRACTED_IMPORTANCE = 5`, `DEFAULT_CONFIDENCE = 0.5`, `TYPE_WEIGHTS` (identity 1.0 … working 0.3, semantic 0.6), `IMPORTANCE_WEIGHTS`, `PROMOTE_ACTIVE_THRESHOLD = 0.6`, `DEMOTE_FADING_THRESHOLD = 0.25`, `ARCHIVE_THRESHOLD = 0.15`, `PROMOTE_USED_COUNT = 3`, `PROMOTE_CONFIDENCE = 0.7`, `CONFIDENCE_CORROBORATION_STEP = 0.05`, `CONFIDENCE_CORRECTION_STEP = 0.1`, `REFLECT_EVERY_N_TURNS = 10`, `REFLECTION_CORRECTION_MIN_CONFIDENCE = 0.75`.

---

## 7. Completed Sprints (authoritative record)

| Sprint | Scope | Status / Verdict |
|---|---|---|
| Phase 0 | Auth + foundation scaffolding | Done |
| 6 | Brain v1 architecture (`brain/brain.ts`) | Done, committed |
| 7 | Brain connected to memory retrieval | Done, committed |
| 8 | AI memory extraction working (Ollama JSON) | Done, committed |
| 10 | Reflection hook (`if didExtractMemory → runReflection`) | Done, committed |
| 12 | Reflection **candidate filter** (`active / ≥0.7 / ≥0.5`) | Done, committed (`51cfcc5`) |
| 13 | Reflection candidate **grouping by memory_type** | Done, committed (`af138a8`) |
| 14 | **Reflection input** build (`reflectionInput`) + log | Done, committed (`3069473`, HEAD) |
| 15–17 | Root-cause **inspections** (why 0 candidates) | Done, no code, no commits |
| 18 | Extractor returns shared `ExtractedMemory` + optional `memoryType/importance/confidence/explicit` + sanitizer | **Done, NOT committed** |
| 19 | Wire signals through `saveMemory` → `scoreExtractedMemory` → `insertMemoryV2`/`updateMemoryV2`; pipeline forwards | **Done, NOT committed** |

---
## 8. Root Cause & Mistakes Discovered

- **R1 — Write-path gap (fixed in Sprint 19):** `saveMemory` inserted only legacy columns via `insertMemory`/`updateMemoryById`; the V2 writers (`insertMemoryV2`/`updateMemoryV2`) existed but had **zero callers** (dead code).
- **R2 — Extractor emitted no V2 signals (fixed in Sprint 18):** it returned only `{ title, content }`; `memoryType/importance/confidence/explicit` were never produced.
- **R3 — `scoreExtractedMemory` was dead code** before Sprint 19 (exported, never called).
- **R4 — Schema defaults vs reflection thresholds are structurally incompatible:**
  - New rows → `status='candidate'` (filter needs `active`), `confidence_v2=0.5` (filter needs ≥ `0.7`), `importance_v2=0.5` (filter needs ≥ `0.5`).
  - Even backfilled rows (`0005` → `status='active'`) have `confidence_v2=0.50` → still fail.
  - Even after Sprint 19, a bare `{title,content}` memory scores `importance 0.45 / confidence 0.5` → **still fails both bars**.
  - **Overall: without richer extractor signals AND a promotion step, `REFLECTION CANDIDATES` is deterministically 0.**
- **R5 — `updateMemoryById` (legacy) wrote only `content`/`embedding`** — an "UPDATE" could never touch V2 columns or promote a memory.
- **R6 — Live RPC issues:** `0004.match_memories_v2` references non-existent `m.importance`/`m.confidence` columns; `0004.find_near_duplicates` is **malformed** (missing closing `$$;` — its body flows into `apply_memory_decay`). `0006` redefines `match_memories_v2` correctly and has **no status filter** (returns all embedding-bearing rows passing similarity). These are deferred (dedupe/lifecycle milestones).
- **E1 — Second legacy writer:** `upsertMemory()` (`memory/upsertMemory.ts`) still calls `insertMemory`/`updateMemoryById`, so it is NOT on the V2 path and would bypass Sprint 19 scoring. Unused by the chat pipeline today.
- **E2 — Docs are stale:** `MASTER_PLAN.md`/`CURRENT_STATE.md`/`NEXT_TASK.md`/`DECISIONS.md` still describe Milestone 2 / Phase 1. This document supersedes them.
- **E3 — `memory/extractor.ts`** (regex heuristic) is superseded by `aiExtractor.ts` and unused by the pipeline.
- **E4 — type duplication fixed:** `aiExtractor.ts` previously declared its own `ExtractedMemory` interface instead of the shared one (fixed Sprint 18).

---

## 9. Decisions Made (binding)

1. **Reflection is built incrementally:** filter → group → input only. **NO AI reflection generation yet.** No LLM summary, no writes in `runReflection`.
2. **Reflection filter thresholds are frozen:** `status === "active"`, `confidence_v2 >= 0.7`, `importance_v2 >= 0.5`. Do not lower them to "make the test pass."
3. **No fabricated scores:** `importance_v2`/`confidence_v2` come **only** from `scoreExtractedMemory()` (deterministic, existing constants). Never hard-code `0.7`/`0.5`/scoring values into `memory.ts`. The extractor assigns **no** defaults; it omits invalid fields.
4. **`status` stays `candidate` at write time.** Promotion (`candidate → active`) and confidence growth are a **separate lifecycle sprint** — not now, not by forcing `active`.
5. **`explicit` is not persisted** (no DB column); it only feeds scoring.
6. **Reuse existing pieces** — shared `ExtractedMemory`, `scoreExtractedMemory`, `insertMemoryV2`/`updateMemoryV2`, constants, types. No duplicate systems, no new modules for existing concerns.

---

## 10. Constraints — What MUST NOT Be Changed

**Frozen / do-not-modify (verify before each task):**
- `lib/memory/score.ts` (especially `scoreExtractedMemory`), `lib/memory/types.ts`, `lib/memory/constants.ts`
- `lib/repositories/memory.repository.ts`
- `supabase/migrations/*` (until a dedicated schema milestone)
- `lib/memory/aiExtractor.ts` (Sprint 18 output is the agreed contract)
- The reflection filter & its thresholds in `runReflection` (`status/confidence_v2/importance_v2`)
- `saveMemory`'s Sprint 19 write semantics (V2 writers, `scoreExtractedMemory` as sole source, `status` untouched)
- Embeddings, providers, retrieval (`retrieve.ts`), brain, context, knowledge, identity, planner
- No new files/folders unless a task expressly allows them; no package installs

**Cross-cutting rules (from MASTER_PLAN):** never break production; every milestone must build (`npm run build`) and pass `tsc`; never create duplicate systems; extend existing architecture; one milestone per session.

---

## 11. Exact Next Steps (ordered)

1. **Commit Sprint 18 + 19** — the 3 working-tree files (`lib/memory/aiExtractor.ts`, `lib/memory/memory.ts`, `lib/core/pipeline.ts`). Verify `npx tsc --noEmit` + `npm run build` first.
2. **Lifecycle / promotion sprint (Phase 4 — unblocks reflection):** design and wire candidate→active promotion and confidence growth using **existing constants only** (`PROMOTE_ACTIVE_THRESHOLD=0.6`, `PROMOTE_USED_COUNT=3`, `PROMOTE_CONFIDENCE=0.7`, `CONFIDENCE_CORROBORATION_STEP=0.05`, `CONFIDENCE_CORRECTION_STEP=-0.1`, `DEMOTE_*`, `ARCHIVE_*`). Do NOT alter thresholds. Goal: let some memories reach `active` + `confidence_v2 >= 0.7`. Consider a one-time data backfill only if a task explicitly allows a migration — otherwise keep it code-only.
3. **Re-verify reflection:** once promotion exists, new memories should start producing nonzero `REFLECTION CANDIDATES / GROUPS / INPUT GROUPS`.
4. **Reflection generation (future):** use `reflectionInput` (already built) → send to LLM → generate insights → persist via `insertMemoryV2` with `memory_type='reflection'`, `source_v2='reflection'`. Reserve the `REFLECT_EVERY_N_TURNS=10` trigger if desired. This is a separate sprint.
5. **Fix R6 (deferred):** correct the malformed `0004.find_near_duplicates` and reconcile duplicate `match_memories_v2` definitions / nonexistent columns when the dedupe milestone starts.
6. **E1 (optional, later):** migrate `upsertMemory()` to the V2 writers for consistency.
7. **E2 (housekeeping):** update/refresh the stale `docs/*` or remove them in favor of this document.

---
## 12. How to Verify / Reproduce

1. **Type-check:** `npx tsc --noEmit`
2. **Build:** `npm run build` (expect success; only the middleware-convention warning).
3. **Live flow:** run the app (`npm run dev`) and send a memorable message (≥ 15 chars, not a gate word) so memory extraction triggers. Watch server logs:
   - `OLLAMA RAW:` → extracted JSON.
   - `MEMORY INSERTED` / `MEMORY UPDATED` / `MEMORY SKIPPED`.
   - `REFLECTION MEMORIES <n>` → `REFLECTION CANDIDATES <n>` → `REFLECTION GROUPS <n>` → `REFLECTION INPUT GROUPS <n>`.
4. **DB check (read-only):** `GET /memory` debug UI or a Supabase query on `memories` should show new rows with `status='candidate'`, `source_v2='extractor'`, and real `importance_v2`/`confidence_v2`/`memory_type` values derived from extractor signals.
5. **Expected current behavior:** until the lifecycle sprint (step 2 of §11), `REFLECTION CANDIDATES` will be `0` regardless of memory count — this is by design, not a bug.

---

## 13. One-Line State Summary

Sprints 1–14 (foundation through reflection input) are committed; Sprints 18–19 (extractor emits V2 signals → `saveMemory` scores deterministically and persists via `insertMemoryV2`/`updateMemoryV2`) are implemented but **uncommitted**; `status` intentionally remains `candidate` so `REFLECTION CANDIDATES` is still `0`; the next real sprint is **lifecycle/promotion**, then **LLM reflection generation**.
