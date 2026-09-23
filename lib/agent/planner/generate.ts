/**
 * AI plan generator (Priority 2).
 *
 * Turns a user goal into a structured AiPlan using the existing AI
 * provider, loaded lazily so tests can inject a stub and production only
 * pays for the import when planning actually runs. The model is asked for
 * one JSON object; anything else (throw, non-string, malformed JSON, wrong
 * shape) degrades to a deterministic skeleton plan so the caller always
 * gets a usable plan and never an exception.
 *
 * No database, no side effects beyond the single model call. Nothing here
 * is imported by production code yet: the background worker that persists
 * plans arrives in a later, separately reviewed step.
 */

import type { ChatMessage } from "@/lib/ai/types";
import type {
  AiPlan,
  AiPlanPriority,
  AiPlanStep,
  AiSubGoal,
} from "./types";

/** Minimal provider surface the generator needs. Mirrors AIProvider.chat. */
export interface PlanChatProvider {
  chat(messages: ChatMessage[]): Promise<string>;
}

/** Injectable dependencies. Every field is optional; defaults are production. */
export interface GenerateDeps {
  /** Defaults to getProvider() loaded lazily, so tests inject a stub. */
  provider?: PlanChatProvider;
}

/** Bounds keeping model output small and plans usable. */
export const MAX_GENERATED_SUB_GOALS = 4;
export const MAX_GENERATED_STEPS_PER_SUB_GOAL = 4;
export const MAX_GENERATED_TITLE_CHARS = 120;
export const MAX_GENERATED_ACTION_CHARS = 200;

/** System instruction for the single plan-generation call. */
export const PLAN_GENERATOR_SYSTEM_PROMPT = [
  "You plan long-horizon goals.",
  "Reply with ONLY one JSON object and nothing else, of the shape:",
  '{"subGoals": [{"title": "..."}], "steps": [{"subGoal": 1, "title": "...", "nextAction": "...", "priority": "low|medium|high|critical"}]}',
  "Rules: 1-4 sub-goals, 1-4 steps per sub-goal, short titles, one concrete nextAction per step, priority defaults to medium.",
].join("\n");

/** Resolves the chat provider without a static production import. */
async function resolveProvider(
  injected: PlanChatProvider | undefined,
): Promise<PlanChatProvider> {
  if (injected) return injected;

  const { getProvider } = await import("@/lib/ai/provider");

  return getProvider();
}

/** Returns the first balanced JSON object at or after fromIndex, or null. */
export function extractBalancedJsonObject(
  text: string,
  fromIndex = 0,
): string | null {
  try {
    if (typeof text !== "string") return null;

    const start = text.indexOf("{", fromIndex);

    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index !== text.length; index += 1) {
      const ch = text[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }

        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === "{") {
        depth += 1;
        continue;
      }

      if (ch === "}") {
        depth -= 1;

        if (depth === 0) return text.slice(start, index + 1);
      }
    }

    return null;
  } catch {
    return null;
  }
}

/** Trims and caps text; non-strings become "". Never throws. */
function cleanText(value: unknown, cap: number): string {
  try {
    if (typeof value !== "string") return "";

    const trimmed = value.trim();

    if (trimmed === "") return "";

    if (trimmed.at(cap) === undefined) return trimmed;

    return trimmed.slice(0, cap);
  } catch {
    return "";
  }
}

/** Normalizes a priority token; anything unknown becomes "medium". */
function toPriority(value: unknown): AiPlanPriority {
  try {
    if (
      value === "low" ||
      value === "medium" ||
      value === "high" ||
      value === "critical"
    ) {
      return value;
    }
  } catch {
    // Fall through to the default below.
  }

  return "medium";
}

/**
 * Validates model JSON into sub-goals and steps. Returns null when the
 * payload is unusable, so the caller falls back to the skeleton.
 * Never throws, for any input.
 */
