/**
 * Multi-agent orchestration entry point (Priority 4).
 *
 * Single responsibility: decide whether a request becomes an orchestration
 * plan or a deferral, behind ENABLE_MULTI_AGENT.
 *
 * Order of checks:
 *   1. ENABLE_MULTI_AGENT off (or unreadable) -> "orchestration_disabled"
 *   2. unusable request (missing/oversized message) -> "invalid_request"
 *   3. not a multi-part request -> "not_multi_agent_request"
 *   4. otherwise plan: a deterministic skeleton derived from the user's own
 *      words, with no provider call, no tool call, no database read, and no
 *      database write
 *
 * Additive only. Nothing imports this module in production: the agent loop,
 * the tools, the planner, the procedural modules, the memory pipeline, and
 * the chat route are all untouched.
 *
 * Step 2 adds runOrchestration: planOrDefer decides (flag, gate), then the
 * coordinator in ./coordinator runs the plan and merges the answer. Deferred
 * outcomes become coordinator fallbacks so callers have one result shape.
 */

import { isFeatureEnabled } from "@/lib/config/features";
import type { FeatureFlag } from "@/lib/config/features";
import { runPlan } from "./coordinator";
import type { CoordinatorOutcome } from "./coordinator";
import { isMultiAgentRequest } from "./gate";
import type { RoleRunner } from "./roles";
import type { TurnBudget } from "../budget";
import type {
  AgentRole,
  AgentTask,
  OrchestrationOutcome,
  OrchestrationPlan,
  OrchestrationRequest,
} from "./types";

/** Upper bound on the goal text carried in a plan. */
export const MAX_ORCHESTRATION_GOAL_CHARS = 500;

/** Upper bound on a task title. */
export const MAX_ORCHESTRATION_TITLE_CHARS = 120;

/** Upper bound on a task instruction. */
export const MAX_ORCHESTRATION_INSTRUCTION_CHARS = 500;

/** Stable identifier for the researcher task. */
export const RESEARCHER_TASK_ID = "task-researcher-1";

/** Stable identifier for the synthesizer task. */
export const SYNTHESIZER_TASK_ID = "task-synthesizer-1";

/** Every role, in canonical order, for diagnostics and tests. */
export const AGENT_ROLES: readonly AgentRole[] = Object.freeze([
  "researcher",
  "synthesizer",
  "critic",
]);

/** Injectable flag predicate. Defaults to the real feature-flag reader. */
export type OrchestrationFlagReader = (flag: FeatureFlag) => boolean;

/** Injectable gate. Defaults to the deterministic multi-part classifier. */
export type OrchestrationGate = (message: unknown) => boolean;

/** Injectable dependencies. Every field is optional; defaults are production. */
export interface OrchestrationDeps {
  /** Defaults to isFeatureEnabled() from the feature flags. */
  isFlagEnabled?: OrchestrationFlagReader;
  /** Defaults to isMultiAgentRequest(). */
  isMultiAgent?: OrchestrationGate;
}

export type { CoordinatorDeps, CoordinatorOutcome } from "./coordinator";
export { MAX_ORCHESTRATION_ANSWER_CHARS, ROLE_ORDER, runPlan } from "./coordinator";

/** Deps for runOrchestration: planning deps plus coordinator runtime deps. */
export interface RunOrchestrationDeps extends OrchestrationDeps {
  /** Defaults to the deterministic skeleton runner. */
  runRole?: RoleRunner;
  /** Defaults to createTurnBudget() from the numeric flags. */
  budget?: Readonly<TurnBudget>;
  /** Defaults to Date.now. Injected clocks make tests deterministic. */
  now?: () => number;
}

function isOrchestrationEnabled(deps: OrchestrationDeps): boolean {
  try {
    if (deps.isFlagEnabled) {
      return deps.isFlagEnabled("ENABLE_MULTI_AGENT") === true;
    }
    return isFeatureEnabled("ENABLE_MULTI_AGENT") === true;
  } catch {
    return false;
  }
}

/** Extracts a usable message from the request. Never throws. */
function requestMessage(request: OrchestrationRequest): string | null {
  try {
    const raw = request as unknown as Record<string, unknown> | null;
    const message = raw?.["message"];
    if (typeof message !== "string") return null;
    const trimmed = message.trim();
    if (trimmed === "") return null;
    if (trimmed.at(MAX_ORCHESTRATION_GOAL_CHARS) !== undefined) return null;
    return trimmed;
  } catch {
    return null;
  }
}

