import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  TOOL_CALL_SHAPE,
  extractBalancedJsonObject,
  parseToolCall,
} from "@/lib/agent/protocol";
import { buildAgentToolRegistry } from "@/lib/agent/tools/index";
import type { FlagPredicate } from "@/lib/agent/tools/registry";

function only(...enabledFlags: string[]): FlagPredicate {
  const enabled = new Set<string>(enabledFlags);

  return (flag) => enabled.has(flag);
}

/** The registry the loop will use: every v1 tool, ENABLE_TOOL_USE on. */
const REGISTRY = buildAgentToolRegistry(only("ENABLE_TOOL_USE"));

/** Flags off, so nothing is registered: mirrors the default environment. */
const EMPTY_REGISTRY = buildAgentToolRegistry(only());

const SOURCE = readFileSync(
  path.join(process.cwd(), "lib", "agent", "protocol.ts"),
  "utf8"
);

/** Builds a protocol-shaped response without hand-escaping JSON. */
function toolCallJson(tool: unknown, args?: unknown): string {
  if (args === undefined) return JSON.stringify({ tool });

  return JSON.stringify({ tool, args });
}

describe("protocol - documented shape", () => {
  it("names both keys the parser expects", () => {
    expect(TOOL_CALL_SHAPE.includes("tool")).toBe(true);
    expect(TOOL_CALL_SHAPE.includes("args")).toBe(true);
  });
});

