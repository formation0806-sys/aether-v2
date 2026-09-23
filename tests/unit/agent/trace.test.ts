/** Unit tests for lib/agent/trace.

 * Verifies the trace module is pure, content-free, and side-effect free.
 * No production code is touched by these tests; they only exercise the new
 * trace module, which is itself not wired into the chat route.
 */

import { describe, expect, it } from "vitest";

import {
  addStep,
  emptyTrace,
  errorStepCount,
  finalizeTrace,
  hasFailedToolStep,
  isToolPhase,
  lastStepOfPhase,
  phaseRecordsOutcome,
  serializeTrace,
  traceDurationMs,
  TurnTrace,
  isValidPhase,
} from "@/lib/agent/trace";

/** A helper to build a trace with a think step followed by an act step. */
function basicTwoStepTrace(): TurnTrace {
  const trace = emptyTrace();
  const withThink = addStep(trace, "think", 5, { note: "planning" });
  return addStep(withThink, "act", 10, { tool: "calculator", ok: true });
}

describe("trace - emptyTrace", () => {
  it("returns an empty trace", () => {
    expect(emptyTrace()).toEqual({ steps: [] });
  });

  it("returns a new object each call", () => {
    expect(emptyTrace()).not.toBe(emptyTrace());
  });
});

describe("trace - isValidPhase", () => {
  it.each([
    ["think", true],
    ["act", true],
    ["observe", true],
    ["final", true],
    ["error", true],
    ["unknown", false],
    ["", false],
    ["Think", false],
    ["ACT", false],
  ])("validates '%s' as %p", (input, expected) => {
    expect(isValidPhase(input)).toBe(expected);
  });
});

describe("trace - isToolPhase", () => {
  it("returns true for act and observe", () => {
    expect(isToolPhase("act")).toBe(true);
    expect(isToolPhase("observe")).toBe(true);
  });

  it("returns false for other phases", () => {
    expect(isToolPhase("think")).toBe(false);
    expect(isToolPhase("final")).toBe(false);
    expect(isToolPhase("error")).toBe(false);
  });
});

describe("trace - phaseRecordsOutcome", () => {
  it("returns true for act, observe, and error", () => {
    expect(phaseRecordsOutcome("act")).toBe(true);
    expect(phaseRecordsOutcome("observe")).toBe(true);
    expect(phaseRecordsOutcome("error")).toBe(true);
  });

  it("returns false for think and final", () => {
    expect(phaseRecordsOutcome("think")).toBe(false);
    expect(phaseRecordsOutcome("final")).toBe(false);
  });
});

describe("trace - addStep", () => {
  it("adds the first step with step index 1", () => {
    const trace = emptyTrace();
    const next = addStep(trace, "think", 10);

    expect(next.steps).toHaveLength(1);
    expect(next.steps[0]).toEqual({
      step: 1,
      phase: "think",
      durationMs: 10,
    });
  });

  it("increments step index for each added step", () => {
    const first = addStep(emptyTrace(), "think", 5);
    const second = addStep(first, "act", 10, { tool: "calc", ok: true });

    expect(first.steps[0].step).toBe(1);
    expect(second.steps[1].step).toBe(2);
  });

  it("does not mutate the input trace", () => {
    const original = emptyTrace();
    addStep(original, "think", 5);

    expect(original.steps).toHaveLength(0);
  });

  it("records tool name only for tool phases", () => {
    const withToolOnAct = addStep(emptyTrace(), "act", 10, {
      tool: "calculator",
    });
    const withToolOnThink = addStep(emptyTrace(), "think", 10, {
      tool: "calculator",
    });

    expect(withToolOnAct.steps[0].tool).toBe("calculator");
    expect(withToolOnThink.steps[0].tool).toBeUndefined();
  });

  it("records ok only for outcome phases", () => {
    const actOk = addStep(emptyTrace(), "act", 10, { ok: true });
    const thinkOk = addStep(emptyTrace(), "think", 10, { ok: true });
    const errorStep = addStep(emptyTrace(), "error", 10, { ok: false });

    expect(actOk.steps[0].ok).toBe(true);
    expect(thinkOk.steps[0].ok).toBeUndefined();
    expect(errorStep.steps[0].ok).toBe(false);
  });

  it("records note when provided", () => {
    const trace = addStep(emptyTrace(), "think", 10, { note: "planning" });

    expect(trace.steps[0].note).toBe("planning");
  });

  it("accepts invalid phase and falls back to error", () => {
    const trace = addStep(emptyTrace(), "bogus" as unknown as string, 10);

    expect(trace.steps[0].phase).toBe("error");
    expect(trace.steps[0].step).toBe(1);
  });

  it("records durationMs exactly as given", () => {
    const trace = addStep(emptyTrace(), "final", 99);

    expect(trace.steps[0].durationMs).toBe(99);
  });

  it("allows empty opts object", () => {
    const trace = addStep(emptyTrace(), "think", 5, {});

    expect(trace.steps[0]).toEqual({
      step: 1,
      phase: "think",
      durationMs: 5,
    });
  });
});

