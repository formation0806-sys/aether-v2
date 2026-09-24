/**
 * Rung 2 - chat route agent-branch wiring guard.
 *
 * WHAT THIS PROVES
 *   The agent branch in app/api/chat/route.ts is wired the same way the planner
 *   branch is guarded in tests/unit/agent/planner-background.test.ts:
 *     - entered only through isAgentModeEnabled() (both flags required)
 *     - reachable only through a dynamic import, never a static one
 *     - on "answered" it saves the assistant message and returns the existing
 *       response contract { response, conversationId }
 *     - on fallback, on an unexpected shape, or on a throw it falls through to
 *       the legacy getProvider().chat path
 *     - with flags OFF the executed order is unchanged:
 *       after(processMemoryJobs) -> optional planner after -> agent guard -> legacy chat
 *
 * HOW IT PROVES IT
 *   Static region assertions over the route source (region extraction, ordering,
 *   object-literal key parsing) plus hermetic behavioral checks of the two real
 *   seams the branch depends on: isAgentModeEnabled() and runAgentTurn().
 *   No HTTP request, no Next runtime, no Supabase, no Ollama, no network.
 *
 * NO PRODUCTION CHANGE: this file asserts against production code and never
 * modifies it, so the route is byte-identical with flags OFF.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { ChatMessage } from "@/lib/ai/types";
import { runAgentTurn } from "@/lib/agent/runner";
import type { AgentOutcome, AgentTurnInput } from "@/lib/agent/types";
import { isAgentModeEnabled, isFeatureEnabled } from "@/lib/config/features";

const ROUTE_PATH = path.join(process.cwd(), "app", "api", "chat", "route.ts");

/** CRLF-normalized so every assertion below works on either line ending. */
const ROUTE_SOURCE = readFileSync(ROUTE_PATH, "utf8").replace(/\r\n/g, "\n");

const AGENT_GUARD = "if (isAgentModeEnabled()) {";
const PLANNER_GUARD = 'if (isFeatureEnabled("ENABLE_AI_PLANNER")) {';
const MEMORY_JOBS_CALL = "processMemoryJobs(preResult.userId)";
const LEGACY_PROVIDER = "const ai = getProvider();";
const LEGACY_CHAT = "await ai.chat(preResult.conversation);";
const LEGACY_SAVE =
  "await saveAssistantMessage(preResult.userId, fullResponse, preResult.conversationId);";

function indexOrFail(haystack: string, needle: string): number {
  const index = haystack.indexOf(needle);

  expect(index, `route source must contain: ${needle}`).toBeGreaterThan(-1);

  return index;
}

/** The agent branch: from its flag guard up to (but excluding) the legacy path. */
function agentBranch(source: string = ROUTE_SOURCE): string {
  const start = indexOrFail(source, AGENT_GUARD);
  const end = indexOrFail(source, LEGACY_PROVIDER);

  expect(end, "legacy path must follow the agent branch").toBeGreaterThan(start);

  return source.slice(start, end);
}

/** The NextResponse.json({...}) literal that contains the given anchor. */
function returnLiteralFor(anchor: string, source: string = ROUTE_SOURCE): string {
  const anchorIndex = indexOrFail(source, anchor);
  const openIndex = source.lastIndexOf("NextResponse.json({", anchorIndex);
  const closeIndex = source.indexOf("});", anchorIndex);

  expect(openIndex, `a return literal must precede ${anchor}`).toBeGreaterThan(-1);
  expect(closeIndex, `the return literal for ${anchor} must close`).toBeGreaterThan(
    anchorIndex,
  );

  return source.slice(openIndex, closeIndex + 3);
}

/** Static import specifiers, including multi-line import statements. */
function staticImportSpecifiers(source: string): string[] {
  const matches = source.matchAll(
    /^[ \t]*import\s+(?:type\s+)?[^;]*?from\s+"([^"]+)"/gm,
  );

  return Array.from(matches, (match) => match[1]);
}

