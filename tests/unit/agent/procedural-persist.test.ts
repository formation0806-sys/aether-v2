/**
 * Unit tests for procedural memory persistence (Priority 3).
 *
 * Exercises the flag-gated extractAndPersistProcedural entry point and the
 * persistProceduralMemory writer with an injected stub saver only: no Supabase,
 * no embeddings, no model, no network, no environment dependency beyond
 * injected stubs. Nothing here is wired into production: the chat route, the
 * memory extraction pipeline and the job worker remain untouched, and
 * ENABLE_PROCEDURAL_MEMORY stays default OFF.
 */

import { describe, expect, it, vi } from "vitest";

import {
  extractAndPersistProcedural,
  loadSaver,
  MAX_PERSIST_CONTENT_CHARS,
  MAX_PERSIST_STEP_CHARS,
  MAX_PERSIST_TITLE_CHARS,
  persistProceduralMemory,
  PROCEDURAL_MEMORY_SOURCE,
  PROCEDURAL_MEMORY_STATUS,
  PROCEDURAL_MEMORY_TAG,
  PROCEDURAL_SOURCE_REF,
  type ExtractAndPersistProceduralDeps,
  type ProceduralSaver,
} from "@/lib/agent/procedural/persist";
import type {
  ProceduralMemory,
  ProceduralRequest,
} from "@/lib/agent/procedural/types";

const USER_ID = "11111111-1111-4111-8111-111111111111";

/** A user id that is deliberately not a uuid: persistence must skip it. */
const NON_UUID_USER = "not-a-uuid";

/** A message the deterministic gate accepts as procedural. */
const PROCEDURAL_MESSAGE = "my workflow for shipping releases";

/** A message the deterministic gate rejects as ordinary chat. */
const ORDINARY_MESSAGE = "how are you doing today";

type SaveInput = Parameters<ProceduralSaver>[0];

/** Builds a request carrying a valid owner id and the given message. */
function request(message = PROCEDURAL_MESSAGE): ProceduralRequest {
  return { userId: USER_ID, message };
}

/** A well-formed procedural memory; override any field per test. */
function memory(overrides: Partial<ProceduralMemory> = {}): ProceduralMemory {
  return {
    memoryType: "procedural",
    kind: "workflow",
    name: "Release checklist",
    trigger: "before deploying",
    steps: [{ id: "s1", order: 1, action: "run the tests" }],
    preconditions: ["CI is green"],
    outcome: "a clean release",
    confidence: 0.6,
    ...overrides,
  };
}

/** A stub saver that records every input and resolves with the given result.
 * Uses rest args so `stubSaver(undefined)` records an explicit undefined
 * result instead of falling back to the default row id. */
function stubSaver(...resultArgs: [] | [unknown]): {
  saver: ProceduralSaver;
  calls: SaveInput[];
} {
  const result = resultArgs.length === 1 ? resultArgs[0] : { id: "row-1" };
  const calls: SaveInput[] = [];
  const saver: ProceduralSaver = async (input) => {
    calls.push(input);
    return result;
  };

  return { saver, calls };
}

/** A stub saver that records its input and then throws. */
function throwingSaver(): { saver: ProceduralSaver; calls: SaveInput[] } {
  const calls: SaveInput[] = [];
  const saver: ProceduralSaver = async (input) => {
    calls.push(input);
    throw new Error("save failed");
  };

  return { saver, calls };
}

/** A stub chat provider whose reply never validates, forcing the skeleton. */
function stubProvider() {
  return { chat: vi.fn(async () => "definitely not json") };
}

/** Deps with the flag ON and a stub provider; `persist` defaults to false. */
function onDeps(
  overrides: Partial<ExtractAndPersistProceduralDeps> = {},
): ExtractAndPersistProceduralDeps {
  return { isFlagEnabled: () => true, provider: stubProvider(), ...overrides };
}

