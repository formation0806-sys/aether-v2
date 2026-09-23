/**
 * Unit tests for the multi-agent coordinator and the orchestration entry point
 * (Priority 4, step 2).
 *
 * Every test injects a stub RoleRunner, a stub budget, and a stub clock: no
 * provider call, no tool call, no network, no database, and no environment
 * dependency. Nothing under lib/agent/orchestration is wired into the agent
 * loop, the planner, procedural memory, the memory pipeline, or the chat
 * route; the isolation checks at the bottom of this file guard that.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { TurnBudget } from "@/lib/agent/budget";
import type { AgentTraceStep } from "@/lib/agent/types";
import {
  MAX_ORCHESTRATION_ANSWER_CHARS,
  ROLE_ORDER,
  runPlan,
} from "@/lib/agent/orchestration/coordinator";
import {
  RESEARCHER_TASK_ID,
  SYNTHESIZER_TASK_ID,
  runOrchestration,
} from "@/lib/agent/orchestration/index";
import type {
  RoleInput,
  RoleOutput,
  RoleRunner,
} from "@/lib/agent/orchestration/roles";
import type {
  AgentRole,
  AgentTask,
  OrchestrationPlan,
  OrchestrationRequest,
} from "@/lib/agent/orchestration/types";

/** A budget generous enough that ordering tests never trip a limit. */
const ROOMY_BUDGET: Readonly<TurnBudget> = Object.freeze({
  maxToolTurns: 4,
  loopDeadlineMs: 45_000,
  toolTimeoutMs: 10_000,
});

/** A clock that stands still: durations are 0 and deadlines never pass. */
const FROZEN_NOW = (): number => 1_000;

function task(role: AgentRole, id: string): AgentTask {
  return {
    id,
    role,
    title: `${role} ${id}`,
    instruction: `do ${role}`,
    status: "todo",
  };
}

function plan(tasks: AgentTask[], goal = "compare tea and coffee"): OrchestrationPlan {
  return { goal, tasks };
}

function request(message: unknown): OrchestrationRequest {
  return {
    userId: "11111111-1111-4111-8111-111111111111",
    message,
  } as unknown as OrchestrationRequest;
}

/** Records every role invocation and its input, then answers deterministically. */
function recordingRunner(
  behaviour: (input: RoleInput) => RoleOutput | Promise<RoleOutput> = (input) => ({
    role: input.task.role,
    taskId: input.task.id,
    text: `${input.task.role} says hi`,
    ok: true,
  }),
): { runner: RoleRunner; calls: RoleInput[] } {
  const calls: RoleInput[] = [];

  const runner: RoleRunner = async (input) => {
    calls.push(input);
    return await behaviour(input);
  };

  return { runner, calls };
}

/** Runs a plan against a stub runner, a frozen clock, and a roomy budget. */
async function runWithStub(
  target: OrchestrationPlan,
  behaviour?: (input: RoleInput) => RoleOutput | Promise<RoleOutput>,
) {
  const { runner, calls } = recordingRunner(behaviour);
  const outcome = await runPlan(target, {
    runRole: runner,
    budget: ROOMY_BUDGET,
    now: FROZEN_NOW,
  });

  return { outcome, calls };
}

/** The answered shape shared by runPlan and runOrchestration. */
interface AnsweredOutcome {
  kind: "answered";
  answer: string;
  trace: AgentTraceStep[];
}

/** Narrows to the answered shape or fails loudly. */
function answered(outcome: { kind: string }): AnsweredOutcome {
  if (outcome.kind !== "answered") {
    throw new Error(`expected answered, got ${outcome.kind}`);
  }

  return outcome as AnsweredOutcome;
}