describe("protocol - balanced JSON extraction", () => {
  it("extracts a clean object", () => {
    expect(extractBalancedJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it("extracts an object surrounded by prose", () => {
    expect(extractBalancedJsonObject('Sure! {"a":1} done.')).toBe('{"a":1}');
  });

  it("extracts an object inside a code fence", () => {
    const fenced = "```json\n{\"a\":1}\n```";

    expect(extractBalancedJsonObject(fenced)).toBe('{"a":1}');
  });

  it("keeps nested objects intact", () => {
    const nested = '{"tool":"a","args":{"q":{"n":[1,2]}}}';

    expect(extractBalancedJsonObject(nested)).toBe(nested);
  });

  it("ignores braces inside string values", () => {
    const withBraces = '{"tool":"a","args":{"q":"{ not a brace }"}}';

    expect(extractBalancedJsonObject(withBraces)).toBe(withBraces);
  });

  it("ignores escaped quotes and the braces that follow them", () => {
    const escaped = JSON.stringify({
      tool: "current_time",
      args: { note: 'say "hi" }' },
    });

    expect(extractBalancedJsonObject(escaped)).toBe(escaped);
  });

  it("returns null when the braces never balance", () => {
    expect(extractBalancedJsonObject('{"a":1')).toBeNull();
  });

  it("returns null when there is no brace at all", () => {
    expect(extractBalancedJsonObject("no braces here")).toBeNull();
  });

  it("honours fromIndex so later objects can be reached", () => {
    const text = '{"a":1} and {"b":2}';

    expect(extractBalancedJsonObject(text)).toBe('{"a":1}');
    expect(extractBalancedJsonObject(text, 7)).toBe('{"b":2}');
  });

  it("returns null for non-string input", () => {
    expect(extractBalancedJsonObject(undefined as unknown as string)).toBeNull();
    expect(extractBalancedJsonObject(5 as unknown as string)).toBeNull();
  });
});

describe("protocol - valid tool calls", () => {
  it("parses a calculator call with validated arguments", () => {
    const result = parseToolCall(
      toolCallJson("calculator", { expression: "2+2" }),
      REGISTRY
    );

    expect(result.kind).toBe("tool_call");

    if (result.kind !== "tool_call") throw new Error("expected a tool call");

    expect(result.tool).toBe("calculator");
    expect(result.args).toEqual({ expression: "2+2" });
    expect(result.definition).toBe(REGISTRY.get("calculator"));
  });

  it("parses a call that omits the args key", () => {
    const result = parseToolCall(toolCallJson("current_time"), REGISTRY);

    expect(result.kind).toBe("tool_call");

    if (result.kind !== "tool_call") throw new Error("expected a tool call");

    expect(result.args).toEqual({});
  });

  it("parses a call with an empty args object", () => {
    const result = parseToolCall(toolCallJson("current_time", {}), REGISTRY);

    expect(result.kind).toBe("tool_call");
  });

  it("trims a padded tool name", () => {
    const result = parseToolCall(toolCallJson(" calculator ", { expression: "1+1" }), REGISTRY);

    expect(result.kind).toBe("tool_call");

    if (result.kind !== "tool_call") throw new Error("expected a tool call");

    expect(result.tool).toBe("calculator");
  });

  it("parses a call wrapped in prose", () => {
    const response =
      "Let me check the time. " + toolCallJson("current_time") + " one moment";

    expect(parseToolCall(response, REGISTRY).kind).toBe("tool_call");
  });

  it("parses a call inside a code fence", () => {
    const response = "```json\n" + toolCallJson("current_time") + "\n```";

    expect(parseToolCall(response, REGISTRY).kind).toBe("tool_call");
  });

  it("parses a call from an array-wrapped response", () => {
    const response = JSON.stringify([{ tool: "current_time" }]);

    expect(parseToolCall(response, REGISTRY).kind).toBe("tool_call");
  });

  it("parses a memory_search call", () => {
    const result = parseToolCall(
      toolCallJson("memory_search", { query: "where does the user live" }),
      REGISTRY
    );

    expect(result.kind).toBe("tool_call");

    if (result.kind !== "tool_call") throw new Error("expected a tool call");

    expect(result.args).toEqual({ query: "where does the user live" });
  });
});

describe("protocol - recoverable failures", () => {
  it("reports an unknown tool", () => {
    const result = parseToolCall(toolCallJson("web_search", {}), REGISTRY);

    expect(result).toEqual({
      kind: "invalid_tool_call",
      tool: "web_search",
      reason: "unknown_tool",
    });
  });

  it("reports a flag-disabled tool as unknown", () => {
    const result = parseToolCall(
      toolCallJson("calculator", { expression: "2+2" }),
      EMPTY_REGISTRY
    );

    expect(result).toEqual({
      kind: "invalid_tool_call",
      tool: "calculator",
      reason: "unknown_tool",
    });
  });

  it("reports unusable arguments", () => {
    const result = parseToolCall(
      toolCallJson("calculator", { expression: "   " }),
      REGISTRY
    );

    expect(result).toEqual({
      kind: "invalid_tool_call",
      tool: "calculator",
      reason: "invalid_arguments",
    });
  });

  it("reports arguments that are not an object", () => {
    const result = parseToolCall(toolCallJson("calculator", "2+2"), REGISTRY);

    expect(result.kind).toBe("invalid_tool_call");

    if (result.kind !== "invalid_tool_call") throw new Error("expected a failure");

    expect(result.reason).toBe("invalid_arguments");
  });

  it("reports missing required arguments", () => {
    const result = parseToolCall(toolCallJson("calculator"), REGISTRY);

    expect(result.kind).toBe("invalid_tool_call");

    if (result.kind !== "invalid_tool_call") throw new Error("expected a failure");

    expect(result.reason).toBe("invalid_arguments");
  });

  it("reports a non-string tool name", () => {
    const result = parseToolCall(toolCallJson(42), REGISTRY);

    expect(result).toEqual({
      kind: "invalid_tool_call",
      tool: null,
      reason: "missing_tool_name",
    });
  });

  it("reports an empty tool name", () => {
    const result = parseToolCall(toolCallJson("   "), REGISTRY);

    expect(result.kind).toBe("invalid_tool_call");

    if (result.kind !== "invalid_tool_call") throw new Error("expected a failure");

    expect(result.reason).toBe("missing_tool_name");
  });

  it("reports malformed JSON that tried to be a tool call", () => {
    const truncated = '{"tool":"calculator","args":{"expression":"2+2"';

    expect(parseToolCall(truncated, REGISTRY)).toEqual({
      kind: "invalid_tool_call",
      tool: null,
      reason: "malformed_json",
    });
  });

  it("reports a single-quoted attempt", () => {
    expect(parseToolCall("{'tool': 'calculator'}", REGISTRY)).toEqual({
      kind: "invalid_tool_call",
      tool: null,
      reason: "malformed_json",
    });
  });

  it("reports a tool hint with no JSON at all", () => {
    expect(parseToolCall('I will use "tool": calculator', REGISTRY)).toEqual({
      kind: "invalid_tool_call",
      tool: null,
      reason: "malformed_json",
    });
  });
});

describe("protocol - plain answers are never hijacked", () => {
  it("returns prose as the final answer", () => {
    const response = "The answer is 4.";
    const result = parseToolCall(response, REGISTRY);

    expect(result).toEqual({ kind: "final_answer", text: response });
  });

  it("returns prose containing braces as the final answer", () => {
    const response = "Use {curly braces} for sets.";

    expect(parseToolCall(response, REGISTRY)).toEqual({
      kind: "final_answer",
      text: response,
    });
  });

  it("returns a JSON object without a tool key as the final answer", () => {
    const response = '{"answer":"4"}';

    expect(parseToolCall(response, REGISTRY)).toEqual({
      kind: "final_answer",
      text: response,
    });
  });

  it("returns text with a non-JSON brace group and no hint as the final answer", () => {
    const response = "See {a, b} for details.";

    expect(parseToolCall(response, REGISTRY)).toEqual({
      kind: "final_answer",
      text: response,
    });
  });

  it("skips a non-JSON brace group that precedes a real call", () => {
    const response = 'Use {a, b} then ' + toolCallJson("current_time");

    expect(parseToolCall(response, REGISTRY).kind).toBe("tool_call");
  });
});

describe("protocol - robustness", () => {
  it("returns an empty final answer for a non-string response", () => {
    expect(parseToolCall(undefined as unknown as string, REGISTRY)).toEqual({
      kind: "final_answer",
      text: "",
    });
  });

  it("never throws, for any input", () => {
    const nastyResponses = [
      "",
      " ",
      "{",
      "}",
      "{}",
      "[]",
      "null",
      '{"tool":',
      '{"tool":"x","args":{',
      "{".repeat(200) + "}",
      "x".repeat(5000),
      '{"tool":"calculator","args":{"expression":"' + "1".repeat(500) + '"}}',
      "\u{1F600}",
      '{"tool":"calculator","args":{"expression":"2+2"}} trailing {',
    ];

    for (const response of nastyResponses) {
      let result = null as ReturnType<typeof parseToolCall> | null;

      expect(() => {
        result = parseToolCall(response, REGISTRY);
      }).not.toThrow();

      expect(["tool_call", "invalid_tool_call", "final_answer"]).toContain(
        result?.kind
      );
    }
  });

  it("is deterministic for a given response", () => {
    const response = 'Here you go: ' + toolCallJson("calculator", { expression: "2+2" });

    expect(parseToolCall(response, REGISTRY).kind).toBe(
      parseToolCall(response, REGISTRY).kind
    );
  });

  it("never mutates the registry", () => {
    parseToolCall(toolCallJson("calculator", { expression: "2+2" }), REGISTRY);
    parseToolCall(toolCallJson("web_search", {}), REGISTRY);
    parseToolCall('{"tool":', REGISTRY);

    expect(REGISTRY.size()).toBe(3);
  });
});

describe("protocol - purity", () => {
  const importLines = SOURCE.split("\n").filter((line) =>
    line.trimStart().startsWith("import ")
  );

  it("imports types only, so it has no runtime dependencies", () => {
    expect(importLines.length).toBe(2);

    for (const line of importLines) {
      expect(line.trimStart().startsWith("import type ")).toBe(true);
    }
  });

  it("never reads the environment, the clock, or randomness", () => {
    const forbidden = [
      "process.env",
      "Date.now",
      "new Date",
      "Math.random",
      "setTimeout",
      "fetch(",
    ];

    for (const token of forbidden) {
      expect(SOURCE.includes(token)).toBe(false);
    }
  });
});