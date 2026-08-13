# ENGINEERING LOG

Decisions, audits, and rationale for Aether's Memory V2 migration. Newest entry first.

## 2026-08-13 — Repository bridge to Memory V2

### Starting state (from codebase audit)
- `docs/NEXT_TASK.md` is **stale**: it asks to "Implement additive Memory V2 database schema," but `supabase/migrations/0000`–`0005` already implement the **entire** V2 schema (enums, tables, V2 columns, indexes, RPCs, RLS, backfill). The database layer was already 100% complete before this session.
- The V2 TypeScript foundation (`lib/memory/types.ts`, `constants.ts`, `score.ts`) was complete but **orphaned**: `lib/memory/index.ts` only re-exports the legacy operational trio (`memory`, `retrieve`, `upsertMemory`). No live path imported the V2 modules.
- The live chat path (`app/api/chat/route.ts` → `runPipeline` → `buildContext` → `retrieveMemories`) still calls the **legacy** `match_memories` RPC via `lib/repositories/memory.repository.ts#matchMemories`.

### Decision
Additive repository migration — introduce V2 data-access methods that wrap the **existing** V2 RPCs/tables, while preserving every legacy function so callers are unaffected. SQL is not touched because the schema already exists and is out of scope.

### What changed
- Added to `lib/repositories/memory.repository.ts`: `matchMemoriesV2` (→ `match_memories_v2`), `touchMemories` (→ `touch_memories`), `insertMemoryV2`, `updateMemoryV2`, plus input interfaces. Imports added: `RETRIEVAL_TOP_K`, `MIN_SIMILARITY` from `@/lib/memory/constants`; types `MemoryType`/`MemoryStatus`/`MemorySource` from `@/lib/memory/types`. No other files modified.

### Intentionally deferred
- `findNearDuplicates` (→ `find_near_duplicates`). **Blocked by defect (1) below.** Also, wiring `matchMemoriesV2` into `lib/memory/retrieve.ts` (the retriever) and into the writer were explicitly out of scope this milestone per task constraints.

### Risks / defects surfaced
1. **`0004_memory_v2_rpcs.sql` — `find_near_duplicates` missing closing `$$;`.** Its function body runs into the `apply_memory_decay` declaration, so the RPC definition is malformed. Cannot call reliably; not wired. **SQL fix required (out of scope: no SQL changes).** Recommendation: add the missing `$$;` then re-verify `0004` applies cleanly in a transaction (a malformed statement here can roll back the *entire* 0004, taking `match_memories_v2` and `touch_memories` with it on a clean DB).
2. **Missing `memories.updated_at` column.** No migration adds `updated_at` to `memories`, but `0004` installs a `BEFORE UPDATE` trigger `set_updated_at` (sets `new.updated_at`) and `forget_archived`/`merge_memories` reference `updated_at`. Any `UPDATE` on `memories` will error until SQL is reconciled. `insertMemoryV2` (INSERT) is unaffected; `updateMemoryV2` / `touch_memories` (UPDATE) depend on the column existing. **SQL fix required (out of scope).**
3. **Retrieval behavior change.** `match_memories_v2` defaults to `p_statuses=['active']` + `p_min_similarity=0.65` + `p_match_count=30`, vs. legacy returning 8 rows unfiltered. Switching the live path will shrink/change the candidate set; validate recall in `/chat` before migrating the retriever.
4. **Auth guard added.** `match_memories_v2` raises if `auth.uid() <> p_user_id`; the legacy RPC had no such check. All future callers must pass the authenticated user id.
5. **No generated types.** `lib/supabase/` has no `types.ts`, so `.rpc`/`.from` results are untyped; V2 enum columns come back as `text` and must be matched manually to the `lib/memory/types` unions.
6. **Duplicate `MemoryRecord`.** `lib/memory/types.ts` (V2, ~29 fields) and `lib/memory/memory.ts` (legacy, 4 fields) both export `MemoryRecord`. Consolidate on the V2 type when migrating the operational layer.

### Verification
- `npm run lint` → 0 errors.
- `npm run build` → Compiled successfully; TypeScript OK; 14/14 static pages.
- Changed file scoped to `lib/repositories/memory.repository.ts`. All legacy functions preserved.

