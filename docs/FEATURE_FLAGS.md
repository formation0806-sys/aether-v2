# Feature Flags - Operator Runbook

Feature flags let Salpa ship new capabilities (agent loop, tool use, AI planner,
procedural memory, multi-agent orchestration, continual learning, world model)
while keeping
the live chat path untouched. Every flag
defaults to **OFF**, so the product behaves exactly as it does today until a flag
is deliberately enabled in the environment.

- Implementation: `lib/config/features.ts`
- Design and integration plan: `docs/AGENT_LOOP_DESIGN.md`
- Decision record: `docs/DECISIONS.md`, entries D-001 and D-002

## Parsing rules

A flag is enabled only by an explicit truthy token.

| Environment value (after trim and lowercase) | Result |
| --- | --- |
| unset or missing | OFF |
| empty string, `0`, `false`, `no`, `off` | OFF |
| any typo or unknown value (`ture`, `enabld`, `maybe`, `2`, `-1`) | OFF, fails closed |
| `1`, `true`, `yes`, `on` (any casing, surrounding whitespace ignored) | ON |

Consequences:

- A misconfigured value can never accidentally switch a capability on.
- Flags are read per call on the server. Each call reads `process.env` directly,
  so no cache invalidation is required.
- Values are never exposed to the browser: no flag uses the `NEXT_PUBLIC_`
  prefix, and `lib/config/features.ts` must not be imported from client
  components.
- On serverless hosting a changed value takes effect after a new deployment. No
  code change, no migration, and no data change are involved.

## Boolean flags

| Flag | Default | Enables | Wired into production code today? |
| --- | --- | --- | --- |
| `ENABLE_AGENT_LOOP` | OFF | Bounded agent loop (observe, think, act, answer) in the chat route | Yes - `isAgentModeEnabled()` in `lib/config/features.ts`, read by `app/api/chat/route.ts`. Both flags must be on; otherwise the legacy single-call path runs unchanged |
| `ENABLE_TOOL_USE` | OFF | Tool registry: registration and execution of tools for the loop. Tool calls are dispatched through **native Ollama tool calling** when the provider supports it, with the prompt-JSON protocol retained as a fallback | Yes - `buildAgentToolRegistry()` in `lib/agent/tools/index.ts`; dispatch in `lib/agent/loop.ts` |
| `ENABLE_AI_PLANNER` | OFF | AI plan generation, in the background job worker only | No - reserved |
| `ENABLE_PROCEDURAL_MEMORY` | OFF | Procedural-memory extraction and writing rules | No - reserved |
| `ENABLE_MULTI_AGENT` | OFF | Multi-agent orchestration planning (Priority 4 foundation only) | No - reserved |
| `ENABLE_CONTINUAL_LEARNING` | OFF | Continual-learning signal recording and evaluation (Priority 5 foundation only) | No - reserved |
| `ENABLE_WORLD_MODEL` | OFF | Basic world-model snapshots, effect predictions, and update proposals (Priority 6 foundation only) | No - reserved |
| `ENABLE_TOOL_WEB_SEARCH` | OFF | The external web-search tool only (sub-flag of `ENABLE_TOOL_USE`) | No - reserved |
| `ENABLE_TOOL_BLENDER` | OFF | The local Blender bridge tool only (sub-flag of `ENABLE_TOOL_USE`) | Yes - flag-gated branch in `app/api/chat/route.ts`; inert while OFF |
| `ENABLE_LONG_HORIZON` | OFF | Long-horizon goal-run autonomy runtime (Priority L1 foundation only) | No - reserved for a later reviewed step |


**Agent mode** requires **both** `ENABLE_AGENT_LOOP` and `ENABLE_TOOL_USE`
(`isAgentModeEnabled()`). If either one is off or unset, the existing single-call
chat path runs exactly as it does today.

**Current status:** the agent branch is wired into `app/api/chat/route.ts` but is
guarded by `isAgentModeEnabled()`, so with the default environment (every flag
OFF, nothing set) the executed path is byte-for-byte the existing single-call
chat path. Enabling a flag is what makes the branch reachable.

### `ENABLE_TOOL_BLENDER`

| | |
| --- | --- |
| Default | **OFF** |
| Requires | `ENABLE_TOOL_USE` as well |
| Enables | The `blender` tool in the agent tool registry |
| Scope | Controlled **local** Blender operation on the same machine as the Salpa server |
| Not enabled by | Vercel or cloud deployment |

`ENABLE_TOOL_BLENDER` is a sub-flag of `ENABLE_TOOL_USE`, exactly like
`ENABLE_TOOL_WEB_SEARCH`. Turning it on by itself does nothing: the tool
registry refuses any tool whose required flags are unsatisfied, so the tool is
absent from the registry and absent from the model-visible tool manifest unless
`ENABLE_TOOL_USE` is also on.

