# Agent Loop and Tool Use - Design and Integration Plan

**Status:** Approved design. Priority 1 (feature flags) is implemented and inert.
Priority 2 (agent loop and tool use) is not implemented; each step ships on its own
and is reviewed before the next begins.

**Related:** `docs/DECISIONS.md` (D-001, D-002), `docs/FEATURE_FLAGS.md`,
`lib/config/features.ts`.

## 1. Purpose and guardrails

Add a bounded agent loop with modular tool use next to the existing chat path
without changing the live product.

1. The current single-call chat path stays the default and stays byte-for-byte
   identical when flags are off.
2. Flags default to OFF and fail closed (`docs/FEATURE_FLAGS.md`).
3. No change to `lib/core/pipeline.ts`, `lib/core/runtime.ts`,
   `lib/core/types.ts`, `lib/brain/*`, `lib/memory/*`, any repository, any
   migration, or the provider files.
4. Exactly one production file is planned to change:
   `app/api/chat/route.ts`, with one flag-gated branch, deployed with flags OFF.
5. Every failure inside agent machinery degrades to the existing chat call, so a
   user never sees an agent error.
6. All v1 tools are read-only.

## 2. Verified integration facts

Confirmed by reading the current source. These are why no pipeline change is
needed.

| Fact | Location |
| --- | --- |
| `PreStreamResult` already exposes the assembled system prompt as `prompt` | `lib/core/pipeline.ts:836-842` |
| `preStreamPipeline` returns `prompt: brain.prompt` | `lib/core/pipeline.ts:907-913` |
| A non-route consumer of `PreStreamResult` already exists | `createChatStream`, `lib/core/pipeline.ts:932-934` |
| Route order: `preStreamPipeline`, then `after(processMemoryJobs)`, then `getProvider()` | `app/api/chat/route.ts:120, 140-147, 149` |
| Assistant persistence signature | `saveAssistantMessage(userId, content, conversationId)`, `lib/ai/conversation/manager.ts:16` |
| Retrieval reused by the memory tool | `retrieveMemories(userId, query)`, `lib/memory/retrieve.ts:181` |
| Bootstrap pattern to mirror for tools | `initializeAI()`, `lib/ai/bootstrap.ts:4-12` |
| `after` runs after the response, even on error, bounded by route max duration | Next.js reference, `after.md` |
| Next 16 route `context.params` is a Promise (our chat route has no params) | Next.js reference, `route.md` |
| `zod` is installed but used by no file in the repository | `package.json:32` plus repository search |

Because `zod` is not confirmed in use, tool argument validation is hand-rolled:
`parseArgs` returns `null` on invalid input, matching the tolerant-parser style
already used by the memory extractor, the identity verifier, and the reflector.

## 3. Planned file structure

All new code is additive.

    lib/agent/types.ts              AgentTurnInput, AgentOutcome, AgentTraceStep
    lib/agent/runner.ts             entry point, never throws
    lib/agent/loop.ts               bounded observe, think, act, answer loop
    lib/agent/budget.ts             turn, time, and tool budgets
    lib/agent/gate.ts               deterministic tool-ish request pre-gate
    lib/agent/prompt.ts             composes the agent prompt around preResult.prompt
    lib/agent/protocol.ts           tolerant tool-call JSON parser
    lib/agent/fallback.ts           returns a fallback outcome instead of throwing
    lib/agent/trace.ts              AGENT_TIMING logs, content-free
    lib/agent/tools/types.ts        ToolDefinition, ToolContext, ToolResult
    lib/agent/tools/registry.ts     flag-aware register, get, list
    lib/agent/tools/index.ts        initializeTools(), mirrors initializeAI()
    lib/agent/tools/current-time.ts pure
    lib/agent/tools/calculator.ts   own arithmetic parser, no eval
    lib/agent/tools/memory-search.ts wraps retrieveMemories
    lib/agent/tools/web-search.ts   inert stub behind its own flag
    lib/worker/agent-jobs.ts        Phase B only
    lib/worker/processAgentJobs.ts  Phase B only

## 4. Agent loop architecture

### 4.1 Request flow when flags are ON and the gate says agent

    POST /api/chat
      auth and validation (unchanged)
      preStreamPipeline (unchanged, reused by both paths)
        buildContext: identity, memories, knowledge, planner
        buildBrain, producing the system prompt
        createMessageWithJob: durable user message plus memory job
        buildConversation: session history plus the current message
      if isAgentModeEnabled() and the gate says agent
        runAgentTurn(preResult)
        outcome answered: save the assistant message, return the same JSON shape
        outcome fallback: continue into the legacy path below
      legacy path: getProvider().chat(preResult.conversation)
      after: processMemoryJobs(userId), unchanged, runs for both paths

