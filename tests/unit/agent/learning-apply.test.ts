/**
 * Unit tests for the continual-learning applicator (Priority 5, step 2).
 *
 * Mocked writers only: every write goes through an injected vi.fn() writer.
 * No Supabase client, no repository import, no provider, no tool call —
 * apply.ts statically imports none of them.
 *
 * Proves the safety contract: flag OFF (default) is a no-op, writes also
 * require allowWrites:true, only memory_usage is supported, unsupported
 * targets skip, hostile input never throws, and the chat route / agent loop /
 * pipeline never reference this module.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_APPLY_MEMORY_IDS,
  applyLearningOutcome,
  applyLearningUpdates,
} from "@/lib/agent/learning/apply";
import { CONTINUAL_LEARNING_FLAG, recordLearning } from "@/lib/agent/learning/index";
import { LEARNING_WRITES_ENABLED, createSignal } from "@/lib/agent/learning/signals";
import type {
  LearningJournal,
  LearningRequest,
  LearningSignal,
  LearningSignalKind,
  LearningUpdate,
} from "@/lib/agent/learning/types";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const FLAG = "ENABLE_CONTINUAL_LEARNING";
const MEM_ID = "22222222-2222-4222-8222-222222222222";

function readSource(...segments: string[]): string {
  return readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

/** A well-formed proposal; override fields per test. */
function update(over: Partial<LearningUpdate> = {}): LearningUpdate {
  return {
    target: "memory_usage",
    reason: "tool_success",
    count: 1,
    delta: 1,
    note: "rule:tool_success",
    requiresWrite: true,
    ...over,
  };
}

/** A journal carrying exactly the given kinds, in order. */
function journalOf(kinds: LearningSignalKind[]): LearningJournal {
  const signals = kinds
    .map((kind, index) => createSignal(kind, index + 1))
    .filter((signal): signal is LearningSignal => signal !== null);
  return { signals };
}

/** An injected touchUsage writer plus its spy. */
function writer() {
  return vi.fn(async () => undefined);
}

const FLAG_ON = { isFlagEnabled: () => true };
const WRITES_ON = { isFlagEnabled: () => true, allowWrites: true } as const;

const SUCCESS_TRACE = [{ phase: "act", tool: "calculator", ok: true }];

function request(message: unknown, trace?: unknown): LearningRequest {
  return { userId: USER_ID, message, trace } as unknown as LearningRequest;
}

beforeEach(() => {
  delete process.env[FLAG];
});

afterEach(() => {
  delete process.env[FLAG];
});

