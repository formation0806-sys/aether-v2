/**
 * AI plan persistence (Priority 2).
 *
 * Writes an AiPlan through the existing planner repository only
 * (insertGoal / insertProject / insertMilestone / insertTask). No new tables,
 * no migration, no schema change, no direct Supabase access.
 *
 * Mapping. The AI plan is three levels deep, the legacy schema four:
 *   plan.goal    -> goals       (one row: the goal in the user's words)
 *   (container)  -> projects    (one row: the plan itself, linked to the goal)
 *   subGoal      -> milestones  (one row per sub-goal, under the container)
 *   step         -> tasks       (one row per step, under its sub-goal)
 * Every plan entity is written exactly once, so nothing is duplicated.
 *
 * Safety properties, all unit tested:
 *  - Never throws. Every failure is returned as a PlanPersistResult.
 *  - Idempotent. Row ids are deterministic UUIDs derived from the user and
 *    the goal, so re-persisting the same plan collides on the primary key and
 *    is counted as `duplicates` (Postgres 23505) instead of failing.
 *  - Bounded. A parent row that fails (not a duplicate) short-circuits its
 *    subtree, so one failure never cascades into foreign-key noise.
 *  - Content-free telemetry. A failure carries a table, the derived id, and a
 *    Postgres error code only - never user text and never error messages.
 *  - No flags read here. generateAndPersistPlan delegates the single
 *    ENABLE_AI_PLANNER check to planOrDefer, and persistence is opt-in
 *    (`persist: true`), so nothing writes unless a caller explicitly asks.
 *
 * Background-only. Nothing imports this module in production yet: neither the
 * chat route nor the job worker calls it, so no live path can reach a write.
 */

import { planOrDefer } from "./index";
import type { PlannerDeps } from "./index";
import type {
  AiPlan,
  AiPlanDeferReason,
  AiPlanPriority,
  AiPlanRequest,
  AiPlanStepStatus,
} from "./types";

/** Hard caps applied to persisted text and row counts. */
export const MAX_PERSIST_TITLE_CHARS = 120;
export const MAX_PERSIST_DESCRIPTION_CHARS = 500;
export const MAX_PERSIST_SUB_GOALS = 16;
export const MAX_PERSIST_STEPS = 64;

/** Postgres unique_violation: the row id already exists, so this is a no-op. */
export const DUPLICATE_KEY_CODE = "23505";

/** Planner table that received one write attempt. */
export type PlanPersistTable = "goal" | "project" | "milestone" | "task";

/**
 * "persisted": nothing failed. "partial": some rows settled, some failed.
 * "failed": every attempted row failed. "skipped": nothing was attempted.
 */
export type PlanPersistStatus = "persisted" | "partial" | "failed" | "skipped";

/** Why persistence was skipped, short-circuited, or reported as failed. */
export type PlanPersistReason =
  | "invalid_user"
  | "invalid_plan"
  | "empty_plan"
  | "write_failed"
  | "repository_unavailable";

/** One failed write. Content-free: table, derived id, Postgres code only. */
export interface PlanPersistFailure {
  table: PlanPersistTable;
  id: string;
  code: string | null;
}

/** Outcome of one persist attempt. Never an exception. */
export interface PlanPersistResult {
  status: PlanPersistStatus;
  /** Null when nothing went wrong; a reason otherwise. */
  reason: PlanPersistReason | null;
  /** Derived goal id, or null when the plan was rejected before id derivation. */
  goalId: string | null;
  /** Newly inserted rows per table. */
  inserted: Record<PlanPersistTable, number>;
  /** Rows that already existed (primary-key collision on a re-run). */
  duplicates: number;
  /** Attempted writes that failed, in attempt order. */
  failed: PlanPersistFailure[];
}

