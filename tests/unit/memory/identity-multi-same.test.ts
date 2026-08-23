/// <reference types="vitest" />

/**
 * Phase 6-AL — Identity multi-SAME policy unit matrix.
 *
 * Covers the approved plan §17 items 1–24 against `resolveMemoryIdentity`
 * with mocked embed / matchMemoriesV2 / scripted verifier responses.
 * No database, no network: fully hermetic.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/lib/ai/embeddings/embed", () => ({
  embed: vi.fn(async () => ({
    embedding: Array.from({ length: 768 }, (_, i) => ((i % 7) + 1) * 0.001),
  })),
}));

const matchMemoriesV2Mock = vi.fn();
vi.mock("@/lib/repositories/memory.repository", () => ({
  matchMemoriesV2: (...args: unknown[]) => matchMemoriesV2Mock(...args),
}));

import { resolveMemoryIdentity } from "@/lib/memory/identity";

type ScriptedOutcome =
  | "SAME"
  | "DIFFERENT"
  | "UNCERTAIN"
  | "MALFORMED_JSON"
  | "EMPTY"
  | "HTTP_500"
  | "THROW"
  | "ABORT";

type CandidateOverride = {
  id: string;
  similarity?: number;
  effective_score?: number;
  confidence?: number;
};

function cand(id: string, similarity: number, effective_score = 0.674, confidence = 0.9) {
  return {
    id,
    title: `Title ${id}`,
    content: `Content ${id}`,
    memory_type: "project",
    status: "active",
    similarity,
    effective_score,
    confidence,
    times_used: 0,
    last_used: null,
  };
}

const realFetchOriginal = globalThis.fetch.bind(globalThis);
let verifierScriptActive = false;

function installVerifierScript(script: ScriptedOutcome[]): {
  calls: () => number;
} {
  const state = { calls: 0 };
  verifierScriptActive = true;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    if (verifierScriptActive && url.includes("/api/chat")) {
      const step = script[Math.min(state.calls, script.length - 1)];
      state.calls += 1;
      if (step === "THROW") throw new Error("verifier boom");
      if (step === "ABORT")
        throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
      if (step === "HTTP_500") return new Response(null, { status: 500 });
      let content: string;
      if (step === "MALFORMED_JSON") content = "Sure! Here is my analysis... {oops";
      else if (step === "EMPTY") content = "";
      else content = JSON.stringify({ decision: step, reason: "scripted" });
      return new Response(JSON.stringify({ message: { role: "assistant", content } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return realFetchOriginal(input, init);
  }) as typeof fetch;
  return { calls: () => state.calls };
}

afterEach(() => {
  verifierScriptActive = false;
  globalThis.fetch = realFetchOriginal;
});

const INPUT = {
  userId: "user-1",
  title: "User Project: Aether (fresh observation)",
  content: "The user is building a project called Aether with Next.js and Supabase.",
  memoryType: "project" as const,
};

function mockCandidates(rows: unknown[]) {
  matchMemoriesV2Mock.mockResolvedValue({ data: rows, error: null });
}

describe("Phase 6-AL — identity multi-SAME policy", () => {
  afterEach(() => {
    matchMemoriesV2Mock.mockReset();
  });

  it("1. no candidates -> create (no semantic candidates)", async () => {
    mockCandidates([]);
    const d = await resolveMemoryIdentity(INPUT);
    expect(d.decision).toBe("create");
    expect(d.reason).toBe("no semantic candidates");
  });

  it("2. exactly one candidate SAME -> corroborate that one, legacy reason", async () => {
    mockCandidates([cand("m-solo", 0.9)]);
    installVerifierScript(["SAME"]);
    const d = await resolveMemoryIdentity(INPUT);
    expect(d).toEqual({
      decision: "corroborate",
      targetId: "m-solo",
      reason: "verified SAME (similarity 0.900)",
    });
  });

  it("3. two SAME -> corroborate canonical (higher similarity), duplicate-representation reason", async () => {
    mockCandidates([cand("a-low", 0.86), cand("b-high", 0.91)]);
    installVerifierScript(["SAME", "SAME"]);
    const d = await resolveMemoryIdentity(INPUT);
    expect(d.decision).toBe("corroborate");
    if (d.decision === "corroborate") {
      expect(d.targetId).toBe("b-high");
      expect(d.reason).toBe(
        "verified duplicate representations (2 SAME candidates); corroborated canonical candidate"
      );
    }
  });

  it("4. five SAME -> exactly one corroboration of the canonical", async () => {
    mockCandidates([
      cand("c1", 0.8888),
      cand("c2", 0.8779),
      cand("c3", 0.8741),
      cand("c4", 0.8637),
      cand("c5", 0.8637),
    ]);
    const s = installVerifierScript(["SAME", "SAME", "SAME", "SAME", "SAME"]);
    const d = await resolveMemoryIdentity(INPUT);
    expect(d.decision).toBe("corroborate");
    if (d.decision === "corroborate") {
      expect(d.targetId).toBe("c1");
      expect(d.reason).toBe(
        "verified duplicate representations (5 SAME candidates); corroborated canonical candidate"
      );
    }
    expect(s.calls()).toBe(5);
  });

  it("5. SAME + DIFFERENT -> create (non-clean)", async () => {
    mockCandidates([cand("x1", 0.9), cand("x2", 0.87)]);
    const s = installVerifierScript(["SAME", "DIFFERENT"]);
    const d = await resolveMemoryIdentity(INPUT);
    expect(d.decision).toBe("create");
    expect(d.reason).toBe("non-clean verifier pattern; fail-safe");
    expect(s.calls()).toBe(2); // early exit on first non-SAME
  });

  it("6. SAME + UNCERTAIN -> create (non-clean)", async () => {
    mockCandidates([cand("x1", 0.9), cand("x2", 0.87)]);
    const s = installVerifierScript(["SAME", "UNCERTAIN"]);
    const d = await resolveMemoryIdentity(INPUT);
    expect(d.decision).toBe("create");
    expect(d.reason).toBe("non-clean verifier pattern; fail-safe");
    expect(s.calls()).toBe(2);
  });

  it("7. DIFFERENT + SAME -> create (non-clean, early exit before the SAME)", async () => {
    mockCandidates([cand("x1", 0.9), cand("x2", 0.87)]);
    const s = installVerifierScript(["DIFFERENT"]);
    const d = await resolveMemoryIdentity(INPUT);
    expect(d.decision).toBe("create");
    expect(d.reason).toBe("non-clean verifier pattern; fail-safe");
    expect(s.calls()).toBe(1);
  });

  it("8. UNCERTAIN + SAME -> create (non-clean, early exit)", async () => {
    mockCandidates([cand("x1", 0.9), cand("x2", 0.87)]);
    const s = installVerifierScript(["UNCERTAIN"]);
    const d = await resolveMemoryIdentity(INPUT);
    expect(d.decision).toBe("create");
    expect(s.calls()).toBe(1);
  });

  it("9. SAME + DIFFERENT + SAME -> create (non-clean)", async () => {
    mockCandidates([cand("x1", 0.93), cand("x2", 0.9), cand("x3", 0.88)]);
    const s = installVerifierScript(["SAME", "DIFFERENT", "SAME"]);
    const d = await resolveMemoryIdentity(INPUT);
    expect(d.decision).toBe("create");
    expect(d.reason).toBe("non-clean verifier pattern; fail-safe");
    expect(s.calls()).toBe(2);
  });

  it("10. SAME + UNCERTAIN + SAME -> create (non-clean)", async () => {
    mockCandidates([cand("x1", 0.93), cand("x2", 0.9), cand("x3", 0.88)]);
    const s = installVerifierScript(["SAME", "UNCERTAIN", "SAME"]);
    const d = await resolveMemoryIdentity(INPUT);
    expect(d.decision).toBe("create");
    expect(s.calls()).toBe(2);
  });

it("11. embedding failure -> create (embedding failed)", async () => {
    const { embed } = await import("@/lib/ai/embeddings/embed");
    (embed as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("ollama down"));
    mockCandidates([cand("m1", 0.9)]);
    const d = await resolveMemoryIdentity(INPUT);
    expect(d.decision).toBe("create");
    expect(d.reason).toBe("embedding failed");
  });

  it("12. RPC error -> create (rpc failed)", async () => {
    matchMemoriesV2Mock.mockResolvedValue({ data: null, error: { message: "rpc boom" } });
    const d = await resolveMemoryIdentity(INPUT);
    expect(d.decision).toBe("create");
    expect(d.reason).toBe("rpc failed");
  });

  it("13. malformed RPC result (non-array) -> create via empty-pool coercion", async () => {
    matchMemoriesV2Mock.mockResolvedValue({ data: "garbage", error: null });
    const d = await resolveMemoryIdentity(INPUT);
    expect(d.decision).toBe("create");
    expect(d.reason).toBe("no semantic candidates");
  });

  it("14. verifier throw -> UNCERTAIN -> create (non-clean)", async () => {
    mockCandidates([cand("m1", 0.9), cand("m2", 0.88)]);
    installVerifierScript(["THROW"]);
    const d = await resolveMemoryIdentity(INPUT);
    expect(d.decision).toBe("create");
    expect(d.reason).toBe("non-clean verifier pattern; fail-safe");
  });

  it("15. verifier abort/timeout -> UNCERTAIN -> create (non-clean)", async () => {
    mockCandidates([cand("m1", 0.9), cand("m2", 0.88)]);
    installVerifierScript(["ABORT"]);
    const d = await resolveMemoryIdentity(INPUT);
    expect(d.decision).toBe("create");
    expect(d.reason).toBe("non-clean verifier pattern; fail-safe");
  });

it("16. malformed verifier JSON -> UNCERTAIN -> create (non-clean)", async () => {
    mockCandidates([cand("m1", 0.9), cand("m2", 0.88)]);
    installVerifierScript(["MALFORMED_JSON"]);
    const d = await resolveMemoryIdentity(INPUT);
    expect(d.decision).toBe("create");
    expect(d.reason).toBe("non-clean verifier pattern; fail-safe");
  });

  it("17. missing similarity -> treated lowest, verifier input throws internally -> create", async () => {
    const broken = cand("m-broken", Number.NaN) as unknown as Record<string, unknown>;
    delete broken.similarity;
    mockCandidates([broken]);
    installVerifierScript(["SAME"]);
    const d = await resolveMemoryIdentity(INPUT);
    expect(d.decision).toBe("create");
    expect(d.reason).toBe("non-clean verifier pattern; fail-safe");
  });

  it("18. invalid candidate shape (null row) -> create (search failed)", async () => {
    matchMemoriesV2Mock.mockResolvedValue({ data: [null, cand("m2", 0.9)], error: null });
    installVerifierScript(["SAME"]);
    const d = await resolveMemoryIdentity(INPUT);
    expect(d.decision).toBe("create");
    expect(d.reason).toBe("search failed");
  });

  it("19. array order independence: shuffled inputs select the same canonical", async () => {
    const rows = [
      cand("id-a", 0.86),
      cand("id-b", 0.93),
      cand("id-c", 0.88),
      cand("id-d", 0.91),
    ];
    const targetIds: string[] = [];
    for (const perm of [
      [rows[0], rows[1], rows[2], rows[3]],
      [rows[3], rows[2], rows[1], rows[0]],
      [rows[1], rows[3], rows[0], rows[2]],
    ]) {
      mockCandidates(perm);
      installVerifierScript(["SAME", "SAME", "SAME", "SAME"]);
      const d = await resolveMemoryIdentity(INPUT);
      if (d.decision === "corroborate") targetIds.push(d.targetId);
    }
    expect(targetIds).toEqual(["id-b", "id-b", "id-b"]);
  });

it("20. equal similarity -> effective_score DESC breaks the tie", async () => {
    mockCandidates([
      cand("tie-z", 0.9, 0.7, 0.9),
      cand("tie-a", 0.9, 0.8, 0.9),
    ]);
    installVerifierScript(["SAME", "SAME"]);
    const d = await resolveMemoryIdentity(INPUT);
    expect(d.decision).toBe("corroborate");
    if (d.decision === "corroborate") expect(d.targetId).toBe("tie-a");
  });

  it("21. full tie -> id ASC decides (deterministic floor)", async () => {
    mockCandidates([
      cand("zzz-identical", 0.9, 0.674, 0.9),
      cand("aaa-identical", 0.9, 0.674, 0.9),
    ]);
    installVerifierScript(["SAME", "SAME"]);
    const d = await resolveMemoryIdentity(INPUT);
    expect(d.decision).toBe("corroborate");
    if (d.decision === "corroborate") expect(d.targetId).toBe("aaa-identical");
  });

  it("22. multi-SAME yields exactly one corroboration target (structural)", async () => {
    mockCandidates([
      cand("k1", 0.95),
      cand("k2", 0.94),
      cand("k3", 0.93),
      cand("k4", 0.92),
      cand("k5", 0.91),
      cand("k6", 0.9),
      cand("k7", 0.89),
      cand("k8", 0.88),
    ]);
    const s = installVerifierScript(Array(8).fill("SAME"));
    const d = await resolveMemoryIdentity(INPUT);
    expect(d.decision).toBe("corroborate");
    if (d.decision === "corroborate") {
      // The decision union carries exactly one target: the highest-similarity
      // candidate under the approved total ordering.
      expect(d.targetId).toBe("k1");
      expect(d.reason).toBe(
        "verified duplicate representations (8 SAME candidates); corroborated canonical candidate"
      );
    }
    expect(s.calls()).toBe(8); // clean pattern verifies the whole pool
  });

  it("23. static safety assertion: identity.ts never invokes corroboration or merge paths", () => {
    const srcPath = path.resolve(process.cwd(), "lib/memory/identity.ts");
    const src = fs.readFileSync(srcPath, "utf-8");
    // No invocation-shaped corroboration/merge calls (docstring mentions of the
    // caller's RPC are fine; executable calls are not).
    expect(src).not.toMatch(/corroborateMemory\s*\(/);
    expect(src).not.toMatch(/corroborate_memory\s*\(|\.rpc\s*\(/);
    expect(src).not.toMatch(/merge_memories\s*\(|find_near_duplicates\s*\(/);
    expect(src).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
    // The only repository import is the read-only retrieval wrapper.
    expect(src).not.toMatch(/import\s*\{[^}]*corroborate[^}]*\}\s*from/);
    // The legacy guard must be gone.
    expect(src).not.toMatch(/>1 semantic SAME match/);
  });

  it("24. reason strings are deterministic across repeated identical runs", async () => {
    const rows = [cand("d1", 0.93), cand("d2", 0.9)];
    const results: string[] = [];
    for (let i = 0; i < 2; i++) {
      mockCandidates(rows.map((r) => ({ ...r })));
      installVerifierScript(["SAME", "SAME"]);
      const d = await resolveMemoryIdentity(INPUT);
      results.push(
        d.decision === "corroborate" ? `${d.targetId}|${d.reason}` : `create|${d.reason}`
      );
    }
    expect(results[0]).toBe(results[1]);
    expect(results[0]).toBe(
      "d1|verified duplicate representations (2 SAME candidates); corroborated canonical candidate"
    );
  });

  it("25. retrieval contract unchanged: identity params 0.85 / 8 with 768-dim vector", async () => {
    mockCandidates([]);
    await resolveMemoryIdentity(INPUT);
    expect(matchMemoriesV2Mock).toHaveBeenCalledTimes(1);
    const [vec, userId, opts] = matchMemoriesV2Mock.mock.calls[0] as [number[], string, unknown];
    expect(vec).toHaveLength(768);
    expect(userId).toBe("user-1");
    expect(opts).toEqual({ minSimilarity: 0.85, matchCount: 8 });
  });
});