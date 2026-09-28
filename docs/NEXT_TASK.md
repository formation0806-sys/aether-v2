# NEXT TASK

**Status: none open. Step 8 is complete and awaiting human review.**

Do not start a new milestone. Step 8 deliberately stopped at a reviewable
checkpoint.

## What Step 8 delivered

- Restored a trustworthy green regression baseline: 67 test files, 1475 tests,
  0 failures, reproduced across 3 consecutive full runs.
- Fixed the two known failing tests on the test side only, with no production
  change and no weakened assertion.
- Refreshed the stale MVP status documentation against what was actually
  verified.
- Created a single reviewable commit for Steps 1-7 plus Step 8.

## Recommended next action

Human review of the Step 8 commit. Nothing else is authorized yet.

## If review approves and a new milestone is wanted

The only gap the Step 8 audit identified that is still MVP-adjacent is
**process hygiene**, not functionality:

1. Test accounts created by the opt-in E2Es are only cleaned up on the happy
   path. A hard crash mid-run leaks a Supabase auth account. The existing
   `tests/phase-mvp-e2e/fix-phase.test.ts` has the same shape. This is
   test-harness work, not product work.
2. Documented only, not yet automated: the native-tool-first / prompt-JSON
   fallback split in `lib/agent/loop.ts:221-230` has no test asserting which
   path is taken when a provider lacks `chatWithTools`.

Both are optional. Neither blocks the MVP.

## Explicitly out of scope

Do not begin rendering, materials, remote workers, world models, planner,
multi-agent orchestration, continual learning, long-horizon autonomy, or
scaling without a new milestone.