# Continual Learning - Foundation Design (Priority 5, step 1)

**Status:** Foundation only. `lib/agent/learning/` exists, is flag-gated by
`ENABLE_CONTINUAL_LEARNING` (default OFF), records deterministic learning
signals in memory, and produces *proposals*. It writes nothing, reads nothing,
and is imported by no production file.

**Related:** `docs/AGENT_LOOP_DESIGN.md`, `docs/FEATURE_FLAGS.md`,
`docs/DECISIONS.md`, `lib/config/features.ts`, `lib/agent/trace.ts`,
`lib/memory/constants.ts`.

## 1. Purpose and guardrails

Turn what happens *after* an answer into bounded evidence a later step can act
on, without touching the live product.

1. The single-call chat path stays the default and stays byte-for-byte identical
   with the flag OFF.
2. The flag defaults to OFF and fails closed (`docs/FEATURE_FLAGS.md`).
3. No change to `lib/core/pipeline.ts`, `app/api/chat/route.ts`,
   `lib/agent/loop.ts`, `lib/agent/runner.ts`, `lib/memory/*`, any repository,
   any migration, or any provider file. Nothing is wired yet.
4. No database migration: this step adds no column, no table, no RPC, and no
   write.
5. Every function never throws and degrades to a content-free deferral, matching
   the agent loop, the planner, the procedural foundation, and the orchestration
   coordinator.
6. Signals are content-free: a kind, a signed delta, a confidence, a rule label,
   and at most a registered tool name. No message text, no memory text, no
   observation text is stored or logged.

## 2. What already exists and is reused

Confirmed by reading the current source. Nothing below was modified.

| Existing piece | Location | How continual learning reuses it |
| --- | --- | --- |
| Correction / corroboration magnitudes | `CONFIDENCE_CORRECTION_STEP`, `CONFIDENCE_CORROBORATION_STEP`, `lib/memory/constants.ts:50-53` | The confidence delta of a correction, of negative feedback, and of praise. No new tuning value is invented. |
| Usage reinforcement unit | `touchMemories` -> `touch_memories` RPC, `lib/repositories/memory.repository.ts:158`, called by `lib/memory/retrieve.ts:303-306` | A successful tool turn counts as exactly one touch, the same unit the retrieval path already applies. |
| Usage-driven promotion | `lib/memory/lifecycle.ts:74-84` (`PROMOTE_USED_COUNT`, `PROMOTE_CONFIDENCE`, `lib/memory/constants.ts:78-79`) | The future consumer of a `memory_usage` proposal: usage plus confidence already promotes a candidate. |
| Retrieval-time usage term | `usageFactor` and `retrievalScore`, `lib/memory/score.ts:102-145` | Shows where a usage proposal eventually pays off; the weights are unchanged. |
| Feedback delta in importance | `IMPORTANCE_WEIGHTS.feedbackDelta`, `lib/memory/constants.ts:22-29`, consumed by `importanceScore`, `lib/memory/score.ts:64-95` | The existing hook for accumulating user feedback in `[-1, +1]`; the evaluation here produces the signed values such a term expects. |
| Reflection module | `generateReflections`, `lib/memory/reflector.ts:380` (never writes) | Precedent for "produce candidates, let a later step persist", and the natural home for a future consolidation of learning signals. |
| Procedural memory foundation | `lib/agent/procedural/{gate,extract,index,types}.ts` | The `procedural_candidate` target reuses the existing `procedural` memory type, weights, half-life, and inject caps; the extraction path itself is unchanged. |
| Agent trace | `AgentTraceStep` (`lib/agent/types.ts:38-50`), `lib/agent/trace.ts:21-33`, tool outcomes recorded at `lib/agent/loop.ts:284-288` | The tool_failure / tool_success signals read `phase`, `tool`, and `ok` from exactly this shape. |
| Fallback outcomes | `AgentFallbackReason` (`lib/agent/types.ts:53-63`), `createFallback` (`lib/agent/fallback.ts:107`) | Precedent for content-free reasons; `budget_exhausted` and `provider_error` are the signals a later step will want next. |
| Orchestration coordinator | `lib/agent/orchestration/coordinator.ts` | Its `{ kind, ... }` outcome shape and never-throw contract are mirrored here; orchestration fallbacks are a future signal source. |
| Feature flags | `lib/config/features.ts` | `ENABLE_CONTINUAL_LEARNING` was added to the union and the registry, default OFF, fail closed. |

## 3. Flag

