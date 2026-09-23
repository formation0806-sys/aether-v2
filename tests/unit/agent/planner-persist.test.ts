/** Unit tests for lib/agent/planner/persist.ts.
 *
 * Exercises AI plan persistence with a stubbed repository: no Supabase client,
 * no database, no network, no environment dependency beyond injected stubs.
 * Covers mapping, deterministic ids, idempotency, per-branch isolation, and
 * the never-throws contract, plus the flag-gated generateAndPersistPlan entry
 * point. Nothing here is wired into the chat route or the job worker.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "@/lib/ai/types";
import type { AiPlan, AiPlanRequest } from "@/lib/agent/planner/types";
import {
  DUPLICATE_KEY_CODE,
  MAX_PERSIST_STEPS,
  MAX_PERSIST_SUB_GOALS,
  MAX_PERSIST_TITLE_CHARS,
  derivePlanUuid,
  generateAndPersistPlan,
  isUsableRepository,
  isUuidLike,
  mapPlanToRows,
  persistPlan,
} from "@/lib/agent/planner/persist";
import type { PlanRepository } from "@/lib/agent/planner/persist";

const PERSIST_SOURCE = readFileSync(
  path.join(process.cwd(), "lib", "agent", "planner", "persist.ts"),
  "utf8",
);

const INDEX_SOURCE = readFileSync(
  path.join(process.cwd(), "lib", "agent", "planner", "index.ts"),
  "utf8",
);

/**
 * Standing stub for the planner repository module. It exists so the
 * "no repository injected" path can be exercised - proving persistPlan resolves
 * the real repository module lazily - without ever constructing a Supabase
 * client or reaching a database. Every assertion in this file runs against
 * stubs.
 */
const repoModule = vi.hoisted(() => {
  const calls: Array<{ table: string; data: Record<string, unknown> }> = [];

  function record(table: string) {
    return async (data: Record<string, unknown>) => {
      calls.push({ table, data });

      return { error: null };
    };
  }

  return {
    calls,
    insertGoal: record("goal"),
    insertProject: record("project"),
    insertMilestone: record("milestone"),
    insertTask: record("task"),
  };
});

