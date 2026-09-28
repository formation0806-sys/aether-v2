/**
 * Unit tests for the Blender tool and its bridge client.
 *
 * Hermetic by construction: the client abstraction is injected everywhere, so
 * these tests open no socket, spawn no process, touch no filesystem, and never
 * require Blender to be installed. The only `fetch` used is a local stub, and
 * the only environment used is an injected object literal.
 *
 * No production code is touched by this suite. It covers four things:
 * - Blender tool behavior: argument validation, operation rendering, and the
 *   bounded, content-free observations returned to the model.
 * - Bridge client behavior: defaultless configuration, request/response
 *   handling, and the guarantee that the token never escapes.
 * - Registry wiring: the tool is the last entry of the live `AGENT_TOOLS` list.
 * - Feature-flag gating and fail-closed behavior: the tool is absent unless
 *   BOTH `ENABLE_TOOL_USE` and `ENABLE_TOOL_BLENDER` are enabled, and
 *   `ENABLE_TOOL_BLENDER` alone can never activate it.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  BLENDER_ERROR,
  BLENDER_GENERIC_OBSERVATION,
  BLENDER_OK,
  BLENDER_OPERATIONS,
  BLENDER_REJECTED_OBSERVATION,
  BLENDER_TIMEOUT_OBSERVATION,
  BLENDER_TOOL_NAME,
  BLENDER_UNAVAILABLE_OBSERVATION,
  CREATE_OBJECT_KEYS,
  FORBIDDEN_ARGUMENT_KEYS,
  INSPECT_SCENE_KEYS,
  MAX_LOCATION_COMPONENT,
  MAX_SCALE_COMPONENT,
  MIN_SCALE_COMPONENT,
  blenderTool,
  createBlenderTool,
  formatSceneObjects,
} from "@/lib/agent/tools/blender";
import type { BlenderToolArgs } from "@/lib/agent/tools/blender";

import {
  BLENDER_OBJECT_TYPES,
  BlenderBridgeError,
  MAX_BRIDGE_RESPONSE_CHARS,
  MAX_SCENE_OBJECTS,
  createBlenderBridgeClient,
  parseBridgeResponse,
} from "@/lib/agent/tools/blender-client";
import type {
  BlenderBridgeClient,
  BlenderBridgeFetch,
  BlenderBridgeRequest,
  BlenderBridgeResponse,
  BlenderObjectSummary,
} from "@/lib/agent/tools/blender-client";

import { buildAgentToolRegistry } from "@/lib/agent/tools/index";
import { composeToolManifest } from "@/lib/agent/prompt";
import type { FlagPredicate } from "@/lib/agent/tools/registry";
import { ToolRegistry } from "@/lib/agent/tools/registry";
import type { ToolContext } from "@/lib/agent/tools/types";

/** A distinctive token, so "did the token leak" is a real assertion. */
const SECRET_TOKEN = "s3cr3t-bridge-token-do-not-leak";

const BRIDGE_URL = "http://127.0.0.1:8731/bridge";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function only(...enabled: string[]): FlagPredicate {
  const set = new Set<string>(enabled);

  return (flag) => set.has(flag);
}

function makeContext(signal?: AbortSignal): ToolContext {
  return {
    userId: "user-1",
    conversationId: null,
    deadline: 0,
    signal: signal ?? new AbortController().signal,
  };
}

/** A client stub that records what it was asked to send. */
function stubClient(
  response: BlenderBridgeResponse | Error,
): BlenderBridgeClient & { calls: BlenderBridgeRequest[] } {
  const calls: BlenderBridgeRequest[] = [];

  return {
    calls,
    async send(request: BlenderBridgeRequest): Promise<BlenderBridgeResponse> {
      calls.push(request);

      if (response instanceof Error) throw response;

      return response;
    },
  };
}

/** A `fetch` stub returning a fixed HTTP status and body. */
function stubFetch(status: number, body: string): {
  fetchImpl: BlenderBridgeFetch;
  calls: { url: string; init: Parameters<BlenderBridgeFetch>[1] }[];
} {
  const calls: { url: string; init: Parameters<BlenderBridgeFetch>[1] }[] = [];

  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });

      return { ok: status >= 200 && status < 300, status, text: async () => body };
    },
  };
}

/** A `fetch` stub that always rejects, as a refused connection would. */
function rejectingFetch(): BlenderBridgeFetch {
  return async () => {
    throw new Error("ECONNREFUSED 127.0.0.1:8731");
  };
}

