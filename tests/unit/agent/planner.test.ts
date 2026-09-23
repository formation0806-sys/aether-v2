/** Unit tests for lib/agent/planner entry point.
 *
 * Exercises the flag-gated planOrDefer entry point with the AI generator:
 * deferral classes plus model-plan and skeleton-fallback paths via injected
 * stub providers. No network, no database, no environment dependency beyond
 * injected stubs. Nothing here is wired into the chat route or the
 * background job worker.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@/lib/ai/types";
import {
  MAX_PLAN_GOAL_CHARS,
  isPlannedOutcome,
  planOrDefer,
} from "@/lib/agent/planner/index";

const GATE_SOURCE = readFileSync(
  path.join(process.cwd(), "lib", "agent", "planner", "gate.ts"),
  "utf8",
);

const INDEX_SOURCE = readFileSync(
  path.join(process.cwd(), "lib", "agent", "planner", "index.ts"),
  "utf8",
);

function plannerOn() {
  return {
    isFlagEnabled: () => true,
    provider: {
      chat: async (_m: ChatMessage[]) =>
        JSON.stringify({
          subGoals: [{ title: "Research" }],
          steps: [
            { subGoal: 1, title: "Survey", nextAction: "Book interviews" },
          ],
        }),
    },
  };
}

function plannerOff() {
  return { isFlagEnabled: () => false };
}

describe("ai planner gate - planning requests", () => {
  it.each([
    "make a plan to launch my startup",
    "create a plan for the move",
    "help me achieve my fitness goal",
    "my goal is to ship in 90 days",
    "give me a roadmap for learning piano",
    "break down this project into milestones",
    "break it down into steps",
    "show me step by step how to start",
    "what milestones should I track?",
    "  MAKE A PLAN  ",
  ])("accepts %p", async (message) => {
    const { isPlanningRequest } = await import("@/lib/agent/planner/gate");

    expect(isPlanningRequest(message)).toBe(true);
  });
});

describe("ai planner gate - everything else", () => {
  it.each([
    "",
    "   ",
    "hi",
    "hello there",
    "what time is it?",
    "what is 2+2?",
    "what do you remember about my project?",
    "what is my name?",
    "tell me a joke",
    "i use google chrome every day",
    "search the web for salpa",
    "the meeting is at 3:30",
  ])("rejects %p", async (message) => {
    const { isPlanningRequest } = await import("@/lib/agent/planner/gate");

    expect(isPlanningRequest(message)).toBe(false);
  });

  it("rejects non-strings and over-long messages", async () => {
    const { isPlanningRequest } = await import("@/lib/agent/planner/gate");

    expect(isPlanningRequest(undefined)).toBe(false);
    expect(isPlanningRequest(null)).toBe(false);
    expect(isPlanningRequest(5)).toBe(false);
    expect(isPlanningRequest({})).toBe(false);
    expect(isPlanningRequest([])).toBe(false);
    expect(isPlanningRequest("make a plan " + "x".repeat(2000))).toBe(false);
  });

  it("never reads flags, so classification is flag-independent", () => {
    expect(GATE_SOURCE.includes("process.env")).toBe(false);
    expect(GATE_SOURCE.includes("isFeatureEnabled")).toBe(false);
    expect(GATE_SOURCE.includes("ENABLE_AI_PLANNER")).toBe(false);
  });
});

describe("ai planner entry - flag gating", () => {
  it("defers with planner_disabled when the flag is off", async () => {
    expect(
      await planOrDefer(
        { userId: "user-1", message: "make a plan to launch" },
        plannerOff(),
      ),
    ).toEqual({ kind: "deferred", reason: "planner_disabled" });
  });

  it("reads the real env fail-closed by default", async () => {
    expect(
      await planOrDefer({ userId: "user-1", message: "make a plan to launch" }),
    ).toEqual({ kind: "deferred", reason: "planner_disabled" });
  });

  it("defers when flag reading throws", async () => {
    expect(
      await planOrDefer(
        { userId: "user-1", message: "make a plan" },
        {
          isFlagEnabled: () => {
            throw new Error("env broken");
          },
        },
      ),
    ).toEqual({ kind: "deferred", reason: "planner_disabled" });
  });
});

describe("ai planner entry - request validation", () => {
  it("defers invalid requests without calling the gate", async () => {
    const bad: unknown[] = [undefined, null, 5, "x", {}, []];

    for (const request of bad) {
      let gateCalls = 0;

      const outcome = await planOrDefer(request as never, {
        ...plannerOn(),
        isPlanning: () => {
          gateCalls += 1;

          return true;
        },
      });

      expect(outcome).toEqual({
        kind: "deferred",
        reason: "invalid_request",
      });
      expect(gateCalls).toBe(0);
    }
  });

  it("defers empty and over-long messages", async () => {
    expect(
      await planOrDefer({ userId: "u", message: "   " }, plannerOn()),
    ).toEqual({ kind: "deferred", reason: "invalid_request" });
    expect(
      await planOrDefer(
        { userId: "u", message: "make a plan " + "x".repeat(2000) },
        plannerOn(),
      ),
    ).toEqual({ kind: "deferred", reason: "invalid_request" });
  });

  it("defers non-planning messages", async () => {
    expect(
      await planOrDefer({ userId: "u", message: "hello there" }, plannerOn()),
    ).toEqual({ kind: "deferred", reason: "not_planning_request" });
  });
});

describe("ai planner entry - generated plan", () => {
  it("returns the model plan when the provider responds with valid JSON", async () => {
    const outcome = await planOrDefer(
      { userId: "user-1", message: "make a plan to launch my startup" },
      plannerOn(),
    );

    expect(outcome.kind).toBe("planned");

    if (outcome.kind === "planned") {
      expect(outcome.plan.goal).toBe("make a plan to launch my startup");
      expect(outcome.plan.subGoals).toEqual([
        { id: "sub-goal-1", title: "Research" },
      ]);
      expect(outcome.plan.steps.length).toBe(1);
      expect(outcome.plan.steps[0]).toMatchObject({
        subGoalId: "sub-goal-1",
        status: "todo",
      });
    }
  });

  it("falls back to the skeleton when the model fails", async () => {
    const outcome = await planOrDefer(
      { userId: "user-1", message: "make a plan to launch" },
      {
        isFlagEnabled: () => true,
        provider: {
          chat: async (_m: ChatMessage[]) => {
            throw new Error("down");
          },
        },
      },
    );

    expect(outcome.kind).toBe("planned");

    if (outcome.kind === "planned") {
      expect(outcome.plan.goal).toBe("make a plan to launch");
      expect(outcome.plan.subGoals.length).toBe(2);
      expect(outcome.plan.steps.length).toBe(4);
    }
  });

  it("falls back to the skeleton when the model returns bad JSON", async () => {
    const outcome = await planOrDefer(
      { userId: "user-1", message: "make a plan to launch" },
      {
        isFlagEnabled: () => true,
        provider: { chat: async (_m: ChatMessage[]) => "not json" },
      },
    );

    expect(outcome.kind).toBe("planned");

    if (outcome.kind === "planned") {
      expect(outcome.plan.subGoals.length).toBe(2);
    }
  });

  it("caps the goal text and never writes", async () => {
    expect(MAX_PLAN_GOAL_CHARS).toBe(200);

    const outcome = await planOrDefer(
      { userId: "u", message: "make a plan " + "y".repeat(500) },
      plannerOn(),
    );

    expect(outcome.kind).toBe("deferred");
  });

  it("never throws, for any input", async () => {
    const nasty: unknown[] = [
      undefined,
      null,
      5,
      "x",
      {},
      [],
      Object.create(null),
    ];

    for (const request of nasty) {
      let outcome: unknown = null;

      await expect(
        (async () => {
          outcome = await planOrDefer(request as never, plannerOn());
        })(),
      ).resolves.not.toThrow();

      expect(isPlannedOutcome(outcome)).toBe(true);
    }
  });
});

describe("ai planner entry - purity", () => {
  it("writes nothing: no supabase, repository, or legacy planner imports", () => {
    const forbidden = [
      "createClient(",
      "supabase",
      ".from(",
      ".insert(",
      ".update(",
      "planner.repository",
      "@/lib/planner",
      "retrieveMemories",
      "fetch(",
      "console.",
      "Date.now",
      "new Date",
      "Math.random",
      "setTimeout",
    ];

    for (const token of forbidden) {
      expect(INDEX_SOURCE.includes(token)).toBe(false);
      expect(GATE_SOURCE.includes(token)).toBe(false);
    }
  });

  it("touches no legacy planner behavior", () => {
    expect(INDEX_SOURCE.includes("parsePlanningMessage")).toBe(false);
    expect(INDEX_SOURCE.includes("buildPlan")).toBe(false);
    expect(INDEX_SOURCE.includes("savePlan")).toBe(false);
  });
});
