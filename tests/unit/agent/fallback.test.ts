/** Unit tests for lib/agent/fallback.
 *
 * Verifies the fallback module is pure, side-effect free, never throws, and
 * always returns a valid AgentOutcome with kind "fallback".
 * No production code is touched by these tests; they only exercise the new
 * fallback module, which is itself not wired into the chat route.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_FALLBACK_REASON,
  FALLBACK_REASONS,
  createFallback,
  fallbackFromError,
  isFallbackOutcome,
  isFallbackReason,
  normalizeFallbackReason,
  sanitizeFallbackTrace,
} from "@/lib/agent/fallback";

const SOURCE = readFileSync(
  path.join(process.cwd(), "lib", "agent", "fallback.ts"),
  "utf8",
);

function makeStep(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { step: 1, phase: "think", durationMs: 5, ...overrides };
}

describe("fallback - reason constants", () => {
  it("lists every declared reason exactly once", () => {
    expect([...FALLBACK_REASONS].sort()).toEqual(
      [
        "budget_exhausted",
        "flags_disabled",
        "gate_chat",
        "provider_error",
        "unexpected_error",
      ].sort(),
    );
  });

  it("defaults to unexpected_error", () => {
    expect(DEFAULT_FALLBACK_REASON).toBe("unexpected_error");
  });

  it("is frozen", () => {
    expect(Object.isFrozen(FALLBACK_REASONS)).toBe(true);
  });
});

describe("fallback - isFallbackReason", () => {
  it.each([
    ["flags_disabled", true],
    ["gate_chat", true],
    ["provider_error", true],
    ["budget_exhausted", true],
    ["unexpected_error", true],
    ["answered", false],
    ["fallback", false],
    ["", false],
    ["FLAGS_DISABLED", false],
    [" flags_disabled ", false],
    [undefined, false],
    [null, false],
    [5, false],
    [{}, false],
    [[], false],
    [true, false],
  ])("validates %p as %p", (input, expected) => {
    expect(isFallbackReason(input)).toBe(expected);
  });

  it("never throws, for any input", () => {
    const nasty: unknown[] = [
      undefined,
      null,
      5,
      Number.NaN,
      {},
      [],
      true,
      "",
      "flags_disabled",
      Object.create(null),
    ];

    for (const value of nasty) {
      expect(() => isFallbackReason(value)).not.toThrow();
    }
  });
});

describe("fallback - normalizeFallbackReason", () => {
  it("passes every declared reason through unchanged", () => {
    for (const reason of FALLBACK_REASONS) {
      expect(normalizeFallbackReason(reason)).toBe(reason);
    }
  });

  it("maps anything unusable to unexpected_error", () => {
    const bad: unknown[] = [
      undefined,
      null,
      "",
      "   ",
      "FLAGS_DISABLED",
      " flags_disabled ",
      "answered",
      "fallback",
      "provider error",
      0,
      5,
      true,
      false,
      {},
      [],
    ];

    for (const value of bad) {
      expect(normalizeFallbackReason(value)).toBe("unexpected_error");
    }
  });
});

describe("fallback - sanitizeFallbackTrace", () => {
  it("returns [] for non-array input", () => {
    expect(sanitizeFallbackTrace(undefined)).toEqual([]);
    expect(sanitizeFallbackTrace(null)).toEqual([]);
    expect(sanitizeFallbackTrace("trace")).toEqual([]);
    expect(sanitizeFallbackTrace(5)).toEqual([]);
    expect(sanitizeFallbackTrace({})).toEqual([]);
  });

  it("copies entries into a fresh array and never mutates the input", () => {
    const first = makeStep();
    const second = makeStep({ step: 2, phase: "act" });
    const input = [first, second];
    const before = JSON.stringify(input);

    const result = sanitizeFallbackTrace(input);

    expect(result).toEqual([first, second]);
    expect(result).not.toBe(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("drops non-object entries instead of passing them through", () => {
    const step = makeStep();

    expect(
      sanitizeFallbackTrace([step, undefined, null, 5, "x", true]),
    ).toEqual([step]);
  });
});

describe("fallback - createFallback", () => {
  it("returns a fallback for every loop failure class", () => {
    for (const reason of FALLBACK_REASONS) {
      const outcome = createFallback(reason, [makeStep()]);

      expect(outcome).toEqual({
        kind: "fallback",
        reason,
        trace: [makeStep()],
      });
    }
  });

  it("defaults a missing trace to []", () => {
    expect(createFallback("gate_chat")).toEqual({
      kind: "fallback",
      reason: "gate_chat",
      trace: [],
    });
  });

  it("normalizes an unusable reason or trace", () => {
    expect(createFallback(undefined, [])).toEqual({
      kind: "fallback",
      reason: "unexpected_error",
      trace: [],
    });
    expect(createFallback("provider_error", "trace")).toEqual({
      kind: "fallback",
      reason: "provider_error",
      trace: [],
    });
  });

  it("copies the trace so caller mutation cannot change the outcome", () => {
    const input = [makeStep()];
    const outcome = createFallback("budget_exhausted", input);

    expect(outcome.trace).not.toBe(input);

    input.push(makeStep({ step: 2 }));

    expect(outcome.trace).toEqual([makeStep()]);
  });

  it("never throws, for any input", () => {
    const nasty: unknown[] = [
      undefined,
      null,
      5,
      Number.NaN,
      {},
      [],
      "",
      Object.create(null),
    ];

    for (const reason of nasty) {
      for (const trace of nasty) {
        let outcome = null as unknown;

        expect(() => {
          outcome = createFallback(reason, trace);
        }).not.toThrow();


describe("fallback - fallbackFromError", () => {
  it("maps a caught error to a fallback with the default reason", () => {
    const outcome = fallbackFromError(new Error("boom"), [makeStep()]);

    expect(outcome).toEqual({
      kind: "fallback",
      reason: "unexpected_error",
      trace: [makeStep()],
    });
  });

  it("honours an explicit known reason", () => {
    const outcome = fallbackFromError(new Error("boom"), [], "provider_error");

    expect(outcome).toEqual({
      kind: "fallback",
      reason: "provider_error",
      trace: [],
    });
  });

  it("drops error content: the outcome carries no error text", () => {
    const secret = "secret-user-content-12345";
    const outcome = fallbackFromError(new Error(secret), []);

    expect(JSON.stringify(outcome).includes(secret)).toBe(false);
    expect(fallbackFromError(secret, []).reason).toBe("unexpected_error");
  });

  it("never throws, for any input", () => {
    const nasty: unknown[] = [
      undefined,
      null,
      5,
      Number.NaN,
      {},
      [],
      "",
      Object.create(null),
      new Error("boom"),
      new TypeError("bad"),
    ];

    for (const error of nasty) {
      let outcome: unknown = null;

      expect(() => {
        outcome = fallbackFromError(error, error, error);
      }).not.toThrow();

      expect(isFallbackOutcome(outcome)).toBe(true);
    }
  });
});

describe("fallback - isFallbackOutcome", () => {
  it("accepts a valid fallback outcome", () => {
    expect(
      isFallbackOutcome({ kind: "fallback", reason: "gate_chat", trace: [] }),
    ).toBe(true);
  });

  it("rejects answered outcomes and malformed values", () => {
    expect(
      isFallbackOutcome({ kind: "answered", response: "hi", trace: [] }),
    ).toBe(false);
    expect(
      isFallbackOutcome({ kind: "fallback", reason: "nope", trace: [] }),
    ).toBe(false);
    expect(isFallbackOutcome({ kind: "fallback", trace: [] })).toBe(false);
    expect(isFallbackOutcome(undefined)).toBe(false);
    expect(isFallbackOutcome(null)).toBe(false);
    expect(isFallbackOutcome([])).toBe(false);
  });

  it("never throws, for any input", () => {
    const nasty: unknown[] = [
      undefined,
      null,
      5,
      "",
      [],
      {},
      Object.create(null),
      { kind: "fallback" },
    ];

    for (const value of nasty) {
      expect(() => isFallbackOutcome(value)).not.toThrow();
    }
  });
});

describe("fallback - purity", () => {
  it("imports types only, so it has no runtime dependencies", () => {
    const importLines = SOURCE.split("\n").filter((line) =>
      line.trimStart().startsWith("import "),
    );

    expect(importLines.length).toBe(1);
    expect(importLines[0].trimStart().startsWith("import type ")).toBe(true);
  });

  it("never reads env, clock, randomness, timers, or I/O", () => {
    const forbidden = [
      "process.env",
      "Date.now",
      "new Date",
      "Math.random",
      "setTimeout",
      "setInterval",
      "fetch(",
      "console.",
    ];

    for (const token of forbidden) {
      expect(SOURCE.includes(token)).toBe(false);
    }
  });

  it("is deterministic for the same inputs", () => {
    const first = createFallback("provider_error", [makeStep()]);
    const second = createFallback("provider_error", [makeStep()]);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.trace).not.toBe(second.trace);
  });
});
        expect(isFallbackOutcome(outcome)).toBe(true);
      }
    }
  });
});
