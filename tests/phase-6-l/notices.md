# Phase 6-L Notices

## Additive Verification Findings

### Reflection Parsing
- `sanitizeReflection` private by design; tests exercise output via `generateReflections` mock pattern
- Importance clamping: values outside 1..10 are silently ignored (not clamped to boundary)
- Confidence clamping: values outside 0..1 are silently ignored (not clamped to boundary)
- Whitespace-only title/content filtered; trimmed before validation

### Retrieval Token Budget
- 3 semantic candidates × ~300 tokens = 800 budget → exactly 2 surfaced
- Token count approximated by `content.length` in candidate selection
- Exceeding budget candidate is dropped silently

### Job Lifecycle
- `shouldDeadLetter(a)` boundary at `MAX_ATTEMPTS=5`
- `DEFAULT_CLAIM_BATCH=5`, `DEFAULT_LEASE_SECONDS=300`
- Missing `message_id` or `message` → immediate dead-letter via `shouldDeadLetter(attempts)`
- `catch` branch in `processMemoryJobs` documented as unreachable (SQL/RPC always resolve)
- Reclaim error is tolerated; processing proceeds to claim stage

### Repository RPC Assertions
- `createFakeSupabase` responder pattern handles all V2 RPC name/arg assertions
- `purge_archived` → `p_user_id`
- `corroborate_memory` → `p_memory_id`, `p_message_id`
- `match_memories_v2` → `p_user_id`, `p_query_embedding`, `p_match_threshold`, `p_match_count`
- `claim_memory_jobs` → `p_user_id`, `p_max`
- `complete_memory_job` → `p_job_id`
- `fail_memory_job` → `p_job_id`, `p_error`, `p_dead_letter`
- `reclaim_stale_memory_jobs` → `p_user_id`, `p_lease_seconds`

### Frozen Modules (unchanged)
- `score.ts`, `constants.ts`, `types.ts`, `reflector.ts`, `memory.repository.ts`, `memory-job.repository.ts`, `pipeline.ts`, all SQL migrations, embedding/provider/context/brain/identity/knowledge/planner

### Known Limitations (documented only)
- `saveMemory` non-idempotent INSERT — no uniqueness constraint; deferred to future migration
- `sanitizeReflection` private — by design, not exported
- `processMemoryJobs` catch unreachable — `runMemoryMaintenance` wraps every stage in try/catch; never rethrows
- Duplicate INSERT — documented in Phase 6-K `NOTES.md`; no migration/constraint change included