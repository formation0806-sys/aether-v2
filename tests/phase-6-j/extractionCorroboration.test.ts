/// <reference types="vitest" />

import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 6-J: verify the corroboration WIRING contract in runMemoryMaintenance.
// Convention mirrors tests/phase-6-l/runReflection.test.ts (vitest.config.ts
// includes tests/**/*.test.ts; globals enabled). Only the wiring contract is
// tested — no thresholds/prompts/models/migrations are altered or invented.

vi.mock("../../lib/memory/aiExtractor", () => ({ aiExtractMemories: vi.fn() }));
vi.mock("../../lib/memory/memory", () => ({ saveMemory: vi.fn() }));
vi.mock("../../lib/memory/identity", () => ({ resolveMemoryIdentity: vi.fn() }));
vi.mock("../../lib/repositories/memory.repository", () => ({
  getAllMemories: vi.fn(),
  purgeArchived: vi.fn(),
  corroborateMemory: vi.fn(),
}));
vi.mock("../../lib/memory/reflector", () => ({ generateReflections: vi.fn() }));
vi.mock("../../lib/memory/lifecycle", () => ({ evaluateLifecycle: vi.fn() }));

import { runMemoryMaintenance } from "../../lib/core/pipeline";
import type { MemoryIdentityDecision } from "../../lib/memory/identity";
import { aiExtractMemories } from "../../lib/memory/aiExtractor";
import { saveMemory } from "../../lib/memory/memory";
import { resolveMemoryIdentity } from "../../lib/memory/identity";
import { getAllMemories, purgeArchived } from "../../lib/repositories/memory.repository";
import { corroborateMemory } from "../../lib/repositories/memory.repository";
import { generateReflections } from "../../lib/memory/reflector";
import { evaluateLifecycle } from "../../lib/memory/lifecycle";
import { scoreExtractedMemory } from "../../lib/memory/score";

const mockAiExtract = aiExtractMemories as ReturnType<typeof vi.fn>;
const mockSaveMemory = saveMemory as ReturnType<typeof vi.fn>;
const mockResolveIdentity = resolveMemoryIdentity as ReturnType<typeof vi.fn>;
const mockCorroborate = corroborateMemory as ReturnType<typeof vi.fn>;
const mockGetAllMemories = getAllMemories as ReturnType<typeof vi.fn>;
const mockPurgeArchived = purgeArchived as ReturnType<typeof vi.fn>;
const mockGenerateReflections = generateReflections as ReturnType<typeof vi.fn>;
const mockEvaluateLifecycle = evaluateLifecycle as ReturnType<typeof vi.fn>;

// Passes the extraction gate (shouldExtractMemory: length>=15, not a greeting).
const MSG = "The user shared that they live in Mumbai and it is important to remember.";
const USER_ID = "user-1";
const MESSAGE_ID = "msg-1";

const SEMANTIC_MEMORY = {
  title: "Location",
  content: "The user lives in Mumbai.",
  memoryType: "semantic" as const,
};