describe("applyLearningUpdates - flag and write gating", () => {
  it("defaults to OFF in the real environment (flag unset): no-op", async () => {
    const touch = writer();
    const result = await applyLearningUpdates(
      { userId: USER_ID, memoryIds: [MEM_ID], updates: [update()] },
      { writers: { touchUsage: touch } },
    );

    expect(result).toEqual({ kind: "deferred", reason: "learning_disabled" });
    expect(touch).not.toHaveBeenCalled();
  });

  it("defers learning_disabled when the injected flag reader is off", async () => {
    const touch = writer();
    const result = await applyLearningUpdates(
      { userId: USER_ID, memoryIds: [MEM_ID], updates: [update()] },
      { isFlagEnabled: () => false, allowWrites: true, writers: { touchUsage: touch } },
    );

    expect(result).toEqual({ kind: "deferred", reason: "learning_disabled" });
    expect(touch).not.toHaveBeenCalled();
  });

  it("fails closed when the flag reader throws", async () => {
    const result = await applyLearningUpdates(
      { userId: USER_ID, memoryIds: [MEM_ID], updates: [update()] },
      {
        isFlagEnabled: () => {
          throw new Error("flag down");
        },
        allowWrites: true,
      },
    );

    expect(result).toEqual({ kind: "deferred", reason: "learning_disabled" });
  });

  it("reads exactly the continual-learning flag", async () => {
    const seen: string[] = [];
    await applyLearningUpdates(
      { userId: USER_ID, memoryIds: [MEM_ID], updates: [update()] },
      {
        isFlagEnabled: (flag) => {
          seen.push(flag);
          return true;
        },
        allowWrites: true,
      },
    );

    expect(seen).toEqual([CONTINUAL_LEARNING_FLAG]);
  });

  it("requires the allowWrites double opt-in: flag on alone is a no-op", async () => {
    const touch = writer();
    const result = await applyLearningUpdates(
      { userId: USER_ID, memoryIds: [MEM_ID], updates: [update()] },
      { ...FLAG_ON, writers: { touchUsage: touch } },
    );

    expect(result).toEqual({ kind: "deferred", reason: "writes_disabled" });
    expect(touch).not.toHaveBeenCalled();
  });

  it("rejects allowWrites values that are not exactly true", async () => {
    for (const allowWrites of ["true", 1, {}] as unknown[]) {
      const result = await applyLearningUpdates(
        { userId: USER_ID, memoryIds: [MEM_ID], updates: [update()] },
        { ...FLAG_ON, allowWrites, writers: { touchUsage: writer() } },
      );
      expect(result).toEqual({ kind: "deferred", reason: "writes_disabled" });
    }
  });

  it("proceeds only with flag on AND allowWrites true", async () => {
    const touch = writer();
    const result = await applyLearningUpdates(
      { userId: USER_ID, memoryIds: [MEM_ID], updates: [update()] },
      { ...WRITES_ON, writers: { touchUsage: touch } },
    );

    expect(result.kind).toBe("applied");
    expect(touch).toHaveBeenCalledTimes(1);
  });

  it("reads the real env flag when no reader is injected (still needs opt-in)", async () => {
    process.env[FLAG] = "1";
    const touch = writer();

    const noOptIn = await applyLearningUpdates(
      { userId: USER_ID, memoryIds: [MEM_ID], updates: [update()] },
      { writers: { touchUsage: touch } },
    );
    expect(noOptIn).toEqual({ kind: "deferred", reason: "writes_disabled" });
    expect(touch).not.toHaveBeenCalled();

    const optedIn = await applyLearningUpdates(
      { userId: USER_ID, memoryIds: [MEM_ID], updates: [update()] },
      { allowWrites: true, writers: { touchUsage: touch } },
    );
    expect(optedIn.kind).toBe("applied");
    expect(touch).toHaveBeenCalledTimes(1);
  });
});

describe("applyLearningUpdates - supported target: memory_usage", () => {
  it("applies through the injected writer with userId and ids", async () => {
    const touch = writer();
    const result = await applyLearningUpdates(
      { userId: USER_ID, memoryIds: [MEM_ID], updates: [update({ count: 2, delta: 1 })] },
      { ...WRITES_ON, writers: { touchUsage: touch } },
    );

    expect(touch).toHaveBeenCalledTimes(1);
    expect(touch).toHaveBeenCalledWith(USER_ID, [MEM_ID]);
    expect(result).toEqual({
      kind: "applied",
      applied: [{ target: "memory_usage", memoryIds: [MEM_ID], count: 2, delta: 1 }],
      skipped: [],
    });
  });

  it("trims, dedupes and drops unusable ids (order preserved)", async () => {
    const touch = writer();
    await applyLearningUpdates(
      {
        userId: USER_ID,
        memoryIds: [" a ", "a", "", null, 42, " b ", "b"],
        updates: [update()],
      },
      { ...WRITES_ON, writers: { touchUsage: touch } },
    );

    expect(touch).toHaveBeenCalledWith(USER_ID, ["a", "b"]);
  });

  it(`caps ids at MAX_APPLY_MEMORY_IDS (${MAX_APPLY_MEMORY_IDS})`, async () => {
    const touch = writer();
    const many = Array.from({ length: MAX_APPLY_MEMORY_IDS + 5 }, (_, i) => `m${i}`);
    await applyLearningUpdates(
      { userId: USER_ID, memoryIds: many, updates: [update()] },
      { ...WRITES_ON, writers: { touchUsage: touch } },
    );

    const ids = touch.mock.calls[0]?.[1] ?? [];
    expect(ids).toHaveLength(MAX_APPLY_MEMORY_IDS);
  });

  it("skips as no_memory_ids when the update has nothing to touch", async () => {
    const touch = writer();
    const result = await applyLearningUpdates(
      { userId: USER_ID, updates: [update()] },
      { ...WRITES_ON, writers: { touchUsage: touch } },
    );

    expect(result).toEqual({
      kind: "applied",
      applied: [],
      skipped: [{ target: "memory_usage", reason: "no_memory_ids", note: "rule:tool_success" }],
    });
    expect(touch).not.toHaveBeenCalled();
  });

  it("skips as writer_unavailable when no writer is injected (the default)", async () => {
    const result = await applyLearningUpdates(
      { userId: USER_ID, memoryIds: [MEM_ID], updates: [update()] },
      WRITES_ON,
    );

    expect(result).toEqual({
      kind: "applied",
      applied: [],
      skipped: [{ target: "memory_usage", reason: "writer_unavailable", note: "rule:tool_success" }],
    });
  });

  it("folds a synchronous writer throw into write_failed and never throws", async () => {
    const result = await applyLearningUpdates(
      { userId: USER_ID, memoryIds: [MEM_ID], updates: [update()] },
      {
        ...WRITES_ON,
        writers: {
          touchUsage: () => {
            throw new Error("db down");
          },
        },
      },
    );

    expect(result).toEqual({
      kind: "applied",
      applied: [],
      skipped: [{ target: "memory_usage", reason: "write_failed", note: "rule:tool_success" }],
    });
  });

  it("folds an async writer rejection into write_failed and never throws", async () => {
    const result = await applyLearningUpdates(
      { userId: USER_ID, memoryIds: [MEM_ID], updates: [update()] },
      {
        ...WRITES_ON,
        writers: { touchUsage: () => Promise.reject(new Error("rpc failed")) },
      },
    );

    expect(result.kind).toBe("applied");
    if (result.kind === "applied") {
      expect(result.applied).toEqual([]);
      expect(result.skipped[0]?.reason).toBe("write_failed");
    }
  });

  it("keeps processing later updates after one writer failure", async () => {
    const touch = writer();
    touch.mockRejectedValueOnce(new Error("boom"));
    const result = await applyLearningUpdates(
      {
        userId: USER_ID,
        memoryIds: [MEM_ID],
        updates: [update(), update({ target: "memory_confidence", reason: "user_correction" })],
      },
      { ...WRITES_ON, writers: { touchUsage: touch } },
    );

    expect(result.kind).toBe("applied");
    if (result.kind === "applied") {
      expect(result.skipped.map((entry) => entry.reason)).toEqual([
        "write_failed",
        "unsupported_target",
      ]);
    }
  });
});

