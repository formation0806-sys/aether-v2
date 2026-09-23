import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  checkLoopDeadline,
  checkToolTimeout,
  checkTurnLimit,
  createTurnBudget,
  remainingTimeMs,
  remainingTurns,
} from "@/lib/agent/budget";
import type { BudgetDecision, TurnBudget } from "@/lib/agent/budget";

const BUDGET_ENV_KEYS = [
  "AGENT_MAX_TOOL_TURNS",
  "AGENT_LOOP_DEADLINE_MS",
  "AGENT_TOOL_TIMEOUT_MS",
];

function clearBudgetEnvKeys(): void {
  for (const key of BUDGET_ENV_KEYS) {
    delete process.env[key];
  }
}

beforeEach(clearBudgetEnvKeys);
afterEach(clearBudgetEnvKeys);

describe("createTurnBudget - reads numeric flags", () => {
  it("uses documented defaults when no flags are set", () => {
    const budget = createTurnBudget();
    expect(budget.maxToolTurns).toBe(4);
    expect(budget.loopDeadlineMs).toBe(45_000);
    expect(budget.toolTimeoutMs).toBe(10_000);
  });

  it("reads custom values when flags are set", () => {
    process.env.AGENT_MAX_TOOL_TURNS = "7";
    process.env.AGENT_LOOP_DEADLINE_MS = "60000";
    process.env.AGENT_TOOL_TIMEOUT_MS = "15000";
    const budget = createTurnBudget();
    expect(budget.maxToolTurns).toBe(7);
    expect(budget.loopDeadlineMs).toBe(60_000);
    expect(budget.toolTimeoutMs).toBe(15_000);
  });

  it("falls back to defaults for invalid numeric flag values", () => {
    process.env.AGENT_MAX_TOOL_TURNS = "0";
    process.env.AGENT_LOOP_DEADLINE_MS = "-1";
    process.env.AGENT_TOOL_TIMEOUT_MS = "abc";
    const budget = createTurnBudget();
    expect(budget.maxToolTurns).toBe(4);
    expect(budget.loopDeadlineMs).toBe(45_000);
    expect(budget.toolTimeoutMs).toBe(10_000);
  });

  it("returns a frozen (readonly) budget object", () => {
    const budget = createTurnBudget();
    // @ts-expect-error - intentional mutation attempt for test
    expect(() => { budget.maxToolTurns = 99; }).toThrow();
  });
});

describe("checkTurnLimit - pure turn limit check", () => {
  function check(currentTurn: number, maxTurns: number): BudgetDecision {
    return checkTurnLimit(currentTurn, { maxToolTurns: maxTurns });
  }
  it("allows when under the limit", () => {
    expect(check(0, 4)).toEqual({ decision: "allowed" });
    expect(check(1, 4)).toEqual({ decision: "allowed" });
    expect(check(2, 4)).toEqual({ decision: "allowed" });
    expect(check(3, 4)).toEqual({ decision: "allowed" });
  });
  it("exhausts exactly at the limit", () => {
    expect(check(4, 4)).toEqual({ decision: "exhausted", reason: "turn_limit" });
  });
  it("exhausts past the limit", () => {
    expect(check(5, 4)).toEqual({ decision: "exhausted", reason: "turn_limit" });
    expect(check(10, 4)).toEqual({ decision: "exhausted", reason: "turn_limit" });
  });
  it("starts counting from 0 (first turn is turn 0)", () => {
    expect(check(0, 1)).toEqual({ decision: "allowed" });
    expect(check(1, 1)).toEqual({ decision: "exhausted", reason: "turn_limit" });
  });
  it("is pure - same inputs always return same result", () => {
    const first = check(2, 4);
    const second = check(2, 4);
    expect(first).toEqual(second);
    expect(first).toEqual({ decision: "allowed" });
  });
});

describe("checkLoopDeadline - pure deadline check", () => {
  function check(deadlineMs: number, elapsedMs: number): BudgetDecision {
    return checkLoopDeadline(deadlineMs, elapsedMs);
  }
  it("allows when under the deadline", () => {
    expect(check(5000, 1000)).toEqual({ decision: "allowed" });
    expect(check(5000, 4999)).toEqual({ decision: "allowed" });
  });
  it("exhausts exactly at the deadline", () => {
    expect(check(5000, 5000)).toEqual({ decision: "exhausted", reason: "deadline" });
  });
  it("exhausts past the deadline", () => {
    expect(check(5000, 5001)).toEqual({ decision: "exhausted", reason: "deadline" });
    expect(check(5000, 10000)).toEqual({ decision: "exhausted", reason: "deadline" });
  });
  it("handles zero deadline (immediate exhaustion)", () => {
    expect(check(0, 0)).toEqual({ decision: "exhausted", reason: "deadline" });
    expect(check(0, 1)).toEqual({ decision: "exhausted", reason: "deadline" });
  });
  it("is pure - same inputs always return same result", () => {
    const first = check(5000, 2000);
    const second = check(5000, 2000);
    expect(first).toEqual(second);
    expect(first).toEqual({ decision: "allowed" });
  });
});

