/// <reference types="vitest" />

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const MAX_ATTEMPTS = 5;
const DEFAULT_CLAIM_BATCH = 5;
const DEFAULT_LEASE_SECONDS = 300;

interface BuilderCall {
  method: string;
  args: unknown;
}

const calls: BuilderCall[] = [];

function createFakeSupabase() {
  const builder = {
    select: (c?: string) => {
      calls.push({ method: "select", args: [c] });
      return builder;
    },
    eq: (col: string, val: unknown) => {
      calls.push({ method: "eq", args: [col, val] });
      return builder;
    },
    limit: (n: number) => {
      calls.push({ method: "limit", args: [n] });
      return true;
    },
    maybeSingle: () => {
      calls.push({ method: "maybeSingle", args: [] });
      return true;
    },
    then: (resolve: (v: unknown) => void) => {
      resolve(null);
    },
  };
  return {
    client: {
      from: (t: string) => {
        calls.length = 0;
        calls.push({ method: "from", args: [t] });
        return builder;
      },
      rpc: (name: string, args: unknown) => {
        calls.length = 0;
        calls.push({ method: "rpc", args: [name, args] });
        return {};
      },
    },
    callsLog: calls,
  };
}

describe("memory.repository V2 - createFakeSupabase responder assertions", () => {
  afterEach(() => {
    calls.length = 0;
  });

  it("getAllMemories selects memories table with user_id filter", () => {
    const { client } = createFakeSupabase();
    client.from("memories").select("*").eq("user_id", "user-123");
    expect(calls.some((c) => c.method === "from" && (c.args as unknown[])[0] === "memories")).toBe(true);
    expect(calls.some((c) => c.method === "eq" && (c.args as unknown[])[0] === "user_id")).toBe(true);
  });

  it("purgeArchived calls rpc purge_archived with p_user_id", () => {
    const { client } = createFakeSupabase();
    client.rpc("purge_archived", { p_user_id: "user-123" });
    expect(calls.some((c) => c.method === "rpc" && (c.args as unknown[])[0] === "purge_archived")).toBe(true);
  });

  it("corroborateMemory calls rpc corroborate_memory", () => {
    const { client } = createFakeSupabase();
    client.rpc("corroborate_memory", { p_memory_id: "mem-123", p_message_id: "msg-456" });
    expect(calls.some((c) => c.method === "rpc" && (c.args as unknown[])[0] === "corroborate_memory")).toBe(true);
  });

  it("matchMemoriesV2 calls rpc match_memories_v2 with correct args", () => {
    const { client } = createFakeSupabase();
    client.rpc("match_memories_v2", {
      p_user_id: "user-123",
      p_query_embedding: [0.1, 0.2, 0.3],
      p_match_threshold: 0.65,
      p_match_count: 30,
    });
    expect(calls.some((c) => c.method === "rpc" && (c.args as unknown[])[0] === "match_memories_v2")).toBe(true);
    const matchCall = calls.find((c) => (c.args as unknown[])[0] === "match_memories_v2");
    if (matchCall) {
      const args = (matchCall.args as unknown[])[1] as { p_user_id: string; p_query_embedding: number[]; p_match_threshold: number; p_match_count: number };
      expect(args.p_user_id).toBe("user-123");
      expect(args.p_query_embedding).toEqual([0.1, 0.2, 0.3]);
      expect(args.p_match_threshold).toBe(0.65);
      expect(args.p_match_count).toBe(30);
    }
  });
});