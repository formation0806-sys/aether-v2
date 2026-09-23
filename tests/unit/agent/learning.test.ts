/**
 * Unit tests for the continual-learning user-signal gate (Priority 5).
 *
 * The gate is pure and deterministic: no provider, no tools, no database, no
 * flags, no clock. These tests pin the accepted signal set, the rejection set,
 * and the precedence between rules.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LEARNING_SIGNAL_KINDS,
  MAX_LEARNING_MESSAGE_CHARS,
  classifyUserSignal,
  hasLearningSignal,
} from "@/lib/agent/learning/gate";

function readSource(...segments: string[]): string {
  return readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

const GATE_SOURCE = readSource("lib", "agent", "learning", "gate.ts");

describe("learning gate - user correction", () => {
  it.each([
    "no, that's wrong",
    "that's not right",
    "that is incorrect",
    "it's not correct",
    "you're wrong about my job title",
    "that's a wrong answer",
    "that is not what I asked",
    "I said it's Tuesday",
    "actually it's 2024",
    "correct yourself",
  ])("classifies %j as a correction", (message) => {
    expect(classifyUserSignal(message)).toBe("user_correction");
  });
});

describe("learning gate - explicit feedback", () => {
  it.each([
    "that's not helpful",
    "your answer is unhelpful",
    "this response is useless",
    "that was a bad response",
    "that doesn't work",
    "you didn't answer my question",
  ])("classifies %j as negative feedback", (message) => {
    expect(classifyUserSignal(message)).toBe("explicit_negative_feedback");
  });

  it.each([
    "perfect, thanks",
    "exactly",
    "that's right",
    "that is correct",
    "great job",
    "that worked",
    "thanks, that helped",
    "very helpful",
  ])("classifies %j as positive feedback", (message) => {
    expect(classifyUserSignal(message)).toBe("explicit_positive_feedback");
  });
});

describe("learning gate - precedence", () => {
  it("reads a correction before feedback when both match", () => {
    expect(classifyUserSignal("that's wrong and not helpful")).toBe(
      "user_correction",
    );
  });

  it("reads negative feedback before positive feedback", () => {
    expect(classifyUserSignal("not helpful, but thanks")).toBe(
      "explicit_negative_feedback",
    );
  });
});

describe("learning gate - ordinary chat produces no signal", () => {
  it.each([
    "how are you doing today",
    "hello there",
    "thanks, that helps me plan my week",
    "what is the capital of France",
    "tell me a joke",
    "can you help me",
    "my name is Prince",
    "what's the time right now",
    "calculate 2 + 2",
    "search the web for news",
    "make a plan to launch my startup",
    "is that correct?",
    "why is it wrong?",
    "does that work?",
    "",
    "   ",
  ])("produces no signal for %j", (message) => {
    expect(classifyUserSignal(message)).toBeNull();
  });

  it("only ever returns a declared kind", () => {
    expect(LEARNING_SIGNAL_KINDS).toEqual([
      "user_correction",
      "explicit_negative_feedback",
      "explicit_positive_feedback",
      "tool_failure",
      "tool_success",
    ]);

    expect(LEARNING_SIGNAL_KINDS).toContain(classifyUserSignal("exactly"));
  });
});

describe("learning gate - input safety", () => {
  it("rejects non-strings without throwing", () => {
    for (const value of [null, undefined, 42, {}, [], true, () => "x"]) {
      expect(classifyUserSignal(value)).toBeNull();
    }
  });

  it("rejects an oversized message and accepts exactly at the cap", () => {
    const oversized = `that's wrong ${"x".repeat(MAX_LEARNING_MESSAGE_CHARS)}`;

    expect(classifyUserSignal(oversized)).toBeNull();

    const prefix = "that's wrong ";
    const exact = `${prefix}${"x".repeat(
      MAX_LEARNING_MESSAGE_CHARS - prefix.length,
    )}`;

    expect(exact.length).toBe(MAX_LEARNING_MESSAGE_CHARS);
    expect(classifyUserSignal(exact)).toBe("user_correction");
  });

  it("never throws for a hostile message object", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("x");
        },
      },
    );

    expect(() => classifyUserSignal(hostile)).not.toThrow();
    expect(classifyUserSignal(hostile)).toBeNull();
    expect(() => hasLearningSignal(hostile)).not.toThrow();
    expect(hasLearningSignal(hostile)).toBe(false);
  });

  it("is deterministic for identical input", () => {
    const message = "no, that's wrong";

    expect(classifyUserSignal(message)).toBe(classifyUserSignal(message));
  });
});

describe("learning gate source - no side effects", () => {
  it("has no flag, provider, tool, database, clock, or randomness use", () => {
    expect(GATE_SOURCE).not.toMatch(/process\.env/);
    expect(GATE_SOURCE).not.toMatch(/isFeatureEnabled|readNumericFlag/);
    expect(GATE_SOURCE).not.toMatch(/getProvider|AIProvider/);
    expect(GATE_SOURCE).not.toMatch(/supabase|createClient|repositories/);
    expect(GATE_SOURCE).not.toMatch(/Date\.now|Math\.random|new Date\(/);
    expect(GATE_SOURCE).not.toMatch(/console\./);
  });
});