describe("procedural persist - flag gating", () => {
  it("defers with procedural_disabled and performs zero writes when the flag is off", async () => {
    const { saver, calls } = stubSaver();
    const provider = stubProvider();

    const outcome = await extractAndPersistProcedural(request(), {
      isFlagEnabled: () => false,
      provider,
      saver,
      persist: true,
    });

    expect(outcome).toEqual({
      kind: "deferred",
      reason: "procedural_disabled",
      persistence: null,
    });
    expect(calls).toHaveLength(0);
    expect(provider.chat).not.toHaveBeenCalled();
  });

  it("defers when ENABLE_PROCEDURAL_MEMORY is absent from the environment", async () => {
    vi.stubEnv("ENABLE_PROCEDURAL_MEMORY", "");

    try {
      const { saver, calls } = stubSaver();
      const provider = stubProvider();

      const outcome = await extractAndPersistProcedural(request(), {
        provider,
        saver,
        persist: true,
      });

      expect(outcome).toEqual({
        kind: "deferred",
        reason: "procedural_disabled",
        persistence: null,
      });
      expect(calls).toHaveLength(0);
      expect(provider.chat).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("defers without writing when the message is not procedural", async () => {
    const { saver, calls } = stubSaver();

    const outcome = await extractAndPersistProcedural(
      request(ORDINARY_MESSAGE),
      onDeps({ saver, persist: true }),
    );

    expect(outcome).toEqual({
      kind: "deferred",
      reason: "not_procedural",
      persistence: null,
    });
    expect(calls).toHaveLength(0);
  });
});

describe("procedural persist - persist:false is inert", () => {
  it("extracts without writing when persist is false", async () => {
    const { saver, calls } = stubSaver();

    const outcome = await extractAndPersistProcedural(
      request(),
      onDeps({ saver, persist: false }),
    );

    expect(outcome.kind).toBe("extracted");
    expect(outcome.kind === "extracted" && outcome.persistence).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("extracts without writing when persist is omitted entirely", async () => {
    const { saver, calls } = stubSaver();

    const outcome = await extractAndPersistProcedural(request(), onDeps({ saver }));

    expect(outcome.kind).toBe("extracted");
    expect(outcome.kind === "extracted" && outcome.persistence).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe("procedural persist - persist:true happy path", () => {
  it("persists through the stub saver and reports persisted with the row id", async () => {
    const { saver, calls } = stubSaver({ id: "row-42" });

    const outcome = await extractAndPersistProcedural(
      request(),
      onDeps({ saver, persist: true }),
    );

    expect(outcome.kind).toBe("extracted");
    expect(outcome.kind === "extracted" && outcome.persistence).toMatchObject({
      status: "persisted",
      reason: null,
      id: "row-42",
    });
    expect(calls).toHaveLength(1);
  });

  it("writes a row shaped for the existing memory path", async () => {
    const { saver, calls } = stubSaver({ id: "row-1" });

    await persistProceduralMemory(memory(), USER_ID, saver);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      userId: USER_ID,
      memoryType: "procedural",
      status: PROCEDURAL_MEMORY_STATUS,
      tags: [PROCEDURAL_MEMORY_TAG],
      importance: 5,
      confidence: 0.6,
      explicit: false,
      source: PROCEDURAL_MEMORY_SOURCE,
      sourceRef: PROCEDURAL_SOURCE_REF,
    });
    expect(calls[0].title.length).toBeGreaterThan(0);
    expect(calls[0].content.length).toBeGreaterThan(0);
  });

  it("reports persisted_idempotent when the saver returns no id", async () => {
    for (const result of [{}, null, undefined, { id: null }]) {
      const { saver, calls } = stubSaver(result);

      const persistence = await persistProceduralMemory(memory(), USER_ID, saver);

      expect(persistence.status).toBe("persisted_idempotent");
      expect(persistence.reason).toBeNull();
      expect(persistence.id).toBeNull();
      expect(calls).toHaveLength(1);
    }
  });

  it("reports failed with save_memory_error when the saver throws", async () => {
    const { saver, calls } = throwingSaver();

    const persistence = await persistProceduralMemory(memory(), USER_ID, saver);

    expect(persistence.status).toBe("failed");
    expect(persistence.reason).toBe("save_memory_error");
    expect(persistence.id).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("folds a saver failure into the extractAndPersist outcome", async () => {
    const { saver } = throwingSaver();

    const outcome = await extractAndPersistProcedural(
      request(),
      onDeps({ saver, persist: true }),
    );

    expect(outcome.kind).toBe("extracted");
    const persistence = outcome.kind === "extracted" ? outcome.persistence : null;
    expect(persistence?.status).toBe("failed");
    expect(persistence?.reason).toBe("save_memory_error");
  });
});

describe("procedural persist - invalid userId", () => {
  it("skips with invalid_request and never calls the saver", async () => {
    const { saver, calls } = stubSaver();

    const persistence = await persistProceduralMemory(
      memory(),
      NON_UUID_USER,
      saver,
    );

    expect(persistence.status).toBe("skipped");
    expect(persistence.reason).toBe("invalid_request");
    expect(persistence.id).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("skips through extractAndPersist when the request carries no valid owner", async () => {
    const { saver, calls } = stubSaver();

    const outcome = await extractAndPersistProcedural(
      { userId: NON_UUID_USER, message: PROCEDURAL_MESSAGE },
      onDeps({ saver, persist: true }),
    );

    expect(outcome.kind).toBe("extracted");
    const persistence = outcome.kind === "extracted" ? outcome.persistence : null;
    expect(persistence?.status).toBe("skipped");
    expect(persistence?.reason).toBe("invalid_request");
    expect(calls).toHaveLength(0);
  });

  it("skips when the request has no userId at all", async () => {
    const { saver, calls } = stubSaver();

    const outcome = await extractAndPersistProcedural(
      { message: PROCEDURAL_MESSAGE } as unknown as ProceduralRequest,
      onDeps({ saver, persist: true }),
    );

    const persistence = outcome.kind === "extracted" ? outcome.persistence : null;
    expect(persistence?.status).toBe("skipped");
    expect(calls).toHaveLength(0);
  });
});

describe("procedural persist - title and content builders", () => {
  it("caps the title at MAX_PERSIST_TITLE_CHARS", async () => {
    const { saver, calls } = stubSaver();

    await persistProceduralMemory(
      memory({ name: "T".repeat(MAX_PERSIST_TITLE_CHARS + 80) }),
      USER_ID,
      saver,
    );

    expect(calls[0].title).toHaveLength(MAX_PERSIST_TITLE_CHARS);
  });

  it("keeps a title that already fits, byte for byte", async () => {
    const { saver, calls } = stubSaver();

    await persistProceduralMemory(
      memory({ name: "Release checklist" }),
      USER_ID,
      saver,
    );

    expect(calls[0].title).toBe("Release checklist");
  });

  it("falls back to a default title when the name is empty", async () => {
    const { saver, calls } = stubSaver();

    await persistProceduralMemory(memory({ name: "" }), USER_ID, saver);

    expect(calls[0].title).toBe("procedural memory");
  });

  it("uses the same deterministic title for the same memory", async () => {
    const first = stubSaver();
    const second = stubSaver();
    const source = memory({ name: "Deploy runbook" });

    await persistProceduralMemory(source, USER_ID, first.saver);
    await persistProceduralMemory(source, USER_ID, second.saver);

    expect(first.calls[0].title).toBe(second.calls[0].title);
    expect(first.calls[0].title).toBe("Deploy runbook");
  });

  it("renders trigger, kind, confidence, steps, preconditions and outcome", async () => {
    const { saver, calls } = stubSaver();

    await persistProceduralMemory(memory(), USER_ID, saver);

    const content = calls[0].content;
    expect(content).toContain("trigger: before deploying");
    expect(content).toContain("kind: workflow");
    expect(content).toContain("confidence: 0.6");
    expect(content).toContain("- step 1: run the tests");
    expect(content).toContain("preconditions:");
    expect(content).toContain("- CI is green");
    expect(content).toContain("outcome: a clean release");
  });

  it("caps each rendered step line at MAX_PERSIST_STEP_CHARS", async () => {
    const { saver, calls } = stubSaver();
    const longAction = "a".repeat(MAX_PERSIST_STEP_CHARS + 100);

    await persistProceduralMemory(
      memory({ steps: [{ id: "s1", order: 1, action: longAction }] }),
      USER_ID,
      saver,
    );

    const content = calls[0].content;
    expect(content).toContain("a".repeat(MAX_PERSIST_STEP_CHARS));
    expect(content).not.toContain("a".repeat(MAX_PERSIST_STEP_CHARS + 1));
  });

  it("caps the whole content payload at MAX_PERSIST_CONTENT_CHARS", async () => {
    const { saver, calls } = stubSaver();

    await persistProceduralMemory(
      memory({ trigger: "x".repeat(MAX_PERSIST_CONTENT_CHARS * 2) }),
      USER_ID,
      saver,
    );

    expect(calls[0].content).toHaveLength(MAX_PERSIST_CONTENT_CHARS);
  });

  it("leaves content that already fits untouched", async () => {
    const { saver, calls } = stubSaver();

    await persistProceduralMemory(memory(), USER_ID, saver);

    expect(calls[0].content.length).toBeLessThan(MAX_PERSIST_CONTENT_CHARS);
  });
});

describe("procedural persist - never throws", () => {
  it("resolves for a null memory instead of throwing", async () => {
    const { saver, calls } = stubSaver();

    const persistence = await persistProceduralMemory(
      null as unknown as ProceduralMemory,
      USER_ID,
      saver,
    );

    expect(persistence.status).toBe("skipped");
    expect(persistence.reason).toBe("not_procedural");
    expect(calls).toHaveLength(0);
  });

  it("survives a memory whose name getter throws", async () => {
    const { saver } = stubSaver();
    const hostile = {
      ...memory(),
      get name(): string {
        throw new Error("boom");
      },
    };

    const persistence = await persistProceduralMemory(hostile, USER_ID, saver);

    expect(persistence.status).toBe("persisted");
    expect(persistence.title).toBe("procedural memory");
  });

  it("survives a null request at the entry point", async () => {
    const outcome = await extractAndPersistProcedural(
      null as unknown as ProceduralRequest,
      onDeps({ persist: true }),
    );

    expect(outcome).toEqual({
      kind: "deferred",
      reason: "invalid_request",
      persistence: null,
    });
  });

  it("survives a flag reader that throws", async () => {
    const { saver, calls } = stubSaver();

    const outcome = await extractAndPersistProcedural(
      request(),
      onDeps({
        isFlagEnabled: () => {
          throw new Error("flag boom");
        },
        saver,
        persist: true,
      }),
    );

    expect(outcome.kind).toBe("deferred");
    expect(calls).toHaveLength(0);
  });

  it("degrades to the skeleton when the provider throws", async () => {
    const outcome = await extractAndPersistProcedural(
      request(),
      onDeps({
        provider: {
          chat: async () => {
            throw new Error("model down");
          },
        },
        persist: false,
      }),
    );

    expect(outcome.kind).toBe("extracted");
  });
});

describe("procedural persist - saver loading", () => {
  it("returns an injected saver unchanged", async () => {
    const { saver } = stubSaver();

    expect(await loadSaver(saver)).toBe(saver);
  });
});