describe("checkToolTimeout - pure per-tool timeout check", () => {
  function check(timeoutMs: number, elapsedMs: number): BudgetDecision {
    return checkToolTimeout(timeoutMs, elapsedMs);
  }
  it("allows when under the timeout", () => {
    expect(check(10000, 1000)).toEqual({ decision: "allowed" });
    expect(check(10000, 9999)).toEqual({ decision: "allowed" });
  });
  it("exhausts exactly at the timeout", () => {
    expect(check(10000, 10000)).toEqual({ decision: "exhausted", reason: "tool_timeout" });
  });
  it("exhausts past the timeout", () => {
    expect(check(10000, 10001)).toEqual({ decision: "exhausted", reason: "tool_timeout" });
    expect(check(10000, 15000)).toEqual({ decision: "exhausted", reason: "tool_timeout" });
  });
  it("handles zero timeout (immediate exhaustion)", () => {
    expect(check(0, 0)).toEqual({ decision: "exhausted", reason: "tool_timeout" });
    expect(check(0, 1)).toEqual({ decision: "exhausted", reason: "tool_timeout" });
  });
  it("is pure - same inputs always return same result", () => {
    const first = check(10000, 5000);
    const second = check(10000, 5000);
    expect(first).toEqual(second);
    expect(first).toEqual({ decision: "allowed" });
  });
});

describe("remainingTurns - pure remaining count", () => {
  function remaining(currentTurn: number, maxTurns: number): number {
    return remainingTurns(currentTurn, { maxToolTurns: maxTurns });
  }
  it("returns correct remaining count", () => {
    expect(remaining(0, 4)).toBe(4);
    expect(remaining(1, 4)).toBe(3);
    expect(remaining(2, 4)).toBe(2);
    expect(remaining(3, 4)).toBe(1);
    expect(remaining(4, 4)).toBe(0);
  });
  it("never returns negative (clamped at zero)", () => {
    expect(remaining(5, 4)).toBe(0);
    expect(remaining(10, 4)).toBe(0);
  });
  it("works with different max values", () => {
    expect(remaining(0, 1)).toBe(1);
    expect(remaining(1, 1)).toBe(0);
    expect(remaining(0, 10)).toBe(10);
  });
  it("is pure - same inputs always return same result", () => {
    const first = remaining(2, 4);
    const second = remaining(2, 4);
    expect(first).toBe(second);
    expect(first).toBe(2);
  });
});

describe("remainingTimeMs - pure remaining time", () => {
  function remaining(deadlineMs: number, elapsedMs: number): number {
    return remainingTimeMs(deadlineMs, elapsedMs);
  }
  it("returns correct remaining time", () => {
    expect(remaining(5000, 0)).toBe(5000);
    expect(remaining(5000, 1000)).toBe(4000);
    expect(remaining(5000, 2500)).toBe(2500);
    expect(remaining(5000, 5000)).toBe(0);
  });
  it("never returns negative (clamped at zero)", () => {
    expect(remaining(5000, 5001)).toBe(0);
    expect(remaining(5000, 10000)).toBe(0);
  });
  it("handles zero values", () => {
    expect(remaining(0, 0)).toBe(0);
    expect(remaining(100, 0)).toBe(100);
    expect(remaining(0, 100)).toBe(0);
  });
  it("is pure - same inputs always return same result", () => {
    const first = remaining(5000, 2000);
    const second = remaining(5000, 2000);
    expect(first).toBe(second);
    expect(first).toBe(3000);
  });
});

describe("budget module is pure and side-effect free", () => {
  it("checkTurnLimit does not mutate inputs", () => {
    const budget = { maxToolTurns: 4 };
    const original = { ...budget };
    checkTurnLimit(2, budget);
    expect(budget).toEqual(original);
  });
  it("checkLoopDeadline does not mutate inputs", () => {
    const deadline = 5000;
    const elapsed = 1000;
    checkLoopDeadline(deadline, elapsed);
    expect(deadline).toBe(5000);
    expect(elapsed).toBe(1000);
  });
  it("checkToolTimeout does not mutate inputs", () => {
    const timeout = 10000;
    const elapsed = 5000;
    checkToolTimeout(timeout, elapsed);
    expect(timeout).toBe(10000);
    expect(elapsed).toBe(5000);
  });
  it("remainingTurns does not mutate inputs", () => {
    const currentTurn = 2;
    const budget = { maxToolTurns: 4 };
    const original = { ...budget };
    remainingTurns(currentTurn, budget);
    expect(budget).toEqual(original);
    expect(currentTurn).toBe(2);
  });
  it("remainingTimeMs does not mutate inputs", () => {
    const deadline = 5000;
    const elapsed = 1000;
    remainingTimeMs(deadline, elapsed);
    expect(deadline).toBe(5000);
    expect(elapsed).toBe(1000);
  });
  it("createTurnBudget reads env but does not mutate it", () => {
    process.env.AGENT_MAX_TOOL_TURNS = "7";
    const before = process.env.AGENT_MAX_TOOL_TURNS;
    createTurnBudget();
    expect(process.env.AGENT_MAX_TOOL_TURNS).toBe(before);
  });
});

describe("budget decision discrimination", () => {
  it("distinguishes between exhausted reasons", () => {
    const turnLimit = checkTurnLimit(4, { maxToolTurns: 4 });
    const deadline = checkLoopDeadline(5000, 5000);
    const toolTimeout = checkToolTimeout(10000, 10000);
    expect(turnLimit).toEqual({ decision: "exhausted", reason: "turn_limit" });
    expect(deadline).toEqual({ decision: "exhausted", reason: "deadline" });
    expect(toolTimeout).toEqual({ decision: "exhausted", reason: "tool_timeout" });
  });
  it("allowed decisions are identical", () => {
    const a = checkTurnLimit(2, { maxToolTurns: 4 });
    const b = checkLoopDeadline(5000, 1000);
    const c = checkToolTimeout(10000, 5000);
    expect(a).toEqual({ decision: "allowed" });
    expect(b).toEqual({ decision: "allowed" });
    expect(c).toEqual({ decision: "allowed" });
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });
});