vi.mock("@/lib/repositories/planner.repository", () => ({
  insertGoal: repoModule.insertGoal,
  insertProject: repoModule.insertProject,
  insertMilestone: repoModule.insertMilestone,
  insertTask: repoModule.insertTask,
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";

type Table = "goal" | "project" | "milestone" | "task";

interface RecordedCall {
  table: Table;
  data: Record<string, unknown>;
}

interface StubOptions {
  /** Applied to every table unless an override matches first. */
  mode?: "ok" | "duplicate" | "error" | "reject" | "throw";
  failingTables?: Table[];
  duplicateTables?: Table[];
}

/** A valid two-level plan: 1 goal + 1 project + 2 milestones + 3 tasks. */
function planFixture(): AiPlan {
  return {
    goal: "Launch the beta",
    subGoals: [
      { id: "sub-goal-1", title: "Prepare" },
      { id: "sub-goal-2", title: "Ship" },
    ],
    steps: [
      {
        id: "sub-goal-1-step-1",
        subGoalId: "sub-goal-1",
        title: "Draft the checklist",
        nextAction: "Write the checklist",
        priority: "high",
        status: "todo",
      },
      {
        id: "sub-goal-1-step-2",
        subGoalId: "sub-goal-1",
        title: "Review the checklist",
        nextAction: "Book a review",
        priority: "medium",
        status: "todo",
      },
      {
        id: "sub-goal-2-step-1",
        subGoalId: "sub-goal-2",
        title: "Run the release",
        nextAction: "Tag the build",
        priority: "critical",
        status: "todo",
      },
    ],
  };
}

/** Records every write and replies according to `options`. */
function makeRepository(options: StubOptions = {}) {
  const calls: RecordedCall[] = [];

  function respond(table: Table): unknown {
    if (options.failingTables?.includes(table)) {
      return { error: { code: "42P01" } };
    }

    if (options.duplicateTables?.includes(table) || options.mode === "duplicate") {
      return { error: { code: DUPLICATE_KEY_CODE } };
    }

    if (options.mode === "error") return { error: { code: "XX000" } };

    if (options.mode === "reject") return Promise.reject(new Error("offline"));

    if (options.mode === "throw") throw new Error("synchronous failure");

    return { error: null };
  }

  function record(table: Table, data: Record<string, unknown>): unknown {
    calls.push({ table, data });

    return respond(table);
  }

  const repository = {
    insertGoal: (data: Record<string, unknown>) => record("goal", data),
    insertProject: (data: Record<string, unknown>) => record("project", data),
    insertMilestone: (data: Record<string, unknown>) => record("milestone", data),
    insertTask: (data: Record<string, unknown>) => record("task", data),
  } as unknown as PlanRepository;

  return { repository, calls };
}

/** A model stub that returns one sub-goal with one step. */
function planningOn() {
  return {
    isFlagEnabled: () => true,
    provider: {
      chat: async (_messages: ChatMessage[]) =>
        JSON.stringify({
          subGoals: [{ title: "Research" }],
          steps: [{ subGoal: 1, title: "Survey", nextAction: "Book interviews" }],
        }),
    },
  };
}

describe("ai planner persist - derivePlanUuid", () => {
  it("is deterministic for the same parts", () => {
    expect(derivePlanUuid(USER_ID, "goal", "Launch")).toBe(
      derivePlanUuid(USER_ID, "goal", "Launch"),
    );
  });

  it("differs across parts, including the role tag", () => {
    const a = derivePlanUuid(USER_ID, "goal", "Launch");

    expect(derivePlanUuid(USER_ID, "project", "Launch")).not.toBe(a);
    expect(
      derivePlanUuid("22222222-2222-4222-8222-222222222222", "goal", "Launch"),
    ).not.toBe(a);
    expect(derivePlanUuid(USER_ID, "goal", "Other")).not.toBe(a);
  });

  it("returns a well-formed uuid (version 4, variant 8)", () => {
    const id = derivePlanUuid(USER_ID, "goal", "Launch");

    expect(isUuidLike(id)).toBe(true);
    expect(id[14]).toBe("4");
    expect("89ab").toContain(id[19]);
  });

  it("never throws for empty or non-string parts", () => {
    expect(() => derivePlanUuid()).not.toThrow();
    expect(isUuidLike(derivePlanUuid("", ""))).toBe(true);
    expect(() =>
      derivePlanUuid(undefined as unknown as string, null as unknown as string),
    ).not.toThrow();
  });

  it("rejects malformed uuid candidates", () => {
    expect(isUuidLike("not-a-uuid")).toBe(false);
    expect(isUuidLike("")).toBe(false);
    expect(isUuidLike(USER_ID.toUpperCase())).toBe(true);
    expect(isUuidLike(42)).toBe(false);
    expect(isUuidLike(null)).toBe(false);
  });
});

describe("ai planner persist - mapPlanToRows structure", () => {
  it("maps goal, container, sub-goals and steps with correct parents", () => {
    const planned = mapPlanToRows(planFixture(), USER_ID);

    expect(planned).not.toBeNull();

    const rows = planned?.rows ?? [];

    expect(rows.map((row) => row.table)).toEqual([
      "goal",
      "project",
      "milestone",
      "milestone",
      "task",
      "task",
      "task",
    ]);

    const goalId = planned?.goalId ?? "";
    const projectRow = rows[1];

    expect(projectRow?.parentId).toBe(goalId);
    expect(projectRow?.data["goal_id"]).toBe(goalId);

    const projectId = projectRow?.id ?? "";

    expect(rows[2]?.parentId).toBe(projectId);
    expect(rows[2]?.data["project_id"]).toBe(projectId);
    expect(rows[2]?.data["title"]).toBe("Prepare");
    expect(rows[3]?.parentId).toBe(projectId);
    expect(rows[3]?.data["title"]).toBe("Ship");

    const milestoneIds = rows
      .filter((row) => row.table === "milestone")
      .map((row) => row.id);

    for (const row of rows.filter((entry) => entry.table === "task")) {
      expect(milestoneIds).toContain(row.parentId);
      expect(row.data["milestone_id"]).toBe(row.parentId);
    }

    expect(planned?.subGoals).toBe(2);
    expect(planned?.steps).toBe(3);
    expect(rows[0]?.id).toBe(goalId);
  });

  it("is stable for the same plan, which is what makes re-runs idempotent", () => {
    const first = mapPlanToRows(planFixture(), USER_ID)?.rows.map((row) => row.id);
    const second = mapPlanToRows(planFixture(), USER_ID)?.rows.map((row) => row.id);

    expect(first).toEqual(second);
    expect(first?.every((id) => isUuidLike(id))).toBe(true);
  });

  it("returns null when the owner id is not a uuid", () => {
    expect(mapPlanToRows(planFixture(), "not-a-uuid")).toBeNull();
    expect(mapPlanToRows(planFixture(), "")).toBeNull();
    expect(mapPlanToRows(planFixture(), 42 as unknown as string)).toBeNull();
  });

  it("returns null for plans with no usable sub-goals or steps", () => {
    const base = planFixture();

    expect(mapPlanToRows({ ...base, goal: "" }, USER_ID)).toBeNull();
    expect(mapPlanToRows({ ...base, goal: "   " }, USER_ID)).toBeNull();
    expect(mapPlanToRows({ ...base, subGoals: [] }, USER_ID)).toBeNull();
    expect(mapPlanToRows({ ...base, steps: [] }, USER_ID)).toBeNull();
    expect(
      mapPlanToRows(
        { ...base, steps: [{ ...base.steps[0], subGoalId: "missing" }] },
        USER_ID,
      ),
    ).toBeNull();
    expect(mapPlanToRows(null as unknown as AiPlan, USER_ID)).toBeNull();
    expect(mapPlanToRows([] as unknown as AiPlan, USER_ID)).toBeNull();
    expect(mapPlanToRows("plan" as unknown as AiPlan, USER_ID)).toBeNull();
  });
});

describe("ai planner persist - mapPlanToRows normalization", () => {
  it("collapses whitespace and caps titles", () => {
    const longTitle = "x".repeat(MAX_PERSIST_TITLE_CHARS + 40);

    const planned = mapPlanToRows(
      {
        goal: "  Launch   the beta  ",
        subGoals: [{ id: "a", title: "  Prepare   the  beta " }],
        steps: [
          {
            id: "a-1",
            subGoalId: "a",
            title: longTitle,
            nextAction: "Do the thing",
            priority: "high",
            status: "todo",
          },
        ],
      },
      USER_ID,
    );

    expect(planned?.rows[0]?.data["title"]).toBe("Launch the beta");
    expect(planned?.rows[2]?.data["title"]).toBe("Prepare the beta");
    expect((planned?.rows[3]?.data["title"] as string).length).toBe(
      MAX_PERSIST_TITLE_CHARS,
    );
  });

  it("drops blank sub-goals, unknown sub-goal refs, and keeps valid steps", () => {
    const planned = mapPlanToRows(
      {
        goal: "Launch",
        subGoals: [
          { id: "a", title: "   " },
          { id: "b", title: "Keep me" },
        ],
        steps: [
          {
            id: "a-1",
            subGoalId: "a",
            title: "Orphaned",
            nextAction: "n/a",
            priority: "high",
            status: "todo",
          },
          {
            id: "b-1",
            subGoalId: "b",
            title: "Kept",
            nextAction: "Do it",
            priority: "low",
            status: "doing",
          },
        ],
      },
      USER_ID,
    );

    expect(planned?.rows.map((row) => row.table)).toEqual([
      "goal",
      "project",
      "milestone",
      "task",
    ]);
    expect(planned?.rows[2]?.data["title"]).toBe("Keep me");
    expect(planned?.rows[3]?.data["priority"]).toBe("low");
    expect(planned?.rows[3]?.data["status"]).toBe("doing");
    expect(planned?.rows[3]?.data["description"]).toBe("Do it");
    expect(planned?.rows[3]?.data["next_action"]).toBe("Do it");
    expect(planned?.steps).toBe(1);
  });

  it("defaults unknown priority and status instead of trusting the model", () => {
    const planned = mapPlanToRows(
      {
        goal: "Launch",
        subGoals: [{ id: "a", title: "Sub" }],
        steps: [
          {
            id: "a-1",
            subGoalId: "a",
            title: "Step",
            nextAction: "Do it",
            priority: "urgent" as unknown as "high",
            status: "blocked" as unknown as "todo",
          },
        ],
      },
      USER_ID,
    );

    expect(planned?.rows[3]?.data["priority"]).toBe("medium");
    expect(planned?.rows[3]?.data["status"]).toBe("todo");
  });

  it("uses null (not empty string) for a missing next action", () => {
    const planned = mapPlanToRows(
      {
        goal: "Launch",
        subGoals: [{ id: "a", title: "Sub" }],
        steps: [
          {
            id: "a-1",
            subGoalId: "a",
            title: "Step",
            nextAction: "   ",
            priority: "high",
            status: "todo",
          },
        ],
      },
      USER_ID,
    );

    expect(planned?.rows[3]?.data["next_action"]).toBeNull();
  });

  it("bounds sub-goals and steps", () => {
    const subGoals = Array.from(
      { length: MAX_PERSIST_SUB_GOALS + 5 },
      (_v, i) => ({ id: `s${i}`, title: `Sub ${i}` }),
    );

    const steps = Array.from({ length: MAX_PERSIST_STEPS + 5 }, (_v, i) => ({
      id: `t${i}`,
      subGoalId: `s${i % MAX_PERSIST_SUB_GOALS}`,
      title: `Step ${i}`,
      nextAction: `Action ${i}`,
      priority: "medium" as const,
      status: "todo" as const,
    }));

    const planned = mapPlanToRows({ goal: "Big", subGoals, steps }, USER_ID);
    const rows = planned?.rows ?? [];

    expect(planned).not.toBeNull();
    expect(rows.filter((row) => row.table === "milestone").length).toBe(
      MAX_PERSIST_SUB_GOALS,
    );
    expect(rows.filter((row) => row.table === "task").length).toBe(
      MAX_PERSIST_STEPS,
    );
  });

  it("never throws for adversarial input", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("hostile");
        },
      },
    );

    expect(() =>
      mapPlanToRows(hostile as unknown as AiPlan, USER_ID),
    ).not.toThrow();
    expect(mapPlanToRows(hostile as unknown as AiPlan, USER_ID)).toBeNull();
  });
});