/** The subset of the planner repository this module writes through. */
export interface PlanRepository {
  insertGoal(data: {
    id: string;
    user_id: string;
    title: string;
    description: string;
  }): Promise<unknown>;
  insertProject(data: {
    id: string;
    user_id: string;
    title: string;
    description: string;
    goal_id?: string | null;
  }): Promise<unknown>;
  insertMilestone(data: {
    id: string;
    project_id: string;
    title: string;
  }): Promise<unknown>;
  insertTask(data: {
    id: string;
    milestone_id?: string | null;
    title: string;
    description?: string;
    priority: string;
    status: string;
    deadline?: string | null;
    next_action?: string | null;
  }): Promise<unknown>;
}

/** Injectable dependencies. Defaults are production behavior. */
export interface PersistDeps {
  /** Defaults to the real planner repository, loaded lazily. */
  repository?: PlanRepository;
}

/** Dependencies of the combined generate-then-persist entry point. */
export interface GenerateAndPersistDeps extends PlannerDeps, PersistDeps {
  /** When true the generated plan is persisted. Defaults to false (inert). */
  persist?: boolean;
}

/** Outcome of one generate-and-optionally-persist call. Never throws. */
export type GenerateAndPersistOutcome =
  | {
      kind: "planned";
      plan: AiPlan;
      /** Null when persistence was not requested. */
      persistence: PlanPersistResult | null;
    }
  | {
      kind: "deferred";
      reason: AiPlanDeferReason;
      persistence: null;
    };


/** Caps one line of text, collapsing whitespace. Never throws. */
function capText(value: unknown, max: number): string {
  try {
    if (typeof value !== "string") return "";

    const collapsed = value.replace(/\s+/g, " ").trim();

    if (collapsed === "") return "";

    return collapsed.length > max ? collapsed.slice(0, max) : collapsed;
  } catch {
    return "";
  }
}

/**
 * Derives a stable UUID (version 4 variant 8 layout) from parts via FNV-1a.
 *
 * Deterministic on purpose: the same user and goal always map to the same
 * row ids, which makes persistence idempotent through the primary key even
 * though the planner repository takes no upsert options. Synchronous, so no
 * crypto import is needed and no I/O or clock is involved. These ids are
 * internal row identifiers only - never presented as security tokens.
 */
export function derivePlanUuid(...parts: string[]): string {
  const seed = parts
    .map((part) => (typeof part === "string" ? part : ""))
    .join("\u0000");

  const bytes: number[] = [];

  for (let block = 0; block < 4; block += 1) {
    let hash = 0x811c9dc5 ^ (block * 0x9e3779b1);

    for (let index = 0; index < seed.length; index += 1) {
      hash ^= seed.charCodeAt(index) & 0xff;
      hash = Math.imul(hash, 0x01000193) >>> 0;
      hash ^= (seed.charCodeAt(index) >>> 8) & 0xff;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }

    hash = Math.imul(hash ^ (seed.length + block), 0x01000193) >>> 0;

    bytes.push((hash >>> 24) & 0xff);
    bytes.push((hash >>> 16) & 0xff);
    bytes.push((hash >>> 8) & 0xff);
    bytes.push(hash & 0xff);
  }

  // Pin the version (4) and variant (8..b) nibbles so the value is a
  // well-formed UUID rather than 16 arbitrary bytes.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/** True for a syntactically valid UUID. Never throws. */
export function isUuidLike(value: unknown): boolean {
  try {
    return (
      typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
      )
    );
  } catch {
    return false;
  }
}

/** One row planned for insertion. */
interface PlannedRow {
  table: PlanPersistTable;
  id: string;
  /** Id of the parent row, or "" for the goal row. */
  parentId: string;
  data: Record<string, unknown>;
}

/** Everything a persist run needs, or null when the input is unusable. */
interface PlannedRows {
  goalId: string;
  rows: PlannedRow[];
  subGoals: number;
  steps: number;
}

/**
 * Validates the plan and maps it onto the legacy four-table shape.
 * Pure: no I/O, no writes, no clock. Returns null when unusable.
 */
