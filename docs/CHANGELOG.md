# CHANGELOG

All notable changes to Aether are recorded here. Newest entry first.

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

