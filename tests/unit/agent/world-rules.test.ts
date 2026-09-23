/**
 * Unit tests for the world-model rules: the effect predictor and the update
 * proposer (Priority 6).
 *
 * Pure and deterministic: no database, no provider, no flags. Deltas must
 * reuse the existing memory constants rather than inventing new magnitudes.
 */

import { describe, expect, it } from "vitest";
import {
  WORLD_PREDICT_CONFIDENCE,
  buildWorldState,
  predictEffects,
  proposeWorldUpdates,
} from "@/lib/agent/world/index";
import {
  CONFIDENCE_CORRECTION_STEP,
  CONFIDENCE_CORROBORATION_STEP,
} from "@/lib/memory/constants";

const STATE = buildWorldState({
  userId: "u1",
  memories: [
    { id: "a", status: "active", title: "Dark Interface Preference" },
    { id: "b", status: "active", title: "Prefers tests first" },
  ],
  relations: [{ fromId: "a", toId: "b", kind: "related_to" }],
});

describe("predictEffects - add_entity", () => {
  it("reinforces on a case-insensitive label match, reusing the corroboration step", () => {
    const [prediction] = predictEffects(STATE, {
      kind: "add_entity",
      label: "  dark interface preference ",
    });

    expect(prediction).toEqual({
      action: "add_entity",
      effect: "entity_reinforced",
      targetId: "a",
      delta: CONFIDENCE_CORROBORATION_STEP,
      confidence: WORLD_PREDICT_CONFIDENCE.entity_reinforced,
      note: "rule:label_match",
    });
    expect(prediction.delta).toBe(0.05);
  });

  it("predicts entity_created for a novel label with delta 0", () => {
    const [prediction] = predictEffects(STATE, { kind: "add_entity", label: "New thing" });

    expect(prediction).toEqual({
      action: "add_entity",
      effect: "entity_created",
      delta: 0,
      confidence: WORLD_PREDICT_CONFIDENCE.entity_created,
      note: "rule:add_entity",
    });
  });

  it("predicts unknown when the label is missing or blank", () => {
    for (const action of [{ kind: "add_entity" }, { kind: "add_entity", label: "   " }]) {
      const [prediction] = predictEffects(STATE, action);
      expect(prediction.effect).toBe("unknown");
      expect(prediction.note).toBe("rule:missing_label");
    }
  });
});

describe("predictEffects - update_entity", () => {
  it("reinforces a known target with the corroboration step", () => {
    const [prediction] = predictEffects(STATE, { kind: "update_entity", targetId: "a" });

    expect(prediction.effect).toBe("entity_reinforced");
    expect(prediction.targetId).toBe("a");
    expect(prediction.delta).toBe(CONFIDENCE_CORROBORATION_STEP);
  });

  it("predicts no_state_change for an unknown target and unknown for a missing one", () => {
    const [unknownTarget] = predictEffects(STATE, { kind: "update_entity", targetId: "ghost" });
    expect(unknownTarget.effect).toBe("no_state_change");
    expect(unknownTarget.note).toBe("rule:target_unknown");

    const [missingTarget] = predictEffects(STATE, { kind: "update_entity" });
    expect(missingTarget.effect).toBe("unknown");
    expect(missingTarget.note).toBe("rule:missing_target");
  });
});

describe("predictEffects - add_relation", () => {
  it("predicts relation_added for a new pair, defaulting to related_to", () => {
    const [prediction] = predictEffects(STATE, {
      kind: "add_relation",
      targetId: "a",
      toId: "b",
      relationKind: "part_of",
    });

    expect(prediction).toEqual({
      action: "add_relation",
      effect: "relation_added",
      targetId: "a",
      toId: "b",
      relationKind: "part_of",
      delta: 0,
      confidence: WORLD_PREDICT_CONFIDENCE.relation_added,
      note: "rule:add_relation",
    });

    const [defaultKind] = predictEffects(STATE, { kind: "add_relation", targetId: "b", toId: "a" });
    expect(defaultKind.effect).toBe("relation_added");
    expect(defaultKind.relationKind).toBe("related_to");
  });

  it("is idempotent: an existing pair predicts no_state_change", () => {
    const [prediction] = predictEffects(STATE, {
      kind: "add_relation",
      targetId: "a",
      toId: "b",
    });

    expect(prediction.effect).toBe("no_state_change");
    expect(prediction.note).toBe("rule:relation_exists");
  });

  it("handles missing endpoints, self-relations, and invalid kinds without guessing", () => {
    const [missing] = predictEffects(STATE, {
      kind: "add_relation",
      targetId: "ghost",
      toId: "b",
    });
    expect([missing.effect, missing.note]).toEqual(["no_state_change", "rule:endpoint_missing"]);

    const [self] = predictEffects(STATE, { kind: "add_relation", targetId: "a", toId: "a" });
    expect([self.effect, self.note]).toEqual(["no_state_change", "rule:self_relation"]);

    const [badKind] = predictEffects(STATE, {
      kind: "add_relation",
      targetId: "a",
      toId: "b",
      relationKind: "bogus",
    });
    expect([badKind.effect, badKind.note]).toEqual(["unknown", "rule:invalid_kind"]);

    const [noIds] = predictEffects(STATE, { kind: "add_relation" });
    expect([noIds.effect, noIds.note]).toEqual(["unknown", "rule:missing_endpoint"]);
  });
});