export function mapPlanToRows(plan: AiPlan, userId: string): PlannedRows | null {
  try {
    if (!isUuidLike(userId)) return null;

    if (plan === null || typeof plan !== "object" || Array.isArray(plan)) {
      return null;
    }

    const goal = capText((plan as AiPlan).goal, MAX_PERSIST_TITLE_CHARS);

    if (goal === "") return null;

    const subGoals = Array.isArray(plan.subGoals)
      ? plan.subGoals.slice(0, MAX_PERSIST_SUB_GOALS)
      : [];

    const steps = Array.isArray(plan.steps)
      ? plan.steps.slice(0, MAX_PERSIST_STEPS)
      : [];

    if (subGoals.length === 0 || steps.length === 0) return null;

    const rows: PlannedRow[] = [];
    const goalId = derivePlanUuid(userId, "goal", goal);
    const projectId = derivePlanUuid(userId, "project", goal);

    rows.push({
      table: "goal",
      id: goalId,
      parentId: "",
      data: {
        id: goalId,
        user_id: userId,
        title: goal,
        description: `${steps.length} step(s) across ${subGoals.length} sub-goal(s).`,
      },
    });

    rows.push({
      table: "project",
      id: projectId,
      parentId: goalId,
      data: {
        id: projectId,
        user_id: userId,
        title: goal,
        description: "AI planner plan.",
        goal_id: goalId,
      },
    });

    const milestoneBySubGoal = new Map<string, string>();

    for (let index = 0; index < subGoals.length; index += 1) {
      const entry = subGoals[index];

      if (entry === null || typeof entry !== "object") continue;

      const title = capText(
        (entry as { title?: unknown }).title,
        MAX_PERSIST_TITLE_CHARS,
      );

      if (title === "") continue;

      const milestoneId = derivePlanUuid(
        projectId,
        "milestone",
        ordinal(index + 1),
        title,
      );

      const rawId = (entry as { id?: unknown }).id;

      if (typeof rawId === "string" && rawId !== "") {
        milestoneBySubGoal.set(rawId, milestoneId);
      }

      rows.push({
        table: "milestone",
        id: milestoneId,
        parentId: projectId,
        data: { id: milestoneId, project_id: projectId, title },
      });
    }

    if (milestoneBySubGoal.size === 0) return null;

    let stepCount = 0;

    for (let index = 0; index < steps.length; index += 1) {
      const entry = steps[index];

      if (entry === null || typeof entry !== "object") continue;

      const step = entry as {
        title?: unknown;
        nextAction?: unknown;
        subGoalId?: unknown;
        priority?: unknown;
        status?: unknown;
      };

      const title = capText(step.title, MAX_PERSIST_TITLE_CHARS);

      if (title === "") continue;

      const milestoneId = milestoneBySubGoal.get(
        typeof step.subGoalId === "string" ? step.subGoalId : "",
      );

      if (milestoneId === undefined) continue;

      const nextAction = capText(
        step.nextAction,
        MAX_PERSIST_DESCRIPTION_CHARS,
      );

      const taskId = derivePlanUuid(
        milestoneId,
        "task",
        ordinal(stepCount + 1),
        title,
      );

      stepCount += 1;

      rows.push({
        table: "task",
        id: taskId,
        parentId: milestoneId,
        data: {
          id: taskId,
          milestone_id: milestoneId,
          title,
          description: nextAction,
          priority: isPlanPriority(step.priority) ? step.priority : "medium",
          status: isPlanStepStatus(step.status) ? step.status : "todo",
          next_action: nextAction === "" ? null : nextAction,
        },
      });
    }

    if (stepCount === 0) return null;

    return {
      goalId,
      rows,
      subGoals: milestoneBySubGoal.size,
      steps: stepCount,
    };
  } catch {
    return null;
  }
}

/** An empty result. Never throws. */
function emptyResult(
  status: PlanPersistStatus,
  reason: PlanPersistReason,
): PlanPersistResult {
  return {
    status,
    reason,
    goalId: null,
    inserted: { goal: 0, project: 0, milestone: 0, task: 0 },
    duplicates: 0,
    failed: [],
  };
}

