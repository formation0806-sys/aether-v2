# SALPA × BLENDER TOOL DESIGN

**Status:** IMPLEMENTED as a local-only POC, with a passing real-Blender
end-to-end verification. The rest of this document is the original design
rationale and is retained for history.

> **Mechanism correction (2026-09-28, Step 8).** Sections 2.1 and 2.3 below
> predate native tool calling and describe the prompt-JSON protocol as *the*
> tool-call mechanism. That is no longer accurate. The agent loop is now
> **native-first**: when the provider exposes `chatWithTools` and the intent gate
> allows tools, registry tools are converted to the provider's native tool
> schema and the model returns structured tool calls
> (`lib/agent/native-tools.ts`, `lib/agent/loop.ts:221-230`). The prompt-JSON
> `parseToolCall` path in `lib/agent/protocol.ts` is retained only as a
> **fallback** for providers without native tool support. The real-Blender E2E
> evidence recorded below was produced on the native path
> (`BLENDER_E2E_AGENT_EVIDENCE blenderToolLines=2`). All other content in this
> document is unchanged.
**Repository:** `C:\Users\Piyush\aether-v2`
**Branch:** `feature/memory-v2-foundation`
**Baseline HEAD:** `19387b1`
**Related:** `docs/AGENT_LOOP_DESIGN.md`, `docs/FEATURE_FLAGS.md`, `docs/DECISIONS.md`
**Implementation:** `lib/config/features.ts`, `lib/agent/tools/blender.ts`,
`lib/agent/tools/blender-client.ts`, `lib/agent/tools/index.ts`,
`lib/agent/gate.ts`, `lib/agent/prompt.ts`, `blender-bridge/`
**Tests:** `tests/unit/agent/tools/blender.test.ts`, `blender-bridge/tests/`
**Operating the bridge:** `blender-bridge/README.md`, and
`docs/FEATURE_FLAGS.md` for the flag and the `BLENDER_BRIDGE_URL` and
`BLENDER_BRIDGE_TOKEN` variables

---

## 0. WHAT IS ACTUALLY BUILT TODAY

### Current implementation

| Item | State |
| --- | --- |
| `blender` tool definition | Implemented: `lib/agent/tools/blender.ts` |
| Blender bridge client | Implemented: `lib/agent/tools/blender-client.ts` |
| Local bridge (HTTP, auth, validation) | Implemented: `blender-bridge/server.py`, `protocol.py` |
| Real `bpy` executor | Implemented: `blender-bridge/blender_executor.py` |
| Bridge launcher | Implemented: `blender-bridge/run_blender_bridge.py` |
| Agent registry registration | Implemented: `lib/agent/tools/index.ts` (`AGENT_TOOLS`, registered last) |
| Intent gate category | Implemented: `lib/agent/gate.ts` (`blender`, matched on the literal word "blender") |
| Feature flag | Implemented: `ENABLE_TOOL_BLENDER`, **default OFF**, requires `ENABLE_TOOL_USE` |
| Supported operations | **Exactly two:** `create_object` and `inspect_scene` |
| Supported object types | Seven closed primitives: `cube`, `uv_sphere`, `cylinder`, `cone`, `plane`, `torus`, `empty` |
| Real E2E verification | **PASS.** A real authenticated local `POST /api/chat` entered the agent branch, selected the `blender` tool, called the loopback bridge, executed through real `bpy` in Blender 5.2.1, and created a cube in the real scene. |
| Bridge bind address | Hard-coded `127.0.0.1`. Not configurable; no wildcard option exists. |
| Bridge authentication | Required bearer token, constant-time comparison, checked before routing. |

### Not implemented, by design

| Item | State |
| --- | --- |
| Arbitrary Python / scripting | **Not supported and not permitted.** No interpreter path exists anywhere in the bridge. |
| Arbitrary Blender commands | **Not supported.** Only the two allowlisted operations. |
| Object deletion | **Not supported.** |
| File loading / saving | **Not supported.** No `.blend` file is ever written or read. |
| Rendering | **Not supported.** |
| Material editing | **Not supported.** |
| Camera manipulation | **Not supported.** |
| Object modification (`modify_object`) | **Not supported.** Only creation and inspection. |
| Filesystem or subprocess access | **Not supported.** |
| Scene persistence across restarts | **Not supported.** The scene is in-memory only. |
| Production / cloud → laptop Blender control | **Not implemented.** No relay, worker, job queue, device pairing, or remote transport exists in this repository. |
| Vercel → user localhost | **Explicitly out of scope and not solved.** A cloud-hosted Salpa cannot reach a user's Blender; the tool returns `BLENDER_UNAVAILABLE`. |

The local E2E proves only that **a Salpa server on the same machine can control
that machine's Blender process.** It does not imply, and does not support, any
cloud-to-laptop capability.

**Known model-behaviour limitation, recorded as diagnostic evidence only.** With
the tool enabled, a small model may answer an unsupported Blender request by
substituting a supported operation — for example reaching for `create_object` as
a precondition. Every boundary behaved correctly throughout: the parser, the
bridge, the dispatch path, and the security boundary all held, supported
sentinels stayed valid, and the tool-description prohibition and the generic agent
rules did not prevent the substitution. This is documented here and is
deliberately not pursued further: no runtime authorization layer, no intent
classifier, and no further prompt rules are planned for it.

---

## 1. ORIGINAL SCOPE (design intent, retained)

- This milestone was originally scoped as **design-only**. The implementation
  described in section 0 above has since been completed and verified.
- Blender integration is **additive and feature-flagged**, consistent with
  `docs/AGENT_LOOP_DESIGN.md` sections 1 and 10.
- The POC target is **local development / self-hosted only**.
- **Vercel → the user's localhost is NOT solved by this POC.**
- **No database migration is part of the POC.** Priorities 1 and 2 require none
  (`docs/DECISIONS.md` entry 7; `docs/AGENT_LOOP_DESIGN.md` section 7).
