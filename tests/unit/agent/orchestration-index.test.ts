/** Unit tests for planOrDefer (Priority 4). No provider, tools, or DB. */

import { describe, expect, it } from "vitest";
import {
  AGENT_ROLES,
  MAX_ORCHESTRATION_GOAL_CHARS,
  MAX_ORCHESTRATION_INSTRUCTION_CHARS,
  MAX_ORCHESTRATION_TITLE_CHARS,
  RESEARCHER_TASK_ID,
  SYNTHESIZER_TASK_ID,
  isPlannedOutcome,
  planOrDefer,
  skeletonPlan,
} from "@/lib/agent/orchestration/index";
import type { OrchestrationRequest } from "@/lib/agent/orchestration/types";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function request(message: unknown): OrchestrationRequest {
  return { userId: USER_ID, message } as unknown as OrchestrationRequest;
}
function orchestrationOn() {
  return { isFlagEnabled: () => true };
}
function orchestrationOff() {
  return { isFlagEnabled: () => false };
}

describe("planOrDefer - flag gating", () => {
  it("defers with orchestration_disabled when off", async () => {
    const outcome = await planOrDefer(
      request("compare tea and coffee for focus"),
      orchestrationOff(),
    );
    expect(outcome.kind).toBe("deferred");
    expect(outcome["reason"]).toBe("orchestration_disabled");
  });
  it("checks flag before gate, classifies nothing when disabled", async () => {
    let gateCalls = 0;
    const outcome = await planOrDefer(
      request("compare tea and coffee for focus"),
      {
        isFlagEnabled: () => false,
        isMultiAgent: () => {
          gateCalls += 1;
          return true;
        },
      },
    );
    expect(outcome.kind).toBe("deferred");
    expect(gateCalls).toBe(0);
  });
  it("stays disabled in real env where flag is unset", async () => {
    const outcome = await planOrDefer(request("compare tea and coffee"));
    expect(outcome.kind).toBe("deferred");
    expect(outcome["reason"]).toBe("orchestration_disabled");
  });
  it("fails closed when flag reader throws", async () => {
    const outcome = await planOrDefer(request("compare tea and coffee"), {
      isFlagEnabled: () => {
        throw new Error("flag down");
      },
    });
    expect(outcome.kind).toBe("deferred");
    expect(outcome["reason"]).toBe("orchestration_disabled");
  });
  it("reads exactly ENABLE_MULTI_AGENT", async () => {
    const seen: string[] = [];
    await planOrDefer(request("compare tea and coffee"), {
      isFlagEnabled: (flag) => {
        seen.push(flag);
        return true;
      },
      isMultiAgent: () => false,
    });
    expect(seen).toEqual(["ENABLE_MULTI_AGENT"]);
  });
});

describe("planOrDefer - request validation", () => {
  it("defers invalid for missing, blank, oversized", async () => {
    const missing = await planOrDefer(
      { userId: USER_ID } as OrchestrationRequest,
      orchestrationOn(),
    );
    expect(missing["reason"]).toBe("invalid_request");
    const blank = await planOrDefer(request("   "), orchestrationOn());
    expect(blank["reason"]).toBe("invalid_request");
    const long = `compare a and b ${"x".repeat(MAX_ORCHESTRATION_GOAL_CHARS)}`;
    expect(long.length).toBeGreaterThan(MAX_ORCHESTRATION_GOAL_CHARS);
    const big = await planOrDefer(request(long), orchestrationOn());
    expect(big["reason"]).toBe("invalid_request");
  });
  it("defers not_multi_agent_request for ordinary chat", async () => {
    const outcome = await planOrDefer(
      request("how are you doing today"),
      orchestrationOn(),
    );
    expect(outcome["reason"]).toBe("not_multi_agent_request");
  });
  it("defers not_multi_agent_request when gate throws", async () => {
    const outcome = await planOrDefer(request("compare tea and coffee"), {
      isFlagEnabled: () => true,
      isMultiAgent: () => {
        throw new Error("gate down");
      },
    });
    expect(outcome["reason"]).toBe("not_multi_agent_request");
  });
});


