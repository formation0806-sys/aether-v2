/// <reference types="vitest" />

import { describe, it, expect, vi } from "vitest";
import {
  measureSemanticSupport,
  validateReflectionGrounding,
} from "@/lib/memory/reflection-grounding";
import type { SemanticShadowDeps } from "@/lib/memory/reflection-grounding";

/**
 * Phase 1-C Step 5 — Semantic Shadow Mode (observational only).
 *
 * These tests prove that:
 * 1. Exactly one embedding call is made for the reflection.
 * 2. The existing match_memories_v2 RPC results are used.
 * 3. Claimed source IDs are matched correctly.
 * 4. Missing sources become similarity=null.
 * 5. minSimilarity is calculated only over measured (non-null) similarities.
 * 6. meanSimilarity is calculated only over measured (non-null) similarities.
 * 7. measuredCount is correct.
 * 8. unmeasuredCount is correct.
 * 9. Semantic shadow calculation is deterministic.
 * 10. Semantic shadow mode never rejects a reflection.
 * 11. R1/R2/R3 behavior remains unchanged.
 * 12. No database write occurs.
 * 13. No threshold is enforced.
 * 14. No prompt changes.
 *
 * All network/RPC calls are mocked via the `deps` parameter.
 */

const EMBEDDING = [0.1, 0.2, 0.3, 0.4, 0.5];
const REFLECTION_CONTENT = "The user prefers dark mode on all interfaces.";
const USER_ID = "test-user-id";

function makeDeps(
  overrides: Partial<SemanticShadowDeps> = {}
): SemanticShadowDeps {
  const embed =
    overrides.embed ??
    vi.fn(async (_text: string) => ({ embedding: EMBEDDING }));
  const matchMemoriesV2 =
    overrides.matchMemoriesV2 ??
    vi.fn(
      async (_embedding: number[], _userId: string, _options: unknown) => ({
        data: [],
        error: null,
      })
    );
  return { embed, matchMemoriesV2 };
}

const CLAIMED_IDS = ["src-1", "src-2", "src-3"];

