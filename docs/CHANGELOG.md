# CHANGELOG

All notable changes to Aether are recorded here. Newest entry first.

## [Memory V2 — Retriever] — 2026-08-13
**Scope:** Migrate the LIVE memory retrieval pipeline to V2. Only `lib/memory/retrieve.ts` changed; no SQL, migrations, UI, chat route, planner, identity, knowledge, or memory writer modified.

### Changed
- Rewrote `retrieveMemories(userId, query)` in `lib/memory/retrieve.ts` to the V2 pipeline:
  1. Embed the query via `embed()`.
  2. Retrieve via `matchMemoriesV2()` (→ `match_memories_v2` RPC) using `RETRIEVAL_TOP_K` / `MIN_SIMILARITY` from `@/lib/memory/constants`.
  3. Score each candidate with `scoreRetrievalCandidate()` (fusion of similarity, importance, recency, confidence, typeWeight, and usage).
  4. Sort by `effective_score` (lifecycle priority).
  5. Re-rank with MMR via `mmrScore()` (lambda `MMR_LAMBDA`), using pairwise cosine similarity over candidate embeddings re-fetched from `memories` (the `match_memories_v2` RPC does not return embeddings). Embedding-fetch failure is non-fatal → falls back to relevance-only order.
  6. Greedily enforce the token budget — global `TOTAL_MEMORY_TOKEN_CAP` plus per-type `TOKEN_BUDGETS`.
  7. Bump usage for surfaced memories via batched `touchMemories()` (→ `touch_memories` RPC).
- Added ordered helpers `approxTokens`, `memoryTokenCount`, `cosine`, `selectWithinTokenBudget` (defined before use).

### Preserved (unchanged)
- Public API: `retrieveMemories(userId: string, query: string)` signature + return shape unchanged; caller `lib/context/builder.ts` unaffected. All legacy repository functions preserved; writer (`upsertMemory.ts` / `memory.ts`) untouched.

### Deferred (intentional, this milestone)
- Memory Writer phase (`lib/memory/upsertMemory.ts` → `insertMemoryV2` + V2 classification/dedupe). See `docs/ENGINEERING_LOG.md` and `docs/NEXT_TASK.md`.

### Quality gates
- `npm run build` → ✅ Compiled successfully (3.1s); TypeScript clean (3.1s); 14/14 static pages; `/api/chat` remains `ƒ` (Dynamic).
- `npm run lint` → ✅ 0 errors (4 pre-existing `react-hooks/exhaustive-deps` warnings in untouched UI components).

## [Memory V2 — Repository Bridge] — 2026-08-13
**Scope:** Migrate the data-access repository to Memory V2. **No SQL, UI, retriever, or writer changes. Additive only.**

### Added
- `lib/repositories/memory.repository.ts`:
  - `matchMemoriesV2(queryEmbedding, userId, opts?)` — wraps the existing `match_memories_v2` RPC (`p_match_count`, `p_min_similarity`, `p_types`, `p_statuses`, `p_project_id`) with defaults sourced from `@/lib/memory/constants` (`RETRIEVAL_TOP_K=30`, `MIN_SIMILARITY=0.65`, `p_statuses=['active']`).
  - `touchMemories(ids: string[])` — wraps the `touch_memories` RPC (batched `times_used`/`last_used`).
  - `insertMemoryV2(data: InsertMemoryV2Input)` — inserts into `memories` using V2 columns; omitted V2 fields use DB defaults.
  - `updateMemoryV2(id, updates: UpdateMemoryV2Input)` — updates V2 fields on `memories`.
  - Supporting inputs: `MatchMemoriesV2Options`, `InsertMemoryV2Input`, `UpdateMemoryV2Input` (typed with `MemoryType`/`MemoryStatus`/`MemorySource` from `lib/memory/types`).

### Preserved (unchanged)
- All six legacy functions (`findMemoryByTitle`, `getMemoryByTitle`, `insertMemory`, `updateMemoryById`, `matchMemories`, `incrementMemoryUsage`) — signatures + bodies byte-identical. Callers `lib/memory/retrieve.ts`, `lib/memory/upsertMemory.ts`, `lib/memory/memory.ts` are untouched.

### Deferred (intentional)
- `findNearDuplicates` (→ `find_near_duplicates` RPC) — **blocked by a SQL defect** in `0004_memory_v2_rpcs.sql` (the function is missing its closing `$$;`). Not added until the SQL is corrected (SQL change out of scope for this milestone). See `docs/ENGINEERING_LOG.md`.

### Quality gates
- `npm run lint` → **0 errors** (only pre-existing warnings in untouched UI components).
- `npm run build` → ✅ Compiled successfully; TypeScript OK; 14/14 static pages prerendered.

### Constraints honored
- No migrations, enums, tables, indexes, or RPCs created or modified.
- No SQL touched. No UI touched. Retriever (`retrieve.ts`) and writer (`upsertMemory.ts`/`memory.ts`) untouched.

