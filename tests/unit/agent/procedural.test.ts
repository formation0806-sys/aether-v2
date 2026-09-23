/** Unit tests for the procedural memory foundation (Priority 3).
 *
 * Exercises the deterministic gate and the flag-gated extractOrDefer entry
 * point with a pure skeleton. No model, no network, no database, no
 * environment dependency beyond injected stubs. Nothing here is wired into
 * extraction, the job worker, or the chat route.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  classifyProceduralKind,
  isProceduralRequest,
  MAX_PROCEDURAL_MESSAGE_CHARS,
} from "@/lib/agent/procedural/gate";
import {
  MAX_PROCEDURAL_GOAL_CHARS,
  MAX_SKELETON_ACTION_CHARS,
  MAX_SKELETON_NAME_CHARS,
  PROCEDURAL_KINDS,
  SKELETON_CONFIDENCE,
  SKELETON_STEP_ID,
  extractOrDefer,
  isExtractedOutcome,
  skeletonMemory,
} from "@/lib/agent/procedural/index";
import type { ProceduralRequest } from "@/lib/agent/procedural/types";

function readSource(...segments: string[]): string {
  return readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

const GATE_SOURCE = readSource("lib", "agent", "procedural", "gate.ts");
const INDEX_SOURCE = readSource("lib", "agent", "procedural", "index.ts");
const TYPES_SOURCE = readSource("lib", "agent", "procedural", "types.ts");

const USER_ID = "11111111-1111-4111-8111-111111111111";

/** A user id that is deliberately not a uuid, to prove it is never required. */
const NON_UUID_USER = "not-a-uuid";

function request(message: unknown): ProceduralRequest {
  return { userId: USER_ID, message } as unknown as ProceduralRequest;
}

function proceduralOn() {
  return { isFlagEnabled: () => true };
}

function proceduralOff() {
  return { isFlagEnabled: () => false };
}

describe("procedural gate - workflow phrasing", () => {
  it.each([
    "my workflow for shipping releases",
    "this is my process for onboarding",
    "my routine is the same every morning",
    "my checklist before deploying",
    "the procedure for handling refunds",
    "step by step, how I review a pull request",
    "the steps I take to publish a post",
    "the order I do things in when I cook",
  ])("accepts %j as a workflow", (message) => {
    expect(classifyProceduralKind(message)).toBe("workflow");
    expect(isProceduralRequest(message)).toBe(true);
  });
});

describe("procedural gate - strategy phrasing", () => {
  it.each([
    "my strategy for picking which project to start",
    "my approach to debugging a flaky test",
    "our playbook when a customer complains",
    "the best way to learn a new language",
    "how I decide between two job offers",
  ])("accepts %j as a strategy", (message) => {
    expect(classifyProceduralKind(message)).toBe("strategy");
    expect(isProceduralRequest(message)).toBe(true);
  });
});

describe("procedural gate - skill phrasing", () => {
  it.each([
    "I know how to run a post mortem",
    "I learned how to tune a database index",
    "I am good at explaining hard tradeoffs",
    "I've mastered sourdough baking",
    "my expertise is in distributed systems",
  ])("accepts %j as a skill", (message) => {
    expect(classifyProceduralKind(message)).toBe("skill");
    expect(isProceduralRequest(message)).toBe(true);
  });
});

describe("procedural gate - ordinary chat is never a procedure", () => {
  it.each([
    "how are you doing today",
    "hello there",
    "thanks, that helps",
    "what is the capital of France",
    "tell me a joke",
    "I like coffee in the morning",
    "can you help me",
    "",
    "   ",
  ])("rejects %j", (message) => {
    expect(classifyProceduralKind(message)).toBeNull();
    expect(isProceduralRequest(message)).toBe(false);
  });
});

describe("procedural gate - hard negatives belong to other capabilities", () => {
  it.each([
    "my name is Prince",
    "what's the time right now",
    "what time is it",
    "calculate 2 + 2",
    "search the web for news",
    "make a plan to launch my startup",
    "give me a roadmap for learning piano",
    "break this down into steps for me",
  ])("rejects %j", (message) => {
    expect(classifyProceduralKind(message)).toBeNull();
  });
});