describe("Phase 6-J: corroboration wiring in runMemoryMaintenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAiExtract.mockReset();
    mockSaveMemory.mockReset();
    mockResolveIdentity.mockReset();
    mockCorroborate.mockReset();
    mockGetAllMemories.mockReset();
    mockPurgeArchived.mockReset();
    mockGenerateReflections.mockReset();
    mockEvaluateLifecycle.mockReset();

    // Defaults: one extracted semantic memory; identity resolves to "create".
    mockAiExtract.mockResolvedValue([SEMANTIC_MEMORY]);
    mockResolveIdentity.mockResolvedValue({
      decision: "create",
      reason: "no match",
    } as MemoryIdentityDecision);
    mockGetAllMemories.mockResolvedValue({ data: [], error: null });
    mockPurgeArchived.mockResolvedValue({ count: 0 });
    mockEvaluateLifecycle.mockResolvedValue({ transitions: [], evaluated: 0, errors: [] });
    mockGenerateReflections.mockResolvedValue([]);
  });

  it("A. create decision routes through saveMemory, not corroborateMemory", async () => {
    const result = await runMemoryMaintenance(USER_ID, MSG, MESSAGE_ID);

    expect(mockResolveIdentity).toHaveBeenCalledTimes(1);
    expect(mockResolveIdentity).toHaveBeenCalledWith({
      userId: USER_ID,
      title: SEMANTIC_MEMORY.title,
      content: SEMANTIC_MEMORY.content,
      memoryType: "semantic",
    });

    expect(mockCorroborate).not.toHaveBeenCalled();
    expect(mockSaveMemory).toHaveBeenCalledTimes(1);
    expect(mockSaveMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        title: SEMANTIC_MEMORY.title,
        content: SEMANTIC_MEMORY.content,
        memoryType: "semantic",
        importance: undefined,
        confidence: undefined,
      })
    );

    // scoreExtractedMemory (unit-tested in score.test.ts) turns the omitted
    // importance/confidence into the write-time defaults the reflection gate
    // then requires to mature. Documents the invariant corroboration relies on.
    const scored = scoreExtractedMemory(SEMANTIC_MEMORY);
    expect(scored.confidence).toBe(0.5); // DEFAULT_CONFIDENCE
    expect(scored.importance).toBeCloseTo(0.45, 2); // 0.35*0.5 + 0.25*0.6 + 0.15*0.5

    expect(result.extraction.ok).toBe(true);
  });

  it("B. corroborate decision calls corroborateMemory(targetId, messageId) and skips saveMemory", async () => {
    // Real enum has only two decisions; "corroborate" carries targetId.
    mockResolveIdentity.mockResolvedValue({
      decision: "corroborate",
      targetId: "m1",
      reason: "verified SAME (similarity 0.91)",
    } as MemoryIdentityDecision);

    await runMemoryMaintenance(USER_ID, MSG, "msg-xyz");

    expect(mockCorroborate).toHaveBeenCalledTimes(1);
    expect(mockCorroborate).toHaveBeenCalledWith("m1", "msg-xyz");
    expect(mockSaveMemory).not.toHaveBeenCalled();
  });

  it("C. identity failure is fail-safe: falls back to saveMemory, skips corroborate", async () => {
    mockResolveIdentity.mockRejectedValue(new Error("verifier OOM"));

    const result = await runMemoryMaintenance(USER_ID, MSG, MESSAGE_ID);

    expect(mockCorroborate).not.toHaveBeenCalled();
    expect(mockSaveMemory).toHaveBeenCalledTimes(1);
    expect(result.extraction.ok).toBe(true);
  });

  it("D. without an observation/messageId, identity is not consulted; saveMemory runs", async () => {
    await runMemoryMaintenance(USER_ID, MSG); // no messageId

    expect(mockResolveIdentity).not.toHaveBeenCalled();
    expect(mockCorroborate).not.toHaveBeenCalled();
    expect(mockSaveMemory).toHaveBeenCalledTimes(1);
  });

  it("F. repeated distinct observations each fire corroborateMemory with (targetId, messageId)", async () => {
    mockResolveIdentity.mockResolvedValue({
      decision: "corroborate",
      targetId: "m1",
      reason: "verified SAME",
    } as MemoryIdentityDecision);

    const messages = ["msg-1", "msg-2", "msg-3", "msg-4"];
    for (const m of messages) {
      await runMemoryMaintenance(USER_ID, MSG, m);
    }

    expect(mockCorroborate).toHaveBeenCalledTimes(4);
    expect(mockCorroborate.mock.calls).toEqual([
      ["m1", "msg-1"],
      ["m1", "msg-2"],
      ["m1", "msg-3"],
      ["m1", "msg-4"],
    ]);
    expect(mockSaveMemory).not.toHaveBeenCalled();
    // Pipeline only passes correct IDs; the corroborate_memory RPC (migration 0011)
    // owns +0.05 and the (memory_id, message_id) partial-unique index (exactly-once).
    // 4 distinct messages => 0.50 -> 0.55 -> 0.60 -> 0.65 -> 0.70 (4 increments to gate).
  });

  it("J. reflection gate is unchanged: confidence < 0.7 is excluded", async () => {
    mockGetAllMemories.mockResolvedValue({
      data: [
        {
          id: "m-low",
          memory_type: "semantic",
          status: "active",
          importance_v2: 0.9,
          confidence_v2: 0.6,
          title: "T",
          content: "C",
          summary: "S",
        },
      ],
      error: null,
    });

    await runMemoryMaintenance(USER_ID, MSG, MESSAGE_ID);

    expect(mockGenerateReflections).not.toHaveBeenCalled();
  });

  it("J. reflection gate is unchanged: confidence >= 0.7 && importance >= 0.5 is eligible", async () => {
    mockGetAllMemories.mockResolvedValue({
      data: [
        {
          id: "m-ok",
          memory_type: "identity",
          status: "candidate",
          importance_v2: 0.5,
          confidence_v2: 0.7,
          title: "T",
          content: "C",
          summary: "S",
        },
      ],
      error: null,
    });

    await runMemoryMaintenance(USER_ID, MSG, MESSAGE_ID);

    expect(mockGenerateReflections).toHaveBeenCalledTimes(1);
  });
});