- **No arbitrary Blender Python execution is permitted.** Not as a tool, not as an
  argument, not as a fallback path. See section 6.

Every architectural claim below is carried over from the Blender integration audit
and is referenced to a file, function, and line in the current source. Anything
unverified is labelled **NOT VERIFIED YET**.

---

## 2. VERIFIED CURRENT AGENT ARCHITECTURE

### 2.1 The verified production / feature-flagged path

```
Chat UI
  → POST /api/chat
    → preStreamPipeline
      → optional agent runner (flag-gated)
        → agent loop
          → buildAgentToolRegistry()
            → tool execution
    → response
```

| Stage | File : function | Verified reference |
| --- | --- | --- |
| Chat page | `app/chat/page.tsx` : server component, Supabase-auth gated, renders `Chat` | :7-19 |
| Chat UI | `components/ai/Chat.tsx` : `sendMessage()` | `fetch("/api/chat", …)` at :473-477; contract `{ response, conversationId }` read at :479-508 |
| Route | `app/api/chat/route.ts` : `POST(req)` | :33; guards :42-111; `new Runtime(...)` :113-117 |
| Pre-stream call | `route.ts` → `preStreamPipeline(runtime)` | :122 |
| Pre-stream impl | `lib/core/pipeline.ts` : `preStreamPipeline(runtime)` | :853-914; returns `PreStreamResult` :836-842, :907-913 |
| Background memory | `route.ts` : `after(processMemoryJobs)` | :142-149 |
| Optional planner | `route.ts` : `isFeatureEnabled("ENABLE_AI_PLANNER")` | :156-172 |
| Agent branch | `route.ts` : `if (isAgentModeEnabled())` | :178-204; dynamic import :181; `runAgentTurn(preResult)` :182; answered → save + return :185-199 |
| Agent runner | `lib/agent/runner.ts` : `runAgentTurn(input, deps)` | :105; flags :110; gate :117, :122; loop :133; outcome validation :135, :147 |
| Agent loop | `lib/agent/loop.ts` : `runAgentLoop(input, deps)` | :158; provider :175; **registry :183**; budget :191; messages :202; turn/deadline check :212-217; `provider.chat` :224; `parseToolCall` :243; tool execution :270-274 |
| Tool registry | `lib/agent/tools/index.ts` : `buildAgentToolRegistry()` | :45-55; `AGENT_TOOLS` :31-36 |
| Registry internals | `lib/agent/tools/registry.ts` : `ToolRegistry.register()` | :52-62; `get` :65; `list` :74; `size` :78; validation :104-132 |
| Tool contract | `lib/agent/tools/types.ts` : `ToolDefinition` / `ToolContext` / `ToolResult` | :46-61, :11-18, :28-33 |
| Tool-call protocol | **Native first:** `lib/agent/native-tools.ts` : `supportsNativeTools` / `normalizeNativeToolCall` | `loop.ts:40-43, 221-230`; fallback below |
| Tool-call protocol (fallback) | `lib/agent/protocol.ts` : `parseToolCall(response, registry)`, used only when the provider has no `chatWithTools` | :184-222; balanced-JSON scan :75; candidate cap :69; `TOOL_CALL_SHAPE` :38; failure reasons :41-45 |
| Intent gate | `lib/agent/gate.ts` : `classifyIntent` / `classifyIntentCategory` | :152, :127-146; categories :33-38 |

With every agent flag OFF, `isAgentModeEnabled()` (`lib/config/features.ts:97-101`)
is `false`, the branch at `route.ts:178` is dead code, and the executed path is the
legacy single-call chat at `route.ts:206-220`.

### 2.2 LIVE registry versus dead registry

**LIVE registry — the one the agent loop actually reads:**

- `lib/agent/tools/index.ts:31-36` — `AGENT_TOOLS = [currentTimeTool, calculatorTool, memorySearchTool, blenderTool]`.
  `blenderTool` was appended last, so the three original tools keep their order
  and their behaviour.
- `lib/agent/tools/index.ts:45-55` — `buildAgentToolRegistry()` builds a fresh,
  flag-aware registry on every call
- Consumed on every agent turn at `lib/agent/loop.ts:183` —
  `deps.registry ?? buildAgentToolRegistry()`

**Dead / unwired registry — deliberately NOT used for Blender:**

- `lib/agent/tools/index.ts:61` `initializeTools()` and `:70` `getToolRegistry()`
- The only callers anywhere in the repository are
  `tests/unit/agent/tools/current-time.test.ts:228, 230, 232`. No production file
  calls them. `registry.ts:9-10` and `tools/index.ts:6` both state this.

**Decision (implemented):** the Blender tool was appended to `AGENT_TOOLS`
(`lib/agent/tools/index.ts:31-36`), the array the agent loop actually reads on
every turn. Adding it only to the module-level singleton `initializeTools()` /
`getToolRegistry()` would have produced a tool that can never run.

### 2.3 How a tool is defined, validated, executed, and reported

| Concern | Mechanism | Reference |
| --- | --- | --- |
| Definition | Plain object literal `ToolDefinition`; no schema library | `lib/agent/tools/types.ts:46-61` |
| Schema library | None. `zod` is in `package.json` but imported by no source file | `docs/AGENT_LOOP_DESIGN.md:43`; repository search |
| Registration | `register()` validates, dedupes first-wins, and is **flag-gated at registration time** | `registry.ts:52-62, 82-88` |
| Argument validation | Hand-rolled `parseArgs: (raw: unknown) => A \| null`, must never throw | `types.ts:43`; called defensively at `protocol.ts:167-176` |
| Call parsing | **Native path:** provider-returned structured tool call, normalized by `normalizeNativeToolCall`. **Fallback path:** tolerant string-aware JSON extraction, max 32 candidates | `native-tools.ts`; `loop.ts:221-230`; fallback `protocol.ts:75, 69, 184-222` |
| Failure taxonomy | `malformed_json \| missing_tool_name \| unknown_tool \| invalid_arguments` | `protocol.ts:41-45` |
| Execution | `definition.execute(args, ctx)` wrapped in a timeout race | `loop.ts:270-274`, helper `loop.ts:92-118` |
| Result | `ToolResult { ok, observation, meta? }` — **a string only, no structured channel** | `types.ts:28-33` |
| Observation cap | 4096 characters plus `"\n[truncated]"` | `loop.ts:48, 51, 121-140, 282` |
| Tool failure | Turns into a `TOOL_ERROR` observation; the loop continues | `loop.ts:275-280` |
| Provider failure | `provider_error` fallback; the route runs the legacy path | `loop.ts:225-232`; `runner.ts:138-143` |
| Tracing | Content-free `AgentTraceStep[]` | `trace.ts:77-109`; `types.ts:38-50` |
| Prompt manifest | Derived from the registry, so disabled tools are never mentioned | `prompt.ts:39-47` |

