/**
 * Tool-call protocol parser.
 *
 * The system prompt asks the model to emit one JSON object of the shape shown in
 * TOOL_CALL_SHAPE to call a tool, and to answer in plain text otherwise. This
 * module turns a raw model response into one of three outcomes:
 *
 *   - tool_call         a known tool with validated arguments
 *   - invalid_tool_call an attempted tool call that cannot run: unknown tool,
 *                       unusable arguments, or malformed JSON that clearly tried
 *                       to be a tool call
 *   - final_answer      no tool call present, so the text is the answer
 *
 * Tolerances, matching how the rest of the codebase already handles a small local
 * model:
 *   - the object may be surrounded by prose or inside a code fence
 *   - candidates are scanned with string-aware brace matching, so braces inside
 *     string values never end the object early
 *   - the first candidate that both balances and parses wins; earlier non-JSON
 *     brace groups are skipped
 *   - single-quoted "tool" keys are recognised as attempted calls so the loop can
 *     ask the model to retry instead of printing raw JSON to the user
 *
 * Safety properties:
 *   - never throws, for any input, including non-strings
 *   - plain prose that merely contains braces is a final answer, so ordinary text
 *     can never be mistaken for a tool call
 *   - work is bounded: candidate scanning is capped
 *
 * Both imports are type-only, so this module has no runtime dependencies and no
 * side effects. Nothing imports it in production yet.
 */

import type { ToolRegistry } from "./tools/registry";
import type { ToolDefinition } from "./tools/types";

/** The exact shape the system prompt asks the model to emit. */
export const TOOL_CALL_SHAPE = "{\"tool\": \"<tool name>\", \"args\": { ... }}";

/** Why an attempted tool call could not be executed. */
export type ProtocolFailureReason =
  | "malformed_json"
  | "missing_tool_name"
  | "unknown_tool"
  | "invalid_arguments";

/** Outcome of parsing one model response. */
export type ToolCallParseResult =
  | {
      kind: "tool_call";
      tool: string;
      args: Record<string, unknown>;
      definition: ToolDefinition;
    }
  | {
      kind: "invalid_tool_call";
      tool: string | null;
      reason: ProtocolFailureReason;
    }
  | { kind: "final_answer"; text: string };

const TOOL_KEY = "tool";
const ARGS_KEY = "args";

/** A JSON-ish hint that the model tried to describe a tool call. */
const TOOL_CALL_HINT = /(?:\"tool\"|'tool')\s*:/;

/** Bound on candidate objects examined, so pathological input stays cheap. */
const MAX_CANDIDATES = 32;

/**
 * Returns the first balanced JSON object at or after fromIndex, or null when the
 * braces never balance. Brace matching ignores braces inside JSON strings.
 */
export function extractBalancedJsonObject(
  text: string,
  fromIndex = 0
): string | null {
  if (typeof text !== "string") return null;

  const start = text.indexOf("{", fromIndex);

  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index !== text.length; index += 1) {
    const ch = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }

      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") {
      depth += 1;
      continue;
    }

    if (ch === "}") {
      depth -= 1;

      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  return null;
}

/** A JSON object, or null for null, arrays, and scalars. */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

/**
 * Walks every opening brace and returns the first candidate that balances and
 * parses as a JSON object. Returns null when there is no JSON object at all.
 */
function firstJsonObject(text: string): Record<string, unknown> | null {
  let searchFrom = 0;
  let examined = 0;

  for (;;) {
    if (examined === MAX_CANDIDATES) return null;

    const start = text.indexOf("{", searchFrom);

    if (start === -1) return null;

    examined += 1;

    const candidate = extractBalancedJsonObject(text, start);

    if (candidate !== null) {
      try {
        const record = asRecord(JSON.parse(candidate));

        if (record !== null) return record;
      } catch {
        // Not JSON: keep looking after this opening brace.
      }
    }

    searchFrom = start + 1;
  }
}

/** Argument parsing is delegated to the tool and guarded: it must never throw. */
function parseArguments(
  definition: ToolDefinition,
  raw: unknown
): Record<string, unknown> | null {
  try {
    return definition.parseArgs(raw);
  } catch {
    return null;
  }
}

/**
 * Parses one model response. Never throws.
 *
 * A tool name is resolved against the registry, which is flag-aware: a tool whose
 * feature flag is off is not registered, so it reports as unknown_tool.
 */
export function parseToolCall(
  response: string,
  registry: ToolRegistry
): ToolCallParseResult {
  if (typeof response !== "string") return { kind: "final_answer", text: "" };

  const hint = TOOL_CALL_HINT.test(response);

  const object = firstJsonObject(response);

  if (object === null) {
    return hint
      ? { kind: "invalid_tool_call", tool: null, reason: "malformed_json" }
      : { kind: "final_answer", text: response };
  }

  if (!(TOOL_KEY in object)) return { kind: "final_answer", text: response };

  const rawName = object[TOOL_KEY];

  if (typeof rawName !== "string" || rawName.trim() === "") {
    return { kind: "invalid_tool_call", tool: null, reason: "missing_tool_name" };
  }

  const name = rawName.trim();
  const definition = registry.get(name);

  if (!definition) {
    return { kind: "invalid_tool_call", tool: name, reason: "unknown_tool" };
  }

  const args = parseArguments(definition, object[ARGS_KEY]);

  if (args === null) {
    return { kind: "invalid_tool_call", tool: name, reason: "invalid_arguments" };
  }

  return { kind: "tool_call", tool: definition.name, args, definition };
}