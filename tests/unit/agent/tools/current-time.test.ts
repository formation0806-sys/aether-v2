import { describe, expect, it, vi } from "vitest";

import {
  CURRENT_TIME_TOOL_NAME,
  createCurrentTimeTool,
} from "@/lib/agent/tools/current-time";
import {
  buildAgentToolRegistry,
  getToolRegistry,
  initializeTools,
} from "@/lib/agent/tools/index";
import type { FlagPredicate } from "@/lib/agent/tools/registry";
import { ToolRegistry } from "@/lib/agent/tools/registry";
import type { ToolContext } from "@/lib/agent/tools/types";

/** Deterministic context: the tool must never depend on real time or the network. */
function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    userId: "user-1",
    conversationId: "conv-1",
    deadline: Number.MAX_SAFE_INTEGER,
    signal: new AbortController().signal,
    ...overrides,
  };
}

/** Predicate stub: enabled flags are stated explicitly, never read from process.env. */
function only(...enabledFlags: string[]): FlagPredicate {
  const enabled = new Set<string>(enabledFlags);

  return (flag) => enabled.has(flag);
}

/** A clock frozen at a known instant, so observations are assertable exactly. */
const FIXED_ISO = "2026-09-21T12:34:56.789Z";
const frozenClock = () => new Date(FIXED_ISO);

describe("current_time tool - definition", () => {
  it("declares its identity, gating flag, and a valid timeout", () => {
    const tool = createCurrentTimeTool(frozenClock);

    expect(tool.name).toBe(CURRENT_TIME_TOOL_NAME);
    expect(tool.name).toBe("current_time");
    expect(tool.description.length).toBeGreaterThan(0);
    expect(tool.requiredFlags).toEqual(["ENABLE_TOOL_USE"]);
    expect(tool.timeoutMs).toBeGreaterThan(0);
    expect(Number.isInteger(tool.timeoutMs)).toBe(true);
  });
});

describe("current_time tool - argument parsing", () => {
  const tool = createCurrentTimeTool(frozenClock);

  it("accepts no arguments at all", () => {
    expect(tool.parseArgs(undefined)).toEqual({});
    expect(tool.parseArgs(null)).toEqual({});
    expect(tool.parseArgs({})).toEqual({});
  });

  it("treats an explicit null time zone as absent", () => {
    expect(tool.parseArgs({ timeZone: null })).toEqual({});
  });

  it("accepts a time zone and trims surrounding whitespace", () => {
    expect(tool.parseArgs({ timeZone: "Asia/Tokyo" })).toEqual({
      timeZone: "Asia/Tokyo",
    });
    expect(tool.parseArgs({ timeZone: "  Asia/Tokyo  " })).toEqual({
      timeZone: "Asia/Tokyo",
    });
  });

  it("ignores unknown argument keys", () => {
    expect(tool.parseArgs({ timeZone: "UTC", extra: true })).toEqual({
      timeZone: "UTC",
    });
    expect(tool.parseArgs({ extra: true })).toEqual({});
  });

  it("treats an array or other object without timeZone as no arguments", () => {
    expect(tool.parseArgs([1])).toEqual({});
    expect(tool.parseArgs(new Date(0))).toEqual({});
  });

  it("rejects an unusable time zone instead of silently ignoring it", () => {
    expect(tool.parseArgs({ timeZone: "" })).toBeNull();
    expect(tool.parseArgs({ timeZone: "   " })).toBeNull();
    expect(tool.parseArgs({ timeZone: 5 })).toBeNull();
    expect(tool.parseArgs({ timeZone: {} })).toBeNull();
  });

  it("rejects non-object arguments", () => {
    expect(tool.parseArgs("now")).toBeNull();
    expect(tool.parseArgs(7)).toBeNull();
    expect(tool.parseArgs(true)).toBeNull();
  });
});