### 2.4 Existing gaps this design must work around (verified, not to be "fixed" here)

1. **`ctx.signal` never aborts.** An `AbortController` is created at `loop.ts:259`
   and passed into `ToolContext` at :260-265, but `controller.abort()` does not
   exist anywhere in `lib/agent/`. The per-tool timeout is a `Promise.race`
   (`loop.ts:109`) that abandons the in-flight promise without cancelling it. See
   section 14.
2. **Prompt/loop mismatch.** `prompt.ts:73` instructs the model to "retry once with
   corrected arguments", but `loop.ts:250-252` returns the raw text as an answer on
   an `invalid_tool_call`.
3. **Trace is collected but discarded.** `AgentOutcome.trace` is produced
   (`types.ts:72-82`) but `route.ts:185-199` reads only `.response`. `AGENT_TIMING`
   logging appears in documentation only and in no source file.
4. **Dead helpers.** `checkToolTimeout`, `remainingTurns`, `remainingTimeMs`
   (`budget.ts:96, 112, 126`), `finalizeTrace`, `traceDurationMs` (`trace.ts:117, 136`)
   are exported and unit-tested but not called by `loop.ts` (`loop.ts:31-35`).
5. `next.config.ts` sets `typescript.ignoreBuildErrors: true`, so `tsc --noEmit` is
   the only real type gate.

---

## 3. IMPORTANT GATE FINDING (RESOLVED)

**At the time of this audit, "Create a cube in Blender." did not reach the agent
tool loop. It does now, through the `blender` gate category added in the Blender
milestone.**

`lib/agent/gate.ts` is a pure, deterministic intent classifier. At audit time its
recognised categories were exactly (`gate.ts:33-38`, `classifyIntentCategory` at
`gate.ts:127-146`):

- `time`
- `arithmetic`
- `search`
- `memory`

Anything else returned `"none"`, and `classifyIntent` (`gate.ts:152-153`) maps
`"none"` to `"chat"`. Messages longer than 1000 characters also fall to `"chat"`
(`gate.ts:41, 135`).

Therefore, before the Blender milestone:

```
gate.ts:145     return "none"
gate.ts:153     "chat"
runner.ts:122   intent !== "agent"  →  createFallback("gate_chat")
route.ts:185    outcome.kind !== "answered"  →  fall through to legacy chat
```

A Blender POC that does not extend the gate would appear to "work" in a demo while
never invoking Blender at all. **A narrow Blender intent category with narrow
patterns was therefore added as part of the Blender milestone.** The gate
documented its own philosophy as precision-favoured over recall (`gate.ts:20-22`),
and the new patterns follow it: one word-boundary match on the literal word
"blender" (`gate.ts:84-99`, `BLENDER_PATTERNS`), checked last in
`classifyIntentCategory` (`gate.ts:163`).

**Result.** The recognised categories are now `time`, `arithmetic`, `search`,
`memory`, and `blender` (`gate.ts:33-40`). The gate still only classifies and
never consults flags: with `ENABLE_TOOL_BLENDER` off the tool is not registered,
so the protocol reports `unknown_tool` and the loop answers from what it already
knows.

---

## 4. BLENDER TOOL ARCHITECTURE

### 4.1 Implemented structure

```
lib/agent/tools/blender.ts            ToolDefinition(s) for the agent
lib/agent/tools/blender-client.ts     the only place that performs fetch()
blender-bridge/                       loopback HTTP server running inside Blender
```

**The application side is a normal `ToolDefinition`.** As implemented it required
no change to `lib/agent/loop.ts`, `lib/agent/runner.ts`, `lib/agent/protocol.ts`,
`lib/agent/tools/registry.ts`, or `lib/agent/tools/types.ts`.
`lib/agent/prompt.ts` is the one file that did change, and only additively: the
tool-selection clause, one line stating that every key inside `args` is an
argument name, and the anti-substitution rule. No loop behaviour, manifest
construction, or response contract was touched, and each addition is pinned by
`tests/unit/agent/prompt.test.ts:170-197`.
It is modelled on the existing tools (`lib/agent/tools/calculator.ts:300-335`,
`lib/agent/tools/memory-search.ts:162-222`), including the lazy-import pattern used
by `memory-search.ts:51-55` so that nothing network-capable enters the static
import graph.

`blender-client.ts` exists so that the bridge transport is separable from the tool
contract, and so tests can inject a transport without a network.

### 4.2 One tool per action

```
blender.create_object
blender.inspect_scene
blender.render
etc.
```

This is a **security** decision, not a cosmetic one. The protocol resolves tools by
exact name string (`protocol.ts:208-213`) with no namespacing layer, and the
manifest renders `- <name>: <description>` (`prompt.ts:45`). A dotted name is
legal, and one definition per action gives **each capability its own hand-written
`parseArgs` allowlist**, so a new capability can never be smuggled in by widening a
shared schema.

### 4.3 First POC scope

For the first POC only:

```
blender.create_object
```

