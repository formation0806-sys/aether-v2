/**
 * World-model effect predictor (Priority 6).
 *
 * Single responsibility: given a snapshot and one candidate action, say what
 * the closed rule set predicts would happen. Pure and deterministic: no flag,
 * no clock, no randomness, no database, no provider. One action yields at most
 * one prediction, and anything outside the vocabulary predicts "unknown"
 * rather than guessing.
 *
 * Rules (each unit tested):
 *  - add_entity with a non-empty label matching a known entity's label
 *    (trimmed, case-insensitive) -> entity_reinforced on the match, moving
 *    confidence by CONFIDENCE_CORROBORATION_STEP (reused, not invented);
 *    otherwise -> entity_created (delta 0: a new entity moves no existing
 *    confidence). A missing label -> unknown.
 *  - update_entity on a known id -> entity_reinforced (+corroboration step);
 *    on an unknown id -> no_state_change (the known world would not move);
 *    missing id -> unknown.
 *  - add_relation with both endpoints known and the pair absent ->
 *    relation_added; pair already present -> no_state_change (idempotent);
 *    endpoint not in the state or a self-relation -> no_state_change;
 *    missing endpoints or invalid kind -> unknown.
 *  - any other action shape -> unknown. Never throws.
 */

import { CONFIDENCE_CORROBORATION_STEP } from "@/lib/memory/constants";
import {
  WORLD_PREDICT_CONFIDENCE,
  isWorldRelationKind,
  safeWorldId,
  safeWorldLabel,
} from "./constants";
import type {
  CandidateActionKind,
  PredictedEffect,
  WorldEffectKind,
  WorldRelationKind,
} from "./types";

const ACTION_KINDS: readonly string[] = ["add_entity", "update_entity", "add_relation"];

/** Reads a defensive object view; null for anything that is not an object. */
function rec(value: unknown): Record<string, unknown> | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Effect view used internally; every field is content-free. */
function effect(
  over: {
    action: CandidateActionKind | "unknown";
    effect: WorldEffectKind;
    note: string;
    targetId?: string;
    toId?: string;
    relationKind?: WorldRelationKind;
    delta?: number;
  },
): PredictedEffect {
  const built: PredictedEffect = {
    action: over.action,
    effect: over.effect,
    delta: over.delta ?? 0,
    confidence: WORLD_PREDICT_CONFIDENCE[over.effect],
    note: over.note,
  };
  if (over.targetId !== undefined) built.targetId = over.targetId;
  if (over.toId !== undefined) built.toId = over.toId;
  if (over.relationKind !== undefined) built.relationKind = over.relationKind;
  return built;
}

/** Known entity ids and lowercased labels from a snapshot. Never throws. */
function entityViews(state: unknown): { ids: Set<string>; labels: Map<string, string> } {
  const ids = new Set<string>();
  const labels = new Map<string, string>();
  try {
    const source = rec(state);
    const rawEntities = source?.["entities"];
    if (!Array.isArray(rawEntities)) return { ids, labels };
    for (const raw of rawEntities) {
      const entity = rec(raw);
      if (entity === null) continue;
      const id = safeWorldId(entity["id"]);
      if (id === null) continue;
      ids.add(id);
      const label = safeWorldLabel(entity["label"]);
      if (label !== "" && !labels.has(label.toLowerCase())) {
        labels.set(label.toLowerCase(), id);
      }
    }
  } catch {
    // fall through with what was collected
  }
  return { ids, labels };
}

/** Known relation keys (from|to|kind) from a snapshot. Never throws. */
function relationKeys(state: unknown): Set<string> {
  const keys = new Set<string>();
  try {
    const source = rec(state);
    const rawRelations = source?.["relations"];
    if (!Array.isArray(rawRelations)) return keys;
    for (const raw of rawRelations) {
      const relation = rec(raw);
      if (relation === null) continue;
      const fromId = safeWorldId(relation["fromId"]);
      const toId = safeWorldId(relation["toId"]);
      if (fromId === null || toId === null) continue;
      const kind = isWorldRelationKind(relation["kind"]) ? relation["kind"] : "related_to";
      keys.add(fromId + "|" + toId + "|" + kind);
    }
  } catch {
    // fall through with what was collected
  }
  return keys;
}