describe("runPlan - execution order", () => {
  it("runs researcher, then synthesizer, then critic whatever the input order", async () => {
    const { outcome, calls } = await runWithStub(
      plan([
        task("critic", "c1"),
        task("synthesizer", SYNTHESIZER_TASK_ID),
        task("researcher", RESEARCHER_TASK_ID),
      ]),
    );

    expect(calls.map((call) => call.task.role)).toEqual([...ROLE_ORDER]);
    expect([...ROLE_ORDER]).toEqual(["researcher", "synthesizer", "critic"]);
    expect(answered(outcome).trace).toHaveLength(ROLE_ORDER.length + 1);
  });

  it("keeps the original order for tasks that share a role", async () => {
    const { calls } = await runWithStub(
      plan([task("researcher", "r-1"), task("researcher", "r-2")]),
    );

    expect(calls.map((call) => call.task.id)).toEqual(["r-1", "r-2"]);
  });

  it("records one think step then one act step per role, content-free", async () => {
    const { outcome } = await runWithStub(
      plan([
        task("researcher", RESEARCHER_TASK_ID),
        task("synthesizer", SYNTHESIZER_TASK_ID),
      ]),
    );
    const { trace } = answered(outcome);

    expect(trace[0]).toMatchObject({ step: 1, phase: "think", note: "order_plan" });
    expect(trace.slice(1).map((step) => step.phase)).toEqual(["act", "act"]);
    expect(trace.slice(1).map((step) => step.tool)).toEqual([
      "researcher",
      "synthesizer",
    ]);
    expect(trace.every((step) => typeof step.durationMs === "number")).toBe(true);
    // The ordering step is planning-only, so it carries no outcome.
    expect(trace[0]?.ok).toBeUndefined();
    expect(trace.slice(1).every((step) => step.ok === true)).toBe(true);
    expect(JSON.stringify(trace)).not.toContain("says hi");
  });

  it("hands each later role the outputs already produced", async () => {
    const { calls } = await runWithStub(
      plan([
        task("researcher", RESEARCHER_TASK_ID),
        task("synthesizer", SYNTHESIZER_TASK_ID),
      ]),
    );

    expect(calls[0]?.prior).toEqual([]);
    expect(calls[1]?.prior.map((output) => output.role)).toEqual(["researcher"]);
    expect(calls[1]?.prior[0]?.text).toBe("researcher says hi");
    expect(calls[0]?.goal).toBe("compare tea and coffee");
    expect(calls[0]?.deadlineMs).toBe(1_000 + ROOMY_BUDGET.loopDeadlineMs);
  });
});

describe("runPlan - merging", () => {
  it("lets a successful synthesizer output win over every other role", async () => {
    const { outcome } = await runWithStub(
      plan([
        task("researcher", RESEARCHER_TASK_ID),
        task("synthesizer", SYNTHESIZER_TASK_ID),
      ]),
      (input) =>
        input.task.role === "synthesizer"
          ? { role: input.task.role, taskId: input.task.id, text: "SYNTH FINAL", ok: true }
          : { role: input.task.role, taskId: input.task.id, text: "research notes", ok: true },
    );

    expect(answered(outcome).answer).toBe("SYNTH FINAL");
  });

  it("joins the ok parts when the synthesizer fails", async () => {
    const { outcome } = await runWithStub(
      plan([
        task("researcher", RESEARCHER_TASK_ID),
        task("synthesizer", SYNTHESIZER_TASK_ID),
        task("critic", "c1"),
      ]),
      (input) =>
        input.task.role === "synthesizer"
          ? { role: input.task.role, taskId: input.task.id, text: "", ok: false }
          : {
              role: input.task.role,
              taskId: input.task.id,
              text: `${input.task.role} notes`,
              ok: true,
            },
    );

    expect(answered(outcome).answer).toBe("researcher notes\n\ncritic notes");
  });

  it("answers a safe no-result message when every role fails", async () => {
    const { outcome } = await runWithStub(
      plan([
        task("researcher", RESEARCHER_TASK_ID),
        task("synthesizer", SYNTHESIZER_TASK_ID),
      ]),
      (input) => ({ role: input.task.role, taskId: input.task.id, text: "", ok: false }),
    );

    expect(answered(outcome).answer).toBe("No result available for: compare tea and coffee");
  });

  it("ignores ok outputs whose text is empty or whitespace", async () => {
    const { outcome } = await runWithStub(
      plan([
        task("researcher", RESEARCHER_TASK_ID),
        task("synthesizer", SYNTHESIZER_TASK_ID),
      ]),
      (input) => ({ role: input.task.role, taskId: input.task.id, text: "   ", ok: true }),
    );

    expect(answered(outcome).answer).toBe("No result available for: compare tea and coffee");
  });

  it("caps the merged answer at MAX_ORCHESTRATION_ANSWER_CHARS", async () => {
    const { outcome } = await runWithStub(
      plan([
        task("researcher", RESEARCHER_TASK_ID),
        task("synthesizer", SYNTHESIZER_TASK_ID),
      ]),
      (input) => ({
        role: input.task.role,
        taskId: input.task.id,
        text: "x".repeat(MAX_ORCHESTRATION_ANSWER_CHARS + 500),
        ok: true,
      }),
    );

    expect(answered(outcome).answer.length).toBe(MAX_ORCHESTRATION_ANSWER_CHARS);
  });
});

