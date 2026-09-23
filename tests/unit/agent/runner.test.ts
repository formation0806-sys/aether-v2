/** Unit tests for lib/agent/runner.
 *
 * Exercises the runAgentTurn entry point with injected stubs only: no
 * network, no database, no environment dependency. No production code is
 * touched; the runner is not wired into the chat route.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@/lib/ai/types";
import { runAgentTurn } from "@/lib/agent/runner";
import type { AgentOutcome, AgentTurnInput } from "@/lib/agent/types";

const SOURCE = readFileSync(
  path.join(process.cwd(), "lib", "agent", "runner.ts"),
  "utf8",
);

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

describe("runner - flags off stays on the legacy path", () => {
  it("returns flags_disabled when agent mode is off", async () => {
    let loopCalls = 0;

    const outcome = await runAgentTurn(makeInput(), {
      isAgentMode: () => false,
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
    expect(loopCalls).toBe(0);
  });

  it("reads the real env fail-closed by default", async () => {
    const outcome = await runAgentTurn(makeInput(), {
      runLoop: async () => answered("must not run"),
    });

    expect(outcome).toEqual({
      kind: "fallback",
      reason: "flags_disabled",
      trace: [],
    });
  });
});

describe("runner - gate", () => {
  it("returns gate_chat for ordinary chat without calling the loop", async () => {
    let loopCalls = 0;

    const outcome = await runAgentTurn(makeInput("hello there"), {
      isAgentMode: () => true,
      runLoop: async () => {
        loopCalls += 1;

        return answered("must not run");
      },
    });

    expect(outcome).toEqual({
      kind: "fallback",
      reason: "gate_chat",
      trace: [],
    });
    expect(loopCalls).toBe(0);
  });

  it("calls the loop for a tool-ish message", async () => {
    let loopCalls = 0;

    const outcome = await runAgentTurn(makeInput("what is 2+2?"), {
      isAgentMode: () => true,
      runLoop: async () => {
        loopCalls += 1;

        return answered("4");
      },
    });

    expect(outcome).toEqual({ kind: "answered", response: "4", trace: [] });
    expect(loopCalls).toBe(1);
  });
});

describe("runner - never throws", () => {
  it("falls back when the loop throws", async () => {
    const outcome = await runAgentTurn(makeInput("what is 2+2?"), {
      isAgentMode: () => true,
      runLoop: async () => {
        throw new Error("loop blew up");
      },
    });

    expect(outcome).toEqual({
      kind: "fallback",
      reason: "unexpected_error",
      trace: [],
    });
  });

  it("falls back when the loop returns garbage", async () => {
    const outcome = await runAgentTurn(makeInput("what is 2+2?"), {
      isAgentMode: () => true,
      runLoop: async () => "garbage" as never,
    });

    expect(outcome).toEqual({
      kind: "fallback",
      reason: "unexpected_error",
      trace: [],
    });
  });

  it("falls back on malformed input", async () => {
    for (const bad of [undefined, null, 5, "x", {}]) {
      const outcome = await runAgentTurn(bad as never, {
        isAgentMode: () => true,
        runLoop: async () => answered("must not matter"),
      });

      expect(outcome).toEqual({
        kind: "fallback",
        reason: "gate_chat",
        trace: [],
      });
    }
  });

  it("falls back when flag reading throws", async () => {
    const outcome = await runAgentTurn(makeInput(), {
      isAgentMode: () => {
        throw new Error("env broken");
      },
      runLoop: async () => answered("must not run"),
    });

    expect(outcome).toEqual({
      kind: "fallback",
      reason: "flags_disabled",
      trace: [],
    });
  });
});

describe("runner - purity", () => {
  it("loads the loop lazily instead of at import time", () => {
    expect(SOURCE.includes('import("./loop")')).toBe(true);
    expect(SOURCE.includes("@/lib/ai/provider")).toBe(false);

    const loopValueImports = SOURCE.split("\n").filter((line) => {
      const trimmed = line.trimStart();

      return (
        trimmed.startsWith("import ") &&
        !trimmed.startsWith("import type ") &&
        trimmed.includes('"./loop"')
      );
    });

    expect(loopValueImports).toEqual([]);

    const valueImports = SOURCE.split("\n")
      .filter((line) => {
        const trimmed = line.trimStart();

        return trimmed.startsWith("import ") && !trimmed.startsWith("import type ");
      })
      .map((line) => line.trim());

    expect(valueImports).toEqual([
      'import { isAgentModeEnabled } from "@/lib/config/features";',
      'import { classifyIntent } from "./gate";',
      'import { createFallback } from "./fallback";',
    ]);
  });

  it("never reads the clock, randomness, timers, fetch, or console", () => {
    const forbidden = [
      "Date.now",
      "new Date",
      "Math.random",
      "setTimeout",
      "fetch(",
      "console.",
    ];

    for (const token of forbidden) {
      expect(SOURCE.includes(token)).toBe(false);
    }
  });
});