describe("ai planner persist - persistPlan writes", () => {
  it("writes goal, project, milestones and tasks and reports counts", async () => {
    const { repository, calls } = makeRepository();

    const result = await persistPlan(planFixture(), USER_ID, { repository });

    expect(result.status).toBe("persisted");
    expect(result.reason).toBeNull();
    expect(isUuidLike(result.goalId)).toBe(true);
    expect(result.inserted).toEqual({
      goal: 1,
      project: 1,
      milestone: 2,
      task: 3,
    });
    expect(result.duplicates).toBe(0);
    expect(result.failed).toEqual([]);

    expect(calls.map((call) => call.table)).toEqual([
      "goal",
      "project",
      "milestone",
      "milestone",
      "task",
      "task",
      "task",
    ]);
  });

  it("writes the owner id on every row that carries one", async () => {
    const { repository, calls } = makeRepository();

    await persistPlan(planFixture(), USER_ID, { repository });

    for (const call of calls) {
      if (call.table === "goal" || call.table === "project") {
        expect(call.data["user_id"]).toBe(USER_ID);
      }
    }

    expect(calls[0]?.data["user_id"]).toBe(USER_ID);
  });

  it("is idempotent: a re-run collides on derived ids and is not a failure", async () => {
    const { repository } = makeRepository();
    const first = await persistPlan(planFixture(), USER_ID, { repository });

    const rerun = makeRepository({ mode: "duplicate" });
    const second = await persistPlan(planFixture(), USER_ID, {
      repository: rerun.repository,
    });

    expect(first.status).toBe("persisted");
    expect(second.status).toBe("persisted");
    expect(second.reason).toBeNull();
    expect(second.duplicates).toBe(7);
    expect(second.failed).toEqual([]);
    expect(second.inserted).toEqual({
      goal: 0,
      project: 0,
      milestone: 0,
      task: 0,
    });
    expect(rerun.calls.length).toBe(7);
  });

  it("short-circuits only the failed subtree and keeps unrelated rows", async () => {
    const { repository, calls } = makeRepository({
      failingTables: ["milestone"],
    });

    const result = await persistPlan(planFixture(), USER_ID, { repository });

    expect(result.status).toBe("partial");
    expect(result.reason).toBe("write_failed");
    expect(result.inserted).toEqual({
      goal: 1,
      project: 1,
      milestone: 0,
      task: 0,
    });
    expect(result.failed.length).toBe(2);
    expect(result.failed.map((entry) => entry.table)).toEqual([
      "milestone",
      "milestone",
    ]);
    expect(result.failed[0]?.code).toBe("42P01");
    expect(calls.length).toBe(4);
    expect(calls.filter((call) => call.table === "task").length).toBe(0);
  });

  it("reports a rejected insert without throwing, and stops at the root", async () => {
    const { repository } = makeRepository({ mode: "reject" });

    const result = await persistPlan(planFixture(), USER_ID, { repository });

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("write_failed");
    expect(result.failed.length).toBe(1);
    expect(result.failed[0]?.table).toBe("goal");
    expect(result.inserted.goal).toBe(0);
  });

  it("survives a repository that throws synchronously", async () => {
    const { repository } = makeRepository({ mode: "throw" });

    const result = await persistPlan(planFixture(), USER_ID, { repository });

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("write_failed");
    expect(result.failed[0]?.code).toBeNull();
  });

  it("treats an empty error object as success", async () => {
    const calls: RecordedCall[] = [];
    const repository = {
      insertGoal: (data: Record<string, unknown>) => {
        calls.push({ table: "goal" as Table, data });

        return Promise.resolve({});
      },
      insertProject: () => Promise.resolve({ error: undefined }),
      insertMilestone: () => Promise.resolve(null),
      insertTask: () => Promise.resolve({ error: null }),
    } as unknown as PlanRepository;

    const result = await persistPlan(planFixture(), USER_ID, { repository });

    expect(result.status).toBe("persisted");
    expect(result.failed).toEqual([]);
    expect(calls.length).toBe(1);
  });
});