is in scope. `blender.inspect_scene` has since been implemented and verified
alongside it, and the tool now carries exactly these two operations
(`BLENDER_OPERATIONS` in `lib/agent/tools/blender.ts`, matched by the closed
command union in `blender-bridge/protocol.py`). `blender.render` and every other
action remain explicitly out of scope and must not be added without a separate
reviewed step.

---

## 5. TOOL CONTRACT

### 5.1 Conceptual request

```json
{
  "tool": "blender.create_object",
  "args": {
    "type": "cube",
    "location": [0, 0, 0],
    "scale": [1, 1, 1]
  }
}
```

This matches `TOOL_CALL_SHAPE` (`lib/agent/protocol.ts:38`).

### 5.2 Allowed object types for the initial POC

Closed set. Any other value is rejected:

- `cube`
- `uv_sphere`
- `cylinder`
- `cone`
- `plane`
- `torus`
- `empty`

### 5.3 Arguments

| Argument | Required | Rules |
| --- | --- | --- |
| `type` | **yes** | Closed enum from 5.2. No free-form string may ever reach Blender. |
| `location` | no | Default `[0, 0, 0]`. Three finite numeric values. Bounded to a fixed magnitude limit. |
| `rotation` | no | Three finite numeric values, radians, bounded to a fixed magnitude limit. |
| `scale` | no | Default `[1, 1, 1]`. Three finite values, **each strictly greater than zero**, bounded. |
| `name` | no | Capped length (e.g. 64 characters), restricted charset, collapsed to a **single line**. |

**Unknown keys must be rejected.** The parser is an allowlist, not a merge: an
`args` object containing any key not listed above returns `null`, which the protocol
converts into `invalid_tool_call` (`protocol.ts:217-219`).

### 5.4 Explicitly rejected argument keys

These keys must be rejected as **unknown keys**, and each rejection must have its
own named test case:

- `script`
- `python`
- `code`
- `expression`
- `command`

There is no code-shaped escape hatch anywhere in this contract. See section 6.

### 5.5 Result channel

`ToolResult` is a **string-only** channel (`lib/agent/tools/types.ts:28-33`), capped
at 4096 characters by the loop (`lib/agent/loop.ts:48`). All Blender results must
therefore be serialised into `observation` strings, as described in section 13.

---

## 6. SECURITY MODEL

This section is the binding constraint of the whole milestone.

### 6.1 Prohibitions

There must **NEVER** be a normal agent tool named:

```
blender.execute_python
```

There must **NEVER** be a generic Blender command passthrough.

**The model must never provide arbitrary Python code to Blender.** Not as a
`script` argument, not as a `python` argument, not as a base64 blob, not as an
expression string, not through any future tool. An AI agent controlling Blender
through unrestricted model-generated Python is, in effect, running an
unreviewed program written by a small local model on the user's desktop, at the
desktop user's privilege. That is not an acceptable tool interface.

This prohibition is consistent with the precedent already set in this repository:
`lib/agent/tools/calculator.ts:1-10, 22-25` implements arithmetic with a
hand-written recursive-descent parser and states "no eval, no Function
constructor", with a 200-character length cap and a 32-level depth cap.

### 6.2 What the bridge accepts instead

The bridge accepts **only**:

```
validated command/action
  +
validated primitive arguments
```

That is: a closed command identifier drawn from a hand-written allowlist, plus
already-validated primitive values. There is no code parameter of any kind.

### 6.3 Bridge requirements

The Blender bridge must:

- **bind to `127.0.0.1` only**
- **never bind to `0.0.0.0`** (and never to a routable interface)
- **validate arguments again** (see 6.4)
- **have a hard execution deadline** (see section 14)
- **avoid arbitrary subprocess execution** — no `subprocess`, no `os.system`,
  no shell, no `eval`, no `exec`
- **expose no filesystem operations in the POC** — no open, no read, no write, no
  delete, no `.blend` load or save, no `quit_blender`
- **expose no network operations in the POC** — the bridge makes no outbound
  connections and has no network primitive
- **never expose secrets in tool observations**
- **never return stack traces**
- **never return local filesystem paths**

### 6.4 Defence in depth: two independent validations

Arguments are validated **twice**, on opposite sides of a trust boundary:

1. **Server-side (`parseArgs` in `lib/agent/tools/blender.ts`).** Rejects malformed
   model output early, produces a clean `invalid_tool_call`
   (`protocol.ts:217-219`), and keeps the model from wasting turns. This is a
   **usability and cost affordance**, not the security boundary.
2. **Bridge-side (the Blender process).** Re-validates the command identifier and
   every argument value before touching `bpy`. This **is** the security boundary,
   because the bridge is a separate process that may be started by hand, may be
   running an older Salpa build, or may be reached by anything else on the host.

A validation rule that exists on only one side is a single point of failure. The
bridge is authoritative; the server-side parser is a fast, friendly first filter.

### 6.5 Other verified risks this design must account for

| Risk | Note |
| --- | --- |
| Unbounded work in the bridge | The agent-side timeout does not cancel the in-flight request (section 14). The bridge must therefore bound its own work. |
| Token leakage | The token must never appear in an observation, a trace, a log line, or a thrown error message. The route's `chatTiming` logger is documented as content-free (`app/api/chat/route.ts:20-27`) and must stay that way. |
| SSRF via the model | The bridge URL must come only from a server-side environment constant, never from `args` and never from the model. See section 7. |
| Prompt injection via observation | A user-controlled object `name` flows back to the model. Observations are framed as untrusted data (`lib/agent/loop.ts:58, 293`) and capped (`lib/agent/loop.ts:48`); names must additionally be charset-restricted and collapsed to a single line, mirroring `lib/agent/tools/memory-search.ts:58-60`. |
| Runaway agent loops | Already bounded by the existing numeric flags; see section 14. |

---

## 7. LOCAL BRIDGE ARCHITECTURE

### 7.1 Recommended POC flow

```
Salpa Agent
   ↓
blender.create_object
   ↓
local authenticated HTTP bridge
   ↓
Blender
   ↓
result
   ↓
Salpa Agent
```

