/**
 * Continual-learning signal recorder and evaluator (Priority 5).
 *
 * Single responsibility: turn the gate's signal kinds into an in-memory,
 * content-free journal, and turn that journal into *proposals*. Nothing here
 * writes, queues, schedules, or even reads a database row, and nothing here
 * calls a provider or a tool. The only runtime import is the existing memory
 * constants module, so the magnitudes below are the product's own tuning
 * values rather than new ones:
 *
 *   - a correction moves confidence by exactly CONFIDENCE_CORRECTION_STEP,
 *     the step `lib/memory/constants.ts` already declares for "user correction"
 *   - praise moves confidence by exactly CONFIDENCE_CORROBORATION_STEP, the
 *     step already declared for corroborating evidence
 *   - a successful tool turn counts as one usage touch, the unit the existing
 *     `touch_memories` RPC applies when a memory is surfaced
 *
 * Everything is pure and never throws: a malformed journal or an unknown kind
 * degrades to "recorded nothing" rather than propagating an error.
 */

import {
  CONFIDENCE_CORRECTION_STEP,
  CONFIDENCE_CORROBORATION_STEP,
} from "@/lib/memory/constants";
import { LEARNING_SIGNAL_KINDS } from "./gate";
import type {
  LearningJournal,
  LearningSignal,
  LearningSignalKind,
  LearningSignalSource,
  LearningUpdate,
  LearningUpdateTarget,
} from "./types";

/** Usage reinforcement is a whole touch, mirroring one `touch_memories` call. */
export const USAGE_REINFORCEMENT_STEP = 1;

/** Hard cap on the in-memory journal; further signals are dropped, never paged. */
export const MAX_LEARNING_JOURNAL_SIGNALS = 200;

/** Upper bound on a tool name copied into a signal. */
export const MAX_LEARNING_TOOL_CHARS = 64;

/**
 * Signed strength per kind, in the unit of the target it maps to (see
 * LEARNING_TARGET_BY_KIND). A failed tool path carries no score movement of its
 * own: the candidate it implies is the signal, so its delta is 0.
 */
export const LEARNING_DELTA_BY_KIND: Readonly<
  Record<LearningSignalKind, number>
> = Object.freeze({
  user_correction: -CONFIDENCE_CORRECTION_STEP,
  explicit_negative_feedback: -CONFIDENCE_CORRECTION_STEP,
  explicit_positive_feedback: CONFIDENCE_CORROBORATION_STEP,
  tool_failure: 0,
  tool_success: USAGE_REINFORCEMENT_STEP,
});

/**
 * How sure each deterministic rule is, in 0..1. Tool outcomes are observed, not
 * inferred, so they sit at the top; an explicit correction outranks praise
 * because a user correcting us is stating a fact about the answer.
 */
export const LEARNING_CONFIDENCE_BY_KIND: Readonly<
  Record<LearningSignalKind, number>
> = Object.freeze({
  user_correction: 0.9,
  explicit_negative_feedback: 0.8,
  explicit_positive_feedback: 0.7,
  tool_failure: 0.9,
  tool_success: 0.8,
});

/** Which side of the turn each kind is read from. */
export const LEARNING_SOURCE_BY_KIND: Readonly<
  Record<LearningSignalKind, LearningSignalSource>
> = Object.freeze({
  user_correction: "user",
  explicit_negative_feedback: "user",
  explicit_positive_feedback: "user",
  tool_failure: "tool",
  tool_success: "tool",
});

/** The memory-facing field each kind would move, once a writer exists. */
export const LEARNING_TARGET_BY_KIND: Readonly<
  Record<LearningSignalKind, LearningUpdateTarget>
> = Object.freeze({
  user_correction: "memory_confidence",
  explicit_negative_feedback: "memory_confidence",
  explicit_positive_feedback: "memory_confidence",
  tool_failure: "procedural_candidate",
  tool_success: "memory_usage",
});

/** Every target this foundation can propose, in canonical reporting order. */
export const LEARNING_UPDATE_TARGETS: readonly LearningUpdateTarget[] =
  Object.freeze([
    "memory_confidence",
    "memory_usage",
    "procedural_candidate",
  ] as const);

