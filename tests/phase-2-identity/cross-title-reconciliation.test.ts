/// <reference types="vitest" />

import { describe, it, expect, vi, beforeEach } from "vitest";
import { evaluateLifecycle } from "@/lib/memory/lifecycle";
import * as memoryRepository from "@/lib/repositories/memory.repository";
import * as supabaseServer from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Mutable mock state — configured per test
// ---------------------------------------------------------------------------
let mockEdges: Array<{ source_id: string; target_id: string }> = [];
let mockReconcileMemories: any[] = [];
const capturedUpdates: Array<{ id: string; data: any }> = [];

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock("@/lib/repositories/memory.repository", () => ({
  getMemoriesForLifecycle: vi.fn(),
  batchUpdateLifecycle: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Hermetic Supabase client mock.
//
// reconcileContradictions() performs, in order:
//   1. from("memory_edges").select(...).eq(...).eq(...)        -> edges
//   2. from("memories").select(...).in("id", [...])            -> memories
//   3. from("memories").update({...}).eq("id", loserId)        -> write
// evaluateLifecycle() performs:
//   getMemoriesForLifecycle() (mocked separately)
// ---------------------------------------------------------------------------
function buildSupabaseMock() {
  const client: any = {
    from(table: string) {
      return {
        select() {
          const builder: any = {
            eq: () => builder,
            in: () => builder,
            async then(resolve: (v: any) => any) {
              if (table === "memory_edges") {
                return resolve({ data: mockEdges, error: null });
              }
              if (table === "memories") {
                return resolve({ data: mockReconcileMemories, error: null });
              }
              return resolve({ data: [], error: null });
            },
          };
          return builder;
        },
        update(data: any) {
          const builder: any = {
            eq: (_col: string, val: any) => {
              capturedUpdates.push({ id: val, data });
              return builder;
            },
            async then(resolve: (v: any) => any) {
              return resolve({ data: null, error: null });
            },
          };
          return builder;
        },
        insert() {
          const builder: any = {
            async then(resolve: (v: any) => any) {
              return resolve({ data: null, error: null });
            },
          };
          return builder;
        },
      };
    },
  };
  return client;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeMemory = (overrides: Partial<{
  id: string;
  memory_type: string;
  status: string;
  effective_score: number;
  times_used: number;
  created_at: string;
  metadata: Record<string, unknown>;
}>) => ({
  id: overrides.id ?? "mem",
  memory_type: overrides.memory_type ?? "identity",
  status: overrides.status ?? "active",
  effective_score: overrides.effective_score ?? 0.8,
  times_used: overrides.times_used ?? 10,
  created_at: overrides.created_at ?? "2024-01-01T00:00:00.000Z",
  metadata: overrides.metadata ?? {},
});

describe("Cross-Title Contradiction Reconciliation (C3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEdges = [];
    mockReconcileMemories = [];
    capturedUpdates.length = 0;
    vi.mocked(supabaseServer.createClient).mockResolvedValue(buildSupabaseMock());
    vi.mocked(memoryRepository.getMemoriesForLifecycle).mockResolvedValue({ data: [], error: null } as any);
    vi.mocked(memoryRepository.batchUpdateLifecycle).mockResolvedValue({ data: null, error: null } as any);
  });

  // R1: Baseline parity - existing identity behavior remains green.
  // With no contradiction edges, evaluateLifecycle must not reconcile anything.
  it("R1: baseline parity - no contradiction edge, no reconciliation", async () => {
    mockEdges = [];
    mockReconcileMemories = [];

    const result = await evaluateLifecycle("user_123");

    expect(result.transitions).toHaveLength(0);
    expect(capturedUpdates).toHaveLength(0);
  });

  // R2: Gate-pass case - contradiction edge with all four safety conditions met.
  // Older memory = loser, newer (higher score, more used) = winner.
  it("R2: gate-pass case - contradiction edge with proper safety conditions", async () => {
    // source = loser (older), target = winner (newer)
    mockEdges = [{ source_id: "mem_loser", target_id: "mem_winner" }];
    mockReconcileMemories = [
      makeMemory({ id: "mem_loser", memory_type: "identity", status: "active", effective_score: 0.7, times_used: 10, created_at: "2024-01-01T00:00:00.000Z" }),
      makeMemory({ id: "mem_winner", memory_type: "identity", status: "active", effective_score: 0.95, times_used: 50, created_at: "2024-03-01T00:00:00.000Z" }),
    ];

    const result = await evaluateLifecycle("user_123");

    // Lifecycle produced no status transitions of its own (memories stable)
    expect(result.transitions).toHaveLength(0);

    // Exactly one supersession write targeting the loser
    expect(capturedUpdates).toHaveLength(1);
    expect(capturedUpdates[0].id).toBe("mem_loser");
    expect(capturedUpdates[0].data.status).toBe("merged");
    expect(capturedUpdates[0].data.metadata.superseded_by).toBe("mem_winner");
    expect(capturedUpdates[0].data.metadata.supersession_reason).toBe("identity_update");
  });

  // R3: No contradiction edge - no-op, no updateMemoryV2 equivalent write.
  it("R3: no contradiction edge - no reconciliation, no write", async () => {
    mockEdges = [];
    mockReconcileMemories = [
      makeMemory({ id: "mem_a", memory_type: "identity", status: "active", effective_score: 0.9, times_used: 10, created_at: "2024-01-01T00:00:00.000Z" }),
      makeMemory({ id: "mem_b", memory_type: "identity", status: "active", effective_score: 0.8, times_used: 5, created_at: "2024-02-01T00:00:00.000Z" }),
    ];

    const result = await evaluateLifecycle("user_123");

    expect(result.transitions).toHaveLength(0);
    expect(capturedUpdates).toHaveLength(0);
  });

  // R4: One target already merged - no resurrection, C1 behavior preserved.
  it("R4: merged target - no reconciliation, no resurrection", async () => {
    // Both ends of the edge must be active; target is already merged -> skip.
    mockEdges = [{ source_id: "mem_active", target_id: "mem_merged" }];
    mockReconcileMemories = [
      makeMemory({ id: "mem_active", memory_type: "identity", status: "active", effective_score: 0.9, times_used: 10, created_at: "2024-01-01T00:00:00.000Z" }),
      makeMemory({ id: "mem_merged", memory_type: "identity", status: "merged", effective_score: 0.95, times_used: 50, created_at: "2024-03-01T00:00:00.000Z" }),
    ];

    const result = await evaluateLifecycle("user_123");

    expect(result.transitions).toHaveLength(0);
    expect(capturedUpdates).toHaveLength(0);
  });

  // R5: False-positive protection - older memory has HIGHER times_used.
  // Condition 4 (winner.times_used > loser.times_used) fails -> no supersession.
  it("R5: false-positive protection - older memory has higher times_used", async () => {
    // source = loser (older, lower score, BUT higher times_used)
    mockEdges = [{ source_id: "mem_loser", target_id: "mem_winner" }];
    mockReconcileMemories = [
      makeMemory({ id: "mem_loser", memory_type: "identity", status: "active", effective_score: 0.7, times_used: 50, created_at: "2024-01-01T00:00:00.000Z" }),
      makeMemory({ id: "mem_winner", memory_type: "identity", status: "active", effective_score: 0.95, times_used: 5, created_at: "2024-03-01T00:00:00.000Z" }),
    ];

    const result = await evaluateLifecycle("user_123");

    expect(result.transitions).toHaveLength(0);
    expect(capturedUpdates).toHaveLength(0);
  });

  // R6: Equal times_used - condition 4 fails -> no supersession.
  it("R6: equal times_used - no supersession", async () => {
    mockEdges = [{ source_id: "mem_loser", target_id: "mem_winner" }];
    mockReconcileMemories = [
      makeMemory({ id: "mem_loser", memory_type: "identity", status: "active", effective_score: 0.7, times_used: 10, created_at: "2024-01-01T00:00:00.000Z" }),
      makeMemory({ id: "mem_winner", memory_type: "identity", status: "active", effective_score: 0.95, times_used: 10, created_at: "2024-03-01T00:00:00.000Z" }),
    ];

    const result = await evaluateLifecycle("user_123");

    expect(result.transitions).toHaveLength(0);
    expect(capturedUpdates).toHaveLength(0);
  });

  // R7: Zero-write validation - no real production database writes.
  // Every DB op is mocked; with no edges, reconciliation issues zero writes.
  it("R7: zero-write validation - no real production database writes", async () => {
    mockEdges = [];
    mockReconcileMemories = [];

    const result = await evaluateLifecycle("user_123");

    expect(result.transitions).toHaveLength(0);
    // No supersession/merge write was issued against the database.
    expect(capturedUpdates).toHaveLength(0);
    // The mocked client was used (hermetic), never a real Supabase connection.
    expect(supabaseServer.createClient).toHaveBeenCalled();
  });
});
