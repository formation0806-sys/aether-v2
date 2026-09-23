/**
 * Multi-agent orchestration foundation types (Priority 4).
 *
 * A future coordinator will split a genuinely multi-part request into
 * role-scoped subtasks (for example "researcher" gathers, "synthesizer"
 * combines) instead of running one flat agent turn. These types describe the
 * shape of such a split. They are NOT execution state: there is no worker,
 * no queue, no database row, and no provider call anywhere in this module.
 *
 * Types and interfaces only. No imports, no runtime code, no side effects.
 * Nothing here is imported by production code: the coordinator skeleton and
 * the chat route are untouched, and wiring arrives in a later, separately
 * reviewed step.
 */

/** The role one subtask is scoped to. Kept small and explicit on purpose. */
export type AgentRole =
  /** Gathers information. Reads only; never synthesizes the final answer. */
  | "researcher"
  /** Combines subtask outputs into one coherent answer. */
  | "synthesizer"
  /** Checks a draft for errors against explicit criteria. */
  | "critic";

/** Lifecycle state of one orchestration task. A fresh plan starts at "todo". */
export type AgentTaskStatus = "todo" | "doing" | "done";

/** One role-scoped unit of work inside an orchestration plan. */
export interface AgentTask {
  /** Stable identifier assigned at plan time (never a database id). */
  id: string;
  /** Which role owns this task. */
  role: AgentRole;
  /** Short human-readable title, capped at plan time. */
  title: string;
  /** The single instruction this task carries out. Capped, never empty. */
  instruction: string;
  /** Lifecycle state; a fresh plan starts every task at "todo". */
  status: AgentTaskStatus;
}

/**
 * A complete multi-agent plan for one user request.
 *
 * Deterministic skeleton only: tasks are derived from the user's own words
 * by fixed rules, so identical input always yields an identical plan.
 */
export interface OrchestrationPlan {
  /** The request the plan serves, in the user's own words (capped). */
  goal: string;
  /** Role-scoped tasks, in execution order. Never empty for a plan. */
  tasks: AgentTask[];
}

/** Input for one orchestration request. */
export interface OrchestrationRequest {
  /** Owner of the future plan. Carried, never read or written. */
  userId: string;
  /** The user message to consider splitting. */
  message: string;
}

/** Why orchestration produced no plan. Content-free. */
export type OrchestrationDeferReason =
  /** ENABLE_MULTI_AGENT is not enabled. */
  | "orchestration_disabled"
  /** The message is not a multi-part request; existing paths own it. */
  | "not_multi_agent_request"
  /** The request was unusable (missing/oversized message). */
  | "invalid_request";

/** Result of one orchestration request. Never throws; always one of these. */
export type OrchestrationOutcome =
  | {
      kind: "planned";
      plan: OrchestrationPlan;
    }
  | {
      kind: "deferred";
      reason: OrchestrationDeferReason;
    };
