/**
 * Unit tests for recordLearning, the continual-learning entry point
 * (Priority 5).
 *
 * No provider, no tools, no database: the entry point only reads a flag, a
 * message, and a content-free trace, and returns signals plus proposals.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CONTINUAL_LEARNING_FLAG,
  isRecordedOutcome,
  journalFromOutcome,
  recordLearning,
} from "@/lib/agent/learning/index";
import { EMPTY_JOURNAL, journalSize } from "@/lib/agent/learning/signals";
import type { LearningRequest } from "@/lib/agent/learning/types";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const FLAG = "ENABLE_CONTINUAL_LEARNING";

function readSource(...segments: string[]): string {
  return readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

function request(
  message: unknown,
  trace?: unknown,
): LearningRequest {
  return { userId: USER_ID, message, trace } as unknown as LearningRequest;
}

function learningOn() {
  return { isFlagEnabled: () => true };
}

function learningOff() {
  return { isFlagEnabled: () => false };
}

/** A failing act step exactly as the agent trace records one. */
const FAILED_TOOL_TRACE = [{ phase: "act", tool: "calculator", ok: false }];

beforeEach(() => {
  delete process.env[FLAG];
});

afterEach(() => {
  delete process.env[FLAG];
});

describe("recordLearning - flag gating", () => {
  it("defers with learning_disabled when off", async () => {
    const outcome = await recordLearning(
      request("no, that's wrong"),
      learningOff(),
    );

    expect(outcome.kind).toBe("deferred");
    expect(outcome["reason"]).toBe("learning_disabled");
  });

  it("checks the flag before classifying anything", async () => {
    let classifyCalls = 0;
    const outcome = await recordLearning(request("no, that's wrong"), {
      isFlagEnabled: () => false,
      classify: () => {
        classifyCalls += 1;
        return ["user_correction"];
      },
    });

    expect(outcome.kind).toBe("deferred");
    expect(classifyCalls).toBe(0);
  });

  it("stays disabled in the real environment where the flag is unset", async () => {
    const outcome = await recordLearning(request("no, that's wrong"));

    expect(outcome.kind).toBe("deferred");
    expect(outcome["reason"]).toBe("learning_disabled");
  });

  it("fails closed when the flag reader throws", async () => {
    const outcome = await recordLearning(request("no, that's wrong"), {
      isFlagEnabled: () => {
        throw new Error("flag down");
      },
    });

    expect(outcome.kind).toBe("deferred");
    expect(outcome["reason"]).toBe("learning_disabled");
  });

  it("reads exactly the continual-learning flag", async () => {
    const seen: string[] = [];
    await recordLearning(request("no, that's wrong"), {
      isFlagEnabled: (flag) => {
        seen.push(flag);
        return true;
      },
      classify: () => [],
    });

    expect(seen).toEqual([CONTINUAL_LEARNING_FLAG]);
  });

  it("is inert unless the flag is explicitly on", async () => {
    process.env[FLAG] = "false";

    expect((await recordLearning(request("no, that's wrong"))).kind).toBe(
      "deferred",
    );

    process.env[FLAG] = "true";

    expect((await recordLearning(request("no, that's wrong"))).kind).toBe(
      "recorded",
    );
  });
});

describe("recordLearning - request validation", () => {
  it("defers invalid for a missing, non-string, or oversized message", async () => {
    const missing = await recordLearning({ userId: USER_ID } as LearningRequest, learningOn());
    expect(missing["reason"]).toBe("invalid_request");

    const numeric = await recordLearning(request(42), learningOn());
    expect(numeric["reason"]).toBe("invalid_request");

    const long = "that's wrong " + "x".repeat(2000);
    const oversized = await recordLearning(request(long), learningOn());
    expect(oversized["reason"]).toBe("invalid_request");
  });

  it("defers invalid for a malformed trace", async () => {
    const outcome = await recordLearning(
      request("no, that's wrong", { phase: "act" }),
      learningOn(),
    );

    expect(outcome["reason"]).toBe("invalid_request");
  });

  it("defers no_learning_signal for a blank message with no trace", async () => {
    const outcome = await recordLearning(request("   "), learningOn());

    expect(outcome.kind).toBe("deferred");
    expect(outcome["reason"]).toBe("no_learning_signal");
  });

  it("defers no_learning_signal for ordinary chat", async () => {
    const outcome = await recordLearning(request("how are you today"), learningOn());

    expect(outcome["reason"]).toBe("no_learning_signal");
  });

  it("defers no_learning_signal when the classifier throws", async () => {
    const outcome = await recordLearning(request("no, that's wrong"), {
      isFlagEnabled: () => true,
      classify: () => {
        throw new Error("gate down");
      },
    });

    expect(outcome["reason"]).toBe("no_learning_signal");
  });

  it("defers no_learning_signal when the classifier returns junk", async () => {
    const outcome = await recordLearning(request("no, that's wrong"), {
      isFlagEnabled: () => true,
      classify: () => ["not_a_kind"] as never,
    });

    expect(outcome["reason"]).toBe("no_learning_signal");
  });

  it("treats a missing trace as no trace", async () => {
    const outcome = await recordLearning(request("exactly"), learningOn());

    expect(outcome.kind).toBe("recorded");
  });
});

