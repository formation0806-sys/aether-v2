/**
 * Blender tool.
 *
 * Additive Blender tool for the Salpa agent
 * (docs/BLENDER_TOOL_DESIGN.md).
 *
 * REGISTRATION: this tool is part of the live `AGENT_TOOLS` registry
 * (lib/agent/tools/index.ts) and is reachable through
 * `buildAgentToolRegistry()`, which is what the agent loop reads on every turn.
 * It is registered LAST, so `current_time`, `calculator`, and `memory_search`
 * keep their existing order and behaviour.
 *
 * AVAILABILITY: it is conditionally available and fails closed. It requires
 * BOTH `ENABLE_TOOL_USE` AND `ENABLE_TOOL_BLENDER` (see `requiredFlags`
 * below). The registry refuses any tool whose flags are unsatisfied, so when
 * either flag is off this tool is absent from the registry, absent from the
 * prompt manifest, and uncallable; `ENABLE_TOOL_BLENDER` on its own can never
 * activate it, and the intent gate's Blender category simply falls through to
 * the ordinary chat path. With both flags unset, which is the default, nothing
 * is registered at all.
 *
 * LOCAL ONLY: the transport reaches a loopback bridge on the user's own
 * machine. Remote or Vercel-hosted Blender is out of scope and unsupported.
 *
 * SECURITY POSTURE (design document sections 5, 6, 11):
 * - There is no `execute_python` tool, no script field, no expression field,
 *   and no generic command passthrough. `parseArgs` is an ALLOWLIST: any key
 *   outside the tables below is rejected, so `script`, `python`, `code`,
 *   `expression`, and `command` are rejected as unknown keys.
 * - Only two operations exist for this milestone: `create_object` and
 *   `inspect_scene`. No materials, rendering, camera control, file
 *   load/save, deletion, or scripting.
 * - Validation is hand-written and returns `null` on any problem, matching the
 *   project's existing tolerant-parser convention
 *   (lib/agent/tools/memory-search.ts:83-99, lib/agent/protocol.ts:167-176).
 *   No schema library is introduced; `zod` remains unused by the application.
 * - `execute` never throws. Every failure becomes an `ok: false` `ToolResult`
 *   with a fixed, content-free observation, so a stack trace, a filesystem
 *   path, the bridge URL, and the token can never reach the model.
 *
 * The transport is injected, so unit tests exercise the whole tool with no
 * socket, no Blender, and no environment.
 */

import type {
  ToolArgsParser,
  ToolContext,
  ToolDefinition,
  ToolResult,
} from "./types";

import {
  BLENDER_OBJECT_TYPES,
  BlenderBridgeError,
  MAX_OBJECT_NAME_LENGTH,
  MAX_SCENE_OBJECTS,
  createBlenderBridgeClient,
} from "./blender-client";
import type {
  BlenderBridgeClient,
  BlenderBridgeRequest,
  BlenderObjectSummary,
  BlenderObjectType,
  BlenderVec3,
} from "./blender-client";

/** Tool name the model would address. Paired with `operation` it forms
 *  `blender.<operation>`, e.g. `blender.create_object`. */
export const BLENDER_TOOL_NAME = "blender";

/** The two operations in scope for this milestone. */
export const BLENDER_OPERATIONS = Object.freeze([
  "create_object",
  "inspect_scene",
] as const);

export type BlenderOperation = (typeof BLENDER_OPERATIONS)[number];

/** Re-exported so the bridge and its tests share one source of truth. */
export { BLENDER_OBJECT_TYPES };

/** Upper bound on the magnitude of a location component. */
export const MAX_LOCATION_COMPONENT = 10_000;

/** Upper bound on the magnitude of a scale component. */
export const MAX_SCALE_COMPONENT = 1_000;

/** Smallest accepted scale component. Strictly positive, never zero. */
export const MIN_SCALE_COMPONENT = 0.0001;

/** Argument keys accepted by `create_object`. Anything else is rejected. */
export const CREATE_OBJECT_KEYS: readonly string[] = Object.freeze([
  "operation",
  "object_type",
  "location",
  "scale",
  "name",
]);

/** Argument keys accepted by `inspect_scene`. Anything else is rejected. */
export const INSPECT_SCENE_KEYS: readonly string[] = Object.freeze([
  "operation",
]);

