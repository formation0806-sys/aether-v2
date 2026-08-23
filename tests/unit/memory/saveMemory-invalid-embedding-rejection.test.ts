/// <reference types="vitest" />

import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Phase 6-AI regression: an obviously invalid embedding (the exact
 * `new Array(768).fill(0.1)` placeholder that contaminated production) must be
 * rejected by `saveMemory` BEFORE any repository read/write occurs.
 */

vi.mock("@/lib/ai/embeddings/embed", () => ({
  embed: vi.fn(async () => ({ embedding: new Array(768).fill(0.1) })),
}));

vi.mock("@/lib/repositories/memory.repository", () => ({
  getMemoryByTitle: vi.fn(async () => ({ data: null, error: null })),
  insertMemoryV2: vi.fn(async () => ({ error: null })),
  updateMemoryV2: vi.fn(async () => ({ error: null })),
  matchMemoriesV2: vi.fn(async () => ({ data: [], error: null })),
}));

import { saveMemory } from "@/lib/memory/memory";
import { embed } from "@/lib/ai/embeddings/embed";
import {
  insertMemoryV2,
  updateMemoryV2,
  getMemoryByTitle,
} from "@/lib/repositories/memory.repository";

describe("Phase 6-AI: invalid embeddings are rejected before persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saveMemory throws on a constant-0.1 embedding and never touches the repository", async () => {
    await expect(
      saveMemory({
        userId: "phase6ai-test-user",
        title: "Phase 6-AI regression probe",
        content: "The user prefers TypeScript and dark mode interfaces.",
        memoryType: "semantic",
        importance: 8,
        confidence: 0.9,
      })
    ).rejects.toThrow(/Invalid memory embedding/);

    expect(embed).toHaveBeenCalledTimes(1);
    expect(getMemoryByTitle).not.toHaveBeenCalled();
    expect(insertMemoryV2).not.toHaveBeenCalled();
    expect(updateMemoryV2).not.toHaveBeenCalled();
  });
});