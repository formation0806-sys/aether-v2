/** Unit tests for lib/agent/planner/background.ts.
 *
 * Exercises the background planning job with stubbed flags, gate, model and
 * repository: no Supabase client, no database, no network. Covers the flag-off
 * no-op, cheap gate rejection, the planned/deferred paths, telemetry
 * content-freedom, and the never-throws/never-rejects contract. Also asserts
 * the route wiring stays post-response and flag-guarded.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { AiPlanRequest } from "@/lib/agent/planner/types";
import {
  PLANNER_FAILURE_TOKEN,
  PLANNER_LOG_TAG,
  isPlanningJobEnabled,
  runPlanningJob,
  schedulePlanningJob,
} from "@/lib/agent/planner/background";

const BACKGROUND_SOURCE = readFileSync(
  path.join(process.cwd(), "lib", "agent", "planner", "background.ts"),
  "utf8",
);

const ROUTE_SOURCE = readFileSync(
  path.join(process.cwd(), "app", "api", "chat", "route.ts"),
  "utf8",
);

/**
 * Standing stub for the planner repository module, so the lazy import inside
 * persist.ts resolves to a recorder instead of ever building a Supabase client.
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
const PLANNING_MESSAGE = "make a plan to launch the private beta";
const CHAT_MESSAGE = "how are you doing today";

interface Harness {
  deps: Parameters<typeof runPlanningJob>[1];
  gateCalls: string[];
  modelCalls: number;
  logs: string[];
  errors: Array<{ reason: string; error: unknown }>;
}

interface HarnessOptions {
  flag?: boolean;
  flagThrows?: boolean;
  message?: string | null;
  gate?: "accept" | "reject" | "throw";
  model?: "ok" | "throw" | "garbage" | null;
  onLogThrows?: boolean;
  onErrorThrows?: boolean;
  isPlanning?: (message: unknown) => boolean;
}

/** Builds injectable deps and records every call the job makes. */
function makeHarness(options: HarnessOptions = {}): Harness {
  const gateCalls: string[] = [];
  const harness: Harness = {
    deps: {},
    gateCalls,
    modelCalls: 0,
    logs: [],
    errors: [],
  };

  const gate =
    options.gate === "throw"
      ? () => {
          throw new Error("gate exploded");
        }
      : () => options.gate !== "reject";

  harness.deps = {
    isFlagEnabled: options.flagThrows
      ? () => {
          throw new Error("flag reader exploded");
        }
      : () => options.flag === true,
    isPlanning:
      options.isPlanning ??
      ((message: unknown) => {
        gateCalls.push(String(message));

        return gate();
      }),
    onLog: (line: string) => {
      if (options.onLogThrows) throw new Error("logger exploded");

      harness.logs.push(line);
    },
    onError: (reason: string, error: unknown) => {
      if (options.onErrorThrows) throw new Error("sink exploded");

      harness.errors.push({ reason, error });
    },
  };

  if (options.model !== null) {
    const mode = options.model ?? "ok";

    harness.deps.provider = {
      chat: async () => {
        harness.modelCalls += 1;

        if (mode === "throw") throw new Error("model exploded");

        if (mode === "garbage") return "not json at all";

        return JSON.stringify({
          subGoals: [{ title: "Research" }],
          steps: [{ subGoal: 1, title: "Survey", nextAction: "Book interviews" }],
        });
      },
    };
  }

  return harness;
}

/** A request built from a possibly-hostile message. */
function request(message: unknown = PLANNING_MESSAGE): AiPlanRequest {
  return { userId: USER_ID, message } as unknown as AiPlanRequest;
}

