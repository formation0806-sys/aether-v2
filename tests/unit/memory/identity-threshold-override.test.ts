/// <reference types="vitest" />

/**
 * Phase 6-AO — identity-candidate threshold override (§2/§3 exception).
 *
 * Hermetic (no network): mocks `embed` and `matchMemoriesV2`, and intercepts the
 * local Ollama `/api/chat` fetch used by the LLM verifier. Proves:
 *   A. resolveMemoryIdentity() WITHOUT candidateMinSimilarity sends
 *      minSimilarity === 0.85 to matchMemoriesV2 (production default unchanged).
 *   B. resolveMemoryIdentity({ ..., candidateMinSimilarity: 0.80 }) sends
 *      minSimilarity === 0.80.
 *   C. Behaviour otherwise unchanged: a single SAME candidate still corroborates,
 *      and matchCount / the option-key set are untouched.
 *
 * Production callers (core/pipeline.ts) omit the option, so they exercise A
 * and remain byte-for-byte on the 0.85 floor (IDENTITY_CANDIDATE_MIN_SIMILARITY).
 */

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/ai/embeddings/embed", () => ({
  embed: vi.fn(async () => ({
    embedding: Array.from({ length: 768 }, (_v, i) => ((i % 7) + 1) * 0.001),
  })),
}));

const matchMemoriesV2Mock = vi.fn();
vi.mock("@/lib/repositories/memory.repository", () => ({
  matchMemoriesV2: (...args: unknown[]) => matchMemoriesV2Mock(...args),
}));

import { resolveMemoryIdentity } from "@/lib/memory/identity";

const realFetchOriginal = globalThis.fetch.bind(globalThis);

type ScriptedDecision = "SAME" | "DIFFERENT" | "UNCERTAIN";

function installVerifierScript(decision: ScriptedDecision) {
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : (input as Request).url;
    if (url.includes("/api/chat")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            message: {
              role: "assistant",
              content: JSON.stringify({ decision, reason: "scripted" }),
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
      );
    }
    return realFetchOriginal(input);
  }) as typeof fetch;
}

function cand(id: string, similarity: number) {
  return {
    id,
    title: `Title ${id}`,
    content: `Content ${id}`,
    memory_type: "project",
    status: "active",
    similarity,
    effective_score: 0.674,
    confidence: 0.9,
    times_used: 0,
    last_used: null,
  };
}

const INPUT = {
  userId: "user-1",
  title: "User Project: Aether (fresh observation)",
  content: "The user is building a project called Aether with Next.js and Supabase.",
  memoryType: "project" as const,
};

type OptionsSent = { minSimilarity: number; matchCount: number };

function optsOf(): OptionsSent {
  const callArgs = matchMemoriesV2Mock.mock.calls[0];
  return (callArgs?.[2] ?? {}) as OptionsSent;
}

describe("Phase 6-AO — candidateMinSimilarity option", () => {
  afterEach(() => {
    matchMemoriesV2Mock.mockReset();
    globalThis.fetch = realFetchOriginal;
  });

  it("A. default (omitted) sends minSimilarity 0.85", async () => {
    matchMemoriesV2Mock.mockResolvedValue({ data: [], error: null });
    await resolveMemoryIdentity(INPUT);
    expect(optsOf().minSimilarity).toBe(0.85);
  });

  it("B. override 0.80 sends minSimilarity 0.80", async () => {
    matchMemoriesV2Mock.mockResolvedValue({ data: [], error: null });
    await resolveMemoryIdentity({ ...INPUT, candidateMinSimilarity: 0.80 });
    expect(optsOf().minSimilarity).toBe(0.80);
  });

  it("C1. default path still corroborates a single SAME candidate (behaviour unchanged)", async () => {
    installVerifierScript("SAME");
    matchMemoriesV2Mock.mockResolvedValue({
      data: [cand("mem-1", 0.91)],
      error: null,
    });
    const decision = await resolveMemoryIdentity(INPUT);
    expect(decision).toEqual({
      decision: "corroborate",
      targetId: "mem-1",
      reason: "verified SAME (similarity 0.910)",
    });
  });

  it("C2. matchCount and option-key set unchanged when overriding", async () => {
    matchMemoriesV2Mock.mockResolvedValue({ data: [], error: null });
    await resolveMemoryIdentity({ ...INPUT, candidateMinSimilarity: 0.80 });
    const o = optsOf();
    // matchCount (IDENTITY_CANDIDATE_COUNT) is untouched by the override.
    expect(o.matchCount).toBe(8);
    // Only minSimilarity is affected; the option surface is exactly {minSimilarity, matchCount}.
    expect(Object.keys(o).sort()).toEqual(["matchCount", "minSimilarity"]);
  });
});
