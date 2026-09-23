/** Unit tests for the multi-agent orchestration foundation (Priority 4). */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_ORCHESTRATION_MESSAGE_CHARS,
  isMultiAgentRequest,
} from "@/lib/agent/orchestration/gate";

function readSource(...segments: string[]): string {
  return readFileSync(path.join(process.cwd(), ...segments), "utf8");
}
const GATE_SOURCE = readSource("lib", "agent", "orchestration", "gate.ts");

describe("orchestration gate - multi-part phrasing", () => {
  it.each([
    "compare tea and coffee for focus",
    "give me the pros and cons of remote work",
    "research scooters and then summarize the best one",
    "first outline options, then recommend one, finally list next steps",
    "break this into parts so we can work through each",
    "split this into two tasks and handle each",
    "gather the reviews and combine them into one verdict",
  ])("accepts %j", (message) => {
    expect(isMultiAgentRequest(message)).toBe(true);
  });
});

describe("orchestration gate - ordinary chat rejected", () => {
  it.each([
    "how are you doing today",
    "hello there",
    "thanks, that helps",
    "what is the capital of France",
    "tell me a joke",
    "can you help me",
    "",
    "   ",
  ])("rejects %j", (message) => {
    expect(isMultiAgentRequest(message)).toBe(false);
  });
});

describe("orchestration gate - hard negatives", () => {
  it.each([
    "my name is Prince",
    "what's the time right now",
    "calculate 2 + 2",
    "search the web for news",
    "make a plan to launch my startup",
    "hi there, how are you",
  ])("rejects %j", (message) => {
    expect(isMultiAgentRequest(message)).toBe(false);
  });
});

describe("orchestration gate - input safety", () => {
  it("rejects non-strings", () => {
    expect(isMultiAgentRequest(null)).toBe(false);
    expect(isMultiAgentRequest(undefined)).toBe(false);
    expect(isMultiAgentRequest(42)).toBe(false);
    expect(isMultiAgentRequest({})).toBe(false);
    expect(isMultiAgentRequest([])).toBe(false);
  });
  it("rejects oversized, accepts at cap", () => {
    const long = `compare a and b ${"x".repeat(MAX_ORCHESTRATION_MESSAGE_CHARS)}`;
    expect(isMultiAgentRequest("compare tea and coffee")).toBe(true);
    expect(isMultiAgentRequest(long)).toBe(false);
    const prefix = "compare tea and coffee plus ";
    const exact = `${prefix}${"x".repeat(MAX_ORCHESTRATION_MESSAGE_CHARS - prefix.length)}`;
    expect(exact.length).toBe(MAX_ORCHESTRATION_MESSAGE_CHARS);
    expect(isMultiAgentRequest(exact)).toBe(true);
  });
  it("never throws for adversarial input", () => {
    const hostile = new Proxy({}, { get() { throw new Error("x"); } });
    expect(() => isMultiAgentRequest(hostile)).not.toThrow();
    expect(isMultiAgentRequest(hostile)).toBe(false);
  });
});

describe("orchestration gate - no side effects", () => {
  it("has no provider, tool, or database imports", () => {
    expect(GATE_SOURCE).not.toMatch(/getProvider|AIProvider/);
    expect(GATE_SOURCE).not.toMatch(/ToolRegistry|ToolDefinition/);
    expect(GATE_SOURCE).not.toMatch(/supabase|createClient/);
    expect(GATE_SOURCE).not.toMatch(/process\.env/);
  });
});
