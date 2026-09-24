/**
 * Goal-run transitions: decide / step / resume / stop. Pure; never throws.
 * Imports state helpers from ./index (no cycle: index never imports here).
 */

import {
  MAX_AUTONOMY_FAILURES,
  MAX_AUTONOMY_TURNS,
  createGoalRun,
  isGoalRun,
  latestCheckpoint,
  recordCheckpoint,
} from "./index";
import type { AutonomyStep } from "./index";
import type { AutonomyDecision, GoalRun } from "./types";

/** Sanitizes a count. Never throws. */
function safeCount(value: unknown): number {
  try {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0;
    return Math.max(0, Math.floor(value));
  } catch {
    return 0;
  }
}

/**
 * Decides what the run should do next. completed/stopped -> stop;
 * paused -> pause; failed -> failed; too many failures -> failed;
 * turn budget spent -> pause (resumable); latest checkpoint done -> stop;
 * otherwise continue. Never throws.
 */
export function decideNext(run: GoalRun): AutonomyDecision {
  try {
    if (!isGoalRun(run)) return "stop";
    if (run.status === "completed" || run.status === "stopped") return "stop";
    if (run.status === "paused") return "pause";
    if (run.status === "failed") return "failed";
    if (safeCount(run.failures) >= MAX_AUTONOMY_FAILURES) return "failed";
    if (safeCount(run.turnsUsed) >= MAX_AUTONOMY_TURNS) return "pause";
    const last = latestCheckpoint(run);
    if (
      last !== null &&
      safeCount(last.tasksTotal) > 0 &&
      safeCount(last.tasksDone) >= safeCount(last.tasksTotal)
    ) {
      return "stop";
    }
    return "continue";
  } catch {
    return "stop";
  }
}

/** Applies one turn. New run; input never mutated. Never throws. */
export function stepRun(
  run: GoalRun,
  step: AutonomyStep,
  nowMs: number,
): { run: GoalRun; decision: AutonomyDecision } {
  try {
    if (!isGoalRun(run)) {
      const fresh = createGoalRun("unknown", "goal", safeCount(nowMs));
      return { run: fresh, decision: decideNext(fresh) };
    }
    const at = safeCount(nowMs);
    const source = (step ?? {}) as unknown as Record<string, unknown>;
    const failed = source["failed"] === true;
    const failures = failed ? safeCount(run.failures) + 1 : 0;
    const tasksTotal = safeCount(source["tasksTotal"]);
    const tasksDone = Math.min(safeCount(source["tasksDone"]), tasksTotal);
    let next: GoalRun = {
      ...run,
      turnsUsed: safeCount(run.turnsUsed) + 1,
      failures,
      updatedAtMs: at,
    };
    next = recordCheckpoint(next, { tasksTotal, tasksDone }, at);
    try {
      const points = next.checkpoints.map((point) => ({
        index: point.index,
        tasksTotal: point.tasksTotal,
        tasksDone: point.tasksDone,
        failures: safeCount(failures),
        atMs: point.atMs,
      }));
      next = { ...next, checkpoints: points };
    } catch {
      // Bookkeeping miss is not a runtime failure.
    }
    const decision = decideNext(next);
    if (decision === "failed") {
      return { run: { ...next, status: "failed", updatedAtMs: at }, decision };
    }
    if (decision === "pause") {
      return { run: { ...next, status: "paused", updatedAtMs: at }, decision };
    }
    if (decision === "stop") {
      const last = latestCheckpoint(next);
      const done =
        last !== null &&
        safeCount(last.tasksTotal) > 0 &&
        safeCount(last.tasksDone) >= safeCount(last.tasksTotal);
      return {
        run: { ...next, status: done ? "completed" : next.status, updatedAtMs: at },
        decision,
      };
    }
    return { run: { ...next, status: "active", updatedAtMs: at }, decision };
  } catch {
    const fresh = createGoalRun("unknown", "goal", safeCount(nowMs));
    return { run: fresh, decision: "stop" };
  }
}

/** Resumes a parked/failed run; null when not resumable. Never throws. */
export function resumeRun(existing: unknown, nowMs: number): GoalRun | null {
  try {
    if (!isGoalRun(existing)) return null;
    if (existing.status !== "paused" && existing.status !== "failed") return null;
    const at = safeCount(nowMs);
    return {
      ...existing,
      checkpoints: existing.checkpoints.map((p) => ({ ...p })),
      status: "active",
      failures: existing.status === "failed" ? 0 : safeCount(existing.failures),
      updatedAtMs: at,
    };
  } catch {
    return null;
  }
}

/** Marks a run stopped by request. New run. Never throws. */
export function stopRun(run: GoalRun, nowMs: number): GoalRun {
  try {
    if (!isGoalRun(run)) return createGoalRun("unknown", "goal", safeCount(nowMs));
    return {
      ...run,
      checkpoints: run.checkpoints.map((p) => ({ ...p })),
      status: "stopped",
      updatedAtMs: safeCount(nowMs),
    };
  } catch {
    return createGoalRun("unknown", "goal", 0);
  }
}