/**
 * Keys that look like an attempt to smuggle code or a raw command past the
 * allowlist. Rejected automatically as unknown keys; named here so the
 * rejection is documented and directly testable (design section 5.4).
 */
export const FORBIDDEN_ARGUMENT_KEYS: readonly string[] = Object.freeze([
  "script",
  "python",
  "code",
  "expression",
  "command",
]);

/** Validated arguments for the two in-scope operations. */
export type BlenderToolArgs =
  | {
      operation: "create_object";
      object_type: BlenderObjectType;
      location: BlenderVec3;
      scale: BlenderVec3;
      name: string;
    }
  | { operation: "inspect_scene" };

/** Fixed observation prefixes. The vocabulary is closed and deterministic. */
export const BLENDER_OK = "BLENDER_OK";
export const BLENDER_UNAVAILABLE = "BLENDER_UNAVAILABLE";
export const BLENDER_ERROR = "BLENDER_ERROR";

export const BLENDER_UNAVAILABLE_OBSERVATION =
  "BLENDER_UNAVAILABLE: the local Blender bridge is not reachable.";
export const BLENDER_REJECTED_OBSERVATION =
  "BLENDER_ERROR: the Blender bridge rejected the request.";
export const BLENDER_TIMEOUT_OBSERVATION =
  "BLENDER_ERROR: the Blender bridge did not respond in time.";
export const BLENDER_GENERIC_OBSERVATION =
  "BLENDER_ERROR: the Blender bridge could not complete the request.";

/* -------------------------------------------------------------------------- */
/* Validation helpers. Every one is total and never throws.                    */
/* -------------------------------------------------------------------------- */

/** An allowlisted operation, or null. */
function toOperation(raw: unknown): BlenderOperation | null {
  try {
    if (typeof raw !== "string") return null;

    for (const operation of BLENDER_OPERATIONS) {
      if (raw === operation) return operation;
    }

    return null;
  } catch {
    return null;
  }
}

