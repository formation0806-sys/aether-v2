/// <reference types="vitest" />

import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Phase 1-A — Reflection loop guard + provenance wiring.
 *
 * Exercises the real `runMemoryMaintenance` → `runReflection` path and proves:
 *   1. memory_type === "reflection" is excluded from reflection candidates
 *      (reflections stay retrievable for context, but never seed reflection).
 *   2. Normal eligible memories remain eligible.
 *   3-5. Every generated reflection is saved with provenance metadata:
 *        { sourceMemoryIds, generatedAt } — the exact candidate IDs supplied
 *        to that generation operation, plus a valid ISO timestamp.
 *
 * All external boundaries (repository, extractor, reflector model call,
 * saveMemory persistence, identity, lifecycle) are mocked.
 * No DB, no network, no production write.
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
type InputGroup = { memories: Array<{ id: string }> };

/** Full DB row shape as returned by getAllMemories (snake_case). */
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
    last_scored: new Date().toISOString(),
    effective_score: 0.7,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function suppliedIds(call: unknown[]): string[] {
  const input = call[0] as InputGroup[];
  return input.flatMap((group) => group.memories.map((m) => m.id));
}

function reflectionSaveCalls(): SaveCall[] {
  return mockSaveMemory.mock.calls
    .map((call) => call[0] as SaveCall)
    .filter((arg) => arg.memoryType === "reflection");
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
  // Default: reflector produces nothing unless a test overrides it.
  mockGenerateReflections.mockResolvedValue([]);
}

describe("Phase 1-A: reflection loop guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllMemories.mockReset();
    setDefaultStubs();
  });

  it("TEST 1: an eligible reflection memory is excluded from reflection candidates", async () => {
    mockGetAllMemories.mockResolvedValue({
      data: [
        dbRow({
          id: "mem-refl",
          memory_type: "reflection",
          source_v2: "reflection",
        }),
      ],
      error: null,
    });

    const result = await runMemoryMaintenance("user-1", MESSAGE, "msg-1");

    // Without the loop guard this single eligible memory would form a group
    // and reach generateReflections. With the guard there is no input group.
    expect(mockGenerateReflections).not.toHaveBeenCalled();
    expect(result.reflection.ok).toBe(true);
  });

  it("TEST 2: an eligible non-reflection memory remains a candidate", async () => {
    mockGetAllMemories.mockResolvedValue({
      data: [dbRow({ id: "mem-sem", memory_type: "semantic" })],
      error: null,
    });

    await runMemoryMaintenance("user-1", MESSAGE, "msg-1");

    expect(mockGenerateReflections).toHaveBeenCalledTimes(1);
    expect(suppliedIds(mockGenerateReflections.mock.calls[0])).toEqual([
      "mem-sem",
    ]);
  });

  it("loop guard + eligibility: only the eligible non-reflection memory survives filtering", async () => {
    mockGetAllMemories.mockResolvedValue({
      data: [
        dbRow({ id: "mem-sem-eligible", memory_type: "semantic" }),
        dbRow({
          id: "mem-sem-ineligible",
          memory_type: "semantic",
          confidence_v2: 0.5,
        }),
        dbRow({ id: "mem-refl", memory_type: "reflection" }),
        dbRow({
          id: "mem-archived",
          memory_type: "semantic",
          status: "archived",
        }),
      ],
      error: null,
    });

    await runMemoryMaintenance("user-1", MESSAGE, "msg-1");

    expect(mockGenerateReflections).toHaveBeenCalledTimes(1);
    expect(suppliedIds(mockGenerateReflections.mock.calls[0])).toEqual([
      "mem-sem-eligible",
    ]);
  });
});

describe("Phase 1-A: reflection provenance metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllMemories.mockReset();
    setDefaultStubs();
    mockGetAllMemories.mockResolvedValue({
      data: [
        dbRow({ id: "src-1", memory_type: "semantic" }),
        dbRow({ id: "src-2", memory_type: "semantic" }),
      ],
      error: null,
    });
    mockGenerateReflections.mockResolvedValue([
      {
        title: "Repeated Pattern",
        content: "Multiple memories consistently indicate the same fact.",
        importance: 6,
        confidence: 0.9,
      },
    ]);
  });

  it("TEST 3: the generated reflection is saved with provenance metadata", async () => {
    await runMemoryMaintenance("user-1", MESSAGE, "msg-1");

    const calls = reflectionSaveCalls();
    expect(calls).toHaveLength(1);
    const metadata = calls[0].metadata as Record<string, unknown>;
    expect(metadata.sourceMemoryIds).toBeDefined();
    expect(metadata.generatedAt).toBeDefined();
  });

  it("TEST 4: sourceMemoryIds contain the actual source memory IDs", async () => {
    await runMemoryMaintenance("user-1", MESSAGE, "msg-1");

    const metadata = reflectionSaveCalls()[0]
      .metadata as Record<string, unknown>;
    expect(metadata.sourceMemoryIds).toEqual(["src-1", "src-2"]);
  });

  it("TEST 5: generatedAt is a valid ISO timestamp", async () => {
    await runMemoryMaintenance("user-1", MESSAGE, "msg-1");

    const metadata = reflectionSaveCalls()[0]
      .metadata as Record<string, unknown>;
    expect(typeof metadata.generatedAt).toBe("string");
    expect(
      Number.isNaN(Date.parse(metadata.generatedAt as string))
    ).toBe(false);
    expect(metadata.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("provenance IDs equal the candidate set actually supplied to generateReflections", async () => {
    await runMemoryMaintenance("user-1", MESSAGE, "msg-1");

    const supplied = suppliedIds(mockGenerateReflections.mock.calls[0]).sort();
    const metadata = reflectionSaveCalls()[0]
      .metadata as Record<string, unknown>;
    expect([...(metadata.sourceMemoryIds as string[])].sort()).toEqual(supplied);
  });

  it("provenance metadata carries exactly the contract keys", async () => {
    await runMemoryMaintenance("user-1", MESSAGE, "msg-1");

    const metadata = reflectionSaveCalls()[0]
      .metadata as Record<string, unknown>;
    expect(Object.keys(metadata).sort()).toEqual([
      "generatedAt",
      "sourceMemoryIds",
    ]);
  });

  it("extraction saves keep empty metadata (provenance is reflection-only)", async () => {
    await runMemoryMaintenance("user-1", MESSAGE, "msg-1");

    const extractionCalls = mockSaveMemory.mock.calls
      .map((call) => call[0] as SaveCall)
      .filter((arg) => arg.memoryType !== "reflection");
    expect(extractionCalls.length).toBeGreaterThan(0);
    for (const call of extractionCalls) {
      expect(call.metadata).toEqual({});
    }
  });
});