describe("recordLearning - recorded outcomes", () => {
  it("records a correction as a confidence proposal", async () => {
    const outcome = await recordLearning(request("no, that's wrong"), learningOn());

    expect(outcome.kind).toBe("recorded");
    if (outcome.kind !== "recorded") return;

    expect(outcome.signals).toHaveLength(1);
    expect(outcome.signals[0]?.kind).toBe("user_correction");
    expect(outcome.signals[0]?.source).toBe("user");
    expect(outcome.updates).toHaveLength(1);
    expect(outcome.updates[0]).toMatchObject({
      target: "memory_confidence",
      requiresWrite: true,
    });
  });

  it("records a failed tool turn with its tool name", async () => {
    const outcome = await recordLearning(
      request("", FAILED_TOOL_TRACE),
      learningOn(),
    );

    expect(outcome.kind).toBe("recorded");
    if (outcome.kind !== "recorded") return;

    expect(outcome.signals[0]).toMatchObject({
      kind: "tool_failure",
      source: "tool",
      tool: "calculator",
    });
    expect(outcome.updates[0]?.target).toBe("procedural_candidate");
  });

  it("records both the user signal and the tool signal", async () => {
    const outcome = await recordLearning(
      request("that's not helpful", FAILED_TOOL_TRACE),
      learningOn(),
    );

    expect(outcome.kind).toBe("recorded");
    if (outcome.kind !== "recorded") return;

    expect(outcome.signals.map((signal) => signal.kind)).toEqual([
      "explicit_negative_feedback",
      "tool_failure",
    ]);
    expect(outcome.updates.map((update) => update.reason)).toEqual([
      "explicit_negative_feedback",
      "tool_failure",
    ]);
  });

  it("is deterministic for identical input", async () => {
    const first = await recordLearning(request("no, that's wrong"), learningOn());
    const second = await recordLearning(request("no, that's wrong"), learningOn());

    expect(first).toEqual(second);
  });

  it("never throws for hostile requests or deps", async () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("x");
        },
      },
    );

    for (const input of [null, undefined, hostile, 42, [], "no, that's wrong"]) {
      const outcome = await recordLearning(
        input as unknown as LearningRequest,
        learningOn(),
      );

      expect(isRecordedOutcome(outcome)).toBe(true);
    }

    const badDeps = new Proxy(
      {},
      {
        get() {
          throw new Error("y");
        },
      },
    );

    const outcome = await recordLearning(
      request("no, that's wrong"),
      badDeps as never,
    );

    expect(outcome.kind).toBe("deferred");
  });

  it("always returns a valid outcome", async () => {
    const outcomes = await Promise.all([
      recordLearning(request("no, that's wrong"), learningOn()),
      recordLearning(request("how are you"), learningOn()),
      recordLearning(request("no, that's wrong"), learningOff()),
      recordLearning({} as LearningRequest, learningOn()),
    ]);

    for (const outcome of outcomes) {
      expect(isRecordedOutcome(outcome)).toBe(true);
    }
  });
});

describe("journalFromOutcome", () => {
  it("accumulates recorded signals across turns", async () => {
    const first = await recordLearning(request("no, that's wrong"), learningOn());
    const second = await recordLearning(
      request("perfect, thanks", FAILED_TOOL_TRACE),
      learningOn(),
    );

    const journal = journalFromOutcome(
      second,
      journalFromOutcome(first, EMPTY_JOURNAL),
    );

    expect(journal.signals.map((signal) => signal.index)).toEqual([1, 2, 3]);
    expect(journal.signals.map((signal) => signal.kind)).toEqual([
      "user_correction",
      "explicit_positive_feedback",
      "tool_failure",
    ]);
  });

  it("leaves the journal untouched for a deferred outcome", async () => {
    const first = await recordLearning(request("exactly"), learningOn());
    const base = journalFromOutcome(first, EMPTY_JOURNAL);
    const deferred = await recordLearning(request("how are you"), learningOn());

    expect(journalFromOutcome(deferred, base)).toEqual(base);
    expect(journalFromOutcome(null, base)).toEqual(base);
    expect(journalFromOutcome({ kind: "recorded" }, base)).toEqual(base);
  });

  it("starts empty for a malformed journal and never throws", async () => {
    for (const bad of [null, undefined, 42, "journal", { signals: "no" }]) {
      expect(journalFromOutcome(EMPTY_JOURNAL, bad)).toEqual({ signals: [] });
    }

    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("x");
        },
      },
    );

    expect(() => journalFromOutcome(hostile, hostile)).not.toThrow();
    expect(journalSize(journalFromOutcome(hostile, hostile))).toBe(0);
  });
});

describe("continual learning - production isolation", () => {
  const PRODUCTION_FILES = [
    ["app", "api", "chat", "route.ts"],
    ["lib", "agent", "loop.ts"],
    ["lib", "agent", "runner.ts"],
    ["lib", "core", "pipeline.ts"],
  ] as const;

  it("is imported by no production file", () => {
    for (const segments of PRODUCTION_FILES) {
      const source = readSource(...segments);

      expect(source).not.toMatch(/agent\/learning/);
      expect(source).not.toMatch(/ENABLE_CONTINUAL_LEARNING/);
      expect(source).not.toMatch(CONTINUAL_LEARNING_FLAG);
    }
  });

  it("keeps the live chat path untouched", () => {
    const route = readSource("app", "api", "chat", "route.ts");

    // The route still answers through the existing pipeline and provider.
    expect(route).toMatch(/preStreamPipeline/);
    expect(route).toMatch(/getProvider/);
    expect(route).not.toMatch(/recordLearning|evaluateJournal|recordSignals/);
  });

  it("keeps the agent loop and runner untouched by learning", () => {
    for (const segments of [
      ["lib", "agent", "loop.ts"],
      ["lib", "agent", "runner.ts"],
    ] as const) {
      const source = readSource(...segments);

      expect(source).not.toMatch(/learning/i);
    }
  });
});
