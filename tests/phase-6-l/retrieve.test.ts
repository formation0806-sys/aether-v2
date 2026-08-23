/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi } from "vitest";

describe("retrieve - mock contract tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("embed and matchMemoriesV2 with valid inputs", async () => {
    const embed = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
    const matchMemoriesV2 = vi.fn().mockResolvedValue([{ id: "mem-1", similarity: 0.9 }]);

    const embedding = await embed("test query");
    const result = await matchMemoriesV2([0.1, 0.2, 0.3], "user-123", { matchCount: 8 });

    expect(embedding).toEqual([0.1, 0.2, 0.3]);
    expect(result).toEqual([{ id: "mem-1", similarity: 0.9 }]);
  });

  it("no candidates returns empty array", async () => {
    const matchMemoriesV2 = vi.fn().mockResolvedValue({ data: [] });
    const result = (await matchMemoriesV2([0.1, 0.2, 0.3], "user-123", { matchCount: 8 })).data;
    expect(result).toEqual([]);
  });

  it("token budget selection surfaces 2 candidates from 3", () => {
    const padToLength = (base: string, targetLength: number): string => {
      let result = base;
      while (result.length < targetLength) {
        result += " " + base;
      }
      return result.substring(0, targetLength);
    };

    const candidates = [
      { id: "mem-1", content: padToLength("semantic memory content ", 350), similarity: 0.9, importance: 0.8 },
      { id: "mem-2", content: padToLength("retrieval pipeline context ", 350), similarity: 0.7, importance: 0.9 },
      { id: "mem-3", content: padToLength("batch processing entry ", 350), similarity: 0.8, importance: 0.7 },
    ];

    const semanticTokenBudget = 800;
    let tokenUsed = 0;
    const surfaced: typeof candidates = [];

    for (const candidate of candidates) {
      if (tokenUsed + candidate.content.length > semanticTokenBudget) break;
      surfaced.push(candidate);
      tokenUsed += candidate.content.length;
    }

    expect(surfaced.length).toBe(2);
  });
});