describe("ai planner background - flag gating", () => {
  it("does nothing when ENABLE_AI_PLANNER is off", async () => {
    const harness = makeHarness({ flag: false });

    repoModule.calls.length = 0;

    const result = await runPlanningJob(request(), harness.deps);

    expect(result).toEqual({
      status: "skipped",
      reason: "planner_disabled",
      persistence: null,
    });
    expect(harness.gateCalls).toEqual([]);
    expect(harness.modelCalls).toBe(0);
    expect(repoModule.calls.length).toBe(0);
    expect(harness.logs).toEqual([]);
  });

  it("is off by default in the real environment", () => {
    expect(isPlanningJobEnabled()).toBe(false);
    expect(isPlanningJobEnabled({})).toBe(false);
  });

  it("treats a throwing flag reader as off", async () => {
    const harness = makeHarness({ flagThrows: true });

    expect(isPlanningJobEnabled(harness.deps)).toBe(false);

    const result = await runPlanningJob(request(), harness.deps);

    expect(result.reason).toBe("planner_disabled");
    expect(harness.modelCalls).toBe(0);
    expect(repoModule.calls.length).toBe(0);
  });

  it("returns immediately from schedulePlanningJob when the flag is off", async () => {
    const harness = makeHarness({ flag: false });

    repoModule.calls.length = 0;

    await expect(
      schedulePlanningJob(request(), harness.deps),
    ).resolves.toBeUndefined();

    expect(harness.gateCalls).toEqual([]);
    expect(harness.modelCalls).toBe(0);
    expect(repoModule.calls.length).toBe(0);
  });
});

describe("ai planner background - cheap rejection before the model", () => {
  it("rejects unusable requests without touching the model", async () => {
    const inputs = [null, undefined, {}, { userId: USER_ID }, { userId: USER_ID, message: 42 }];

    for (const input of inputs) {
      const harness = makeHarness({ flag: true });

      const result = await runPlanningJob(
        input as unknown as AiPlanRequest,
        harness.deps,
      );

      expect(result).toEqual({
        status: "skipped",
        reason: "invalid_request",
        persistence: null,
      });
      expect(harness.gateCalls).toEqual([]);
      expect(harness.modelCalls).toBe(0);
    }
  });

  it("treats blank messages as unusable", async () => {
    const harness = makeHarness({ flag: true });

    const result = await runPlanningJob(request("    "), harness.deps);

    expect(result.reason).toBe("invalid_request");
    expect(harness.modelCalls).toBe(0);
  });

  it("rejects ordinary chat via the injected gate without spending a completion", async () => {
    const harness = makeHarness({ flag: true, gate: "reject" });

    repoModule.calls.length = 0;

    const result = await runPlanningJob(request(CHAT_MESSAGE), harness.deps);

    expect(result).toEqual({
      status: "skipped",
      reason: "not_planning_request",
      persistence: null,
    });
    expect(harness.gateCalls).toEqual([CHAT_MESSAGE]);
    expect(harness.modelCalls).toBe(0);
    expect(repoModule.calls.length).toBe(0);
  });

  it("rejects ordinary chat with the real deterministic gate", async () => {
    const harness = makeHarness({ flag: true });

    repoModule.calls.length = 0;

    // Drop the injected gate so the real classifier runs: ordinary chat must
    // be refused before any completion is spent or any row is written.
    delete harness.deps.isPlanning;

    const result = await runPlanningJob(request(CHAT_MESSAGE), harness.deps);

    expect(result).toEqual({
      status: "skipped",
      reason: "not_planning_request",
      persistence: null,
    });
    expect(harness.modelCalls).toBe(0);
    expect(repoModule.calls.length).toBe(0);
  });

  it("skips an empty or whitespace-only message", async () => {
    const harness = makeHarness({ flag: true });

    for (const message of ["", "   ", "\n\t "]) {
      const result = await runPlanningJob(request(message), harness.deps);

      expect(result.status).toBe("skipped");
      expect(result.reason).toBe("invalid_request");
    }

    expect(harness.modelCalls).toBe(0);
  });

  it("treats a throwing gate as not a planning request", async () => {
    const harness = makeHarness({ flag: true, gate: "throw" });

    const result = await runPlanningJob(request(), harness.deps);

    expect(result).toEqual({
      status: "skipped",
      reason: "not_planning_request",
      persistence: null,
    });
    expect(harness.modelCalls).toBe(0);
  });

  it("uses the real gate by default, so chat never reaches the model", async () => {
    const harness = makeHarness({ flag: true });

    harness.deps.isPlanning = undefined;

    const result = await runPlanningJob(request(CHAT_MESSAGE), harness.deps);

    expect(result.reason).toBe("not_planning_request");
    expect(harness.modelCalls).toBe(0);
  });
});

