/// <reference types="vitest" />

/**
 * Phase 2-C2 — Cross-title conflict flagging (FINAL production contract).
 *
 * The ORIGINAL C2 detector design (detectCrossTitleConflicts /
 * lexicalContradictionHeuristic / ConflictDeps injected into
 * resolveMemoryIdentity) was ABORTED during Phase 2 planning because it
 * consumed the production verifier's responses and caused 7 regressions —
 * see tests/phase-2-identity/phase-2-c2-design.md ("Production code status:
 * NONE WRITTEN"). Those symbols do NOT exist in production and MUST NOT be
 * recreated. The S1–S6 detector scenarios remain historical design material
 * only, documented in that file.
 *
 * The final C2 contract is a flag-only contradiction observer:
 *   - lib/memory/conflict.ts::flagContradiction(...) writes a single
 *     memory_edges row (relation = 'contradicts') and is fail-safe
 *     (never throws).
 *   - Identity resolution (resolveMemoryIdentity via lib/memory/identity.ts)
 *     is an independent decision layer: it never invokes flagContradiction
 *     and never writes a contradiction edge (identity resolution ≠ C2
 *     flagging).
 *   - C3 reconciliation (evaluateLifecycle → reconcileContradictions) is
 *     implemented, FROZEN, and covered separately by
 *     cross-title-reconciliation.test.ts.
 *
 * Safety invariants enforced here:
 *   - ZERO production writes: all Supabase access is mocked; no real
 *     memory_edges insert can occur.
 *   - Identity resolver behavior, verifier ordering, prompts, and thresholds
 *     are unchanged; the resolver's single-argument signature is exercised
 *     as-is.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveMemoryIdentity } from "@/lib/memory/identity";
import * as conflictModule from "@/lib/memory/conflict";

const MOCK_EMBEDDING = Array.from({ length: 768 }, (_, i) => (i % 5) * 0.001 + 0.01);

// --- Mock the embedding + retrieval layer (read-only by code inspection) ---
vi.mock("@/lib/ai/embeddings/embed", () => ({
  embed: vi.fn(async () => ({ embedding: MOCK_EMBEDDING })),
}));

vi.mock("@/lib/repositories/memory.repository", () => ({
  matchMemoriesV2: vi.fn(async () => ({ data: candidates, error: null })),
  insertMemoryV2: vi.fn(async () => ({ error: null })),
  updateMemoryV2: vi.fn(async () => ({ error: null })),
  getMemoryByTitle: vi.fn(async () => ({ data: null, error: null })),
  matchMemories: vi.fn(),
  touchMemories: vi.fn(),
}));

// --- Mock Supabase server client so no real network/write can occur ---
// flagContradiction is the ONLY production write path exercised by this
// suite; its memory_edges insert is captured here for hermetic assertions.
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => ({
      insert: vi.fn(async (row: unknown) => {
        memoryEdgeInserts.push({ table, row });
        if (memoryEdgeInsertThrows) throw new Error("mock insert failure");
        return { error: memoryEdgeInsertError, data: null };
      }),
    }),
  })),
}));

// --- Hermetic module-level mock state (reset in beforeEach) ---
let candidates: Record<string, unknown>[] = [];
let memoryEdgeInserts: Array<{ table: string; row: unknown }> = [];
let memoryEdgeInsertError: unknown = null;
let memoryEdgeInsertThrows = false;

const REAL_FETCH = globalThis.fetch;
const verifierBodies: string[] = [];

beforeEach(() => {
  candidates = [];
  memoryEdgeInserts = [];
  memoryEdgeInsertError = null;
  memoryEdgeInsertThrows = false;
  verifierBodies.length = 0;
  vi.clearAllMocks();

  globalThis.fetch = (async (input: RequestInfo | URL | undefined, init?: RequestInit) => {
    const url = input ? (typeof input === "string" ? input : input.toString()) : "";
    if (url.includes("/api/chat")) {
      if (init?.body) verifierBodies.push(String(init.body));
      return {
        ok: true,
        json: async () => ({ message: { content: '{"decision":"SAME","reason":"mock"}' } }),
      } as unknown as Response;
    }
    if (url.includes("/api/embed")) {
      return {
        ok: true,
        json: async () => ({ embeddings: [MOCK_EMBEDDING] }),
      } as unknown as Response;
    }
    return REAL_FETCH(input as RequestInfo | URL, init as RequestInit);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  vi.restoreAllMocks();
});

function candidate(
  id: string,
  title: string,
  content: string,
  memoryType = "identity",
  status = "active",
  similarity = 0.9
): Record<string, unknown> {
  return {
    id,
    title,
    content,
    memory_type: memoryType,
    status,
    similarity,
    effective_score: 0.9,
    confidence: 0.9,
    times_used: 3,
    last_used: null,
  };
}

/* ================= 1: flagContradiction write contract ================= */