describe("procedural gate - input safety", () => {
  it("rejects non-strings and non-string-like values", () => {
    expect(classifyProceduralKind(null)).toBeNull();
    expect(classifyProceduralKind(undefined)).toBeNull();
    expect(classifyProceduralKind(42)).toBeNull();
    expect(classifyProceduralKind(true)).toBeNull();
    expect(classifyProceduralKind({})).toBeNull();
    expect(classifyProceduralKind([])).toBeNull();
    expect(classifyProceduralKind(() => "my workflow")).toBeNull();
  });

  it("rejects an oversized message rather than truncating it", () => {
    const long = `my workflow ${"x".repeat(MAX_PROCEDURAL_MESSAGE_CHARS)}`;

    // The same phrasing without the padding is accepted, so the rejection
    // below can only come from the length cap and not from a pattern that
    // simply failed to match.
    expect(long.length).toBeGreaterThan(MAX_PROCEDURAL_MESSAGE_CHARS);
    expect(classifyProceduralKind("my workflow for deploys")).toBe("workflow");
    expect(classifyProceduralKind(long)).toBeNull();
  });

  it("accepts a message exactly at the cap", () => {
    const prefix = "my workflow ";

    const exact = `${prefix}${"x".repeat(
      MAX_PROCEDURAL_MESSAGE_CHARS - prefix.length,
    )}`;

    expect(exact.length).toBe(MAX_PROCEDURAL_MESSAGE_CHARS);
    expect(classifyProceduralKind(exact)).toBe("workflow");
  });

  it("rejects a message one character over the cap", () => {
    const prefix = "my workflow ";

    const over = `${prefix}${"x".repeat(
      MAX_PROCEDURAL_MESSAGE_CHARS - prefix.length + 1,
    )}`;

    expect(over.length).toBe(MAX_PROCEDURAL_MESSAGE_CHARS + 1);
    expect(classifyProceduralKind(over)).toBeNull();
  });

  it("never throws for adversarial input", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("hostile");
        },
      },
    );

    expect(() => classifyProceduralKind(hostile)).not.toThrow();
    expect(classifyProceduralKind(hostile)).toBeNull();
    expect(() => isProceduralRequest(hostile)).not.toThrow();
  });

  it("delegates: isProceduralRequest agrees with the classifier", () => {
    for (const message of [
      "my workflow for deploys",
      "my strategy for hiring",
      "I know how to debug this",
      "how are you doing today",
      "my name is Prince",
      "",
    ]) {
      expect(isProceduralRequest(message)).toBe(
        classifyProceduralKind(message) !== null,
      );
    }
  });
});

describe("extractOrDefer - flag gating", () => {
  it("defers with procedural_disabled when the flag is off", async () => {
    const outcome = await extractOrDefer(
      request("my workflow for shipping releases"),
      proceduralOff(),
    );

    expect(outcome.kind).toBe("deferred");
    expect(outcome["reason"]).toBe("procedural_disabled");
  });

  it("checks the flag before the gate, so a disabled run classifies nothing", async () => {
    let gateCalls = 0;

    const outcome = await extractOrDefer(
      request("my workflow for shipping releases"),
      {
        isFlagEnabled: () => false,
        isProcedural: () => {
          gateCalls += 1;

          return true;
        },
      },
    );

    expect(outcome.kind).toBe("deferred");
    expect(gateCalls).toBe(0);
  });

  it("stays disabled in the real environment, where the flag is unset", async () => {
    const outcome = await extractOrDefer(
      request("my workflow for shipping releases"),
    );

    expect(outcome.kind).toBe("deferred");
    expect(outcome["reason"]).toBe("procedural_disabled");
  });

  it("fails closed when the flag reader throws", async () => {
    const outcome = await extractOrDefer(
      request("my workflow for shipping releases"),
      {
        isFlagEnabled: () => {
          throw new Error("flag backend down");
        },
      },
    );

    expect(outcome.kind).toBe("deferred");
    expect(outcome["reason"]).toBe("procedural_disabled");
  });

  it("treats a non-boolean truthy flag result as disabled", async () => {
    const outcome = await extractOrDefer(request("my workflow for deploys"), {
      isFlagEnabled: (() => "yes") as unknown as () => boolean,
    });

    expect(outcome.kind).toBe("deferred");
    expect(outcome["reason"]).toBe("procedural_disabled");
  });

  it("reads exactly ENABLE_PROCEDURAL_MEMORY", async () => {
    const seen: string[] = [];

    await extractOrDefer(request("my workflow for deploys"), {
      isFlagEnabled: (flag) => {
        seen.push(flag);

        return false;
      },
    });

    expect(seen).toEqual(["ENABLE_PROCEDURAL_MEMORY"]);
  });
});