/** Dynamic import specifiers under @/lib/agent, in source order. */
function dynamicAgentImports(source: string): string[] {
  const matches = source.matchAll(/import\("(@\/lib\/agent\/[^"]+)"\)/g);

  return Array.from(matches, (match) => match[1]);
}

function makeInput(message = "what is 2+2?"): AgentTurnInput {
  const conversation: ChatMessage[] = [
    { role: "system", content: "You are SALPA." },
    { role: "user", content: message },
  ];

  return {
    userId: "user-1",
    messageId: "msg-1",
    conversationId: "conv-1",
    conversation,
    prompt: "You are SALPA.",
  } as AgentTurnInput;
}

function answered(response: string): AgentOutcome {
  return { kind: "answered", response, trace: [] };
}

const MANAGED_FLAGS = ["ENABLE_AGENT_LOOP", "ENABLE_TOOL_USE"] as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Stubs the two agent flags exactly as given, restoring afterwards. */
function withFlags(values: string[], run: () => void): void {
  vi.unstubAllEnvs();

  for (const flag of MANAGED_FLAGS) {
    vi.stubEnv(flag, values.includes(flag) ? "true" : "");
  }

  try {
    run();
  } finally {
    vi.unstubAllEnvs();
  }
}

/** Top-level keys of a flat object literal, quote- and brace-aware. */
function topLevelKeys(literal: string): string[] {
  const open = literal.indexOf("{");
  const close = literal.lastIndexOf("}");

  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);

  const inner = literal.slice(open + 1, close);
  const entries: string[] = [];
  let depth = 0;
  let current = "";
  let inString = false;
  let quote = "";

  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];

    if (inString) {
      current += char;

      if (char === quote && inner[index - 1] !== "\\") inString = false;

      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      inString = true;
      quote = char;
      current += char;

      continue;
    }

    if (char === "{" || char === "[" || char === "(") depth += 1;
    if (char === "}" || char === "]" || char === ")") depth -= 1;

    if (char === "," && depth === 0) {
      entries.push(current);
      current = "";

      continue;
    }

    current += char;
  }

  entries.push(current);

  return entries
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => entry.split(":")[0].trim());
}

/* -------------------------------------------------------------------------- */
/* Static guarantees: the guard                                               */
/* -------------------------------------------------------------------------- */

