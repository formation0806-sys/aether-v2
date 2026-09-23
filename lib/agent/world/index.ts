/**
 * World-model entry point (Priority 6).
 *
 * Single responsibility: decide whether a request produces a built outcome or
 * a deferral, behind ENABLE_WORLD_MODEL, and return the snapshot plus the
 * predictions and update proposals the request asked for. Nothing is written:
 * no database read, no database write, no provider call, no tool call anywhere
 * in this module - the caller supplies every input.
 *
 * Order of checks, mirroring recordLearning / planOrDefer / extractOrDefer:
 *   1. ENABLE_WORLD_MODEL off (or unreadable) -> "world_disabled"
 *   2. unusable request (not an object, or missing/blank userId)
 *      -> "invalid_request"
 *   3. otherwise build: snapshot from ./snapshot, then - only when the
 *      request carries them - predictions from ./predict and update
 *      proposals from ./update
 *
 * A request with no memories, goals, action, or observation is valid: it
 * builds an empty-but-real snapshot rather than deferring, because "nothing is
 * known yet" is itself a state a predictor can act on.
 *
 * Additive only. Nothing imports this module in production: the agent loop,
 * the runner, the tools, the planner, the memory pipeline, the continual
 * learning modules, and the chat route are all untouched.
 */

import { isFeatureEnabled } from "@/lib/config/features";
import type { FeatureFlag } from "@/lib/config/features";
import { buildWorldState } from "./snapshot";
import { predictEffects } from "./predict";
import { proposeWorldUpdates } from "./update";
import { MAX_WORLD_ID_CHARS } from "./constants";
import type {
  WorldModelOutcome,
  WorldUpdate,
} from "./types";

/** The one flag that gates this capability. Off unless explicitly enabled. */
export const WORLD_MODEL_FLAG: FeatureFlag = "ENABLE_WORLD_MODEL";

/** Injectable flag predicate. Defaults to the real feature-flag reader. */
export type WorldFlagReader = (flag: FeatureFlag) => boolean;

/** Injectable dependencies. Every field is optional; defaults are production. */
export interface WorldDeps {
  /** Defaults to isFeatureEnabled() from the feature flags. */
  isFlagEnabled?: WorldFlagReader;
}

/** Resolves the flag without ever enabling the capability on error. Never throws. */
function isWorldEnabled(deps: WorldDeps): boolean {
  try {
    if (deps.isFlagEnabled) {
      return deps.isFlagEnabled(WORLD_MODEL_FLAG) === true;
    }
    return isFeatureEnabled(WORLD_MODEL_FLAG) === true;
  } catch {
    return false;
  }
}

/** Reads the userId defensively; null means the request was unusable. */
function requestUserId(request: unknown): string | null {
  try {
    if (request === null || typeof request !== "object" || Array.isArray(request)) {
      return null;
    }
    const userId = (request as Record<string, unknown>)["userId"];
    if (typeof userId !== "string") return null;
    const trimmed = userId.trim();
    if (trimmed === "" || trimmed.length > MAX_WORLD_ID_CHARS) return null;
    return trimmed;
  } catch {
    return null;
  }
}

/** True only for a defensive object view of an action field. Never throws. */
function hasAction(request: Record<string, unknown>): boolean {
  try {
    const action = request["action"];
    return action !== null && typeof action === "object" && !Array.isArray(action);
  } catch {
    return false;
  }
}

/** True only for a defensive object view of an observation field. Never throws. */
function hasObservation(request: Record<string, unknown>): boolean {
  try {
    const observation = request["observation"];
    return (
      observation !== null && typeof observation === "object" && !Array.isArray(observation)
    );
  } catch {
    return false;
  }
}

/**
 * Builds the world model for one request: snapshot, then - only when the
 * request carries them - effect predictions and update proposals. Flag-gated,
 * never throws: every failure is folded into a content-free deferral.
 */
export async function buildWorldModel(
  request: unknown,
  deps: WorldDeps = {},
): Promise<WorldModelOutcome> {
  try {
    const safeDeps: WorldDeps = (() => {
      try {
        if (deps === null || typeof deps !== "object" || Array.isArray(deps)) return {};
        return deps;
      } catch {
        return {};
      }
    })();

    if (!isWorldEnabled(safeDeps)) {
      return { kind: "deferred", reason: "world_disabled" };
    }

    const userId = requestUserId(request);
    if (userId === null) {
      return { kind: "deferred", reason: "invalid_request" };
    }

    const state = buildWorldState(request);
    const source = request as Record<string, unknown>;

    let predictions = [] as ReturnType<typeof predictEffects>;
    try {
      if (hasAction(source)) predictions = predictEffects(state, source["action"]);
    } catch {
      predictions = [];
    }

    let updates: WorldUpdate[] = [];
    try {
      if (hasObservation(source)) {
        updates = proposeWorldUpdates(state, source["observation"]);
      }
    } catch {
      updates = [];
    }

    return { kind: "built", state, predictions, updates };
  } catch {
    return { kind: "deferred", reason: "invalid_request" };
  }
}

/** The snapshot builder, the predictor, and the update proposer. */
export { buildWorldState } from "./snapshot";
export { predictEffects } from "./predict";
export { proposeWorldUpdates } from "./update";

/** Bounds, vocabulary, and helpers, so the module has one public surface. */
export {
  MAX_WORLD_ASOF_CHARS,
  MAX_WORLD_ENTITIES,
  MAX_WORLD_ID_CHARS,
  MAX_WORLD_LABEL_CHARS,
  MAX_WORLD_RELATIONS,
  MAX_WORLD_UPDATES,
  WORLD_PREDICT_CONFIDENCE,
  WORLD_RELATION_KINDS,
  clampWorldDelta,
  isWorldRelationKind,
  safeUnit01,
  safeWorldId,
  safeWorldLabel,
} from "./constants";

/** The types this module's callers need. */
export type {
  CandidateAction,
  CandidateActionKind,
  PredictedEffect,
  WorldDeferReason,
  WorldEffectKind,
  WorldEntity,
  WorldEntityKind,
  WorldEntityStatus,
  WorldGoalInput,
  WorldMemoryInput,
  WorldModelOutcome,
  WorldObservation,
  WorldRelation,
  WorldRelationInput,
  WorldRelationKind,
  WorldRequest,
  WorldState,
  WorldTaskInput,
  WorldUpdate,
} from "./types";

