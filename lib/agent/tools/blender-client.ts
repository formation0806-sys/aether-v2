/**
 * Blender bridge client.
 *
 * Transport used by the live Blender tool (lib/agent/tools/blender.ts), which is
 * registered in the live `AGENT_TOOLS` registry
 * (docs/BLENDER_TOOL_DESIGN.md section 7).
 *
 * AVAILABILITY: the tool that calls this client is registered CONDITIONALLY. It
 * requires BOTH `ENABLE_TOOL_USE` AND `ENABLE_TOOL_BLENDER`. When either flag
 * is off the registry omits the tool, so this client is never reached and the
 * feature fails closed.
 *
 * TRANSPORT SCOPE: it talks to a Blender bridge on this machine's loopback
 * interface. Remote, LAN, and Vercel-hosted Blender are outside the current
 * scope and unsupported.
 *
 * DESIGN CONSTRAINTS enforced here (design document):
 * - The bridge URL and token come from the environment ONLY. Never from tool
 *   arguments, never from the model (section 7.2).
 * - Both variables are DEFAULTLESS. A missing or blank variable fails closed
 *   with a deterministic `unavailable` error instead of guessing a URL
 *   (section 7.3). There is deliberately no `127.0.0.1` fallback, unlike
 *   `lib/ai/config.ts:1-3`, because a defaulted URL would make a serverless
 *   function silently target its own loopback.
 * - The token is only ever written into an outbound Authorization header. It is
 *   never returned, never logged, and never embedded in an Error message
 *   (sections 6.3 and 13.3). Every error message below is a module constant.
 * - The wire protocol is a closed command union plus validated primitive
 *   arguments. There is no code, script, expression, or passthrough field
 *   anywhere in it (section 6.2).
 * - Nothing the bridge returns is relayed verbatim. Responses are validated
 *   against closed enums, so a stack trace or a filesystem path can never
 *   reach a tool observation (section 13.3).
 *
 * Testability: the fetch implementation, the environment, and the timeout are
 * all injectable, so unit tests never open a socket and never need Blender.
 */

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

/** Environment variable names. Read lazily, per call, never cached at load. */
export const BLENDER_BRIDGE_URL_VARIABLE = "BLENDER_BRIDGE_URL";
export const BLENDER_BRIDGE_TOKEN_VARIABLE = "BLENDER_BRIDGE_TOKEN";

/**
 * Client-side deadline. Kept below `AGENT_TOOL_TIMEOUT_MS` (10 000) so the
 * client gives up first, because the agent loop's timeout races the promise
 * without cancelling it (lib/agent/loop.ts:92-118, :255-258).
 */
export const DEFAULT_BRIDGE_TIMEOUT_MS = 8000;

/** Upper bound on a bridge response body before it is parsed. */
export const MAX_BRIDGE_RESPONSE_CHARS = 4096;

/** Upper bound on an object name accepted from the bridge, in characters. */
export const MAX_OBJECT_NAME_LENGTH = 64;

/** Upper bound on the number of scene objects rendered to an observation. */
export const MAX_SCENE_OBJECTS = 20;

/* -------------------------------------------------------------------------- */
/* Wire protocol                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The closed set of Blender primitives. These are exactly the values the
 * bridge maps to `bpy.ops.mesh.primitive_*`, so the bridge needs no
 * translation table and no free-form string can reach Blender.
 * Source: docs/BLENDER_TOOL_DESIGN.md section 5.2.
 */
export const BLENDER_OBJECT_TYPES = Object.freeze([
  "cube",
  "uv_sphere",
  "cylinder",
  "cone",
  "plane",
  "torus",
  "empty",
] as const);

/** One of the allowlisted Blender primitives. */
export type BlenderObjectType = (typeof BLENDER_OBJECT_TYPES)[number];

/** A validated three-component vector. */
export type BlenderVec3 = readonly [number, number, number];

/**
 * One validated command for the bridge.
 *
 * A closed discriminated union, not a string command with free-form options
 * (section 6.2). There is no variant that carries code, a script, a file path,
 * or an expression.
 */
export type BlenderBridgeRequest =
  | {
      readonly command: "create_object";
      readonly object_type: BlenderObjectType;
      readonly location: BlenderVec3;
      readonly scale: BlenderVec3;
      readonly name: string;
    }
  | { readonly command: "inspect_scene" };

/** The command identifier, for validation and tests. */
export type BlenderBridgeCommand = BlenderBridgeRequest["command"];

/** Sanitised description of one object, as reported by the bridge. */
export interface BlenderObjectSummary {
  readonly name: string;
  readonly object_type: BlenderObjectType;
  readonly location: BlenderVec3;
}

/**
 * Closed set of failure reasons the bridge may report.
 *
 * A closed enum, so an unexpected reason becomes `internal_error` instead of
 * being relayed to the model.
 */
export const BLENDER_FAILURE_CODES = Object.freeze([
  "rejected",
  "unavailable",
  "timeout",
  "internal_error",
] as const);

