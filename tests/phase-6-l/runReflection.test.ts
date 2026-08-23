/// <reference types="vitest" />

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/repositories/memory.repository", () => ({
  getAllMemories: vi.fn(),
  purgeArchived: vi.fn(),
}));

vi.mock("../../lib/memory/aiExtractor", () => ({
  aiExtractMemories: vi.fn(),
}));

vi.mock("../../lib/memory/memory", () => ({
  saveMemory: vi.fn(),
}));

vi.mock("../../lib/memory/reflector", () => ({
  generateReflections: vi.fn(),
}));

vi.mock("../../lib/memory/lifecycle", () => ({
  evaluateLifecycle: vi.fn(),
}));

import {
  getAllMemories,
  purgeArchived,
} from "../../lib/repositories/memory.repository";
import { aiExtractMemories } from "../../lib/memory/aiExtractor";
import { saveMemory } from "../../lib/memory/memory";
import { generateReflections } from "../../lib/memory/reflector";
import { evaluateLifecycle } from "../../lib/memory/lifecycle";
import { runMemoryMaintenance } from "../../lib/core/pipeline";

const mockGetAllMemories = getAllMemories as ReturnType<typeof vi.fn>;
const mockPurgeArchived = purgeArchived as ReturnType<typeof vi.fn>;
const mockAiExtractMemories = aiExtractMemories as ReturnType<typeof vi.fn>;
const mockSaveMemory = saveMemory as ReturnType<typeof vi.fn>;
const mockGenerateReflections = generateReflections as ReturnType<typeof vi.fn>;
const mockEvaluateLifecycle = evaluateLifecycle as ReturnType<typeof vi.fn>;

