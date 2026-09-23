/**
 * World-model update proposer (Priority 6).
 *
 * Single responsibility: turn an observation (ids and relation shapes only -
 * never text) into bounded `WorldUpdate` proposals against a snapshot.
 * Pure and deterministic: no flag, no clock, no randomness, no database, no
 * provider. Nothing is written: every proposal carries `requiresWrite: true`
 * so a caller can never mistake it for a completed write, mirroring
 * `LearningUpdate` from the continual-learning foundation.
 *
 * Rules (each unit tested):
 *  - confirmed ids that exist in the state -> entity_confirmed with delta
 *    +CONFIDENCE_CORROBORATION_STEP (reused from lib/memory/constants.ts).
 *  - contradicted ids that exist -> entity_contradicted with delta
 *    -CONFIDENCE_CORRECTION_STEP. Contradiction wins: an id observed as both
 *    confirmed and contradicted yields only the contradiction.
 *  - observed relations whose endpoints both exist, from != to, and which are
 *    not already in the state -> relation_observed (delta 0).
 *  - unknown ids, malformed entries, duplicates, and self-relations are
 *    skipped, never guessed. Output is capped at MAX_WORLD_UPDATES.
 *    Order is deterministic: confirmed, then contradicted, then relations,
 *    each in input order. Never throws.
 */

import {
  CONFIDENCE_CORRECTION_STEP,
  CONFIDENCE_CORROBORATION_STEP,
} from "@/lib/memory/constants";
import {
  MAX_WORLD_UPDATES,
  clampWorldDelta,
  isWorldRelationKind,
  safeWorldId,
} from "./constants";
import type { WorldUpdate } from "./types";

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

/** A usable, deduped id list from an untrusted field, capped. Never throws. */
function idList(value: unknown, cap: number): string[] {
  const ids: string[] = [];
  try {
    if (!Array.isArray(value)) return ids;
    const seen = new Set<string>();
    for (const raw of value) {
      if (ids.length >= cap) break;
      const id = safeWorldId(raw);
      if (id === null || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  } catch {
    // return what was collected
  }
  return ids;
}

/** Known entity ids from a snapshot. Never throws. */
function entityIds(state: unknown): Set<string> {
  const ids = new Set<string>();
  try {
    const source = rec(state);
    const rawEntities = source?.["entities"];
    if (!Array.isArray(rawEntities)) return ids;
    for (const raw of rawEntities) {
      const entity = rec(raw);
      if (entity === null) continue;
      const id = safeWorldId(entity["id"]);
      if (id !== null) ids.add(id);
    }
  } catch {
    // return what was collected
  }
  return ids;
}

/** Known relation keys (from|to|kind) from a snapshot. Never throws. */
function existingRelationKeys(state: unknown): Set<string> {
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
    // return what was collected
  }
  return keys;
}

/**
 * Proposes bounded world updates from one observation against a snapshot.
 * Pure, deterministic, content-free, never throws for any input: an unusable
 * observation yields [] and nothing outside the known state is ever proposed.
 */
export function proposeWorldUpdates(state: unknown, observation: unknown): WorldUpdate[] {
  try {
    const source = rec(observation);
    if (source === null) return [];

    const known = entityIds(state);
    const updates: WorldUpdate[] = [];
    const seenKeys = new Set<string>();

    const add = (update: WorldUpdate | null, key: string): void => {
      if (update === null) return;
      if (updates.length >= MAX_WORLD_UPDATES) return;
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      updates.push(update);
    };

    const confirmed = idList(source["confirmedEntityIds"], MAX_WORLD_UPDATES);
    const contradicted = idList(source["contradictedEntityIds"], MAX_WORLD_UPDATES);
    const contradictedSet = new Set(contradicted);

    for (const id of confirmed) {
      if (contradictedSet.has(id)) continue; // contradiction wins
      if (!known.has(id)) continue;
      add(
        {
          type: "entity_confirmed",
          refId: id,
          delta: clampWorldDelta(CONFIDENCE_CORROBORATION_STEP, 1),
          note: "rule:entity_confirmed",
          requiresWrite: true,
        },
        "confirm|" + id,
      );
    }

    for (const id of contradicted) {
      if (!known.has(id)) continue;
      add(
        {
          type: "entity_contradicted",
          refId: id,
          delta: clampWorldDelta(-CONFIDENCE_CORRECTION_STEP, 1),
          note: "rule:entity_contradicted",
          requiresWrite: true,
        },
        "contradict|" + id,
      );
    }

    const rawRelations = source["observedRelations"];
    if (Array.isArray(rawRelations)) {
      const present = existingRelationKeys(state);
      for (const raw of rawRelations) {
        if (updates.length >= MAX_WORLD_UPDATES) break;
        const pair = rec(raw);
        if (pair === null) continue;
        const fromId = safeWorldId(pair["fromId"]);
        const toId = safeWorldId(pair["toId"]);
        if (fromId === null || toId === null) continue;
        if (fromId === toId) continue;
        if (!known.has(fromId) || !known.has(toId)) continue;
        const kind = isWorldRelationKind(pair["kind"]) ? pair["kind"] : "related_to";
        const key = fromId + "|" + toId + "|" + kind;
        if (present.has(key)) continue; // already believed; nothing to update
        add(
          {
            type: "relation_observed",
            fromId,
            toId,
            relationKind: kind,
            delta: 0,
            note: "rule:relation_observed",
            requiresWrite: true,
          },
          "relation|" + key,
        );
      }
    }

    return updates;
  } catch {
    return [];
  }
}