export type BlenderFailureCode = (typeof BLENDER_FAILURE_CODES)[number];

/** A validated bridge response. Never contains a free-form message. */
export type BlenderBridgeResponse =
  | {
      readonly ok: true;
      readonly code: "ok";
      readonly object?: BlenderObjectSummary;
      readonly objects?: readonly BlenderObjectSummary[];
    }
  | { readonly ok: false; readonly code: BlenderFailureCode };

/* -------------------------------------------------------------------------- */
/* Failure type                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Why a bridge call could not produce a response.
 *
 * `unavailable` covers a missing/blank configuration value, a refused
 * connection, and a non-2xx status. The messages are module constants so the
 * token and the bridge URL can never reach an Error, a log line, or a test
 * failure message.
 */
export type BlenderBridgeErrorCode =
  | "unavailable"
  | "timeout"
  | "transport"
  | "malformed_response";

export const BRIDGE_UNAVAILABLE_MESSAGE =
  "The local Blender bridge is not configured or not reachable.";
export const BRIDGE_TIMEOUT_MESSAGE =
  "The local Blender bridge did not respond in time.";
export const BRIDGE_TRANSPORT_MESSAGE =
  "The local Blender bridge could not be contacted.";
export const BRIDGE_MALFORMED_MESSAGE =
  "The local Blender bridge returned an unreadable response.";

/** A deterministic, content-free client failure. Carries no bridge detail. */
export class BlenderBridgeError extends Error {
  readonly code: BlenderBridgeErrorCode;
  readonly status: number | null;

  constructor(
    code: BlenderBridgeErrorCode,
    message: string,
    status: number | null = null,
  ) {
    super(message);

    this.name = "BlenderBridgeError";
    this.code = code;
    this.status = status;

    // Keeps `instanceof` correct if the class is ever downlevelled.
    Object.setPrototypeOf(this, BlenderBridgeError.prototype);
  }
}

/* -------------------------------------------------------------------------- */
/* Ingest sanitising                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Collapses whitespace and strips control characters so an object name can
 * never inject line structure into an observation. Mirrors the
 * `toSingleLine` approach in lib/agent/tools/memory-search.ts:58-60.
 */
