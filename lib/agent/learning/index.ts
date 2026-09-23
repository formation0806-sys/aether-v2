/**
 * Continual-learning entry point (Priority 5).
 *
 * Single responsibility: decide whether a turn produces a learning signal or a
 * deferral, behind ENABLE_CONTINUAL_LEARNING, and return the signals plus the
 * proposals they imply. Nothing is written: there is no database read, no
 * database write, no provider call, and no tool call anywhere in this module.
 *
 * Order of checks:
 *   1. ENABLE_CONTINUAL_LEARNING off (or unreadable) -> "learning_disabled"
 *   2. unusable request (non-string or oversized message, non-array trace)
 *      -> "invalid_request"
 *   3. no usable signal in the turn -> "no_learning_signal"
 *   4. otherwise record: deterministic signals from ./gate, then proposals
 *      from ./signals
 *
 * A blank message is valid input, not an invalid request: a turn can carry a
 * trace without the user saying anything about it, and the gate decides from
 * both. What cannot be classified is deferred, never guessed.
 *
 * Additive only. Nothing imports this module in production: the agent loop,
 * the runner, the tools, the planner, the procedural modules, the orchestration
 * coordinator, the memory pipeline, and the chat route are all untouched.
 */

import { isFeatureEnabled } from "@/lib/config/features";
import type { FeatureFlag } from "@/lib/config/features";
import {
  MAX_LEARNING_MESSAGE_CHARS,
  classifyLearningSignals,
  dominantToolName,
} from "./gate";
import {
  EMPTY_JOURNAL,
  MAX_LEARNING_JOURNAL_SIGNALS,
  evaluateJournal,
  isLearningJournal,
  isLearningSignal,
  recordSignals,
} from "./signals";
import type {
  LearningJournal,
  LearningOutcome,
  LearningRequest,
  LearningSignal,
  LearningSignalKind,
} from "./types";

/** The one flag that gates this capability. Off unless explicitly enabled. */
export const CONTINUAL_LEARNING_FLAG: FeatureFlag = "ENABLE_CONTINUAL_LEARNING";

/** Injectable flag predicate. Defaults to the real feature-flag reader. */
export type LearningFlagReader = (flag: FeatureFlag) => boolean;

/** Injectable gate. Defaults to the deterministic learning-signal classifier. */
export type LearningGate = (input: {
  message?: unknown;
  trace?: unknown;
}) => readonly LearningSignalKind[];

/** Injectable dependencies. Every field is optional; defaults are production. */
export interface LearningDeps {
  /** Defaults to isFeatureEnabled() from the feature flags. */
  isFlagEnabled?: LearningFlagReader;
  /** Defaults to classifyLearningSignals(). */
  classify?: LearningGate;
}

/** Resolves the flag without ever enabling recording on error. Never throws. */
function isLearningEnabled(deps: LearningDeps): boolean {
  try {
    if (deps.isFlagEnabled) {
      return deps.isFlagEnabled(CONTINUAL_LEARNING_FLAG) === true;
    }

    return isFeatureEnabled(CONTINUAL_LEARNING_FLAG) === true;
  } catch {
    return false;
  }
}

/** Reads the message defensively; null means the request was unusable. */
function requestMessage(request: LearningRequest): string | null {
  try {
    const message = (
      request as unknown as Record<string, unknown> | null | undefined
    )?.["message"];

    if (typeof message !== "string") return null;

    // Reject rather than truncate: a message longer than the cap is beyond the
    // gate's remit, exactly like the sibling gates.
    if (message.at(MAX_LEARNING_MESSAGE_CHARS) !== undefined) return null;

    return message;
  } catch {
    return null;
  }
}

/** Reads the trace defensively; null means the request was unusable. */
function requestTrace(request: LearningRequest): unknown[] | null {
  try {
    const trace = (
      request as unknown as Record<string, unknown> | null | undefined
    )?.["trace"];

    if (trace === undefined || trace === null) return [];

    if (!Array.isArray(trace)) return null;

    return trace;
  } catch {
    return null;
  }
}

/**
 * Records one turn's learning signals, or defers.
 *
 * Never throws, for any input, and never writes. A "recorded" outcome carries
 * this turn's signals in canonical order plus the proposals they imply; every
 * proposal is marked `requiresWrite: true` and must not be persisted by this
 * foundation.
 */