describe("ai planner persist - persistPlan guards", () => {
  it("resolves the repository module lazily when none is injected", async () => {
    repoModule.calls.length = 0;

    const result = await persistPlan(planFixture(), USER_ID);

    expect(result.status).toBe("persisted");
    expect(repoModule.calls.map((call) => call.table)).toEqual([
      "goal",
      "project",
      "milestone",
      "milestone",
      "task",
      "task",
      "task",
    ]);
  });

  it("skips with repository_unavailable for an unusable repository", async () => {
    const empty = await persistPlan(planFixture(), USER_ID, {
      repository: {} as PlanRepository,
    });
    const partial = await persistPlan(planFixture(), USER_ID, {
      repository: { insertGoal: () => Promise.resolve({}) } as unknown as PlanRepository,
    });
    const nothing = await persistPlan(planFixture(), USER_ID, {
      repository: null as unknown as PlanRepository,
    });

    for (const result of [empty, partial, nothing]) {
      expect(result.status).toBe("skipped");
      expect(result.reason).toBe("repository_unavailable");
      expect(result.failed).toEqual([]);
    }
  });

  it("skips with invalid_user before deriving any id", async () => {
    const { repository, calls } = makeRepository();

    const result = await persistPlan(planFixture(), "not-a-uuid", { repository });

    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("invalid_user");
    expect(result.goalId).toBeNull();
    expect(calls).toEqual([]);
  });

  it("skips with invalid_plan and writes nothing", async () => {
    const { repository, calls } = makeRepository();

    const result = await persistPlan(
      { ...planFixture(), subGoals: [] } as AiPlan,
      USER_ID,
      { repository },
    );

    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("invalid_plan");
    expect(result.goalId).toBeNull();
    expect(calls).toEqual([]);
  });

  it("never throws and always returns a well-formed result", async () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("hostile");
        },
      },
    );

    const { repository } = makeRepository();

    const inputs: AiPlan[] = [
      null as unknown as AiPlan,
      undefined as unknown as AiPlan,
      [] as unknown as AiPlan,
      "plan" as unknown as AiPlan,
      42 as unknown as AiPlan,
      hostile as unknown as AiPlan,
      { goal: "x" } as unknown as AiPlan,
    ];

    for (const input of inputs) {
      const result = await persistPlan(input, USER_ID, { repository });

      expect(result.status).toBe("skipped");
      expect(typeof result.goalId === "string" || result.goalId === null).toBe(true);
      expect(typeof result.duplicates).toBe("number");
      expect(Array.isArray(result.failed)).toBe(true);
    }

    expect(await persistPlan(hostile as AiPlan, hostile as string)).toMatchObject({
      status: "skipped",
    });
  });

  it("classifies a usable repository defensively", () => {
    expect(isUsableRepository(makeRepository().repository)).toBe(true);
    expect(isUsableRepository(null)).toBe(false);
    expect(isUsableRepository(undefined)).toBe(false);
    expect(isUsableRepository("repository")).toBe(false);
    expect(isUsableRepository([])).toBe(false);
    expect(isUsableRepository({ insertGoal: "nope" })).toBe(false);
  });
});