describe("current_time tool - execution", () => {
  it("reports UTC, the UTC weekday, and unix milliseconds", async () => {
    const tool = createCurrentTimeTool(frozenClock);
    const result = await tool.execute({}, makeContext());

    expect(result.ok).toBe(true);
    expect(result.observation).toContain("UTC: " + FIXED_ISO);
    expect(result.observation).toContain("UTC day: Monday");
    expect(result.observation).toContain(
      "Unix milliseconds: " + String(new Date(FIXED_ISO).getTime())
    );
  });

  it("derives the weekday from UTC, not from the host time zone", async () => {
    const tool = createCurrentTimeTool(
      () => new Date("2026-09-20T23:59:00.000Z")
    );
    const result = await tool.execute({}, makeContext());

    expect(result.observation).toContain("UTC day: Sunday");
  });

  it("renders a named time zone when one is supplied", async () => {
    const tool = createCurrentTimeTool(frozenClock);
    const result = await tool.execute({ timeZone: "Asia/Tokyo" }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.observation).toContain("In Asia/Tokyo:");
    expect(result.observation).toContain("UTC: " + FIXED_ISO);
  });

  it("degrades with a note when the time zone is not recognized", async () => {
    const tool = createCurrentTimeTool(frozenClock);
    const result = await tool.execute({ timeZone: "Mars/Olympus" }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.observation).toContain("not a recognized IANA time zone");
    expect(result.observation).toContain(FIXED_ISO);
  });

  it("tells the model not to guess local time when no zone is given", async () => {
    const tool = createCurrentTimeTool(frozenClock);
    const result = await tool.execute({}, makeContext());

    expect(result.observation).toContain("local time is unknown");
  });

  it("is deterministic for a given clock", async () => {
    const tool = createCurrentTimeTool(frozenClock);
    const first = await tool.execute({}, makeContext());
    const second = await tool.execute({}, makeContext());

    expect(first.observation).toBe(second.observation);
  });

  it("reports telemetry without content", async () => {
    const tool = createCurrentTimeTool(frozenClock);
    const result = await tool.execute({}, makeContext());

    expect(result.meta?.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.meta?.truncated).toBeUndefined();
  });

  it("refuses to run once the turn is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();

    const tool = createCurrentTimeTool(frozenClock);
    const result = await tool.execute({}, makeContext({ signal: controller.signal }));

    expect(result.ok).toBe(false);
    expect(result.observation).toContain("TOOL_ABORTED");
  });

  it("reports a broken clock instead of throwing", async () => {
    const tool = createCurrentTimeTool(() => new Date(Number.NaN));
    const result = await tool.execute({}, makeContext());

    expect(result.ok).toBe(false);
    expect(result.observation).toContain("TOOL_ERROR");
  });
});

describe("current_time tool - registered through the tool registry", () => {
  it("registers and stays callable when ENABLE_TOOL_USE is enabled", async () => {
    const registry = new ToolRegistry(only("ENABLE_TOOL_USE"));
    const tool = createCurrentTimeTool(frozenClock);

    expect(registry.register(tool)).toBe(true);
    expect(registry.has(CURRENT_TIME_TOOL_NAME)).toBe(true);

    const registered = registry.get(CURRENT_TIME_TOOL_NAME);

    if (!registered) throw new Error("tool was not registered");

    const result = await registered.execute({}, makeContext());

    expect(result.ok).toBe(true);
  });

  it("is absent when ENABLE_TOOL_USE is off", () => {
    const registry = new ToolRegistry(only());

    expect(registry.register(createCurrentTimeTool(frozenClock))).toBe(false);
    expect(registry.has(CURRENT_TIME_TOOL_NAME)).toBe(false);
    expect(registry.size()).toBe(0);
  });
});

describe("agent tool set - registration seam", () => {
  it("builds an empty registry while every flag is off", () => {
    const registry = buildAgentToolRegistry(only());

    expect(registry.size()).toBe(0);
    expect(registry.list()).toEqual([]);
  });

  it("builds the v1 tool set in order when ENABLE_TOOL_USE is enabled", () => {
    const registry = buildAgentToolRegistry(only("ENABLE_TOOL_USE"));

    expect(registry.list().map((tool) => tool.name)).toEqual([
      "current_time",
      "calculator",
      "memory_search",
    ]);
    expect(registry.size()).toBe(3);
  });

  it("initializes once and exposes the same registry afterwards", () => {
    initializeTools();

    const first = getToolRegistry();

    initializeTools();

    expect(getToolRegistry()).toBe(first);

    // No feature flag is set in the test environment, so nothing registers.
    expect(first.size()).toBe(0);
  });

  it("throws when the registry has not been initialized", async () => {
    vi.resetModules();

    const fresh = await import("@/lib/agent/tools/index");

    expect(() => fresh.getToolRegistry()).toThrow(/not been initialized/);
  }, 15000);
});