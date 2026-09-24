/** Flag-gated entry point: runAutonomy starts or resumes a goal run. */

import { decideNext, resumeRun } from "./transitions";
import { LONG_HORIZON_FLAG, createGoalRun, isGoalRun } from "./index";
import { isFeatureEnabled } from "@/lib/config/features";
import { isAutonomyRequest } from "./gate";
import type { AutonomyDeps } from "./index";
import type { GoalRun } from "./types";
import type { GoalRunRequest } from "./types";
import type { AutonomyOutcome } from "./types";
import type { AutonomyDeferReason } from "./types";
import type { AutonomyDecision } from "./types";

/** Builds a deferred outcome. Never throws. */
function deferred(reason: AutonomyDeferReason): AutonomyOutcome {
  return { kind: "deferred", reason };
}

/** Resolves the flag without ever enabling autonomy on error. Never throws. */
function enabled(deps: AutonomyDeps): boolean {
  try {
    if (deps.isFlagEnabled) {
      return deps.isFlagEnabled(LONG_HORIZON_FLAG) === true;
    }
    return isFeatureEnabled(LONG_HORIZON_FLAG) === true;
  } catch {
    return false;
  }
}

/** Reads the clock defensively. Never throws. */
function safeNow(now: AutonomyDeps["now"]): number {
  try {
    if (typeof now === "function") {
      const value = now();
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        return Math.floor(value);
      }
    }
    const fallback = Date.now();
    return typeof fallback === "number" && Number.isFinite(fallback)
      ? Math.floor(fallback)
      : 0;
  } catch {
    return 0;
  }
}

/** Caps goal text. Never throws. */
function toGoal(message: string): string {
  try {
    const trimmed = message.trim();
    if (trimmed.at(200) === undefined) return trimmed;
    return trimmed.slice(0, 200);
  } catch {
    return "";
  }
}

/**
 * Starts (or resumes) a goal run. Order: flag -> request shape -> gate ->
 * create-or-resume. Never throws; no provider, tool, or DB touch.
 */
export async function runAutonomy(
  request: GoalRunRequest,
  deps: AutonomyDeps = {},
): Promise<AutonomyOutcome> {
  try {
    const safe: AutonomyDeps = (() => {
      try {
        if (deps === null || typeof deps !== "object" || Array.isArray(deps)) {
          return {};
        }
        return deps;
      } catch {
        return {};
      }
    })();

    if (!enabled(safe)) return deferred("autonomy_disabled");

    let userId: string | null = null;
    let message: string | null = null;
    try {
      const raw = request as unknown as Record<string, unknown> | null;
      const u = raw?.["userId"];
      const m = raw?.["message"];
      if (typeof u === "string" && u.trim() !== "") userId = u.trim();
      if (typeof m === "string" && m.trim() !== "") {
        message = m.trim().at(201) === undefined ? m.trim() : null;
      }
    } catch {
      return deferred("invalid_request");
    }
    if (userId === null || message === null) {
      return deferred("invalid_request");
    }

    let autonomy: boolean;
    try {
      autonomy = (safe.isAutonomy ?? isAutonomyRequest)(message) === true;
    } catch {
      return deferred("not_autonomy_request");
    }
    if (!autonomy) return deferred("not_autonomy_request");

    const at = safeNow(safe.now);
    let run: GoalRun;
    try {
      const candidate = (
        request as unknown as Record<string, unknown> | null
      )?.["resume"];
      const resumed =
        candidate === undefined || candidate === null
          ? null
          : resumeRun(candidate, at);
      const goal = toGoal(message);
      run = resumed ?? createGoalRun(userId, goal === "" ? message : goal, at);
    } catch {
      run = createGoalRun(userId, message, at);
    }

    if (!isGoalRun(run)) return deferred("invalid_request");
    const decision: AutonomyDecision = decideNext(run);
    return { kind: "ran", run, decision };
  } catch {
    return deferred("invalid_request");
  }
}

export { isAutonomyRequest } from "./gate";
export {
  LONG_HORIZON_FLAG,
  MAX_AUTONOMY_CHECKPOINTS,
  MAX_AUTONOMY_FAILURES,
  MAX_AUTONOMY_GOAL_CHARS,
  MAX_AUTONOMY_TURNS,
  createGoalRun,
  createGoalRunId,
  isGoalRun,
  isGoalRunStatus,
  latestCheckpoint,
  recordCheckpoint,
} from "./index";
export type {
  AutonomyFlagReader,
  AutonomyGate,
  AutonomyDeps,
  AutonomyStep,
} from "./index";