describe("ai planner persist - generateAndPersistPlan", () => {
  it("defers and writes nothing when the flag is off", async () => {
    repoModule.calls.length = 0;

    const outcome = await generateAndPersistPlan(
      { userId: USER_ID, message: "make a plan to launch the beta" },
      { isFlagEnabled: () => false, persist: true },
    );

    expect(outcome.kind).toBe("deferred");
    expect(outcome.persistence).toBeNull();
    expect(repoModule.calls.length).toBe(0);
  });

  it("defers on the real environment default (flag unset) without writing", async () => {
    repoModule.calls.length = 0;

    const outcome = await generateAndPersistPlan({
      userId: USER_ID,
      message: "make a plan to launch the beta",
    });

    expect(outcome.kind).toBe("deferred");
    expect(outcome.persistence).toBeNull();
    expect(repoModule.calls.length).toBe(0);
  });

  it("generates a plan but writes nothing unless persist is explicitly true", async () => {
    repoModule.calls.length = 0;

    const outcome = await generateAndPersistPlan(
      { userId: USER_ID, message: "make a plan to launch the beta" },
      planningOn(),
    );

    expect(outcome.kind).toBe("planned");
    expect(outcome.persistence).toBeNull();
    expect(repoModule.calls.length).toBe(0);
  });

  it("defers a non-planning message without calling the model or the repository", async () => {
    repoModule.calls.length = 0;

    let modelCalls = 0;

    const outcome = await generateAndPersistPlan(
      { userId: USER_ID, message: "hello there" },
      {
        isFlagEnabled: () => true,
        persist: true,
        provider: {
          chat: async () => {
            modelCalls += 1;

            return "{}";
          },
        },
      },
    );

    expect(outcome.kind).toBe("deferred");
    expect(outcome.persistence).toBeNull();
    expect(modelCalls).toBe(0);
    expect(repoModule.calls.length).toBe(0);
  });

  it("persists when persist is true and reports the write result", async () => {
    repoModule.calls.length = 0;

    const outcome = await generateAndPersistPlan(
      { userId: USER_ID, message: "make a plan to launch the beta" },
      { ...planningOn(), persist: true },
    );

    expect(outcome.kind).toBe("planned");
    expect(outcome.persistence?.status).toBe("persisted");
    expect(outcome.persistence?.inserted).toEqual({
      goal: 1,
      project: 1,
      milestone: 1,
      task: 1,
    });
    expect(repoModule.calls.map((call) => call.table)).toEqual([
      "goal",
      "project",
      "milestone",
      "task",
    ]);
  });

  it("still returns the plan when the write fails", async () => {
    const outcome = await generateAndPersistPlan(
      { userId: USER_ID, message: "make a plan to launch the beta" },
      {
        ...planningOn(),
        persist: true,
        repository: makeRepository({ mode: "error" }).repository,
      },
    );

    expect(outcome.kind).toBe("planned");
    expect(outcome.persistence?.status).toBe("failed");
    expect(outcome.persistence?.reason).toBe("write_failed");
  });

  it("returns the plan but writes nothing when the owner id is not a uuid", async () => {
    repoModule.calls.length = 0;

    let modelCalls = 0;

    const outcome = await generateAndPersistPlan(
      { userId: "not-a-uuid", message: "make a plan to launch the beta" },
      {
        isFlagEnabled: () => true,
        persist: true,
        provider: {
          chat: async () => {
            modelCalls += 1;

            return JSON.stringify({
              subGoals: [{ title: "Research" }],
              steps: [
                { subGoal: 1, title: "Survey", nextAction: "Book interviews" },
              ],
            });
          },
        },
      },
    );

    expect(modelCalls).toBe(1);
    expect(outcome.kind).toBe("planned");
    expect(outcome.persistence?.status).toBe("skipped");
    expect(outcome.persistence?.reason).toBe("invalid_user");
    expect(outcome.persistence?.goalId).toBeNull();
    expect(repoModule.calls.length).toBe(0);
  });

  it("never throws for malformed requests", async () => {
    const inputs = [
      null,
      undefined,
      {},
      { userId: USER_ID },
      { userId: USER_ID, message: 42 },
      { userId: USER_ID, message: "   " },
      { userId: USER_ID, message: "hello there" },
      { userId: USER_ID, message: 42, persist: true },
    ];

    for (const input of inputs) {
      const outcome = await generateAndPersistPlan(
        input as unknown as AiPlanRequest,
        { isFlagEnabled: () => true, persist: true },
      );

      expect(outcome.kind).toBe("deferred");
      expect(outcome.persistence).toBeNull();
    }

    const throwing = await generateAndPersistPlan(
      { userId: USER_ID, message: "make a plan" },
      {
        isFlagEnabled: () => {
          throw new Error("flags down");
        },
        persist: true,
      },
    );

    expect(throwing.kind).toBe("deferred");
    expect(throwing.reason).toBe("planner_disabled");
  });
});