describe("trace - finalizeTrace", () => {
  it("updates the last step's duration", () => {
    const trace = basicTwoStepTrace();
    const updated = finalizeTrace(trace, 50);

    expect(updated.steps).toHaveLength(2);
    expect(updated.steps[1].durationMs).toBe(50);
  });

  it("does not mutate the input trace", () => {
    const trace = basicTwoStepTrace();
    finalizeTrace(trace, 99);

    expect(trace.steps[1].durationMs).toBe(10);
  });

  it("returns the same trace when empty", () => {
    const trace = emptyTrace();
    const updated = finalizeTrace(trace, 10);

    expect(updated).toEqual({ steps: [] });
  });

  it("preserves all fields except duration on the last step", () => {
    const trace = addStep(
      emptyTrace(),
      "act",
      10,
      { tool: "calc", ok: true, note: "done" },
    );
    const updated = finalizeTrace(trace, 99);

    expect(updated.steps[0].tool).toBe("calc");
    expect(updated.steps[0].ok).toBe(true);
    expect(updated.steps[0].note).toBe("done");
    expect(updated.steps[0].durationMs).toBe(99);
  });
});

describe("trace - traceDurationMs", () => {
  it("returns 0 for an empty trace", () => {
    expect(traceDurationMs(emptyTrace())).toBe(0);
  });

  it("sums step durations", () => {
    const trace = basicTwoStepTrace();

    expect(traceDurationMs(trace)).toBe(15);
  });

  it("handles large values", () => {
    const trace = addStep(emptyTrace(), "think", 1000);
    const next = addStep(trace, "act", 2000, { ok: true });

    expect(traceDurationMs(next)).toBe(3000);
  });
});

describe("trace - errorStepCount", () => {
  it("returns 0 for an empty trace", () => {
    expect(errorStepCount(emptyTrace())).toBe(0);
  });

  it("counts error steps", () => {
    const trace = addStep(
      addStep(emptyTrace(), "think", 5),
      "error",
      10,
    );

    expect(errorStepCount(trace)).toBe(1);
  });

  it("ignores non-error steps", () => {
    const trace = basicTwoStepTrace();

    expect(errorStepCount(trace)).toBe(0);
  });

  it("counts multiple error steps", () => {
    const trace = addStep(
      addStep(
        addStep(emptyTrace(), "error", 1),
        "act",
        2,
        { ok: true },
      ),
      "error",
      3,
    );

    expect(errorStepCount(trace)).toBe(2);
  });
});

describe("trace - hasFailedToolStep", () => {
  it("returns false for an empty trace", () => {
    expect(hasFailedToolStep(emptyTrace())).toBe(false);
  });

  it("returns true when an act step fails", () => {
    const trace = addStep(emptyTrace(), "act", 10, { ok: false });

    expect(hasFailedToolStep(trace)).toBe(true);
  });

  it("returns true when an observe step fails", () => {
    const trace = addStep(
      emptyTrace(),
      "observe",
      10,
      { tool: "memory_search", ok: false },
    );

    expect(hasFailedToolStep(trace)).toBe(true);
  });

  it("returns false when all tool steps succeed", () => {
    const trace = basicTwoStepTrace();

    expect(hasFailedToolStep(trace)).toBe(false);
  });

  it("ignores missing ok on planning steps", () => {
    const trace = addStep(emptyTrace(), "think", 5);

    expect(hasFailedToolStep(trace)).toBe(false);
  });

  it("does not treat ok: true as a failure", () => {
    const trace = addStep(emptyTrace(), "act", 10, { ok: true });

    expect(hasFailedToolStep(trace)).toBe(false);
  });
});