export async function recordLearning(
  request: LearningRequest,
  deps: LearningDeps = {},
): Promise<LearningOutcome> {
  try {
    if (!isLearningEnabled(deps)) {
      return { kind: "deferred", reason: "learning_disabled" };
    }

    const message = requestMessage(request);

    if (message === null) {
      return { kind: "deferred", reason: "invalid_request" };
    }

    const trace = requestTrace(request);

    if (trace === null) {
      return { kind: "deferred", reason: "invalid_request" };
    }

    let kinds: readonly LearningSignalKind[];

    try {
      kinds =
        (deps.classify ?? classifyLearningSignals)({ message, trace }) ?? [];
    } catch {
      // A broken classifier reads as "nothing to learn", never as an error the
      // caller has to handle.
      return { kind: "deferred", reason: "no_learning_signal" };
    }

    if (!Array.isArray(kinds) || kinds.length === 0) {
      return { kind: "deferred", reason: "no_learning_signal" };
    }

    // The tool name is derived from the trace, so a tool signal carries the
    // registered tool that produced it and nothing else from the turn.
    const journal = recordSignals(EMPTY_JOURNAL, kinds, {
      tool: dominantToolName(trace),
    });

    // Unknown kinds are dropped by the recorder: a classifier that returns junk
    // defers instead of recording an empty signal.
    if (journal.signals.length === 0) {
      return { kind: "deferred", reason: "no_learning_signal" };
    }

    return {
      kind: "recorded",
      signals: journal.signals,
      updates: evaluateJournal(journal),
    };
  } catch {
    return { kind: "deferred", reason: "invalid_request" };
  }
}

/**
 * Folds a recorded outcome into a journal, returning a new journal.
 *
 * Pure: the input journal is never mutated, and the outcome is never read
 * beyond its recorded signals, so a deferred or malformed outcome leaves the
 * journal exactly as it was. The journal stays capped at
 * MAX_LEARNING_JOURNAL_SIGNALS. Never throws.
 */
export function journalFromOutcome(
  outcome: unknown,
  journal: unknown = EMPTY_JOURNAL,
): LearningJournal {
  try {
    const base = isLearningJournal(journal) ? journal : EMPTY_JOURNAL;
    const existing = base.signals
      .filter(isLearningSignal)
      .slice(0, MAX_LEARNING_JOURNAL_SIGNALS)
      .map((signal) => ({ ...signal }));

    if (outcome === null || typeof outcome !== "object" || Array.isArray(outcome)) {
      return { signals: existing };
    }

    const candidate = outcome as Record<string, unknown>;

    if (candidate["kind"] !== "recorded") return { signals: existing };

    const signals = candidate["signals"];

    if (!Array.isArray(signals)) return { signals: existing };

    // Appended signals are re-indexed so the journal stays 1-based and
    // gapless, exactly like recordSignals guarantees within one turn. The
    // outcome's own indices belong to the turn that produced it, not here.
    const appended: LearningSignal[] = [];

    for (const signal of signals) {
      if (existing.length + appended.length >= MAX_LEARNING_JOURNAL_SIGNALS) {
        break;
      }

      if (!isLearningSignal(signal)) continue;

      appended.push({
        ...signal,
        index: existing.length + appended.length + 1,
      });
    }

    return { signals: existing.concat(appended) };
  } catch {
    return { signals: [] };
  }
}

/** True when the outcome carries recorded signals. Never throws. */
export function isRecordedOutcome(value: unknown): value is LearningOutcome {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    const candidate = value as Record<string, unknown>;

    if (candidate["kind"] === "recorded") {
      return (
        Array.isArray(candidate["signals"]) && Array.isArray(candidate["updates"])
      );
    }

    if (candidate["kind"] === "deferred") {
      return typeof candidate["reason"] === "string";
    }

    return false;
  } catch {
    return false;
  }
}


/** The gate and its constants, re-exported so the module has one public surface. */
export {
  LEARNING_SIGNAL_KINDS,
  MAX_LEARNING_MESSAGE_CHARS,
  MAX_LEARNING_TOOL_CHARS,
  MAX_LEARNING_TRACE_STEPS,
  classifyLearningSignals,
  classifyToolOutcome,
  classifyUserSignal,
  dominantToolName,
  hasLearningSignal,
} from "./gate";

/** The recorder, the evaluator, and their tuning constants. */
export {
  EMPTY_JOURNAL,
  LEARNING_CONFIDENCE_BY_KIND,
  LEARNING_DELTA_BY_KIND,
  LEARNING_NOTE_BY_KIND,
  LEARNING_SOURCE_BY_KIND,
  LEARNING_TARGET_BY_KIND,
  LEARNING_UPDATE_TARGETS,
  LEARNING_WRITES_ENABLED,
  MAX_LEARNING_JOURNAL_SIGNALS,
  USAGE_REINFORCEMENT_STEP,
  createSignal,
  evaluateJournal,
  isLearningJournal,
  isLearningSignal,
  isLearningSignalKind,
  isLearningUpdate,
  isLearningUpdateTarget,
  journalSignals,
  journalSize,
  recordSignals,
  summarizeJournal,
} from "./signals";

/** The types this module's callers need. */
export type { LearningSummaryEntry } from "./signals";
export type {
  LearningDeferReason,
  LearningJournal,
  LearningOutcome,
  LearningRequest,
  LearningSignal,
  LearningSignalKind,
  LearningSignalSource,
  LearningTraceStep,
  LearningUpdate,
  LearningUpdateTarget,
} from "./types";