describe("ai planner persist - purity, isolation and telemetry", () => {
  it("reaches the database only through the planner repository", () => {
    expect(PERSIST_SOURCE).toContain('"@/lib/repositories/planner.repository"');
    expect(PERSIST_SOURCE).toContain("import(");
    expect(PERSIST_SOURCE).not.toContain(
      'from "@/lib/repositories/planner.repository"',
    );
    expect(PERSIST_SOURCE).not.toContain("@supabase");
    expect(PERSIST_SOURCE).not.toContain("createClient");
    expect(PERSIST_SOURCE).not.toContain('.from("');
  });

  it("does not touch the legacy planner, the chat path, or the model", () => {
    expect(PERSIST_SOURCE).not.toContain('from "@/lib/planner');
    expect(PERSIST_SOURCE).not.toContain('"@/lib/core');
    expect(PERSIST_SOURCE).not.toContain('"@/lib/ai/provider');
    expect(PERSIST_SOURCE).not.toContain("pipeline");
    expect(PERSIST_SOURCE).not.toContain("app/api");
    expect(PERSIST_SOURCE).not.toContain("next/server");
  });

  it("reads no flag itself: ENABLE_AI_PLANNER stays a single source of truth", () => {
    expect(PERSIST_SOURCE).not.toContain('"@/lib/config/features"');
    expect(PERSIST_SOURCE).not.toContain("isFeatureEnabled");
    expect(PERSIST_SOURCE).not.toContain("process.env");
    expect(INDEX_SOURCE).toContain("ENABLE_AI_PLANNER");
  });

  it("leaves the generate-only entry point write-free", () => {
    expect(INDEX_SOURCE).not.toContain("persistPlan");
    expect(INDEX_SOURCE).not.toContain("generateAndPersistPlan");
    expect(INDEX_SOURCE).not.toContain("planner.repository");
  });

  it("uses no clock, randomness, network, logging or timers", () => {
    expect(PERSIST_SOURCE).not.toContain("Date.now");
    expect(PERSIST_SOURCE).not.toContain("new Date");
    expect(PERSIST_SOURCE).not.toContain("Math.random");
    expect(PERSIST_SOURCE).not.toContain("fetch(");
    expect(PERSIST_SOURCE).not.toContain("console.");
    expect(PERSIST_SOURCE).not.toContain("setTimeout");
    expect(PERSIST_SOURCE).not.toContain("setInterval");
  });

  it("keeps failure telemetry content-free", async () => {
    const { repository } = makeRepository({ mode: "error" });

    const result = await persistPlan(planFixture(), USER_ID, { repository });
    const serialized = JSON.stringify(result);

    expect(result.failed.length).toBeGreaterThan(0);
    expect(serialized).not.toContain("Launch the beta");
    expect(serialized).not.toContain("Draft the checklist");
    expect(serialized).not.toContain("Write the checklist");

    for (const failure of result.failed) {
      expect(Object.keys(failure).sort()).toEqual(["code", "id", "table"]);
    }
  });

  it("does not mutate the plan it is given", async () => {
    const plan = planFixture();
    const snapshot = JSON.stringify(plan);
    const { repository } = makeRepository();

    await persistPlan(plan, USER_ID, { repository });

    expect(JSON.stringify(plan)).toBe(snapshot);
  });

  it("returns a fresh result object per call (no shared state)", async () => {
    const { repository } = makeRepository();

    const first = await persistPlan(planFixture(), USER_ID, { repository });
    const second = await persistPlan(planFixture(), USER_ID, { repository });

    expect(first).not.toBe(second);
    expect(first.inserted).not.toBe(second.inserted);
    expect(first.failed).not.toBe(second.failed);
  });
});
