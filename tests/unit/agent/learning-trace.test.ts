/**
 * Unit tests for the continual-learning trace gate and combined turn
 * classification (Priority 5).
 *
 * The gate reads only the content-free agent trace, so these tests work with
 * `{ phase, tool, ok }` steps and never touch a provider, a tool, or the
 * database.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_LEARNING_TRACE_STEPS,
  classifyLearningSignals,
  classifyToolOutcome,
  dominantToolName,
  hasLearningSignal,
} from "@/lib/agent/learning/gate";

/** A trace entry as the agent trace records it. */
function toolStep(phase: string, ok: boolean, tool?: string) {
  return { phase, ok, ...(tool === undefined ? {} : { tool }) };
}

describe("learning gate - trace tool outcome", () => {
  it("reads a failing act step as a failure", () => {
    expect(classifyToolOutcome([toolStep("act", false, "calculator")])).toBe(
      "tool_failure",
    );
  });

  it("reads a successful act step as a success", () => {
    expect(classifyToolOutcome([toolStep("act", true, "calculator")])).toBe(
      "tool_success",
    );
  });

  it("reads an observe failure as a failure too", () => {
    expect(classifyToolOutcome([toolStep("observe", false)])).toBe(
      "tool_failure",
    );
  });

  it("lets one failure dominate successes in the same turn", () => {
    expect(
      classifyToolOutcome([
        toolStep("act", true, "current_time"),
        toolStep("observe", true, "current_time"),
        toolStep("act", false, "calculator"),
      ]),
    ).toBe("tool_failure");
  });

  it.each([
    ["empty trace", []],
    ["planning-only trace", [{ phase: "think", durationMs: 5 }]],
    ["act step without ok", [{ phase: "act", tool: "calculator" }]],
    ["non-boolean ok", [{ phase: "act", ok: "yes" }]],
    ["non-array trace", { phase: "act", ok: true }],
    ["string trace", "act"],
    ["null trace", null],
    ["undefined trace", undefined],
  ])("returns null for %s", (_label, trace) => {
    expect(classifyToolOutcome(trace)).toBeNull();
  });

  it("bounds the number of steps it scans", () => {
    const successes = Array.from(
      { length: MAX_LEARNING_TRACE_STEPS },
      () => toolStep("act", true),
    );
    const beyondCap = [...successes, toolStep("act", false)];

    expect(beyondCap.length).toBe(MAX_LEARNING_TRACE_STEPS + 1);
    expect(classifyToolOutcome(beyondCap)).toBe("tool_success");

    const failureInside = [...successes.slice(1), toolStep("act", false)];

    expect(classifyToolOutcome(failureInside)).toBe("tool_failure");
  });

  it("derives the dominant tool name, failure first", () => {
    expect(
      dominantToolName([
        toolStep("act", true, "current_time"),
        toolStep("act", false, "memory_search"),
      ]),
    ).toBe("memory_search");
    expect(dominantToolName([toolStep("act", true, "current_time")])).toBe(
      "current_time",
    );
    expect(dominantToolName([toolStep("act", true)])).toBeNull();
    expect(dominantToolName([toolStep("act", true, "   ")])).toBeNull();
    expect(dominantToolName(null)).toBeNull();
  });

  it("caps a long tool name", () => {
    const name = dominantToolName([toolStep("act", true, "x".repeat(500))]);

    expect(typeof name).toBe("string");
    expect((name ?? "").length).toBeLessThanOrEqual(64);
  });
});

describe("learning gate - combined turn signals", () => {
  it("returns the user signal then the tool signal", () => {
    expect(
      classifyLearningSignals({
        message: "no, that's wrong",
        trace: [toolStep("act", false, "calculator")],
      }),
    ).toEqual(["user_correction", "tool_failure"]);
  });

  it("returns at most one signal per kind", () => {
    const kinds = classifyLearningSignals({
      message: "perfect",
      trace: [toolStep("act", true), toolStep("observe", true)],
    });

    expect(kinds).toEqual(["explicit_positive_feedback", "tool_success"]);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it("accepts a trace-only turn with no usable message", () => {
    expect(
      classifyLearningSignals({ message: "", trace: [toolStep("act", true)] }),
    ).toEqual(["tool_success"]);
  });

  it("returns an empty array when nothing is signalled", () => {
    expect(
      classifyLearningSignals({ message: "how are you", trace: [] }),
    ).toEqual([]);
    expect(classifyLearningSignals({})).toEqual([]);
  });

  it("hasLearningSignal mirrors the classifier", () => {
    expect(hasLearningSignal({ message: "exactly" })).toBe(true);
    expect(
      hasLearningSignal({ trace: [toolStep("act", false, "calculator")] }),
    ).toBe(true);
    expect(hasLearningSignal({ message: "hello" })).toBe(false);
  });

  it("never throws for a hostile trace entry", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("x");
        },
      },
    );

    expect(() => classifyToolOutcome([hostile])).not.toThrow();
    expect(classifyToolOutcome([hostile])).toBeNull();
    expect(() => classifyLearningSignals(hostile)).not.toThrow();
    expect(classifyLearningSignals(hostile)).toEqual([]);
  });

  it("is deterministic for identical input", () => {
    const input = {
      message: "no, that's wrong",
      trace: [toolStep("act", false, "calculator")],
    };

    expect(classifyLearningSignals(input)).toEqual(
      classifyLearningSignals(input),
    );
    expect(dominantToolName(input.trace)).toBe(dominantToolName(input.trace));
  });
});
