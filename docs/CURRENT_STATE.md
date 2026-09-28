# CURRENT STATE

**Last updated:** 2026-09-28, at the end of Step 8 (test integrity + MVP
checkpoint).
**Branch:** `feature/memory-v2-foundation`
**Baseline HEAD at audit time:** `19387b1`

## Current phase

MVP verified and checkpointed. Phases 1-8 of the engineering plan are
implemented and exercised by the regression suite. The next action is human
review of this checkpoint, not new implementation.

## Verified MVP functionality

Each item below was observed in a real run, not inferred.

| Capability | Evidence |
| --- | --- |
| Authentication | Real authenticated `POST /api/chat` in all three live E2Es |
| Persistent memory | Memories written through the real `/api/chat` path |
| Memory retrieval | `AGENT_MEMORY_E2E_SEEDED similarity=0.736` (floor 0.65, dim 768) |
| Identity injection | Exercised across the memory suite |
| Native Ollama tool calling | `supportsNativeTools` + `provider.chatWithTools` (`lib/agent/loop.ts:221-230`) |
| Agent loop | `LIVE_SMOKE_AGENT_EVIDENCE agentTimingLines=2` |
| `calculator` tool | `LIVE_SMOKE_OK prompt="What is 6 times 7?" status=200` |
| `current_time` tool | `LIVE_SMOKE_OK prompt="What time is it right now?" status=200` |
| Blender tool integration | `BLENDER_E2E_AGENT_EVIDENCE blenderToolLines=2` |
| Authenticated Blender bridge | Bearer token, constant-time compare, bound to `127.0.0.1` |
| Real Blender scene verification | `BLENDER_E2E_SCENE_OK cubes=1 objects=[{"name":"SalpaObject","object_type":"cube"}]` via authenticated `inspect_scene` |
| Agent-path memory continuity | Disposable user answered from persisted memory through the native agent branch |
| Disposable-data cleanup | `AGENT_MEMORY_E2E_CLEANUP removed=memories,messages,memory_jobs,auth-user` |
| Bounded conversation history | `MAX_HISTORY_MESSAGES = 40` in `lib/ai/conversation/history.ts` |
| Production typecheck | `npx tsc --noEmit` exit 0 |
| Production build | `npm run build` exit 0, "Compiled successfully" |
| Regression suite | 67 test files passed, 1475 tests passed, 0 failed, reproduced on 3 consecutive runs |
| Blender bridge suite | 103 tests, OK, 0 failures |

## Build / lint

| Check | State |
| --- | --- |
| Typecheck | PASS (exit 0) |
| Build | PASS |
| Regression suite | PASS |
| Bridge suite | PASS (103 OK) |

## Known test debt

None outstanding. Two previously failing files were fixed on the test side in
Step 8; neither required a production change:

- `tests/unit/reflection/reflection-provenance-persistence.test.ts` - the mock
  still provided the removed singular `getMemoryByTitle`; production calls the
  plural, array-returning `getMemoriesByTitle` (`lib/memory/memory.ts:89-90`).
- `tests/unit/ai/memory-config-separation.test.ts` - was not env pollution as
  previously believed. Each of its 17 cases re-imports the whole AI module graph
  (~15s for the file), so a case could cross vitest's 5s default timeout under
  parallel load. Fixed with an explicit file-scoped timeout plus proper
  `process.env` restoration.

## Not started (non-MVP, by design)

Rendering, materials, remote workers, world models, planner, multi-agent,
continual learning, long-horizon autonomy, and scaling are deliberately out of
MVP scope. Do not begin them without a new milestone.

## Next

Stop. Await human review of the Step 8 checkpoint. See `docs/NEXT_TASK.md`.