### 4.2 The loop

    messages = [agent system prompt] plus preResult.conversation.slice(1)
    while turns remain and the deadline has not passed
      act: getProvider().chat(messages)
      parse: protocol.parseToolCall(text)
      no tool call: the text is the final answer, return it
      observe: registry.execute(tool, args, context)
        per-tool AbortController timeout
        observation capped at about 4 KB
        tool errors become a TOOL_ERROR observation and the loop continues
      append the observation and continue
    budget exhausted: one forced call instructing a final answer

### 4.3 Budgets

| Budget | Default | Flag or fixed |
| --- | --- | --- |
| Max tool turns | 4 | `AGENT_MAX_TOOL_TURNS` |
| Total loop deadline | 45 s | `AGENT_LOOP_DEADLINE_MS` |
| Per-tool timeout | 10 s | `AGENT_TOOL_TIMEOUT_MS` |
| Tool calls per turn | 1 | fixed in code |
| Observation size | about 4 KB | fixed in code |

These are sized against the existing prompt budgets in `lib/memory/constants.ts`:
`CONTEXT_WINDOW_TOKENS` is 8192 and `TOTAL_MEMORY_TOKEN_CAP` is 3700.

### 4.4 Failure ladder

| Failure | Behavior |
| --- | --- |
| Unparsable tool call | Treated as the final answer, no retry loop |
| Tool throws or times out | `TOOL_ERROR` observation, loop continues |
| Observation too large | Truncated, truncation noted in the observation |
| Budget exhausted | One forced final-answer call |
| Any unexpected throw | `fallback.ts` returns fallback and the legacy chat call runs |

### 4.5 Gate

`lib/agent/gate.ts` is a pure, zero-latency classifier returning agent or chat. It
returns agent only for tool-ish intents: time and date questions, arithmetic,
explicit search requests, and questions about what is remembered. Every other
message takes the legacy path even when flags are ON, so ordinary conversation
gains no latency and no prompt change. This follows the existing precision-gated
approach of `isIdentityRetrievalQuery` and the smalltalk gate in the memory
pipeline. The gate decides whether tools are offered, never whether they are used.

### 4.6 Model protocol

The prompt instructs the model to reply with only `{"tool": "name", "args": { }}`
to call a tool, and to answer in plain text once it has enough information.
`protocol.ts` extracts the first balanced JSON object with the same string-aware
scanning pattern the memory extractor already uses, then validates the tool name
against the registry and the arguments with the tool `parseArgs`. Anything
unparsable is a final answer. This is preferred over native function calling
because the local 3B model is already handled this way elsewhere in the codebase.

## 5. Tool registry

    export interface ToolContext {
      userId: string;
      conversationId: string | null;
      deadline: number;
      signal: AbortSignal;
    }

    export interface ToolResult {
      ok: boolean;
      observation: string;
      meta?: { durationMs: number; truncated?: boolean };
    }

    export interface ToolDefinition<A = Record<string, unknown>> {
      name: string;
      description: string;
      requiredFlags: FeatureFlag[];
      timeoutMs: number;
      parseArgs(raw: unknown): A | null;
      execute(args: A, ctx: ToolContext): Promise<ToolResult>;
    }

- `registry.register` skips a tool whose `requiredFlags` are unsatisfied, so a
  disabled tool is absent from the manifest, cannot be called, and is never
  mentioned in the prompt.
- `initializeTools()` mirrors `initializeAI()`: a module-level `initialized`
  guard, idempotent, called once from the route next to `initializeAI()`.
- v1 tools by risk: `current_time` (pure), `calculator` (pure, own parser, no
  `eval`), `memory_search` (read-only wrapper over `retrieveMemories`),
  `web_search` (inert stub behind its own flag, ships disabled).
- No v1 tool writes to the database. The only write path remains the existing
  memory pipeline.

## 6. Integration with the existing pipeline

Exactly one production file changes, and only in a later step.

    // app/api/chat/route.ts, between line 147 and line 149
    if (isAgentModeEnabled() && classifyIntent(message) === "agent") {
      const outcome = await runAgentTurn(preResult);

      if (outcome.kind === "answered") {
        await saveAssistantMessage(
          preResult.userId,
          outcome.response,
          preResult.conversationId
        );

        return NextResponse.json({
          response: outcome.response,
          conversationId: preResult.conversationId ?? null,
        });
      }
    }
    // otherwise fall through to the existing getProvider() call below

Why this is safe:

- With flags OFF, `isAgentModeEnabled()` is false, so the branch is dead code and
  the executed path is identical to production today.
- The branch consumes `preResult` instead of calling `preStreamPipeline` again, so
  context assembly, the durable user message and memory job, and history
  construction happen exactly once, exactly as today.
- `saveAssistantMessage` is called with the same arguments as the legacy path, so
  persistence semantics are unchanged.
