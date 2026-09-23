/**
 * Unit tests for the world-model entry point (Priority 6).
 *
 * No provider, no tools, no database: buildWorldModel reads a flag and
 * caller-supplied inputs, and returns a snapshot plus predictions/updates.
 * The live chat path must stay untouched - asserted by source checks below.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  WORLD_MODEL_FLAG,
  buildWorldModel,
} from "@/lib/agent/world/index";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const FLAG = "ENABLE_WORLD_MODEL";

function readSource(...segments: string[]): string {
  return readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

const VALID_REQUEST = {
  userId: USER_ID,
  memories: [{ id: "mem-1", status: "active", title: "Dark interface preference" }],
};

const FLAG_ON = { isFlagEnabled: () => true };

beforeEach(() => {
  delete process.env[FLAG];
});

afterEach(() => {
  delete process.env[FLAG];
});

describe("buildWorldModel - flag gating", () => {
  it("defers world_disabled in the real environment (flag unset): default OFF", async () => {
    const outcome = await buildWorldModel(VALID_REQUEST);

    expect(outcome).toEqual({ kind: "deferred", reason: "world_disabled" });
  });

  it("defers world_disabled when the injected flag reader is off", async () => {
    const outcome = await buildWorldModel(VALID_REQUEST, { isFlagEnabled: () => false });

    expect(outcome).toEqual({ kind: "deferred", reason: "world_disabled" });
  });

  it("fails closed when the flag reader throws", async () => {
    const outcome = await buildWorldModel(VALID_REQUEST, {
      isFlagEnabled: () => {
        throw new Error("flag down");
      },
    });

    expect(outcome).toEqual({ kind: "deferred", reason: "world_disabled" });
  });

  it("reads exactly the world-model flag", async () => {
    const seen: string[] = [];
    await buildWorldModel(VALID_REQUEST, {
      isFlagEnabled: (flag) => {
        seen.push(flag);
        return true;
      },
    });

    expect(seen).toEqual([WORLD_MODEL_FLAG]);
    expect(WORLD_MODEL_FLAG).toBe("ENABLE_WORLD_MODEL");
  });

  it("checks the flag before validating the request", async () => {
    const outcome = await buildWorldModel(null, { isFlagEnabled: () => false });

    expect(outcome).toEqual({ kind: "deferred", reason: "world_disabled" });
  });

  it("is inert unless the flag is explicitly truthy in the environment", async () => {
    process.env[FLAG] = "false";
    expect((await buildWorldModel(VALID_REQUEST)).kind).toBe("deferred");

    process.env[FLAG] = "ture"; // typo must not enable
    expect((await buildWorldModel(VALID_REQUEST)).kind).toBe("deferred");

    process.env[FLAG] = "1";
    expect((await buildWorldModel(VALID_REQUEST)).kind).toBe("built");
  });
});

describe("buildWorldModel - request validation", () => {
  it("defers invalid_request for unusable requests, even with the flag on", async () => {
    for (const request of [null, undefined, 42, "world", [], {}, { userId: "" }, { userId: 42 }]) {
      const outcome = await buildWorldModel(request, FLAG_ON);
      expect(outcome).toEqual({ kind: "deferred", reason: "invalid_request" });
    }
  });

  it("never throws for hostile request or hostile deps", async () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("boom");
        },
      },
    );

    for (const args of [
      [hostile, FLAG_ON],
      [VALID_REQUEST, hostile],
      [VALID_REQUEST, null],
    ] as Array<Parameters<typeof buildWorldModel>>) {
      const outcome = await buildWorldModel(...args);
      expect(["deferred", "built"]).toContain(outcome.kind);
    }
  });
});

describe("buildWorldModel - built outcomes", () => {
  it("builds an empty-but-real snapshot for a minimal valid request", async () => {
    const outcome = await buildWorldModel({ userId: USER_ID }, FLAG_ON);

    expect(outcome).toEqual({
      kind: "built",
      state: { userId: USER_ID, entities: [], relations: [], asOf: null },
      predictions: [],
      updates: [],
    });
  });

  it("projects the caller's memories into the snapshot", async () => {
    const outcome = await buildWorldModel(VALID_REQUEST, FLAG_ON);

    expect(outcome.kind).toBe("built");
    if (outcome.kind === "built") {
      expect(outcome.state.entities).toEqual([
        expect.objectContaining({ id: "mem-1", status: "active", source: "memory" }),
      ]);
    }
  });

  it("includes predictions only when the request carries an action", async () => {
    const without = await buildWorldModel(VALID_REQUEST, FLAG_ON);
    const withAction = await buildWorldModel(
      { ...VALID_REQUEST, action: { kind: "add_entity", label: "Novel idea" } },
      FLAG_ON,
    );

    if (without.kind === "built") expect(without.predictions).toEqual([]);
    expect(withAction.kind).toBe("built");
    if (withAction.kind === "built") {
      expect(withAction.predictions).toHaveLength(1);
      expect(withAction.predictions[0].effect).toBe("entity_created");
    }
  });

  it("includes updates only when the request carries an observation", async () => {
    const without = await buildWorldModel(VALID_REQUEST, FLAG_ON);
    const withObservation = await buildWorldModel(
      { ...VALID_REQUEST, observation: { confirmedEntityIds: ["mem-1"] } },
      FLAG_ON,
    );

    if (without.kind === "built") expect(without.updates).toEqual([]);
    expect(withObservation.kind).toBe("built");
    if (withObservation.kind === "built") {
      expect(withObservation.updates).toEqual([
        expect.objectContaining({ type: "entity_confirmed", refId: "mem-1" }),
      ]);
    }
  });

  it("wires both an action and an observation in one request", async () => {
    const outcome = await buildWorldModel(
      {
        ...VALID_REQUEST,
        action: { kind: "update_entity", targetId: "mem-1" },
        observation: { contradictedEntityIds: ["mem-1"] },
      },
      FLAG_ON,
    );

    expect(outcome.kind).toBe("built");
    if (outcome.kind === "built") {
      expect(outcome.predictions[0].effect).toBe("entity_reinforced");
      expect(outcome.updates[0].type).toBe("entity_contradicted");
    }
  });

  it("ignores a malformed action field instead of guessing", async () => {
    const outcome = await buildWorldModel({ ...VALID_REQUEST, action: "string" }, FLAG_ON);

    expect(outcome.kind).toBe("built");
    if (outcome.kind === "built") expect(outcome.predictions).toEqual([]);
  });

  it("is deterministic: identical requests yield identical outcomes", async () => {
    const request = {
      ...VALID_REQUEST,
      action: { kind: "add_entity", label: "Novel idea" },
      observation: { confirmedEntityIds: ["mem-1"] },
    };

    expect(await buildWorldModel(request, FLAG_ON)).toEqual(
      await buildWorldModel(request, FLAG_ON),
    );
  });
});

describe("continual world model - production isolation", () => {
  const PRODUCTION_FILES = [
    ["app", "api", "chat", "route.ts"],
    ["lib", "agent", "loop.ts"],
    ["lib", "agent", "runner.ts"],
    ["lib", "core", "pipeline.ts"],
  ] as const;

  const WORLD_FILES = ["types", "constants", "snapshot", "predict", "update", "index"];

  it("is imported by no production file", () => {
    for (const segments of PRODUCTION_FILES) {
      const source = readSource(...segments);

      expect(source).not.toMatch(/agent\/world/);
      expect(source).not.toMatch(/ENABLE_WORLD_MODEL/);
      expect(source).not.toMatch(/buildWorldModel|WORLD_MODEL/);
    }
  });

  it("keeps the live chat path untouched", () => {
    const route = readSource("app", "api", "chat", "route.ts");

    expect(route).toMatch(/preStreamPipeline/);
    expect(route).toMatch(/getProvider/);
    expect(route).not.toMatch(/buildWorldModel|predictEffects|proposeWorldUpdates/);
  });

  it("statically imports no repository, supabase client, provider, or writer", () => {
    for (const name of WORLD_FILES) {
      const source = readSource("lib", "agent", "world", name + ".ts");

      expect(source).not.toMatch(/@\/lib\/repositories/);
      expect(source).not.toMatch(/@\/lib\/supabase/);
      expect(source).not.toMatch(/@\/lib\/ai/);
      expect(source).not.toMatch(/from\s+["']@\/lib\/memory\/memory["']/);
      expect(source).not.toMatch(/\.rpc\s*\(/);
      expect(source).not.toMatch(/\bfetch\s*\(/);
    }
  });

  it("keeps the agent loop and runner untouched by the world model", () => {
    for (const segments of [
      ["lib", "agent", "loop.ts"],
      ["lib", "agent", "runner.ts"],
    ] as const) {
      const source = readSource(...segments);

      expect(source).not.toMatch(/world/i);
    }
  });
});

