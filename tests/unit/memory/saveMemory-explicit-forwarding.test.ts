/// <reference types="vitest" />

import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Phase 6-V.1 — Focused regression test for the explicit-signal forwarding
 * inside `saveMemory()`.
 *
 * Verifies that `input.explicit` actually reaches `scoreExtractedMemory()`
 * (and therefore `importance_v2`), restoring the pre-Phase-6-U behavior that
 * Phase 6-U's refactor silently dropped.
 *
 * External boundaries (embedding model, repository DB writes) are mocked.
 * `scoreExtractedMemory` is used ONLY as an oracle for the expected score so
 * the test never hardcodes the scoring formula. No DB, no network, no
 * production write, no reflector.
 */

let capturedInsert: Record<string, unknown> | null = null;
let getByTitleResult: { data: unknown; error: unknown } = {
  data: null,
  error: null,
};

vi.mock("@/lib/ai/embeddings/embed", () => ({
  embed: vi.fn(async () => ({
    embedding: Array.from(
      { length: 768 },
      (_, i) => (i % 7) * 0.001 + 0.01
    ),
  })),
}));

vi.mock("@/lib/repositories/memory.repository", () => ({
  getMemoryByTitle: vi.fn(async () => getByTitleResult),
  insertMemoryV2: vi.fn(async (args: Record<string, unknown>) => {
    capturedInsert = args;
    return { error: null };
  }),
  updateMemoryV2: vi.fn(async () => ({ error: null })),
  matchMemoriesV2: vi.fn(async () => ({ data: [], error: null })),
}));

import { saveMemory } from "@/lib/memory/memory";
import { scoreExtractedMemory } from "@/lib/memory/score";

const USER = "phase6v1-test-user";
const TITLE = "Phase 6-V.1 regression probe";
const CONTENT = "The user prefers TypeScript and dark mode interfaces.";
const MEMORY_TYPE = "semantic" as const;
const IMPORTANCE = 8;
const CONFIDENCE = 0.9;

function expectedImportance(explicit: boolean): number {
  return scoreExtractedMemory({
    title: TITLE,
    content: CONTENT,
    memoryType: MEMORY_TYPE,
    importance: IMPORTANCE,
    confidence: CONFIDENCE,
    explicit,
  }).importance;
}

describe("Phase 6-V.1: saveMemory forwards explicit into scoring", () => {
  beforeEach(() => {
    capturedInsert = null;
    getByTitleResult = { data: null, error: null };
  });

  it("explicit=true contributes the explicit scoring term", async () => {
    const oracle = expectedImportance(true);

    await saveMemory({
      userId: USER,
      title: TITLE,
      content: CONTENT,
      memoryType: MEMORY_TYPE,
      importance: IMPORTANCE,
      confidence: CONFIDENCE,
      explicit: true,
    });

    expect(capturedInsert).not.toBeNull();
    expect(capturedInsert!.importance_v2).toBeCloseTo(oracle, 5);
  });

  it("explicit omitted does not receive the explicit contribution and scores lower", async () => {
    const explicitScore = expectedImportance(true);
    const omittedScore = expectedImportance(false);

    await saveMemory({
      userId: USER,
      title: TITLE,
      content: CONTENT,
      memoryType: MEMORY_TYPE,
      importance: IMPORTANCE,
      confidence: CONFIDENCE,
    });

    expect(capturedInsert).not.toBeNull();
    expect(capturedInsert!.importance_v2).toBeCloseTo(omittedScore, 5);
    // The explicit flag must make a positive (0.10-weight) difference.
    expect(capturedInsert!.importance_v2).toBeLessThan(explicitScore);
  });
});
