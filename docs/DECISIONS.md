# Architectural Decisions

Append-only record of significant architectural decisions for Salpa (repository
`aether-v2`). Entries are numbered in order and never edited or deleted; a
superseded decision is marked as such and a new entry is added.

---

## D-001 - Feature flags fail closed and default to OFF

**Date:** 2026-09-21
**Status:** Accepted
**Scope:** `lib/config/features.ts`, `tests/unit/config/features.test.ts`, `docs/FEATURE_FLAGS.md`

### Context

Salpa is live and is in an active seed-funding process. New agent capabilities
(long-horizon planning, tool use, multi-step execution, procedural memory) must
be added without any risk to the working product. Capability work in this
repository has historically been gated by editing the live request path, which
puts the shipped product at risk on every change.

### Decision

1. A single pure module, `lib/config/features.ts`, owns every capability flag.
2. Every flag **defaults to OFF**, and parsing **fails closed**: only the explicit
tokens `1`, `true`, `yes`, `on` (after trim and lowercasing) enable a flag.
   Missing values, empty strings, `0`, `false`, `no`, `off`, and typos such as
   `ture` all evaluate to false.
3. Agent mode requires **both** `ENABLE_AGENT_LOOP` and `ENABLE_TOOL_USE`
   (`isAgentModeEnabled()`). If either one is off or unset, the existing
   single-call chat path runs unchanged.
4. Flags are server-side only. They deliberately do not use the `NEXT_PUBLIC_`
   prefix and must never be read from client components.
5. Numeric tuning flags (`AGENT_MAX_TOOL_TURNS`, `AGENT_LOOP_DEADLINE_MS`,
   `AGENT_TOOL_TIMEOUT_MS`) fall back to documented defaults when missing or
   invalid, so a misconfigured environment cannot create a zero, negative, or
   unbounded budget.
6. Enabling or disabling a capability requires no code change, no migration, and
   no data change: it is an environment-variable change plus a redeployment.

### Consequences

- The module is inert until a call site is added. At the time of this decision
  nothing under `app/` or `lib/` imports it, so request behavior is byte-for-byte
  unchanged.
- Rollback for any gated feature is an environment change rather than a code
  revert.
- Every future flag must be added to the union, to the `FEATURE_FLAGS` array, to
  the runbook table in `docs/FEATURE_FLAGS.md`, and to the test suite in the same
  change.

### Verification

- `npx vitest run tests/unit/config/features.test.ts` asserts the default-OFF
  state, fail-closed parsing, the two-flag agent-mode requirement, and numeric
  fallbacks.
- `getFeatureFlagSnapshot()` reports every flag as false when the environment is
  unset.

---

## D-002 - Agent capabilities are added additively, as consumers of the pipeline

**Date:** 2026-09-21
**Status:** Accepted as design; implementation proceeds in separately reviewed steps
**Scope:** `lib/agent/**` (planned), `docs/AGENT_LOOP_DESIGN.md`

### Context

The live chat request path is `app/api/chat/route.ts` plus `lib/core/pipeline.ts`.
Memory retrieval, extraction, identity resolution, reflection, consolidation, and
lifecycle are the product core and are frozen. A bounded agent loop with tool use
is wanted, and it must not disturb any of that.

### Decision

1. **Additive only.** `lib/core/pipeline.ts`, `lib/core/runtime.ts`,
   `lib/core/types.ts`, `lib/brain/*`, `lib/memory/*`, all repositories, and all
   migrations are not modified. New capability lives in `lib/agent/**`.
2. **The agent loop consumes pipeline output instead of re-implementing it.**
   This is possible because `PreStreamResult` already exposes the assembled
   system prompt (`preResult.prompt`, `lib/core/pipeline.ts:841`), and a non-route
   consumer of that same result object already exists (`createChatStream`,
   `lib/core/pipeline.ts:932`). The agent branch therefore reuses the
   `preStreamPipeline` result directly and never duplicates context assembly,
   message or job persistence, or history construction.
3. **Exactly one flag-gated branch in the route.** The only planned edit to
   production code is a guarded branch in `app/api/chat/route.ts` between the
   existing `after(...)` block (line 147) and `const ai = getProvider()`
   (line 149), deployed with flags OFF.
4. **Fail-safe degradation.** Any loop failure, timeout, or exhausted budget
   falls through to the existing single-call path, so a user always receives an
   answer and never sees agent machinery fail.
5. **All v1 tools are read-only:** `current_time`, `calculator`, and
   `memory_search` (which reuses the existing user-scoped `retrieveMemories`).
   Web search stays behind its own OFF flag and ships inert.
6. **Long or risky work goes through a durable queue, not the request path.**
   The v1 loop is inline and bounded. Phase B introduces a separate `agent_jobs`
   table with mirrored lease, backoff, and dead-letter semantics rather than
   reusing `memory_jobs`, because `claim_memory_jobs` claims any pending job for a
   user with no job-type filter and `processMemoryJobs` dead-letters claimed jobs
   that lack a memory payload. Physical isolation protects the frozen worker.
7. **No database migration is required for Priority 1 or Priority 2.**

### Consequences

- The live chat path stays the default at every layer: a flag that is OFF means
  dead code, and a flag that is ON means a bounded loop with a fallback.
- The agent subsystem can be developed, tested, and released independently of the
  memory engine.
- The response contract is unchanged (`{ response, conversationId }`), so no
  frontend change is required.

### Verification

- Until the route branch is added in a later step, the flag module is imported by
  nothing, and `grep -r "lib/config/features" app/ lib/` finds no production call
  site.
- The planned invariants and acceptance criteria are listed in
  `docs/AGENT_LOOP_DESIGN.md`.

---

## Follow-ups noted during this work (no action taken)

Observations recorded for later. Each one is deliberately **not** part of the
current change and requires its own reviewed task.

1. **`middleware.ts` is a deprecated file convention.** The Next.js 16 reference
   states that the `middleware` convention has been renamed to `proxy` (see
   `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`).
   This repository uses `middleware.ts` at the root. It still works, so no change
   is made while the product is live; a migration should be scheduled and tested
   on its own.
2. **Stale tracked working copies of source files.** The repository root tracks
   point-in-time text dumps of source files (`route.txt`, `provider.txt`,
   `manager.txt`, `pipeline.txt`, `runtime.txt`, `runtime-types.txt`,
   `_pipeline_head.txt`, `_h2.txt`) together with large artifacts
   (`PROJECT_TREE.txt` at about 3.5 MB, `FILES.txt` at about 1.1 MB,
   `SUPABASE_USAGE.txt`). They are not part of the build or the runtime, but they
   pollute code search and can cause a future change to be based on outdated code.
   A dedicated cleanup task should remove them and extend the ignore files.
3. **`next.config.ts` sets `typescript.ignoreBuildErrors: true`**, which
   suppresses TypeScript errors during the production build. New code is
   therefore covered by explicit tests rather than by the build. Removing the
   suppression is a separate, controlled task that must not be bundled with
   feature work.