describe("applyLearningUpdates - deferred targets", () => {
  it("skips memory_confidence as unsupported_target (no safe delta writer exists)", async () => {
    const touch = writer();
    const result = await applyLearningUpdates(
      {
        userId: USER_ID,
        memoryIds: [MEM_ID],
        updates: [update({ target: "memory_confidence", reason: "user_correction", note: "rule:user_correction" })],
      },
      { ...WRITES_ON, writers: { touchUsage: touch } },
    );

    expect(result).toEqual({
      kind: "applied",
      applied: [],
      skipped: [{ target: "memory_confidence", reason: "unsupported_target", note: "rule:user_correction" }],
    });
    expect(touch).not.toHaveBeenCalled();
  });

  it("skips procedural_candidate as unsupported_target (needs Priority 3 extraction)", async () => {
    const touch = writer();
    const result = await applyLearningUpdates(
      {
        userId: USER_ID,
        memoryIds: [MEM_ID],
        updates: [update({ target: "procedural_candidate", reason: "tool_failure", delta: 0, note: "rule:tool_failure" })],
      },
      { ...WRITES_ON, writers: { touchUsage: touch } },
    );

    expect(result).toEqual({
      kind: "applied",
      applied: [],
      skipped: [{ target: "procedural_candidate", reason: "unsupported_target", note: "rule:tool_failure" }],
    });
    expect(touch).not.toHaveBeenCalled();
  });
});

