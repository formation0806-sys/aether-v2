import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AgentIntentCategory } from "@/lib/agent/gate";
import {
  MAX_GATE_MESSAGE_LENGTH,
  classifyIntent,
  classifyIntentCategory,
} from "@/lib/agent/gate";

/** Flags the gate must never consult. Cleared before and after each test. */
const MANAGED_FLAGS = ["ENABLE_AGENT_LOOP", "ENABLE_TOOL_USE"] as const;

function clearManagedFlags(): void {
  for (const flag of MANAGED_FLAGS) {
    delete process.env[flag];
  }
}

beforeEach(clearManagedFlags);
afterEach(clearManagedFlags);

/** Messages that must be offered to the agent, with the category that must win. */
const AGENT_CASES: Array<[string, AgentIntentCategory]> = [
  ["what time is it?", "time"],
  ["what's the time?", "time"],
  ["What is the time right now?", "time"],
  ["what time is it in Tokyo?", "time"],
  ["what's the date?", "time"],
  ["what is the date today?", "time"],
  ["what day is it?", "time"],
  ["what's today's date?", "time"],
  ["what's the current time?", "time"],
  ["tell me the time", "time"],
  ["give me the date", "time"],
  ["2+2", "arithmetic"],
  ["what is 2+2?", "arithmetic"],
  ["what's 12*(3+4)?", "arithmetic"],
  ["(12+8)/4", "arithmetic"],
  ["100/4", "arithmetic"],
  ["what is 2^10?", "arithmetic"],
  ["what is 5-3?", "arithmetic"],
  ["calculate 15% of 200", "arithmetic"],
  ["how much is 45 minus 12?", "arithmetic"],
  ["3 plus 4", "arithmetic"],
  ["10 divided by 2", "arithmetic"],
  ["search for the latest release notes", "search"],
  ["search the web for salpa", "search"],
  ["look up the weather in pune", "search"],
  ["google the price of gold", "search"],
  ["browse the web for this error", "search"],
  ["can you search for that?", "search"],
  ["what do you remember about my project?", "memory"],
  ["do you remember my sister's name?", "memory"],
  ["what did i tell you about the launch?", "memory"],
  ["what have i told you about pricing?", "memory"],
  ["remind me what i said about the deadline", "memory"],
  ["what do you have stored about me?", "memory"],
  ["search your memory for my preferences", "memory"],
];

/** Messages that must stay on the existing chat path. */
const CHAT_CASES: string[] = [
  "",
  "   ",
  "hi",
  "hello",
  "hey there",
  "thanks!",
  "how are you?",
  "what's up?",
  "tell me a joke",
  "what is the capital of France?",
  "why is the sky blue?",
  "what is my name?",
  "where do i live?",
  "do you know my name?",
  "who am i?",
  "i have 3 apples and 2 oranges",
  "i paid 5-3 dollars",
  "the meeting is at 3:30",
  "what happened on 2026-09-21?",
  "the date is 2026-09-21",
  "my birthday is 21/09/2026",
  "the current time complexity is bad",
  "i use google chrome every day",
  "search your heart",
  "let's find a better approach",
  "can you help me plan my week?",
  "write me a poem about rain",
  "explain how mmr reranking works",
  "should i raise a seed round?",
  "summarize this document for me",
  "what do you think about remote work?",
];

const SOURCE = readFileSync(
  path.join(process.cwd(), "lib", "agent", "gate.ts"),
  "utf8"
);

describe("agent gate - tool-ish messages are offered to the agent", () => {
  for (const [message, category] of AGENT_CASES) {
    it("classifies as " + category + ": " + JSON.stringify(message), () => {
      expect(classifyIntentCategory(message)).toBe(category);
      expect(classifyIntent(message)).toBe("agent");
    });
  }
});

describe("agent gate - everything else stays on the chat path", () => {
  for (const message of CHAT_CASES) {
    it("classifies as chat: " + JSON.stringify(message), () => {
      expect(classifyIntentCategory(message)).toBe("none");
      expect(classifyIntent(message)).toBe("chat");
    });
  }
});

describe("agent gate - identity questions are deliberately left to chat", () => {
  it("does not offer tools for questions the injected context already answers", () => {
    const identityQuestions = [
      "what is my name?",
      "what's my city?",
      "do you know my name?",
      "who am i?",
      "what color do i like?",
    ];

    for (const message of identityQuestions) {
      expect(classifyIntent(message)).toBe("chat");
    }
  });
});

describe("agent gate - input robustness", () => {
  it("treats non-string input as no intent instead of throwing", () => {
    const rogueValues = [undefined, null, 5, {}, [], true];

    for (const value of rogueValues) {
      expect(classifyIntentCategory(value as unknown as string)).toBe("none");
      expect(classifyIntent(value as unknown as string)).toBe("chat");
    }
  });

  it("accepts a tool-ish message exactly at the length cap", () => {
    const atCap = "what time is it? ".padEnd(MAX_GATE_MESSAGE_LENGTH, "x");

    expect(atCap.length).toBe(MAX_GATE_MESSAGE_LENGTH);
    expect(classifyIntent(atCap)).toBe("agent");
  });

  it("falls back to chat for a message longer than the cap", () => {
    const overCap = "what time is it? ".padEnd(MAX_GATE_MESSAGE_LENGTH + 1, "x");

    expect(classifyIntent(overCap)).toBe("chat");
  });

  it("is case and whitespace insensitive", () => {
    expect(classifyIntent("   WHAT TIME IS IT?   ")).toBe("agent");
    expect(classifyIntent("What   Time\nIs\tIt")).toBe("agent");
  });
});

describe("agent gate - purity", () => {
  it("returns the same answer on repeated calls", () => {
    const samples = ["what time is it?", "2+2", "hello there", "search for news"];

    for (const message of samples) {
      expect(classifyIntentCategory(message)).toBe(
        classifyIntentCategory(message)
      );
    }
  });

  it("classifies identically whatever the feature flags say", () => {
    const samples = [...AGENT_CASES.map(([message]) => message), ...CHAT_CASES];
    const baseline = samples.map((message) => classifyIntentCategory(message));

    process.env.ENABLE_AGENT_LOOP = "true";
    process.env.ENABLE_TOOL_USE = "true";

    expect(samples.map((message) => classifyIntentCategory(message))).toEqual(
      baseline
    );
  });

  it("imports nothing at all", () => {
    const importLines = SOURCE.split("\n").filter((line) =>
      line.trimStart().startsWith("import ")
    );

    expect(importLines).toEqual([]);
  });

  it("never reads the environment, the clock, or randomness", () => {
    const forbidden = [
      "process.env",
      "Date.now",
      "new Date",
      "Math.random",
      "setTimeout",
      "fetch(",
    ];

    for (const token of forbidden) {
      expect(SOURCE.includes(token)).toBe(false);
    }
  });
});