describe("runReflection - grouping and persistence via runMemoryMaintenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllMemories.mockReset();
    mockPurgeArchived.mockReset();
    mockAiExtractMemories.mockReset();
    mockSaveMemory.mockReset();
    mockGenerateReflections.mockReset();
    mockEvaluateLifecycle.mockReset();

    mockAiExtractMemories.mockResolvedValue([
      { title: "Extracted Memory", content: "Some content", memoryType: "semantic" },
    ]);
    mockEvaluateLifecycle.mockResolvedValue({ transitions: [], evaluated: 0, errors: [] });
    mockPurgeArchived.mockResolvedValue({ count: 0 });
  });

  it("empty candidate set returns without calling generateReflections", async () => {
    mockGetAllMemories.mockResolvedValue({
      data: [],
      error: null,
    });

    const result = await runMemoryMaintenance(
      "user-1",
      "This is a test message with enough length to pass the gate",
      "msg-1"
    );

    expect(result.reflection.ok).toBe(true);
    expect(mockGenerateReflections).not.toHaveBeenCalled();
  });

  it("mixed memory_types produce correct group structure", async () => {
    mockGetAllMemories.mockResolvedValue({
      data: [
        {
          id: "mem-1",
          user_id: "user-1",
          project_id: null,
          memory_type: "semantic",
          status: "active",
          title: "Coffee Preference",
          content: "User drinks coffee every morning",
          summary: "Coffee habit",
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
        },
        {
          id: "mem-2",
          user_id: "user-1",
          project_id: null,
          memory_type: "identity",
          status: "active",
          title: "Home City",
          content: "User lives in NYC",
          summary: "NYC residence",
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
        },
      ],
      error: null,
    });

    mockGenerateReflections.mockResolvedValue([]);

    await runMemoryMaintenance(
      "user-1",
      "This is a test message with enough length to pass the gate",
      "msg-1"
    );

    expect(mockGenerateReflections).toHaveBeenCalledTimes(1);
    const reflectionInput = mockGenerateReflections.mock.calls[0][0];

    const groups = reflectionInput as Array<{ memoryType: string; memories: Array<{ id: string }> }>;
    expect(groups).toHaveLength(2);
    expect(groups[0].memoryType).toBe("semantic");
    expect(groups[0].memories).toHaveLength(1);
    expect(groups[0].memories[0].id).toBe("mem-1");
    expect(groups[1].memoryType).toBe("identity");
    expect(groups[1].memories).toHaveLength(1);
    expect(groups[1].memories[0].id).toBe("mem-2");
  });

  it("single memory_type produces single group", async () => {
    mockGetAllMemories.mockResolvedValue({
      data: [
        {
          id: "mem-1",
          user_id: "user-1",
          project_id: null,
          memory_type: "semantic",
          status: "active",
          title: "Coffee Preference",
          content: "User drinks coffee every morning",
          summary: "Coffee habit",
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
        },
        {
          id: "mem-2",
          user_id: "user-1",
          project_id: null,
          memory_type: "semantic",
          status: "active",
          title: "Dark Mode",
          content: "User prefers dark mode",
          summary: "Dark mode preference",
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
        },
      ],
      error: null,
    });

    mockGenerateReflections.mockResolvedValue([]);

    await runMemoryMaintenance(
      "user-1",
      "This is a test message with enough length to pass the gate",
      "msg-1"
    );

    expect(mockGenerateReflections).toHaveBeenCalledTimes(1);
    const reflectionInput = mockGenerateReflections.mock.calls[0][0] as Array<{
      memoryType: string;
      memories: Array<{ id: string }>;
    }>;

    expect(reflectionInput).toHaveLength(1);
    expect(reflectionInput[0].memoryType).toBe("semantic");
    expect(reflectionInput[0].memories).toHaveLength(2);
  });

  it("constructReflectionInput produces correct ReflectionInput shape", async () => {
    mockGetAllMemories.mockResolvedValue({
      data: [
        {
          id: "mem-1",
          user_id: "user-1",
          project_id: null,
          memory_type: "semantic",
          status: "active",
          title: "Coffee Preference",
          content: "User drinks coffee every morning",
          summary: "Coffee habit",
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
        },
      ],
      error: null,
    });

    mockGenerateReflections.mockResolvedValue([]);

    await runMemoryMaintenance(
      "user-1",
      "This is a test message with enough length to pass the gate",
      "msg-1"
    );

    expect(mockGenerateReflections).toHaveBeenCalledTimes(1);
    const reflectionInput = mockGenerateReflections.mock.calls[0][0] as Array<{
      memoryType: string;
      memories: Array<{ id: string; title: string; content: string; summary: string }>;
    }>;

    expect(reflectionInput[0]).toEqual({
      memoryType: "semantic",
      memories: [
        {
          id: "mem-1",
          title: "Coffee Preference",
          content: "User drinks coffee every morning",
          summary: "Coffee habit",
        },
      ],
    });
  });

  it("valid reflections trigger saveMemory once per reflection with correct args", async () => {
    mockGetAllMemories.mockResolvedValue({
      data: [
        {
          id: "mem-1",
          user_id: "user-1",
          project_id: null,
          memory_type: "semantic",
          status: "active",
          title: "Coffee Preference",
          content: "User drinks coffee every morning",
          summary: "Coffee habit",
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
        },
      ],
      error: null,
    });

    mockGenerateReflections.mockResolvedValue([
      { title: "Morning Routine", content: "User drinks coffee every morning", importance: 7, confidence: 0.9 },
      { title: "Dark Mode", content: "User prefers dark mode", importance: 6, confidence: 0.8 },
    ]);

    await runMemoryMaintenance(
      "user-1",
      "This is a test message with enough length to pass the gate",
      "msg-1"
    );

    const reflectionCalls = mockSaveMemory.mock.calls.filter(
      (call: any) => call[0].source === "reflection"
    );

    expect(reflectionCalls).toHaveLength(2);
    expect(reflectionCalls[0][0]).toEqual({
      userId: "user-1",
      title: "Morning Routine",
      content: "User drinks coffee every morning",
      memoryType: "reflection",
      importance: 7,
      confidence: 0.9,
      source: "reflection",
    });
    expect(reflectionCalls[1][0]).toEqual({
      userId: "user-1",
      title: "Dark Mode",
      content: "User prefers dark mode",
      memoryType: "reflection",
      importance: 6,
      confidence: 0.8,
      source: "reflection",
    });
  });
});
