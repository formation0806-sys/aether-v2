/// <reference types="vitest" />

import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Phase 1-A — Reflection provenance persistence contract.
 *
 * Proves that provenance metadata ({ sourceMemoryIds, generatedAt }) flows
 * UNCHANGED through the real `saveMemory()` persistence path into the
 * existing `insertMemoryV2` / `updateMemoryV2` repository calls, and that
 * the write payload uses only pre-existing InsertMemoryV2Input fields —
 * i.e. NO database schema or repository contract change is involved.
 *
 * Boundaries mocked: embedding (valid 768-d vector) + repository.
 * score.ts / constants.ts run for real as the scoring oracle.
 * No DB, no network, no production write.
 */

let capturedInsert: Record<string, unknown> | null = null;
let capturedUpdate: Record<string, unknown> | null = null;
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
  updateMemoryV2: vi.fn(
    async (_id: string, args: Record<string, unknown>) => {
      capturedUpdate = args;
      return { error: null };
    }
  ),
  matchMemoriesV2: vi.fn(async () => ({ data: [], error: null })),
}));

import { saveMemory } from "@/lib/memory/memory";

const USER = "phase1a-provenance-user";
const TITLE = "Dark Interface Preference";
const CONTENT =
  "Multiple memories consistently indicate a preference for dark interfaces.";
const METADATA = {
  sourceMemoryIds: ["mem-src-1", "mem-src-2"],
  generatedAt: "2026-08-29T12:00:00.000Z",
};

/** Every field of the pre-existing InsertMemoryV2Input contract. */
const KNOWN_INSERT_FIELDS = new Set([
  "user_id",
  "title",
  "content",
  "embedding",
  "memory_type",
  "status",
  "summary",
  "tags",
  "importance_v2",
  "confidence_v2",
  "source_v2",
  "source_ref",
  "project_id",
  "observation_id",
  "metadata",
  "effective_score",
  "last_scored",
]);

function reflectionSaveInput() {
  return {
    userId: USER,
    title: TITLE,
    content: CONTENT,
    memoryType: "reflection" as const,
    importance: 6,
    confidence: 0.9,
    source: "reflection" as const,
    sourceRef: null,
    metadata: METADATA,
  };
}

describe("Phase 1-A: reflection provenance persists through the real saveMemory path", () => {
  beforeEach(() => {
    capturedInsert = null;
    capturedUpdate = null;
    getByTitleResult = { data: null, error: null };
  });

  it("TEST 3: insert path persists metadata containing sourceMemoryIds", async () => {
    await saveMemory(reflectionSaveInput());

    expect(capturedInsert).not.toBeNull();
    const metadata = capturedInsert!.metadata as Record<string, unknown>;
    expect(metadata.sourceMemoryIds).toEqual(["mem-src-1", "mem-src-2"]);
  });

  it("TEST 4: sourceMemoryIds carry the actual source memory IDs unchanged", async () => {
    await saveMemory(reflectionSaveInput());

    expect(capturedInsert!.metadata).toEqual(METADATA);
  });

  it("TEST 5: generatedAt is a valid ISO timestamp", async () => {
    await saveMemory(reflectionSaveInput());

    const metadata = capturedInsert!.metadata as Record<string, unknown>;
    expect(typeof metadata.generatedAt).toBe("string");
    expect(
      Number.isNaN(Date.parse(metadata.generatedAt as string))
    ).toBe(false);
    expect(metadata.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("TEST 6: write payload uses only existing InsertMemoryV2Input fields", async () => {
    await saveMemory(reflectionSaveInput());

    expect(capturedInsert).not.toBeNull();
    for (const key of Object.keys(capturedInsert!)) {
      expect(KNOWN_INSERT_FIELDS.has(key)).toBe(true);
    }
  });

  it("update path (same-title reflection) also persists provenance metadata", async () => {
    getByTitleResult = {
      data: { id: "existing-1", content: "older and different content" },
      error: null,
    };

    await saveMemory(reflectionSaveInput());

    expect(capturedUpdate).not.toBeNull();
    expect(capturedUpdate!.metadata).toEqual(METADATA);
  });
});
