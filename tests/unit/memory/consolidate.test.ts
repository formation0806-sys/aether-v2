/// <reference types="vitest" />

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the repository module entirely (no DB).
const getMemoriesByIds = vi.fn();
const consolidateMemories = vi.fn();
vi.mock("@/lib/repositories/memory.repository", () => ({
  getMemoriesByIds: (...args: unknown[]) => getMemoriesByIds(...args),
  consolidateMemories: (...args: unknown[]) => consolidateMemories(...args),
}));

import {
  selectConsolidationCanonical,
  consolidateMemoryPool,
} from "@/lib/memory/consolidate";

function row(over: Record<string, unknown> = {}) {
  return {
    id: "id-" + Math.random().toString(36).slice(2),
    memoryType: "project",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    effectiveScore: 0.5,
    confidence: 0.9,
    timesUsed: 0,
    lastUsed: null,
    title: "t",
    content: "c",
    observationId: null,
    sourceV2: "extractor",
    ...over,
  };
}

describe("selectConsolidationCanonical", () => {
  it("prefers highest times_used", () => {
    const a = row({ id: "a", timesUsed: 0, createdAt: "2026-01-01T00:00:00Z" });
    const b = row({ id: "b", timesUsed: 5, createdAt: "2026-01-02T00:00:00Z" });
    expect(selectConsolidationCanonical([a, b])).toBe("b");
  });

  it("breaks times_used ties by effective_score DESC", () => {
    const a = row({ id: "a", timesUsed: 0, effectiveScore: 0.3, createdAt: "2026-01-01T00:00:00Z" });
    const b = row({ id: "b", timesUsed: 0, effectiveScore: 0.7, createdAt: "2026-01-02T00:00:00Z" });
    expect(selectConsolidationCanonical([a, b])).toBe("b");
  });

  it("breaks effective_score ties by confidence DESC", () => {
    const a = row({ id: "a", timesUsed: 0, effectiveScore: 0.5, confidence: 0.3, createdAt: "2026-01-01T00:00:00Z" });
    const b = row({ id: "b", timesUsed: 0, effectiveScore: 0.5, confidence: 0.7, createdAt: "2026-01-02T00:00:00Z" });
    expect(selectConsolidationCanonical([a, b])).toBe("b");
  });

it("ties fall through to confidence DESC then id ASC (deterministic)", () => {
    const first = row({ id: "z", timesUsed: 0, effectiveScore: 0.5, confidence: 0.5, createdAt: "2026-01-01T00:00:00Z" });
    const second = row({ id: "a", timesUsed: 0, effectiveScore: 0.5, confidence: 0.5, createdAt: "2026-01-02T00:00:00Z" });
    // Since timesUsed, effectiveScore, and confidence are all equal, should fall through to id ASC
    expect(selectConsolidationCanonical([second, first])).toBe("a");
  });

  it("returns null for empty pool", () => {
    expect(selectConsolidationCanonical([])).toBeNull();
  });
});

describe("consolidateMemoryPool (decision + gate, mocked RPC)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a pool smaller than two members", async () => {
    const res = await consolidateMemoryPool({ userId: "u", memberIds: ["a"] });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("need_at_least_two_members");
    expect(consolidateMemories).not.toHaveBeenCalled();
  });

  it("rejects when a member is missing from the store", async () => {
    getMemoriesByIds.mockResolvedValue([row({ id: "a" })]);
    const res = await consolidateMemoryPool({ userId: "u", memberIds: ["a", "b"] });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("member_not_found");
    expect(consolidateMemories).not.toHaveBeenCalled();
  });

  it("rejects mixed memory types without calling the verifier/RPC", async () => {
    getMemoriesByIds.mockResolvedValue([
      row({ id: "a", memoryType: "project" }),
      row({ id: "b", memoryType: "identity" }),
    ]);
    const res = await consolidateMemoryPool({ userId: "u", memberIds: ["a", "b"] });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("mixed_memory_type");
    expect(consolidateMemories).not.toHaveBeenCalled();
  });

  it("aborts the whole batch if any member is not SAME (verifier UNCERTAIN)", async () => {
    const keep = row({ id: "a", content: "Aether uses Next.js and Supabase." });
    const other = row({ id: "b", content: "Aether uses Next.js and Supabase." });
    getMemoriesByIds.mockResolvedValue([keep, other]);
    // Force verifier to UNCERTAIN for the non-canonical member.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ message: { content: '{"decision":"UNCERTAIN"}' } }),
      }))
    );
    const res = await consolidateMemoryPool({ userId: "u", memberIds: ["a", "b"] });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("non_same_member");
    expect(consolidateMemories).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("invokes the RPC when all members verify SAME", async () => {
    const keep = row({ id: "a", content: "Aether uses Next.js and Supabase." });
    const other = row({ id: "b", content: "Aether uses Next.js and Supabase." });
    getMemoriesByIds.mockResolvedValue([keep, other]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ message: { content: '{"decision":"SAME"}' } }),
      }))
    );
    consolidateMemories.mockResolvedValue({
      ok: true,
      canonicalId: "a",
      merged: ["b"],
      consolidationId: "cid",
    });
    const res = await consolidateMemoryPool({ userId: "u", memberIds: ["a", "b"] });
    expect(res.ok).toBe(true);
    expect(res.canonicalId).toBe("a");
    expect(res.merged).toEqual(["b"]);
    expect(consolidateMemories).toHaveBeenCalledWith({
      userId: "u",
      keepId: "a",
      mergeIds: ["b"],
    });
    vi.unstubAllGlobals();
  });
});