describe("runPlan - failure and budget handling", () => {
  it("turns a throwing role into a failed step and still answers", async () => {
    const { outcome, calls } = await runWithStub(
      plan([
        task("researcher", RESEARCHER_TASK_ID),
        task("synthesizer", SYNTHESIZER_TASK_ID),
      ]),
      (input) => {
        if (input.task.role === "researcher") throw new Error("boom");
        return {
          role: input.task.role,
          taskId: input.task.id,
          text: "synth saves it",
          ok: true,
        };
      },
    );
    const { answer, trace } = answered(outcome);

    expect(answer).toBe("synth saves it");
    expect(calls).toHaveLength(2);
    expect(trace[1]).toMatchObject({ phase: "act", tool: "researcher", ok: false });
    expect(trace[1]?.note).toBe("role_failed");
    expect(trace[2]).toMatchObject({ tool: "synthesizer", ok: true, note: "role_ok" });
  });

  it("treats a non-object role result as a failure instead of crashing", async () => {
    const { outcome } = await runWithStub(
      plan([
        task("researcher", RESEARCHER_TASK_ID),
        task("synthesizer", SYNTHESIZER_TASK_ID),
      ]),
      (input) =>
        (input.task.role === "researcher"
          ? null
          : {
              role: input.task.role,
              taskId: input.task.id,
              text: "ok",
              ok: true,
            }) as RoleOutput,
    );

    expect(answered(outcome).answer).toBe("ok");
  });

  it("stops at the turn limit and merges what already ran", async () => {
    const { runner, calls } = recordingRunner();
    const outcome = await runPlan(
      plan([
        task("researcher", RESEARCHER_TASK_ID),
        task("synthesizer", SYNTHESIZER_TASK_ID),
        task("critic", "c1"),
      ]),
      {
        runRole: runner,
        now: FROZEN_NOW,
        budget: { maxToolTurns: 1, loopDeadlineMs: 45_000, toolTimeoutMs: 10_000 },
      },
    );

    expect(calls.map((call) => call.task.role)).toEqual(["researcher"]);
    expect(answered(outcome).answer).toBe("researcher says hi");
  });

  it("stops before any role when the loop deadline is already spent", async () => {
    const { runner, calls } = recordingRunner();
    const outcome = await runPlan(plan([task("researcher", RESEARCHER_TASK_ID)]), {
      runRole: runner,
      now: FROZEN_NOW,
      budget: { maxToolTurns: 4, loopDeadlineMs: 0, toolTimeoutMs: 10_000 },
    });

    expect(calls).toHaveLength(0);
    expect(answered(outcome).answer).toBe(
      "No result available for: compare tea and coffee",
    );
  });

  it("falls back with unexpected_error for an unusable plan", async () => {
    const unusable = [
      null,
      undefined,
      {},
      { goal: "", tasks: [task("researcher", "r1")] },
      { goal: "   ", tasks: [task("researcher", "r1")] },
      { goal: "goal", tasks: [] },
      { goal: "goal", tasks: "nope" },
    ];

    for (const bad of unusable) {
      const outcome = await runPlan(bad as unknown as OrchestrationPlan, {});
      expect(outcome).toMatchObject({ kind: "fallback", reason: "unexpected_error" });
    }
  });
});

describe("runPlan - safety", () => {
  it("never throws for a hostile plan or hostile deps", async () => {
    const hostile = new Proxy({}, { get() { throw new Error("x"); } });

    const badPlan = await runPlan(hostile as never, {} as never);
    expect(badPlan).toMatchObject({ kind: "fallback", reason: "unexpected_error" });

    const badDeps = await runPlan(
      plan([task("researcher", RESEARCHER_TASK_ID)]),
      hostile as never,
    );
    expect(badDeps).toMatchObject({ kind: "fallback", reason: "unexpected_error" });
  });

  it("survives a clock that throws and a clock that runs backwards", async () => {
    const throwing = await runPlan(plan([task("researcher", RESEARCHER_TASK_ID)]), {
      runRole: recordingRunner().runner,
      budget: ROOMY_BUDGET,
      now: () => {
        throw new Error("clock");
      },
    });
    expect(answered(throwing).answer).toBe("researcher says hi");

    let tick = 1_000;
    const backwards = await runPlan(plan([task("researcher", RESEARCHER_TASK_ID)]), {
      runRole: recordingRunner().runner,
      budget: ROOMY_BUDGET,
      now: () => {
        tick -= 10;
        return tick;
      },
    });
    expect(answered(backwards).trace.every((step) => step.durationMs >= 0)).toBe(true);
  });

  it("does not mutate or reorder the plan it is given", async () => {
    const original = plan([
      task("synthesizer", SYNTHESIZER_TASK_ID),
      task("researcher", RESEARCHER_TASK_ID),
    ]);
    const snapshot = JSON.stringify(original);

    await runPlan(original, {
      runRole: recordingRunner().runner,
      budget: ROOMY_BUDGET,
      now: FROZEN_NOW,
    });

    expect(JSON.stringify(original)).toBe(snapshot);
    expect(original.tasks[0]?.role).toBe("synthesizer");
  });
});