describe("ai planner background - planned path", () => {
  it("plans and persists when the flag is on and the gate accepts", async () => {
    const harness = makeHarness({ flag: true });

    repoModule.calls.length = 0;

    const result = await runPlanningJob(request(), harness.deps);

    expect(result).toEqual({
      status: "planned",
      reason: null,
      persistence: "persisted",
    });
    expect(harness.modelCalls).toBe(1);
    expect(repoModule.calls.map((call) => call.table)).toEqual([
      "goal",
      "project",
      "milestone",
      "task",
    ]);
  });

  it("persists through the real repository module when none is injected", async () => {
    const harness = makeHarness({ flag: true });

    repoModule.calls.length = 0;

    const result = await runPlanningJob(request(), harness.deps);

    expect(result.status).toBe("planned");
    expect(repoModule.calls.length).toBe(4);
    expect(repoModule.calls[0]?.data["user_id"]).toBe(USER_ID);
  });

  it("writes nothing on a dry run when persistence is declined", async () => {
    const harness = makeHarness({ flag: true });

    repoModule.calls.length = 0;

    const result = await runPlanningJob(request(), {
      ...harness.deps,
      persist: false,
    });

    expect(result).toEqual({
      status: "planned",
      reason: null,
      persistence: null,
    });
    expect(harness.modelCalls).toBe(1);
    expect(repoModule.calls.length).toBe(0);
  });

  it("still plans from the skeleton when the model fails", async () => {
    const harness = makeHarness({ flag: true, model: "throw" });

    repoModule.calls.length = 0;

    const result = await runPlanningJob(request(), harness.deps);

    expect(result.status).toBe("planned");
    expect(result.persistence).toBe("persisted");
    expect(harness.modelCalls).toBe(1);
    expect(repoModule.calls.length).toBeGreaterThan(0);
  });

  it("still plans from the skeleton when the model returns garbage", async () => {
    const harness = makeHarness({ flag: true, model: "garbage" });

    const result = await runPlanningJob(request(), harness.deps);

    expect(result.status).toBe("planned");
    expect(harness.modelCalls).toBe(1);
  });

  it("returns the plan without writing when the owner id is not a uuid", async () => {
    const harness = makeHarness({ flag: true });

    repoModule.calls.length = 0;

    const result = await runPlanningJob(
      { userId: "not-a-uuid", message: PLANNING_MESSAGE } as unknown as AiPlanRequest,
      harness.deps,
    );

    expect(result).toEqual({
      status: "planned",
      reason: null,
      persistence: "skipped",
    });
    expect(repoModule.calls.length).toBe(0);
  });

  it("skips when the real flag reader reports the flag off", async () => {
    const harness = makeHarness({ flag: true });

    // Drop the injected reader so the real isFeatureEnabled() runs. With the
    // environment unset this must be a no-op, regardless of injected stubs.
    const result = await runPlanningJob(request(), {
      ...harness.deps,
      isFlagEnabled: undefined,
    });

    expect(result).toEqual({
      status: "skipped",
      reason: "planner_disabled",
      persistence: null,
    });
    expect(harness.modelCalls).toBe(0);
  });
});

