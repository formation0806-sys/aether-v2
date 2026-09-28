/** Unit tests for the native-vs-fallback tool-call branch in lib/agent/loop.
 *
 * Why this file exists. runAgentLoop picks between two mechanisms
 * (lib/agent/loop.ts:221-231):
 *
 *   - native: the provider exposes chatWithTools, so registry tools are
 *     converted to provider schemas and the model returns structured calls;
 *   - fallback: the provider has no chatWithTools, so the prompt-JSON contract
 *     is kept in the system prompt and parseToolCall reads the reply.
 *
 * Every pre-existing loop test drives the loop with a provider that has only
 * chat(), so the fallback was covered and the native branch was covered solely
 * by the opt-in live E2Es - never by `npm test`. These tests close that gap in
 * both directions without touching either production branch.
 *
 * Injected stubs only: no network, no database, no real clock, no environment.
 */

import { describe, expect, it } from "vitest";

import type { ChatCompletion, ChatMessage } from "@/lib/ai/types";
import { TOOL_CALL_SHAPE } from "@/lib/agent/protocol";
import { runAgentLoop } from "@/lib/agent/loop";
import { buildAgentToolRegistry } from "@/lib/agent/tools/index";
import type { FlagPredicate } from "@/lib/agent/tools/registry";
import type { AgentTurnInput } from "@/lib/agent/types";

function only(...enabled: string[]): FlagPredicate {
  const set = new Set<string>(enabled);

  return (flag) => set.has(flag);
}

function registryOn() {
  return buildAgentToolRegistry(only("ENABLE_TOOL_USE"));
}

function makeInput(message = "what is 6*7?"): AgentTurnInput {
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

const BUDGET = { maxToolTurns: 4, loopDeadlineMs: 45000, toolTimeoutMs: 10000 };

function answer(text: string): ChatCompletion {
  return { text, toolCalls: [] };
}

function call(name: string, args: Record<string, unknown>): ChatCompletion {
  return { text: "", toolCalls: [{ name, arguments: args }] };
}

function systemText(messages: ChatMessage[]): string {
  const first = messages[0];

  return first !== undefined && first.role === "system" ? first.content : "";
}

describe("loop - native tool calling is selected when the provider supports it", () => {
  it("calls chatWithTools with the registry schemas, runs the tool, and feeds the observation back", async () => {
    const nativeCalls: Array<{ messages: ChatMessage[]; toolNames: string[] }> =
      [];
    let chatCalls = 0;

    const provider = {
      // Must never be reached: the presence of chatWithTools is what selects
      // the native branch.
      chat: async (_messages: ChatMessage[]) => {
        chatCalls += 1;
        return answer("LEGACY_PATH_WAS_USED");
      },
      chatWithTools: async (
        messages: ChatMessage[],
        tools: Array<{ function: { name: string } }>,
      ) => {
        nativeCalls.push({
          messages,
          toolNames: tools.map((tool) => tool.function.name),
        });

        return nativeCalls.length === 1
          ? call("calculator", { expression: "6*7" })
          : answer("42");
      },
    };

    const outcome = await runAgentLoop(makeInput(), {
      provider,
      registry: registryOn(),
      budget: BUDGET,
      now: () => 0,
    });

    // The native branch, not the text branch.
    expect(chatCalls).toBe(0);
    expect(nativeCalls.length).toBe(2);
    expect(outcome.kind).toBe("answered");

    if (outcome.kind === "answered") {
      expect(outcome.response).toBe("42");
    }

    // The tools handed to the provider are the registry's own, in order.
    expect(nativeCalls[0].toolNames).toContain("calculator");
    expect(nativeCalls[0].toolNames).not.toContain("blender");

    // The calculator actually ran: an act step recorded it.
    const actSteps = outcome.trace.filter(
      (step) => step.phase === "act" && step.tool === "calculator",
    );
    expect(actSteps.length).toBe(1);
    expect(actSteps[0].ok).toBe(true);

    // The observation reached the provider on the next turn, as a real tool
    // result message rather than an imitated user turn.
    const secondTurn = nativeCalls[1].messages;
    const toolMessages = secondTurn.filter((message) => message.role === "tool");

    expect(toolMessages.length).toBe(1);
    expect(toolMessages[0].tool_name).toBe("calculator");
    expect(toolMessages[0].content).toContain("42");

    // The assistant turn carried the structured call back to the provider.
    const assistantWithCalls = secondTurn.filter(
      (message) =>
        message.role === "assistant" &&
        Array.isArray(message.tool_calls) &&
        message.tool_calls.length > 0,
    );
    expect(assistantWithCalls.length).toBe(1);
  });

  it("keeps the prompt-JSON contract out of the system prompt on the native path", async () => {
    let seenSystem = "";

    const provider = {
      chat: async (_messages: ChatMessage[]) => answer("unused"),
      chatWithTools: async (messages: ChatMessage[]) => {
        seenSystem = systemText(messages);
        return answer("done");
      },
    };

    await runAgentLoop(makeInput(), {
      provider,
      registry: registryOn(),
      budget: BUDGET,
      now: () => 0,
    });

    // The tool definitions sent alongside the request are the contract here;
    // telling the model to imitate JSON as well would compete with them.
    expect(seenSystem).not.toContain(TOOL_CALL_SHAPE);
    expect(seenSystem).toContain("calculator");
  });
});

describe("loop - the existing fallback is selected when the provider has no chatWithTools", () => {
  it("uses chat() and the prompt-JSON contract, and still runs the tool", async () => {
    const responses = [
      JSON.stringify({ tool: "calculator", args: { expression: "6*7" } }),
      "42",
    ];
    const seen: ChatMessage[][] = [];
    let calls = 0;

    const provider = {
      // No chatWithTools at all: this is the only shape a non-native provider
      // has, and it must keep working unchanged.
      chat: async (messages: ChatMessage[]) => {
        seen.push(messages);
        const next = responses[calls] ?? responses[responses.length - 1];

        calls += 1;

        return next as string;
      },
    };

    const outcome = await runAgentLoop(makeInput(), {
      provider,
      registry: registryOn(),
      budget: BUDGET,
      now: () => 0,
    });

    expect(calls).toBe(2);
    expect(outcome.kind).toBe("answered");

    if (outcome.kind === "answered") {
      expect(outcome.response).toBe("42");
    }

    const actSteps = outcome.trace.filter(
      (step) => step.phase === "act" && step.tool === "calculator",
    );
    expect(actSteps.length).toBe(1);
    expect(actSteps[0].ok).toBe(true);

    // The observation is replayed as a user turn on this path, unchanged.
    const secondTurn = seen[1];
    const last = secondTurn[secondTurn.length - 1];

    expect(last?.role).toBe("user");
    expect(last?.content).toContain("42");

    // And the contract the model was asked to imitate is present, because this
    // is the only mechanism it has.
    expect(systemText(seen[0])).toContain(TOOL_CALL_SHAPE);
  });

  it("still answers in plain text when the provider makes no tool call", async () => {
    const provider = {
      chat: async (_messages: ChatMessage[]) => "No tool needed.",
    };

    const outcome = await runAgentLoop(makeInput("hello"), {
      provider,
      registry: registryOn(),
      budget: BUDGET,
      now: () => 0,
    });

    expect(outcome).toMatchObject({
      kind: "answered",
      response: "No tool needed.",
    });
    expect(outcome.trace.length).toBe(1);
  });
});