describe("applyLearningUpdates - input resolution and precedence", () => {
  it("prefers updates over journal (journal's usage update is ignored)", async () => {
    const touch = writer();
    const result = await applyLearningUpdates(
      {
        userId: USER_ID,
        memoryIds: [MEM_ID],
        updates: [update({ target: "memory_confidence", reason: "user_correction", note: "rule:user_correction" })],
        journal: journalOf(["tool_success"]),
      },
      { ...WRITES_ON, writers: { touchUsage: touch } },
    );

    expect(touch).not.toHaveBeenCalled();
    expect(result).toEqual({
      kind: "applied",
      applied: [],
      skipped: [{ target: "memory_confidence", reason: "unsupported_target", note: "rule:user_correction" }],
    });
  });

  it("prefers updates over outcome: an empty updates array means no_updates", async () => {
    const touch = writer();
    const outcome = await recordLearning(request("perfect, thanks", SUCCESS_TRACE), FLAG_ON);
    const result = await applyLearningUpdates(
      { userId: USER_ID, memoryIds: [MEM_ID], updates: [], outcome },
      { ...WRITES_ON, writers: { touchUsage: touch } },
    );

    expect(result).toEqual({ kind: "deferred", reason: "no_updates" });
    expect(touch).not.toHaveBeenCalled();
  });

  it("prefers outcome over journal", async () => {
    const touch = writer();
    const outcome = await recordLearning(request("no, that's wrong"), FLAG_ON);
    const result = await applyLearningUpdates(
      { userId: USER_ID, memoryIds: [MEM_ID], outcome, journal: journalOf(["tool_success"]) },
      { ...WRITES_ON, writers: { touchUsage: touch } },
    );

    expect(touch).not.toHaveBeenCalled();
    if (result.kind === "applied") {
      expect(result.applied).toEqual([]);
      expect(result.skipped).toEqual([
        { target: "memory_confidence", reason: "unsupported_target", note: "rule:user_correction" },
      ]);
    }
  });

  it("evaluates a journal into proposals when nothing else is given", async () => {
    const touch = writer();
    const result = await applyLearningUpdates(
      { userId: USER_ID, memoryIds: [MEM_ID], journal: journalOf(["tool_success"]) },
      { ...WRITES_ON, writers: { touchUsage: touch } },
    );

    expect(touch).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe("applied");
  });

  it("defers no_updates for empty or malformed proposals", async () => {
    for (const input of [
      { userId: USER_ID },
      { userId: USER_ID, updates: [] },
      { userId: USER_ID, updates: "nope" },
      { userId: USER_ID, journal: { signals: "x" } },
      { userId: USER_ID, outcome: { kind: "deferred", reason: "no_learning_signal" } },
      { userId: USER_ID, outcome: null },
    ] as Array<Parameters<typeof applyLearningUpdates>[0]>) {
      const result = await applyLearningUpdates(input, WRITES_ON);
      expect(result).toEqual({ kind: "deferred", reason: "no_updates" });
    }
  });

  it("filters malformed update entries instead of trusting the array", async () => {
    const touch = writer();
    const result = await applyLearningUpdates(
      {
        userId: USER_ID,
        memoryIds: [MEM_ID],
        updates: [null, 42, { target: "nope" }, update()],
      } as unknown as Parameters<typeof applyLearningUpdates>[0],
      { ...WRITES_ON, writers: { touchUsage: touch } },
    );

    expect(touch).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe("applied");
  });
});

describe("applyLearningUpdates - invalid input never throws", () => {
  it("defers invalid_request for a missing or non-string userId", async () => {
    for (const userId of [undefined, null, 42, "", "   "]) {
      const result = await applyLearningUpdates(
        { userId, memoryIds: [MEM_ID], updates: [update()] } as unknown as Parameters<
          typeof applyLearningUpdates
        >[0],
        WRITES_ON,
      );
      expect(result).toEqual({ kind: "deferred", reason: "invalid_request" });
    }
  });

  it("never throws for hostile input or hostile deps", async () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("boom");
        },
      },
    );

    for (const args of [
      [hostile, WRITES_ON],
      [{ userId: USER_ID, updates: [update()] }, hostile],
      [{ userId: USER_ID, updates: [update()] }, null],
    ] as Array<Parameters<typeof applyLearningUpdates>>) {
      const result = await applyLearningUpdates(...args);
      expect(["deferred", "applied"]).toContain(result.kind);
    }
  });
});

