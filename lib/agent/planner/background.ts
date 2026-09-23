/**
 * AI planning background job (Priority 2).
 *
 * Runs `generateAndPersistPlan` off the request's critical path: the route
 * schedules this from `after(...)`, which executes after the response has been
 * produced, so planning can never delay or break a reply.
 *
 * Why not a new `job_type` on `memory_jobs`? The durable queue cannot host it
 * without changing core behavior:
 *   1. `claim_memory_jobs` claims every due `pending` row for the user; it does
 *      not filter on `job_type`.
 *   2. `processMemoryJobs` dispatches each claimed row to `runMemoryMaintenance`
 *      based only on `payload.message` + `message_id`.
 * A planning row would therefore be claimed and processed as *memory
 * maintenance*, and filtering it out would mean editing `processMemoryJobs` in
 * `lib/core/pipeline.ts`, which is out of scope for this step.
 *   3. `memory_jobs` has no INSERT policy (mutation is RPC-only), so enqueueing
 *      would need a new SECURITY DEFINER RPC in a migration.
 * Documented design therefore keeps Priority 2 migration-free and adds no
 * `job_type`: planning rides the existing `after()` pattern instead.
 *
 * Safety properties, all unit tested:
 *  - Never throws, and never rejects. `schedulePlanningJob` returns void
 *    synchronously; `runPlanningJob` always resolves to a PlanningJobResult.
 *  - Does nothing when ENABLE_AI_PLANNER is off (or unreadable): the gate is
 *    not consulted, the model is not called, the repository is not touched.
 *  - Cheap rejection first: the deterministic gate runs before any model call,
 *    so ordinary chat messages never cost a completion.
 *  - Content-free telemetry: a status line and a fixed failure token. Never the
 *    user's message, the plan, or an error message.
 *
 * Background only. The only caller is `app/api/chat/route.ts`, from inside a
 * flag-guarded `after(...)`. Nothing here is reachable while the flag is off.
 */

import { isFeatureEnabled } from "@/lib/config/features";
import type { FeatureFlag } from "@/lib/config/features";
import { isPlanningRequest } from "./gate";
import { generateAndPersistPlan } from "./persist";
import type { GenerateAndPersistDeps, PlanPersistStatus } from "./persist";
import type { AiPlanRequest } from "./types";

/** Log tag. Fixed strings only, so logs never carry user content. */
export const PLANNER_LOG_TAG = "BACKGROUND PLANNER";

/** Fixed, content-free failure token. */
export const PLANNER_FAILURE_TOKEN = "unexpected_error";

/** "planned" wrote a plan, "deferred" declined one, "skipped" never tried. */
export type PlanningJobStatus = "planned" | "deferred" | "skipped";

/** Why the job stopped without producing a persisted plan. */
export type PlanningJobReason =
  | "planner_disabled"
  | "invalid_request"
  | "not_planning_request"
  | "unexpected_error";

/** Outcome of one background planning attempt. Never an exception. */
export interface PlanningJobResult {
  status: PlanningJobStatus;
  /** Null only for "planned". Always content-free. */
  reason: PlanningJobReason | null;
  /** Persist status when a plan was written; null when nothing was written. */
  persistence: PlanPersistStatus | null;
}

/** Injectable flag predicate. Defaults to the real feature-flag reader. */
export type PlanningFlagReader = (flag: FeatureFlag) => boolean;

/** Injectable dependencies. Every field is optional; defaults are production. */
export interface PlanningJobDeps extends GenerateAndPersistDeps {
  /** Defaults to isFeatureEnabled() from the feature flags. */
  isFlagEnabled?: PlanningFlagReader;
  /** Defaults to isPlanningRequest(). */
  isPlanning?: (message: unknown) => boolean;
  /** Content-free status sink. Defaults to console.log. */
  onLog?: (line: string) => void;
  /** Failure sink; `error` is for callers/tests, never for logs. */
  onError?: (reason: string, error: unknown) => void;
}

/** Resolves ENABLE_AI_PLANNER, never enabling planning on error. Never throws. */
export function isPlanningJobEnabled(deps: PlanningJobDeps = {}): boolean {
  try {
    if (deps.isFlagEnabled) {
      return deps.isFlagEnabled("ENABLE_AI_PLANNER") === true;
    }

    return isFeatureEnabled("ENABLE_AI_PLANNER") === true;
  } catch {
    return false;
  }
}