describe("runOrchestration - entry point", () => {
  it("defers with orchestration_disabled when the flag is off (production default)", async () => {
    const { runner, calls } = recordingRunner();
    const outcome = await runOrchestration(request("compare tea and coffee"), {
      runRole: runner,
    });

    expect(outcome).toMatchObject({ kind: "deferred", reason: "orchestration_disabled" });
    expect(calls).toHaveLength(0);
  });

  it("fails closed when the flag reader throws", async () => {
    const outcome = await runOrchestration(request("compare tea and coffee"), {
      isFlagEnabled: () => {
        throw new Error("boom");
      },
    });

    expect(outcome).toMatchObject({ kind: "deferred", reason: "orchestration_disabled" });
  });

  it("defers ordinary chat even with the flag on", async () => {
    const { runner, calls } = recordingRunner();
    const outcome = await runOrchestration(request("hey there, tell me a joke"), {
      isFlagEnabled: () => true,
      runRole: runner,
    });

    expect(outcome).toMatchObject({ kind: "deferred", reason: "not_multi_agent_request" });
    expect(calls).toHaveLength(0);
  });

  it("defers an unusable request even with the flag on", async () => {
    for (const bad of [undefined, null, 42, "", "   "]) {
      const outcome = await runOrchestration(request(bad), { isFlagEnabled: () => true });
      expect(outcome).toMatchObject({ kind: "deferred", reason: "invalid_request" });
    }
  });

  it("answers a multi-part request by running the skeleton plan's roles", async () => {
    const { runner, calls } = recordingRunner();
    const outcome = await runOrchestration(request("compare tea and coffee"), {
      isFlagEnabled: () => true,
      runRole: runner,
      budget: ROOMY_BUDGET,
      now: FROZEN_NOW,
    });

    expect(calls.map((call) => call.task.role)).toEqual(["researcher", "synthesizer"]);
    const { answer, trace } = answered(outcome);
    expect(answer).toBe("synthesizer says hi");
    expect(trace).toHaveLength(3);
  });

  it("honours an injected gate, so an ordinary message can still plan", async () => {
    const { runner } = recordingRunner();
    const outcome = await runOrchestration(request("just chatting"), {
      isFlagEnabled: () => true,
      isMultiAgent: () => true,
      runRole: runner,
      budget: ROOMY_BUDGET,
      now: FROZEN_NOW,
    });

    expect(answered(outcome).answer).toBe("synthesizer says hi");
  });

  it("uses the deterministic skeleton runner when none is injected", async () => {
    const outcome = await runOrchestration(request("compare tea and coffee"), {
      isFlagEnabled: () => true,
      budget: ROOMY_BUDGET,
      now: FROZEN_NOW,
    });
    const { answer } = answered(outcome);

    expect(answer.startsWith("[synthesizer] ")).toBe(true);
    expect(answer).toContain("compare tea and coffee");
  });

  it("never throws for hostile input or hostile deps", async () => {
    const hostile = new Proxy({}, { get() { throw new Error("x"); } });
    const outcome = await runOrchestration(hostile as never, {} as never);

    expect(["answered", "deferred", "fallback"]).toContain(outcome.kind);
  });
});

describe("production isolation", () => {
  const guarded = [
    "app/api/chat/route.ts",
    "lib/agent/loop.ts",
    "lib/agent/runner.ts",
    "lib/core/pipeline.ts",
  ];

  it("is not imported by the chat route, the loop, the runner, or the pipeline", () => {
    for (const relative of guarded) {
      const source = readFileSync(path.join(process.cwd(), relative), "utf8");
      expect(source).not.toContain("agent/orchestration");
      expect(source).not.toContain("ENABLE_MULTI_AGENT");
    }
  });
});
