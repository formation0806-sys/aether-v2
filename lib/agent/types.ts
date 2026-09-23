/**
 * Agent-core types.
 *
 * Additive foundation for the planned agent loop (docs/AGENT_LOOP_DESIGN.md).
 * Nothing here is imported by production code: the runner, the loop, and the
 * route branch arrive in later, separately reviewed steps.
 *
 * Types and interfaces only. The single import is type-only, so it erases at
 * compile time and adds no runtime dependency.
 */

import type { PreStreamResult } from "@/lib/core";

/**
 * Input for one agent turn.
 *
 * This is the pipeline result verbatim (PreStreamResult, see
 * lib/core/pipeline.ts): the durable user message and memory job have already
 * been persisted, the system prompt is already assembled, and the conversation
 * array already ends with the current user message. The agent never re-builds
 * any of that, it consumes it.
 *
 * Declaring it here as an alias keeps the contract enforced by the compiler
 * without copying fields that could drift out of step.
 */
export type AgentTurnInput = PreStreamResult;

/** Phases recorded in a turn trace. Mirrors the loop observe, think, act cycle. */
export type AgentTracePhase = "think" | "act" | "observe" | "final" | "error";

/**
 * One step of a turn trace.
 *
 * Deliberately content-free: it carries timing, tool names, and outcomes so a
 * turn can be logged and asserted in tests without ever recording message,
 * memory, or observation text.
 */
export interface AgentTraceStep {
  /** Monotonic 1-based index within the turn. */
  step: number;
  phase: AgentTracePhase;
  /** Tool name for act and observe steps. */
  tool?: string;
  /** Milliseconds spent in this step. */
  durationMs: number;
  /** Whether the step succeeded. Absent for planning-only steps. */
  ok?: boolean;
  /** Short, content-free note, for example "invalid_tool_args". */
  note?: string;
}

/** Why a turn handed control back to the existing single-call chat path. */
export type AgentFallbackReason =
  /** Agent mode is off: ENABLE_AGENT_LOOP or ENABLE_TOOL_USE is not enabled. */
  | "flags_disabled"
  /** The deterministic gate classified the message as ordinary chat. */
  | "gate_chat"
  /** The provider call failed. */
  | "provider_error"
  /** The turn could not finish within its budget. */
  | "budget_exhausted"
  /** Anything unexpected. The caller must still answer the user. */
  | "unexpected_error";

/**
 * Result of one agent turn.
 *
 * "answered" carries the response the route should persist and return.
 * "fallback" means the caller must run the legacy chat call instead, so the user
 * always receives an answer and agent machinery never surfaces an error.
 */
export type AgentOutcome =
  | {
      kind: "answered";
      response: string;
      trace: AgentTraceStep[];
    }
  | {
      kind: "fallback";
      reason: AgentFallbackReason;
      trace: AgentTraceStep[];
    };