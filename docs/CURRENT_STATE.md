# CURRENT STATE

## Stack
- **Framework:** Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS v4.
- **Backend:** Supabase (`@supabase/supabase-js` v2 + `@supabase/ssr`). **No generated Supabase types** — `lib/supabase/` exposes only `client.ts` / `server.ts` / `middleware.ts`; all queries are stringly typed.
- **AI:** Ollama on `127.0.0.1:11434` — `nomic-embed-text:latest` for 768-dim embeddings, `qwen2.5:3b` for chat/extraction.
- **Quality gates:** `npm run lint` (eslint-config-next) and `npm run build` (next build, Turbopack) both pass with **0 errors**. Only pre-existing `react-hooks/exhaustive-deps` warnings remain in untouched UI components.

## Live request path (single route)
`app/api/chat/route.ts` → `initializeAI()` → `new Runtime(...)` → `runPipeline` (`lib/core/pipeline.ts`) → `buildContext` (`lib/context/builder.ts`) → `buildBrain` (`lib/brain/brain.ts`) → `getProvider().chat()` → persist messages via `lib/ai/conversation/manager.ts` → `app/chat`.

## Milestone status (MASTER_PLAN phases)
- **Phase 0 – Foundation:** ✅ Complete (Runtime, pipeline runner, provider registry, AI bootstrap).
- **Phase 1 – Memory Foundation:** ✅ Complete (DB schema + TS foundation + repository bridge present; retriever wired to V2 — operational layer partial, see Memory V2).
- **Phase 2 – Retriever:** ✅ Complete (live path migrated to `matchMemoriesV2` + `score.ts` + `effectiveScore` sort + MMR + token budget + `touchMemories`; public API unchanged).
- **Phase 3 – Memory Writer:** ⏸ Not started (only legacy extractor/upserter exist).
- **Phase 4 – Reflection Engine:** ⏸ Not started (decay/forget/merge RPCs exist in DB but are never invoked).
- **Phase 5/6/7 – Identity / Knowledge / Planner:** ✅ Service + repository modules present (`lib/identity`, `lib/knowledge`, `lib/planner` + their repositories).
- **Phase 8 – Brain:** ✅ Present (`lib/brain/brain.ts`, `lib/context/builder.ts`).

## Memory V2 state (the real picture)
- **Database schema — ✅ Complete.** Migrations `0000–0005` deliver the entire V2 surface: 3 enums (`memory_type`, `memory_status`, `memory_source`); V2 columns on `memories`; auxiliary tables (`memory_clusters`, `memory_edges`, `memory_events`, `conversations`, `memory_jobs`); 11 indexes; 6 RPCs (`match_memories_v2`, `touch_memories`, `find_near_duplicates`, `apply_memory_decay`, `forget_archived`, `merge_memories`); `updated_at` triggers; RLS; and the `0005` backfill + `migration_meta`.
- **TS V2 foundation — ✅ Written, wired.** `lib/memory/types.ts`, `lib/memory/constants.ts`, `lib/memory/score.ts` are complete and consumed by `retrieve.ts` (V2 pipeline). `lib/memory/index.ts` only re-exports the legacy trio (`memory`, `retrieve`, `upsertMemory`); the V2 modules are live.
- **Operational layer — ⚠️ Mixed.** `lib/memory/retrieve.ts` is now on V2 (`matchMemoriesV2` → `scoreRetrievalCandidate` → `effectiveScore` sort → MMR → token budget → `touchMemories`); `lib/repositories/memory.repository.ts` bridges V1 + V2. `lib/memory/upsertMemory.ts`, `lib/memory/memory.ts`, `extractor.ts`, `aiExtractor.ts` still use the legacy `match_memories` RPC and legacy columns. The live chat path is now **partially** migrated to V2 (retriever only).

## Latest milestone (this session)
Retriever V2 in `lib/memory/retrieve.ts`: rewrote `retrieveMemories(userId, query)` to the V2 pipeline — `matchMemoriesV2()` → `scoreRetrievalCandidate()` → `effectiveScore` sort → MMR rerank (`mmrScore` + pairwise cosine over re-fetched candidate embeddings, graceful fallback) → token-budget selection (`TOTAL_MEMORY_TOKEN_CAP` + per-type `TOKEN_BUDGETS`) → `touchMemories()`. Public API unchanged; `build` + `lint` pass (0 errors). Only `lib/memory/retrieve.ts` modified.

## Known defects (flagged, not fixed)
1. `0004_memory_v2_rpcs.sql`: `find_near_duplicates` is missing its closing `$$;` — its body runs into the next `create function` block, so the RPC definition is malformed. Not wired (see ENGINEERING_LOG).
2. No migration adds a `memories.updated_at` column, yet `0004` installs a `BEFORE UPDATE` trigger `set_updated_at` and `forget_archived`/`merge_memories` reference `updated_at`. UPDATEs on `memories` will error until SQL is reconciled (out of scope for repository work).

## Empty stubs / placeholders
- Empty directories: `lib/ai/chat/`, `lib/ai/memory/`, `app/api/embeddings/`.
- Zero-byte files: `lib/context/types.ts`, `lib/tasks/index.ts`, `lib/tasks/retrieve.ts`.

