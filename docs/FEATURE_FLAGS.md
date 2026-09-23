# Feature Flags - Operator Runbook

Feature flags let Salpa ship new capabilities (agent loop, tool use, AI planner,
procedural memory) while keeping the live chat path untouched. Every flag
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
| `ENABLE_AGENT_LOOP` | OFF | Bounded agent loop (observe, think, act, answer) in the chat route | No - reserved for a later reviewed step |
| `ENABLE_TOOL_USE` | OFF | Tool registry: registration and execution of tools for the loop | No - reserved |
| `ENABLE_AI_PLANNER` | OFF | AI plan generation, in the background job worker only | No - reserved |
| `ENABLE_PROCEDURAL_MEMORY` | OFF | Procedural-memory extraction and writing rules | No - reserved |
| `ENABLE_TOOL_WEB_SEARCH` | OFF | The external web-search tool only (sub-flag of `ENABLE_TOOL_USE`) | No - reserved |

**Agent mode** requires **both** `ENABLE_AGENT_LOOP` and `ENABLE_TOOL_USE`
(`isAgentModeEnabled()`). If either one is off or unset, the existing single-call
chat path runs exactly as it does today.

**Current status:** the flags are declared, documented, and tested, but no request
path reads them yet. The module is intentionally inert.

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