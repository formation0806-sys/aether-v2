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
let capturedUpdateId: string | null = null;
/** Provenance already stored on the pre-existing row, used to prove supersession
 *  preserves it rather than overwriting it with the incoming reflection's. */
const PRE_EXISTING_METADATA = {
  sourceMemoryIds: ["mem-old-1"],
  generatedAt: "2020-01-01T00:00:00.000Z",
};
/**
 * Rows returned by getMemoriesByTitle. The production saveMemory path calls the
 * PLURAL lookup (memory.ts:89) and branches on its LENGTH, so the mock must be
 * array-shaped. It used to provide the singular getMemoryByTitle, which is no
 * longer on the call path, so every assertion here failed before any insert.
 */
let getByTitleRows: Array<{ id: string; content: string }> = [];

vi.mock("@/lib/ai/embeddings/embed", () => ({
  embed: vi.fn(async () => ({
    embedding: Array.from(
      { length: 768 },
      (_, i) => (i % 7) * 0.001 + 0.01
    ),
  })),
}));

/**
 * The supersession branch reads the full existing row through the server
 * Supabase client (memory.ts:123), which needs a request scope a unit test does
 * not have. Stubbed to a chainable client returning one pre-existing row that
 * already carries its own provenance. The repository functions under test stay
 * mocked, so the production saveMemory logic still runs for real.
 */
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              id: "existing-1",
              content: "older and different content",
              // Inlined (not shared with the assertions below) because vi.mock
              // factories execute at import time, before module-level consts are
              // initialized.
              metadata: {
                sourceMemoryIds: ["mem-old-1"],
                generatedAt: "2020-01-01T00:00:00.000Z",
              },
              observation_id: "obs-old",
              created_at: "2020-01-01T00:00:00.000Z",
              source_v2: "reflection",
            },
            error: null,
          }),
        }),
      }),
    }),
  })),
}));

vi.mock("@/lib/repositories/memory.repository", () => ({
  getMemoriesByTitle: vi.fn(async () => ({
    data: getByTitleRows,
    error: null,
  })),
  insertMemoryV2: vi.fn(async (args: Record<string, unknown>) => {
    capturedInsert = args;

    // The supersession path requires the new row id (memory.ts:165-172).
    return { data: { id: "new-1" }, error: null };
  }),
  updateMemoryV2: vi.fn(
    async (id: string, args: Record<string, unknown>) => {
      capturedUpdateId = id;
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
    capturedUpdateId = null;
    getByTitleRows = [];
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

  /**
   * Same-title, different-content writes take the supersession branch
   * (memory.ts:112-203). Under the current design BOTH write paths persist the
   * incoming reflection's provenance on the NEW row via insertMemoryV2; the
   * updateMemoryV2 call only marks the OLD row "merged".
   *
   * This test previously asserted the update carried the incoming metadata.
   * That expectation is superseded and contradicted the documented production
   * intent at memory.ts:120 ("Preserve old content and provenance; do not
   * overwrite old metadata") — writing the new reflection's provenance onto the
   * old row would destroy the old row's provenance. The assertions below encode
   * the real contract and are strictly stronger: they verify the new row's
   * provenance, the old row's provenance preservation, the supersession marker,
   * and the merged status.
   */
  it("supersession path persists new provenance and preserves the old row's", async () => {
    getByTitleRows = [
      { id: "existing-1", content: "older and different content" },
    ];

    await saveMemory(reflectionSaveInput());

    // (1) The NEW row receives the incoming reflection's provenance.
    expect(capturedInsert).not.toBeNull();
    expect(capturedInsert!.metadata).toEqual(METADATA);
    const newMetadata = capturedInsert!.metadata as Record<string, unknown>;
    expect(newMetadata.sourceMemoryIds).toEqual(["mem-src-1", "mem-src-2"]);
    expect(typeof newMetadata.generatedAt).toBe("string");
    expect(Number.isNaN(Date.parse(newMetadata.generatedAt as string))).toBe(
      false
    );

    // (2) The update targets the OLD row and marks it merged.
    expect(capturedUpdate).not.toBeNull();
    expect(capturedUpdateId).toBe("existing-1");
    expect(capturedUpdate!.status).toBe("merged");

    // (3) The OLD row keeps its own provenance and gains the supersession link.
    const oldMetadata = capturedUpdate!.metadata as Record<string, unknown>;
    expect(oldMetadata).toEqual({
      ...PRE_EXISTING_METADATA,
      superseded_by: "new-1",
      supersession_reason: "identity_update",
    });
    expect(oldMetadata.sourceMemoryIds).toEqual(["mem-old-1"]);
  });
});