const OBJECT: BlenderObjectSummary = {
  name: "Cube",
  object_type: "cube",
  location: [0, 0, 0],
};

/** Parses with the tool's own parser, failing loudly on a bad fixture. */
function args(raw: unknown): BlenderToolArgs {
  const parsed = blenderTool.parseArgs(raw);

  if (parsed === null) throw new Error("fixture was rejected by parseArgs");

  return parsed;
}

/* -------------------------------------------------------------------------- */
/* 1-2. Valid arguments are accepted                                         */
/* -------------------------------------------------------------------------- */

describe("blender tool - valid arguments are accepted", () => {
  it("accepts the minimal create_object payload", () => {
    expect(blenderTool.parseArgs({ operation: "create_object", object_type: "cube" })).toEqual({
      operation: "create_object",
      object_type: "cube",
      location: [0, 0, 0],
      scale: [1, 1, 1],
      name: "SalpaObject",
    });
  });

  it("accepts the full conceptual create_object payload", () => {
    expect(
      args({
        operation: "create_object",
        object_type: "cube",
        name: "Cube",
        location: [1, -2, 3],
        scale: [2, 2, 2],
      }),
    ).toEqual({
      operation: "create_object",
      object_type: "cube",
      location: [1, -2, 3],
      scale: [2, 2, 2],
      name: "Cube",
    });
  });

  it("accepts every allowlisted object type", () => {
    for (const objectType of BLENDER_OBJECT_TYPES) {
      expect(
        blenderTool.parseArgs({ operation: "create_object", object_type: objectType }),
      ).not.toBeNull();
    }
  });

  it("collapses whitespace and control characters in a name", () => {
    const parsed = args({
      operation: "create_object",
      object_type: "cube",
      name: "  My\u0000 Cube\n",
    });

    expect(parsed.operation === "create_object" ? parsed.name : "").toBe("My Cube");
  });

  it("accepts inspect_scene with no further arguments", () => {
    expect(blenderTool.parseArgs({ operation: "inspect_scene" })).toEqual({
      operation: "inspect_scene",
    });
  });
});

/* -------------------------------------------------------------------------- */
/* 3-6. Invalid arguments are rejected                                        */
/* -------------------------------------------------------------------------- */

describe("blender tool - invalid arguments are rejected", () => {
  it("rejects a missing operation", () => {
    expect(blenderTool.parseArgs({})).toBeNull();
    expect(blenderTool.parseArgs({ object_type: "cube" })).toBeNull();
  });

  it("rejects an unsupported operation", () => {
    for (const operation of [
      "delete_object",
      "render",
      "save_file",
      "execute_python",
      "CREATE_OBJECT",
      "",
    ]) {
      expect(blenderTool.parseArgs({ operation })).toBeNull();
    }
  });

  it("rejects an unsupported object type", () => {
    for (const objectType of ["monkey", "Cube", "uv sphere", "mesh", 42, null, {}]) {
      expect(
        blenderTool.parseArgs({ operation: "create_object", object_type: objectType }),
      ).toBeNull();
    }
  });

  it("rejects malformed coordinates", () => {
    for (const location of [
      [0, 0],
      [0, 0, 0, 0],
      "0,0,0",
      [0, 0, "1"],
      [0, 0, Number.NaN],
      [0, 0, Number.POSITIVE_INFINITY],
      [MAX_LOCATION_COMPONENT + 1, 0, 0],
      null,
    ]) {
      expect(
        blenderTool.parseArgs({
          operation: "create_object",
          object_type: "cube",
          location,
        }),
      ).toBeNull();
    }
  });

  it("rejects a malformed or non-positive scale", () => {
    for (const scale of [
      [0, 1, 1],
      [-1, 1, 1],
      [1, 1, 0],
      [1, "1", 1],
      [1, 1],
      [MAX_SCALE_COMPONENT + 1, 1, 1],
      null,
    ]) {
      expect(
        blenderTool.parseArgs({ operation: "create_object", object_type: "cube", scale }),
      ).toBeNull();
    }

    expect(MIN_SCALE_COMPONENT).toBeGreaterThan(0);
  });

  it("rejects a malformed name", () => {
    for (const name of ["", "   ", "x".repeat(65), 42, null]) {
      expect(
        blenderTool.parseArgs({ operation: "create_object", object_type: "cube", name }),
      ).toBeNull();
    }
  });

  it("rejects non-object and array arguments", () => {
    for (const raw of [null, undefined, "create_object", 42, true, ["create_object"]]) {
      expect(blenderTool.parseArgs(raw)).toBeNull();
    }
  });

  it("rejects every unknown key on create_object", () => {
    expect(
      blenderTool.parseArgs({ operation: "create_object", object_type: "cube", material: "red" }),
    ).toBeNull();
  });

  it("rejects any argument beyond the operation on inspect_scene", () => {
    expect(blenderTool.parseArgs({ operation: "inspect_scene", object_type: "cube" })).toBeNull();
    expect(blenderTool.parseArgs({ operation: "inspect_scene", name: "Cube" })).toBeNull();
  });

  it("rejects every documented code-shaped key", () => {
    expect(FORBIDDEN_ARGUMENT_KEYS).toEqual([
      "script",
      "python",
      "code",
      "expression",
      "command",
    ]);

    for (const key of FORBIDDEN_ARGUMENT_KEYS) {
      expect(
        blenderTool.parseArgs({
          operation: "create_object",
          object_type: "cube",
          [key]: "import os; os.system('calc')",
        }),
      ).toBeNull();
    }
  });

  it("exposes no execute_python tool and no passthrough command", () => {
    expect(blenderTool.name).toBe(BLENDER_TOOL_NAME);
    expect(blenderTool.name).not.toBe("blender.execute_python");
    expect(BLENDER_OPERATIONS).toEqual(["create_object", "inspect_scene"]);
    expect(BLENDER_OPERATIONS).not.toContain("execute_python");
    expect(BLENDER_OPERATIONS).not.toContain("command");
  });

  it("documents exactly the allowlisted keys", () => {
    expect(CREATE_OBJECT_KEYS).toEqual([
      "operation",
      "object_type",
      "location",
      "scale",
      "name",
    ]);
    expect(INSPECT_SCENE_KEYS).toEqual(["operation"]);
  });
});

