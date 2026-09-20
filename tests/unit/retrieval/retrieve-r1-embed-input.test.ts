import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * R1 boundary: the ONLY production consumer is the retrieval embedding input.
 * - GATED queries pass "The user asks: <original>" to embed().
 * - NON-GATED queries pass the original string byte-for-byte.
 * - Downstream candidate/surfaced/touch behavior is unchanged.
 */
describe("R1 — retrieval query rewrite reaches embed() only", () => {
  let embedMock: ReturnType<typeof vi.fn>;
  let mbv2: ReturnType<typeof vi.fn>;
  let touchMock: ReturnType<typeof vi.fn>;

  const CANDIDATE_ROW = {
    id: "m1",
    title: "User Name",
    content: "The user's name is Prince.",
    summary: "",
    tags: [] as string[],
    memory_type: "identity",
    importance: 0.72,
    confidence: 0.95,
    similarity: 0.6589,
    effective_score: 0.706,
    times_used: 0,
    last_used: null,
  };

  beforeEach(() => {
    embedMock = vi
      .fn()
      .mockResolvedValue({ embedding: new Array<number>(768).fill(0.1) });
    mbv2 = vi
      .fn()
      .mockResolvedValue({ data: [CANDIDATE_ROW], error: null });
    touchMock = vi.fn().mockResolvedValue({ data: null, error: null });

    vi.doMock("@/lib/ai/embeddings/embed", () => ({ embed: embedMock }));
    vi.doMock("@/lib/repositories/memory.repository", () => ({
      matchMemoriesV2: mbv2,
      touchMemories: touchMock,
      getActiveIdentityMemories: vi.fn().mockResolvedValue({
        data: [],
        error: null,
      }),
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

  it("GATED: 'What is my name?' embeds 'The user asks: What is my name?'", async () => {
    const { retrieveMemories } = await import("@/lib/memory/retrieve");
    await retrieveMemories("user-abc", "What is my name?");

    expect(embedMock).toHaveBeenCalledTimes(1);
    expect(embedMock).toHaveBeenCalledWith("The user asks: What is my name?");
  });

  it("NON-GATED: 'What is 2+2?' embeds the original string unchanged", async () => {
    const { retrieveMemories } = await import("@/lib/memory/retrieve");
    await retrieveMemories("user-abc", "What is 2+2?");

    expect(embedMock).toHaveBeenCalledTimes(1);
    expect(embedMock).toHaveBeenCalledWith("What is 2+2?");
  });

  it("candidate/touch behavior is unchanged for the gated path", async () => {
    const { retrieveMemories } = await import("@/lib/memory/retrieve");
    const result = await retrieveMemories("user-abc", "What is my name?");

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
    expect(result[0]).toHaveProperty("id", "m1");
    // The surfaced memory still flows through touchMemories exactly as before.
    expect(touchMock).toHaveBeenCalledTimes(1);
    expect(touchMock).toHaveBeenCalledWith("user-abc", ["m1"]);
  });
});