The bridge is **loopback-only**. It is a Blender-side process, started by the user,
listening on `127.0.0.1` on a port chosen by the user or by the bridge itself.

### 7.2 URL ownership

The URL is configured **server-side only**.

**The model must never control the bridge URL.** The URL is never read from
`args`, never from the conversation, never from memory, and never from anything
the model can influence. This is the same ownership pattern already used for the
model endpoint in `lib/ai/config.ts:1-3`, where the base URL comes from the
environment.

### 7.3 Conceptual configuration

```
BLENDER_BRIDGE_URL
BLENDER_BRIDGE_TOKEN
```

**Both are defaultless.** No fallback value is permitted. This is deliberately
stricter than `lib/ai/config.ts:1-3`, which defaults Ollama to
`http://127.0.0.1:11434`; a defaulted Blender URL would cause a serverless function
to silently point at its own loopback instead of failing closed.

If **either** variable is absent, the tool must **fail closed** with:

```
BLENDER_UNAVAILABLE
```

`BLENDER_BRIDGE_URL` and `BLENDER_BRIDGE_TOKEN` are **configuration, not feature
flags**. They are not added to `FeatureFlag` in `lib/config/features.ts` and are not
listed in `FEATURE_FLAGS`. Feature-flag enablement is controlled solely by
`ENABLE_TOOL_BLENDER` (section 10).

**Implemented and verified.** Both variables are read from the environment per
call, both are defaultless, and a missing or blank value fails closed with
`BLENDER_UNAVAILABLE` before any connection is attempted
(`lib/agent/tools/blender-client.ts`).

`BLENDER_BRIDGE_URL` must be the **complete tool endpoint**:

```
http://127.0.0.1:8765/tool
```

The client POSTs to that value **verbatim** and never appends a path of its own,
and the bridge serves only `POST /tool` (`TOOL_ROUTE` in
`blender-bridge/server.py`). A bare origin such as `http://127.0.0.1:8765` is
therefore wrong: it answers `404 not_found`, which reaches the agent as
`BLENDER_ERROR`. The value must address a bridge on the same machine as the Salpa
server; no public, tunnelled, or LAN endpoint is supported.

Canonical configuration references: `docs/FEATURE_FLAGS.md`, section "Blender
bridge environment variables", and `blender-bridge/README.md`, section
"Configuring `BLENDER_BRIDGE_URL`".

---

## 8. FOUR ARCHITECTURE OPTIONS

The audit compared four options for communicating between a Vercel-hosted Salpa
request and a Blender process on the user's Windows machine.

| | **A. Local HTTP bridge** | **B. Public / tunneled HTTP service** | **C. WebSocket bridge** | **D. Pull-based local worker** |
| --- | --- | --- | --- | --- |
| **Architecture** | Blender addon opens a `127.0.0.1` HTTP server; the Salpa tool calls it | Same bridge, published through a tunnel to a public URL | Long-lived WebSocket between the bridge and Salpa (or the browser) | A local Windows process polls Salpa for jobs, drives Blender, and POSTs the result back |
| **Security** | **Best.** Never leaves the host. Requires loopback-only bind and a shared secret | **Worst.** A public endpoint that can command Blender on a user's desktop. Requires strong auth, IP allowlist, egress control, rate limits, TLS | Mixed. No natural per-request auth or replay model; needs a bespoke handshake | Good. No inbound port on the user machine; authenticated outbound only. Adds a job store and a second long-lived credential surface |
| **Complexity** | **Lowest.** One addon file and one tool file | Low code, **high operational cost** (tunnel lifecycle, URL stability, cost) | **High.** No WebSocket server exists in the repository; a serverless request cannot hold a persistent connection; a browser cannot open `ws://127.0.0.1` from a Vercel page | **Highest.** Requires a durable job store. `docs/AGENT_LOOP_DESIGN.md:219-226` reserves a separate `agent_jobs` table for exactly this, and `docs/DECISIONS.md` entry 7 states Priorities 1–2 require **no migration** |
| **Fits the current budget** | Fits `AGENT_TOOL_TIMEOUT_MS` 10 s and `AGENT_LOOP_DEADLINE_MS` 45 s (`lib/config/features.ts:66-69`) | Fits | Fits | Poll interval fights the 10 s tool budget |
| **Data path** | Never leaves the machine | Model output crosses a public boundary | Same | Job payloads must be persisted server-side |

### 8.1 POC recommendation

**Option A — Local HTTP bridge.**

**As built**, option A is a Python loopback HTTP server that runs *inside* a
Blender process, not a separate addon (section 16.3). The comparison below is
retained from the design era.

Reason:

- **lowest complexity**
- **no public endpoint**
- **no migration**
- **no new infrastructure**
- **validates the actual agent → tool → Blender loop**, which is the only thing
  this milestone is trying to prove

### 8.2 POC limitation — stated plainly

**This is LOCAL-ONLY.**

A Vercel serverless function cannot directly reach `127.0.0.1` on the user's
computer. The repository is deployed on Vercel (`.vercel/repo.json` names the
project `aether-v2-deploy`), and there is no tunnel, reverse proxy, or long-lived
server anywhere in the codebase.

The POC is therefore valid only when the Next.js server runs on the same machine
as the bridge, for example `npm run dev` on the Windows host. **The POC does not
solve Vercel connectivity and does not claim to.**

---

## 9. FUTURE VERCEL ARCHITECTURE

**Do NOT implement or decide this.**

The unresolved future decision is:

**Option D** — pull-based local worker + `agent_jobs` migration
**OR**
**Option B** — tunneled service + strict authentication

**This decision is intentionally deferred and requires a separate architecture
review.**

Whichever is chosen will need its own design document, its own threat model, and,
for Option D, a database migration that this POC deliberately avoids.

---

## 10. FEATURE FLAGS

### 10.1 Required flags