describe("extractOrDefer - request validity precedes classification", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty object", {}],
    ["missing message", { userId: USER_ID }],
    ["numeric message", { userId: USER_ID, message: 42 }],
    ["blank message", { userId: USER_ID, message: "   " }],
    ["array message", { userId: USER_ID, message: [] }],
  ])("returns invalid_request for a %s", async (_label, value) => {
    const outcome = await extractOrDefer(
      value as unknown as ProceduralRequest,
      proceduralOn(),
    );

    expect(outcome.kind).toBe("deferred");
    expect(outcome["reason"]).toBe("invalid_request");
  });

  it("rejects an oversized message before classifying it", async () => {
    let gateCalls = 0;

    const outcome = await extractOrDefer(
      request(`my workflow ${"x".repeat(MAX_PROCEDURAL_GOAL_CHARS)}`),
      {
        isFlagEnabled: () => true,
        isProcedural: () => {
          gateCalls += 1;

          return true;
        },
      },
    );

    expect(outcome.kind).toBe("deferred");
    expect(outcome["reason"]).toBe("invalid_request");
    expect(gateCalls).toBe(0);
  });

  it("defers with not_procedural for ordinary chat", async () => {
    const outcome = await extractOrDefer(
      request("how are you doing today"),
      proceduralOn(),
    );

    expect(outcome.kind).toBe("deferred");
    expect(outcome["reason"]).toBe("not_procedural");
  });

  it("defers with not_procedural when an injected gate rejects", async () => {
    const outcome = await extractOrDefer(request("my workflow for deploys"), {
      isFlagEnabled: () => true,
      isProcedural: () => false,
    });

    expect(outcome.kind).toBe("deferred");
    expect(outcome["reason"]).toBe("not_procedural");
  });

  it("defers with not_procedural when an injected gate throws", async () => {
    const outcome = await extractOrDefer(request("my workflow for deploys"), {
      isFlagEnabled: () => true,
      isProcedural: () => {
        throw new Error("gate exploded");
      },
    });

    expect(outcome.kind).toBe("deferred");
    expect(outcome["reason"]).toBe("not_procedural");
  });
});