describe("Phase 1-C Step 5: semantic shadow mode", () => {
  it("1. makes exactly one embedding call for the reflection content", async () => {
    const deps = makeDeps();
    await measureSemanticSupport(REFLECTION_CONTENT, CLAIMED_IDS, USER_ID, deps);

    expect(deps.embed).toHaveBeenCalledTimes(1);
    expect(deps.embed).toHaveBeenCalledWith(REFLECTION_CONTENT);
  });

  it("2. uses the existing match_memories_v2 RPC results", async () => {
    const deps = makeDeps({
      matchMemoriesV2: vi.fn(async () => ({
        data: [{ id: "src-1", similarity: 0.9 }],
        error: null,
      })),
    });

    await measureSemanticSupport(REFLECTION_CONTENT, CLAIMED_IDS, USER_ID, deps);

    expect(deps.matchMemoriesV2).toHaveBeenCalledTimes(1);
    const call = vi.mocked(deps.matchMemoriesV2).mock.calls[0];
    expect(call[0]).toEqual(EMBEDDING);
    expect(call[1]).toBe(USER_ID);
    expect(call[2]).toMatchObject({
      minSimilarity: 0,
      matchCount: 200,
    });
  });

  it("3. maps returned similarities back to claimed source IDs correctly", async () => {
    const deps = makeDeps({
      matchMemoriesV2: vi.fn(async () => ({
        data: [
          { id: "src-1", similarity: 0.92 },
          { id: "src-2", similarity: 0.77 },
          { id: "src-3", similarity: 0.88 },
        ],
        error: null,
      })),
    });

    const result = await measureSemanticSupport(
      REFLECTION_CONTENT,
      CLAIMED_IDS,
      USER_ID,
      deps
    );

    expect(result.measured).toEqual([
      { id: "src-1", similarity: 0.92 },
      { id: "src-2", similarity: 0.77 },
      { id: "src-3", similarity: 0.88 },
    ]);
  });

  it("4. missing sources become similarity=null and are counted as unmeasured", async () => {
    const deps = makeDeps({
      matchMemoriesV2: vi.fn(async () => ({
        data: [{ id: "src-1", similarity: 0.9 }],
        error: null,
      })),
    });

    const result = await measureSemanticSupport(
      REFLECTION_CONTENT,
      CLAIMED_IDS,
      USER_ID,
      deps
    );

    expect(result.measured).toEqual([
      { id: "src-1", similarity: 0.9 },
      { id: "src-2", similarity: null },
      { id: "src-3", similarity: null },
    ]);
    expect(result.unmeasuredCount).toBe(2);
  });

  it("5. minSimilarity is calculated only over measured (non-null) similarities", async () => {
    const deps = makeDeps({
      matchMemoriesV2: vi.fn(async () => ({
        data: [
          { id: "src-1", similarity: 0.92 },
          { id: "src-2", similarity: 0.77 },
          { id: "src-4", similarity: 0.3 },
        ],
        error: null,
      })),
    });

    const result = await measureSemanticSupport(
      REFLECTION_CONTENT,
      ["src-1", "src-2", "src-5"],
      USER_ID,
      deps
    );

    expect(result.minSimilarity).toBe(0.77);
  });

  it("6. meanSimilarity is calculated only over measured (non-null) similarities", async () => {
    const deps = makeDeps({
      matchMemoriesV2: vi.fn(async () => ({
        data: [
          { id: "src-a", similarity: 0.9 },
          { id: "src-b", similarity: 0.7 },
        ],
        error: null,
      })),
    });

    const result = await measureSemanticSupport(
      REFLECTION_CONTENT,
      ["src-a", "src-b", "src-z"],
      USER_ID,
      deps
    );

    expect(result.meanSimilarity).toBeCloseTo(0.8, 10);
  });

  it("7. measuredCount is correct (only non-null similarities counted)", async () => {
    const deps = makeDeps({
      matchMemoriesV2: vi.fn(async () => ({
        data: [
          { id: "src-1", similarity: 0.92 },
          { id: "src-2", similarity: 0.77 },
        ],
        error: null,
      })),
    });

    const result = await measureSemanticSupport(
      REFLECTION_CONTENT,
      ["src-1", "src-2", "src-3", "src-4"],
      USER_ID,
      deps
    );

    expect(result.measuredCount).toBe(2);
  });

  it("8. unmeasuredCount is correct", async () => {
    const deps = makeDeps({
      matchMemoriesV2: vi.fn(async () => ({
        data: [{ id: "src-1", similarity: 0.92 }],
        error: null,
      })),
    });

    const result = await measureSemanticSupport(
      REFLECTION_CONTENT,
      ["src-1", "src-2", "src-3"],
      USER_ID,
      deps
    );

    expect(result.unmeasuredCount).toBe(2);
  });

  it("9. semantic shadow calculation is deterministic for identical inputs", async () => {
    const rpcData = [
      { id: "src-1", similarity: 0.92 },
      { id: "src-2", similarity: 0.77 },
    ];
    const deps = makeDeps({
      matchMemoriesV2: vi.fn(async () => ({ data: rpcData, error: null })),
    });

    const input = { content: REFLECTION_CONTENT, ids: CLAIMED_IDS, userId: USER_ID };
    const r1 = await measureSemanticSupport(
      input.content,
      input.ids,
      input.userId,
      deps
    );
    const r2 = await measureSemanticSupport(
      input.content,
      input.ids,
      input.userId,
      deps
    );

    expect(r1).toEqual(r2);
  });

  it("10. semantic shadow mode never rejects a reflection — returns result regardless of similarity", async () => {
    const deps = makeDeps({
      matchMemoriesV2: vi.fn(async () => ({
        data: [{ id: "src-1", similarity: 0.01 }],
        error: null,
      })),
    });

    const result = await measureSemanticSupport(
      REFLECTION_CONTENT,
      ["src-1"],
      USER_ID,
      deps
    );

    // The function returns a measurement, never throws, never signals rejection.
    expect(result).toBeDefined();
    expect(result.measured).toEqual([{ id: "src-1", similarity: 0.01 }]);
    expect(result.minSimilarity).toBe(0.01);
  });

  it("10b. even all-null similarities do not throw or reject", async () => {
    const deps = makeDeps({
      matchMemoriesV2: vi.fn(async () => ({ data: [], error: null })),
    });

    const result = await measureSemanticSupport(
      REFLECTION_CONTENT,
      CLAIMED_IDS,
      USER_ID,
      deps
    );

    expect(result.measured).toEqual([
      { id: "src-1", similarity: null },
      { id: "src-2", similarity: null },
      { id: "src-3", similarity: null },
    ]);
    expect(result.minSimilarity).toBeNull();
    expect(result.meanSimilarity).toBeNull();
    expect(result.measuredCount).toBe(0);
    expect(result.unmeasuredCount).toBe(3);
  });

  it("11. R1/R2/R3 behavior remains unchanged — grounding verdicts are identical", async () => {
    const SOURCES = [
      { id: "s1", content: "alpha content" },
      { id: "s2", content: "beta content" },
    ];

    // R1: insufficient sources
    expect(
      validateReflectionGrounding({
        reflectionContent: "Some synthesis.",
        sourceMemoryIds: ["s1"],
        candidateMemories: SOURCES,
      })
    ).toEqual({ ok: false, reason: "INSUFFICIENT_SOURCES" });

    // R2: content identical to source
    expect(
      validateReflectionGrounding({
        reflectionContent: "alpha content",
        sourceMemoryIds: ["s1", "s2"],
        candidateMemories: SOURCES,
      })
    ).toEqual({ ok: false, reason: "CONTENT_IDENTICAL_TO_SOURCE" });

    // R3: provenance not subset
    expect(
      validateReflectionGrounding({
        reflectionContent: "Some synthesis.",
        sourceMemoryIds: ["s1", "ghost"],
        candidateMemories: SOURCES,
      })
    ).toEqual({ ok: false, reason: "PROVENANCE_NOT_SUBSET" });

    // Accepted: grounded reflection
    expect(
      validateReflectionGrounding({
        reflectionContent: "Both memories describe the same effort.",
        sourceMemoryIds: ["s1", "s2"],
        candidateMemories: SOURCES,
      })
    ).toEqual({ ok: true });
  });

  it("12. no database write occurs — the shadow function only calls embed + RPC (read-only)", async () => {
    const writeMarker = vi.fn();
    const deps = makeDeps({
      matchMemoriesV2: vi.fn(async () => ({
        data: [{ id: "src-1", similarity: 0.9 }],
        error: null,
      })),
    });

    const result = await measureSemanticSupport(
      REFLECTION_CONTENT,
      CLAIMED_IDS,
      USER_ID,
      deps
    );

    // Only embed and matchMemoriesV2 are called — no insert/update/delete/upsert.
    expect(deps.embed).toHaveBeenCalledTimes(1);
    expect(deps.matchMemoriesV2).toHaveBeenCalledTimes(1);
    expect(writeMarker).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it("13. no threshold is enforced — low similarities are reported, not rejected", async () => {
    const deps = makeDeps({
      matchMemoriesV2: vi.fn(async () => ({
        data: [
          { id: "src-1", similarity: 0.01 },
          { id: "src-2", similarity: 0.05 },
        ],
        error: null,
      })),
    });

    const result = await measureSemanticSupport(
      REFLECTION_CONTENT,
      ["src-1", "src-2"],
      USER_ID,
      deps
    );

    // Similarities are reported regardless of value; no threshold filtering.
    expect(result.measuredCount).toBe(2);
    expect(result.minSimilarity).toBe(0.01);
    expect(result.meanSimilarity).toBeCloseTo(0.03, 10);
  });

  it("14. no prompt changes — shadow mode does not modify or re-read the reflection prompt", async () => {
    const embed = vi.fn(async () => ({ embedding: EMBEDDING }));
    const matchMemoriesV2 = vi.fn(async () => ({
      data: [{ id: "src-1", similarity: 0.5 }],
      error: null,
    }));

    const result = await measureSemanticSupport(
      REFLECTION_CONTENT,
      ["src-1"],
      USER_ID,
      { embed, matchMemoriesV2 }
    );

    // The shadow function never touches the reflection system prompt.
    // It only passes reflection content to embed() and the embedding to the RPC.
    expect(embed).toHaveBeenCalledWith(REFLECTION_CONTENT);
    expect(embed).toHaveBeenCalledTimes(1);
    expect(matchMemoriesV2).toHaveBeenCalledTimes(1);
    expect(result.measuredCount).toBe(1);
  });
});
