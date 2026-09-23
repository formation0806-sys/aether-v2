import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FlagPredicate } from "@/lib/agent/tools/registry";
import { ToolRegistry, createToolRegistry } from "@/lib/agent/tools/registry";
import type { ToolDefinition } from "@/lib/agent/tools/types";

/** Flags this suite may touch. Cleared before and after every test. */
const MANAGED_FLAGS = [
  "ENABLE_AGENT_LOOP",
  "ENABLE_TOOL_USE",
  "ENABLE_AI_PLANNER",
  "ENABLE_PROCEDURAL_MEMORY",
  "ENABLE_TOOL_WEB_SEARCH",
] as const;

function clearManagedFlags(): void {
  for (const flag of MANAGED_FLAGS) {
    delete process.env[flag];
  }
}

beforeEach(clearManagedFlags);
afterEach(clearManagedFlags);

/**
 * Predicate stub: enabled flags are stated explicitly, never read from
 * process.env, so these tests do not depend on the environment.
 */
function only(...enabledFlags: string[]): FlagPredicate {
  const enabled = new Set<string>(enabledFlags);

  return (flag) => enabled.has(flag);
}

/** A valid definition, overridable per test. */
function makeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: "current_time",
    description: "Returns the current date and time.",
    requiredFlags: ["ENABLE_TOOL_USE"],
    timeoutMs: 5000,
    parseArgs: () => ({}),
    execute: async () => ({ ok: true, observation: "12:00" }),
    ...overrides,
  };
}

/** Cast helper for deliberately malformed definitions. */
function asDefinition(value: unknown): ToolDefinition {
  return value as ToolDefinition;
}

