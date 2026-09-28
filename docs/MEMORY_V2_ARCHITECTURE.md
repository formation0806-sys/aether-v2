# MEMORY V2 ARCHITECTURE

**Status:** Implemented and covered by the regression suite.
**Last updated:** 2026-09-28 (end of Step 8).

This file describes the memory subsystem as it actually exists. For
verification evidence see `docs/ACCEPTANCE_TESTS.md`; for overall MVP status see
`docs/CURRENT_STATE.md`.

---

## 1. Design stance

Memory V2 is **additive**. It was introduced alongside the original memory
tables rather than replacing them, so the migration is reversible and no
existing row or consumer is broken. The V2 surface is carried in `*_v2` columns
plus new enums and new tables, applied through numbered migrations in
`supabase/migrations/`.

The guiding rules for this subsystem:

- Never overwrite a memory that carries provenance.
- Never guess a canonical row when a title is ambiguous.
- Fail closed: an invalid embedding is rejected rather than persisted.
- A partial write must be observable, never silently reported as success.

## 2. Module map

| Module | Responsibility |
| --- | --- |
| `lib/memory/types.ts` | Shared V2 types |
| `lib/memory/constants.ts` | V2 constants and defaults |
| `lib/memory/score.ts` | Memory scoring |
| `lib/memory/memory.ts` | `saveMemory` - the single write path |
| `lib/memory/retrieve.ts` | Retrieval entry point |
| `lib/memory/upsertMemory.ts` | Upsert helper |
| `lib/memory/extractor.ts` | Deterministic extraction rules |
| `lib/memory/aiExtractor.ts` | Model-assisted extraction |
| `lib/memory/reflector.ts` | Reflection generation |
| `lib/memory/consolidate.ts` | Consolidation / merging |
| `lib/memory/identity.ts` | Identity verification |
| `lib/memory/lifecycle.ts` | Forgetting and status transitions |
| `lib/memory/conflict.ts` | Conflict handling |
| `lib/memory/embedding-validation.ts` | Rejects invalid embeddings before write |
| `lib/repositories/memory.repository.ts` | Supabase access for memories |

## 3. The write path

`saveMemory` (`lib/memory/memory.ts`) is the single production write path. It
embeds the content, validates the embedding, then looks the memory up **by
title** for the user:

```
getMemoriesByTitle(userId, title)   // memory.ts:89 - returns ALL rows
```

Three outcomes follow:

1. **No existing row** - plain insert via `insertMemoryV2` (memory.ts:205).
2. **Exactly one existing row, identical content** - no write; the existing row
   is returned (memory.ts:113-116).
3. **Existing row with different content** - supersession (below).

### 3.1 Ambiguity rule

`getMemoriesByTitle` returns *all* rows sharing a title and never throws on
duplicates. When `N > 1` the title key is ambiguous, so the code does not blind-
pick a canonical row, does not mutate existing rows, and does not supersede
arbitrarily. It warns (`MEMORY TITLE AMBIGUOUS`) and falls through to the plain
insert.

### 3.2 Supersession

For a same-title row with different content, `saveMemory` uses Option B:

1. Read the full existing row, including its metadata, directly through the
   server Supabase client (memory.ts:123-128).
2. **Insert the new memory**, carrying the incoming provenance metadata
   (memory.ts:131-160).
3. Merge the old row's metadata with `superseded_by` and
   `supersession_reason: "identity_update"` (memory.ts:176-182).
4. Mark the old row `merged` via `updateMemoryV2` (memory.ts:185-188).
5. If step 4 fails, throw, so the failure is visible rather than reported as a
   completed write.

The new row's content and provenance are never written onto the old row. This
is the behaviour asserted by
`tests/unit/reflection/reflection-provenance-persistence.test.ts`.

## 4. Provenance contract

Provenance travels in the `metadata` column as JSON and is forwarded verbatim to
both insert paths (`memory.ts:154` and `memory.ts:226`). It contains at least:

| Key | Meaning |
| --- | --- |
| `sourceMemoryIds` | The memories this one was derived from |
| `generatedAt` | ISO-8601 generation timestamp |

Supersession adds `superseded_by` and `supersession_reason` to the *old* row
only. The test suite verifies provenance on both the fresh-insert and the
same-title path.

## 5. Retrieval

`lib/memory/retrieve.ts` is the retrieval entry point, backed by the
`match_memories` RPC introduced in migration `0006_match_memories.sql`.
Lifecycle and status filtering were tightened in `0007_lifecycle_fixes.sql` and
`0009_memory_v2_status_filter.sql`.

Live retrieval through the agent path is verified: the Step 7 memory-continuity
E2E measured a retrieval similarity of `0.736` against a floor of `0.65`.

## 6. Isolation

Row-level security is applied to the V2 tables (see `0010_memory_edges_rls.sql`).
All repository access in this subsystem is scoped by `user_id`; the opt-in E2Es
that use the service role do so only against a disposable account they create
and then delete.

