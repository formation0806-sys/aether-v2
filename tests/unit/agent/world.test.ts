/**
 * Unit tests for the world-state snapshot builder (Priority 6).
 *
 * Pure and deterministic: no database, no provider, no flags - just inputs in,
 * bounded WorldState out. Hostile input must never throw.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_WORLD_ENTITIES,
  MAX_WORLD_LABEL_CHARS,
  buildWorldState,
} from "@/lib/agent/world/index";
import { DEFAULT_CONFIDENCE } from "@/lib/memory/constants";

const MEMORY = (over: Record<string, unknown> = {}) => ({ id: "mem-1", ...over });

describe("buildWorldState - memory projection", () => {
  it("maps eligible memory statuses: active, candidate, fading -> uncertain", () => {
    const state = buildWorldState({
      userId: "u1",
      memories: [
        MEMORY({ id: "m1", status: "active" }),
        MEMORY({ id: "m2", status: "candidate" }),
        MEMORY({ id: "m3", status: "fading" }),
      ],
    });

    expect(state.entities.map((entity) => [entity.id, entity.status])).toEqual([
      ["m1", "active"],
      ["m2", "candidate"],
      ["m3", "uncertain"],
    ]);
    expect(state.entities.every((entity) => entity.source === "memory")).toBe(true);
  });

  it("excludes archived, deleted, merged, and unknown statuses from the world", () => {
    const state = buildWorldState({
      userId: "u1",
      memories: [
        MEMORY({ id: "m1", status: "archived" }),
        MEMORY({ id: "m2", status: "deleted" }),
        MEMORY({ id: "m3", status: "merged" }),
        MEMORY({ id: "m4", status: "garbage" }),
      ],
    });

    expect(state.entities).toEqual([]);
  });

  it("defaults a missing (or non-string) status to candidate", () => {
    const state = buildWorldState({
      userId: "u1",
      memories: [MEMORY({ id: "m1" }), MEMORY({ id: "m2", status: 42 })],
    });

    expect(state.entities.map((entity) => entity.status)).toEqual([
      "candidate",
      "candidate",
    ]);
  });

  it("reuses the memory-type vocabulary and falls back to semantic", () => {
    const state = buildWorldState({
      userId: "u1",
      memories: [
        MEMORY({ id: "m1", memoryType: "procedural" }),
        MEMORY({ id: "m2", memoryType: "identity" }),
        MEMORY({ id: "m3", memoryType: "not-a-type" }),
        MEMORY({ id: "m4" }),
      ],
    });

    expect(state.entities.map((entity) => entity.kind)).toEqual([
      "procedural",
      "identity",
      "semantic",
      "semantic",
    ]);
  });

  it("clamps confidence/importance into 0..1 and defaults like the write path", () => {
    const state = buildWorldState({
      userId: "u1",
      memories: [
        MEMORY({ id: "m1", confidence: 0.9, importance: 0.7 }),
        MEMORY({ id: "m2", confidence: 5, importance: -1 }),
        MEMORY({ id: "m3", confidence: "high", importance: "ten" }),
      ],
    });

    const [a, b, c] = state.entities;
    expect([a.confidence, a.importance]).toEqual([0.9, 0.7]);
    expect([b.confidence, b.importance]).toEqual([1, 0]);
    expect([c.confidence, c.importance]).toEqual([DEFAULT_CONFIDENCE, 0.5]);
  });

  it("trims and caps labels at MAX_WORLD_LABEL_CHARS", () => {
    const state = buildWorldState({
      userId: "u1",
      memories: [MEMORY({ id: "m1", title: "  Dark interface preference  " }),
        MEMORY({ id: "m2", title: "x".repeat(MAX_WORLD_LABEL_CHARS + 50) }),
        MEMORY({ id: "m3", title: 42 })],
    });

    expect(state.entities[0].label).toBe("Dark interface preference");
    expect(state.entities[1].label).toHaveLength(MAX_WORLD_LABEL_CHARS);
    expect(state.entities[2].label).toBe("");
  });

  it("dedupes by id (first wins) and caps at MAX_WORLD_ENTITIES", () => {
    const many = Array.from({ length: MAX_WORLD_ENTITIES + 10 }, (_, index) =>
      MEMORY({ id: "m" + index, title: "t" + index }),
    );
    const state = buildWorldState({
      userId: "u1",
      memories: [MEMORY({ id: "dup", title: "first" }), MEMORY({ id: "dup", title: "second" }), ...many],
    });

    expect(state.entities).toHaveLength(MAX_WORLD_ENTITIES);
    expect(state.entities[0].label).toBe("first");
    expect(state.entities.filter((entity) => entity.id === "dup")).toHaveLength(1);
  });
});

describe("buildWorldState - planner projection", () => {
  it("projects goals as active and tasks by status (done -> uncertain)", () => {
    const state = buildWorldState({
      userId: "u1",
      goals: [{ id: "g1", title: "Ship v1" }],
      tasks: [
        { id: "t1", title: "Draft", status: "todo" },
        { id: "t2", title: "Review", status: "done" },
        { id: "t3" },
      ],
    });

    expect(state.entities).toEqual([
      expect.objectContaining({ id: "g1", kind: "goal", status: "active", source: "planner" }),
      expect.objectContaining({ id: "t1", kind: "task", status: "active" }),
      expect.objectContaining({ id: "t2", kind: "task", status: "uncertain" }),
      expect.objectContaining({ id: "t3", kind: "task", status: "active" }),
    ]);
  });

  it("skips planner rows without a usable id, and hostile rows never throw", () => {
    const state = buildWorldState({
      userId: "u1",
      goals: [{ title: "no id" }, null, 42],
      tasks: "not-an-array",
    });

    expect(state.entities).toEqual([]);
  });
});

describe("buildWorldState - relations", () => {
  const TWO = {
    userId: "u1",
    memories: [MEMORY({ id: "a" }), MEMORY({ id: "b" })],
  };

  it("keeps only pairs whose endpoints exist in the snapshot", () => {
    const state = buildWorldState({
      ...TWO,
      relations: [
        { fromId: "a", toId: "b" },
        { fromId: "a", toId: "ghost" },
        { fromId: "ghost", toId: "b" },
      ],
    });

    expect(state.relations).toEqual([
      { fromId: "a", toId: "b", kind: "related_to", confidence: DEFAULT_CONFIDENCE },
    ]);
  });

  it("rejects self-relations, defaults kind, and normalizes confidence", () => {
    const state = buildWorldState({
      ...TWO,
      relations: [
        { fromId: "a", toId: "a", kind: "part_of" },
        { fromId: "a", toId: "b", kind: "bogus", confidence: 9 },
        { fromId: "b", toId: "a", kind: "contradicts", confidence: 0.5 },
      ],
    });

    expect(state.relations).toEqual([
      { fromId: "a", toId: "b", kind: "related_to", confidence: 1 },
      { fromId: "b", toId: "a", kind: "contradicts", confidence: 0.5 },
    ]);
  });

  it("dedupes by from|to|kind triple", () => {
    const state = buildWorldState({
      ...TWO,
      relations: [
        { fromId: "a", toId: "b", kind: "part_of" },
        { fromId: "a", toId: "b", kind: "part_of" },
        { fromId: "a", toId: "b", kind: "depends_on" },
      ],
    });

    expect(state.relations).toHaveLength(2);
  });
});

describe("buildWorldState - envelope, safety, determinism", () => {
  it("carries userId and asOf defensively", () => {
    const ok = buildWorldState({ userId: "  user-1  ", asOf: "2026-09-23T00:00:00Z" });
    expect(ok.userId).toBe("user-1");
    expect(ok.asOf).toBe("2026-09-23T00:00:00Z");

    expect(buildWorldState({ userId: 42 }).userId).toBeNull();
    expect(buildWorldState({ userId: "u", asOf: "" }).asOf).toBeNull();
    expect(buildWorldState({ userId: "u", asOf: 123 }).asOf).toBeNull();
  });

  it("returns the empty snapshot for a non-object request", () => {
    const empty = { userId: null, entities: [], relations: [], asOf: null };
    for (const request of [null, undefined, 42, "state", [1, 2]]) {
      expect(buildWorldState(request)).toEqual(empty);
    }
  });

  it("never throws for hostile input", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("boom");
        },
      },
    );

    expect(() => buildWorldState(hostile)).not.toThrow();
    expect(buildWorldState(hostile).entities).toEqual([]);
    expect(() =>
      buildWorldState({ userId: "u", memories: [null, 7, { id: { nested: true } }] }),
    ).not.toThrow();
  });

  it("is deterministic: same input twice yields identical states, input untouched", () => {
    const request = {
      userId: "u1",
      memories: [MEMORY({ id: "m1", status: "active", title: "T" })],
      goals: [{ id: "g1", title: "G" }],
      relations: [{ fromId: "m1", toId: "g1", kind: "part_of" }],
      asOf: "2026-09-23T00:00:00Z",
    };
    const snapshotOfInput = JSON.stringify(request);

    const first = buildWorldState(request);
    const second = buildWorldState(request);

    expect(first).toEqual(second);
    expect(JSON.stringify(request)).toBe(snapshotOfInput);
  });
});

