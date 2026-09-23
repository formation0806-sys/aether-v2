/**
 * AI planner foundation types (Priority 2).
 *
 * Long-horizon planning structures used by the future background worker.
 * These are deliberately distinct from the legacy deterministic planner in
 * `lib/planner/` (Goal / Project / Milestone / Task, keyword parser,
 * Supabase reads/writes): the `Ai` prefix keeps the two namespaces from
 * colliding while both exist.
 *
 * Types and interfaces only. No imports, no runtime code, no side effects.
 * Nothing here is imported by production code: the worker that consumes
 * these types arrives in a later, separately reviewed step.
 */

/** Priority of one plan step, mirroring the legacy PlannerPriority. */
export type AiPlanPriority = "low" | "medium" | "high" | "critical";

/** Lifecycle state of one plan step. */
export type AiPlanStepStatus = "todo" | "doing" | "done";

/** A decomposed part of the goal, produced by planning, not by parsing. */
export interface AiSubGoal {
  /** Stable identifier assigned at plan time (never a database id). */
  id: string;
  /** Short human-readable title. */
  title: string;
}

/** One actionable step inside a sub-goal. */
export interface AiPlanStep {
  /** Stable identifier assigned at plan time (never a database id). */
  id: string;
  /** Identifier of the parent sub-goal within the same plan. */
  subGoalId: string;
  /** Short human-readable title. */
  title: string;
  /** The single next action that moves this step forward. */
  nextAction: string;
  /** Priority, defaulting to "medium" when the planner is unsure. */
  priority: AiPlanPriority;
  /** Lifecycle state; a fresh plan starts every step at "todo". */
  status: AiPlanStepStatus;
}

/** A complete long-horizon plan for one user request. */
export interface AiPlan {
  /** The goal the plan serves, in the user's own words (capped). */
  goal: string;
  /** Decomposed sub-goals, in execution order. */
  subGoals: AiSubGoal[];
  /** Actionable steps, each linked to a sub-goal. */
  steps: AiPlanStep[];
}

/** Input for one planning request. */
export interface AiPlanRequest {
  /** Owner of the future plan. Carried, never read or written. */
  userId: string;
  /** The user message to plan for. */
  message: string;
}

/** Why planning did not produce a plan. Content-free. */
export type AiPlanDeferReason =
  /** ENABLE_AI_PLANNER is not enabled. */
  | "planner_disabled"
  /** The message is not a planning request; the chat path owns it. */
  | "not_planning_request"
  /** The request was unusable (missing/oversized message). */
  | "invalid_request";

/** Result of one planning request. Never throws; always one of these. */
export type AiPlanOutcome =
  | {
      kind: "planned";
      plan: AiPlan;
    }
  | {
      kind: "deferred";
      reason: AiPlanDeferReason;
    };
