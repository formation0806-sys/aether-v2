# ACCEPTANCE TESTS

**Record date:** 2026-09-28, at the end of Step 8.
**Branch:** `feature/memory-v2-foundation`

This file records what was actually executed and observed for the MVP
checkpoint. Every line below is copied from real command output. Nothing here
is aspirational.

---

## 1. Static and build verification

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | exit `0` |
| Production build | `npm run build` | exit `0`, "Compiled successfully" |
| Blender bridge suite | unittest discovery under Blender 5.2.1 | `Ran 103 tests` / `OK` / 0 failures |

## 2. Regression suite

Command: `npm test`, run three times consecutively after the Step 8 test fixes.
All three runs reported:

```
Test Files  67 passed (67)
      Tests  1475 passed (1475)
```

Before Step 8 the same suite reported 65 passed / 2 failed.

### 2.1 `reflection-provenance-persistence`

The mock supplied `getMemoryByTitle` (singular, object-shaped). Production
`saveMemory` calls `getMemoriesByTitle` (plural, array-shaped) and branches on
its length (`lib/memory/memory.ts:89-100`), so every assertion threw before any
insert happened. The mock was corrected to the real call shape, a
`@/lib/supabase/server` stub was added for the supersession branch's direct row
read, and `insertMemoryV2` was made to return a new-row id as that path requires.

The final case previously asserted that `updateMemoryV2` carried the incoming
reflection's provenance. That expectation is superseded and directly
contradicted the production comment at `lib/memory/memory.ts:120` ("Preserve old
content and provenance; do not overwrite old metadata") - writing the new
reflection's provenance onto the old row would destroy the old row's
provenance. Under the current design both write paths persist provenance on the
**new** row via `insertMemoryV2`; `updateMemoryV2` only marks the old row merged.

The assertions were strengthened, not weakened. The test now verifies:

- the new row receives the full incoming provenance (`sourceMemoryIds`,
  `generatedAt`),
- the update targets the old row id and sets `status: "merged"`,
- the old row retains its own pre-existing provenance and gains `superseded_by`
  and `supersession_reason`.

`sourceMemoryIds` and `generatedAt` are still asserted in both the fresh-insert
and same-title cases.

### 2.2 `memory-config-separation`

This was previously attributed to environment pollution. That diagnosis was
wrong. The real cause was reproduced:

```
FAIL  tests/unit/ai/memory-config-separation.test.ts
> 10. extractor keeps using OLLAMA_BASE_URL and qwen2.5:3b
Error: Test timed out in 5000ms.
```

All 17 cases call `vi.resetModules()` and dynamically re-import the whole AI
module graph, because `lib/ai/config.ts` reads `process.env` at module scope.
---

## 3. Live MVP end-to-end tests

All three are opt-in and were run with their existing package scripts. None was
rewritten.

### 3.1 Agent smoke - `npm run test:live` (gate `AGENT_EVAL_LIVE=1`)

```
LIVE_SMOKE_READY base=http://127.0.0.1:3123 spawned=true
LIVE_SMOKE_OK prompt="What is 6 times 7?" status=200 responseChars=16
LIVE_SMOKE_OK prompt="What time is it right now?" status=200 responseChars=65
LIVE_SMOKE_AGENT_EVIDENCE agentTimingLines=2 tokensWithTotal=2
```

`3 tests`, none skipped. Native `calculator` and `current_time` calls both
executed, and the agent branch was entered.

> Operational note: this test spawns its own dev server on port 3123. A dev
> server already running on port 3000 will block it (Next `.next` lock) and the
> run reports a misleading `Test Files 1 passed` with all tests silently skipped.
> Check for `Tests 3 skipped (3)` when reading the output.

### 3.2 Blender - `npm run test:live:blender` (gate `BLENDER_E2E_LIVE=1`)

```
BLENDER_E2E_READY base=http://127.0.0.1:3124 spawned=true bridge=http://127.0.0.1:8765/tool token=per-run(not printed)
BLENDER_E2E_CHAT_OK status=200 responseChars=58 response="A cube has been successfully created in the Blender scene."
BLENDER_E2E_AGENT_EVIDENCE agentTimingLines=1 blenderToolLines=2
BLENDER_E2E_SCENE_OK cubes=1 objects=[{"name":"SalpaObject","object_type":"cube"}]
```

The cube is confirmed through authenticated `inspect_scene` against the real
Blender scene, not from assistant prose. The test spawns both the dev server and
the bridge itself.

### 3.3 Memory continuity - `npm run test:live:agent-memory` (gate `AGENT_MEMORY_E2E=1`)

```
AGENT_MEMORY_E2E_SEEDED similarity=0.736 floor=0.65 dim=768
AGENT_MEMORY_E2E_CLEANUP removed=memories,messages,memory_jobs,auth-user
```

The test creates only its own disposable Supabase account, seeds a single
deterministic memory, drives the real authenticated `/api/chat`, enters the
native agent branch, answers from persisted memory, then deletes the seeded
memory, messages, jobs, and the auth account. All administrative operations are
scoped to the disposable user id; no existing user's memory is read or modified.
The pre-existing test user's memory count was confirmed unchanged at 6.

---

## 4. Summary

| Area | Result |
| --- | --- |
| Typecheck | PASS |
| Build | PASS |
| Regression suite | PASS, 67 files / 1475 tests, reproducible |
| Blender bridge suite | PASS, 103 OK |
| Agent smoke E2E | PASS, 3 tests |
| Blender E2E | PASS |
| Memory continuity E2E | PASS |
| Production code changed | **No** |

## 5. Known limitations (verified, not speculative)

- Opt-in E2Es create a Supabase account per run and clean it up only on the
  happy path. A hard crash mid-run leaks the account. Affects
  `tests/agent-eval/agent-memory-e2e.test.ts` and the pre-existing
  `tests/phase-mvp-e2e/fix-phase.test.ts`.
- The native-tool-first / prompt-JSON fallback decision in
  `lib/agent/loop.ts:221-230` is documented but not covered by a test asserting
  which path is taken for a provider lacking `chatWithTools`.
- Phases 6-10 of `docs/MASTER_PLAN.md` are not started and are out of MVP scope.

The file takes roughly 15 seconds in total, so one case could cross vitest's 5s
default per-test timeout purely from CPU contention during a full parallel run,
while passing in isolation. Fixes, both test-side:

- explicit file-scoped `vi.setConfig({ testTimeout: 30_000 })`, removing an
  arbitrary wall-clock cap on module loading,
- snapshot and restore of the Ollama variables in `afterAll`, so sentinel
  credentials can no longer leak into another test file sharing the worker.

No assertion was changed and no feature-flag semantics were touched.