/** Postgres/PostgREST error code from an arbitrary value, or null. */
function errorCode(error: unknown): string | null {
  try {
    if (error === null || typeof error !== "object") return null;

    const code = (error as { code?: unknown }).code;

    if (typeof code === "string" && code !== "") return code;

    if (typeof code === "number") return String(code);

    return null;
  } catch {
    return null;
  }
}

/**
 * Awaits one repository call twice and reports its error, if any.
 *
 * The planner repository returns the Supabase query builder from an async
 * function, so the first await yields the thenable builder and the second
 * await performs the request. Both awaits sit inside try/catch so a sync
 * throw, a rejected promise, and a resolved `{ error }` are all handled.
 * Nothing about the response is logged or returned beyond the error code.
 */
async function attemptWrite(call: () => Promise<unknown>): Promise<unknown> {
  try {
    const builder = await call();

    return await builder;
  } catch {
    return { error: { code: null } };
  }
}

/** True when the awaited response carries no error at all. */
function isWriteOk(response: unknown): boolean {
  try {
    if (response === null || response === undefined) return true;

    if (typeof response !== "object") return true;

    const error = (response as { error?: unknown }).error;

    return error === null || error === undefined;
  } catch {
    return false;
  }
}

/**
 * True only for an object exposing the four insert functions. Never throws.
 * Guards both the injected repository and the lazily loaded module.
 */
export function isUsableRepository(value: unknown): value is PlanRepository {
  try {
    return (
      value !== null &&
      value !== undefined &&
      typeof value === "object" &&
      typeof (value as PlanRepository).insertGoal === "function" &&
      typeof (value as PlanRepository).insertProject === "function" &&
      typeof (value as PlanRepository).insertMilestone === "function" &&
      typeof (value as PlanRepository).insertTask === "function"
    );
  } catch {
    return false;
  }
}

/**
 * Resolves the planner repository lazily so importing this module pulls in no
 * Supabase client. Returns null when the repository cannot be loaded.
 */
async function loadRepository(): Promise<PlanRepository | null> {
  try {
    const repository = (await import(
      "@/lib/repositories/planner.repository"
    )) as unknown as PlanRepository;

    return isUsableRepository(repository) ? repository : null;
  } catch {
    return null;
  }
}

/** One repository write per planned row, in parent-before-child order. */
async function writeRow(
  repository: PlanRepository,
  row: PlannedRow,
): Promise<unknown> {
  switch (row.table) {
    case "goal":
      return attemptWrite(() =>
        repository.insertGoal(
          row.data as Parameters<PlanRepository["insertGoal"]>[0],
        ),
      );
    case "project":
      return attemptWrite(() =>
        repository.insertProject(
          row.data as Parameters<PlanRepository["insertProject"]>[0],
        ),
      );
    case "milestone":
      return attemptWrite(() =>
        repository.insertMilestone(
          row.data as Parameters<PlanRepository["insertMilestone"]>[0],
        ),
      );
    default:
      return attemptWrite(() =>
        repository.insertTask(
          row.data as Parameters<PlanRepository["insertTask"]>[0],
        ),
      );
  }
}

/**
 * Persists one plan through the planner repository. Never throws.
 *
 * Idempotent: derived primary keys turn a re-run into `duplicates` rather
 * than failures. Isolated: a failed parent short-circuits only its own
 * subtree, so unrelated branches still settle and the result reports which
 * table failed. The goal is the one shared dependency, so if the goal row
 * cannot be written nothing below it is attempted (reported as skipped).
 */
