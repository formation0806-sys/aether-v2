/**
 * Multi-agent coordinator (Priority 4, step 2).
 *
 * Runs the roles of an OrchestrationPlan in order and merges outputs
 * into one answer. NOT wired to chat: nothing imports this in production.
 * Default role runner is a deterministic skeleton (no provider/tools/DB).
 *
 * Order: researcher tasks, then synthesizer, then critic (advisory only).
 * Budget, trace, and fallback reuse single-agent primitives. Never throws.
 */

import { checkTurnLimit, createTurnBudget, remainingTimeMs } from "../budget";
import type { TurnBudget } from "../budget";
import { createFallback } from "../fallback";
import { addStep, emptyTrace } from "../trace";
import type { TurnTrace } from "../trace";
import type { AgentTraceStep } from "../types";
import type { FeatureFlag } from "@/lib/config/features";
import { skeletonRoleRunner } from "./roles";
import type { RoleInput, RoleOutput, RoleRunner } from "./roles";
import type { AgentRole, AgentTask } from "./types";
import type { OrchestrationPlan } from "./types";

/** Cap on the final merged answer. */
export const MAX_ORCHESTRATION_ANSWER_CHARS = 4000;

/** Canonical execution order. Critic runs last and never vetoes. */
export const ROLE_ORDER: readonly AgentRole[] = Object.freeze([
  "researcher",
  "synthesizer",
  "critic",
]);

/** Caps text; non-strings become empty. Never throws. */
function capText(value: unknown, cap: number): string {
  try {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    if (trimmed.at(cap) === undefined) return trimmed;
    return trimmed.slice(0, cap);
  } catch {
    return "";
  }
}

