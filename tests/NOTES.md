# Non-Idempotency Documentation

## Current Limitation

The `saveMemory` function in `lib/memory/memory.ts` performs a non-idempotent INSERT into the `memories` table. There is no uniqueness constraint or deduplication logic in this phase.

### Behavior

- Calling `saveMemory` with the same `userId` and `title` will create a new row each time.
- If the content is identical, the function logs "MEMORY SKIPPED" and returns the existing record, but does not prevent subsequent inserts of different content with the same title.
- There is no database-level unique constraint on `(user_id, title)`.

### Recommendation

Document this limitation in `tests/NOTES.md` (this file) and in the code comments near `saveMemory`. No test should encode duplicate creation as required behavior. Defer any deduplication to a future authorized phase where a uniqueness constraint can be added to the schema.

### Known Issue

- Duplicate memory/reflection INSERT limitation is a **CONFIRMED DESIGN LIMITATION**, not a bug.
- **Do NOT** write a test that encodes duplicate inserts as required behavior.
- No migration/constraint change is included in this phase.