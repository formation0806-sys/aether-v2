import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/ai/embeddings/embed", () => ({
  embed: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { embed } from "@/lib/ai/embeddings/embed";
import * as repository from "@/lib/repositories/memory.repository";
import { retrieveMemories } from "@/lib/memory/retrieve";

const USER_A = "user-a-id";
const USER_B = "user-b-id";

const IDENTITY_ROW = {
  id: "identity-mem-1",
  title: "User Name",
  content: "The user's name is Prince.",
  summary: "",
  tags: [] as string[],
  memory_type: "identity",
  status: "active",
  importance_v2: 0.72,
  confidence_v2: 1.0,
  effective_score: 0.706,
  times_used: 3,
  last_used: null,
};

function installMocks(opts: {
  identityRows: unknown[];
  vectorRows: unknown[];
  identityUserIds: string[];
}) {
  const createClientMock = vi.mocked(createClient);
  createClientMock.mockResolvedValue({
    from: () => ({
      select: () => ({
        in: () => ({
          eq: async () => ({ data: [], error: null }),
        }),
      }),
    }),
  } as unknown as Awaited<ReturnType<typeof createClient>>);

  vi.mocked(embed).mockResolvedValue({
    embedding: new Array(768).fill(0.001),
  });

  const matchSpy = vi
    .spyOn(repository, "matchMemoriesV2")
    .mockResolvedValue({ data: opts.vectorRows, error: null } as unknown as Awaited<
      ReturnType<typeof repository.matchMemoriesV2>
    >);
  const touchSpy = vi
    .spyOn(repository, "touchMemories")
    .mockResolvedValue({ data: null, error: null } as unknown as Awaited<
      ReturnType<typeof repository.touchMemories>
    >);
  const identitySpy = vi
    .spyOn(repository, "getActiveIdentityMemories")
    .mockImplementation(async (userId: string) => {
      opts.identityUserIds.push(userId);
      return { data: opts.identityRows, error: null } as unknown as Awaited<
        ReturnType<typeof repository.getActiveIdentityMemories>
      >;
    });

  return { matchSpy, touchSpy, identitySpy };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(embed).mockReset();
  vi.mocked(createClient).mockReset();
});

describe("identity recall regression — deterministic identity leg", () => {
  const identityQueries = [
    "What is my name?",
    "what is my name",
    "What's my name?",
    "Who am I?",
  ];

  for (const q of identityQueries) {
    it(`retrieves User Name memory for ${JSON.stringify(q)}`, async () => {
      const seenUsers: string[] = [];
      installMocks({ identityRows: [IDENTITY_ROW], vectorRows: [], identityUserIds: seenUsers });

      const result = await retrieveMemories(USER_A, q);

      expect(seenUsers).toEqual([USER_A]);
      expect(result.map((m) => m.id)).toContain("identity-mem-1");
      const name = result.find((m) => m.id === "identity-mem-1")!;
      expect(name.title).toBe("User Name");
      expect(name.content).toBe("The user's name is Prince.");
      expect(name.memoryType).toBe("identity");
    });
  }

  it("non-identity query uses normal vector retrieval only", async () => {
    const seenUsers: string[] = [];
    const { identitySpy } = installMocks({
      identityRows: [IDENTITY_ROW],
      vectorRows: [],
      identityUserIds: seenUsers,
    });

    const result = await retrieveMemories(USER_A, "What is the capital of France?");

    expect(identitySpy).not.toHaveBeenCalled();
    expect(seenUsers).toEqual([]);
    expect(result).toEqual([]);
  });

  it("never returns another user's identity memory", async () => {
    const seenUsers: string[] = [];
    const identitySpy = vi
      .spyOn(repository, "getActiveIdentityMemories")
      .mockImplementation(async (userId: string) => {
        seenUsers.push(userId);
        // Simulate user-scoped query: user B has no identity rows.
        const rows = userId === USER_A ? [IDENTITY_ROW] : [];
        return { data: rows, error: null } as unknown as Awaited<
          ReturnType<typeof repository.getActiveIdentityMemories>
        >;
      });
    vi.mocked(createClient).mockResolvedValue({
      from: () => ({
        select: () => ({
          in: () => ({
            eq: async () => ({ data: [], error: null }),
          }),
        }),
      }),
    } as unknown as Awaited<ReturnType<typeof createClient>>);
    vi.mocked(embed).mockResolvedValue({ embedding: new Array(768).fill(0.001) });
    vi.spyOn(repository, "matchMemoriesV2").mockResolvedValue({
      data: [],
      error: null,
    } as unknown as Awaited<ReturnType<typeof repository.matchMemoriesV2>>);
    vi.spyOn(repository, "touchMemories").mockResolvedValue({
      data: null,
      error: null,
    } as unknown as Awaited<ReturnType<typeof repository.touchMemories>>);

    const result = await retrieveMemories(USER_B, "What is my name?");

    expect(identitySpy).toHaveBeenCalledWith(USER_B);
    expect(seenUsers).toEqual([USER_B]);
    expect(result).toEqual([]);
  });

  it("dedupes identity rows already returned by the vector leg", async () => {
    const seenUsers: string[] = [];
    installMocks({
      identityRows: [IDENTITY_ROW],
      vectorRows: [
        {
          id: "identity-mem-1",
          title: "User Name",
          content: "The user's name is Prince.",
          summary: "",
          tags: [],
          memory_type: "identity",
          importance: 0.72,
          confidence: 1.0,
          similarity: 0.9,
          effective_score: 0.706,
          times_used: 3,
          last_used: null,
        },
      ],
      identityUserIds: seenUsers,
    });

    const result = await retrieveMemories(USER_A, "What is my name?");

    expect(result.filter((m) => m.id === "identity-mem-1")).toHaveLength(1);
    // Vector leg wins on overlap: measured cosine preserved, not floor value.
    expect(result.find((m) => m.id === "identity-mem-1")!.similarity).toBe(0.9);
  });
});
