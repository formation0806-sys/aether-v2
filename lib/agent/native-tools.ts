/**
 * Native tool calling bridge for the agent loop.
 *
 * Two pure conversions, and nothing else:
 *
 *   1. registry        -> provider tool schemas
 *   2. provider call   -> the existing ToolCallParseResult
 *
 * Why this exists. The agent could previously only reach a tool by asking the
 * model to imitate a JSON contract in the system prompt. That is discretionary:
 * the same model, given the same contract, would sometimes emit the JSON and
 * sometimes answer in prose from its own capability instead. Offering the tools
 * through the provider's own tool API makes the choice structural rather than
 * something the model has to remember to do.
 *
 * What this does NOT do. It grants no capability and moves no boundary:
 *   - only tools already in the flag-aware registry are offered, so a disabled
 *     tool is never visible to a model;
 *   - the tool name is resolved against that same registry, so an unknown name
 *     is `unknown_tool` exactly as it is for a prompt-based call;
 *   - arguments are validated by the tool's own `parseArgs`, so every existing
 *     allowlist, bound, and key check still applies unchanged;
 *   - `parseToolCall` is untouched and remains the fallback for providers that
 *     do not support native tool calling.
 *
 * Every function here is pure and total: no throws, no I/O, no clock.
 */

import type {
  ChatCompletion,
  ProviderToolCall,
  ProviderToolSchema,
} from "@/lib/ai/types";

import type { ToolCallParseResult } from "./protocol";
import type { ToolRegistry } from "./tools/registry";

/**
 * Provider surface the loop uses when it is available.
 *
 * Optional so a provider without native tool support keeps working through
 * `chat()` alone.
 */
export interface NativeChatProvider {
  chatWithTools?(
    messages: unknown,
    tools: ProviderToolSchema[]
  ): Promise<ChatCompletion>;
}

/** True when this provider can be offered tools natively. */
export function supportsNativeTools(provider: unknown): boolean {
  try {
    return (
      provider !== null &&
      typeof provider === "object" &&
      typeof (provider as { chatWithTools?: unknown }).chatWithTools === "function"
    );
  } catch {
    return false;
  }
}

/**
 * Renders the registered tools as provider tool schemas.
 *
 * Only tools that declare a parameter schema are offered; a tool without one
 * stays reachable through the prompt-based contract. Registration order is
 * preserved, and the registry is already flag-aware, so a disabled tool cannot
 * appear here.
 */
export function toProviderToolSchemas(
  registry: ToolRegistry
): ProviderToolSchema[] {
  try {
    const out: ProviderToolSchema[] = [];

    for (const tool of registry.list()) {
      const parameters = tool.parameters;

      if (parameters === undefined || parameters === null) continue;

      out.push({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: parameters as unknown as Record<string, unknown>,
        },
      });
    }

    return out;
  } catch {
    return [];
  }
}

/**
 * Normalizes the first native tool call into the loop's existing shape.
 *
 * Returns null when the provider produced no usable call, so the caller can
 * fall back to the text-based path. The first call wins, matching the
 * one-tool-per-turn rule the prompt already states.
 */
export function normalizeNativeToolCall(
  completion: ChatCompletion,
  registry: ToolRegistry
): ToolCallParseResult | null {
  try {
    const calls = completion?.toolCalls;

    if (!Array.isArray(calls) || calls.length === 0) return null;

    for (const call of calls) {
      const parsed = normalizeOne(call, registry);

      if (parsed !== null) return parsed;
    }

    return null;
  } catch {
    return null;
  }
}

/** One call, or null when it cannot be honoured. Never throws. */
function normalizeOne(
  call: ProviderToolCall,
  registry: ToolRegistry
): ToolCallParseResult | null {
  try {
    if (call === null || typeof call !== "object") return null;

    const name = call.name;

    if (typeof name !== "string" || name.trim() === "") {
      return {
        kind: "invalid_tool_call",
        tool: null,
        reason: "missing_tool_name",
      };
    }

    const trimmed = name.trim();
    const definition = registry.get(trimmed);

    if (definition === undefined) {
      return { kind: "invalid_tool_call", tool: trimmed, reason: "unknown_tool" };
    }

    // The tool decides. A schema is a description, never an authority, so the
    // same parseArgs that guards the prompt-based path guards this one.
    let args: Record<string, unknown> | null = null;

    try {
      args = definition.parseArgs(call.arguments) as Record<string, unknown> | null;
    } catch {
      args = null;
    }

    if (args === null) {
      return {
        kind: "invalid_tool_call",
        tool: trimmed,
        reason: "invalid_arguments",
      };
    }

    return { kind: "tool_call", tool: definition.name, args, definition };
  } catch {
    return null;
  }
}