| Flag | Default | Enables | Wired? |
| --- | --- | --- | --- |
| `ENABLE_CONTINUAL_LEARNING` | OFF | Deterministic learning-signal recording and evaluation | No. `lib/agent/learning/index.ts` is the single check point; nothing calls it. |

Parsing follows `lib/config/features.ts` unchanged: only `1`, `true`, `yes`,
`on` (trimmed, case-insensitive) enable it. Unset, empty, `0`, `false`, or any
typo keeps it OFF.


## 4. File structure

All new code is additive.

    lib/agent/learning/types.ts     LearningSignal, LearningUpdate, LearningOutcome
    lib/agent/learning/gate.ts      deterministic turn classifier (pure)
    lib/agent/learning/signals.ts   in-memory recorder and evaluator (pure)
    lib/agent/learning/index.ts     recordLearning entry point, flag-gated

## 5. The gate: when is a turn worth learning from?

`lib/agent/learning/gate.ts` is pure and deterministic: no flags, no
environment, no clock, no randomness, no model call, no database. It reads only
the current user message and the current turn's trace, so it needs no cross-turn
state and no session length.

| Signal | Fires when | Example |
| --- | --- | --- |
| `user_correction` | The user says a fact or answer was wrong | "no, that's wrong", "that is not what I asked" |
| `explicit_negative_feedback` | The user says the answer was unhelpful or broken | "that's not helpful", "that doesn't work" |
| `explicit_positive_feedback` | The user says the answer was right or useful | "perfect", "that worked", "thanks, that helped" |
| `tool_failure` | Any `act`/`observe` step has `ok: false` | a failed `calculator` call |
| `tool_success` | At least one such step has `ok: true` and none failed | a successful `current_time` call |

Rules that keep precision high:

- **Precedence is fixed:** correction, then negative feedback, then positive
  feedback, then trace outcome. A correction therefore wins when a message could
  also read as praise.
- **Failure dominates success:** one failing tool step yields `tool_failure` for
  the turn, because a failing path must not be reinforced.
- **Hard negatives are checked first:** identity statements, tool-shaped requests
  ("what's the time", "calculate 2 + 2"), planning requests, courtesy openers,
  and single interrogative sentences ("is that correct?") produce no signal.
- **No signal, no learning:** ordinary chat defers. At most one signal per kind
  is produced per turn, so a turn yields at most five signals.
- **Bounded work:** messages over 1000 characters are rejected rather than
  truncated, and at most 20 trace steps are scanned.

## 6. The recorder and the evaluator: what is proposed

`lib/agent/learning/signals.ts` turns signal kinds into an in-memory journal
(1-based, gapless, capped at 200 signals) and the journal into proposals. The
evaluator writes nothing: every proposal carries `requiresWrite: true`, and
`LEARNING_WRITES_ENABLED` is `false` until a later, separately reviewed step.

| Signal kind | Target | Delta | Why |
| --- | --- | --- | --- |
| `user_correction` | `memory_confidence` | `-CONFIDENCE_CORRECTION_STEP` | The existing "user correction" step from `lib/memory/constants.ts`. |
| `explicit_negative_feedback` | `memory_confidence` | `-CONFIDENCE_CORRECTION_STEP` | Same step: the answer was rejected. |
| `explicit_positive_feedback` | `memory_confidence` | `+CONFIDENCE_CORROBORATION_STEP` | The existing "corroborating evidence" step. |
| `tool_success` | `memory_usage` | `+1` touch | The unit `touch_memories` already applies when a memory is surfaced. |
| `tool_failure` | `procedural_candidate` | `0` | The candidate is the signal: a failed path is a procedure to capture, and nothing is known about a memory's score yet. |

Aggregation: one update per observed kind, in canonical order, with `count` and
the summed delta clamped into `[-1, 1]`. A run of corrections can therefore never
move more than one full step, and a run of successes can never exceed one usage
touch per evaluation.

## 7. Entry point contract

```ts
recordLearning(request: { userId, message, trace? }, deps?): Promise<LearningOutcome>
```

Order of checks, mirroring `runAgentTurn`, `extractOrDefer`, and
`planOrDefer`/`runOrchestration`:

1. `ENABLE_CONTINUAL_LEARNING` off or unreadable -> `{ kind: "deferred", reason: "learning_disabled" }`
2. non-string or oversized message, or a non-array trace -> `"invalid_request"`
3. no usable signal in the turn -> `"no_learning_signal"`
4. otherwise -> `{ kind: "recorded", signals, updates }`