| Flag | Status | Role |
| --- | --- | --- |
| `ENABLE_AGENT_LOOP` | exists today, default OFF | Required. Agent mode needs it (`lib/config/features.ts:97-101`) |
| `ENABLE_TOOL_USE` | exists today, default OFF | Required. Agent mode needs it (`lib/config/features.ts:97-101`) |
| `ENABLE_TOOL_BLENDER` | **exists**, default OFF | Required by the Blender tool specifically |

### 10.2 Rules

- **`ENABLE_TOOL_BLENDER` defaults OFF**, consistent with the module's stated
  guiding rule that every flag defaults to OFF and fails closed
  (`lib/config/features.ts:4-11`).
- It was added to the `FeatureFlag` union (`lib/config/features.ts:24-44`)
  **and** to the `FEATURE_FLAGS` array (`lib/config/features.ts:53-64`).
- **The Blender tool must require `ENABLE_TOOL_BLENDER`.** It is set in the tool's
  `requiredFlags`, following `lib/agent/tools/calculator.ts:304` and
  `lib/agent/tools/memory-search.ts:169`.
- **With the flag OFF, the existing registry behaviour must remain unchanged.**
  `ToolRegistry.register()` refuses a tool whose `requiredFlags` are unsatisfied
  (`lib/agent/tools/registry.ts:57, 82-88`), so with `ENABLE_TOOL_BLENDER` OFF the
  registry is byte-for-byte what it is today, the prompt manifest is unchanged
  (`lib/agent/prompt.ts:39-47`), and the tool cannot be called
  (`lib/agent/protocol.ts:211-213`).
- Precedent for a declared-but-unimplemented sub-flag already exists:
  `ENABLE_TOOL_WEB_SEARCH` is declared (`lib/config/features.ts:41, 59`) and is
  consumed by no source file.

---

## 11. POC BOUNDARIES

### 11.1 What the first POC DOES

- detect a Blender request
- call `blender.create_object`
- create a primitive in Blender
- return success/failure
- answer the user

### 11.2 What the first POC DOES NOT do

- arbitrary Python
- filesystem manipulation
- open/save `.blend` files
- delete files
- subprocess execution
- rendering
- vision
- memory integration
- procedural memory
- continual learning
- world model
- multi-agent
- autonomous long-horizon tasks
- production Vercel control
- public Blender endpoint

Every item above is a hard exclusion for this milestone. The already-built
`lib/agent/procedural/*`, `lib/agent/learning/*`, `lib/agent/world/*`,
`lib/agent/orchestration/*`, and `lib/agent/autonomy/*` modules stay exactly as
they are and are not extended by Blender.

---

## 12. VERIFIED POC FLOW

**VERIFIED POC FLOW. This path works today** — see the real-Blender end-to-end
pass recorded in section 0. Every step below is feature-flagged and OFF by
default.

```
User:
"Create a cube in Blender."

↓

Gate recognizes Blender intent
   (the `blender` category in lib/agent/gate.ts, matched on the literal word
   "blender")

↓

Agent registry exposes the `blender` tool
   (the entry appended last in AGENT_TOOLS; absent unless both ENABLE_TOOL_USE
   and ENABLE_TOOL_BLENDER are on)

↓

Model emits validated tool call
   {"tool":"blender","args":{"operation":"create_object","object_type":"cube"}}

↓

Salpa tool calls authenticated local bridge
   (loopback only, bearer token, defaultless URL)

↓

Bridge validates request
   (allowlisted command + validated primitives, nothing else)

↓

Bridge tells Blender to create cube

↓

Bridge returns sanitized result
   (no stack trace, no filesystem path, no token)

↓

Agent receives observation
   (framed as data by OBSERVATION_PREFIX, capped at 4096 characters)

↓

Salpa responds:

"Done — I created a cube in Blender."
```

The response text above is illustrative. The final user-facing wording is produced
by the model after it reads the observation, and must be persisted exactly as the
existing path persists an agent answer (`app/api/chat/route.ts:266-281`).

Those line numbers moved once for work unrelated to Blender: the same dirty tree
also adds a content-free, server-side `CHAT_TRACE` line per agent trace step
(`app/api/chat/route.ts:262-264`). That observability change is pre-existing work,
not part of the Blender integration, and it alters neither the response contract,
the guards, nor the structure of the agent branch.

---

## 13. FAILURE BEHAVIOR

### 13.1 Conceptual result vocabulary

| Situation | Observation prefix | `ok` |
| --- | --- | --- |
| Success | `BLENDER_OK` | `true` |
| Bridge unavailable (not configured, not running, unreachable, timed out) | `BLENDER_UNAVAILABLE` | `false` |
| Bridge rejected the request or failed to execute it | `BLENDER_ERROR` | `false` |

Illustrative shapes only:

```
BLENDER_OK: created Cube.001 (cube) at (0, 0, 0)
BLENDER_UNAVAILABLE: the local Blender bridge is not reachable.
BLENDER_ERROR: the requested object type is not supported.
```

### 13.2 The tool returns, it does not throw

The existing loop already converts a thrown tool error into a generic
`TOOL_ERROR` observation (`lib/agent/loop.ts:275-280`). Blender results must be
**returned** as `ok: false` results instead, so the model can see the specific
reason and the user gets an accurate answer. Throwing loses that distinction.

This matches the existing tools, which catch internally and return
`ok: false` (`lib/agent/tools/memory-search.ts:208-216`).

### 13.3 Never expose

No observation, log line, trace entry, or thrown message may contain:

- **token** — `BLENDER_BRIDGE_TOKEN` must never appear
- **bridge URL** — `BLENDER_BRIDGE_URL` must never appear
- **stack trace**
- **filesystem path** — local paths can reveal usernames and directory layout
- **arbitrary Blender exception details** — raw `bpy` or Python exception text is
  neither necessary nor safe to relay to a model

The trace is content-free by construction (`lib/agent/trace.ts`, `lib/agent/types.ts:38-50`)
and only the tool name, duration, and outcome are recorded, which is the correct
posture to preserve.

---

## 14. TIMEOUT MODEL

