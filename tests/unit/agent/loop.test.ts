/** Unit tests for lib/agent/loop.
 *
 * Exercises the bounded Observe → Think → Act → Answer loop with injected
 * stubs only: no network, no database, no real clock, no environment.
 * No production code is touched; the loop is not wired into the chat route.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@/lib/ai/types";
import {
  FORCED_FINAL_ANSWER_PROMPT,
  MAX_OBSERVATION_CHARS,
  OBSERVATION_TRUNCATION_SUFFIX,
  capObservation,
  runAgentLoop,
} from "@/lib/agent/loop";
import type { AgentLoopDeps } from "@/lib/agent/loop";
import { buildAgentToolRegistry } from "@/lib/agent/tools/index";
import type { FlagPredicate } from "@/lib/agent/tools/registry";
import type { ToolContext, ToolResult } from "@/lib/agent/tools/types";
import type { AgentTurnInput } from "@/lib/agent/types";

const SOURCE = readFileSync(
  path.join(process.cwd(), "lib", "agent", "loop.ts"),
  "utf8",
);

function only(...enabled: string[]): FlagPredicate {
  const set = new Set<string>(enabled);

  return (flag) => set.has(flag);
}

function registryOn() {
  return buildAgentToolRegistry(only("ENABLE_TOOL_USE"));
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

function toolJson(tool: string, args: unknown): string {
  return JSON.stringify({ tool, args });
}

function staticProvider(responses: string[]) {
  let calls = 0;

  return {
    calls: () => calls,
    provider: {
      chat: async (_messages: ChatMessage[]) => {
        const next =
          responses[calls] !== undefined
            ? responses[calls]
            : responses[responses.length - 1];

        calls += 1;

        return next;
      },
    },
  };
}

describe("loop - capObservation", () => {
  it("passes short observations through", () => {
    expect(capObservation("hello")).toEqual({ text: "hello", truncated: false });
    expect(capObservation("")).toEqual({ text: "", truncated: false });
  });

  it("caps exactly at the 4 KB boundary", () => {
    const atCap = "x".repeat(MAX_OBSERVATION_CHARS);

    expect(MAX_OBSERVATION_CHARS).toBe(4096);
    expect(capObservation(atCap)).toEqual({ text: atCap, truncated: false });

    const over = "x".repeat(MAX_OBSERVATION_CHARS + 1);
    const capped = capObservation(over);

    expect(capped.truncated).toBe(true);
    expect(capped.text.endsWith(OBSERVATION_TRUNCATION_SUFFIX)).toBe(true);
    expect(capped.text.startsWith("x".repeat(MAX_OBSERVATION_CHARS))).toBe(true);
  });

  it("maps non-strings to empty without throwing", () => {
    expect(capObservation(undefined)).toEqual({ text: "", truncated: false });
    expect(capObservation(null)).toEqual({ text: "", truncated: false });
    expect(capObservation(5)).toEqual({ text: "", truncated: false });
  });
});

describe("loop - plain answer with no tool call", () => {
  it("returns answered with a think step", async () => {
    const stub = staticProvider(["Hello there."]);

    const outcome = await runAgentLoop(makeInput("hello"), {
      provider: stub.provider,
      registry: registryOn(),
      budget: { maxToolTurns: 4, loopDeadlineMs: 45000, toolTimeoutMs: 10000 },
      now: () => 0,
    });

    expect(outcome.kind).toBe("answered");

    if (outcome.kind === "answered") {
      expect(outcome.response).toBe("Hello there.");
      expect(outcome.trace.length).toBe(1);
      expect(outcome.trace[0].phase).toBe("think");
    }

    expect(stub.calls()).toBe(1);
  });

  it("treats an invalid tool call as the final answer", async () => {
    const raw = '{"tool": "nope", "args": {}}';
    const stub = staticProvider([raw]);

    const outcome = await runAgentLoop(makeInput(), {
      provider: stub.provider,
      registry: registryOn(),
      now: () => 0,
    });

    expect(outcome).toMatchObject({ kind: "answered", response: raw });
    expect(stub.calls()).toBe(1);
  });
});

describe("loop - calculator round trip", () => {
  it("calls calculator then answers", async () => {
    const stub = staticProvider([
      toolJson("calculator", { expression: "6*7" }),
      "The answer is 42.",
    ]);

    const outcome = await runAgentLoop(makeInput("what is 6*7?"), {
      provider: stub.provider,
      registry: registryOn(),
      now: () => 0,
    });

    expect(outcome.kind).toBe("answered");

    if (outcome.kind === "answered") {
      expect(outcome.response).toBe("The answer is 42.");
      expect(outcome.trace.map((s) => s.phase)).toEqual([
        "think",
        "act",
        "observe",
        "think",
      ]);
      expect(outcome.trace[1]).toMatchObject({ tool: "calculator", ok: true });
    }

    expect(stub.calls()).toBe(2);
  });

  it("continues after a TOOL_ERROR observation", async () => {
    const stub = staticProvider([
      toolJson("calculator", { expression: "1/0" }),
      "Cannot divide by zero.",
    ]);

    const outcome = await runAgentLoop(makeInput(), {
      provider: stub.provider,
      registry: registryOn(),
      now: () => 0,
    });

    expect(outcome).toMatchObject({
      kind: "answered",
      response: "Cannot divide by zero.",
    });
  });

  it("truncates an oversized observation and notes it", async () => {
    const big = "y".repeat(MAX_OBSERVATION_CHARS + 100);
    const registry = registryOn();
    const loud = registry.get("calculator");

    if (!loud) throw new Error("calculator missing");

    const noisy = {
      ...loud,
      execute: async (_a: unknown, _c: ToolContext): Promise<ToolResult> => ({
        ok: true,
        observation: big,
      }),
    };

    registry.register({ ...noisy, name: "noisy" });

    const stub = staticProvider([
      toolJson("noisy", { expression: "2+2" }),
      "Done.",
    ]);

    const outcome = await runAgentLoop(makeInput(), {
      provider: stub.provider,
      registry,
      now: () => 0,
    });

    expect(outcome.kind).toBe("answered");

    if (outcome.kind === "answered") {
      const act = outcome.trace.find((s) => s.phase === "act");

      expect(act?.note).toBe("observation_truncated");
    }
  });
});

describe("loop - budgets", () => {
  it("forces a final answer when turns run out", async () => {
    const seen: string[][] = [];
    const provider = {
      chat: async (messages: ChatMessage[]) => {
        seen.push(messages.map((m) => m.content));

        return "Final: 4.";
      },
    };

    const outcome = await runAgentLoop(makeInput(), {
      provider,
      registry: registryOn(),
      budget: { maxToolTurns: 0, loopDeadlineMs: 45000, toolTimeoutMs: 10000 },
      now: () => 0,
    });

    expect(outcome).toMatchObject({ kind: "answered", response: "Final: 4." });

    const lastContents = seen[seen.length - 1];
    expect(lastContents[lastContents.length - 1]).toBe(
      FORCED_FINAL_ANSWER_PROMPT,
    );
  });

  it("falls back with budget_exhausted when the forced call fails", async () => {
    const provider = {
      chat: async () => {
        throw new Error("down");
      },
    };

    const outcome = await runAgentLoop(makeInput(), {
      provider,
      registry: registryOn(),
      budget: { maxToolTurns: 0, loopDeadlineMs: 45000, toolTimeoutMs: 10000 },
      now: () => 0,
    });

    expect(outcome).toMatchObject({
      kind: "fallback",
      reason: "budget_exhausted",
    });
  });

  it("falls back with provider_error when chat throws", async () => {
    const provider = {
      chat: async (_m: ChatMessage[]) => {
        throw new Error("down");
      },
    };

    const outcome = await runAgentLoop(makeInput(), {
      provider,
      registry: registryOn(),
      now: () => 0,
    });

    expect(outcome).toMatchObject({
      kind: "fallback",
      reason: "provider_error",
    });
  });

  it("times out a hanging tool and continues", async () => {
    const registry = registryOn();
    const hanging = {
      name: "hanging",
      description: "Hangs forever.",
      requiredFlags: ["ENABLE_TOOL_USE"] as never[],
      timeoutMs: 5000,
      parseArgs: () => ({}),
      execute: () => new Promise<ToolResult>(() => {}),
    };

    expect(registry.register(hanging as never)).toBe(true);

    const stub = staticProvider([
      toolJson("hanging", {}),
      "Recovered after timeout.",
    ]);

    const outcome = await runAgentLoop(makeInput(), {
      provider: stub.provider,
      registry,
      budget: { maxToolTurns: 4, loopDeadlineMs: 45000, toolTimeoutMs: 20 },
      now: () => 0,
    });

    expect(outcome).toMatchObject({
      kind: "answered",
      response: "Recovered after timeout.",
    });
  }, 15000);
});

describe("loop - never throws", () => {
  it("falls back on malformed input", async () => {
    const stub = staticProvider(["hi"]);

    for (const bad of [undefined, null, 5, "x", {}]) {
      const outcome = await runAgentLoop(bad as never, {
        provider: stub.provider,
        registry: registryOn(),
        now: () => 0,
      });

      expect(["answered", "fallback"]).toContain(outcome.kind);
    }
  });

  it("keeps the input conversation unchanged", async () => {
    const stub = staticProvider(["Done."]);
    const input = makeInput();
    const before = JSON.stringify(input.conversation);

    await runAgentLoop(input, {
      provider: stub.provider,
      registry: registryOn(),
      now: () => 0,
    });

    expect(JSON.stringify(input.conversation)).toBe(before);
  });
});

describe("loop - purity", () => {
  it("reads no env, randomness, fetch, or console", () => {
    const forbidden = [
      "process.env",
      "Math.random",
      "fetch(",
      "console.",
    ];

    for (const token of forbidden) {
      expect(SOURCE.includes(token)).toBe(false);
    }
  });

  it("loads the provider lazily instead of at import time", () => {
    expect(SOURCE.includes('import("@/lib/ai/provider")')).toBe(true);
    expect(SOURCE.includes('from "@/lib/ai/provider"')).toBe(false);
  });
});