A blank message is valid input, not an invalid request: a turn can carry a trace
without the user commenting on it, and the gate decides from both. Deferrals
carry a reason and nothing else, so nothing content-bearing crosses the boundary.

`journalFromOutcome(outcome, journal)` folds a recorded outcome into a journal
for a caller accumulating turns in one process; it is pure, re-indexes appended
signals, and leaves the journal untouched for a deferred or malformed outcome.

## 8. Explicit non-goals for this step

- No database write, no repository call, no RPC, no migration, no new column.
- No provider call, no tool call, no embedding, no model inference at all.
- No change to `lib/memory/*`, `lib/core/pipeline.ts`, `lib/agent/loop.ts`,
  `lib/agent/runner.ts`, `app/api/chat/route.ts`, or any existing contract.
- No change to the `procedural` memory type, its weights, its half-life, its
  token budget, or `INJECT_CAPS` in `lib/memory/constants.ts`.
- No wiring: nothing imports `lib/agent/learning/` in production, asserted by
  test.
- No persistence format: whether a journal survives a request, and where, is a
  later decision. Retention, dedupe across turns, and decay of signals are out
  of scope.


## 9. How to verify

```
npx tsc --noEmit
npx vitest run tests/unit/agent tests/unit/config
npx vitest run tests/unit/config/features.test.ts
```

The learning suite is `tests/unit/agent/learning*.test.ts`:

| File | Covers |
| --- | --- |
| `learning.test.ts` | User-signal rules, precedence, ordinary-chat rejections, input safety, and a source check that the gate reads no flag, provider, database, clock, or console. |
| `learning-trace.test.ts` | Trace tool outcomes, failure dominance, the scan bound, the dominant tool name, combined turn signals, and hostile input. |
| `learning-signals.test.ts` | Signal construction, journal purity and indexing, the 200-signal cap, validators, summaries, proposal mapping, aggregation clamping, and reuse of the memory constants. |
| `learning-index.test.ts` | Flag gating (including real-environment default OFF and a failing flag reader), request validation, recorded outcomes, the journal fold, never-throws behaviour, and production isolation. |

Production isolation is asserted directly: no file under `app/` or `lib/` that
the live path uses references `agent/learning` or `ENABLE_CONTINUAL_LEARNING`,
and `app/api/chat/route.ts` still answers through `preStreamPipeline` and
`getProvider`.

## 10. Next steps (not implemented, each separately reviewed)

1. A single flag-gated read site that builds a `LearningRequest` from a finished
   turn (the trace already exists) and logs a content-free summary.
2. A writer that turns `memory_confidence` and `memory_usage` proposals into the
   existing repository calls (`updateMemoryV2`, `touchMemories`), with the same
   fail-closed ladder as every other capability.
3. Procedural capture for `procedural_candidate`, reusing the Priority 3
   extraction path rather than adding a second extractor.
4. A decision on where a journal lives between requests, before any of the above
   ships.

## 11. Step 2 addendum: the applicator (Priority 5, step 2)

`lib/agent/learning/apply.ts` turns already-evaluated proposals into bounded
writes through existing infrastructure. It is still imported by no production
file and the chat route remains untouched.

- Entry points: `applyLearningUpdates({ userId, memoryIds, updates | outcome | journal }, deps)` and
  `applyLearningOutcome(outcome, { userId, memoryIds }, deps)`.
- Double opt-in before any write: `ENABLE_CONTINUAL_LEARNING` on AND
  `deps.allowWrites === true` (default false). Order: `learning_disabled` ->
  `writes_disabled` -> `invalid_request` -> `no_updates`.
- Supported target: `memory_usage` only, through the injected `touchUsage`
  writer (production shape: `touchMemories(userId, ids)`, the same
  `touch_memories` RPC `lib/memory/retrieve.ts` already calls). Ids are
  trimmed, deduped, capped at `MAX_APPLY_MEMORY_IDS` (20), order preserved.
- Deferred as `unsupported_target` (no safe writer exists yet):
  `memory_confidence` (the only writer, `corroborateMemory`, owns
  identity-flow exactly-once semantics this module must not borrow) and
  `procedural_candidate` (needs the Priority 3 extraction path this module
  never runs).
- Never throws: throwing/rejecting writers fold into one `write_failed` skip
  and the remaining updates still run; hostile input folds into a deferral.
- No new table, column, or RPC, no migration, no static import of any
  repository, Supabase client, or `saveMemory` - asserted by test
  (`tests/unit/agent/learning-apply.test.ts`, mocked writers only).