### 14.1 Verified existing agent limits

| Limit | Value | Source |
| --- | --- | --- |
| Max tool turns | **4** | `AGENT_MAX_TOOL_TURNS`, `lib/config/features.ts:46, 66` |
| Loop deadline | **45 seconds** | `AGENT_LOOP_DEADLINE_MS`, `lib/config/features.ts:47, 67` |
| Tool timeout | **10 seconds** | `AGENT_TOOL_TIMEOUT_MS`, `lib/config/features.ts:48, 68` |
| Observation cap | **4096 characters** | `MAX_OBSERVATION_CHARS`, `lib/agent/loop.ts:48` |

Additional verified bounds: one tool call per turn is structural in the loop
(`lib/agent/loop.ts:209-305`); the tool-call parser examines at most 32 candidate
objects (`lib/agent/protocol.ts:69`); the gate treats messages longer than 1000
characters as ordinary chat (`lib/agent/gate.ts:41, 135`).

The effective per-tool timeout is `min(definition.timeoutMs, budget.toolTimeoutMs)`
(`lib/agent/loop.ts:255-258`), so the tool's own `timeoutMs` is the real ceiling and
must stay comfortably below 10 seconds.

### 14.2 Existing limitation — verified

**The current agent timeout races the promise but does not actually cancel the
underlying request.**

`executeWithTimeout` (`lib/agent/loop.ts:92-118`) uses `Promise.race` between the
tool promise and a timer (`:109`). When the timer wins, the tool's promise is
**abandoned, not cancelled**. An `AbortController` is created at
`lib/agent/loop.ts:259` and its signal is passed into `ToolContext`
(`:260-265`), but **`controller.abort()` does not exist anywhere in
`lib/agent/`**. The existing tools check `ctx.signal.aborted`
(`lib/agent/tools/calculator.ts:316`) and therefore only ever observe `false`.

**Consequence:** after a tool timeout, an in-flight bridge request keeps running
on the server with nobody waiting for it.

### 14.3 Requirement on the bridge

**Therefore the Blender bridge has to bound its own work.** In the implemented
bridge that bound is structural rather than a timer: the body is size-capped
(`MAX_BODY_BYTES`, 64 KiB) and fully validated before dispatch, and the only two
reachable operations are fixed, bounded `bpy` calls, so an abandoned request
cannot accumulate unbounded work on the user's machine. No wall-clock deadline or
cancellation is implemented inside the bridge itself; the Salpa client bounds the
request from the outside instead (`DEFAULT_BRIDGE_TIMEOUT_MS`, 8 s, in
`lib/agent/tools/blender-client.ts`). Adding an explicit in-bridge deadline
remains a standing requirement on any future bridge change.

**Do not modify `lib/agent/loop.ts` as part of this design milestone.** The
non-cancelling timeout is a pre-existing property of the agent loop, recorded here
as a constraint on the Blender design rather than as a change to the loop.

---

## 15. TEST STRATEGY (AS IMPLEMENTED)

The suites below exist and run today. Each planned concern maps to a named test:

| Planned concern | Covered by |
| --- | --- |
| valid cube args | `blender.test.ts` "accepts the minimal create_object payload" |
| invalid object type | `blender.test.ts` "rejects an unsupported object type"; `test_protocol.py` `test_unsupported_object_type_is_refused` |
| invalid coordinates | `blender.test.ts` "rejects malformed coordinates"; `test_protocol.py` `test_invalid_vectors` |
| invalid scale | `blender.test.ts` "rejects a malformed or non-positive scale"; `test_protocol.py` `test_invalid_scale` |
| unknown keys | `blender.test.ts` "rejects every unknown key on create_object"; `test_protocol.py` `test_unknown_fields_are_rejected` |
| `script` / `python` / `code` / `expression` / `command` rejection | `blender.test.ts` "rejects every documented code-shaped key"; `test_protocol.py` `test_arbitrary_code_shaped_keys_are_rejected`, `test_command_value_is_never_a_passthrough` |
| feature flag OFF | `blender.test.ts` "is absent when `ENABLE_TOOL_BLENDER` is off, even with `ENABLE_TOOL_USE` on" and its inverse |
| feature flag ON | `blender.test.ts` "is present in `AGENT_TOOLS` only when BOTH flags are on" |
| bridge unavailable | `blender.test.ts` "fails closed with no `BLENDER_BRIDGE_URL` and never calls fetch" |
| bridge success | `blender.test.ts` "sends a validated create_object command and reports success" |
| bridge failure | `blender.test.ts` "maps every bridge failure code to a fixed observation" |
| token never appears in observation | `blender.test.ts` "keeps the token and the bridge URL out of the tool observation"; `test_server.py` `test_token_never_appears_in_logs` |
| no stack traces | `blender.test.ts` "discards a bridge-supplied stack trace, path, and echoed token" |
| no filesystem paths | as above, plus `test_integration_blender.py` `test_responses_carry_no_host_detail` |
| gate recognizes Blender requests | `blender.test.ts` "is recognised by the intent gate"; `tests/unit/agent/gate.test.ts` |
| tool is present in `buildAgentToolRegistry()` | `blender.test.ts` "is imported by `lib/agent/tools/index.ts` and registered in the live list" |
| dead `getToolRegistry()` is not used | `blender.test.ts` registry-wiring block, which builds the live registry only |

The real-Blender path is covered separately by `test_integration_blender.py`,
which launches a Blender in background mode, creates every one of the seven
primitives, reads the real scene back, and skips itself when no Blender
executable is present.

Conventions the tests follow, taken from the existing suites: injected
`FlagPredicate` rather than real `process.env` (`tests/unit/agent/registry.test.ts:29-33`),
an injected transport rather than a network call, and no database, clock, or
environment dependency (`tests/unit/agent/loop.test.ts:1-6`).

