/**
 * Long-horizon autonomy state helpers (Priority L1).
 *
 * Owns in-memory goal-run construction and checkpoint bookkeeping behind
 * ENABLE_LONG_HORIZON. Pure helpers only: no provider call, no tool call,
 * no database read, no database write, no after() scheduling. Transitions
 * (decide/step/resume/stop) live in ./transitions; the flag-gated entry
 * point lives in ./entry. This module never imports either, so there is no
 * import cycle.
 */

import type { FeatureFlag } from "@/lib/config/features";
import type {
  GoalCheckpoint,
  GoalRun,
  GoalRunStatus,
} from "./types";

/** The one flag that gates this capability. Off unless explicitly enabled. */
export const LONG_HORIZON_FLAG: FeatureFlag = "ENABLE_LONG_HORIZON";

/** Upper bound on the goal text carried in a run. */
export const MAX_AUTONOMY_GOAL_CHARS = 200;

/** Turns before a run parks itself (resumable, not failed). */
export const MAX_AUTONOMY_TURNS = 32;

/** Consecutive failures before a run is marked failed (resumable). */
export const MAX_AUTONOMY_FAILURES = 3;

/** Hard cap on checkpoints kept per run. Oldest beyond the cap is dropped. */
export const MAX_AUTONOMY_CHECKPOINTS = 64;

/** Injectable flag predicate. Defaults to the real feature-flag reader. */
export type AutonomyFlagReader = (flag: FeatureFlag) => boolean;

/** Injectable gate. Defaults to the deterministic autonomy classifier. */
export type AutonomyGate = (message: unknown) => boolean;

/** Injectable dependencies. Every field is optional; defaults are production. */
export interface AutonomyDeps {
  /** Defaults to isFeatureEnabled() from the feature flags. */
  isFlagEnabled?: AutonomyFlagReader;
  /** Defaults to isAutonomyRequest(). */
  isAutonomy?: AutonomyGate;
  /** Defaults to Date.now. Injected clocks make tests deterministic. */
  now?: () => number;
}

/** Progress observed in one turn. Counts only, never text. */
export interface AutonomyStep {
  /** Total tasks known after this turn. */
  tasksTotal: number;
  /** Tasks done after this turn. */
  tasksDone: number;
  /** True when this turn failed. */
  failed: boolean;
}

/** Tiny deterministic hash (djb2, hex) so ids are stable without randomness. */
function hashHex(value: string): string {
  try {
    let hash = 5381;
    for (let i = 0; i < value.length; i += 1) {
      hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  } catch {
    return "00000000";
  }
}

/** Builds a stable run id from owner, goal, and clock. Never throws. */
export function createGoalRunId(
  userId: string,
  goal: string,
  nowMs: number,
): string {
  try {
    const safeUser = typeof userId === "string" ? userId : "";
    const safeGoal = typeof goal === "string" ? goal : "";
    const at =
      typeof nowMs === "number" && Number.isFinite(nowMs)
        ? Math.floor(nowMs)
        : 0;
    return `goal-run-${hashHex(`${safeUser}::${safeGoal}::${at}`)}`;
  } catch {
    return "goal-run-00000000";
  }
}

/** Sanitizes a count. Never throws. */
function safeCount(value: unknown): number {
  try {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0;
    return Math.max(0, Math.floor(value));
  } catch {
    return 0;
  }
}
/** Caps goal text. Never throws. */
function toGoal(message: string): string {
  try {
    const trimmed = message.trim();
    if (trimmed.at(MAX_AUTONOMY_GOAL_CHARS) === undefined) return trimmed;
    return trimmed.slice(0, MAX_AUTONOMY_GOAL_CHARS);
  } catch {
    return "";
  }
}

/** True only for the declared run statuses. Never throws. */
export function isGoalRunStatus(value: unknown): value is GoalRunStatus {
  try {
    return (
      value === "active" ||
      value === "paused" ||
      value === "completed" ||
      value === "failed" ||
      value === "stopped"
    );
  } catch {
    return false;
  }
}

/** True when the value is a structurally usable goal run. Never throws. */
export function isGoalRun(value: unknown): value is GoalRun {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const c = value as Record<string, unknown>;
    if (typeof c["id"] !== "string" || c["id"] === "") return false;
    if (typeof c["userId"] !== "string" || c["userId"] === "") return false;
    if (typeof c["goal"] !== "string" || c["goal"] === "") return false;
    if (!isGoalRunStatus(c["status"])) return false;
    if (typeof c["turnsUsed"] !== "number" || !Number.isFinite(c["turnsUsed"])) return false;
    if (typeof c["failures"] !== "number" || !Number.isFinite(c["failures"])) return false;
    if (!Array.isArray(c["checkpoints"])) return false;
    return true;
  } catch {
    return false;
  }
}

/** Creates a fresh run. Pure; never throws; no I/O. */
export function createGoalRun(userId: string, goal: string, nowMs: number): GoalRun {
  try {
    const safeUser = typeof userId === "string" && userId.trim() !== "" ? userId.trim() : "unknown";
    const capped = toGoal(typeof goal === "string" ? goal : "");
    const safeGoal = capped === "" ? "goal" : capped;
    const at = safeCount(nowMs);
    return {
      id: createGoalRunId(safeUser, safeGoal, at),
      userId: safeUser,
      goal: safeGoal,
      status: "active",
      turnsUsed: 0,
      failures: 0,
      checkpoints: [{ index: 1, tasksTotal: 0, tasksDone: 0, failures: 0, atMs: at }],
      createdAtMs: at,
      updatedAtMs: at,
    };
  } catch {
    return {
      id: "goal-run-00000000",
      userId: "unknown",
      goal: "goal",
      status: "active",
      turnsUsed: 0,
      failures: 0,
      checkpoints: [{ index: 1, tasksTotal: 0, tasksDone: 0, failures: 0, atMs: 0 }],
      createdAtMs: 0,
      updatedAtMs: 0,
    };
  }
}

/** Latest checkpoint, or null when the run carries none. Never throws. */
export function latestCheckpoint(run: GoalRun): GoalCheckpoint | null {
  try {
    const points = (run as GoalRun | null | undefined)?.checkpoints;
    if (!Array.isArray(points) || points.length === 0) return null;
    return points[points.length - 1] as GoalCheckpoint;
  } catch {
    return null;
  }
}

/** Records one progress checkpoint. New run; input never mutated. */
export function recordCheckpoint(
  run: GoalRun,
  progress: { tasksTotal?: unknown; tasksDone?: unknown },
  nowMs: number,
): GoalRun {
  try {
    if (!isGoalRun(run)) return createGoalRun("unknown", "goal", safeCount(nowMs));
    const at = safeCount(nowMs);
    const source = (progress ?? {}) as Record<string, unknown>;
    const tasksTotal = safeCount(source["tasksTotal"]);
    const tasksDone = Math.min(safeCount(source["tasksDone"]), tasksTotal);
    const next: GoalCheckpoint = {
      index: run.checkpoints.length + 1,
      tasksTotal,
      tasksDone,
      failures: safeCount(run.failures),
      atMs: at,
    };
    const kept =
      run.checkpoints.length >= MAX_AUTONOMY_CHECKPOINTS
        ? [...run.checkpoints.slice(1), next]
        : [...run.checkpoints, next];
    const indexed = kept.map((point, i) => ({ ...point, index: i + 1 }));
    return { ...run, checkpoints: indexed, updatedAtMs: at };
  } catch {
    return createGoalRun("unknown", "goal", safeCount(nowMs));
  }
}

