/**
 * Turn budget controller.
 *
 * Pure, side-effect-free module that reads feature-flag numeric values and exposes
 * budget checks for the planned agent loop (docs/AGENT_LOOP_DESIGN.md).
 *
 * Nothing here is wired into the live chat path yet; this module exists so the
 * budget contract and its tests exist before the runner is implemented.
 *
 * Consumed flags (all numeric, via lib/config/features.ts):
 *   - AGENT_MAX_TOOL_TURNS   -> max turns before forced final answer (default 4)
 *   - AGENT_LOOP_DEADLINE_MS -> total wall-clock budget for one turn (default 45000)
 *   - AGENT_TOOL_TIMEOUT_MS  -> per-tool execution timeout (default 10000)
 *
 * The module is pure: it takes values as arguments and exposes pure functions. No
 * process.env reads, no Date.now calls, no I/O in the hot path - the caller passes
 * the current state.
 */

import {
  readNumericFlag,
} from "@/lib/config/features";

/** Budget constants for one agent turn. */
export interface TurnBudget {
  /** Maximum number of tool-calling turns before a forced final answer. */
  maxToolTurns: number;
  /** Total wall-clock budget in milliseconds for one turn. */
  loopDeadlineMs: number;
  /** Per-tool execution timeout in milliseconds. */
  toolTimeoutMs: number;
}

/**
 * Current turn budget derived from feature flags.
 *
 * Reads the numeric flags once and returns a frozen budget object. The caller is
 * expected to call this at turn start and pass the budget down through the loop.
 */
export function createTurnBudget(): Readonly<TurnBudget> {
  return Object.freeze({
    maxToolTurns: readNumericFlag("AGENT_MAX_TOOL_TURNS"),
    loopDeadlineMs: readNumericFlag("AGENT_LOOP_DEADLINE_MS"),
    toolTimeoutMs: readNumericFlag("AGENT_TOOL_TIMEOUT_MS"),
  });
}

/**
 * Return value from budget check functions.
 *
 * "allowed" means the operation should proceed. "exhausted" means the budget has
 * run out and the loop must stop.
 */
export type BudgetDecision =
  | { decision: "allowed" }
  | { decision: "exhausted"; reason: "turn_limit" | "deadline" | "tool_timeout" };

/**
 * Checks whether another tool turn is allowed.
 *
 * Pure: takes the current turn count and the budget as arguments.
 */
export function checkTurnLimit(
  currentTurn: number,
  budget: Readonly<Pick<TurnBudget, "maxToolTurns">>,
): BudgetDecision {
  if (currentTurn >= budget.maxToolTurns) {
    return { decision: "exhausted", reason: "turn_limit" };
  }

  return { decision: "allowed" };
}

/**
 * Checks whether the loop deadline has been exceeded.
 *
 * Pure: takes the deadline timestamp (from Date.now at turn start) and the elapsed
 * time so far in ms. The caller owns the clock.
 */
export function checkLoopDeadline(
  deadlineTimestampMs: number,
  elapsedMs: number,
): BudgetDecision {
  if (elapsedMs >= deadlineTimestampMs) {
    return { decision: "exhausted", reason: "deadline" };
  }

  return { decision: "allowed" };
}

/**
 * Checks whether a tool execution fits within the per-tool timeout.
 *
 * Pure: takes the timeout and elapsed time for this tool call.
 */
export function checkToolTimeout(
  toolTimeoutMs: number,
  toolElapsedMs: number,
): BudgetDecision {
  if (toolElapsedMs >= toolTimeoutMs) {
    return { decision: "exhausted", reason: "tool_timeout" };
  }

  return { decision: "allowed" };
}

/**
 * Remaining budget after N turns have been used.
 *
 * Pure: returns how many tool turns are still available.
 */
export function remainingTurns(
  currentTurn: number,
  budget: Readonly<Pick<TurnBudget, "maxToolTurns">>,
): number {
  const remaining = budget.maxToolTurns - currentTurn;

  return Math.max(0, remaining);
}

/**
 * Remaining time in the loop deadline in milliseconds.
 *
 * Pure: takes the deadline timestamp and elapsed time.
 */
export function remainingTimeMs(
  deadlineTimestampMs: number,
  elapsedMs: number,
): number {
  const remaining = deadlineTimestampMs - elapsedMs;

  return Math.max(0, remaining);
}