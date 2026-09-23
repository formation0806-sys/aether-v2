import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CALCULATOR_TOOL_NAME,
  MAX_EXPRESSION_LENGTH,
  calculatorTool,
  evaluateExpression,
  formatResult,
} from "@/lib/agent/tools/calculator";
import type { FlagPredicate } from "@/lib/agent/tools/registry";
import { ToolRegistry } from "@/lib/agent/tools/registry";
import type { ToolContext } from "@/lib/agent/tools/types";

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    userId: "user-1",
    conversationId: "conv-1",
    deadline: Number.MAX_SAFE_INTEGER,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function only(...enabledFlags: string[]): FlagPredicate {
  const enabled = new Set<string>(enabledFlags);

  return (flag) => enabled.has(flag);
}

/** Evaluates, failing the test when the expression is rejected. */
function valueOf(expression: string): number {
  const outcome = evaluateExpression(expression);

  if (!outcome.ok) {
    throw new Error(
      "expected a value for " + expression + " but got: " + outcome.reason
    );
  }

  return outcome.value;
}

/** Evaluates, failing the test when the expression is accepted. */
function reasonOf(expression: string): string {
  const outcome = evaluateExpression(expression);

  if (outcome.ok) {
    throw new Error("expected a failure for " + expression);
  }

  return outcome.reason;
}

describe("calculator tool - definition", () => {
  it("declares its identity, gating flag, and a valid timeout", () => {
    expect(calculatorTool.name).toBe(CALCULATOR_TOOL_NAME);
    expect(calculatorTool.name).toBe("calculator");
    expect(calculatorTool.description.length).toBeGreaterThan(0);
    expect(calculatorTool.requiredFlags).toEqual(["ENABLE_TOOL_USE"]);
    expect(calculatorTool.timeoutMs).toBeGreaterThan(0);
  });
});

describe("calculator tool - argument parsing", () => {
  it("requires a non-empty expression string", () => {
    expect(calculatorTool.parseArgs({ expression: "2+2" })).toEqual({
      expression: "2+2",
    });
    expect(calculatorTool.parseArgs({ expression: "  2+2  " })).toEqual({
      expression: "2+2",
    });
    expect(calculatorTool.parseArgs({ expression: "" })).toBeNull();
    expect(calculatorTool.parseArgs({ expression: "   " })).toBeNull();
    expect(calculatorTool.parseArgs({ expression: 5 })).toBeNull();
    expect(calculatorTool.parseArgs({})).toBeNull();
    expect(calculatorTool.parseArgs(undefined)).toBeNull();
    expect(calculatorTool.parseArgs(null)).toBeNull();
    expect(calculatorTool.parseArgs("2+2")).toBeNull();
  });
});

describe("calculator evaluator - arithmetic", () => {
  const VALID: Array<[string, number]> = [
    ["1+1", 2],
    ["2+3*4", 14],
    ["(2+3)*4", 20],
    ["10-3-2", 5],
    ["100/4", 25],
    ["10/4", 2.5],
    ["10%3", 1],
    ["2^10", 1024],
    ["2^3^2", 512],
    ["-5+3", -2],
    ["3*-2", -6],
    ["-(2+3)", -5],
    ["+7", 7],
    ["((1+2)*(3+4))", 21],
    [" 2 + 3 ", 5],
    ["2\n+\n3", 5],
    ["5.", 5],
    [".5+.5", 1],
    ["1++2", 3],
    ["0.1+0.2", 0.3],
    ["1/3", 0.3333333333333333],
  ];

  for (const [expression, expected] of VALID) {
    it("evaluates " + JSON.stringify(expression), () => {
      expect(valueOf(expression)).toBeCloseTo(expected, 10);
    });
  }

  it("keeps the power operator right-associative", () => {
    expect(valueOf("2^3^2")).toBe(512);
  });

  it("produces negative zero for 0*-1, which formatting collapses", () => {
    const outcome = evaluateExpression("0*-1");

    expect(outcome.ok).toBe(true);

    if (!outcome.ok) throw new Error("expected a value");

    expect(Object.is(outcome.value, -0)).toBe(true);
    expect(formatResult(outcome.value)).toBe("0");
  });

  it("handles a long but bounded chain", () => {
    expect(valueOf("1+".repeat(50) + "1")).toBe(51);
  });

  it("accepts nesting exactly at the depth cap", () => {
    const depth = 32;

    expect(valueOf("(".repeat(depth) + "1" + ")".repeat(depth))).toBe(1);
  });
});

