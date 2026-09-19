/// <reference types="vitest" />

import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Phase 1-B — bounded supplementary cross-type window + grounding gate.
 *
 * Exercises the real runMemoryMaintenance → runReflection path:
 *   - per-type groups remain byte-identical to the pre-1-B contract
 *   - ONE deterministic cross-type window is appended LAST (only when valid)
 *   - window excludes reflections (Phase 1-A guard), below-threshold and
 *     archived rows; importance DESC → confidence DESC → created_at ASC →
 *     id ASC; hard member cap; hard serialized-size budget; >= 2 members
 *     and >= 2 distinct types floor
 *   - grounding gate rejects reflections before saveMemory (R1/R2/R3)
 *
 * All external boundaries mocked. No DB, no network, no production write.
 */

vi.mock("@/lib/repositories/memory.repository", () => ({
  getAllMemories: vi.fn(),
  purgeArchived: vi.fn(),
  corroborateMemory: vi.fn(),
}));

vi.mock("@/lib/memory/aiExtractor", () => ({
  aiExtractMemories: vi.fn(),
}));

vi.mock("@/lib/memory/memory", () => ({
  saveMemory: vi.fn(),
}));

vi.mock("@/lib/memory/reflector", () => ({
  generateReflections: vi.fn(),
}));

vi.mock("@/lib/memory/identity", () => ({
  resolveMemoryIdentity: vi.fn(),
}));

vi.mock("@/lib/memory/lifecycle", () => ({
  evaluateLifecycle: vi.fn(),
}));

import { getAllMemories, purgeArchived } from "@/lib/repositories/memory.repository";
import { aiExtractMemories } from "@/lib/memory/aiExtractor";
import { saveMemory } from "@/lib/memory/memory";
import { generateReflections } from "@/lib/memory/reflector";
import { resolveMemoryIdentity } from "@/lib/memory/identity";
import { evaluateLifecycle } from "@/lib/memory/lifecycle";
import { runMemoryMaintenance } from "@/lib/core/pipeline";

const mockGetAllMemories = getAllMemories as ReturnType<typeof vi.fn>;
const mockPurgeArchived = purgeArchived as ReturnType<typeof vi.fn>;
const mockAiExtractMemories = aiExtractMemories as ReturnType<typeof vi.fn>;
const mockSaveMemory = saveMemory as ReturnType<typeof vi.fn>;
const mockGenerateReflections = generateReflections as ReturnType<typeof vi.fn>;
const mockResolveMemoryIdentity = resolveMemoryIdentity as ReturnType<typeof vi.fn>;
const mockEvaluateLifecycle = evaluateLifecycle as ReturnType<typeof vi.fn>;

const MESSAGE = "This is a test message with enough length to pass the gate";

type SaveCall = Record<string, unknown>;
type InputGroup = {
  memoryType: string;
  memories: Array<Record<string, unknown>>;
};

function dbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "row",
    user_id: "user-1",
    project_id: null,
    memory_type: "semantic",
    status: "active",
    title: "Title",
    content: "Content",
    summary: "Summary",
    tags: [],
    importance_v2: 0.8,
    confidence_v2: 0.9,
    embedding: null,
    source_v2: "extractor",
    source_ref: null,
    metadata: {},
    times_used: 1,
    last_used: null,
    last_scored: "2026-01-01T00:00:00.000Z",
    effective_score: 0.7,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function reflectionSaveCalls(): SaveCall[] {
  return mockSaveMemory.mock.calls
    .map((call) => call[0] as SaveCall)
    .filter((arg) => arg.memoryType === "reflection");
}

function lastInput(): InputGroup[] {
  return mockGenerateReflections.mock.calls[
    mockGenerateReflections.mock.calls.length - 1
  ][0] as InputGroup[];
}

function windowGroup(input: InputGroup[]): InputGroup | undefined {
  return input.find((g) => g.memoryType === "cross-type");
}

function setDefaultStubs() {
  mockAiExtractMemories.mockResolvedValue([
    {
      title: "Extracted Memory",
      content: "Some content worth remembering",
      memoryType: "semantic",
    },
  ]);
  mockResolveMemoryIdentity.mockResolvedValue({ decision: "new" });
  mockEvaluateLifecycle.mockResolvedValue({
    transitions: [],
    evaluated: 0,
    errors: [],
  });
  mockPurgeArchived.mockResolvedValue({ count: 0 });
  mockGenerateReflections.mockResolvedValue([]);
}