describe("ai planner background - telemetry and resilience", () => {
  it("logs one content-free status line for a plan", async () => {
    const harness = makeHarness({ flag: true });

    await runPlanningJob(request(), harness.deps);

    expect(harness.logs).toEqual([
      `${PLANNER_LOG_TAG} status=planned reason=none persistence=persisted`,
    ]);

    const line = harness.logs[0] ?? "";

    expect(line).not.toContain(PLANNING_MESSAGE);
    expect(line).not.toContain("Launch");
    expect(line).not.toContain(USER_ID);
    expect(line).not.toContain("Research");
  });

  it("never logs while the flag is off", async () => {
    const harness = makeHarness({ flag: false });

    await runPlanningJob(request(), harness.deps);

    expect(harness.logs).toEqual([]);
  });

  it("survives a throwing logger", async () => {
    const harness = makeHarness({ flag: true, onLogThrows: true });

    const result = await runPlanningJob(request(), harness.deps);

    expect(result.status).toBe("planned");
  });

  it("reports an unexpected failure with a fixed token only", async () => {
    const errors: Array<{ reason: string; error: unknown }> = [];

    const hostileDeps = new Proxy(
      {},
      {
        get(_target, key) {
          if (key === "isFlagEnabled") return () => true;
          if (key === "isPlanning") return () => true;

          if (key === "onError") {
            return (reason: string, error: unknown) => {
              errors.push({ reason, error });
            };
          }

          throw new Error("hostile deps");
        },
      },
    );

    const result = await runPlanningJob(
      request(),
      hostileDeps as Parameters<typeof runPlanningJob>[1],
    );

    expect(result).toEqual({
      status: "skipped",
      reason: "unexpected_error",
      persistence: null,
    });
    expect(errors.length).toBe(1);
    expect(errors[0]?.reason).toBe(PLANNER_FAILURE_TOKEN);
  });

  it("survives a throwing error sink", async () => {
    const hostileDeps = new Proxy(
      {},
      {
        get(_target, key) {
          if (key === "isFlagEnabled") return () => true;
          if (key === "isPlanning") return () => true;
          if (key === "onError") {
            return () => {
              throw new Error("sink exploded");
            };
          }

          throw new Error("hostile deps");
        },
      },
    );

    const result = await runPlanningJob(
      request(),
      hostileDeps as Parameters<typeof runPlanningJob>[1],
    );

    expect(result.reason).toBe("unexpected_error");
  });

  // The valid request in this list triggers the module's lazy runtime imports
  // (`./index`, `./persist`, `@/lib/ai/provider`), whose first-use transform
  // cost is charged to this test. Under a fully parallel suite on a loaded
  // machine that alone can exceed vitest's 5s default, so the budget is raised
  // here only. The assertions stay exact.
  it("never rejects from schedulePlanningJob, whatever it is given", async () => {
    const inputs = [
      null,
      undefined,
      "not a request",
      [],
      { userId: null, message: null },
      request(CHAT_MESSAGE),
      request(),
    ];

    for (const input of inputs) {
      await expect(
        schedulePlanningJob(input as unknown as AiPlanRequest, {
          isFlagEnabled: () => true,
        }),
      ).resolves.toBeUndefined();
    }
  }, 30_000);
});

describe("ai planner background - wiring stays background-only", () => {
  it("keeps the flag check and the dynamic import as the only production path", () => {
    expect(ROUTE_SOURCE).toContain('isFeatureEnabled("ENABLE_AI_PLANNER")');
    expect(ROUTE_SOURCE).toContain('import("@/lib/agent/planner/background")');
    expect(ROUTE_SOURCE).toContain("schedulePlanningJob");
    expect(ROUTE_SOURCE).not.toContain(
      'from "@/lib/agent/planner/background"',
    );
  });

  it("never awaits planning in the request path", () => {
    expect(ROUTE_SOURCE).not.toContain("await schedulePlanningJob");
    expect(ROUTE_SOURCE).not.toContain("await runPlanningJob");
    expect(ROUTE_SOURCE).not.toContain("runPlanningJob");
  });

  it("schedules planning only after the memory-jobs callback", () => {
    const memoryJobs = ROUTE_SOURCE.indexOf("processMemoryJobs");
    const planner = ROUTE_SOURCE.indexOf("ENABLE_AI_PLANNER");
    const legacy = ROUTE_SOURCE.indexOf("ai.chat(preResult.conversation)");

    expect(memoryJobs).toBeGreaterThan(-1);
    expect(planner).toBeGreaterThan(memoryJobs);
    expect(legacy).toBeGreaterThan(planner);
  });

  it("leaves the legacy response path intact", () => {
    expect(ROUTE_SOURCE).toContain("getProvider()");
    expect(ROUTE_SOURCE).toContain("ai.chat(preResult.conversation)");
    expect(ROUTE_SOURCE).toContain(
      "await saveAssistantMessage(preResult.userId, fullResponse, preResult.conversationId)",
    );
  });

  it("imports no provider, database or timer into the job module", () => {
    expect(BACKGROUND_SOURCE).not.toContain("from \"@/lib/ai/provider\"");
    expect(BACKGROUND_SOURCE).not.toContain("@supabase");
    expect(BACKGROUND_SOURCE).not.toContain("createClient");
    expect(BACKGROUND_SOURCE).not.toContain("process.env");
    expect(BACKGROUND_SOURCE).not.toContain("setTimeout");
    expect(BACKGROUND_SOURCE).not.toContain("setInterval");
    expect(BACKGROUND_SOURCE).not.toContain("fetch(");
  });

  it("reads the flag through the shared feature-flag module only", () => {
    expect(BACKGROUND_SOURCE).toContain('from "@/lib/config/features"');
    expect(BACKGROUND_SOURCE).toContain("isFeatureEnabled");
    expect(ROUTE_SOURCE).toContain('"@/lib/config/features"');
  });
});