/**
 * Short content-free rule label carried by every signal and update, so logs and
 * tests can name the rule that fired without quoting the user.
 */
export const LEARNING_NOTE_BY_KIND: Readonly<Record<LearningSignalKind, string>> =
  Object.freeze({
    user_correction: "rule:user_correction",
    explicit_negative_feedback: "rule:explicit_negative_feedback",
    explicit_positive_feedback: "rule:explicit_positive_feedback",
    tool_failure: "rule:tool_failure",
    tool_success: "rule:tool_success",
  });

/**
 * No write path exists in this foundation: every proposal is marked
 * `requiresWrite: true` and this constant stays false until a later, separately
 * reviewed step adds the writer.
 */
export const LEARNING_WRITES_ENABLED = false as const;


/** An empty journal. Frozen: recordSignals never mutates its input. */
export const EMPTY_JOURNAL: LearningJournal = Object.freeze({
  signals: [] as LearningSignal[],
});

/** Signed clamp with NaN safety. */
function clampSigned(value: number, bound: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(bound, Math.max(-bound, value));
}

/** True only for the exact kind strings this foundation defines. Never throws. */
export function isLearningSignalKind(
  value: unknown,
): value is LearningSignalKind {
  try {
    return LEARNING_SIGNAL_KINDS.some((kind) => kind === value);
  } catch {
    return false;
  }
}

/** True only for the declared update targets. Never throws. */
export function isLearningUpdateTarget(
  value: unknown,
): value is LearningUpdateTarget {
  try {
    return LEARNING_UPDATE_TARGETS.some((target) => target === value);
  } catch {
    return false;
  }
}

/** Validates a stored signal. Never throws. */
export function isLearningSignal(value: unknown): value is LearningSignal {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    const candidate = value as Record<string, unknown>;

    return (
      typeof candidate["index"] === "number" &&
      isLearningSignalKind(candidate["kind"]) &&
      typeof candidate["delta"] === "number" &&
      typeof candidate["confidence"] === "number" &&
      typeof candidate["note"] === "string"
    );
  } catch {
    return false;
  }
}

/** Validates a proposed update. Never throws. */
export function isLearningUpdate(value: unknown): value is LearningUpdate {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    const candidate = value as Record<string, unknown>;

    return (
      isLearningUpdateTarget(candidate["target"]) &&
      isLearningSignalKind(candidate["reason"]) &&
      typeof candidate["count"] === "number" &&
      typeof candidate["delta"] === "number" &&
      candidate["requiresWrite"] === true
    );
  } catch {
    return false;
  }
}

/** Validates a journal. Never throws. */
export function isLearningJournal(value: unknown): value is LearningJournal {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    return Array.isArray((value as Record<string, unknown>)["signals"]);
  } catch {
    return false;
  }
}

/** Copies the usable signals out of an untrusted journal. Never throws. */
export function journalSignals(journal: unknown): LearningSignal[] {
  try {
    if (!isLearningJournal(journal)) return [];

    const signals = journal.signals;

    if (!Array.isArray(signals)) return [];

    return signals
      .filter((signal) => isLearningSignal(signal))
      .slice(0, MAX_LEARNING_JOURNAL_SIGNALS)
      .map((signal) => ({ ...signal }));
  } catch {
    return [];
  }
}

/** Number of usable signals in a journal. Never throws. */
export function journalSize(journal: unknown): number {
  try {
    return journalSignals(journal).length;
  } catch {
    return 0;
  }
}

/** Trims and caps a tool name, or returns null when it is unusable. */
function safeTool(value: unknown): string | null {
  try {
    if (typeof value !== "string") return null;

    const trimmed = value.trim();

    if (trimmed === "") return null;

    return trimmed.slice(0, MAX_LEARNING_TOOL_CHARS);
  } catch {
    return null;
  }
}

/**
 * Builds one signal for the given kind and journal position.
 *
 * Returns null for an unknown kind or a position that is not a positive safe
 * integer, so a caller can hand over raw gate output without validating first.
 * The tool name is only attached to tool signals. Never throws.
 */