describe("Phase 1-B: cross-type window", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllMemories.mockReset();
    setDefaultStubs();
  });

  it("forms across types and is appended LAST after unchanged type groups", async () => {
    mockGetAllMemories.mockResolvedValue({
      data: [
        dbRow({ id: "sem-1", memory_type: "semantic", importance_v2: 0.9 }),
        dbRow({ id: "proj-1", memory_type: "project", importance_v2: 0.8 }),
      ],
      error: null,
    });

    await runMemoryMaintenance("user-1", MESSAGE, "msg-1");

    const input = lastInput();
    expect(input).toHaveLength(3);
    expect(input[0].memoryType).toBe("semantic");
    expect(input[1].memoryType).toBe("project");
    const win = windowGroup(input)!;
    expect(win.memoryType).toBe("cross-type");
    expect(win.memories.map((m) => m.id)).toEqual(["sem-1", "proj-1"]);
  });

  it("orders by importance DESC then confidence DESC", async () => {
    mockGetAllMemories.mockResolvedValue({
      data: [
        dbRow({ id: "a", memory_type: "semantic", importance_v2: 0.8, confidence_v2: 0.9 }),
        dbRow({ id: "b", memory_type: "project", importance_v2: 0.9, confidence_v2: 0.75 }),
        dbRow({ id: "c", memory_type: "semantic", importance_v2: 0.8, confidence_v2: 0.8 }),
        dbRow({ id: "d", memory_type: "episodic", importance_v2: 0.7, confidence_v2: 0.9 }),
      ],
      error: null,
    });

    await runMemoryMaintenance("user-1", MESSAGE, "msg-1");

    const win = windowGroup(lastInput())!;
    expect(win.memories.map((m) => m.id)).toEqual(["b", "a", "c", "d"]);
  });

  it("tie-breaks by created_at ASC then id ASC", async () => {
    mockGetAllMemories.mockResolvedValue({
      data: [
        dbRow({ id: "x1", memory_type: "semantic", created_at: "2026-01-02T00:00:00.000Z" }),
        dbRow({ id: "x2", memory_type: "semantic", created_at: "2026-01-01T00:00:00.000Z" }),
        dbRow({ id: "y1", memory_type: "project", created_at: "2026-01-03T00:00:00.000Z" }),
      ],
      error: null,
    });

    await runMemoryMaintenance("user-1", MESSAGE, "msg-1");

    const win = windowGroup(lastInput())!;
    expect(win.memories.map((m) => m.id)).toEqual(["x2", "x1", "y1"]);
  });

  it("excludes reflection memories from the window and from type groups", async () => {
    mockGetAllMemories.mockResolvedValue({
      data: [
        dbRow({ id: "sem-1", memory_type: "semantic" }),
        dbRow({ id: "ident-1", memory_type: "identity" }),
        dbRow({
          id: "refl-1",
          memory_type: "reflection",
          source_v2: "reflection",
          importance_v2: 0.99,
          confidence_v2: 0.99,
        }),
      ],
      error: null,
    });

    await runMemoryMaintenance("user-1", MESSAGE, "msg-1");

    const input = lastInput();
    const win = windowGroup(input)!;
    // Deterministic order: all scores/created_at tie here → id ASC applies
    // ("ident-1" < "sem-1"), independent of row order.
    expect(win.memories.map((m) => m.id)).toEqual(["ident-1", "sem-1"]);
    const allIds = input.flatMap((g) => g.memories.map((m) => m.id));
    expect(allIds).not.toContain("refl-1");
    expect(input.some((g) => g.memoryType === "reflection")).toBe(false);
  });

  it("caps the window at 12 members in deterministic order", async () => {
    const importance = [0.99, 0.98, 0.97, 0.96, 0.95, 0.94, 0.93, 0.92, 0.91, 0.9, 0.89, 0.88, 0.87, 0.86];
    const ids = ["s-01","p-01","s-02","p-02","s-03","p-03","s-04","p-04","s-05","p-05","s-06","p-06","s-07","p-07"];
    const rows = ids.map((id, i) =>
      dbRow({
        id,
        memory_type: id.startsWith("s") ? "semantic" : "project",
        importance_v2: importance[i],
      })
    );
    mockGetAllMemories.mockResolvedValue({ data: rows, error: null });

    await runMemoryMaintenance("user-1", MESSAGE, "msg-1");

    const win = windowGroup(lastInput())!;
    expect(win.memories.map((m) => m.id)).toEqual(ids.slice(0, 12));
  });

  it("blocks the window when the leading member alone exceeds the size budget", async () => {
    mockGetAllMemories.mockResolvedValue({
      data: [
        dbRow({ id: "big", memory_type: "semantic", importance_v2: 0.95, content: "x".repeat(9000) }),
        dbRow({ id: "s1", memory_type: "project", importance_v2: 0.8, content: "small one" }),
        dbRow({ id: "s2", memory_type: "episodic", importance_v2: 0.7, content: "small two" }),
      ],
      error: null,
    });

    await runMemoryMaintenance("user-1", MESSAGE, "msg-1");

    const input = lastInput();
    expect(windowGroup(input)).toBeUndefined();
    expect(input).toHaveLength(3);
  });

  it("drops trailing members until the serialized window fits the budget", async () => {
    const rows = [0.9, 0.85, 0.8, 0.75, 0.7].map((imp, i) =>
      dbRow({
        id: `m${i + 1}`,
        memory_type: i % 2 === 0 ? "semantic" : "project",
        importance_v2: imp,
        content: "y".repeat(1400),
      })
    );
    mockGetAllMemories.mockResolvedValue({ data: rows, error: null });

    await runMemoryMaintenance("user-1", MESSAGE, "msg-1");

    const win = windowGroup(lastInput())!;
    expect(JSON.stringify(win).length).toBeLessThanOrEqual(6000);
    expect(win.memories.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("skips the window when fewer than 2 distinct types are eligible", async () => {
    mockGetAllMemories.mockResolvedValue({
      data: [
        dbRow({ id: "s1", memory_type: "semantic" }),
        dbRow({ id: "s2", memory_type: "semantic" }),
        dbRow({ id: "s3", memory_type: "semantic" }),
      ],
      error: null,
    });

    await runMemoryMaintenance("user-1", MESSAGE, "msg-1");

    const input = lastInput();
    expect(input).toHaveLength(1);
    expect(input[0].memoryType).toBe("semantic");
    expect(input[0].memories).toHaveLength(3);
  });

  it("keeps type-group item shape byte-identical (9-field items)", async () => {
    mockGetAllMemories.mockResolvedValue({
      data: [dbRow({ id: "only", memory_type: "semantic" })],
      error: null,
    });

    await runMemoryMaintenance("user-1", MESSAGE, "msg-1");

    const input = lastInput();
    expect(input).toHaveLength(1);
    expect(input[0].memories[0]).toEqual({
      id: "only",
      title: "Title",
      content: "Content",
      summary: "Summary",
      importance: 0.8,
      confidence: 0.9,
      memoryType: "semantic",
      tags: [],
      metadata: {},
    });
  });

  it("is deterministic across runs (identical serialized input)", async () => {
    const rows = [
      dbRow({ id: "a", memory_type: "semantic", importance_v2: 0.9 }),
      dbRow({ id: "b", memory_type: "project", importance_v2: 0.8 }),
      dbRow({ id: "c", memory_type: "episodic", importance_v2: 0.7 }),
    ];
    mockGetAllMemories.mockResolvedValue({ data: rows, error: null });

    await runMemoryMaintenance("user-1", MESSAGE, "msg-1");
    const first = JSON.stringify(lastInput());

    vi.clearAllMocks();
    setDefaultStubs();
    mockGetAllMemories.mockResolvedValue({ data: rows, error: null });
    await runMemoryMaintenance("user-1", MESSAGE, "msg-1");
    const second = JSON.stringify(lastInput());

    expect(second).toBe(first);
  });

});

describe("Phase 1-B: grounding gate (pipeline integration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllMemories.mockReset();
    setDefaultStubs();
  });

  it("R1: a reflection from a single-candidate run is rejected before save", async () => {
    mockGetAllMemories.mockResolvedValue({
      data: [dbRow({ id: "only-one", memory_type: "semantic" })],
      error: null,
    });
    mockGenerateReflections.mockResolvedValue([
      { title: "Insight", content: "Some synthesized insight text.", importance: 6, confidence: 0.9 },
    ]);

    await runMemoryMaintenance("user-1", MESSAGE, "msg-1");

    expect(reflectionSaveCalls()).toHaveLength(0);
    const extraction = mockSaveMemory.mock.calls
      .map((c) => c[0] as SaveCall)
      .filter((a) => a.memoryType !== "reflection");
    expect(extraction.length).toBeGreaterThan(0);
  });

  it("R2: a verbatim repeat of a source is rejected; valid reflections persist", async () => {
    mockGetAllMemories.mockResolvedValue({
      data: [
        dbRow({ id: "c1", memory_type: "semantic", content: "alpha content" }),
        dbRow({ id: "c2", memory_type: "project", content: "beta content" }),
      ],
      error: null,
    });
    mockGenerateReflections.mockResolvedValue([
      { title: "Echo", content: "alpha content", importance: 5, confidence: 0.9 },
      { title: "Good", content: "Synthesized from multiple memories.", importance: 6, confidence: 0.9 },
    ]);

    await runMemoryMaintenance("user-1", MESSAGE, "msg-1");

    const saved = reflectionSaveCalls();
    expect(saved).toHaveLength(1);
    expect(saved[0].title).toBe("Good");
    expect(saved[0].metadata).toEqual({
      sourceMemoryIds: ["c1", "c2"],
      generatedAt: expect.any(String),
    });
  });
});

