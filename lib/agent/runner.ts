/**
 * Agent runner: the single entry point the future route branch will call.
 *
 * Takes the pipeline result verbatim (AgentTurnInput = PreStreamResult) and
 * returns an AgentOutcome. Never throws, for any input: flags OFF, ordinary
 * chat, and every loop failure all degrade to a fallback outcome so the
 * caller runs the existing single-call chat path instead.
 *
 * Order of checks (docs/AGENT_LOOP_DESIGN.md section 4.1):
 *   1. agent mode requires BOTH flags; otherwise "flags_disabled"
 *   2. deterministic gate; ordinary chat returns "gate_chat"
 *   3. bounded loop; any loop failure returns its own fallback
 *   4. anything unexpected returns "unexpected_error"
 *
 * Additive only. Nothing imports this module in production yet: the single
 * flag-gated route branch arrives in a later, separately reviewed step. No
 * change to `app/api/chat/route.ts`, `lib/core/*`, `lib/brain/*`,
 * `lib/memory/*`, or any provider file.
 *
 * Testability: the loop and the flag predicate are injectable so tests never
 * depend on process.env or the network. Production callers omit them, which
 * uses isAgentModeEnabled() and runAgentLoop() unchanged.
 */

import { isAgentModeEnabled } from "@/lib/config/features";
import type { FeatureFlag } from "@/lib/config/features";
import { classifyIntent } from "./gate";
import type { AgentLoopDeps } from "./loop";
import { createFallback } from "./fallback";
import type { AgentOutcome, AgentTurnInput } from "./types";

/** Injectable flag predicate. Defaults to the real feature-flag reader. */
export type RunnerFlagReader = (flag: FeatureFlag) => boolean;

/** Injectable loop. Defaults to the real bounded loop. */
export type RunnerLoop = (
  input: AgentTurnInput,
  deps?: AgentLoopDeps,
) => Promise<AgentOutcome>;

/** Injectable dependencies. Every field is optional; defaults are production. */
export interface RunnerDeps extends AgentLoopDeps {
  /** Defaults to isAgentModeEnabled() from the feature flags. */
  isAgentMode?: () => boolean;
  /** Defaults to runAgentLoop() loaded lazily to avoid import cycles. */
  runLoop?: RunnerLoop;
  /** Optional per-flag override; used only when isAgentMode is omitted. */
  isFlagEnabled?: RunnerFlagReader;
}

/** Resolves agent mode without a static production import cycle risk. */
function resolveAgentMode(deps: RunnerDeps): boolean {
  try {
    if (deps.isAgentMode) return deps.isAgentMode() === true;

    if (deps.isFlagEnabled) {
      return (
        deps.isFlagEnabled("ENABLE_AGENT_LOOP") === true &&
        deps.isFlagEnabled("ENABLE_TOOL_USE") === true
      );
    }

    return isAgentModeEnabled();
  } catch {
    return false;
  }
}

/** Resolves the loop without a static import, so the runner stays thin. */
async function resolveLoop(deps: RunnerDeps): Promise<RunnerLoop> {
  if (deps.runLoop) return deps.runLoop;

  const { runAgentLoop } = await import("./loop");

  return runAgentLoop;
}

/** Extracts the latest user message text for the gate. Never throws. */
function latestUserMessage(input: AgentTurnInput): string {
  try {
    const conversation = input?.conversation;

    if (!Array.isArray(conversation)) return "";

    for (let index = conversation.length - 1; index >= 0; index -= 1) {
      const message = conversation[index];

      if (message?.role === "user") {
        return typeof message.content === "string" ? message.content : "";
      }
    }

    return "";
  } catch {
    return "";
  }
}

/**
 * Runs one agent turn. Never throws, for any input.
 *
 * Returns answered when the loop produces a final answer, otherwise a
 * fallback naming the content-free reason the legacy path must run instead.
 */
export async function runAgentTurn(
  input: AgentTurnInput,
  deps: RunnerDeps = {},
): Promise<AgentOutcome> {
  try {
    if (!resolveAgentMode(deps)) {
      return createFallback("flags_disabled", []);
    }

    let intent: string;

    try {
      intent = classifyIntent(latestUserMessage(input));
    } catch {
      return createFallback("unexpected_error", []);
    }

    if (intent !== "agent") return createFallback("gate_chat", []);

    let loop: RunnerLoop;

    try {
      loop = await resolveLoop(deps);
    } catch {
      return createFallback("unexpected_error", []);
    }

    try {
      const outcome = await loop(input, deps);

      if (isValidOutcome(outcome)) return outcome;

      return createFallback("unexpected_error", []);
    } catch {
      return createFallback("unexpected_error", []);
    }
  } catch {
    return { kind: "fallback", reason: "unexpected_error", trace: [] };
  }
}

/** Validates a loop result before handing it to the caller. Never throws. */
function isValidOutcome(value: unknown): value is AgentOutcome {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    const candidate = value as Record<string, unknown>;

    if (candidate["kind"] === "answered") {
      return (
        typeof candidate["response"] === "string" &&
        Array.isArray(candidate["trace"])
      );
    }

    if (candidate["kind"] === "fallback") {
      return (
        typeof candidate["reason"] === "string" &&
        Array.isArray(candidate["trace"])
      );
    }

    return false;
  } catch {
    return false;
  }
}