describe("applyLearningOutcome", () => {
  it("applies a recorded tool_success outcome through the writer", async () => {
    const touch = writer();
    const outcome = await recordLearning(request("how are you", SUCCESS_TRACE), FLAG_ON);
    expect(outcome.kind).toBe("recorded");

    const result = await applyLearningOutcome(
      outcome,
      { userId: USER_ID, memoryIds: [MEM_ID] },
      { ...WRITES_ON, writers: { touchUsage: touch } },
    );

    expect(touch).toHaveBeenCalledTimes(1);
    expect(touch).toHaveBeenCalledWith(USER_ID, [MEM_ID]);
    expect(result.kind).toBe("applied");
    if (result.kind === "applied") {
      expect(result.applied).toEqual([
        { target: "memory_usage", memoryIds: [MEM_ID], count: 1, delta: 1 },
      ]);
    }
  });

  it("skips a usage proposal when no memory ids are supplied", async () => {
    const touch = writer();
    const outcome = await recordLearning(request("how are you", SUCCESS_TRACE), FLAG_ON);

    const result = await applyLearningOutcome(outcome, { userId: USER_ID }, {
      ...WRITES_ON,
      writers: { touchUsage: touch },
    });

    expect(result).toEqual({
      kind: "applied",
      applied: [],
      skipped: [{ target: "memory_usage", reason: "no_memory_ids", note: "rule:tool_success" }],
    });
    expect(touch).not.toHaveBeenCalled();
  });

  it("never writes confidence for a correction turn (target unsupported)", async () => {
    const touch = writer();
    const outcome = await recordLearning(request("no, that's wrong"), FLAG_ON);

    const result = await applyLearningOutcome(
      outcome,
      { userId: USER_ID, memoryIds: [MEM_ID] },
      { ...WRITES_ON, writers: { touchUsage: touch } },
    );

    expect(touch).not.toHaveBeenCalled();
    expect(result).toEqual({
      kind: "applied",
      applied: [],
      skipped: [{ target: "memory_confidence", reason: "unsupported_target", note: "rule:user_correction" }],
    });
  });

  it("defers no_updates for a deferred, non-object, or malformed outcome", async () => {
    for (const outcome of [
      { kind: "deferred", reason: "no_learning_signal" },
      null,
      undefined,
      42,
      { kind: "recorded", updates: "nope" },
    ]) {
      const result = await applyLearningOutcome(
        outcome,
        { userId: USER_ID, memoryIds: [MEM_ID] },
        WRITES_ON,
      );
      expect(result).toEqual({ kind: "deferred", reason: "no_updates" });
    }
  });

  it("defers invalid_request for an unusable userId, even before proposals", async () => {
    const outcome = await recordLearning(request("how are you", SUCCESS_TRACE), FLAG_ON);
    const result = await applyLearningOutcome(
      outcome,
      { userId: 42 },
      WRITES_ON,
    );
    expect(result).toEqual({ kind: "deferred", reason: "invalid_request" });
  });

  it("keeps the default a no-op: flag off or writes not allowed", async () => {
    const touch = writer();
    const outcome = await recordLearning(request("how are you", SUCCESS_TRACE), FLAG_ON);

    const disabled = await applyLearningOutcome(
      outcome,
      { userId: USER_ID, memoryIds: [MEM_ID] },
      { isFlagEnabled: () => false, allowWrites: true, writers: { touchUsage: touch } },
    );
    expect(disabled).toEqual({ kind: "deferred", reason: "learning_disabled" });

    const noOptIn = await applyLearningOutcome(
      outcome,
      { userId: USER_ID, memoryIds: [MEM_ID] },
      { ...FLAG_ON, writers: { touchUsage: touch } },
    );
    expect(noOptIn).toEqual({ kind: "deferred", reason: "writes_disabled" });

    const realEnv = await applyLearningOutcome(
      outcome,
      { userId: USER_ID, memoryIds: [MEM_ID] },
      { writers: { touchUsage: touch } },
    );
    expect(realEnv).toEqual({ kind: "deferred", reason: "learning_disabled" });

    expect(touch).not.toHaveBeenCalled();
  });
});

describe("continual learning applicator - production isolation", () => {
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
      expect(source).not.toMatch(/applyLearning/);
      expect(source).not.toMatch(CONTINUAL_LEARNING_FLAG);
    }
  });

  it("keeps the live chat path untouched", () => {
    const route = readSource("app", "api", "chat", "route.ts");

    expect(route).toMatch(/preStreamPipeline/);
    expect(route).toMatch(/getProvider/);
    expect(route).not.toMatch(/applyLearning|recordLearning|evaluateJournal/);
  });

  it("statically imports no repository, supabase client, or memory writer", () => {
    const source = readSource("lib", "agent", "learning", "apply.ts");

    expect(source).not.toMatch(/from\s+["']@\/lib\/repositories\/memory\.repository["']/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/supabase/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/memory\/memory["']/);
    expect(source).not.toMatch(/import\s*\{[^}]*\btouchMemories\b/);
    expect(source).not.toMatch(/\.rpc\s*\(/);
  });

  it("keeps LEARNING_WRITES_ENABLED false (proposals are still proposals)", () => {
    expect(LEARNING_WRITES_ENABLED).toBe(false);
  });
});