/* -------------------------------------------------------------------------- */
/* Execution and observation rendering                                       */
/* -------------------------------------------------------------------------- */

describe("blender tool - execution", () => {
  it("sends a validated create_object command and reports success", async () => {
    const client = stubClient({ ok: true, code: "ok", object: OBJECT });
    const result = await createBlenderTool(client).execute(
      args({ operation: "create_object", object_type: "cube", name: "Cube" }),
      makeContext(),
    );

    expect(client.calls).toEqual([
      {
        command: "create_object",
        object_type: "cube",
        location: [0, 0, 0],
        scale: [1, 1, 1],
        name: "Cube",
      },
    ]);

    expect(result.ok).toBe(true);
    expect(result.observation).toBe("BLENDER_OK: created Cube (cube) at (0, 0, 0).");
    expect(result.observation.startsWith(BLENDER_OK)).toBe(true);
  });

  it("sends a validated inspect_scene command and renders the scene", async () => {
    const client = stubClient({
      ok: true,
      code: "ok",
      objects: [OBJECT, { name: "Sphere", object_type: "uv_sphere", location: [1, 2, 3] }],
    });

    const result = await createBlenderTool(client).execute(
      args({ operation: "inspect_scene" }),
      makeContext(),
    );

    expect(client.calls).toEqual([{ command: "inspect_scene" }]);
    expect(result.ok).toBe(true);
    expect(result.observation).toBe(
      "BLENDER_OK: the scene contains 2 objects.\n1. Cube (cube) at (0, 0, 0)\n2. Sphere (uv_sphere) at (1, 2, 3)",
    );
  });

  it("reports an empty scene without failing", () => {
    expect(formatSceneObjects([])).toBe("BLENDER_OK: the scene contains 0 objects.");
  });

  it("caps the rendered scene at the documented maximum", () => {
    const many = Array.from({ length: MAX_SCENE_OBJECTS + 10 }, (_, index) => ({
      name: "Object" + String(index),
      object_type: "cube" as const,
      location: [0, 0, 0] as const,
    }));

    const rendered = formatSceneObjects(many);

    expect(rendered.split("\n")).toHaveLength(1 + MAX_SCENE_OBJECTS);
  });

  it("refuses to run once the turn is cancelled", async () => {
    const controller = new AbortController();
    const client = stubClient({ ok: true, code: "ok", object: OBJECT });

    controller.abort();

    const result = await createBlenderTool(client).execute(
      args({ operation: "create_object", object_type: "cube" }),
      makeContext(controller.signal),
    );

    expect(result.ok).toBe(false);
    expect(result.observation).toContain("TOOL_ABORTED");
    expect(client.calls).toHaveLength(0);
  });

  it("never throws, whatever the client does", async () => {
    const cases: (BlenderBridgeResponse | Error)[] = [
      new Error("boom"),
      new TypeError("undefined is not a function"),
      { ok: false, code: "rejected" },
      { ok: false, code: "unavailable" },
      { ok: false, code: "timeout" },
      { ok: false, code: "internal_error" },
    ];

    for (const response of cases) {
      const result = await createBlenderTool(stubClient(response)).execute(
        args({ operation: "create_object", object_type: "cube" }),
        makeContext(),
      );

      expect(result.ok).toBe(false);
      expect(typeof result.observation).toBe("string");
      expect(result.observation).not.toContain("boom");
      expect(result.observation).not.toContain("undefined is not a function");
    }
  });

  it("maps every bridge failure code to a fixed observation", async () => {
    const expectations: Array<[string, string]> = [
      ["unavailable", BLENDER_UNAVAILABLE_OBSERVATION],
      ["rejected", BLENDER_REJECTED_OBSERVATION],
      ["timeout", BLENDER_TIMEOUT_OBSERVATION],
      ["internal_error", BLENDER_GENERIC_OBSERVATION],
    ];

    for (const [code, observation] of expectations) {
      const result = await createBlenderTool(
        stubClient({ ok: false, code } as BlenderBridgeResponse),
      ).execute(args({ operation: "inspect_scene" }), makeContext());

      expect(result.ok).toBe(false);
      expect(result.observation).toBe(observation);
    }
  });

  it("treats a success with no object as a generic failure", async () => {
    const result = await createBlenderTool(stubClient({ ok: true, code: "ok" })).execute(
      args({ operation: "create_object", object_type: "cube" }),
      makeContext(),
    );

    expect(result.ok).toBe(false);
    expect(result.observation).toBe(BLENDER_GENERIC_OBSERVATION);
  });
});