describe("planOrDefer - planned skeleton", () => {
  it("plans researcher plus synthesizer shape", async () => {
    const outcome = await planOrDefer(
      request("compare tea and coffee for focus"),
      orchestrationOn(),
    );
    expect(outcome.kind).toBe("planned");
    if (outcome.kind !== "planned") return;
    expect(outcome.plan.goal).toBe("compare tea and coffee for focus");
    expect(outcome.plan.tasks).toHaveLength(2);
    expect(outcome.plan.tasks[0]?.role).toBe("researcher");
    expect(outcome.plan.tasks[1]?.role).toBe("synthesizer");
    expect(outcome.plan.tasks[0]?.id).toBe(RESEARCHER_TASK_ID);
    expect(outcome.plan.tasks[1]?.id).toBe(SYNTHESIZER_TASK_ID);
    expect(outcome.plan.tasks[0]?.status).toBe("todo");
  });
  it("derives capped titles and instructions", async () => {
    const outcome = await planOrDefer(
      request("compare tea and coffee for focus"),
      orchestrationOn(),
    );
    expect(outcome.kind).toBe("planned");
    if (outcome.kind !== "planned") return;
    for (const task of outcome.plan.tasks) {
      expect(task.title.length).toBeGreaterThan(0);
      expect(task.instruction.length).toBeGreaterThan(0);
      expect(task.title.length).toBeLessThanOrEqual(MAX_ORCHESTRATION_TITLE_CHARS);
      expect(task.instruction.length).toBeLessThanOrEqual(
        MAX_ORCHESTRATION_INSTRUCTION_CHARS,
      );
    }
  });
  it("is deterministic and trims input", async () => {
    const first = await planOrDefer(
      request("compare tea and coffee for focus"),
      orchestrationOn(),
    );
    const second = await planOrDefer(
      request("compare tea and coffee for focus"),
      orchestrationOn(),
    );
    expect(first).toEqual(second);
    const padded = await planOrDefer(
      request("   compare tea and coffee   "),
      orchestrationOn(),
    );
    if (padded.kind !== "planned") throw new Error("expected planned");
    expect(padded.plan.goal).toBe("compare tea and coffee");
  });
  it("does not require a uuid user id", async () => {
    const outcome = await planOrDefer(
      { userId: "not-a-uuid", message: "compare tea and coffee" },
      orchestrationOn(),
    );
    expect(outcome.kind).toBe("planned");
  });
});

describe("skeletonPlan - pure shape", () => {
  it("exposes every role in canonical order", () => {
    expect([...AGENT_ROLES]).toEqual(["researcher", "synthesizer", "critic"]);
  });
  it("caps a long goal instead of deferring", () => {
    const plan = skeletonPlan(`compare ${"x".repeat(MAX_ORCHESTRATION_GOAL_CHARS)}`);
    expect(plan.goal.length).toBe(MAX_ORCHESTRATION_GOAL_CHARS);
    expect(plan.tasks).toHaveLength(2);
  });
});

describe("planOrDefer - never throws", () => {
  it("resolves for hostile inputs and deps", async () => {
    const hostile = new Proxy({}, { get() { throw new Error("x"); } });
    for (const input of [null, undefined, hostile, 42, [], "compare a and b"]) {
      const outcome = await planOrDefer(
        input as unknown as OrchestrationRequest,
        orchestrationOn(),
      );
      expect(["planned", "deferred"]).toContain(outcome.kind);
    }
    const badDeps = new Proxy({}, { get() { throw new Error("y"); } });
    const outcome = await planOrDefer(
      request("compare tea and coffee"),
      badDeps as never,
    );
    expect(outcome.kind).toBe("deferred");
  });
  it("always returns a valid outcome", async () => {
    const outcomes = await Promise.all([
      planOrDefer(request("compare tea and coffee"), orchestrationOn()),
      planOrDefer(request("how are you today"), orchestrationOn()),
      planOrDefer(request("compare tea and coffee"), orchestrationOff()),
      planOrDefer({} as OrchestrationRequest, orchestrationOn()),
    ]);
    for (const outcome of outcomes) {
      expect(isPlannedOutcome(outcome)).toBe(true);
    }
  });
});