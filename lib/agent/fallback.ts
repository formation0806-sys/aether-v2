/**
 * Agent fallback.
 *
 * Single responsibility: turn any agent-loop failure into a safe fallback
 * outcome so the caller runs the existing single-call chat path instead.
 * The route therefore never observes an agent error and `runAgentTurn` can
 * never throw into the route (docs/AGENT_LOOP_DESIGN.md section 4.4).
 *
 * Additive only. Nothing imports this module in production yet: the loop and
 * the runner arrive in later, separately reviewed steps. No change to
 * `app/api/chat/route.ts`, `lib/core/*`, `lib/brain/*`, `lib/memory/*`, or
 * any provider file.
 *
 * Pure and side-effect free: type-only imports, no environment reads, no
 * clock, no randomness, no timers, no I/O. Every exported function never
 * throws, for any input, and always returns a valid `AgentOutcome` with
 * `kind: "fallback"`. Failure content is deliberately dropped: the outcome
 * carries only the content-free reason and the caller-supplied trace copy.
 */

import type {
  AgentFallbackReason,
  AgentOutcome,
  AgentTraceStep,
} from "./types";

/** Every fallback reason, for validation and tests. */
export const FALLBACK_REASONS: readonly AgentFallbackReason[] = Object.freeze([
  "flags_disabled",
  "gate_chat",
  "provider_error",
  "budget_exhausted",
  "unexpected_error",
] as const);

/** Default reason when the caller passes anything unusable. */
export const DEFAULT_FALLBACK_REASON: AgentFallbackReason = "unexpected_error";

/**
 * True only for the exact reason strings declared in `AgentFallbackReason`.
 * Never throws.
 */
export function isFallbackReason(value: unknown): value is AgentFallbackReason {
  try {
    return (
      value === "flags_disabled" ||
      value === "gate_chat" ||
      value === "provider_error" ||
      value === "budget_exhausted" ||
      value === "unexpected_error"
    );
  } catch {
    return false;
  }
}

/**
 * Normalizes any value to a valid reason. Unknown, missing, or non-string
 * input becomes `"unexpected_error"`, so the loop can forward whatever it
 * has without guarding first. Never throws.
 */
export function normalizeFallbackReason(value: unknown): AgentFallbackReason {
  try {
    if (isFallbackReason(value)) return value;
  } catch {
    // Fall through to the default below.
  }

  return DEFAULT_FALLBACK_REASON;
}

/**
 * Copies a caller-supplied trace into a fresh array owned by the outcome.
 *
 * Non-array input becomes `[]`. Non-object entries are dropped rather than
 * passed through, so a malformed trace can never produce an invalid
 * outcome. The input array is never mutated. Never throws.
 */
export function sanitizeFallbackTrace(trace: unknown): AgentTraceStep[] {
  try {
    if (!Array.isArray(trace)) return [];

    const copy: AgentTraceStep[] = [];

    for (const entry of trace) {
      try {
        if (entry !== null && typeof entry === "object") {
          copy.push(entry as AgentTraceStep);
        }
      } catch {
        // Skip a single bad entry and keep sanitizing the rest.
      }
    }

    return copy;
  } catch {
    return [];
  }
}

/**
 * Builds a fallback outcome for the given reason and trace.
 *
 * Never throws, for any input. The trace is copied, so later mutation of
 * the caller array cannot change the outcome.
 */
export function createFallback(
  reason: unknown,
  trace: unknown = [],
): AgentOutcome {
  try {
    return {
      kind: "fallback",
      reason: normalizeFallbackReason(reason),
      trace: sanitizeFallbackTrace(trace),
    };
  } catch {
    return {
      kind: "fallback",
      reason: DEFAULT_FALLBACK_REASON,
      trace: [],
    };
  }
}

/**
 * Builds a fallback outcome from a caught error.
 *
 * The error value is intentionally ignored beyond mapping to a reason: error
 * text may contain message, memory, or provider content that must never flow
 * into telemetry through this path. Pass an explicit reason when the failure
 * class is known (for example `"provider_error"`); anything unusable falls
 * back to `"unexpected_error"`. Never throws.
 */
export function fallbackFromError(
  _error: unknown,
  trace: unknown = [],
  reason: unknown = DEFAULT_FALLBACK_REASON,
): AgentOutcome {
  try {
    return createFallback(normalizeFallbackReason(reason), trace);
  } catch {
    return {
      kind: "fallback",
      reason: DEFAULT_FALLBACK_REASON,
      trace: [],
    };
  }
}

/**
 * True when the outcome hands control back to the legacy chat path.
 * Never throws.
 */
export function isFallbackOutcome(value: unknown): value is AgentOutcome {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    const candidate = value as Record<string, unknown>;

    if (candidate["kind"] !== "fallback") return false;

    if (!isFallbackReason(candidate["reason"])) return false;

    return Array.isArray(candidate["trace"]);
  } catch {
    return false;
  }
}