describe("trace - lastStepOfPhase", () => {
  it("returns undefined for an empty trace", () => {
    expect(lastStepOfPhase(emptyTrace(), "act")).toBeUndefined();
  });

  it("returns the last step of the given phase", () => {
    const trace = addStep(
      addStep(
        addStep(emptyTrace(), "think", 1),
        "act",
        2,
        { tool: "a", ok: true },
      ),
      "act",
      3,
      { tool: "b", ok: false },
    );

    const last = lastStepOfPhase(trace, "act");

    expect(last).toEqual({
      step: 3,
      phase: "act",
      tool: "b",
      durationMs: 3,
      ok: false,
    });
  });

  it("returns undefined when the phase is absent", () => {
    const trace = basicTwoStepTrace();

    expect(lastStepOfPhase(trace, "observe")).toBeUndefined();
  });
});

describe("trace - purity and content guarantees", () => {
  it("does not mutate an input trace when chaining addStep calls", () => {
    const t1 = emptyTrace();
    const t2 = addStep(t1, "think", 1);
    const t3 = addStep(t2, "act", 2, { tool: "x", ok: true });

    expect(t1.steps).toHaveLength(0);
    expect(t2.steps).toHaveLength(1);
    expect(t3.steps).toHaveLength(2);
  });

  it("returns a new trace object on every addStep", () => {
    const trace = emptyTrace();
    const next = addStep(trace, "think", 1);

    expect(next).not.toBe(trace);
  });

  it("returns a new trace object on finalizeTrace", () => {
    const trace = basicTwoStepTrace();
    const updated = finalizeTrace(trace, 99);

    expect(updated).not.toBe(trace);
  });

  it("never exposes message or memory content through the public API", () => {
    const trace = addStep(
      emptyTrace(),
      "observe",
      12,
      {
        tool: "memory_search",
        ok: true,
        note: "found something about the user's birthday",
      },
    );

    const serialized = serializeTrace(trace);

    for (const entry of serialized) {
      const keys = Object.keys(entry);
      expect(keys).toContain("step");
      expect(keys).toContain("phase");
      expect(keys).toContain("durationMs");
      expect(keys).not.toContain("message");
      expect(keys).not.toContain("memory");
      expect(keys).not.toContain("text");
      expect(keys).not.toContain("observation");
    }
  });
});

describe("trace - round-trip through serializeTrace", () => {
  it("produces a stable array from an empty trace", () => {
    expect(serializeTrace(emptyTrace())).toEqual([]);
  });

  it("preserves step order", () => {
    const trace = addStep(
      addStep(emptyTrace(), "think", 1),
      "act",
      2,
      { tool: "x", ok: true },
    );
    const serialized = serializeTrace(trace);

    expect(serialized.map((s) => s.step)).toEqual([1, 2]);
    expect(serialized.map((s) => s.phase)).toEqual(["think", "act"]);
  });

  it("omits optional fields when absent", () => {
    const trace = addStep(emptyTrace(), "think", 1);
    const serialized = serializeTrace(trace);

    expect(serialized[0].tool).toBeUndefined();
    expect(serialized[0].ok).toBeUndefined();
    expect(serialized[0].note).toBeUndefined();
  });
});

describe("trace - isToolPhase and phaseRecordsOutcome consistency", () => {
  it("act carries tool and outcome", () => {
    expect(isToolPhase("act")).toBe(true);
    expect(phaseRecordsOutcome("act")).toBe(true);
  });

  it("observe carries tool and outcome", () => {
    expect(isToolPhase("observe")).toBe(true);
    expect(phaseRecordsOutcome("observe")).toBe(true);
  });

  it("think carries neither tool nor outcome", () => {
    expect(isToolPhase("think")).toBe(false);
    expect(phaseRecordsOutcome("think")).toBe(false);
  });

  it("final carries neither tool nor outcome", () => {
    expect(isToolPhase("final")).toBe(false);
    expect(phaseRecordsOutcome("final")).toBe(false);
  });

  it("error carries outcome but no tool", () => {
    expect(isToolPhase("error")).toBe(false);
    expect(phaseRecordsOutcome("error")).toBe(true);
  });
});
