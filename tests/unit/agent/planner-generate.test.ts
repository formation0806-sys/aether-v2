/** Unit tests for lib/agent/planner/generate.
 *
 * Exercises the AI plan generator with injected stub providers only: no
 * network, no database, no environment. Covers valid model JSON, every
 * fallback class (throw, non-string, malformed, wrong shape), and purity.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@/lib/ai/types";
import {
  MAX_GENERATED_ACTION_CHARS,
  MAX_GENERATED_STEPS_PER_SUB_GOAL,
  MAX_GENERATED_SUB_GOALS,
  MAX_GENERATED_TITLE_CHARS,
  buildPlanMessages,
  extractBalancedJsonObject,
  generatePlan,
  parseGeneratedPlan,
  skeletonPlan,
} from "@/lib/agent/planner/generate";

const SOURCE = readFileSync(
  path.join(process.cwd(), "lib", "agent", "planner", "generate.ts"),
  "utf8",
);

function validPayload() {
  return {
    subGoals: [{ title: "Research" }, { title: "Launch" }],
    steps: [
      { subGoal: 1, title: "Survey users", nextAction: "Book 5 interviews", priority: "high" },
      { subGoal: 1, title: "Prototype", nextAction: "Build a demo", priority: "medium" },
      { subGoal: 2, title: "Ship", nextAction: "Deploy to staging", priority: "low" },
    ],
  };
}

describe("plan generator - parseGeneratedPlan", () => {
  it("accepts a valid payload with normalized ids", () => {
    const parsed = parseGeneratedPlan(validPayload(), "goal");

    expect(parsed).not.toBeNull();
    expect(parsed?.subGoals).toEqual([
      { id: "sub-goal-1", title: "Research" },
      { id: "sub-goal-2", title: "Launch" },
    ]);
    expect(parsed?.steps[0]).toMatchObject({
      id: "sub-goal-1-step-1",
      subGoalId: "sub-goal-1",
      status: "todo",
      priority: "high",
    });
  });

  it("defaults unknown priorities to medium", () => {
    const parsed = parseGeneratedPlan(
      {
        subGoals: [{ title: "A" }],
        steps: [{ subGoal: 1, title: "T", nextAction: "N", priority: "urgent" }],
      },
      "goal",
    );

    expect(parsed?.steps[0].priority).toBe("medium");
  });

  it("rejects every malformed shape", () => {
    const bad: unknown[] = [
      undefined,
      null,
      5,
      "x",
      [],
      {},
      { subGoals: [], steps: [] },
      { subGoals: [{ title: "" }], steps: [{ subGoal: 1, title: "T", nextAction: "N" }] },
      { subGoals: [{ title: "A" }], steps: [] },
      { subGoals: [{ title: "A" }], steps: [{ subGoal: 2, title: "T", nextAction: "N" }] },
      { subGoals: [{ title: "A" }], steps: [{ subGoal: 1, title: "", nextAction: "N" }] },
      { subGoals: [{ title: "A" }], steps: [{ subGoal: 1, title: "T", nextAction: "" }] },
      {
        subGoals: [{ title: "A" }, { title: "B" }],
        steps: [{ subGoal: 1, title: "T", nextAction: "N" }],
      },
    ];

    for (const value of bad) {
      expect(parseGeneratedPlan(value, "goal")).toBeNull();
    }
  });

  it("rejects oversized payloads", () => {
    const manySubGoals = {
      subGoals: Array.from({ length: MAX_GENERATED_SUB_GOALS + 1 }, (_, i) => ({
        title: "G" + String(i),
      })),
      steps: [{ subGoal: 1, title: "T", nextAction: "N" }],
    };

    expect(parseGeneratedPlan(manySubGoals, "goal")).toBeNull();

    const manySteps = {
      subGoals: [{ title: "A" }],
      steps: Array.from(
        { length: MAX_GENERATED_STEPS_PER_SUB_GOAL + 1 },
        (_, i) => ({ subGoal: 1, title: "T" + String(i), nextAction: "N" }),
      ),
    };

    expect(parseGeneratedPlan(manySteps, "goal")).toBeNull();
  });

  it("never throws, for any input", () => {
    for (const value of [undefined, null, 5, {}, [], Object.create(null)]) {
      expect(() => parseGeneratedPlan(value, "goal")).not.toThrow();
    }
  });
});

describe("plan generator - generatePlan", () => {
  it("returns the model plan for valid JSON, even inside prose", async () => {
    const plan = await generatePlan("launch", {
      provider: {
        chat: async (_m: ChatMessage[]) =>
          "Here it is: " + JSON.stringify(validPayload()) + " done.",
      },
    });

    expect(plan.goal).toBe("launch");
    expect(plan.subGoals.length).toBe(2);
    expect(plan.steps.length).toBe(3);
  });

  it("falls back to the skeleton on every failure class", async () => {
    const failures = [
      { chat: async (_m: ChatMessage[]) => { throw new Error("down"); } },
      { chat: async (_m: ChatMessage[]) => "" },
      { chat: async (_m: ChatMessage[]) => "no json here" },
      { chat: async (_m: ChatMessage[]) => '{"subGoals": [' },
      { chat: async (_m: ChatMessage[]) => JSON.stringify({ nope: true }) },
      { chat: async (_m: ChatMessage[]) => JSON.stringify({ subGoals: [], steps: [] }) },
    ];

    for (const provider of failures) {
      const plan = await generatePlan("launch", { provider });

      expect(plan.goal).toBe("launch");
      expect(plan.subGoals.length).toBe(2);
      expect(plan.steps.length).toBe(4);
    }
  });

  it("caps titles and actions from the model", async () => {
    const plan = await generatePlan("launch", {
      provider: {
        chat: async (_m: ChatMessage[]) =>
          JSON.stringify({
            subGoals: [{ title: "A".repeat(MAX_GENERATED_TITLE_CHARS + 50) }],
            steps: [
              {
                subGoal: 1,
                title: "T".repeat(MAX_GENERATED_TITLE_CHARS + 50),
                nextAction: "N".repeat(MAX_GENERATED_ACTION_CHARS + 50),
              },
            ],
          }),
      },
    });

    expect(plan.subGoals[0].title.length).toBe(MAX_GENERATED_TITLE_CHARS);
    expect(plan.steps[0].title.length).toBe(MAX_GENERATED_TITLE_CHARS);
    expect(plan.steps[0].nextAction.length).toBe(MAX_GENERATED_ACTION_CHARS);
  });

  it("sends a system plus user message pair", () => {
    const messages = buildPlanMessages("my goal");

    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1]).toEqual({ role: "user", content: "my goal" });
  });

  it("extracts balanced JSON while ignoring braces in strings", () => {
    expect(extractBalancedJsonObject('{"a":1}')).toBe('{"a":1}');
    expect(extractBalancedJsonObject('Sure! {"a":1} done.')).toBe('{"a":1}');
    expect(extractBalancedJsonObject("no braces")).toBeNull();
    expect(extractBalancedJsonObject('{"a":1')).toBeNull();
  });

  it("never throws, for any input", async () => {
    for (const goal of [undefined, null, 5, "", "   ", {}]) {
      const plan = await generatePlan(goal as never, {
        provider: { chat: async () => { throw new Error("x"); } },
      });

      expect(Array.isArray(plan.subGoals)).toBe(true);
      expect(Array.isArray(plan.steps)).toBe(true);
    }
  });
});

describe("plan generator - purity", () => {
  it("writes nothing and loads the provider lazily", () => {
    const forbidden = [
      "createClient(",
      "supabase",
      ".from(",
      ".insert(",
      ".update(",
      "planner.repository",
      "@/lib/planner",
      "process.env",
      "fetch(",
      "console.",
      "Date.now",
      "new Date",
      "Math.random",
      "setTimeout",
    ];

    for (const token of forbidden) {
      expect(SOURCE.includes(token)).toBe(false);
    }

    expect(SOURCE.includes('import("@/lib/ai/provider")')).toBe(true);
    expect(SOURCE.includes('from "@/lib/ai/provider"')).toBe(false);
  });
});