/* -------------------------------------------------------------------------- */
/* 7. Configuration is defaultless and fails closed                           */
/* -------------------------------------------------------------------------- */

describe("blender client - missing configuration fails closed", () => {
  it("fails closed with no BLENDER_BRIDGE_URL and never calls fetch", async () => {
    const { fetchImpl, calls } = stubFetch(200, "{}");
    const client = createBlenderBridgeClient({
      fetchImpl,
      env: { BLENDER_BRIDGE_TOKEN: SECRET_TOKEN },
    });

    await expect(client.send({ command: "inspect_scene" })).rejects.toBeInstanceOf(
      BlenderBridgeError,
    );
    expect(calls).toHaveLength(0);
  });

  it("fails closed with no BLENDER_BRIDGE_TOKEN and never calls fetch", async () => {
    const { fetchImpl, calls } = stubFetch(200, "{}");
    const client = createBlenderBridgeClient({
      fetchImpl,
      env: { BLENDER_BRIDGE_URL: BRIDGE_URL },
    });

    await expect(client.send({ command: "inspect_scene" })).rejects.toBeInstanceOf(
      BlenderBridgeError,
    );
    expect(calls).toHaveLength(0);
  });

  it("fails closed for a blank value and for an empty environment", async () => {
    for (const env of [
      { BLENDER_BRIDGE_URL: "   ", BLENDER_BRIDGE_TOKEN: SECRET_TOKEN },
      { BLENDER_BRIDGE_URL: BRIDGE_URL, BLENDER_BRIDGE_TOKEN: "  " },
      {},
    ]) {
      const { fetchImpl } = stubFetch(200, "{}");
      const client = createBlenderBridgeClient({ fetchImpl, env });

      await expect(client.send({ command: "inspect_scene" })).rejects.toBeInstanceOf(
        BlenderBridgeError,
      );
    }
  });

  it("surfaces the missing bridge as BLENDER_UNAVAILABLE through the tool", async () => {
    const { fetchImpl } = stubFetch(200, "{}");
    const tool = createBlenderTool(createBlenderBridgeClient({ fetchImpl, env: {} }));

    const result = await tool.execute(
      args({ operation: "create_object", object_type: "cube" }),
      makeContext(),
    );

    expect(result.ok).toBe(false);
    expect(result.observation).toBe(BLENDER_UNAVAILABLE_OBSERVATION);
  });
});

/* -------------------------------------------------------------------------- */
/* 8. Request and response handling                                          */
/* -------------------------------------------------------------------------- */

