/** Unit tests for the long-horizon autonomy foundation (Priority L1). */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LONG_HORIZON_FLAG,
  MAX_AUTONOMY_CHECKPOINTS,
  MAX_AUTONOMY_FAILURES,
  MAX_AUTONOMY_TURNS,
  createGoalRun,
  isGoalRun,
  latestCheckpoint,
  recordCheckpoint,
} from "@/lib/agent/autonomy/index";
import { runAutonomy } from "@/lib/agent/autonomy/entry";
import { isAutonomyRequest } from "@/lib/agent/autonomy/gate";
import { decideNext, resumeRun, stepRun, stopRun } from "@/lib/agent/autonomy/transitions";

function readSource(...segments: string[]): string {
  return readFileSync(path.join(process.cwd(), ...segments), "utf8");
}
const GATE_SOURCE = readSource("lib", "agent", "autonomy", "gate.ts");
const TYPES_SOURCE = readSource("lib", "agent", "autonomy", "types.ts");
const ALL_SOURCES = ["gate.ts", "types.ts", "index.ts", "transitions.ts", "entry.ts"]
  .map((f) => readSource("lib", "agent", "autonomy", f))
  .join("\n");

function autonomyOn(now = 1000) {
  return { isFlagEnabled: () => true, now: () => now };
}
function autonomyOff() {
  return { isFlagEnabled: () => false };
}

describe("autonomy gate - long-horizon requests", () => {
  it.each([
    "make a plan to launch my startup",
    "create a plan for the move",
    "my goal is to ship in 90 days",
    "give me a roadmap for learning piano",
    "keep working on my thesis over the next weeks",
    "pick up where we left off on the launch plan",
    "continue the plan for my marathon training",
    "this is my long-term goal for the year",
  ])("accepts %j", (message) => {
    expect(isAutonomyRequest(message)).toBe(true);
  });
});

describe("autonomy gate - ordinary chat rejected", () => {
  it.each([
    "",
    "hi",
    "what time is it?",
    "what is 2+2?",
    "what is my name?",
    "tell me a joke",
  ])("rejects %j", (message) => {
    expect(isAutonomyRequest(message)).toBe(false);
  });

  it("rejects non-strings and over-long messages", () => {
    expect(isAutonomyRequest(undefined)).toBe(false);
    expect(isAutonomyRequest("make a plan " + "x".repeat(2000))).toBe(false);
  });

  it("never reads flags", () => {
    expect(GATE_SOURCE.includes("process.env")).toBe(false);
    expect(GATE_SOURCE.includes("isFeatureEnabled")).toBe(false);
  });
});


describe("autonomy state - create and checkpoint", () => {
  it("creates a fresh active run with one checkpoint", () => {
    const run = createGoalRun("user-1", "launch plan", 1000);
    expect(run.status).toBe("active");
    expect(run.turnsUsed).toBe(0);
    expect(isGoalRun(run)).toBe(true);
    expect(latestCheckpoint(run)).not.toBeNull();
  });

  it("recordCheckpoint never mutates the input", () => {
    const run = createGoalRun("user-1", "launch plan", 1000);
    const next = recordCheckpoint(run, { tasksTotal: 4, tasksDone: 1 }, 2000);
    expect(run.checkpoints.length).toBe(1);
    expect(next.checkpoints.length).toBe(2);
  });

  it("checkpoint list is bounded", () => {
    expect(MAX_AUTONOMY_CHECKPOINTS).toBe(64);
    let run = createGoalRun("user-1", "launch plan", 1000);
    for (let i = 0; i < MAX_AUTONOMY_CHECKPOINTS + 10; i += 1) {
      run = recordCheckpoint(run, { tasksTotal: 10, tasksDone: 0 }, 1000 + i);
    }
    expect(run.checkpoints.length).toBe(MAX_AUTONOMY_CHECKPOINTS);
  });
});