/** An allowlisted primitive, or null. */
function toObjectType(raw: unknown): BlenderObjectType | null {
  try {
    if (typeof raw !== "string") return null;

    for (const allowed of BLENDER_OBJECT_TYPES) {
      if (raw === allowed) return allowed;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * An optional three-component vector within bounds, or null.
 *
 * Rejects a wrong length, a non-number, a non-finite value, and a value beyond
 * the magnitude limit. Never coerces a string.
 */
function toBoundedVec3(
  raw: unknown,
  limit: number,
  minimum: number | null,
): BlenderVec3 | null {
  try {
    if (!Array.isArray(raw) || raw.length !== 3) return null;

    const out: [number, number, number] = [0, 0, 0];

    for (let index = 0; index < 3; index += 1) {
      const value = raw[index];

      if (typeof value !== "number") return null;
      if (!Number.isFinite(value)) return null;
      if (Math.abs(value) > limit) return null;
      if (minimum !== null && value < minimum) return null;

      out[index] = value;
    }

    return out;
  } catch {
    return null;
  }
}

/**
 * A single-line, length-capped, printable object name, or null.
 *
 * Rejects rather than truncates, because a silently shortened name would
 * change what Blender creates without the model knowing
 * (same reasoning as lib/agent/tools/memory-search.ts:78-82).
 */
function toObjectName(raw: unknown): string | null {
  try {
    if (typeof raw !== "string") return null;

    const cleaned = raw
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (cleaned === "") return null;
    if (cleaned.at(MAX_OBJECT_NAME_LENGTH) !== undefined) return null;

    return cleaned;
  } catch {
    return null;
  }
}

/** True only when every key is in the allowlist. */
function hasOnlyKeys(
  source: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  try {
    for (const key of Object.keys(source)) {
      if (!allowed.includes(key)) return false;
    }

    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Argument parsing                                                           */
/* -------------------------------------------------------------------------- */

const parseCreateObject = (
  source: Record<string, unknown>,
): BlenderToolArgs | null => {
  if (!hasOnlyKeys(source, CREATE_OBJECT_KEYS)) return null;

  const objectType = toObjectType(source["object_type"]);

  if (objectType === null) return null;

  // Only `undefined` means "absent" and falls back to the documented default.
  // An explicit `null` is malformed input and is rejected, never coerced.
  const rawLocation = source["location"];
  const location =
    rawLocation === undefined
      ? ([0, 0, 0] as const)
      : toBoundedVec3(rawLocation, MAX_LOCATION_COMPONENT, null);

  if (location === null) return null;

  const rawScale = source["scale"];
  const scale =
    rawScale === undefined
      ? ([1, 1, 1] as const)
      : toBoundedVec3(rawScale, MAX_SCALE_COMPONENT, MIN_SCALE_COMPONENT);

  if (scale === null) return null;

  const rawName = source["name"];
  const name =
    rawName === undefined ? "SalpaObject" : toObjectName(rawName);

  if (name === null) return null;

  return { operation: "create_object", object_type: objectType, location, scale, name };
};

const parseInspectScene = (
  source: Record<string, unknown>,
): BlenderToolArgs | null => {
  if (!hasOnlyKeys(source, INSPECT_SCENE_KEYS)) return null;

  return { operation: "inspect_scene" };
};

/**
 * Tolerant argument parsing: never throws.
 *
 * A missing operation, an unknown operation, an unsupported object type, a
 * malformed value, and any unknown key all return `null`, which the protocol
 * turns into `invalid_tool_call` (lib/agent/protocol.ts:217-219).
 */
const parseArgs: ToolArgsParser<BlenderToolArgs> = (raw) => {
  try {
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== "object" || Array.isArray(raw)) return null;

    const source = raw as Record<string, unknown>;
    const operation = toOperation(source["operation"]);

    if (operation === null) return null;

    return operation === "create_object"
      ? parseCreateObject(source)
      : parseInspectScene(source);
  } catch {
    return null;
  }
};

/* -------------------------------------------------------------------------- */
/* Observation rendering                                                      */
/* -------------------------------------------------------------------------- */

/** Formats a vector for the model. Values are already validated and finite. */
function formatVec3(vector: BlenderVec3): string {
  return "(" + vector.map((value) => String(value)).join(", ") + ")";
}

/** Renders a created object. Every field was sanitised on ingest. */
export function formatCreatedObject(object: BlenderObjectSummary): string {
  return (
    BLENDER_OK +
    ": created " +
    object.name +
    " (" +
    object.object_type +
    ") at " +
    formatVec3(object.location) +
    "."
  );
}

/** Renders the scene listing, capped and single-line per object. */
export function formatSceneObjects(
  objects: readonly BlenderObjectSummary[],
): string {
  const header =
    BLENDER_OK +
    ": the scene contains " +
    String(objects.length) +
    (objects.length === 1 ? " object." : " objects.");

  if (objects.length === 0) return header;

  const lines = objects
    .slice(0, MAX_SCENE_OBJECTS)
    .map(
      (object, index) =>
        String(index + 1) +
        ". " +
        object.name +
        " (" +
        object.object_type +
        ") at " +
        formatVec3(object.location),
    );

  return [header, ...lines].join("\n");
}

/** Maps a bridge-reported failure code to a fixed observation. */
function failureObservation(code: string): string {
  if (code === "unavailable") return BLENDER_UNAVAILABLE_OBSERVATION;
  if (code === "rejected") return BLENDER_REJECTED_OBSERVATION;
  if (code === "timeout") return BLENDER_TIMEOUT_OBSERVATION;

  return BLENDER_GENERIC_OBSERVATION;
}

/* -------------------------------------------------------------------------- */
/* The tool                                                                   */
/* -------------------------------------------------------------------------- */

/** Builds the validated request for an operation. */
function toBridgeRequest(args: BlenderToolArgs): BlenderBridgeRequest {
  if (args.operation === "inspect_scene") {
    return { command: "inspect_scene" };
  }

  return {
    command: "create_object",
    object_type: args.object_type,
    location: args.location,
    scale: args.scale,
    name: args.name,
  };
}

/**
 * Builds the tool. The client is injectable, so unit tests run the entire tool
 * with no socket, no Blender, and no environment. Production callers omit it.
 */
export function createBlenderTool(
  client: BlenderBridgeClient = createBlenderBridgeClient(),
): ToolDefinition<BlenderToolArgs> {
  return {
    name: BLENDER_TOOL_NAME,
    // Wording matters: this string is the ONLY thing the model sees about the
    // tool, and the manifest renders it verbatim next to the tool name.
    //
    // Two earlier defects are guarded against here:
    //  - Step 6: the operations were listed as bare quoted identifiers, and the
    //    model read one of them as a selectable tool name. They are therefore
    //    never presented bare, and the tool name is stated outright.
    //  - Step 7.2.2: the model was never shown the required ARGS KEY, so it
    //    invented one and emitted {"inspect_scene": true} or
    //    {"action": "inspect_scene"}, both of which parseArgs rejects. The
    //    two concrete call examples below are the fix: they show the literal
    //    "operation" key in situ.
    //
    // MUST stay ONE physical line: composeToolManifest (lib/agent/prompt.ts)
    // emits one manifest line per tool, so an embedded newline would corrupt
    // the manifest.
    description:
      "Controls a local Blender scene through an allowlisted bridge. " +
      "The tool name is blender. " +
      'Inside args, the key "operation" is required, and its value must be ' +
      "create_object or inspect_scene. " +
      "An operation value is never a tool name and never an argument key. " +
      "Inspect the scene: " +
      '{"tool": "blender", "args": {"operation": "inspect_scene"}} ' +
      "- this takes no other arguments. " +
      "Create an object: " +
      '{"tool": "blender", "args": {"operation": "create_object", "object_type": "cube"}} ' +
      "- create_object also accepts the optional keys location, scale, and name. " +
      "It cannot run code, load or save files, delete anything, or render.",
    requiredFlags: ["ENABLE_TOOL_USE", "ENABLE_TOOL_BLENDER"],
    // Description only. The allowlists below (BLENDER_OPERATIONS,
    // BLENDER_OBJECT_TYPES, CREATE_OBJECT_KEYS) remain the sole authority:
    // parseArgs still rejects anything this schema would let through.
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: BLENDER_OPERATIONS,
          description:
            "create_object adds one primitive to the scene; inspect_scene lists what is already there.",
        },
        object_type: {
          type: "string",
          enum: BLENDER_OBJECT_TYPES,
          description: "The primitive to create. Used only by create_object.",
        },
        location: {
          type: "array",
          items: { type: "number" },
          minItems: 3,
          maxItems: 3,
          description: "Optional [x, y, z] world position. Defaults to [0, 0, 0].",
        },
        scale: {
          type: "array",
          items: { type: "number" },
          minItems: 3,
          maxItems: 3,
          description:
            "Optional [x, y, z] scale, each component strictly positive. Defaults to [1, 1, 1].",
        },
        name: {
          type: "string",
          description: "Optional single-line name for the new object.",
        },
      },
      required: ["operation"],
    },
    // Kept below AGENT_TOOL_TIMEOUT_MS (10_000); see design section 14.1.
    timeoutMs: 8000,
    parseArgs,
    async execute(
      args: BlenderToolArgs,
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const startedAt = Date.now();

      const done = (ok: boolean, observation: string): ToolResult => ({
        ok,
        observation,
        meta: { durationMs: Date.now() - startedAt },
      });

      if (ctx.signal.aborted) {
        return done(
          false,
          "TOOL_ABORTED: the turn was cancelled before the tool started.",
        );
      }

      try {
        const response = await client.send(toBridgeRequest(args));

        if (!response.ok) {
          return done(false, failureObservation(response.code));
        }

        if (args.operation === "create_object") {
          return response.object === undefined
            ? done(false, BLENDER_GENERIC_OBSERVATION)
            : done(true, formatCreatedObject(response.object));
        }

        return done(true, formatSceneObjects(response.objects ?? []));
      } catch (error) {
        // Deliberately opaque. Only our own fixed code is used; a message from
        // the bridge, the transport, or the runtime never reaches the model.
        if (error instanceof BlenderBridgeError) {
          return done(false, failureObservation(error.code));
        }

        return done(false, BLENDER_GENERIC_OBSERVATION);
      }
    },
  };
}

/**
 * Production instance.
 *
 * Registered as the last entry of `AGENT_TOOLS` (lib/agent/tools/index.ts),
 * so `buildAgentToolRegistry()` returns it only when both `ENABLE_TOOL_USE` and
 * `ENABLE_TOOL_BLENDER` are enabled. With either flag off the registry omits
 * it, so the model is never offered it and `parseToolCall` reports
 * `unknown_tool`.
 */
export const blenderTool = createBlenderTool();
