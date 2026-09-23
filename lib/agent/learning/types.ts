/**
 * Continual-learning foundation types (Priority 5).
 *
 * A continual-learning loop turns what happens *after* an answer into bounded,
 * content-free evidence that a later step can use: the user corrects the
 * assistant, the user says the answer worked, a tool call fails. Today the
 * product already collects some of that evidence implicitly - `times_used` and
 * `last_used` are bumped when a memory is surfaced, and the lifecycle rules
 * promote a memory once usage and confidence cross a threshold - but nothing
 * reads an explicit correction or an explicit thank-you.
 *
 * These types describe the shape of that evidence and of the *proposal* it
 * produces. They are not the database record: the canonical stored row stays
 * `MemoryRecord` / `MemoryRow` in `lib/memory/types.ts`, and this module never
 * names a column or an RPC.
 *
 * Types and interfaces only. No imports, no runtime code, no side effects.
 * Nothing here is imported by production code: the agent loop, the memory
 * pipeline, the job worker and the chat route are all untouched, and the
 * writer arrives in a later, separately reviewed step.
 */

/**
 * The kind of learning signal one turn can produce.
 *
 * Every kind is decided by a deterministic rule over the user's own words or
 * over the existing content-free agent trace. Nothing here is inferred by a
 * model, and no kind requires reading a stored memory.
 */
export type LearningSignalKind =
  /** The user says the previous answer or fact was wrong. */
  | "user_correction"
  /** The user says the answer was unhelpful, bad or broken. */
  | "explicit_negative_feedback"
  /** The user says the answer was right, exactly what was wanted, or helped. */
  | "explicit_positive_feedback"
  /** A tool call in the turn failed. */
  | "tool_failure"
  /** Every tool call in the turn succeeded. */
  | "tool_success";

/** Where a signal came from. */
export type LearningSignalSource =
  /** Derived from the user's message. */
  | "user"
  /** Derived from the content-free agent trace. */
  | "tool";

/**
 * One deterministic, content-free learning signal observed in one turn.
 *
 * Deliberately carries no message text: the kind, the strength, the confidence
 * and a short rule label are enough for a later step to act, and are safe to
 * log. The one content-bearing field is `tool`, which is a registered tool name
 * (for example "calculator"), never user text or an observation.
 */
export interface LearningSignal {
  /** 1-based position of this signal within the journal. */
  index: number;
  /** Which rule fired. */
  kind: LearningSignalKind;
  /** Whether the rule read the user's words or the trace. */
  source: LearningSignalSource;
  /** Registered tool name, present only for tool signals. */
  tool?: string;
  /**
   * Signed strength of the signal, expressed in the unit of the target it maps
   * to (see `LearningUpdateTarget`). Clamped into [-1, 1] once aggregated.
   */
  delta: number;
  /** How sure the deterministic rule is, in 0..1. */
  confidence: number;
  /** Short content-free rule label, for example "rule:user_correction". */
  note: string;
}

/**
 * The memory-facing thing a proposed update would touch. Names describe the
 * canonical V2 field so a future writer needs no second mapping step, but this
 * module never reads or writes the column itself.
 */
export type LearningUpdateTarget =
  /** `confidence_v2`: corrections lower it, praise raises it. */
  | "memory_confidence"
  /** `times_used` / `last_used`: a successful tool turn counts as one touch. */
  | "memory_usage"
  /** A new procedural memory worth extracting in a later step. */
  | "procedural_candidate";

/**
 * A proposal produced by evaluating a journal. Nothing is written.
 *
 * `requiresWrite` is true for every update and stays true while
 * `LEARNING_WRITES_ENABLED` is false, so a caller cannot mistake a proposal for
 * a completed write.
 */
export interface LearningUpdate {
  /** Which memory-facing field this would touch. */
  target: LearningUpdateTarget;
  /** The signal kind that produced it. */
  reason: LearningSignalKind;
  /** How many signals of this kind were aggregated. */
  count: number;
  /** Aggregated strength, clamped into [-1, 1]. */
  delta: number;
  /** Short content-free rule label; matches the signals it came from. */
  note: string;
  /** Always true today: the proposal must not be persisted by this module. */
  requiresWrite: boolean;
}

/**
 * In-memory journal of signals recorded so far.
 *
 * Bounded and never persisted: it exists so a caller can accumulate a turn's
 * signals across turns in one process without a database write. Serialization
 * and retention are out of scope for this foundation.
 */
export interface LearningJournal {
  /** Recorded signals, oldest first, indexed 1-based. */
  signals: LearningSignal[];
}

/** One minimal trace step shape this module reads. Mirrors `AgentTraceStep`. */
export interface LearningTraceStep {
  /** Monotonic 1-based index within the turn, when the caller has one. */
  step?: number;
  /** Loop phase; only `act` and `observe` steps carry tool outcomes. */
  phase?: string;
  /** Registered tool name, when the step has one. */
  tool?: string;
  /** Milliseconds spent in the step, when the caller has one. */
  durationMs?: number;
  /** Tool outcome; absent for steps that record no outcome. */
  ok?: boolean;
  /** Short content-free note, when the caller has one. */
  note?: string;
}

/** Input for one learning evaluation. */
export interface LearningRequest {
  /** Owner of the journal. Carried, never read or written. */
  userId: string;
  /** The user message for this turn. May be blank; never null. */
  message: string;
  /** Content-free agent trace for the turn, when one exists. */
  trace?: LearningTraceStep[];
}

/** Why a turn produced no recorded signal. Content-free. */
export type LearningDeferReason =
  /** ENABLE_CONTINUAL_LEARNING is not enabled. */
  | "learning_disabled"
  /** The turn produced no usable signal; nothing to learn this turn. */
  | "no_learning_signal"
  /** The request was unusable (non-string or oversized message, bad trace). */
  | "invalid_request";

/** Result of one learning evaluation. Never throws; always one of these. */
export type LearningOutcome =
  | {
      kind: "recorded";
      /** The signals this turn produced, in canonical order. */
      signals: LearningSignal[];
      /** The proposals those signals imply. Never persisted here. */
      updates: LearningUpdate[];
    }
  | {
      kind: "deferred";
      reason: LearningDeferReason;
    };