/** Caps goal text; the plan carries the message verbatim up to the cap. */
function toGoal(message: string): string {
  const trimmed = message.trim();
  if (trimmed.at(MAX_ORCHESTRATION_GOAL_CHARS) === undefined) return trimmed;
  return trimmed.slice(0, MAX_ORCHESTRATION_GOAL_CHARS);
}

/** Caps a title; never empty because the goal is never empty. */
function toTitle(text: string): string {
  const trimmed = text.trim();
  if (trimmed.at(MAX_ORCHESTRATION_TITLE_CHARS) === undefined) return trimmed;
  return trimmed.slice(0, MAX_ORCHESTRATION_TITLE_CHARS);
}

/** Caps an instruction; never empty because the goal is never empty. */
function toInstruction(text: string): string {
  const trimmed = text.trim();
  if (trimmed.at(MAX_ORCHESTRATION_INSTRUCTION_CHARS) === undefined) {
    return trimmed;
  }
  return trimmed.slice(0, MAX_ORCHESTRATION_INSTRUCTION_CHARS);
}

/** Builds the deterministic skeleton plan. Pure and never throws. */
export function skeletonPlan(goal: string): OrchestrationPlan {
  const capped = toGoal(goal);
  const researcher: AgentTask = {
    id: RESEARCHER_TASK_ID,
    role: "researcher",
    title: toTitle(`Research: ${capped}`),
    instruction: toInstruction(`Gather the information needed for: ${capped}`),
    status: "todo",
  };
  const synthesizer: AgentTask = {
    id: SYNTHESIZER_TASK_ID,
    role: "synthesizer",
    title: toTitle(`Synthesize: ${capped}`),
    instruction: toInstruction(
      `Combine the gathered information into one answer for: ${capped}`,
    ),
    status: "todo",
  };
  return { goal: capped, tasks: [researcher, synthesizer] };
}

/** Plans or defers. Never throws, never calls providers, tools, or the DB. */
export async function planOrDefer(
  request: OrchestrationRequest,
  deps: OrchestrationDeps = {},
): Promise<OrchestrationOutcome> {
  try {
    if (!isOrchestrationEnabled(deps)) {
      return { kind: "deferred", reason: "orchestration_disabled" };
    }
    const message = requestMessage(request);
    if (message === null) {
      return { kind: "deferred", reason: "invalid_request" };
    }
    let multiAgent: boolean;
    try {
      multiAgent = (deps.isMultiAgent ?? isMultiAgentRequest)(message) === true;
    } catch {
      return { kind: "deferred", reason: "not_multi_agent_request" };
    }
    if (!multiAgent) {
      return { kind: "deferred", reason: "not_multi_agent_request" };
    }
    try {
      const plan = skeletonPlan(message);
      return { kind: "planned", plan };
    } catch {
      return { kind: "deferred", reason: "invalid_request" };
    }
  } catch {
    return { kind: "deferred", reason: "invalid_request" };
  }
}

/** True when the outcome carries a plan. Never throws. */
export function isPlannedOutcome(value: unknown): value is OrchestrationOutcome {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const candidate = value as Record<string, unknown>;
    if (candidate["kind"] === "planned") {
      return candidate["plan"] !== null && typeof candidate["plan"] === "object";
    }
    if (candidate["kind"] === "deferred") {
      return typeof candidate["reason"] === "string";
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * End-to-end orchestration: planOrDefer decides, then runPlan executes.
 * Returns answered on success; deferrals become coordinator-shaped results
 * ({ kind: "deferred", reason }) so callers have one handling path.
 * Never throws; never touches providers, tools, or the DB beyond deps.
 */
export async function runOrchestration(
  request: OrchestrationRequest,
  deps: RunOrchestrationDeps = {},
): Promise<CoordinatorOutcome | { kind: "deferred"; reason: string }> {
  try {
    const planned = await planOrDefer(request, deps);
    if (planned.kind === "deferred") return planned;
    return runPlan(planned.plan, deps);
  } catch {
    return { kind: "deferred", reason: "invalid_request" };
  }
}