describe("extractOrDefer - skeleton extraction", () => {
  it("extracts a procedural memory tagged with the existing memory type", async () => {
    const outcome = await extractOrDefer(
      request("my workflow for shipping releases"),
      proceduralOn(),
    );

    expect(outcome.kind).toBe("extracted");
    expect(isExtractedOutcome(outcome)).toBe(true);

    const memory = outcome.kind === "extracted" ? outcome.memory : null;

    expect(memory?.memoryType).toBe("procedural");
    expect(memory?.kind).toBe("workflow");
  });

  it("carries the classified kind through to the memory", async () => {
    const cases: Array<[string, string]> = [
      ["my workflow for shipping releases", "workflow"],
      ["my strategy for picking a project", "strategy"],
      ["I know how to run a post mortem", "skill"],
    ];

    for (const [message, expected] of cases) {
      const outcome = await extractOrDefer(request(message), proceduralOn());

      expect(outcome.kind).toBe("extracted");
      expect(outcome.kind === "extracted" ? outcome.memory.kind : null).toBe(
        expected,
      );
    }
  });

  it("uses the user's words and invents nothing", async () => {
    const outcome = await extractOrDefer(
      request("my workflow for shipping releases"),
      proceduralOn(),
    );

    const memory = outcome.kind === "extracted" ? outcome.memory : null;

    expect(memory?.name).toBe("my workflow for shipping releases");
    expect(memory?.trigger).toBe("my workflow for shipping releases");
    expect(memory?.outcome).toBe("");
    expect(memory?.preconditions).toEqual([]);
  });

  it("builds one ordered placeholder step", async () => {
    const outcome = await extractOrDefer(
      request("my workflow for shipping releases"),
      proceduralOn(),
    );

    const memory = outcome.kind === "extracted" ? outcome.memory : null;

    expect(memory?.steps).toHaveLength(1);
    expect(memory?.steps[0]?.id).toBe(SKELETON_STEP_ID);
    expect(memory?.steps[0]?.order).toBe(1);
    expect(memory?.steps[0]?.action).toBe("my workflow for shipping releases");
  });

  it("reports low confidence, because nothing was actually extracted", async () => {
    const outcome = await extractOrDefer(
      request("my workflow for shipping releases"),
      proceduralOn(),
    );

    const memory = outcome.kind === "extracted" ? outcome.memory : null;

    expect(memory?.confidence).toBe(SKELETON_CONFIDENCE);
    expect(memory?.confidence).toBeLessThan(0.5);
  });

  it("caps the name and the step action independently", () => {
    const long = "x".repeat(MAX_SKELETON_ACTION_CHARS + 50);

    const memory = skeletonMemory(long, "workflow");

    expect(memory.steps[0]?.action.length).toBe(MAX_SKELETON_ACTION_CHARS);
    expect(memory.name.length).toBeLessThanOrEqual(MAX_SKELETON_NAME_CHARS);
    expect(memory.trigger.length).toBeLessThanOrEqual(MAX_PROCEDURAL_GOAL_CHARS);
  });

  it("is deterministic: identical input gives an identical memory", async () => {
    const first = await extractOrDefer(
      request("my workflow for shipping releases"),
      proceduralOn(),
    );
    const second = await extractOrDefer(
      request("my workflow for shipping releases"),
      proceduralOn(),
    );

    expect(first).toEqual(second);
  });

  it("trims the message before shaping the memory", async () => {
    const outcome = await extractOrDefer(
      request("   my workflow for shipping releases   "),
      proceduralOn(),
    );

    const memory = outcome.kind === "extracted" ? outcome.memory : null;

    expect(memory?.name).toBe("my workflow for shipping releases");
  });

  it("does not require a uuid user id, because it writes nothing", async () => {
    const outcome = await extractOrDefer(
      { userId: NON_UUID_USER, message: "my workflow for deploys" },
      proceduralOn(),
    );

    expect(outcome.kind).toBe("extracted");
  });
});

describe("extractOrDefer - never throws", () => {
  it("resolves for every shape of hostile input", async () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("hostile");
        },
      },
    );

    const inputs = [
      null,
      undefined,
      hostile,
      "my workflow for deploys",
      42,
      [],
      () => {},
    ];

    for (const input of inputs) {
      const outcome = await extractOrDefer(
        input as unknown as ProceduralRequest,
        proceduralOn(),
      );

      expect(["extracted", "deferred"]).toContain(outcome.kind);
    }
  });

  it("resolves when the dependency bag itself is hostile", async () => {
    const hostileDeps = new Proxy(
      {},
      {
        get() {
          throw new Error("hostile deps");
        },
      },
    );

    const outcome = await extractOrDefer(
      request("my workflow for deploys"),
      hostileDeps as never,
    );

    expect(outcome.kind).toBe("deferred");
  });

  it("always returns a valid ProceduralOutcome", async () => {
    const outcomes = await Promise.all([
      extractOrDefer(request("my workflow for deploys"), proceduralOn()),
      extractOrDefer(request("how are you doing today"), proceduralOn()),
      extractOrDefer(request("my workflow for deploys"), proceduralOff()),
      extractOrDefer({} as ProceduralRequest, proceduralOn()),
    ]);

    for (const outcome of outcomes) {
      expect(isExtractedOutcome(outcome)).toBe(true);
    }
  });
});

// __APPEND_ANCHOR__
