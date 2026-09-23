/**
 * Procedural memory entry point (Priority 3).
 *
 * Single responsibility: decide whether a request becomes a procedural memory
 * or a deferral, behind ENABLE_PROCEDURAL_MEMORY.
 *
 * Order of checks:
 *   1. ENABLE_PROCEDURAL_MEMORY off (or unreadable) -> "procedural_disabled"
 *   2. unusable request (missing/oversized message) -> "invalid_request"
 *   3. not a procedural request -> "not_procedural"
 *   4. otherwise extract: the model-backed memory when the reply validates,
 *      the deterministic skeleton otherwise
 *
 * Extraction lives in `./extract`: one model call asked for a single JSON
 * object, with the skeleton as the safe fallback when the model fails or its
 * reply does not validate. The skeleton derives a stable, capped shape from
 * the user's own words and invents nothing. Either way there is no database
 * read and no database write: the memory writer arrives in a later, separately
 * reviewed step.
 *
 * Additive only. Nothing imports this module in production yet: the existing
 * extractor (`lib/memory/extractor.ts`, `lib/memory/aiExtractor.ts`), the
 * memory job worker, `lib/memory/upsertMemory.ts` and the chat route are all
 * untouched. No change to the `procedural` memory type, its weights, its
 * half-life, its token budget or `INJECT_CAPS` in `lib/memory/constants.ts`.
 * No database reads or writes anywhere in this module.
 */

import { isFeatureEnabled } from "@/lib/config/features";
import type { FeatureFlag } from "@/lib/config/features";
import type { ExtractDeps } from "./extract";
import { MAX_PROCEDURAL_GOAL_CHARS, extractProceduralMemory } from "./extract";
import { classifyProceduralKind, isProceduralRequest } from "./gate";
import type {
  ProceduralKind,
  ProceduralOutcome,
  ProceduralRequest,
} from "./types";

/**
 * The skeleton fallback and its caps are re-exported from `./extract` so the
 * module keeps one public surface and one source of truth for both.
 */
export {
  MAX_PROCEDURAL_GOAL_CHARS,
  MAX_SKELETON_ACTION_CHARS,
  MAX_SKELETON_NAME_CHARS,
  SKELETON_CONFIDENCE,
  SKELETON_STEP_ID,
  skeletonMemory,
} from "./extract";
export type { ProceduralChatProvider } from "./extract";

/** Injectable flag predicate. Defaults to the real feature-flag reader. */
export type ProceduralFlagReader = (flag: FeatureFlag) => boolean;

/** Injectable gate. Defaults to the deterministic procedural classifier. */
export type ProceduralGate = (message: unknown) => boolean;

/** Injectable dependencies. Every field is optional; defaults are production. */
export interface ProceduralDeps extends ExtractDeps {
  /** Defaults to isFeatureEnabled() from the feature flags. */
  isFlagEnabled?: ProceduralFlagReader;
  /** Defaults to isProceduralRequest(). */
  isProcedural?: ProceduralGate;
}

/** Every kind, in canonical order, for diagnostics and tests. */
export const PROCEDURAL_KINDS: readonly ProceduralKind[] = Object.freeze([
  "skill",
  "strategy",
  "workflow",
]);

/** Resolves the flag without ever enabling extraction on error. Never throws. */
function isProceduralEnabled(deps: ProceduralDeps): boolean {
  try {
    if (deps.isFlagEnabled) {
      return deps.isFlagEnabled("ENABLE_PROCEDURAL_MEMORY") === true;
    }

    return isFeatureEnabled("ENABLE_PROCEDURAL_MEMORY") === true;
  } catch {
    return false;
  }
}

/** Extracts a usable message from the request. Never throws. */
function requestMessage(request: ProceduralRequest): string | null {
  try {
    const message = (
      request as unknown as Record<string, unknown> | null | undefined
    )?.["message"];

    if (typeof message !== "string") return null;

    const trimmed = message.trim();

    if (trimmed === "") return null;

    if (trimmed.at(MAX_PROCEDURAL_GOAL_CHARS) !== undefined) return null;

    return trimmed;
  } catch {
    return null;
  }
}

/**
 * Extracts or defers. Never throws, for any input, and never writes.
 *
 * Returns "extracted" with the model-backed memory when the flag is on and the
 * gate accepts the message, degrading to the deterministic skeleton whenever
 * the model fails or its reply does not validate; otherwise a content-free
 * "deferred" reason.
 */
export async function extractOrDefer(
  request: ProceduralRequest,
  deps: ProceduralDeps = {},
): Promise<ProceduralOutcome> {
  try {
    if (!isProceduralEnabled(deps)) {
      return { kind: "deferred", reason: "procedural_disabled" };
    }

    const message = requestMessage(request);

    if (message === null) {
      return { kind: "deferred", reason: "invalid_request" };
    }

    let accepted: boolean;

    try {
      accepted = (deps.isProcedural ?? isProceduralRequest)(message) === true;
    } catch {
      return { kind: "deferred", reason: "not_procedural" };
    }

    if (!accepted) {
      return { kind: "deferred", reason: "not_procedural" };
    }

    // The classifier is deterministic, so a null here is impossible after an
    // accepted gate; "workflow" is the documented fallback in that case.
    const kind = classifyProceduralKind(message) ?? "workflow";

    try {
      const memory = await extractProceduralMemory(message, kind, deps);

      return { kind: "extracted", memory };
    } catch {
      return { kind: "deferred", reason: "invalid_request" };
    }
  } catch {
    return { kind: "deferred", reason: "invalid_request" };
  }
}

/** True when the outcome carries a memory. Never throws. */
export function isExtractedOutcome(value: unknown): value is ProceduralOutcome {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    const candidate = value as Record<string, unknown>;

    if (candidate["kind"] === "extracted") {
      return (
        candidate["memory"] !== null && typeof candidate["memory"] === "object"
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
