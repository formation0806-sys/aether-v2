/// <reference types="vitest" />

/**
 * Phase 2-C1 — Zero-write verification that a superseded identity memory
 * (status = "merged") cannot re-enter the identity candidate / verifier path.
 *
 * The resolver (lib/memory/identity/identity.ts) is exercised directly with a
 * mocked match_memories_v2 that returns a crafted candidate pool containing a
 * `merged` memory. The test asserts the merged candidate is dropped before the
 * verifier (Ollama) is ever consulted, and that the active memory becomes the
 * current identity. No network, no DB, no production writes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveMemoryIdentity } from "@/lib/memory/identity";

const MOCK_EMBEDDING = Array.from({ length: 768 }, (_, i) => (i % 5) * 0.001 + 0.01);

vi.mock("@/lib/ai/embeddings/embed", () => ({
  embed: vi.fn(async () => ({ embedding: MOCK_EMBEDDING })),
}));

let candidates: Record<string, unknown>[] = [];

vi.mock("@/lib/repositories/memory.repository", () => ({
  matchMemoriesV2: vi.fn(async () => ({ data: candidates, error: null })),
  insertMemoryV2: vi.fn(async () => ({ error: null })),
  updateMemoryV2: vi.fn(async () => ({ error: null })),
  getMemoryByTitle: vi.fn(async () => ({ data: null, error: null })),
  matchMemories: vi.fn(),
  touchMemories: vi.fn(),
}));

const REAL_FETCH = globalThis.fetch;
const verifierBodies: string[] = [];

beforeEach(() => {
  candidates = [];
  verifierBodies.length = 0;
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
});

function candidate(
  id: string,
  content: string,
  status: string,
  similarity: number
): Record<string, unknown> {
  return {
    id,
    title: "Favorite language",
    content,
    memory_type: "identity",
    status,
    similarity,
    effective_score: 0.9,
    confidence: 0.9,
  };
}

describe("Phase 2-C1: merged identity excluded from candidate path", () => {
  it("S1: merged Rust + active Python → only Python verified, becomes current", async () => {
    candidates = [
      candidate("merged-rust", "Rust", "merged", 0.97),
      candidate("active-python", "Python", "active", 0.82),
    ];

    const decision = await resolveMemoryIdentity({
      userId: "u",
      title: "Favorite language",
      content: "Python",
      memoryType: "identity",
    });

    expect(decision.decision).toBe("corroborate");
    expect((decision as { targetId: string }).targetId).toBe("active-python");
    // The merged candidate content must never reach the verifier.
    expect(verifierBodies.some((b) => b.includes("Rust"))).toBe(false);
  });

  it("S2/S3: merged with higher similarity still excluded; active chosen", async () => {
    candidates = [
      candidate("merged-rust", "Rust", "merged", 0.99),
      candidate("active-python", "Python", "active", 0.5),
    ];

    const decision = await resolveMemoryIdentity({
      userId: "u",
      title: "Favorite language",
      content: "Python",
      memoryType: "identity",
    });

    expect(decision.decision).toBe("corroborate");
    expect((decision as { targetId: string }).targetId).toBe("active-python");
    expect(verifierBodies.some((b) => b.includes("Rust"))).toBe(false);
  });

  it("S4: merged-only pool → resolver returns create; merged stays historical", async () => {
    candidates = [candidate("merged-rust", "Rust", "merged", 0.99)];

    const decision = await resolveMemoryIdentity({
      userId: "u",
      title: "Favorite language",
      content: "Go",
      memoryType: "identity",
    });

    expect(decision.decision).toBe("create");
    // No verifier call at all when the merged candidate is the only one.
    expect(verifierBodies.length).toBe(0);
  });
});