Unlike the three original read-only tools, the Blender tool **mutates state** -
its `create_object` operation changes a live Blender scene. It is still confined
to a closed operation allowlist and writes no files.

**This flag does not make Blender reachable from the cloud.** The tool talks to a
bridge bound to `127.0.0.1` on the machine running the Salpa server. A Vercel or
otherwise cloud-hosted Salpa cannot reach a user's laptop Blender, and no relay,
worker, pairing, or remote-transport mechanism exists in this repository. This
flag is for local and self-hosted use only.

## Numeric flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `AGENT_MAX_TOOL_TURNS` | 4 | Maximum tool-calling turns before a forced final answer |
| `AGENT_LOOP_DEADLINE_MS` | 45000 | Total wall-clock budget for one agent turn |
| `AGENT_TOOL_TIMEOUT_MS` | 10000 | Per-tool execution timeout |

Read them with `readNumericFlag("AGENT_MAX_TOOL_TURNS")`. A value must be a
positive decimal integer with no sign and no leading zero; anything else (empty,
`0`, `00`, `07`, `-3`, `7.5`, `12abc`, `1e3`) falls back to the documented
default, so a misconfigured environment cannot create a zero, negative, or
unbounded budget.

## Enabling a flag locally

Add the variable to `.env.local` (git-ignored) and restart the dev server:

```
ENABLE_AGENT_LOOP=true
ENABLE_TOOL_USE=true
```

## Blender bridge environment variables

These two variables are read by the Blender client
(`lib/agent/tools/blender-client.ts`), not by the feature-flag module. Both are
required; if either is missing or blank the tool fails closed and returns
`BLENDER_UNAVAILABLE` without contacting anything.

| Variable | Required | Purpose |
| --- | --- | --- |
| `BLENDER_BRIDGE_URL` | yes | Full URL of the local bridge `POST /tool` endpoint |
| `BLENDER_BRIDGE_TOKEN` | yes | Bearer token the local bridge requires |

### `BLENDER_BRIDGE_URL`

The URL must point at the **complete tool endpoint**, including the `/tool`
path. The client POSTs to the value verbatim and never appends a path, and the
bridge serves only `POST /tool`.

```
http://127.0.0.1:8765/tool
```

| Value | Result |
| --- | --- |
| `http://127.0.0.1:8765/tool` | correct - the only route the bridge serves |
| `http://127.0.0.1:8765` | `404 not_found`, surfaced to the agent as `BLENDER_ERROR` |

The value must address a bridge on the same machine as the Salpa server. No
public, tunnelled, or LAN endpoint is supported, and none should ever be
configured.

### `BLENDER_BRIDGE_TOKEN`

- The local bridge refuses to start without a non-empty token, and it is
  required on every request as `Authorization: Bearer <token>`.
- Supply it through the server environment only, from a secret store or a
  git-ignored `.env.local`. **Never commit a real token**, and never place one
  in a document, a fixture, a log, or a test assertion.
- It must never be exposed to browser or client code. `lib/config/features.ts`
  and the Blender client are server-side modules and must not be imported from
  a client component.
- Use a fresh, long random value per run.

## Enabling a flag in production

1. Set the variable in the deployment environment (for example Vercel: Project,
   Settings, Environment Variables).
2. Redeploy so the running functions receive the new value.
3. Watch the relevant timing logs (`AGENT_TIMING` for the agent loop) and the
   memory job health for the first minutes after the change.

## Rollback

Unset the variable, or set it to `false`, and redeploy. No code revert, no
migration, and no data change are required. This is the primary reason agent
capabilities sit behind flags.

## How to verify the flags are OFF

**Default-off assertion (unit tests).**

```
npx vitest run tests/unit/config/features.test.ts
```

The fail-closed default suite fails if any flag is truthy without environment
variables being set.

**Runtime inspection.**

```ts
import { getFeatureFlagSnapshot } from "@/lib/config/features";

console.log("FEATURE_FLAGS", getFeatureFlagSnapshot());
```

With nothing configured this reports every flag as `false`.

**Mode check.** `isAgentModeEnabled()` returns `false`, so the planned agent
branch cannot activate.

**No-call-site check.** `grep -r "lib/config/features" app/ lib/` finds no
production import until a later, separately approved step adds one.

## Adding a new flag

1. Add the name to the `FeatureFlag` union and to the `FEATURE_FLAGS` array in
   `lib/config/features.ts`.
2. Keep the default OFF. Do not add a default that enables behavior.
3. Add a row to the table in this document.
4. Add coverage to `tests/unit/config/features.test.ts` (at minimum: off by
   default, one truthy value, one unrecognized value).
5. Add the flag check at the single decision point that needs it, and record in
   the design document which file owns that check.