describe("autonomy transitions - decide/step/resume/stop", () => {
  it("fresh run decides continue", () => {
    expect(decideNext(createGoalRun("u", "make a plan", 1000))).toBe("continue");
  });

  it("three consecutive failures mark the run failed", () => {
    expect(MAX_AUTONOMY_FAILURES).toBe(3);
    let run = createGoalRun("u", "make a plan", 1000);
    let decision = "continue" as string;
    for (let i = 0; i < MAX_AUTONOMY_FAILURES; i += 1) {
      ({ run, decision } = stepRun(
        run,
        { tasksTotal: 4, tasksDone: 0, failed: true },
        2000 + i,
      ));
    }
    expect(decision).toBe("failed");
    expect(run.status).toBe("failed");
  });

  it("turn budget parks the run as paused", () => {
    expect(MAX_AUTONOMY_TURNS).toBe(32);
    const run = { ...createGoalRun("u", "make a plan", 1000), turnsUsed: MAX_AUTONOMY_TURNS };
    expect(decideNext(run)).toBe("pause");
  });

  it("all tasks done stops and completes the run", () => {
    const run = createGoalRun("u", "make a plan", 1000);
    const { run: next, decision } = stepRun(
      run,
      { tasksTotal: 2, tasksDone: 2, failed: false },
      2000,
    );
    expect(decision).toBe("stop");
    expect(next.status).toBe("completed");
  });

  it("resume reopens paused and failed runs only", () => {
    const paused = { ...createGoalRun("u", "make a plan", 1000), status: "paused" as const };
    expect(resumeRun(paused, 2000)?.status).toBe("active");
    const failed = { ...createGoalRun("u", "m", 1000), status: "failed" as const, failures: 3 };
    expect(resumeRun(failed, 2000)?.failures).toBe(0);
    expect(resumeRun(createGoalRun("u", "m", 1000), 2000)).toBeNull();
  });

  it("stopRun parks by request", () => {
    const run = createGoalRun("u", "make a plan", 1000);
    expect(stopRun(run, 2000).status).toBe("stopped");
    expect(run.status).toBe("active");
  });
});

describe("autonomy entry - flag gating", () => {
  it("defers with autonomy_disabled when the flag is off", async () => {
    const outcome = await runAutonomy(
      { userId: "u", message: "make a plan to launch" },
      autonomyOff(),
    );
    expect(outcome).toEqual({ kind: "deferred", reason: "autonomy_disabled" });
  });

  it("defers invalid and non-autonomy messages", async () => {
    expect(await runAutonomy({ userId: "", message: "make a plan" }, autonomyOn()))
      .toEqual({ kind: "deferred", reason: "invalid_request" });
    expect(await runAutonomy({ userId: "u", message: "tell me a joke" }, autonomyOn()))
      .toEqual({ kind: "deferred", reason: "not_autonomy_request" });
  });

  it("runs and resumes a paused run", async () => {
    const outcome = await runAutonomy(
      { userId: "u", message: "make a plan to launch" },
      autonomyOn(1000),
    );
    expect(outcome.kind).toBe("ran");
    const paused = { ...createGoalRun("u", "make a plan", 1000), status: "paused" as const };
    const resumed = await runAutonomy(
      { userId: "u", message: "keep working on my plan", resume: paused },
      autonomyOn(2000),
    );
    expect(resumed.kind).toBe("ran");
    if (resumed.kind === "ran") expect(resumed.run.id).toBe(paused.id);
  });

  it("flag constant is registered", async () => {
    expect(LONG_HORIZON_FLAG).toBe("ENABLE_LONG_HORIZON");
    const { FEATURE_FLAGS } = await import("@/lib/config/features");
    expect((FEATURE_FLAGS as readonly string[]).includes("ENABLE_LONG_HORIZON")).toBe(true);
  });

  it("touches no provider, tool, repository, or scheduler", () => {
    for (const token of ["getProvider(", "createClient(", "planner.repository", ".insert(", ".update("]) {
      expect(ALL_SOURCES.includes(token)).toBe(false);
    }
    expect(TYPES_SOURCE.includes("process.env")).toBe(false);
  });
});
