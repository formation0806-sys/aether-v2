import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  MIN_SIMILARITY,
  RETRIEVAL_TOP_K,
} from "@/lib/memory/constants";

/**
 * R1 must NOT move the retrieval contract: MIN_SIMILARITY stays 0.65 and
 * matchMemoriesV2 still receives (RETRIEVAL_TOP_K, MIN_SIMILARITY).
 */
describe("R1 — frozen retrieval contract", () => {
  let embedMock: ReturnType<typeof vi.fn>;
  let mbv2: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    embedMock = vi
      .fn()
      .mockResolvedValue({ embedding: new Array<number>(768).fill(0.1) });
    mbv2 = vi.fn().mockResolvedValue({ data: [], error: null });

    vi.doMock("@/lib/ai/embeddings/embed", () => ({ embed: embedMock }));
    vi.doMock("@/lib/repositories/memory.repository", () => ({
      matchMemoriesV2: mbv2,
      touchMemories: () => Promise.resolve({ data: null, error: null }),
    }));
    vi.doMock("@/lib/memory/score", () => ({
      scoreRetrievalCandidate: () => 0.6,
      mmrScore: () => 0.6,
    }));
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: () => ({
        from: () => ({
          select: () => ({
            in: () => ({
              eq: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }),
      }),
    }));
  });

  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("MIN_SIMILARITY is exactly 0.65", () => {
    expect(MIN_SIMILARITY).toBe(0.65);
  });

  it("matchMemoriesV2 still receives RETRIEVAL_TOP_K / MIN_SIMILARITY", async () => {
    const { retrieveMemories } = await import("@/lib/memory/retrieve");
    await retrieveMemories("user-abc", "What is 2+2?");

    expect(mbv2).toHaveBeenCalledTimes(1);
    const [, userId, options] = mbv2.mock.calls[0] as [
      number[],
      string,
      { matchCount: number; minSimilarity: number },
    ];
    expect(userId).toBe("user-abc");
    expect(options).toEqual({
      matchCount: RETRIEVAL_TOP_K,
      minSimilarity: MIN_SIMILARITY,
    });
  });
});