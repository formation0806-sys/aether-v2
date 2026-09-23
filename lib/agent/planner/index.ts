/**
 * AI planner entry point (Priority 2).
 *
 * Single responsibility: decide whether a request becomes a plan or a
 * deferral, behind ENABLE_AI_PLANNER. The plan itself now comes from the
 * AI generator: one model call producing structured JSON, with a
 * deterministic skeleton as the safe fallback when the model fails or its
 * output does not validate.
 *
 * Order of checks:
 *   1. ENABLE_AI_PLANNER off (or unreadable) -> "planner_disabled"
 *   2. unusable request (missing/oversized message) -> "invalid_request"
 *   3. not a planning request -> "not_planning_request"
 *   4. otherwise generate: model plan when valid, skeleton otherwise
 *
 * Additive only. Nothing imports this module in production yet: neither the
 * chat route nor the background job worker calls it. No change to
 * `app/api/chat/route.ts`, `lib/core/*`, `lib/brain/*`, `lib/memory/*`,
 * `lib/planner/*`, any repository, any migration, or any provider file.
 * No database reads or writes anywhere in this module: persistence lives in
 * the separate `./persist` module, which imports this one (never the reverse,
 * so there is no import cycle) and only writes when a caller opts in.
 */

import { isFeatureEnabled } from "@/lib/config/features";
import type { FeatureFlag } from "@/lib/config/features";
import { isPlanningRequest } from "./gate";
import type { GenerateDeps } from "./generate";
import { generatePlan } from "./generate";
import type { AiPlan, AiPlanOutcome, AiPlanRequest } from "./types";

/** Injectable flag predicate. Defaults to the real feature-flag reader. */
export type PlannerFlagReader = (flag: FeatureFlag) => boolean;

/** Injectable gate. Defaults to the deterministic planning classifier. */
export type PlannerGate = (message: unknown) => boolean;

/** Injectable dependencies. Every field is optional; defaults are production. */
export interface PlannerDeps extends GenerateDeps {
  /** Defaults to isFeatureEnabled() from the feature flags. */
  isFlagEnabled?: PlannerFlagReader;
  /** Defaults to isPlanningRequest(). */
  isPlanning?: PlannerGate;
}

/** Upper bound on the goal text carried into the plan. */
export const MAX_PLAN_GOAL_CHARS = 200;

/** Resolves the flag without ever enabling planning on error. Never throws. */
function isPlannerEnabled(deps: PlannerDeps): boolean {
  try {
    if (deps.isFlagEnabled) {
      return deps.isFlagEnabled("ENABLE_AI_PLANNER") === true;
    }

    return isFeatureEnabled("ENABLE_AI_PLANNER") === true;
  } catch {
    return false;
  }
}

/** Extracts a usable message from the request. Never throws. */
function requestMessage(request: AiPlanRequest): string | null {
  try {
    const message = (request as unknown as Record<string, unknown> | null | undefined)?.[
      "message"
    ];

    if (typeof message !== "string") return null;

    const trimmed = message.trim();

    if (trimmed === "") return null;

    if (trimmed.at(MAX_PLAN_GOAL_CHARS + 1) !== undefined) return null;

    return trimmed;
  } catch {
    return null;
  }
}

/** Caps goal text; the plan carries the message verbatim up to the cap. */
function toGoal(message: string): string {
  const trimmed = message.trim();

  if (trimmed.at(MAX_PLAN_GOAL_CHARS) === undefined) return trimmed;

  return trimmed.slice(0, MAX_PLAN_GOAL_CHARS);
}

/**
 * Plans or defers. Never throws, for any input, and never writes.
 *
 * Returns "planned" with the AI-generated plan (or the deterministic
 * skeleton when the model fails) only when the flag is on and the gate
 * accepts the message; otherwise a content-free "deferred" reason.
 */
export async function planOrDefer(
  request: AiPlanRequest,
  deps: PlannerDeps = {},
): Promise<AiPlanOutcome> {
  try {
    if (!isPlannerEnabled(deps)) {
      return { kind: "deferred", reason: "planner_disabled" };
    }

    const message = requestMessage(request);

    if (message === null) {
      return { kind: "deferred", reason: "invalid_request" };
    }

    let planning: boolean;

    try {
      planning = (deps.isPlanning ?? isPlanningRequest)(message) === true;
    } catch {
      return { kind: "deferred", reason: "not_planning_request" };
    }

    if (!planning) {
      return { kind: "deferred", reason: "not_planning_request" };
    }

    try {
      const plan = await generatePlan(toGoal(message), deps);

      return { kind: "planned", plan };
    } catch {
      return { kind: "deferred", reason: "invalid_request" };
    }
  } catch {
    return { kind: "deferred", reason: "invalid_request" };
  }
}

/**
 * True when a value is a structurally usable plan: a non-empty goal, at
 * least one sub-goal with an id and title, and at least one step with an id,
 * a sub-goal reference, a title, and a next action. Never throws, so it is
 * safe to call on untrusted or absent data.
 */
export function isAiPlan(value: unknown): value is AiPlan {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    const candidate = value as Record<string, unknown>;

    if (typeof candidate["goal"] !== "string" || candidate["goal"].trim() === "") {
      return false;
    }

    if (!Array.isArray(candidate["subGoals"]) || !Array.isArray(candidate["steps"])) {
      return false;
    }

    const subGoals = candidate["subGoals"] as unknown[];
    const steps = candidate["steps"] as unknown[];

    if (subGoals.length === 0 || steps.length === 0) return false;

    for (const entry of subGoals) {
      if (entry === null || typeof entry !== "object") return false;

      const subGoal = entry as Record<string, unknown>;

      if (typeof subGoal["id"] !== "string" || subGoal["id"] === "") {
        return false;
      }

      if (
        typeof subGoal["title"] !== "string" ||
        subGoal["title"].trim() === ""
      ) {
        return false;
      }
    }

    for (const entry of steps) {
      if (entry === null || typeof entry !== "object") return false;

      const step = entry as Record<string, unknown>;

      if (typeof step["id"] !== "string" || step["id"] === "") return false;

      if (typeof step["subGoalId"] !== "string" || step["subGoalId"] === "") {
        return false;
      }

      if (typeof step["title"] !== "string" || step["title"].trim() === "") {
        return false;
      }

      if (
        typeof step["nextAction"] !== "string" ||
        step["nextAction"].trim() === ""
      ) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

/** True when the outcome carries a usable plan. Never throws. */
export function isPlannedOutcome(value: unknown): value is AiPlanOutcome {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    const candidate = value as Record<string, unknown>;

    if (candidate["kind"] === "planned") {
      return isAiPlan(candidate["plan"]);
    }

    if (candidate["kind"] === "deferred") {
      return typeof candidate["reason"] === "string";
    }

    return false;
  } catch {
    return false;
  }
}