/** Reads the owner id without throwing. Empty means "unusable". */
function readUserId(request: AiPlanRequest): string {
  try {
    const userId = (
      request as unknown as Record<string, unknown> | null | undefined
    )?.["userId"];

    return typeof userId === "string" ? userId : "";
  } catch {
    return "";
  }
}

/** A terminal result that produced no plan. Never throws. */
function skipped(reason: PlanningJobReason): PlanningJobResult {
  return { status: "skipped", reason, persistence: null };
}

/** Content-free status line: tokens only, never message or plan text. */
function toLogLine(result: PlanningJobResult): string {
  return (
    `${PLANNER_LOG_TAG} status=${result.status}` +
    ` reason=${result.reason ?? "none"}` +
    ` persistence=${result.persistence ?? "none"}`
  );
}

/** Emits one status line. Telemetry must never break the job. Never throws. */
function safeLog(result: PlanningJobResult, deps: PlanningJobDeps): void {
  try {
    const line = toLogLine(result);

    if (deps.onLog) {
      deps.onLog(line);
      return;
    }

    console.log(line);
  } catch {
    // ignore: a failing logger is not a planning failure
  }
}

/** Reports a failure to the caller/test. Never throws, never logs content. */
function safeError(error: unknown, deps: PlanningJobDeps): void {
  try {
    deps.onError?.(PLANNER_FAILURE_TOKEN, error);
  } catch {
    // ignore: a failing error sink is not a planning failure
  }
}

/**
 * Runs one background planning attempt. Never throws, never rejects.
 *
 * Order of checks keeps the common case free:
 *   1. ENABLE_AI_PLANNER off -> skip, no gate, no model, no repository
 *   2. unusable request -> skip
 *   3. deterministic gate -> ordinary chat never costs a completion
 *   4. generate (and persist only when the caller asked) -> planned/deferred
 */
export async function runPlanningJob(
  request: AiPlanRequest,
  deps: PlanningJobDeps = {},
): Promise<PlanningJobResult> {
  try {
    if (!isPlanningJobEnabled(deps)) {
      return skipped("planner_disabled");
    }

    const message = readMessage(request);

    if (message === null) {
      return skipped("invalid_request");
    }

    let planning: boolean;

    try {
      planning = (deps.isPlanning ?? isPlanningRequest)(message) === true;
    } catch {
      planning = false;
    }

    if (!planning) {
      return skipped("not_planning_request");
    }

    // Background work exists to persist, so persistence defaults to on here
    // (still overridable for callers/tests that only want a dry run).
    const outcome = await generateAndPersistPlan(
      { userId: readUserId(request), message },
      { ...deps, persist: deps.persist ?? true },
    );

    const result: PlanningJobResult =
      outcome.kind === "planned"
        ? {
            status: "planned",
            reason: null,
            persistence: outcome.persistence?.status ?? null,
          }
        : {
            status: "deferred",
            reason: outcome.reason,
            persistence: null,
          };

    safeLog(result, deps);

    return result;
  } catch (error) {
    safeError(error, deps);

    return skipped("unexpected_error");
  }
}

/**
 * Fire-and-forget scheduling hook for `after(...)` in the chat route.
 *
 * Always resolves; never rejects; never throws. Returns immediately when
 * ENABLE_AI_PLANNER is off, so scheduling is inert by default. The route
 * already guards with the same flag, making this a second, independent gate.
 */
export async function schedulePlanningJob(
  request: AiPlanRequest,
  deps: PlanningJobDeps = {},
): Promise<void> {
  try {
    if (!isPlanningJobEnabled(deps)) return;

    await runPlanningJob(request, deps);
  } catch (error) {
    safeError(error, deps);
  }
}

/** Reads a usable message without throwing. */
function readMessage(request: AiPlanRequest): string | null {
  try {
    const message = (
      request as unknown as Record<string, unknown> | null | undefined
    )?.["message"];

    if (typeof message !== "string") return null;

    const trimmed = message.trim();

    return trimmed === "" ? null : trimmed;
  } catch {
    return null;
  }
}