describe("blender client - request and response handling", () => {
  function configured(body: string, status = 200) {
    const stub = stubFetch(status, body);

    return {
      calls: stub.calls,
      client: createBlenderBridgeClient({
        fetchImpl: stub.fetchImpl,
        env: { BLENDER_BRIDGE_URL: BRIDGE_URL, BLENDER_BRIDGE_TOKEN: SECRET_TOKEN },
      }),
    };
  }

  it("POSTs a validated command as JSON", async () => {
    const { calls, client } = configured(
      JSON.stringify({ ok: true, code: "ok", object: OBJECT }),
    );

    const response = await client.send({
      command: "create_object",
      object_type: "cube",
      location: [0, 0, 0],
      scale: [1, 1, 1],
      name: "Cube",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(BRIDGE_URL);
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(calls[0].init.body)).toEqual({
      command: "create_object",
      object_type: "cube",
      location: [0, 0, 0],
      scale: [1, 1, 1],
      name: "Cube",
    });

    expect(response).toEqual({ ok: true, code: "ok", object: OBJECT });
  });

  it("passes an abort signal to the transport", async () => {
    const { calls, client } = configured(
      JSON.stringify({ ok: true, code: "ok", objects: [] }),
    );

    await client.send({ command: "inspect_scene" });

    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("converts a refused connection into a safe transport failure", async () => {
    const client = createBlenderBridgeClient({
      fetchImpl: rejectingFetch(),
      env: { BLENDER_BRIDGE_URL: BRIDGE_URL, BLENDER_BRIDGE_TOKEN: SECRET_TOKEN },
    });

    const result = await createBlenderTool(client).execute(
      args({ operation: "create_object", object_type: "cube" }),
      makeContext(),
    );

    expect(result.ok).toBe(false);
    expect(result.observation).toBe(BLENDER_GENERIC_OBSERVATION);
    expect(result.observation).not.toContain("ECONNREFUSED");
  });

  it("converts an unreadable body into a safe malformed-response failure", async () => {
    for (const body of ["", "not json", "[1,2,3]", JSON.stringify({ ok: "yes" })]) {
      const { client } = configured(body);

      const result = await createBlenderTool(client).execute(
        args({ operation: "inspect_scene" }),
        makeContext(),
      );

      expect(result.ok).toBe(false);
      expect(result.observation).toBe(BLENDER_GENERIC_OBSERVATION);
    }
  });

  it("maps 401/403 to unavailable, 5xx to transport, other 4xx to malformed", async () => {
    const cases: Array<[number, string]> = [
      [401, BLENDER_UNAVAILABLE_OBSERVATION],
      [403, BLENDER_UNAVAILABLE_OBSERVATION],
      [500, BLENDER_GENERIC_OBSERVATION],
      [503, BLENDER_GENERIC_OBSERVATION],
      [418, BLENDER_GENERIC_OBSERVATION],
    ];

    for (const [status, observation] of cases) {
      const { client } = configured("{}", status);

      const result = await createBlenderTool(client).execute(
        args({ operation: "inspect_scene" }),
        makeContext(),
      );

      expect(result.observation, "status " + String(status)).toBe(observation);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 9. Secrets, stack traces, and paths never escape                          */
/* -------------------------------------------------------------------------- */

describe("blender - the token never escapes", () => {
  it("sends the token only in the Authorization header", async () => {
    const stub = stubFetch(200, JSON.stringify({ ok: true, code: "ok", object: OBJECT }));

    const client = createBlenderBridgeClient({
      fetchImpl: stub.fetchImpl,
      env: { BLENDER_BRIDGE_URL: BRIDGE_URL, BLENDER_BRIDGE_TOKEN: SECRET_TOKEN },
    });

    await client.send({
      command: "create_object",
      object_type: "cube",
      location: [0, 0, 0],
      scale: [1, 1, 1],
      name: "Cube",
    });

    expect(stub.calls[0].init.headers["Authorization"]).toBe("Bearer " + SECRET_TOKEN);
    expect(stub.calls[0].init.body).not.toContain(SECRET_TOKEN);
  });

  it("keeps the token out of a thrown configuration error", async () => {
    const client = createBlenderBridgeClient({ env: { BLENDER_BRIDGE_TOKEN: SECRET_TOKEN } });

    const thrown: unknown = await client
      .send({ command: "inspect_scene" })
      .catch((error: unknown) => error);

    expect(String((thrown as Error).message)).not.toContain(SECRET_TOKEN);
    expect(JSON.stringify(thrown)).not.toContain(SECRET_TOKEN);
  });

  it("keeps the token and the bridge URL out of the tool observation", async () => {
    const client = createBlenderBridgeClient({
      fetchImpl: rejectingFetch(),
      env: { BLENDER_BRIDGE_URL: BRIDGE_URL, BLENDER_BRIDGE_TOKEN: SECRET_TOKEN },
    });

    const result = await createBlenderTool(client).execute(
      args({ operation: "create_object", object_type: "cube" }),
      makeContext(),
    );

    expect(result.observation).not.toContain(SECRET_TOKEN);
    expect(result.observation).not.toContain(BRIDGE_URL);
    expect(JSON.stringify(result)).not.toContain(SECRET_TOKEN);
  });

  it("discards a bridge-supplied stack trace, path, and echoed token", () => {
    const parsed = parseBridgeResponse(
      {
        ok: true,
        code: "ok",
        object: { name: "Cube", object_type: "cube", location: [0, 0, 0] },
        traceback: 'Traceback (most recent call last): File "bridge.py", line 3',
        path: "C:\\Users\\dev\\secret.blend",
        message: "Authorization: Bearer " + SECRET_TOKEN,
      },
      "create_object",
    );

    expect(parsed).toEqual({ ok: true, code: "ok", object: OBJECT });

    const rendered = JSON.stringify(parsed);

    expect(rendered).not.toContain("Traceback");
    expect(rendered).not.toContain("secret.blend");
    expect(rendered).not.toContain(SECRET_TOKEN);
  });

  it("drops an object whose name or type is unusable", () => {
    const parsed = parseBridgeResponse(
      {
        ok: true,
        code: "ok",
        objects: [
          { name: "Cube", object_type: "cube", location: [0, 0, 0] },
          { name: "Cube", object_type: "monkey", location: [0, 0, 0] },
          { name: "x".repeat(200), object_type: "cube", location: [0, 0, 0] },
          { name: "Cube", object_type: "cube", location: [0, 0, "1"] },
        ],
      },
      "inspect_scene",
    );

    expect(parsed).toEqual({ ok: true, code: "ok", objects: [OBJECT] });
  });

  it("collapses an unknown failure reason to a generic internal error", () => {
    const parsed = parseBridgeResponse(
      { ok: false, code: "python exploded in C:\\Users\\dev" },
      "inspect_scene",
    );

    expect(parsed).toEqual({ ok: false, code: "internal_error" });
  });

  it("rejects an oversized bridge body rather than parsing it", async () => {
    const client = createBlenderBridgeClient({
      fetchImpl: stubFetch(200, "x".repeat(MAX_BRIDGE_RESPONSE_CHARS + 500)).fetchImpl,
      env: { BLENDER_BRIDGE_URL: BRIDGE_URL, BLENDER_BRIDGE_TOKEN: SECRET_TOKEN },
    });

    const result = await createBlenderTool(client).execute(
      args({ operation: "inspect_scene" }),
      makeContext(),
    );

    expect(result.ok).toBe(false);
    expect(result.observation).toBe(BLENDER_GENERIC_OBSERVATION);
  });
});

/* -------------------------------------------------------------------------- */
/* 10. The tool is UNWIRED: existing agent behaviour is unaffected            */
/* -------------------------------------------------------------------------- */

const INDEX_SOURCE = readFileSync(
  path.join(process.cwd(), "lib", "agent", "tools", "index.ts"),
  "utf8",
).replace(/\r\n/g, "\n");

const GATE_SOURCE = readFileSync(
  path.join(process.cwd(), "lib", "agent", "gate.ts"),
  "utf8",
).replace(/\r\n/g, "\n");

describe("blender - registry wiring (POC step 5)", () => {
  it("is present in AGENT_TOOLS only when BOTH flags are on", () => {
    const registry = buildAgentToolRegistry(
      only("ENABLE_TOOL_USE", "ENABLE_TOOL_BLENDER"),
    );

    expect(registry.has(BLENDER_TOOL_NAME)).toBe(true);
    expect(registry.list().map((tool) => tool.name)).toEqual([
      "current_time",
      "calculator",
      "memory_search",
      "blender",
    ]);
    expect(registry.size()).toBe(4);
  });

  it("is absent when ENABLE_TOOL_USE is off, even with ENABLE_TOOL_BLENDER on", () => {
    const registry = buildAgentToolRegistry(only("ENABLE_TOOL_BLENDER"));

    expect(registry.has(BLENDER_TOOL_NAME)).toBe(false);
    expect(registry.list().map((tool) => tool.name)).toEqual([]);
  });

  it("is absent when ENABLE_TOOL_BLENDER is off, even with ENABLE_TOOL_USE on", () => {
    const registry = buildAgentToolRegistry(only("ENABLE_TOOL_USE"));

    expect(registry.has(BLENDER_TOOL_NAME)).toBe(false);
    expect(registry.list().map((tool) => tool.name)).toEqual([
      "current_time",
      "calculator",
      "memory_search",
    ]);
    expect(registry.size()).toBe(3);
  });

  it("never bypasses the global tool flag", () => {
    for (const flags of [
      [],
      ["ENABLE_TOOL_BLENDER"],
      ["ENABLE_TOOL_USE"],
    ]) {
      const registry = buildAgentToolRegistry(only(...flags));

      expect(
        registry.has(BLENDER_TOOL_NAME),
        "flags=" + (flags.join("+") || "none"),
      ).toBe(false);
    }
  });

  it("leaves the default registry empty with every flag OFF", () => {
    const registry = buildAgentToolRegistry(only());

    expect(registry.size()).toBe(0);
    expect(registry.has(BLENDER_TOOL_NAME)).toBe(false);
  });

  it("is imported by lib/agent/tools/index.ts and registered in the live list", () => {
    expect(INDEX_SOURCE).toMatch(/from "\.\/blender"/);
    expect(INDEX_SOURCE).toMatch(/blenderTool/);
    // The dead singleton accessor stays dead and untouched.
    expect(INDEX_SOURCE).toContain("function getToolRegistry()");
  });

  it("is recognised by the intent gate", () => {
    expect(GATE_SOURCE.toLowerCase()).toContain("blender");
  });

  it("registers into a registry only when BOTH flags are on", () => {
    const definition = createBlenderTool(stubClient({ ok: true, code: "ok", objects: [] }));

    expect(definition.requiredFlags).toEqual([
      "ENABLE_TOOL_USE",
      "ENABLE_TOOL_BLENDER",
    ]);

    expect(new ToolRegistry(only()).register(definition)).toBe(false);
    expect(new ToolRegistry(only("ENABLE_TOOL_USE")).register(definition)).toBe(false);
    expect(new ToolRegistry(only("ENABLE_TOOL_BLENDER")).register(definition)).toBe(false);
    expect(
      new ToolRegistry(only("ENABLE_TOOL_USE", "ENABLE_TOOL_BLENDER")).register(definition),
    ).toBe(true);
  });

  it("is a valid ToolDefinition that the registry validator accepts", () => {
    const definition = createBlenderTool(stubClient({ ok: true, code: "ok", objects: [] }));

    expect(definition.name).toBe(BLENDER_TOOL_NAME);
    expect(typeof definition.description).toBe("string");
    expect(definition.description.length).toBeGreaterThan(0);
    expect(definition.timeoutMs).toBe(8000);
    expect(typeof definition.parseArgs).toBe("function");
    expect(typeof definition.execute).toBe("function");
  });

  it("describes operations as argument values, never as quoted tool names", () => {
    // Step 6.2 regression, updated for Step 7.2.2. The original assertion banned
    // EVERY quote character, which was a blunt proxy: the description now carries
    // concrete call examples, and those necessarily contain quotes.
    //
    // The intent is preserved precisely. An operation value must never be shown
    // as a BARE quoted identifier that reads like a selectable tool name. Each
    // assertion below bans exactly one such form.
    const description = createBlenderTool(
      stubClient({ ok: true, code: "ok", objects: [] }),
    ).description;

    // The Step 6 form, verbatim: Operations: "create_object" ...
    expect(description).not.toMatch(/Operations:\s*"/);
    // An operation value must not stand alone as a list item or on its own line.
    expect(description).not.toMatch(/^[-*]?\s*"?create_object"?\s*$/m);
    expect(description).not.toMatch(/^[-*]?\s*"?inspect_scene"?\s*$/m);

    expect(description).toContain("The tool name is blender");
    expect(description).toContain('"operation"');
    expect(description).toContain("create_object");
    expect(description).toContain("inspect_scene");
    expect(description).toContain("cannot run code");
  });

  it("states that an operation value is never a tool name nor an argument key", () => {
    // Step 7.2.2: the model first put the operation in the tool field (Step 6),
    // then put it in args as a KEY ({"inspect_scene": true}, {"action": ...}).
    // The description must forbid both placements explicitly.
    const description = createBlenderTool(
      stubClient({ ok: true, code: "ok", objects: [] }),
    ).description;

    expect(description).toContain(
      "An operation value is never a tool name and never an argument key"
    );
  });

  it("stays on one physical line, so the manifest keeps one line per tool", () => {
    // composeToolManifest joins descriptions with "\n"; an embedded newline in
    // this string would silently split the Blender entry across two lines.
    const description = createBlenderTool(
      stubClient({ ok: true, code: "ok", objects: [] }),
    ).description;

    expect(description).not.toContain("\n");
    expect(description).not.toContain("\r");
  });
});

/* -------------------------------------------------------------------------- */
/* Step 7.2.2: the examples the model reads must match the real contract        */
/* -------------------------------------------------------------------------- */

describe("blender tool - the model-facing examples are the real contract", () => {
  const definition = createBlenderTool(
    stubClient({ ok: true, code: "ok", objects: [] }),
  );

  /** Index of the brace closing the one opened at start, or -1 if unbalanced. */
  function closingBrace(text: string, start: number): number {
    let depth = 0;
    let inString = false;

    for (let index = start; index < text.length; index += 1) {
      const ch = text[index];

      if (inString) {
        if (ch === "\\") index += 1;
        else if (ch === '"') inString = false;

        continue;
      }

      if (ch === '"') inString = true;
      else if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;

        if (depth === 0) return index;
      }
    }

    return -1;
  }

  /**
   * Every balanced, JSON-parseable CALL ENVELOPE in the description: an object
   * carrying a "tool" key. The nested `args` objects are balanced JSON too, so
   * filtering structurally on the presence of "tool" keeps the two examples and
   * leaves the assertion that their name is "blender" meaningful.
   */
  function embeddedCalls(text: string): Record<string, unknown>[] {
    const found: Record<string, unknown>[] = [];

    for (let index = text.indexOf("{"); index !== -1; index = text.indexOf("{", index + 1)) {
      const end = closingBrace(text, index);

      if (end === -1) continue;

      try {
        const parsed = JSON.parse(text.slice(index, end + 1)) as unknown;

        if (
          parsed !== null &&
          typeof parsed === "object" &&
          !Array.isArray(parsed) &&
          "tool" in (parsed as Record<string, unknown>)
        ) {
          found.push(parsed as Record<string, unknown>);
        }
      } catch {
        // Not an example object; keep scanning.
      }
    }

    return found;
  }

  const examples = embeddedCalls(definition.description);

  it("carries exactly the two documented call examples", () => {
    expect(examples).toHaveLength(2);
    expect(examples.map((entry) => entry["tool"])).toEqual(["blender", "blender"]);
  });

  it("shows inspect_scene as the only argument key", () => {
    const args = examples[0]["args"] as Record<string, unknown>;

    expect(args["operation"]).toBe("inspect_scene");
    expect(Object.keys(args)).toEqual(["operation"]);
  });

  it("shows create_object with an allowlisted object_type", () => {
    const args = examples[1]["args"] as Record<string, unknown>;

    expect(args["operation"]).toBe("create_object");
    expect(args["object_type"]).toBe("cube");
    expect(BLENDER_OBJECT_TYPES).toContain(args["object_type"]);
  });

  it("produces args the real parseArgs accepts, so the examples cannot drift", () => {
    // The strongest guarantee available without a new harness: the exact text
    // the model reads is fed through the real argument parser. A stale, renamed,
    // or wrong example fails here rather than shipping to the model.
    //
    // parseToolCall (lib/agent/protocol.ts) hands the tool the "args" object, not
    // the whole envelope, so the envelope's "args" is what gets validated here.
    for (const example of examples) {
      expect(definition.parseArgs(example["args"])).not.toBeNull();
    }

    expect(definition.parseArgs(examples[0]["args"])).toEqual({
      operation: "inspect_scene",
    });

    expect(definition.parseArgs(examples[1]["args"])).toEqual({
      operation: "create_object",
      object_type: "cube",
      location: [0, 0, 0],
      scale: [1, 1, 1],
      name: "SalpaObject",
    });
  });

  it("still rejects the malformed shapes the model actually emitted", () => {
    // This milestone is communication, not coercion: both shapes stay invalid.
    expect(definition.parseArgs({ inspect_scene: true })).toBeNull();
    expect(definition.parseArgs({ action: "inspect_scene" })).toBeNull();
  });

  it("renders as exactly one manifest line", () => {
    const registry = new ToolRegistry(
      only("ENABLE_TOOL_USE", "ENABLE_TOOL_BLENDER"),
    );

    expect(registry.register(definition)).toBe(true);

    const lines = composeToolManifest(registry)
      .split("\n")
      .filter((line) => line.startsWith("- blender: "));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"operation": "inspect_scene"');
  });
});