- The response shape is unchanged, so no frontend change is required.
- `runAgentTurn` never throws, so the route error mapping at
  `app/api/chat/route.ts:164-190` is not exercised by agent failures.
- Rollback is an environment change, with no code revert.

## 7. Durable job isolation (Phase B)

`claim_memory_jobs` claims any pending job for a user, and `processMemoryJobs`
dead-letters a claimed job that lacks a memory payload. Agent jobs must therefore
not share the `memory_jobs` table. Phase B adds a separate `agent_jobs` table with
mirrored lease, backoff, and dead-letter semantics, plus its own worker dispatched
from `after(...)` next to `processMemoryJobs`. Priority 1 and Priority 2 require
no migration at all.

## 8. Implementation plan

| Step | Work | Touches production code | Gate |
| --- | --- | --- | --- |
| 0 | Read Next.js references, record decisions | No | Done |
| 1 | Flags, tests, runbook, this design | No | Done, flags inert |
| 2 | Agent types, tool registry, tests | No | Additive only |
| 3 | `current_time` and `calculator` plus tests | No | Unreachable in production |
| 4 | `memory_search` wrapping `retrieveMemories` plus tests | No | Reuse only |
| 5 | Protocol, budget, loop, prompt, fallback, trace plus tests | No | No production caller |
| 6 | `initializeTools()` with flag-aware registration | No | Empty registry when the flag is off |
| 7 | The single flag-gated route branch, deployed with flags OFF | Route only | Byte-identical behavior with flags off |
| 8 | Enable both flags in development only, tune gate and budgets | Environment only | Staging soak |
| 9 | Production canary | Environment only | Clean metrics |
| 10 | `web_search` behind its own flag | No | Separate review |
| 11 | `ENABLE_PROCEDURAL_MEMORY` and `ENABLE_AI_PLANNER` | Additive stages, background worker only | Separate design notes |
| 12 | Phase B `agent_jobs` migration plus worker | New migration and worker | Own milestone |

## 9. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Route regression breaks the live product | One small guarded branch, flags off by default, identical response shape, rollback by environment change, existing smoke scripts rerun before enabling |
| Runaway loop or cost | Hard turn and deadline budgets, per-tool timeouts, one tool call per turn, instant kill by flag |
| Small-model tool-call errors | Strict prompt contract, tolerant JSON extraction, per-tool argument validation, unparsable input treated as a final answer |
| Tool side effects corrupt data | v1 tools are pure or read-only |
| Prompt injection from tool output | Observations are size-capped and framed as untrusted data; the web tool returns provider snippets and stays disabled until reviewed |
| Latency regression for normal chat | Deterministic gate, so ordinary messages take the legacy path |
| Agent jobs colliding with the memory worker | Separate `agent_jobs` table in Phase B, no shared claiming |
| Privacy of external queries | Web search is a separate OFF flag and sends only the user query, never memory or profile content |
| Observability blind spots | `AGENT_TIMING` content-free logs with tool name, duration, and outcome |
| Suppressed TypeScript errors (`ignoreBuildErrors`) | New modules are strictly typed and unit tested; removing the suppression is a separate task |

## 10. Protection invariants

These must remain true at every step.

1. With all flags unset, `app/api/chat/route.ts` executes the same path as
   production today.
2. `lib/core/pipeline.ts`, `lib/core/runtime.ts`, `lib/core/types.ts`,
   `lib/brain/*`, `lib/memory/*`, all repositories, all migrations, and the
   provider files receive no edits.
3. The response shape stays `{ response, conversationId }`.
4. `after(processMemoryJobs)` behavior is unchanged for both paths.
5. `runAgentTurn` can never throw into the route.
6. The only production file edited by this effort is `app/api/chat/route.ts`.
7. Rollback is an environment change, with no code revert, migration, or data
   change.
8. Priority 1 and Priority 2 require no database migration.

## 11. Test matrix for the planned modules

| Module | Required coverage |
| --- | --- |
| `registry` | Flag off means the tool is absent from `list()`, flag on means present, initialization is idempotent |
| `gate` | Time, arithmetic, search, and memory questions classify as agent, greetings and ordinary prose classify as chat |
| `protocol` | Clean JSON, JSON inside prose, several objects, malformed input, unknown tool names, nested braces and quotes |
| `loop` and `budget` | Happy path, tool error, tool timeout, turn cap, deadline, oversized observation, provider failure |
| `fallback` | Never throws, returns fallback for every loop failure class |
| `prompt` | Contains `preResult.prompt` verbatim, lists only registered tools, does not mutate the input array |
| `tools` | Deterministic clock, calculator precedence and malformed input, `memory_search` argument forwarding and user scoping |

## 12. References

- `docs/DECISIONS.md`, entries D-001 and D-002
- `docs/FEATURE_FLAGS.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`