describe("calculator evaluator - rejections", () => {
  const INVALID: Array<[string, string]> = [
    ["", "empty"],
    ["   ", "empty"],
    ["(1+2", "unbalanced parentheses"],
    ["1+2)", "unexpected character"],
    ["1+", "expected a number"],
    ["*2", "expected a number"],
    ["2a", "unexpected character"],
    ["1/0", "division by zero"],
    ["5%0", "division by zero"],
    ["1.2.3", "unexpected character"],
    ["2^^3", "expected a number"],
    ["(", "expected a number"],
    ["1+(", "expected a number"],
    ["()", "expected a number"],
    ["-", "expected a number"],
    ["9^9999", "not a finite number"],
  ];

  for (const [expression, expectedReason] of INVALID) {
    it("rejects " + JSON.stringify(expression), () => {
      expect(reasonOf(expression)).toContain(expectedReason);
    });
  }

  it("rejects an expression longer than the cap", () => {
    expect(reasonOf("1".repeat(MAX_EXPRESSION_LENGTH + 1))).toContain(
      "longer than"
    );
  });

  it("accepts an expression exactly at the length cap", () => {
    expect(Number.isFinite(valueOf("1".repeat(MAX_EXPRESSION_LENGTH)))).toBe(
      true
    );
  });

  it("rejects nesting beyond the depth cap instead of overflowing", () => {
    const depth = 40;

    expect(
      reasonOf("(".repeat(depth) + "1" + ")".repeat(depth))
    ).toContain("too deeply nested");
  });
});

describe("calculator evaluator - result formatting", () => {
  it("removes floating point noise", () => {
    expect(formatResult(0.1 + 0.2)).toBe("0.3");
  });

  it("keeps 12 significant digits", () => {
    expect(formatResult(1 / 3)).toBe("0.333333333333");
    expect(formatResult(Math.SQRT2)).toBe("1.41421356237");
  });

  it("keeps integers that fit inside 12 significant digits", () => {
    expect(formatResult(123456789012)).toBe("123456789012");
  });

  it("rounds beyond 12 significant digits", () => {
    expect(formatResult(2 ** 50)).toBe("1125899906840000");
  });

  it("collapses negative zero", () => {
    expect(formatResult(-0)).toBe("0");
  });
});

describe("calculator tool - execution", () => {
  it("returns a plain observation for a valid expression", async () => {
    const result = await calculatorTool.execute(
      { expression: "2+2" },
      makeContext()
    );

    expect(result.ok).toBe(true);
    expect(result.observation).toBe("2+2 = 4");
  });

  it("formats a fractional result readably", async () => {
    const result = await calculatorTool.execute(
      { expression: "2^0.5" },
      makeContext()
    );

    expect(result.ok).toBe(true);
    expect(result.observation).toBe("2^0.5 = 1.41421356237");
  });

  it("prefixes evaluation failures with CALCULATOR_ERROR", async () => {
    const result = await calculatorTool.execute(
      { expression: "1/0" },
      makeContext()
    );

    expect(result.ok).toBe(false);
    expect(result.observation.startsWith("CALCULATOR_ERROR:")).toBe(true);
    expect(result.observation).toContain("division by zero");
  });

  it("reports the length cap through the tool", async () => {
    const result = await calculatorTool.execute(
      { expression: "1".repeat(MAX_EXPRESSION_LENGTH + 1) },
      makeContext()
    );

    expect(result.ok).toBe(false);
    expect(result.observation).toContain("longer than");
  });

  it("never throws, for any input", async () => {
    const nastyExpressions = [
      "",
      "   ",
      "1/0",
      "(((((",
      "1".repeat(500),
      "9^9999",
      "2a",
      ".",
      "'",
      "1,2",
      "1;2",
      "\u0000",
      "\u{1F600}",
      "-",
      "()",
      "1 2",
    ];

    for (const expression of nastyExpressions) {
      const result = await calculatorTool.execute(
        { expression },
        makeContext()
      );

      expect(result.ok).toBe(false);
      expect(result.observation.length).toBeGreaterThan(0);
    }
  });

  it("refuses to run once the turn is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await calculatorTool.execute(
      { expression: "2+2" },
      makeContext({ signal: controller.signal })
    );

    expect(result.ok).toBe(false);
    expect(result.observation).toContain("TOOL_ABORTED");
  });

  it("reports telemetry without content", async () => {
    const result = await calculatorTool.execute(
      { expression: "2+2" },
      makeContext()
    );

    expect(result.meta?.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("calculator tool - safety", () => {
  it("contains no eval and no Function constructor", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib", "agent", "tools", "calculator.ts"),
      "utf8"
    );

    expect(source).not.toMatch(/eval\s*\(/);
    expect(source).not.toMatch(/Function\s*\(/);
  });
});

describe("calculator tool - registered through the tool registry", () => {
  it("registers and stays callable when ENABLE_TOOL_USE is enabled", async () => {
    const registry = new ToolRegistry(only("ENABLE_TOOL_USE"));

    expect(registry.register(calculatorTool)).toBe(true);
    expect(registry.has(CALCULATOR_TOOL_NAME)).toBe(true);

    const registered = registry.get(CALCULATOR_TOOL_NAME);

    if (!registered) throw new Error("tool was not registered");

    const result = await registered.execute({ expression: "6*7" }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.observation).toBe("6*7 = 42");
  });

  it("is absent when ENABLE_TOOL_USE is off", () => {
    const registry = new ToolRegistry(only());

    expect(registry.register(calculatorTool)).toBe(false);
    expect(registry.has(CALCULATOR_TOOL_NAME)).toBe(false);
  });
});