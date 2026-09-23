/**
 * Continual-learning gate (Priority 5).
 *
 * Decides whether a turn carries a *useful learning signal*: the user
 * corrected the assistant, the user gave explicit praise or explicit
 * criticism, or the turn's tool calls failed or succeeded. Pure and
 * deterministic: no runtime imports, no flags, no environment, no clock, no
 * randomness, no model call. The only import is type-only (erased at runtime).
 *
 * The gate is deliberately conservative and turn-local. It reads only the
 * current user message and the current turn's content-free trace, so it needs
 * no cross-turn state, no session length and no stored memory. Ordinary chat,
 * questions about whether something is correct, greetings, identity facts,
 * tool-shaped requests and planning requests all produce no signal: precision
 * over recall, because a missed signal costs nothing while a false positive
 * would move an existing memory's score for no reason.
 *
 * Reading no flags here is intentional: classification must be independent of
 * ENABLE_CONTINUAL_LEARNING so it stays testable and stable while the
 * capability is still switched off. The flag is enforced once, by the entry
 * point.
 */

import type { LearningSignalKind, LearningTraceStep } from "./types";

/** Upper bound on a message this gate will even look at. */
export const MAX_LEARNING_MESSAGE_CHARS = 1000;

/** Upper bound on trace steps scanned per turn. */
export const MAX_LEARNING_TRACE_STEPS = 20;

/** Upper bound on a tool name copied out of a trace step. */
export const MAX_LEARNING_TOOL_CHARS = 64;

/**
 * Every signal kind, in canonical classification and reporting order: the
 * user's own words first, then the trace (failure before success, because a
 * failing tool path must never be reinforced).
 */
export const LEARNING_SIGNAL_KINDS: readonly LearningSignalKind[] =
  Object.freeze([
    "user_correction",
    "explicit_negative_feedback",
    "explicit_positive_feedback",
    "tool_failure",
    "tool_success",
  ] as const);