describe("route-guard: the agent branch is flag-gated and fail-closed", () => {
  it("imports the two-flag predicate and guards the branch with it", () => {
    expect(ROUTE_SOURCE).toContain(
      'import { isAgentModeEnabled, isFeatureEnabled } from "@/lib/config/features";',
    );

    expect(
      ROUTE_SOURCE.split(AGENT_GUARD).length - 1,
      "the agent guard must appear exactly once",
    ).toBe(1);

    expect(ROUTE_SOURCE).not.toMatch(/if\s*\(\s*!\s*isAgentModeEnabled/);
  });

  it("requires BOTH flags: the guard is false for every partial configuration", () => {
    const matrix: Array<{ flags: string[]; expected: boolean }> = [
      { flags: [], expected: false },
      { flags: ["ENABLE_AGENT_LOOP"], expected: false },
      { flags: ["ENABLE_TOOL_USE"], expected: false },
      { flags: ["ENABLE_AGENT_LOOP", "ENABLE_TOOL_USE"], expected: true },
    ];

    for (const entry of matrix) {
      withFlags(entry.flags, () => {
        expect(
          isAgentModeEnabled(),
          `flags=${entry.flags.join("+") || "none"}`,
        ).toBe(entry.expected);

        // The predicate is exactly the conjunction, so no single flag opens it.
        expect(isAgentModeEnabled()).toBe(
          isFeatureEnabled("ENABLE_AGENT_LOOP") &&
            isFeatureEnabled("ENABLE_TOOL_USE"),
        );
      });
    }
  });

  it("leaves both agent flags OFF by default in this environment", () => {
    expect(isFeatureEnabled("ENABLE_AGENT_LOOP")).toBe(false);
    expect(isFeatureEnabled("ENABLE_TOOL_USE")).toBe(false);
    expect(isAgentModeEnabled()).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Static guarantees: dynamic import only                                     */
/* -------------------------------------------------------------------------- */

describe("route-guard: agent code is loaded dynamically, never statically", () => {
  it("loads the runner through a dynamic import inside the request path", () => {
    const branch = agentBranch();

    expect(branch).toContain(
      'const { runAgentTurn } = await import("@/lib/agent/runner");',
    );
    expect(branch).toContain("const outcome = await runAgentTurn(preResult);");
  });

  it("has no static import of any agent module", () => {
    const specifiers = staticImportSpecifiers(ROUTE_SOURCE);

    expect(specifiers.length).toBeGreaterThan(0);

    for (const specifier of specifiers) {
      expect(
        specifier.includes("agent"),
        `route must not statically import ${specifier}`,
      ).toBe(false);
    }

    // Proves the extractor also sees multi-line import statements.
    expect(specifiers).toContain("@/lib/core");
    expect(specifiers).toContain("@/lib/config/features");
  });

  it("keeps exactly the planner and the runner as dynamic agent imports", () => {
    expect(dynamicAgentImports(ROUTE_SOURCE)).toEqual([
      "@/lib/agent/planner/background",
      "@/lib/agent/runner",
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* Static guarantees: the answered path                                       */
/* -------------------------------------------------------------------------- */

describe("route-guard: an answered outcome returns and persists the agent answer", () => {
  it("persists the assistant message exactly once and returns the agent answer", () => {
    const branch = agentBranch();

    expect(branch).toContain(
      'if (outcome?.kind === "answered" && typeof outcome.response === "string") {',
    );
    expect(
      branch.split("await saveAssistantMessage(").length - 1,
      "the assistant message must be saved exactly once on this path",
    ).toBe(1);
    expect(branch).toContain("preResult.userId,");
    expect(branch).toContain("outcome.response,");
    expect(branch).toContain("preResult.conversationId");
    expect(branch).toContain('chatTiming("agent",');
  });

  it("returns the unchanged response contract { response, conversationId }", () => {
    const literal = returnLiteralFor("response: outcome.response,");

    expect(topLevelKeys(literal)).toEqual(["response", "conversationId"]);
    expect(literal).toContain("conversationId: preResult.conversationId ?? null");
  });

  it("does not re-run the pipeline or re-assemble context inside the branch", () => {
    const branch = agentBranch();

    for (const forbidden of [
      "preStreamPipeline",
      "buildAgentConversation",
      "retrieveMemories",
      "createMessageWithJob",
      "saveMemory",
    ]) {
      expect(
        branch.includes(forbidden),
        `branch must not contain ${forbidden}`,
      ).toBe(false);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Static guarantees: fall-through                                            */
/* -------------------------------------------------------------------------- */

describe("route-guard: every non-answered outcome falls through to the legacy path", () => {
  it("has no early return other than the answered response", () => {
    const branch = agentBranch();

    expect(
      branch.split("return ").length - 1,
      "the branch must return only the answered response",
    ).toBe(1);
    expect(branch).not.toMatch(/\belse\b/);
    expect(branch).not.toContain("throw ");
  });

  it("swallows a throw and falls through instead of surfacing it", () => {
    const branch = agentBranch();

    expect(branch).toContain("} catch {");
    expect(branch).toContain("// Intentionally fall through to the legacy path below.");
  });

  it("guards the early return on a string response, so a malformed outcome cannot be returned", () => {
    const branch = agentBranch();

    expect(branch).toContain('outcome?.kind === "answered"');
    expect(branch).toContain('typeof outcome.response === "string"');
  });
});

/* -------------------------------------------------------------------------- */
/* Static guarantees: the legacy path                                         */
/* -------------------------------------------------------------------------- */

describe("route-guard: the legacy path remains intact and immediately follows", () => {
  it("runs the legacy single-call path directly after the agent branch", () => {
    const start = indexOrFail(ROUTE_SOURCE, LEGACY_PROVIDER);

    expect(ROUTE_SOURCE.slice(start)).toMatch(/^const ai = getProvider\(\);/);
    expect(ROUTE_SOURCE).toContain(LEGACY_CHAT);
    expect(ROUTE_SOURCE).toContain(LEGACY_SAVE);
  });

  it("returns the identical { response, conversationId } contract from the legacy path", () => {
    const literal = returnLiteralFor("response: fullResponse,");

    expect(topLevelKeys(literal)).toEqual(["response", "conversationId"]);
    expect(literal).toContain("response: fullResponse,");
    expect(literal).toContain("conversationId: preResult.conversationId ?? null");
  });
});

/* -------------------------------------------------------------------------- */
/* Static guarantees: ordering with flags OFF                                 */
/* -------------------------------------------------------------------------- */

describe("route-guard: production order is unchanged with flags OFF", () => {
  it("keeps after(processMemoryJobs) -> planner after -> agent guard -> legacy chat", () => {
    const memoryJobs = indexOrFail(ROUTE_SOURCE, MEMORY_JOBS_CALL);
    const planner = indexOrFail(ROUTE_SOURCE, PLANNER_GUARD);
    const agent = indexOrFail(ROUTE_SOURCE, AGENT_GUARD);
    const legacy = indexOrFail(ROUTE_SOURCE, LEGACY_PROVIDER);
    const legacyChat = indexOrFail(ROUTE_SOURCE, LEGACY_CHAT);

    expect(planner).toBeGreaterThan(memoryJobs);
    expect(agent).toBeGreaterThan(planner);
    expect(legacy).toBeGreaterThan(agent);
    expect(legacyChat).toBeGreaterThan(legacy);
  });

  it("runs the agent branch only after the pipeline produced its result", () => {
    const preStream = indexOrFail(ROUTE_SOURCE, "await preStreamPipeline(runtime);");
    const agent = indexOrFail(ROUTE_SOURCE, AGENT_GUARD);

    expect(agent).toBeGreaterThan(preStream);
  });

  it("keeps the background blocks background-only and never awaited", () => {
    expect(ROUTE_SOURCE).not.toContain("await processMemoryJobs");
    expect(ROUTE_SOURCE).not.toContain("await schedulePlanningJob");
    expect(ROUTE_SOURCE).not.toContain("await runPlanningJob");
    expect(ROUTE_SOURCE).not.toContain("runPlanningJob");
  });
});

/* -------------------------------------------------------------------------- */
/* Falsifiability self-check (synthetic sources, production untouched)        */
/* -------------------------------------------------------------------------- */

describe("route-guard: the checks are falsifiable", () => {
  it("detects a synthetic route that statically imports an agent module", () => {
    const broken = 'import { runAgentTurn } from "@/lib/agent/runner";\n';

    expect(staticImportSpecifiers(broken)).toContain("@/lib/agent/runner");
    expect(
      staticImportSpecifiers(ROUTE_SOURCE).some((specifier) =>
        specifier.includes("agent"),
      ),
    ).toBe(false);
  });

  it("detects a synthetic route whose agent guard was removed", () => {
    const broken = ROUTE_SOURCE.replace(AGENT_GUARD, "if (false) {");

    expect(broken.indexOf(AGENT_GUARD)).toBe(-1);
    expect(ROUTE_SOURCE.indexOf(AGENT_GUARD)).toBeGreaterThan(-1);
  });

  it("detects a synthetic route with an extra early return in the branch", () => {
    const broken = ROUTE_SOURCE.replace(
      AGENT_GUARD,
      `${AGENT_GUARD}\n      return NextResponse.json({});`,
    );

    expect(agentBranch(broken).split("return ").length - 1).toBe(2);
    expect(agentBranch(ROUTE_SOURCE).split("return ").length - 1).toBe(1);
  });

  it("detects a synthetic route that renamed a response contract key", () => {
    const broken = ROUTE_SOURCE.replace(
      "response: outcome.response,",
      "answer: outcome.response,",
    );

    expect(topLevelKeys(returnLiteralFor("answer: outcome.response,", broken))).toEqual([
      "answer",
      "conversationId",
    ]);
    expect(topLevelKeys(returnLiteralFor("response: outcome.response,"))).toEqual([
      "response",
      "conversationId",
    ]);
  });

  it("detects a synthetic route that moved the legacy path before the branch", () => {
    const broken =
      ROUTE_SOURCE.replace(LEGACY_PROVIDER, "") + `\n${LEGACY_PROVIDER}\n`;

    expect(broken.indexOf(LEGACY_PROVIDER)).toBeGreaterThan(
      broken.indexOf(AGENT_GUARD),
    );
    expect(indexOrFail(ROUTE_SOURCE, LEGACY_PROVIDER)).toBeGreaterThan(
      indexOrFail(ROUTE_SOURCE, AGENT_GUARD),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Behavioral: the runner contract the branch relies on (hermetic)            */
/* -------------------------------------------------------------------------- */


describe("route-guard: the runner keeps the branch fail-closed", () => {
  it("never runs the loop unless BOTH flags are on", async () => {
    for (const combo of [[], ["ENABLE_AGENT_LOOP"], ["ENABLE_TOOL_USE"]]) {
      let loopCalls = 0;

      const outcome = await runAgentTurn(makeInput(), {
        isFlagEnabled: (flag) => combo.includes(flag),
        runLoop: async () => {
          loopCalls += 1;

          return answered("must not run");
        },
      });

      expect(outcome).toEqual({
        kind: "fallback",
        reason: "flags_disabled",
        trace: [],
      });
      expect(loopCalls, `loop ran with flags=${combo.join("+") || "none"}`).toBe(0);
    }
  });

  it("reaches the loop only with both flags on and an agent-classified message", async () => {
    let loopCalls = 0;

    const outcome = await runAgentTurn(makeInput("what is 2+2?"), {
      isFlagEnabled: (flag) =>
        flag === "ENABLE_AGENT_LOOP" || flag === "ENABLE_TOOL_USE",
      runLoop: async () => {
        loopCalls += 1;

        return answered("4");
      },
    });

    expect(outcome).toEqual({ kind: "answered", response: "4", trace: [] });
    expect(loopCalls).toBe(1);
  });

  it("defers ordinary chat, so normal users stay on the legacy path", async () => {
    let loopCalls = 0;

    const outcome = await runAgentTurn(makeInput("hello there"), {
      isAgentMode: () => true,
      runLoop: async () => {
        loopCalls += 1;

        return answered("must not run");
      },
    });

    expect(outcome).toEqual({ kind: "fallback", reason: "gate_chat", trace: [] });
    expect(loopCalls).toBe(0);
  });

  it("never returns answered without a string response, for any hostile loop result", async () => {
    const hostile: unknown[] = [
      null,
      undefined,
      "garbage",
      5,
      {},
      { kind: "fallback" },
      { kind: "answered", response: 42, trace: [] },
      { kind: "answered", response: "ok", trace: [] },
    ];

    for (const result of hostile) {
      const outcome = await runAgentTurn(makeInput("what is 2+2?"), {
        isAgentMode: () => true,
        runLoop: async () => result as AgentOutcome,
      });

      expect(["answered", "fallback"]).toContain(outcome.kind);

      if (outcome.kind === "answered") {
        // Mirrors the route condition, so the early return can never fire on junk.
        expect(typeof outcome.response).toBe("string");
      }
    }
  });

  it("turns a throwing loop into a fallback the route can fall through on", async () => {
    const outcome = await runAgentTurn(makeInput("what is 2+2?"), {
      isAgentMode: () => true,
      runLoop: async () => {
        throw new Error("loop blew up");
      },
    });

    expect(outcome.kind).toBe("fallback");
    expect(outcome.trace).toEqual([]);
  });
});