function toSingleLine(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

/** A usable object name from the bridge, or null when unusable. */
function sanitizeName(raw: unknown): string | null {
  try {
    if (typeof raw !== "string") return null;

    const cleaned = toSingleLine(raw);

    if (cleaned === "") return null;
    if (cleaned.at(MAX_OBJECT_NAME_LENGTH) !== undefined) return null;

    return cleaned;
  } catch {
    return null;
  }
}

/** A usable object type from the bridge, or null when not allowlisted. */
function sanitizeObjectType(raw: unknown): BlenderObjectType | null {
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

/** A usable three-component vector from the bridge, or null when unusable. */
function sanitizeVec3(raw: unknown): BlenderVec3 | null {
  try {
    if (!Array.isArray(raw) || raw.length !== 3) return null;

    const out: [number, number, number] = [0, 0, 0];

    for (let index = 0; index < 3; index += 1) {
      const value = raw[index];

      if (typeof value !== "number" || !Number.isFinite(value)) return null;

      out[index] = value;
    }

    return out;
  } catch {
    return null;
  }
}

/** One object summary, or null when any field is unusable. */
function sanitizeObject(raw: unknown): BlenderObjectSummary | null {
  try {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }

    const source = raw as Record<string, unknown>;
    const name = sanitizeName(source["name"]);
    const objectType = sanitizeObjectType(source["object_type"]);
    const location = sanitizeVec3(source["location"]);

    if (name === null || objectType === null || location === null) return null;

    return { name, object_type: objectType, location };
  } catch {
    return null;
  }
}

/** True only for an exact member of the closed failure enum. */
function sanitizeFailureCode(raw: unknown): BlenderFailureCode | null {
  try {
    if (typeof raw !== "string") return null;

    for (const code of BLENDER_FAILURE_CODES) {
      if (raw === code) return code;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Validates an untrusted bridge payload into a `BlenderBridgeResponse`.
 *
 * Returns null when the payload is unusable, which the client converts into a
 * `malformed_response` failure. Any free-form string the bridge sends is
 * discarded, so a stack trace or a filesystem path cannot survive validation.
 */
export function parseBridgeResponse(
  raw: unknown,
  command: BlenderBridgeCommand,
): BlenderBridgeResponse | null {
  try {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }

    const source = raw as Record<string, unknown>;

    if (source["ok"] === false) {
      // An unrecognised reason collapses to a generic failure. Nothing is relayed.
      return { ok: false, code: sanitizeFailureCode(source["code"]) ?? "internal_error" };
    }

    if (source["ok"] !== true || source["code"] !== "ok") return null;

    if (command === "create_object") {
      const object = sanitizeObject(source["object"]);

      return object === null ? null : { ok: true, code: "ok", object };
    }

    const listed = source["objects"];

    if (!Array.isArray(listed)) return null;

    const objects: BlenderObjectSummary[] = [];

    for (const entry of listed) {
      if (objects.length >= MAX_SCENE_OBJECTS) break;

      const object = sanitizeObject(entry);

      if (object !== null) objects.push(object);
    }

    return { ok: true, code: "ok", objects };
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Transport                                                                  */
/* -------------------------------------------------------------------------- */

/** The transport surface the tool depends on. One method, one request. */
export interface BlenderBridgeClient {
  send(request: BlenderBridgeRequest): Promise<BlenderBridgeResponse>;
}

/** The minimal `fetch` shape this client needs. */
export interface BlenderBridgeHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly text: () => Promise<string>;
}

/** An injectable `fetch`-compatible function. */
export type BlenderBridgeFetch = (
  url: string,
  init: {
    readonly method: "POST";
    readonly headers: Record<string, string>;
    readonly body: string;
    readonly signal: AbortSignal;
  },
) => Promise<BlenderBridgeHttpResponse>;

/** The environment slice this client reads. Injected so tests never touch env. */
export type BlenderBridgeEnv = {
  readonly [key: string]: string | undefined;
};

/** Injectable dependencies. Every field is optional; defaults are production. */
export interface BlenderBridgeClientDeps {
  /** Defaults to the global `fetch`. */
  fetchImpl?: BlenderBridgeFetch;
  /** Defaults to `process.env`, read lazily on every call. */
  env?: BlenderBridgeEnv;
  /** Defaults to DEFAULT_BRIDGE_TIMEOUT_MS. */
  timeoutMs?: number;
}

/** The global fetch, narrowed to the shape this client needs. */
function defaultFetch(): BlenderBridgeFetch {
  return globalThis.fetch as unknown as BlenderBridgeFetch;
}

/** Trims a configuration value, returning "" for absent or blank. */
function readSetting(env: BlenderBridgeEnv, key: string): string {
  try {
    const raw = env[key];

    return typeof raw === "string" ? raw.trim() : "";
  } catch {
    return "";
  }
}

/**
 * The production client: one POST of a validated command to a loopback bridge.
 *
 * Never throws anything but `BlenderBridgeError`, and never embeds the token,
 * the URL, or any bridge-supplied text in an error.
 */
export function createBlenderBridgeClient(
  deps: BlenderBridgeClientDeps = {},
): BlenderBridgeClient {
  const fetchImpl = deps.fetchImpl ?? defaultFetch();
  const env = deps.env ?? process.env;
  const timeoutMs =
    typeof deps.timeoutMs === "number" && Number.isFinite(deps.timeoutMs) && deps.timeoutMs > 0
      ? Math.floor(deps.timeoutMs)
      : DEFAULT_BRIDGE_TIMEOUT_MS;

  return {
    async send(request: BlenderBridgeRequest): Promise<BlenderBridgeResponse> {
      const url = readSetting(env, BLENDER_BRIDGE_URL_VARIABLE);
      const token = readSetting(env, BLENDER_BRIDGE_TOKEN_VARIABLE);

      // Fail closed on missing configuration. No URL fallback, ever.
      if (url === "" || token === "") {
        throw new BlenderBridgeError("unavailable", BRIDGE_UNAVAILABLE_MESSAGE);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let response: BlenderBridgeHttpResponse;

      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
      } catch {
        if (controller.signal.aborted) {
          throw new BlenderBridgeError("timeout", BRIDGE_TIMEOUT_MESSAGE);
        }

        throw new BlenderBridgeError("transport", BRIDGE_TRANSPORT_MESSAGE);
      } finally {
        clearTimeout(timer);
      }

      // The response body of a non-2xx is never read, so it can never be relayed.
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new BlenderBridgeError(
            "unavailable",
            BRIDGE_UNAVAILABLE_MESSAGE,
            response.status,
          );
        }

        if (response.status >= 500) {
          throw new BlenderBridgeError(
            "transport",
            BRIDGE_TRANSPORT_MESSAGE,
            response.status,
          );
        }

        // The bridge answered, but not in our protocol.
        throw new BlenderBridgeError(
          "malformed_response",
          BRIDGE_MALFORMED_MESSAGE,
          response.status,
        );
      }

      let text: string;

      try {
        text = (await response.text()).slice(0, MAX_BRIDGE_RESPONSE_CHARS);
      } catch {
        throw new BlenderBridgeError("malformed_response", BRIDGE_MALFORMED_MESSAGE);
      }

      let parsed: unknown;

      try {
        parsed = JSON.parse(text);
      } catch {
        throw new BlenderBridgeError("malformed_response", BRIDGE_MALFORMED_MESSAGE);
      }

      const validated = parseBridgeResponse(parsed, request.command);

      if (validated === null) {
        throw new BlenderBridgeError("malformed_response", BRIDGE_MALFORMED_MESSAGE);
      }

      return validated;
    },
  };
}
