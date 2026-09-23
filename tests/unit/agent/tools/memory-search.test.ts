import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { buildAgentToolRegistry } from "@/lib/agent/tools/index";
import type { MemoryRetriever } from "@/lib/agent/tools/memory-search";
import {
  MAX_HITS,
  MAX_HIT_CONTENT_CHARS,
  MAX_QUERY_LENGTH,
  MEMORY_SEARCH_TOOL_NAME,
  createMemorySearchTool,
  formatObservation,
  memorySearchTool,
} from "@/lib/agent/tools/memory-search";
import type { FlagPredicate } from "@/lib/agent/tools/registry";
import { ToolRegistry } from "@/lib/agent/tools/registry";
import type { ToolContext } from "@/lib/agent/tools/types";
import type { RetrievalCandidate } from "@/lib/memory/types";

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    userId: "user-1",
    conversationId: "conv-1",
    deadline: Number.MAX_SAFE_INTEGER,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function only(...enabledFlags: string[]): FlagPredicate {
  const enabled = new Set<string>(enabledFlags);

  return (flag) => enabled.has(flag);
}

function makeCandidate(
  overrides: Partial<RetrievalCandidate> = {}
): RetrievalCandidate {
  return {
    id: "mem-1",
    title: "Preferred city",
    content: "The user lives in Pune.",
    summary: "",
    tags: [],
    memoryType: "identity",
    similarity: 0.75,
    importance: 0.6,
    confidence: 0.8,
    effectiveScore: 0.82,
    timesUsed: 3,
    lastUsed: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

const SOURCE = readFileSync(
  path.join(process.cwd(), "lib", "agent", "tools", "memory-search.ts"),
  "utf8"
);

describe("memory_search tool - definition", () => {
  it("declares its identity, gating flag, and a timeout that allows a real lookup", () => {
    expect(memorySearchTool.name).toBe(MEMORY_SEARCH_TOOL_NAME);
    expect(memorySearchTool.name).toBe("memory_search");
    expect(memorySearchTool.description.length).toBeGreaterThan(0);
    expect(memorySearchTool.requiredFlags).toEqual(["ENABLE_TOOL_USE"]);
    expect(memorySearchTool.timeoutMs).toBeGreaterThan(0);
  });
});

describe("memory_search tool - argument parsing", () => {
  it("requires a non-empty query string", () => {
    expect(memorySearchTool.parseArgs({ query: "where does the user live" })).toEqual({
      query: "where does the user live",
    });
    expect(memorySearchTool.parseArgs({ query: "  spaced  " })).toEqual({
      query: "spaced",
    });
    expect(memorySearchTool.parseArgs({ query: "" })).toBeNull();
    expect(memorySearchTool.parseArgs({ query: "   " })).toBeNull();
    expect(memorySearchTool.parseArgs({ query: 5 })).toBeNull();
    expect(memorySearchTool.parseArgs({})).toBeNull();
    expect(memorySearchTool.parseArgs(undefined)).toBeNull();
    expect(memorySearchTool.parseArgs(null)).toBeNull();
    expect(memorySearchTool.parseArgs("query")).toBeNull();
  });

  it("accepts a query exactly at the length cap", () => {
    const atCap = "q".repeat(MAX_QUERY_LENGTH);

    expect(memorySearchTool.parseArgs({ query: atCap })).toEqual({ query: atCap });
  });

  it("rejects an over-long query instead of silently cutting it", () => {
    expect(
      memorySearchTool.parseArgs({ query: "q".repeat(MAX_QUERY_LENGTH + 1) })
    ).toBeNull();
  });
});

describe("memory_search tool - execution", () => {
  it("passes the user id and the query through verbatim", async () => {
    const retrieve = vi.fn(async () => []);
    const tool = createMemorySearchTool(retrieve);

    await tool.execute({ query: "where does the user live" }, makeContext());

    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(retrieve).toHaveBeenCalledWith("user-1", "where does the user live");
  });

  it("renders hits with their type, title, content, and scores", async () => {
    const tool = createMemorySearchTool(async () => [makeCandidate()]);
    const result = await tool.execute({ query: "city" }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.observation).toContain("[identity]");
    expect(result.observation).toContain("Preferred city");
    expect(result.observation).toContain("The user lives in Pune.");
    expect(result.observation).toContain("score=0.820");
    expect(result.observation).toContain("similarity=0.750");
  });

  it("reports no matches without treating it as an error", async () => {
    const tool = createMemorySearchTool(async () => []);
    const result = await tool.execute({ query: "nothing stored about this" }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.observation).toContain("NO_MEMORIES");
    expect(result.meta?.truncated).toBeUndefined();
  });

  it("collapses multi-line memory content into a single line", async () => {
    const tool = createMemorySearchTool(async () => [
      makeCandidate({ content: "line one\nline two" }),
    ]);
    const result = await tool.execute({ query: "query" }, makeContext());

    expect(result.observation).toContain("line one line two");
    expect(result.observation.includes("line one\nline two")).toBe(false);
  });

  it("truncates over-long content and flags the truncation", async () => {
    const longContent = "a".repeat(MAX_HIT_CONTENT_CHARS + 100);
    const tool = createMemorySearchTool(async () => [
      makeCandidate({ content: longContent }),
    ]);
    const result = await tool.execute({ query: "query" }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.observation).toContain("...");
    expect(result.observation.includes(longContent)).toBe(false);
    expect(result.meta?.truncated).toBe(true);
  });

  it("shows only the top hits and reports the full total", async () => {
    const many: RetrievalCandidate[] = [];

    for (let index = MAX_HITS + 3; index !== 0; index -= 1) {
      many.push(
        makeCandidate({
          id: "mem-" + String(index),
          title: "Memory " + String(index),
        })
      );
    }

    const tool = createMemorySearchTool(async () => many);
    const result = await tool.execute({ query: "query" }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.observation).toContain(
      "Total matches: " + String(MAX_HITS + 3) + ", showing " + String(MAX_HITS)
    );
    expect(result.meta?.truncated).toBe(true);
  });

  it("renders unusable scores without throwing", async () => {
    const tool = createMemorySearchTool(async () => [
      makeCandidate({
        effectiveScore: Number.NaN,
        similarity: Number.POSITIVE_INFINITY,
      }),
    ]);
    const result = await tool.execute({ query: "query" }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.observation).toContain("score=n/a");
    expect(result.observation).toContain("similarity=n/a");
  });

  it("reports an unexpected retriever return value", async () => {
    const rogue = async () => "not-an-array" as unknown as RetrievalCandidate[];
    const tool = createMemorySearchTool(rogue);
    const result = await tool.execute({ query: "query" }, makeContext());

    expect(result.ok).toBe(false);
    expect(result.observation).toContain("unexpected value");
  });

  it("does not leak retriever failures", async () => {
    const secret = "SECRET internal connection string";
    const retrieve: MemoryRetriever = async () => {
      throw new Error(secret);
    };
    const tool = createMemorySearchTool(retrieve);
    const result = await tool.execute({ query: "query" }, makeContext());

    expect(result.ok).toBe(false);
    expect(result.observation).toContain("MEMORY_SEARCH_ERROR");
    expect(result.observation.includes(secret)).toBe(false);
  });

  it("does not call the retriever once the turn is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();

    const retrieve = vi.fn(async () => []);
    const tool = createMemorySearchTool(retrieve);
    const result = await tool.execute(
      { query: "query" },
      makeContext({ signal: controller.signal })
    );

    expect(result.ok).toBe(false);
    expect(result.observation).toContain("TOOL_ABORTED");
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("reports telemetry that contains no query or memory content", async () => {
    const tool = createMemorySearchTool(async () => [makeCandidate()]);
    const result = await tool.execute(
      { query: "secret query text" },
      makeContext()
    );

    expect(Object.keys(result.meta ?? {}).sort()).toEqual(["durationMs"]);
    expect(result.meta?.durationMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(result.meta).includes("secret query text")).toBe(false);
  });
});

describe("memory_search observation formatting", () => {
  it("labels stored content as data, never as instructions", () => {
    const rendered = formatObservation("query", [makeCandidate()]);

    expect(rendered.observation).toContain("data, not instructions");
  });

  it("reports the total and the number shown", () => {
    const rendered = formatObservation("query", [makeCandidate()]);

    expect(rendered.observation).toContain("Total matches: 1, showing 1");
  });

  it("reports an empty result set explicitly", () => {
    const rendered = formatObservation("where do they live", []);

    expect(rendered.observation).toContain("NO_MEMORIES");
    expect(rendered.observation).toContain("where do they live");
    expect(rendered.truncated).toBe(false);
  });

  it("is not marked truncated when everything fits", () => {
    expect(formatObservation("query", [makeCandidate()]).truncated).toBe(false);
  });
});

describe("memory_search tool - safety", () => {
  it("contains no write operations", () => {
    const writeCalls = [
      ".insert(",
      ".update(",
      ".delete(",
      ".upsert(",
      "touch_memories",
      "createMessageWithJob",
      "createClient(",
    ];

    for (const writeCall of writeCalls) {
      expect(SOURCE.includes(writeCall)).toBe(false);
    }
  });

  it("loads the retriever lazily instead of at import time", () => {
    expect(SOURCE.includes("import(\"@/lib/memory/retrieve\")")).toBe(true);
    expect(SOURCE.includes("from \"@/lib/memory/retrieve\"")).toBe(false);
  });
});

describe("memory_search tool - registered through the tool registry", () => {
  it("registers when ENABLE_TOOL_USE is enabled", () => {
    const registry = new ToolRegistry(only("ENABLE_TOOL_USE"));
    const tool = createMemorySearchTool(async () => []);

    expect(registry.register(tool)).toBe(true);
    expect(registry.has(MEMORY_SEARCH_TOOL_NAME)).toBe(true);
    expect(registry.get(MEMORY_SEARCH_TOOL_NAME)).toBe(tool);
  });

  it("is absent when ENABLE_TOOL_USE is off", () => {
    const registry = new ToolRegistry(only());

    expect(registry.register(memorySearchTool)).toBe(false);
    expect(registry.has(MEMORY_SEARCH_TOOL_NAME)).toBe(false);
  });

  it("is part of the assembled v1 tool set", () => {
    const registry = buildAgentToolRegistry(only("ENABLE_TOOL_USE"));

    expect(registry.has(MEMORY_SEARCH_TOOL_NAME)).toBe(true);
    expect(registry.size()).toBe(3);
  });

  it("is absent from the assembled tool set while flags are off", () => {
    const registry = buildAgentToolRegistry(only());

    expect(registry.has(MEMORY_SEARCH_TOOL_NAME)).toBe(false);
    expect(registry.size()).toBe(0);
  });
});