/**
 * Predicts the effect of one candidate action against a snapshot. Pure,
 * deterministic, at most one prediction per action, never throws for any
 * input: an unusable action yields [] and anything outside the vocabulary
 * yields a single "unknown" prediction rather than a guess.
 */
export function predictEffects(state: unknown, action: unknown): PredictedEffect[] {
  try {
    const candidate = rec(action);
    if (candidate === null) return [];

    const rawKind = candidate["kind"];
    const kind = typeof rawKind === "string" && ACTION_KINDS.includes(rawKind)
      ? (rawKind as CandidateActionKind)
      : null;

    if (kind === null) {
      return [effect({ action: "unknown", effect: "unknown", note: "rule:unknown_action" })];
    }

    const { ids, labels } = entityViews(state);

    if (kind === "add_entity") {
      const label = safeWorldLabel(candidate["label"]);
      if (label === "") {
        return [effect({ action: kind, effect: "unknown", note: "rule:missing_label" })];
      }
      const match = labels.get(label.toLowerCase());
      if (match !== undefined) {
        return [
          effect({
            action: kind,
            effect: "entity_reinforced",
            note: "rule:label_match",
            targetId: match,
            delta: CONFIDENCE_CORROBORATION_STEP,
          }),
        ];
      }
      return [effect({ action: kind, effect: "entity_created", note: "rule:add_entity" })];
    }

    if (kind === "update_entity") {
      const targetId = safeWorldId(candidate["targetId"]);
      if (targetId === null) {
        return [effect({ action: kind, effect: "unknown", note: "rule:missing_target" })];
      }
      if (!ids.has(targetId)) {
        return [
          effect({
            action: kind,
            effect: "no_state_change",
            note: "rule:target_unknown",
            targetId,
          }),
        ];
      }
      return [
        effect({
          action: kind,
          effect: "entity_reinforced",
          note: "rule:update_entity",
          targetId,
          delta: CONFIDENCE_CORROBORATION_STEP,
        }),
      ];
    }

    // kind === "add_relation"
    const fromId = safeWorldId(candidate["targetId"]);
    const toId = safeWorldId(candidate["toId"]);
    if (fromId === null || toId === null) {
      return [effect({ action: kind, effect: "unknown", note: "rule:missing_endpoint" })];
    }
    const rawRelationKind = candidate["relationKind"];
    if (rawRelationKind !== undefined && !isWorldRelationKind(rawRelationKind)) {
      return [effect({ action: kind, effect: "unknown", note: "rule:invalid_kind" })];
    }
    const relationKind: WorldRelationKind = isWorldRelationKind(rawRelationKind)
      ? rawRelationKind
      : "related_to";

    if (fromId === toId) {
      return [
        effect({
          action: kind,
          effect: "no_state_change",
          note: "rule:self_relation",
          targetId: fromId,
          toId,
          relationKind,
        }),
      ];
    }
    if (!ids.has(fromId) || !ids.has(toId)) {
      return [
        effect({
          action: kind,
          effect: "no_state_change",
          note: "rule:endpoint_missing",
          targetId: fromId,
          toId,
          relationKind,
        }),
      ];
    }
    if (relationKeys(state).has(fromId + "|" + toId + "|" + relationKind)) {
      return [
        effect({
          action: kind,
          effect: "no_state_change",
          note: "rule:relation_exists",
          targetId: fromId,
          toId,
          relationKind,
        }),
      ];
    }
    return [
      effect({
        action: kind,
        effect: "relation_added",
        note: "rule:add_relation",
        targetId: fromId,
        toId,
        relationKind,
      }),
    ];
  } catch {
    return [];
  }
}