describe("tool registry - registration is flag-gated", () => {
  it("does not register a tool when its flag is OFF", () => {
    const registry = new ToolRegistry(only());

    expect(registry.register(makeTool())).toBe(false);
    expect(registry.size()).toBe(0);
    expect(registry.has("current_time")).toBe(false);
    expect(registry.get("current_time")).toBeUndefined();
    expect(registry.list()).toEqual([]);
  });

  it("does not register on an unrelated flag being ON", () => {
    const registry = new ToolRegistry(only("ENABLE_AGENT_LOOP"));

    expect(registry.register(makeTool())).toBe(false);
    expect(registry.size()).toBe(0);
  });

  it("registers and returns the same definition when its flag is ON", () => {
    const registry = new ToolRegistry(only("ENABLE_TOOL_USE"));
    const tool = makeTool();

    expect(registry.register(tool)).toBe(true);
    expect(registry.size()).toBe(1);
    expect(registry.has("current_time")).toBe(true);
    expect(registry.get("current_time")).toBe(tool);
    expect(registry.list()).toEqual([tool]);
  });

  it("requires every declared flag", () => {
    const tool = makeTool({
      requiredFlags: ["ENABLE_TOOL_USE", "ENABLE_TOOL_WEB_SEARCH"],
    });

    expect(new ToolRegistry(only("ENABLE_TOOL_USE")).register(tool)).toBe(false);
    expect(
      new ToolRegistry(only("ENABLE_TOOL_USE", "ENABLE_TOOL_WEB_SEARCH")).register(tool)
    ).toBe(true);
  });

  it("treats an empty requiredFlags array as always available", () => {
    const registry = new ToolRegistry(only());

    expect(registry.register(makeTool({ requiredFlags: [] }))).toBe(true);
    expect(registry.size()).toBe(1);
  });

  it("is side effect free at registration time", () => {
    const parseArgs = vi.fn(() => ({}));
    const execute = vi.fn(async () => ({ ok: true, observation: "x" }));
    const registry = new ToolRegistry(only("ENABLE_TOOL_USE"));

    expect(registry.register(makeTool({ parseArgs, execute }))).toBe(true);
    expect(parseArgs).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("tool registry - lookup and listing", () => {
  it("keeps registration order", () => {
    const registry = new ToolRegistry(only("ENABLE_TOOL_USE"));

    registry.register(makeTool({ name: "current_time" }));
    registry.register(makeTool({ name: "calculator" }));
    registry.register(makeTool({ name: "memory_search" }));

    expect(registry.list().map((tool) => tool.name)).toEqual([
      "current_time",
      "calculator",
      "memory_search",
    ]);
    expect(registry.size()).toBe(3);
  });

  it("returns a fresh array from list", () => {
    const registry = new ToolRegistry(only("ENABLE_TOOL_USE"));
    registry.register(makeTool());

    const snapshot = registry.list();
    snapshot.push(makeTool({ name: "injected" }));

    expect(registry.size()).toBe(1);
    expect(registry.list()).not.toBe(snapshot);
    expect(registry.has("injected")).toBe(false);
  });

  it("reports unknown tools as absent", () => {
    const registry = new ToolRegistry(only("ENABLE_TOOL_USE"));

    expect(registry.has("nope")).toBe(false);
    expect(registry.get("nope")).toBeUndefined();
  });
});

describe("tool registry - invalid definitions are skipped, never thrown", () => {
  const invalidCases: Array<[string, unknown]> = [
    ["a null definition", null],
    ["a non-object definition", "current_time"],
    ["an empty name", makeTool({ name: "" })],
    ["a whitespace-only name", makeTool({ name: "   " })],
    ["a non-string name", makeTool({ name: 42 as unknown as string })],
    ["an empty description", makeTool({ description: "" })],
    ["a whitespace-only description", makeTool({ description: "  " })],
    [
      "a missing requiredFlags array",
      {
        name: "current_time",
        description: "No flags declared.",
        timeoutMs: 5000,
        parseArgs: () => ({}),
        execute: async () => ({ ok: true, observation: "x" }),
      },
    ],
    ["a zero timeout", makeTool({ timeoutMs: 0 })],
    ["a negative timeout", makeTool({ timeoutMs: -5 })],
    ["a fractional timeout", makeTool({ timeoutMs: 12.5 })],
    ["a string timeout", makeTool({ timeoutMs: "5000" as unknown as number })],
    [
      "a non-function parseArgs",
      makeTool({ parseArgs: "nope" as unknown as ToolDefinition["parseArgs"] }),
    ],
    [
      "a non-function execute",
      makeTool({ execute: null as unknown as ToolDefinition["execute"] }),
    ],
  ];

  for (const [label, value] of invalidCases) {
    it("skips " + label, () => {
      const registry = new ToolRegistry(only("ENABLE_TOOL_USE"));
      let result = true;

      expect(() => {
        result = registry.register(asDefinition(value));
      }).not.toThrow();

      expect(result).toBe(false);
      expect(registry.size()).toBe(0);
      expect(registry.list()).toEqual([]);
    });
  }
});

describe("tool registry - duplicate names", () => {
  it("keeps the first registration and ignores the second", () => {
    const registry = new ToolRegistry(only("ENABLE_TOOL_USE"));
    const first = makeTool({ description: "first" });
    const second = makeTool({ description: "second" });

    expect(registry.register(first)).toBe(true);
    expect(registry.register(second)).toBe(false);
    expect(registry.size()).toBe(1);
    expect(registry.get("current_time")).toBe(first);
  });
});

describe("tool registry - real feature-flag integration", () => {
  it("is empty by default, because every flag is OFF", () => {
    const registry = createToolRegistry();

    expect(registry.register(makeTool())).toBe(false);
    expect(registry.size()).toBe(0);
  });

  it("registers once ENABLE_TOOL_USE is enabled", () => {
    process.env.ENABLE_TOOL_USE = "true";

    const registry = createToolRegistry();

    expect(registry.register(makeTool())).toBe(true);
    expect(registry.size()).toBe(1);
  });

  it("stays OFF for values that are not explicit truthy tokens", () => {
    for (const value of ["false", "0", "off", "no", "ture", ""]) {
      process.env.ENABLE_TOOL_USE = value;

      expect(createToolRegistry().register(makeTool())).toBe(false);
    }
  });

  it("keeps a sub-flagged tool OFF while its own flag is OFF", () => {
    process.env.ENABLE_TOOL_USE = "true";

    const webTool = makeTool({
      name: "web_search",
      requiredFlags: ["ENABLE_TOOL_USE", "ENABLE_TOOL_WEB_SEARCH"],
    });

    expect(createToolRegistry().register(webTool)).toBe(false);

    process.env.ENABLE_TOOL_WEB_SEARCH = "on";

    expect(createToolRegistry().register(webTool)).toBe(true);
  });

  it("honours an injected predicate over the environment", () => {
    process.env.ENABLE_TOOL_USE = "true";

    expect(new ToolRegistry(only()).register(makeTool())).toBe(false);
    expect(new ToolRegistry(only("ENABLE_TOOL_USE")).register(makeTool())).toBe(true);
  });
});