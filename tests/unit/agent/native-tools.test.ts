/**
 * Unit tests for the native tool-calling bridge.
 *
 * Hermetic by construction: no network, no Ollama, no Blender, no environment.
 * A provider is a plain object literal, and the registry is built with an
 * injected flag predicate.
 *
 * What matters here is the two properties the design depends on:
 *   - a tool is offered to a model only when it is registered, which is what
 *     keeps a feature-flagged tool invisible while its flag is off
 *   - a native call is validated by the tool's own parseArgs, so the native
 *     path cannot accept anything the prompt-based path would reject
 */

import { describe, expect, it } from "vitest";

import {
  normalizeNativeToolCall,
  supportsNativeTools,
  toProviderToolSchemas,
} from "@/lib/agent/native-tools";
import { buildAgentToolRegistry } from "@/lib/agent/tools/index";
import type { FlagPredicate } from "@/lib/agent/tools/registry";
import type { ChatCompletion, ProviderToolCall } from "@/lib/ai/types";

function only(...enabledFlags: string[]): FlagPredicate {
  const enabled = new Set<string>(enabledFlags);

  return (flag) => enabled.has(flag);
}

const ALL_TOOLS = buildAgentToolRegistry(
  only("ENABLE_TOOL_USE", "ENABLE_TOOL_BLENDER")
);
const NO_BLENDER = buildAgentToolRegistry(only("ENABLE_TOOL_USE"));
const EMPTY = buildAgentToolRegistry(only());

function completion(...toolCalls: ProviderToolCall[]): ChatCompletion {
  return { text: "", toolCalls };
}

describe("native-tools - provider detection", () => {
  it("recognises a provider that can be offered tools", () => {
    expect(supportsNativeTools({ chatWithTools: async () => completion() })).toBe(
      true
    );
  });

  it("rejects a provider without it, and anything malformed", () => {
    expect(supportsNativeTools({ chat: async () => "" })).toBe(false);
    expect(supportsNativeTools(null)).toBe(false);
    expect(supportsNativeTools(undefined)).toBe(false);
    expect(supportsNativeTools("nope")).toBe(false);
  });
});

describe("native-tools - registry to provider schemas", () => {
  it("offers every registered tool, in registration order", () => {
    const schemas = toProviderToolSchemas(ALL_TOOLS);

    expect(schemas.map((entry) => entry.function.name)).toEqual([
      "current_time",
      "calculator",
      "memory_search",
      "blender",
    ]);
  });

  it("describes each tool with its own description and a parameter schema", () => {
    for (const schema of toProviderToolSchemas(ALL_TOOLS)) {
      expect(schema.type).toBe("function");
      expect(schema.function.description.length).toBeGreaterThan(0);
      expect(schema.function.parameters.type).toBe("object");
    }
  });

  it("never offers a tool whose flag is off", () => {
    const names = toProviderToolSchemas(NO_BLENDER).map(
      (entry) => entry.function.name
    );

    expect(names.includes("blender")).toBe(false);
    expect(names).toContain("calculator");
  });

  it("offers nothing from an empty registry", () => {
    expect(toProviderToolSchemas(EMPTY)).toEqual([]);
  });
});

describe("native-tools - normalising a native call", () => {
  it("resolves a known tool and returns the existing tool_call shape", () => {
    const parsed = normalizeNativeToolCall(
      completion({ name: "calculator", arguments: { expression: "6*7" } }),
      ALL_TOOLS
    );

    expect(parsed?.kind).toBe("tool_call");

    if (parsed?.kind !== "tool_call") throw new Error("expected a tool call");

    expect(parsed.tool).toBe("calculator");
    expect(parsed.args).toEqual({ expression: "6*7" });
    expect(parsed.definition.name).toBe("calculator");
  });

  it("resolves a blender operation and primitive through the tool's parser", () => {
    const parsed = normalizeNativeToolCall(
      completion({
        name: "blender",
        arguments: { operation: "create_object", object_type: "cube" },
      }),
      ALL_TOOLS
    );

    expect(parsed?.kind).toBe("tool_call");

    if (parsed?.kind !== "tool_call") throw new Error("expected a tool call");

    expect(parsed.tool).toBe("blender");
    expect(parsed.args).toEqual({
      operation: "create_object",
      object_type: "cube",
      location: [0, 0, 0],
      scale: [1, 1, 1],
      name: "SalpaObject",
    });
  });

  it("returns null when the model made no call, so the text path still runs", () => {
    expect(normalizeNativeToolCall(completion(), ALL_TOOLS)).toBeNull();
  });

  it("reports an unknown tool instead of running anything", () => {
    const parsed = normalizeNativeToolCall(
      completion({ name: "delete_scene", arguments: {} }),
      ALL_TOOLS
    );

    expect(parsed).toEqual({
      kind: "invalid_tool_call",
      tool: "delete_scene",
      reason: "unknown_tool",
    });
  });

  it("refuses a flag-gated tool that is not registered", () => {
    const parsed = normalizeNativeToolCall(
      completion({
        name: "blender",
        arguments: { operation: "create_object", object_type: "cube" },
      }),
      NO_BLENDER
    );

    expect(parsed).toEqual({
      kind: "invalid_tool_call",
      tool: "blender",
      reason: "unknown_tool",
    });
  });

  it("lets the tool's own parser reject an unsupported primitive", () => {
    const parsed = normalizeNativeToolCall(
      completion({
        name: "blender",
        arguments: { operation: "create_object", object_type: "spaceship" },
      }),
      ALL_TOOLS
    );

    expect(parsed).toEqual({
      kind: "invalid_tool_call",
      tool: "blender",
      reason: "invalid_arguments",
    });
  });

  it("rejects a code-shaped argument no matter which path asked", () => {
    const parsed = normalizeNativeToolCall(
      completion({
        name: "blender",
        arguments: { operation: "create_object", object_type: "cube", script: "x" },
      }),
      ALL_TOOLS
    );

    expect(parsed).toEqual({
      kind: "invalid_tool_call",
      tool: "blender",
      reason: "invalid_arguments",
    });
  });

  it("reports a missing tool name", () => {
    const parsed = normalizeNativeToolCall(
      completion({ name: "   ", arguments: {} }),
      ALL_TOOLS
    );

    expect(parsed).toEqual({
      kind: "invalid_tool_call",
      tool: null,
      reason: "missing_tool_name",
    });
  });

  it("never throws on a malformed completion", () => {
    const broken = { text: 1, toolCalls: "no" } as unknown as ChatCompletion;

    expect(normalizeNativeToolCall(broken, ALL_TOOLS)).toBeNull();
    expect(
      normalizeNativeToolCall({ text: "", toolCalls: [null as never] }, ALL_TOOLS)
    ).toBeNull();
  });
});