/** Reads the clock defensively. Never throws. */
function safeNow(now: (() => number) | undefined): number {
  try {
    if (typeof now !== "function") return Date.now();
    const value = now();
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

/** Extracts safe goal text from a plan. Never throws. */
function planGoal(plan: OrchestrationPlan): string {
  try {
    const goal = (plan as { goal?: unknown } | null)?.goal;
    if (typeof goal !== "string") return "";
    const trimmed = goal.trim();
    return trimmed.at(500) === undefined ? trimmed : trimmed.slice(0, 500);
  } catch {
    return "";
  }
}

export interface CoordinatorDeps {
  /** Defaults to the deterministic skeleton runner. */
  runRole?: RoleRunner;
  /** Defaults to createTurnBudget() from the numeric flags. */
  budget?: Readonly<TurnBudget>;
  /** Defaults to Date.now. Injected clocks make tests deterministic. */
  now?: () => number;
  /** Passed through to flag check by runOrchestration. */
  isFlagEnabled?: (flag: FeatureFlag) => boolean;
  /** Passed through to gate check by runOrchestration. */
  isMultiAgent?: (message: unknown) => boolean;
}

export type CoordinatorOutcome =
  | { kind: "answered"; answer: string; trace: AgentTraceStep[] }
  | { kind: "fallback"; reason: "budget_exhausted" | "unexpected_error" };

function traceSteps(trace: TurnTrace): AgentTraceStep[] {
  try {
    const out: AgentTraceStep[] = [];
    for (const s of trace.steps) {
      const step: AgentTraceStep = {
        step: typeof s.step === "number" ? s.step : out.length + 1,
        phase: s.phase,
        durationMs: typeof s.durationMs === "number" ? s.durationMs : 0,
      };
      if (typeof s.tool === "string") step.tool = s.tool;
      if (typeof s.ok === "boolean") step.ok = s.ok;
      if (typeof s.note === "string") step.note = s.note;
      out.push(step);
    }
    return out;
  } catch {
    return [];
  }
}

function mergeOutputs(prior: readonly RoleOutput[], goal: string): string {
  try {
    const synth = prior.find((o) => o.role === "synthesizer" && o.ok);
    if (synth) {
      // An ok-but-blank synthesis must not win: answering with "" would hand
      // the caller an empty response. Fall through to the other outputs.
      const text = capText(synth.text, MAX_ORCHESTRATION_ANSWER_CHARS);
      if (text !== "") return text;
    }
    const okParts = prior.filter((o) => o.ok && o.text.trim() !== "");
    if (okParts.length > 0) {
      return capText(
        okParts.map((o) => o.text.trim()).join("\n\n"),
        MAX_ORCHESTRATION_ANSWER_CHARS,
      );
    }
    const safeGoal = capText(goal, 500);
    return safeGoal !== "" ? `No result available for: ${safeGoal}` : "No result.";
  } catch {
    return "No result.";
  }
}

async function runOneRole(
  runner: RoleRunner,
  task: AgentTask,
  goal: string,
  prior: readonly RoleOutput[],
  deadlineMs: number,
): Promise<RoleOutput> {
  try {
    const out = await runner({ task, goal, prior, deadlineMs });
    if (out !== null && typeof out === "object") {
      return {
        role: task.role,
        taskId: task.id,
        text: typeof out.text === "string" ? out.text : "",
        ok: out.ok === true,
      };
    }
    return { role: task.role, taskId: task.id, text: "", ok: false };
  } catch {
    return { role: task.role, taskId: task.id, text: "", ok: false };
  }
}

/**
 * Runs one plan: roles in canonical order, budget-checked, traced,
 * fallback-safe. Never throws; always returns a CoordinatorOutcome.
 *
 * Execution:
 *   1. Validate the plan shape; invalid input becomes an "unexpected_error"
 *      fallback converted from createFallback so the reason stays in the
 *      single-agent vocabulary.
 *   2. Seed a TurnTrace via emptyTrace() and record one "think" step for
 *      ordering the plan (zero duration: ordering is free, roles cost time).
 *   3. For each task in ROLE_ORDER order (stable for ties), check the turn
 *      limit via checkTurnLimit; on exhaustion stop and merge whatever ran.
 *   4. Run the task via the injected RoleRunner using the remaining deadline
 *      from remainingTimeMs; a throw becomes a failed output, never a throw.
 *   5. Record one "act" step per task carrying the role name (not content),
 *      its measured duration, ok, and a content-free note.
 *   6. Merge: ok synthesizer output wins; else join prior ok outputs;
 *      else a safe "No result" message derived only from the capped goal.
 */
export async function runPlan(
  plan: OrchestrationPlan,
  deps: CoordinatorDeps = {},
): Promise<CoordinatorOutcome> {
  try {
    if (!validPlan(plan)) {
      const fb = outcomeFromAgentFallback(createFallback("unexpected_error"));
      return fb;
    }
    const runner: RoleRunner = deps.runRole ?? skeletonRoleRunner;
    let budget: Readonly<TurnBudget>;
    try {
      budget = deps.budget ?? createTurnBudget();
    } catch {
      return outcomeFromAgentFallback(createFallback("budget_exhausted"));
    }
    const nowFn = typeof deps.now === "function" ? deps.now : Date.now;
    const startMs = safeNow(nowFn);
    const deadlineMs = startMs + budget.loopDeadlineMs;
    let trace = emptyTrace();
    try {
      trace = addStep(trace, "think", 0, { note: "order_plan" });
    } catch {
      trace = emptyTrace();
    }
    const goal = planGoal(plan);
    const tasks = orderedTasks(plan.tasks);
    const outputs: RoleOutput[] = [];
    let turnsUsed = 0;
    for (const task of tasks) {
      let decision;
      try {
        decision = checkTurnLimit(turnsUsed, budget);
      } catch {
        decision = { decision: "exhausted", reason: "turn_limit" } as const;
      }
      if (decision.decision === "exhausted") break;
      const elapsed = Math.max(0, safeNow(nowFn) - startMs);
      let remaining: number;
      try {
        remaining = remainingTimeMs(budget.loopDeadlineMs, elapsed);
      } catch {
        remaining = 0;
      }
      if (remaining <= 0) break;
      const roleStart = safeNow(nowFn);
      const input: RoleInput = {
        task,
        goal,
        prior: Object.freeze([...outputs]),
        deadlineMs,
      };
      const output = await runOneRole(runner, task, goal, input.prior, deadlineMs);
      outputs.push(output);
      turnsUsed += 1;
      let durationMs = 0;
      try {
        durationMs = Math.max(0, safeNow(nowFn) - roleStart);
      } catch {
        durationMs = 0;
      }
      try {
        trace = addStep(trace, "act", durationMs, {
          tool: task.role,
          ok: output.ok,
          note: output.ok ? "role_ok" : "role_failed",
        });
      } catch {
        trace = emptyTrace();
      }
    }
    const merged = mergeOutputs(outputs, goal);
    return { kind: "answered", answer: merged, trace: traceSteps(trace) };
  } catch {
    return outcomeFromAgentFallback(createFallback("unexpected_error"));
  }
}

/** Maps an AgentOutcome fallback onto the smaller coordinator vocabulary. */
function outcomeFromAgentFallback(outcome: {
  kind: string;
  reason?: unknown;
}): CoordinatorOutcome {
  try {
    const reason =
      outcome.reason === "budget_exhausted" ? "budget_exhausted" : "unexpected_error";
    return { kind: "fallback", reason };
  } catch {
    return { kind: "fallback", reason: "unexpected_error" };
  }
}

function validPlan(plan: OrchestrationPlan): boolean {
  try {
    if (plan === null || typeof plan !== "object" || Array.isArray(plan)) {
      return false;
    }
    const rec = plan as { goal?: unknown; tasks?: unknown };
    if (typeof rec.goal !== "string" || rec.goal.trim() === "") return false;
    if (!Array.isArray(rec.tasks) || rec.tasks.length === 0) return false;
    return true;
  } catch {
    return false;
  }
}

function orderedTasks(tasks: readonly AgentTask[]): AgentTask[] {
  try {
    const rank = (role: AgentRole): number => {
      const i = ROLE_ORDER.indexOf(role);
      return i === -1 ? 99 : i;
    };
    return [...tasks]
      .map((t, i) => ({ t, i }))
      .sort((a, b) => rank(a.t.role) - rank(b.t.role) || a.i - b.i)
      .map((e) => e.t);
  } catch {
    try {
      return [...tasks];
    } catch {
      return [];
    }
  }
}