export function parseGeneratedPlan(
  raw: unknown,
  goal: string,
): { subGoals: AiSubGoal[]; steps: AiPlanStep[] } | null {
  try {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }

    const record = raw as Record<string, unknown>;
    const rawSubGoals = record["subGoals"];
    const rawSteps = record["steps"];

    if (!Array.isArray(rawSubGoals) || !Array.isArray(rawSteps)) return null;

    if (rawSubGoals.length === 0 || rawSteps.length === 0) return null;

    if (rawSubGoals.length > MAX_GENERATED_SUB_GOALS) return null;

    const subGoals: AiSubGoal[] = [];
    const titles: string[] = [];

    for (const entry of rawSubGoals) {
      const title = cleanText(
        (entry as Record<string, unknown> | null | undefined)?.["title"],
        MAX_GENERATED_TITLE_CHARS,
      );

      if (title === "") return null;

      titles.push(title);
    }

    titles.forEach((title, index) => {
      subGoals.push({ id: "sub-goal-" + String(index + 1), title });
    });

    const steps: AiPlanStep[] = [];
    const perSubGoal = new Map<number, number>();

    for (const entry of rawSteps) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }

      const candidate = entry as Record<string, unknown>;
      const subGoal = candidate["subGoal"];

      if (
        typeof subGoal !== "number" ||
        !Number.isInteger(subGoal) ||
        subGoal < 1 ||
        subGoal > subGoals.length
      ) {
        return null;
      }

      const count = (perSubGoal.get(subGoal) ?? 0) + 1;

      if (count > MAX_GENERATED_STEPS_PER_SUB_GOAL) return null;

      perSubGoal.set(subGoal, count);

      const title = cleanText(candidate["title"], MAX_GENERATED_TITLE_CHARS);
      const nextAction = cleanText(
        candidate["nextAction"],
        MAX_GENERATED_ACTION_CHARS,
      );

      if (title === "" || nextAction === "") return null;

      const subGoalId = "sub-goal-" + String(subGoal);

      steps.push({
        id: subGoalId + "-step-" + String(count),
        subGoalId,
        title,
        nextAction,
        priority: toPriority(candidate["priority"]),
        status: "todo",
      });
    }

    if (steps.length === 0) return null;

    const covered = new Set(steps.map((step) => step.subGoalId));

    if (covered.size !== subGoals.length) return null;

    void goal;

    return { subGoals, steps };
  } catch {
    return null;
  }
}

/** Builds the deterministic skeleton plan. Never throws. */
export function skeletonPlan(
  goal: string,
  subGoalCount = 2,
  stepsPerSubGoal = 2,
): AiPlan {
  try {
    const subGoals: AiSubGoal[] = [];
    const steps: AiPlanStep[] = [];

    for (let s = 0; s < subGoalCount; s += 1) {
      const subGoalId = "sub-goal-" + String(s + 1);

      subGoals.push({
        id: subGoalId,
        title: "Sub-goal " + String(s + 1) + " for: " + goal,
      });

      for (let t = 0; t < stepsPerSubGoal; t += 1) {
        steps.push({
          id: subGoalId + "-step-" + String(t + 1),
          subGoalId,
          title: "Step " + String(t + 1) + " of " + subGoalId,
          nextAction: "Define the next action with the user before executing.",
          priority: "medium",
          status: "todo",
        });
      }
    }

    return { goal, subGoals, steps };
  } catch {
    return { goal: "", subGoals: [], steps: [] };
  }
}

/** Builds the single plan-generation message pair. Never throws. */
export function buildPlanMessages(goal: string): ChatMessage[] {
  try {
    return [
      { role: "system", content: PLAN_GENERATOR_SYSTEM_PROMPT },
      { role: "user", content: goal },
    ];
  } catch {
    return [{ role: "user", content: "" }];
  }
}

/**
 * Generates a plan for the goal. Never throws, for any input.
 *
 * Returns the model plan when its JSON validates, otherwise the
 * deterministic skeleton. The only side effect is the single model call.
 */
export async function generatePlan(
  goal: string,
  deps: GenerateDeps = {},
): Promise<AiPlan> {
  const safeGoal = typeof goal === "string" && goal.trim() !== "" ? goal : "";

  const fallback = () => skeletonPlan(safeGoal);

  try {
    if (safeGoal === "") return skeletonPlan("");

    let provider: PlanChatProvider;

    try {
      provider = await resolveProvider(deps.provider);
    } catch {
      return fallback();
    }

    let response: string;

    try {
      response = await provider.chat(buildPlanMessages(safeGoal));
    } catch {
      return fallback();
    }

    if (typeof response !== "string" || response.trim() === "") {
      return fallback();
    }

    const candidate = extractBalancedJsonObject(response);

    if (candidate === null) return fallback();

    let parsed: unknown;

    try {
      parsed = JSON.parse(candidate);
    } catch {
      return fallback();
    }

    const plan = parseGeneratedPlan(parsed, safeGoal);

    if (plan === null) return fallback();

    return { goal: safeGoal, subGoals: plan.subGoals, steps: plan.steps };
  } catch {
    return fallback();
  }
}