describe("Phase 2-C2 / 1 — flagContradiction write contract", () => {
  it("writes a single memory_edges row with relation 'contradicts'", async () => {
    await conflictModule.flagContradiction("u", "source-id", "target-id");

    expect(memoryEdgeInserts).toHaveLength(1);
    expect(memoryEdgeInserts[0].table).toBe("memory_edges");
    expect(memoryEdgeInserts[0].row).toEqual({
      user_id: "u",
      source_id: "source-id",
      target_id: "target-id",
      relation: "contradicts",
    });
  });

  it("resolves to undefined on success", async () => {
    const result = await conflictModule.flagContradiction("u", "a", "b");
    expect(result).toBeUndefined();
  });
});

/* ================= 2: flagContradiction fail-safe behavior ================= */

describe("Phase 2-C2 / 2 — flagContradiction is fail-safe", () => {
  it("does not throw when the insert returns { error }", async () => {
    memoryEdgeInsertError = { message: "db denied" };

    await expect(
      conflictModule.flagContradiction("u", "a", "b")
    ).resolves.toBeUndefined();
    expect(memoryEdgeInserts).toHaveLength(1);
  });

  it("does not throw when the insert throws", async () => {
    memoryEdgeInsertThrows = true;

    await expect(
      conflictModule.flagContradiction("u", "a", "b")
    ).resolves.toBeUndefined();
  });
});

/* ================= 3: identity isolation (resolveMemoryIdentity) ================= */

describe("Phase 2-C2 / 3 — identity resolution is isolated from C2 flagging", () => {
  it("single-argument resolveMemoryIdentity resolves corroborate and never flags", async () => {
    const flagSpy = vi.spyOn(conflictModule, "flagContradiction");

    candidates = [
      candidate("a1", "Favorite language", "Python", "identity", "active", 0.95),
      candidate("a2", "Preferred language", "Python", "identity", "active", 0.92),
    ];

    const decision = await resolveMemoryIdentity({
      userId: "u",
      title: "Favorite language",
      content: "Python",
      memoryType: "identity",
    });

    // Clean all-SAME pool -> corroborate the canonical (highest similarity) candidate.
    expect(decision.decision).toBe("corroborate");
    expect((decision as { targetId: string }).targetId).toBe("a1");

    // Verifier consulted exactly once per candidate (resolver behavior unchanged).
    expect(verifierBodies.length).toBe(2);

    // Identity resolution never touches the C2 flag path.
    expect(flagSpy).not.toHaveBeenCalled();
  });

  it("keeps identity independence when the pool is contradiction-shaped", async () => {
    const flagSpy = vi.spyOn(conflictModule, "flagContradiction");

    candidates = [
      candidate("c1", "Current city", "I live in London", "identity", "active", 0.95),
      candidate("c2", "Home city", "I live in Paris", "identity", "active", 0.93),
    ];

    const decision = await resolveMemoryIdentity({
      userId: "u",
      title: "Current city",
      content: "I live in London",
      memoryType: "identity",
    });

    // The decision layer resolves independently; it never flags contradictions.
    expect(decision.decision).toBe("corroborate");
    expect(flagSpy).not.toHaveBeenCalled();
  });
});

/* ================= 4: zero C2 writes during identity resolution ================= */

describe("Phase 2-C2 / 4 — identity resolution performs zero C2 writes", () => {
  it("never writes a contradiction edge while resolving", async () => {
    const flagSpy = vi.spyOn(conflictModule, "flagContradiction");

    candidates = [
      candidate("d4a", "Current city", "I live in London", "identity", "active", 0.95),
      candidate("d4b", "Home city", "I live in Paris", "identity", "active", 0.93),
    ];

    const decision = await resolveMemoryIdentity({
      userId: "u",
      title: "Current city",
      content: "I live in London",
      memoryType: "identity",
    });

    expect(decision.decision).toBe("corroborate");
    expect(flagSpy).not.toHaveBeenCalled();
    // No memory_edges insert was captured from the mocked Supabase client.
    expect(memoryEdgeInserts).toHaveLength(0);
    // Resolver consumed exactly 2 verifier calls (no detector leg added).
    expect(verifierBodies.length).toBe(2);
  });
});

/* ================= 5: determinism / baseline parity ================= */

describe("Phase 2-C2 / 5 — determinism / baseline parity", () => {
  it("repeated single-argument resolution yields identical decision, target, and verifier count", async () => {
    candidates = [
      candidate("d5a", "Favorite language", "Python", "identity", "active", 0.95),
      candidate("d5b", "Preferred language", "Python", "identity", "active", 0.92),
    ];

    const run = async () => {
      const decision = await resolveMemoryIdentity({
        userId: "u",
        title: "Favorite language",
        content: "Python",
        memoryType: "identity",
      });
      return { decision };
    };

    const r1 = await run();
    const verifierAfterFirst = verifierBodies.length;
    const r2 = await run();

    expect(r1.decision.decision).toBe("corroborate");
    expect((r1.decision as { targetId: string }).targetId).toBe("d5a");
    expect(r2.decision).toEqual(r1.decision);
    // Identical mocked inputs -> identical verifier consumption per run.
    expect(verifierAfterFirst).toBe(2);
    expect(verifierBodies.length).toBe(4);
    // No C2 flag / edge write across repeated runs.
    expect(memoryEdgeInserts).toHaveLength(0);
  });
});