export async function persistPlan(
  plan: AiPlan,
  userId: string,
  deps: PersistDeps = {},
): Promise<PlanPersistResult> {
  try {
    const planned = mapPlanToRows(plan, userId);

    if (planned === null) {
      return emptyResult(
        "skipped",
        isUuidLike(userId) ? "invalid_plan" : "invalid_user",
      );
    }

    const candidate =
      deps.repository !== undefined ? deps.repository : await loadRepository();

    if (!isUsableRepository(candidate)) {
      return emptyResult("skipped", "repository_unavailable");
    }

    const repository = candidate;

    const inserted = { goal: 0, project: 0, milestone: 0, task: 0 };
    const failed: PlanPersistFailure[] = [];
    const dead = new Set<string>();
    let duplicates = 0;

    for (const row of planned.rows) {
      if (row.parentId !== "" && dead.has(row.parentId)) {
        dead.add(row.id);
        continue;
      }

      const response = await writeRow(repository, row);

      if (isWriteOk(response)) {
        inserted[row.table] += 1;
        continue;
      }

      const code = errorCode((response as { error?: unknown }).error);

      if (code === DUPLICATE_KEY_CODE) {
        duplicates += 1;
        continue;
      }

      dead.add(row.id);
      failed.push({ table: row.table, id: row.id, code });
    }

    return {
      status: finalStatus(inserted, duplicates, failed.length),
      reason: failed.length === 0 ? null : "write_failed",
      goalId: planned.goalId,
      inserted,
      duplicates,
      failed,
    };
  } catch {
    return emptyResult("failed", "write_failed");
  }
}

/**
 * Classifies the run from what settled and what failed. Never throws.
 * A duplicate counts as settled, so re-persisting the same plan reports
 * "persisted" rather than a failure.
 */
function finalStatus(
  inserted: Record<PlanPersistTable, number>,
  duplicates: number,
  failedCount: number,
): PlanPersistStatus {
  const settled =
    inserted.goal +
    inserted.project +
    inserted.milestone +
    inserted.task +
    duplicates;

  if (failedCount === 0) return settled === 0 ? "skipped" : "persisted";

  return settled === 0 ? "failed" : "partial";
}

/**
 * Generates and optionally persists a plan. Never throws.
 *
 * The single ENABLE_AI_PLANNER check lives in planOrDefer; this function adds
 * no second source of truth. Persistence is opt-in via `deps.persist`, so the
 * default call generates a plan and writes nothing. A failed or partial write
 * still returns the plan, with the details in `persistence`; a deferred
 * outcome never touches the database.
 */
export async function generateAndPersistPlan(
  request: AiPlanRequest,
  deps: GenerateAndPersistDeps = {},
): Promise<GenerateAndPersistOutcome> {
  try {
    const outcome = await planOrDefer(request, deps);

    if (outcome === null || outcome.kind !== "planned") {
      return {
        kind: "deferred",
        reason:
          outcome?.kind === "deferred" &&
          typeof outcome.reason === "string"
            ? outcome.reason
            : "invalid_request",
        persistence: null,
      };
    }

    if (deps.persist !== true) {
      return { kind: "planned", plan: outcome.plan, persistence: null };
    }

    const persistence = await persistPlan(
      outcome.plan,
      requestUserId(request),
      deps,
    );

    return { kind: "planned", plan: outcome.plan, persistence };
  } catch {
    return { kind: "deferred", reason: "invalid_request", persistence: null };
  }
}

/** Reads the owner id from the request. Never throws. */
function requestUserId(request: AiPlanRequest): string {
  try {
    const userId = (
      request as unknown as Record<string, unknown> | null | undefined
    )?.["userId"];

    return typeof userId === "string" ? userId : "";
  } catch {
    return "";
  }
}

/** One 1-based ordinal, ASCII only, safe inside a derived id. */
function ordinal(value: number): string {
  return `#${Number.isFinite(value) ? Math.trunc(value) : 0}`;
}

/** Narrows a model-provided priority. Never throws. */
function isPlanPriority(value: unknown): value is AiPlanPriority {
  return (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "critical"
  );
}

/** Narrows a model-provided step status. Never throws. */
function isPlanStepStatus(value: unknown): value is AiPlanStepStatus {
  return value === "todo" || value === "doing" || value === "done";
}
