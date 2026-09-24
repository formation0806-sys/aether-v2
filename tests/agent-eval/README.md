# Agent evaluation harness - Rung 1

Dataset-driven, hermetic evaluation of the agent loop (`lib/agent/loop.ts`).

Rung 1 answers one question with numbers: **when a scripted model asks for a
tool, does the loop call the right tool, stay inside its turn budget, recover
from tool failures, and return the expected answer - or does it fall back?**

## Run it

```
npx vitest run tests/agent-eval/agent-eval.test.ts
```

`npm test` also picks it up, because `vitest.config.ts` includes
`tests/**/*.test.ts`.

## Files

| File | Purpose |
| --- | --- |
| `cases.json` | The dataset: one object per case, plus a dataset version |
| `agent-eval.test.ts` | The harness: dataset validation, scripted provider, probe tools, metrics, assertions |
| `measurement.json` | Report artifact written by every run (metrics + per-case detail) |

## Hermetic by construction

- No network, no Supabase, no Ollama, no database.
- **No feature flag is read or enabled.** The tool registry receives an
  in-memory flag predicate (`ENABLE_TOOL_USE` on) and the turn budget is
  injected, so `process.env` is never consulted by the loop.
- No production wiring: the chat route, the pipeline and all memory modules are
  untouched and unimported. An invariant test asserts the spec's own import list
  contains only node builtins, `vitest`, and `@/lib/agent/*` + `@/lib/ai/types`.
- The clock is injected and monotonic (5 ms per read), so durations are
  deterministic and wall-clock independent.

## Driving the real loop

Each case runs the real `runAgentLoop(input, deps)` with every dependency
injected:

| Seam | What the harness injects |
| --- | --- |
| `provider` | Scripted replies from the case |
| `registry` | Real `buildAgentToolRegistry()` (calculator, current_time, memory_search) plus the probes below |
| `budget` | `maxToolTurns` = the case's `maxTurns` (or 4), 60 s deadline, 100 ms tool timeout |
| `now` | Deterministic in-memory clock |

## Case schema

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Unique case id; also the test name |
| `message` | yes | User message placed in the loop input |
| `scriptedModelReplies` | yes | Model replies in call order. The last reply repeats if the loop calls again |
| `expectedOutcome` | yes | `"answered"` or `"fallback"` |
| `expectedToolSequence` | no | Ordered tool names expected in `act` trace steps. Omit for cases that expect no tool call |
| `maxTurns` | no | Hard cap on turns the case may consume; also becomes the loop's `maxToolTurns` |
| `expectedAnswerSubstring` | no | Fragment the final answer must contain |

**Sentinel:** the literal reply `"__THROW__"` makes the scripted provider throw,
which is how a `fallback` case is expressed without extending the schema. Such a
case must fall back with reason `provider_error`.

## Probe tools

The harness registers four I/O-free tools beside the real v1 tools:

| Tool | Behaviour | What it exercises |
| --- | --- | --- |
| `eval_probe_ok` | Returns a healthy observation | Happy-path tool round trip |
| `eval_probe_fail` | Returns `ok: false` | Tool-error accounting, loop recovery |
| `eval_probe_hang` | Never settles | Per-tool timeout, loop recovery |
| `eval_probe_large` | Returns a 5 000-character observation | The loop's 4 096-character cap and its `observation_truncated` note |

## Metrics computed

`answeredRate`, `fallbackReasons` (histogram), `toolSelection` (exact ordered
sequence match over cases that declare `expectedToolSequence`), `toolErrors`
(`actSteps`, `failed`, `failureRate`, plus a `timeouts` / `failures` split),
`truncatedObservations`, `turns` (total / mean / max), `durationMs` (mean / max /
p50 / p95 from the injected clock), and `casesPassed` / `casesFailed`.

A tool error is classified as a **timeout** when the invoked probe never
settled, and as a **failure** when it settled and reported `ok: false`.

## Pass / fail rules

The suite fails when any case

1. falls back while `expectedOutcome` is `answered` (or answers when it should
   fall back),
2. calls a different tool sequence than `expectedToolSequence`,
3. consumes more turns than `maxTurns`, or
4. misses `expectedAnswerSubstring`.

`afterAll` additionally requires every dataset case to be recorded and
`casesFailed === 0`, then writes `measurement.json` and prints the metrics.

## Limits (what Rung 1 does not do)

Not an end-to-end test: it does not exercise the chat route, the planner,
procedural memory, orchestration, learning or the world model, and it says
nothing about live model quality, durability, or cost. Those are later rungs.
Extend the dataset first; extend the schema only when a metric genuinely needs it.