describe("predictEffects - vocabulary, safety, determinism", () => {
  it("predicts a single unknown for anything outside the vocabulary", () => {
    for (const action of [
      { kind: "delete_everything" },
      { kind: 42 },
      { kind: "add_entity " },
      {},
    ]) {
      const predictions = predictEffects(STATE, action);
      expect(predictions).toHaveLength(1);
      expect(predictions[0].action).toBe("unknown");
      expect(predictions[0].effect).toBe("unknown");
      expect(predictions[0].note).toBe("rule:unknown_action");
      expect(predictions[0].confidence).toBe(WORLD_PREDICT_CONFIDENCE.unknown);
    }
  });

  it("returns [] when there is no action at all", () => {
    expect(predictEffects(STATE, null)).toEqual([]);
    expect(predictEffects(STATE, "string-action")).toEqual([]);
    expect(predictEffects(STATE, [1, 2])).toEqual([]);
  });

  it("never throws for hostile state or action", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("boom");
        },
      },
    );

    expect(() => predictEffects(hostile, { kind: "add_entity", label: "x" })).not.toThrow();
    expect(() => predictEffects(STATE, hostile)).not.toThrow();
    expect(predictEffects(hostile, hostile)).toEqual([]);
  });

  it("is deterministic: identical inputs yield identical predictions", () => {
    const action = { kind: "update_entity", targetId: "a" };
    expect(predictEffects(STATE, action)).toEqual(predictEffects(STATE, action));
  });
});

describe("proposeWorldUpdates", () => {
  it("confirms known ids with the corroboration step and marks requiresWrite", () => {
    const updates = proposeWorldUpdates(STATE, { confirmedEntityIds: ["a", "b"] });

    expect(updates).toEqual([
      {
        type: "entity_confirmed",
        refId: "a",
        delta: CONFIDENCE_CORROBORATION_STEP,
        note: "rule:entity_confirmed",
        requiresWrite: true,
      },
      {
        type: "entity_confirmed",
        refId: "b",
        delta: CONFIDENCE_CORROBORATION_STEP,
        note: "rule:entity_confirmed",
        requiresWrite: true,
      },
    ]);
    expect(updates[0].delta).toBe(0.05);
  });

  it("contradicts known ids with the correction step", () => {
    const updates = proposeWorldUpdates(STATE, { contradictedEntityIds: ["a"] });

    expect(updates).toEqual([
      {
        type: "entity_contradicted",
        refId: "a",
        delta: -CONFIDENCE_CORRECTION_STEP,
        note: "rule:entity_contradicted",
        requiresWrite: true,
      },
    ]);
    expect(updates[0].delta).toBe(-0.1);
  });

  it("lets contradiction win over confirmation for the same id", () => {
    const updates = proposeWorldUpdates(STATE, {
      confirmedEntityIds: ["a"],
      contradictedEntityIds: ["a"],
    });

    expect(updates).toHaveLength(1);
    expect(updates[0].type).toBe("entity_contradicted");
  });

  it("skips unknown ids and duplicates instead of guessing", () => {
    const updates = proposeWorldUpdates(STATE, {
      confirmedEntityIds: ["ghost", "a", "a", 42, null, ""],
    });

    expect(updates).toEqual([
      expect.objectContaining({ type: "entity_confirmed", refId: "a" }),
    ]);
  });

  it("proposes relation_observed only for new, known, non-self pairs", () => {
    const updates = proposeWorldUpdates(STATE, {
      observedRelations: [
        { fromId: "b", toId: "a", kind: "part_of" },
        { fromId: "a", toId: "b" }, // already believed
        { fromId: "a", toId: "ghost" },
        { fromId: "c", toId: "c" },
        "garbage",
      ],
    });

    expect(updates).toEqual([
      {
        type: "relation_observed",
        fromId: "b",
        toId: "a",
        relationKind: "part_of",
        delta: 0,
        note: "rule:relation_observed",
        requiresWrite: true,
      },
    ]);
  });

  it("keeps a deterministic order: confirmed, then contradicted, then relations", () => {
    const updates = proposeWorldUpdates(STATE, {
      confirmedEntityIds: ["a"],
      contradictedEntityIds: ["b"],
      observedRelations: [{ fromId: "b", toId: "a", kind: "depends_on" }],
    });

    expect(updates.map((update) => update.type)).toEqual([
      "entity_confirmed",
      "entity_contradicted",
      "relation_observed",
    ]);
  });

  it("returns [] for an unusable observation and never throws for hostile input", () => {
    for (const observation of [null, undefined, 42, "seen", ["a"]]) {
      expect(proposeWorldUpdates(STATE, observation)).toEqual([]);
    }

    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("boom");
        },
      },
    );

    expect(() => proposeWorldUpdates(hostile, hostile)).not.toThrow();
    expect(proposeWorldUpdates(hostile, hostile)).toEqual([]);
    expect(() =>
      proposeWorldUpdates(STATE, { confirmedEntityIds: "not-array", observedRelations: 7 }),
    ).not.toThrow();
  });

  it("is deterministic: identical inputs yield identical updates", () => {
    const observation = { confirmedEntityIds: ["a"], contradictedEntityIds: ["b"] };
    expect(proposeWorldUpdates(STATE, observation)).toEqual(
      proposeWorldUpdates(STATE, observation),
    );
  });
});