export function createSignal(
  kind: unknown,
  index: unknown,
  opts: { tool?: unknown } = {},
): LearningSignal | null {
  try {
    if (!isLearningSignalKind(kind)) return null;

    if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 1) {
      return null;
    }

    const signal: LearningSignal = {
      index,
      kind,
      source: LEARNING_SOURCE_BY_KIND[kind],
      delta: LEARNING_DELTA_BY_KIND[kind],
      confidence: LEARNING_CONFIDENCE_BY_KIND[kind],
      note: LEARNING_NOTE_BY_KIND[kind],
    };

    const tool = safeTool(opts?.tool);

    if (tool !== null && signal.source === "tool") {
      signal.tool = tool;
    }

    return signal;
  } catch {
    return null;
  }
}

/**
 * Appends one signal per kind to a journal and returns a new journal.
 *
 * Pure: the input journal is never mutated, existing signals are copied, and
 * unknown kinds are dropped. Indices continue from the current size, so a
 * journal read in order is 1-based and gapless. Once the journal reaches
 * MAX_LEARNING_JOURNAL_SIGNALS, further signals are dropped rather than paged.
 * Never throws.
 */
export function recordSignals(
  journal: unknown,
  kinds: unknown,
  opts: { tool?: unknown } = {},
): LearningJournal {
  const existing = journalSignals(journal);

  try {
    if (!Array.isArray(kinds)) return { signals: existing };

    const signals = [...existing];

    for (const kind of kinds) {
      if (signals.length >= MAX_LEARNING_JOURNAL_SIGNALS) break;

      const signal = createSignal(kind, signals.length + 1, opts);

      if (signal !== null) signals.push(signal);
    }

    return { signals };
  } catch {
    return { signals: existing };
  }
}


/** One aggregated line of a journal summary. */
export interface LearningSummaryEntry {
  kind: LearningSignalKind;
  count: number;
  delta: number;
}

/**
 * Aggregates a journal by kind, in canonical order.
 *
 * Content-free and cheap: counts plus signed totals, for a diagnostic log line
 * or a test assertion. Never throws.
 */
export function summarizeJournal(journal: unknown): LearningSummaryEntry[] {
  try {
    const signals = journalSignals(journal);

    if (signals.length === 0) return [];

    const summary: LearningSummaryEntry[] = [];

    for (const kind of LEARNING_SIGNAL_KINDS) {
      const matching = signals.filter((signal) => signal.kind === kind);

      if (matching.length === 0) continue;

      const total = matching.reduce((sum, signal) => sum + signal.delta, 0);

      summary.push({
        kind,
        count: matching.length,
        delta: clampSigned(total, 1),
      });
    }

    return summary;
  } catch {
    return [];
  }
}

/**
 * Turns a journal into proposals. Nothing is written.
 *
 * One update per observed kind, in canonical order. The delta is the sum of
 * that kind's signal deltas clamped into [-1, 1], so a run of corrections can
 * never exceed one full step down and a run of successes can never exceed one
 * usage touch per evaluation. Every update carries `requiresWrite: true`
 * because no write path exists while LEARNING_WRITES_ENABLED is false.
 *
 * Never throws: a malformed journal yields [].
 */
export function evaluateJournal(journal: unknown): LearningUpdate[] {
  try {
    const signals = journalSignals(journal);

    if (signals.length === 0) return [];

    const updates: LearningUpdate[] = [];

    for (const kind of LEARNING_SIGNAL_KINDS) {
      const matching = signals.filter((signal) => signal.kind === kind);

      if (matching.length === 0) continue;

      const total = matching.reduce((sum, signal) => sum + signal.delta, 0);

      updates.push({
        target: LEARNING_TARGET_BY_KIND[kind],
        reason: kind,
        count: matching.length,
        delta: clampSigned(total, 1),
        note: LEARNING_NOTE_BY_KIND[kind],
        requiresWrite: true,
      });
    }

    return updates;
  } catch {
    return [];
  }
}
