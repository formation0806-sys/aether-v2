/**
 * Long-horizon autonomy foundation types (Priority L1).
 *
 * Goal-run execution state for reliable multi-turn goal pursuit. These are
 * NOT database rows: a future step may project them onto the existing
 * planner tables (goals/projects/milestones/tasks), but this module never
 * names a column, an RPC, or a repository.
 *
 * Types and interfaces only. No imports, no runtime code, no side effects.
 * Nothing here is imported by production code: the chat route, the agent
 * loop, the memory pipeline and the job worker are all untouched, and
 * ENABLE_LONG_HORIZON defaults to OFF.
 */

/** Lifecycle state of one goal run. A fresh run starts at "active". */
export type GoalRunStatus =
  | "active"
  | "paused"
  | "completed"
  | "failed"
  | "stopped";

/** One progress marker inside a goal run. Content-free: counts, never text. */
export interface GoalCheckpoint {
  /** Monotonic 1-based index within the run. */
  index: number;
  /** Total tasks known at checkpoint time. */
  tasksTotal: number;
  /** Tasks done at checkpoint time. */
  tasksDone: number;
  /** Consecutive failures at checkpoint time. */
  failures: number;
  /** Caller clock value when recorded (ms). */
  atMs: number;
}

/** In-memory execution state for one long-horizon goal. */
export interface GoalRun {
  /** Stable identifier assigned at run start (never a database id). */
  id: string;
  /** Owner of the run. Carried, never read or written. */
  userId: string;
  /** The goal the run serves, in the user's own words (capped). */
  goal: string;
  /** Lifecycle state; a fresh run starts "active". */
  status: GoalRunStatus;
  /** Agent turns consumed so far. */
  turnsUsed: number;
  /** Consecutive failures so far. */
  failures: number;
  /** Progress markers, in recording order. Never empty for bookkeeping. */
  checkpoints: GoalCheckpoint[];
  /** Caller clock value at creation (ms). */
  createdAtMs: number;
  /** Caller clock value of the last transition (ms). */
  updatedAtMs: number;
}

/** Input for starting (or resuming) a goal run. */
export interface GoalRunRequest {
  /** Owner of the future run. Carried, never read or written. */
  userId: string;
  /** The user message / goal to pursue. */
  message: string;
  /** Existing run to resume, when the caller has one. */
  resume?: unknown;
}

/** What the runtime decided after one step. */
export type AutonomyDecision =
  /** Keep working: budget and progress allow another turn. */
  | "continue"
  /** Park the run: progress stalled or caller asked to wait. Resumable. */
  | "pause"
  /** End the run by request or because there is nothing left to do. */
  | "stop"
  /** End the run as failed: too many consecutive failures. Resumable. */
  | "failed";

/** Why autonomy produced no run. Content-free. */
export type AutonomyDeferReason =
  /** ENABLE_LONG_HORIZON is not enabled. */
  | "autonomy_disabled"
  /** The message is not a long-horizon request; existing paths own it. */
  | "not_autonomy_request"
  /** The request was unusable (missing user, goal, or resume shape). */
  | "invalid_request";

/** Result of one autonomy request. Never throws; always one of these. */
export type AutonomyOutcome =
  | {
      kind: "ran";
      run: GoalRun;
      decision: AutonomyDecision;
    }
  | {
      kind: "deferred";
      reason: AutonomyDeferReason;
    };