Two existing assertions were verified to survive the extra flag-gated tool
unchanged, because they build the registry with `only("ENABLE_TOOL_USE")` and the
Blender tool requires an additional flag:
`tests/unit/agent/tools/current-time.test.ts:216-225`,
`tests/unit/agent/prompt.test.ts:32`, `tests/unit/agent/protocol.test.ts:21`.

The route guard suite `tests/agent-eval/route-guard.test.ts` must also pass
unchanged; in particular `:271-276` pins the route's dynamic agent imports to
exactly two, which is a further reason no route change is needed.

---

## 16. FILE CHANGE LIST (AS IMPLEMENTED)

### 16.1 Created by the Blender milestone

```
docs/BLENDER_TOOL_DESIGN.md
tests/unit/agent/tools/blender.test.ts
blender-bridge/
```

### 16.2 Application files

```
lib/agent/tools/blender.ts
lib/agent/tools/blender-client.ts
```

### 16.3 Bridge

```
blender-bridge/README.md
blender-bridge/protocol.py
blender-bridge/server.py
blender-bridge/blender_executor.py
blender-bridge/run_blender_bridge.py
blender-bridge/tests/
```

The bridge is **Python**, as planned, not TypeScript: `tsconfig.json` includes
`**/*.ts` and `**/*.tsx` and excludes only `node_modules` and `tests/`, so a stray
`.ts` file would be pulled into the Next type-check. Python keeps the
application build entirely untouched.

There is **no Blender addon**, and none is needed: the bridge runs inside a
Blender process (`--background --factory-startup --python
run_blender_bridge.py`) and reaches `bpy` only through the injected
`BpyExecutor` seam, so no addon API, registration mechanism, or
version-to-version addon surface exists.

### 16.4 Modifications

```
lib/agent/tools/index.ts        append blenderTool to AGENT_TOOLS, last (:31-36)
lib/config/features.ts          add ENABLE_TOOL_BLENDER to the union (:24-44) and to
                                the FEATURE_FLAGS array (:53-64)
lib/agent/gate.ts               add a narrow blender intent category (:33-40, :84-99, :163)
lib/agent/prompt.ts             additive Blender tool wording only (see section 4.1)
docs/FEATURE_FLAGS.md           add the flag row, per the runbook (:122-131)
.gitignore                      ignore python bytecode
```

No new package dependency was added. Global `fetch` is already used in
`lib/ai/providers/ollama.ts:26`.

---

## 17. FILES THAT MUST REMAIN FROZEN

- `app/api/chat/route.ts`
- `lib/core/pipeline.ts`
- `lib/brain/*`
- `lib/memory/*`
- `lib/repositories/*`
- `supabase/migrations/*`
- `lib/ai/*`
- `lib/agent/loop.ts`
- `lib/agent/runner.ts`
- `lib/agent/protocol.ts`
- `lib/agent/types.ts`
- `lib/agent/budget.ts`
- `lib/agent/trace.ts`
- `lib/agent/fallback.ts`
- `lib/agent/prompt.ts` (no change beyond the additive Blender wording in 4.1)
- `lib/agent/tools/registry.ts`
- `lib/agent/tools/types.ts`
- existing tools (`calculator.ts`, `current-time.ts`, `memory-search.ts`)
- every pre-existing modification already present in the working tree

Notes on the most fragile of these:

- `app/api/chat/route.ts` needed **no Blender change**. The Blender step did not
  touch it; the same working tree does carry an unrelated, pre-existing
  observability addition (`CHAT_TRACE`, `:262-264`).
  `tests/agent-eval/route-guard.test.ts:254-269` forbids static agent imports and
  `:271-276` pins the dynamic agent imports to exactly two. `:330-338` pins a
  single `return` inside the agent branch and forbids `else` and `throw`.
- `lib/agent/prompt.ts` is the one frozen-adjacent file that did change, and only
  additively: see section 4.1. Manifest construction, the one-line-per-tool
  format, and the response contract are unchanged.
- `components/ai/Chat.tsx` also stays frozen: the response contract
  `{ response, conversationId }` is unchanged, so no frontend change is required
  (`docs/AGENT_LOOP_DESIGN.md:214`).
- `lib/agent/tools/index.ts:61-76` (`initializeTools` / `getToolRegistry`) stays
  dead. Only the `AGENT_TOOLS` array at `:31-36` was edited.

---

## 18. OPEN DECISIONS

**A. POC transport:**
Local loopback HTTP bridge — **APPROVED FOR POC DESIGN**.

**B. Production Vercel connectivity:**
**UNDECIDED.**

Options:
- **D**: pull-based local worker + `agent_jobs`
- **B**: tunneled service + strict authentication

This requires a future architecture decision. **This decision is intentionally
deferred and requires a separate architecture review.**

**C. Blender version compatibility:**
**VERIFIED.** The end-to-end pass in section 0 ran against Blender 5.2.1 LTS with
all seven primitives, and `test_integration_blender.py` re-checks the real
Blender path on any machine where a Blender executable is present.

**D. Blender addon API:**
**NOT APPLICABLE — there is no addon.** The question dissolves: `bpy` is reached
only from inside a Blender process, through the injected `BpyExecutor`
(`blender-bridge/run_blender_bridge.py:35, 72`), so there is no addon surface,
no enable/disable registration, and no version-to-version addon API to verify.

**E. Vercel `ENABLE_AGENT_LOOP` / `ENABLE_TOOL_USE` state:**
**NOT VERIFIED FROM REPO.** `.env.local` sets neither variable, so local
development has agent mode OFF. The Vercel project's environment variables are not
readable from the repository, so the deployed state is unknown.

---

## 19. APPROVAL GATE (HISTORICAL)

**This gate is closed. It applied to the design era only.**

This document originally stated that no implementation was approved by the design
alone, and that the tool, the feature flag, the gate change, and the local bridge
all had to be reviewed before they were built. That was true when it was written
and has since been satisfied: every one of those artifacts exists, is covered by
tests, and was verified end to end against a real Blender (section 0).

This document approves nothing further. Any next step — including a new Blender
capability — requires its own separate approval and its own reviewed change.