/** Explicit correction phrasing: the previous answer or fact was wrong. */
const CORRECTION_PATTERNS: readonly RegExp[] = [
  /\b(?:that|this)(?:'s| is| was)\s+(?:not right|not correct|wrong|incorrect)\b/i,
  /\bit(?:'s| is| was)\s+(?:not right|not correct|wrong|incorrect)\b/i,
  /\byou(?:'re| are)\s+(?:wrong|incorrect|mistaken)\b/i,
  /\b(?:wrong|incorrect|bad)\s+answer\b/i,
  /\bnot what i (?:asked|said|meant)\b/i,
  /\bi (?:said|meant)\s+(?:that\s+)?(?:it(?:'s| is)|the\s+\S+\s+is)\b/i,
  /\bactually,?\s+it(?:'s| is)\b/i,
  /\bcorrect yourself\b/i,
];

/** Explicit negative feedback: the answer was unhelpful, bad or broken. */
const NEGATIVE_FEEDBACK_PATTERNS: readonly RegExp[] = [
  /\bnot helpful\b/i,
  /\b(?:unhelpful|useless)\b/i,
  /\b(?:bad|poor|disappointing)\s+(?:answer|response|reply)\b/i,
  /\b(?:that|this)\s+doesn'?t\s+work\b/i,
  /\byou (?:didn'?t|did not)\s+(?:answer|help|listen)\b/i,
];

/** Explicit positive feedback: the answer was right, wanted, or useful. */
const POSITIVE_FEEDBACK_PATTERNS: readonly RegExp[] = [
  /\bperfect\b/i,
  /\bexactly\b/i,
  /\bthat(?:'s| is)\s+(?:right|correct)\b/i,
  /\b(?:good|great|nice)\s+(?:job|work|answer)\b/i,
  /\bthat worked\b/i,
  /\bthanks?,?\s+(?:that|this)\s+(?:worked|helped)\b/i,
  /\b(?:very\s+)?helpful\b/i,
];

/**
 * Hard negatives. Checked first, so a message that merely mentions a feedback
 * word while asking for something else is never read as a signal.
 */
const REJECT_PATTERNS: readonly RegExp[] = [
  // Identity facts belong to the identity layer.
  /\bmy name is\b/i,
  // Tool-shaped requests belong to the agent loop's tools.
  /^\s*(?:what(?:'s| is) the time|what time|calculate|compute|calc|search the web)\b/i,
  // Single-goal planning requests belong to the AI planner.
  /\b(?:make|create|build|give me)\s+(?:me\s+)?a\s+(?:plan|roadmap)\b/i,
  // Courtesy openers that carry no evaluation.
  /^\s*(?:hi|hello|hey|good morning|good afternoon|good evening)\b/i,
  // A single interrogative sentence is a question, not feedback.
  /^\s*(?:is|was|are|were|do|does|did|can|could|should|would|will|what|why|how|when|where|which|who)\b[^.!?]*\?\s*$/i,
];

/** True when any pattern in the list matches. Never throws. */
function matchesAny(patterns: readonly RegExp[], text: string): boolean {
  for (const pattern of patterns) {
    if (pattern.test(text)) return true;
  }

  return false;
}

/**
 * Classifies the user's own words, or returns null when they carry no signal.
 *
 * Precedence is fixed and documented: correction first, then negative feedback,
 * then positive feedback. A correction therefore wins when a message matches
 * more than one list, which is the conservative reading.
 *
 * Returns null for non-strings, blank messages, oversized messages, anything
 * matching a hard negative, and anything with no feedback phrasing.
 */
export function classifyUserSignal(message: unknown): LearningSignalKind | null {
  try {
    if (typeof message !== "string") return null;

    const text = message.trim();

    if (text === "") return null;

    // Reject oversized input rather than truncating: a message longer than the
    // cap is beyond this gate's remit.
    if (text.at(MAX_LEARNING_MESSAGE_CHARS) !== undefined) return null;

    if (matchesAny(REJECT_PATTERNS, text)) return null;

    if (matchesAny(CORRECTION_PATTERNS, text)) return "user_correction";
    if (matchesAny(NEGATIVE_FEEDBACK_PATTERNS, text)) {
      return "explicit_negative_feedback";
    }
    if (matchesAny(POSITIVE_FEEDBACK_PATTERNS, text)) {
      return "explicit_positive_feedback";
    }

    return null;
  } catch {
    return null;
  }
}


/**
 * Copies the fields this module reads out of one trace entry.
 *
 * Returns null for anything that is not a plain object, so a malformed trace
 * degrades to "no tool outcome" instead of throwing. Never throws: a hostile
 * object whose property access throws is caught here.
 */
function safeStep(entry: unknown): LearningTraceStep | null {
  try {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return null;
    }

    const candidate = entry as Record<string, unknown>;
    const phase = candidate["phase"];
    const ok = candidate["ok"];
    const tool = candidate["tool"];

    return {
      phase: typeof phase === "string" ? phase : undefined,
      ok: typeof ok === "boolean" ? ok : undefined,
      tool: typeof tool === "string" ? tool : undefined,
    };
  } catch {
    return null;
  }
}

/** True when a step is a tool phase that can carry an outcome. */
function isToolStep(step: LearningTraceStep): boolean {
  return step.phase === "act" || step.phase === "observe";
}

/**
 * Classifies the turn's tool outcome from its content-free trace.
 *
 * Only `act` and `observe` steps with a boolean `ok` count; planning steps are
 * ignored. A single failing tool step yields "tool_failure" and dominates any
 * successes in the same turn, because a failing path must not be reinforced.
 * When no step records an outcome, the result is null.
 *
 * Bounded: at most MAX_LEARNING_TRACE_STEPS entries are inspected. Never
 * throws, for any input.
 */
export function classifyToolOutcome(
  trace: unknown,
): "tool_failure" | "tool_success" | null {
  try {
    if (!Array.isArray(trace)) return null;

    const limit = Math.min(trace.length, MAX_LEARNING_TRACE_STEPS);

    let sawSuccess = false;

    for (let index = 0; index < limit; index += 1) {
      const step = safeStep(trace[index]);

      if (step === null || !isToolStep(step)) continue;

      if (step.ok === false) return "tool_failure";
      if (step.ok === true) sawSuccess = true;
    }

    return sawSuccess ? "tool_success" : null;
  } catch {
    return null;
  }
}

/**
 * Returns the tool name behind the turn's dominant tool outcome.
 *
 * A failing step wins over a successful one, matching classifyToolOutcome's
 * precedence; within the same outcome the earliest step wins. The name is
 * trimmed and capped. Returns null when no tool step carries a usable name.
 * Never throws.
 */
export function dominantToolName(trace: unknown): string | null {
  try {
    if (!Array.isArray(trace)) return null;

    const limit = Math.min(trace.length, MAX_LEARNING_TRACE_STEPS);

    let failing: string | null = null;
    let succeeding: string | null = null;

    for (let index = 0; index < limit; index += 1) {
      const step = safeStep(trace[index]);

      if (step === null || !isToolStep(step)) continue;

      const name = step.tool?.trim();
      const usable =
        typeof name === "string" && name !== ""
          ? name.slice(0, MAX_LEARNING_TOOL_CHARS)
          : null;

      if (usable === null) continue;

      if (step.ok === false && failing === null) failing = usable;
      if (step.ok === true && succeeding === null) succeeding = usable;
    }

    return failing ?? succeeding;
  } catch {
    return null;
  }
}

/**
 * Every signal one turn produces, in canonical order.
 *
 * The user's own words are classified first, then the trace outcome. At most
 * one signal per kind is returned, so the result is short (at most five) and
 * deterministic: identical input always yields an identical array.
 *
 * Never throws, for any input: a missing, malformed or hostile turn yields [].
 */
export function classifyLearningSignals(input: {
  message?: unknown;
  trace?: unknown;
}): LearningSignalKind[] {
  try {
    const source = (input ?? {}) as Record<string, unknown>;
    const kinds: LearningSignalKind[] = [];

    const user = classifyUserSignal(source["message"]);
    if (user !== null) kinds.push(user);

    const tool = classifyToolOutcome(source["trace"]);
    if (tool !== null) kinds.push(tool);

    return kinds;
  } catch {
    return [];
  }
}

/**
 * True only when the turn produced at least one learning signal.
 *
 * Thin wrapper over classifyLearningSignals, so the accepted set has exactly
 * one definition. Never throws.
 */
export function hasLearningSignal(input: {
  message?: unknown;
  trace?: unknown;
}): boolean {
  try {
    return classifyLearningSignals(input).length > 0;
  } catch {
    return false;
  }
}
