/**
 * World-state snapshot builder (Priority 6).
 *
 * Single responsibility: project caller-supplied, memory-shaped rows and
 * planner rows into a bounded `WorldState`. Pure and deterministic: identical
 * input yields an identical snapshot; no clock, no randomness, no flags, no
 * database, no provider. Nothing is written and nothing here reads anything -
 * the caller hands in the rows it already has.
 *
 * Projection rules (each unit tested):
 *  - memories: status active -> active, candidate -> candidate, fading ->
 *    uncertain; archived/deleted/merged are excluded from the world; a missing
 *    status defaults to candidate (the write path's own default); an unknown
 *    non-empty status is excluded. An unrecognized memoryType falls back to
 *    semantic, matching the scorer's safe fallback.
 *  - goals -> kind "goal" (active); tasks -> kind "task" (done -> uncertain,
 *    anything else -> active).
 *  - entities are deduped by id, first occurrence wins, capped at
 *    MAX_WORLD_ENTITIES, input order preserved.
 *  - relations: caller-supplied pairs only, validated against the built
 *    entity set (both endpoints must exist, from != to), kind defaults to
 *    related_to, deduped by from|to|kind, capped at MAX_WORLD_RELATIONS.
 */

import { DEFAULT_CONFIDENCE } from "@/lib/memory/constants";
import { MEMORY_TYPES } from "@/lib/memory/types";
import {
  MAX_WORLD_ASOF_CHARS,
  MAX_WORLD_ENTITIES,
  MAX_WORLD_RELATIONS,
  isWorldRelationKind,
  safeUnit01,
  safeWorldId,
  safeWorldLabel,
} from "./constants";
import type {
  WorldEntity,
  WorldEntityStatus,
  WorldEntityKind,
  WorldRelation,
  WorldState,
} from "./types";

/** Memory statuses eligible for the world view, mapped to world status. */
const MEMORY_STATUS_MAP: Readonly<Record<string, WorldEntityStatus>> =
  Object.freeze({
    active: "active",
    candidate: "candidate",
    fading: "uncertain",
  });

/** Default world status when a memory-shaped input omits its status. */
const MISSING_MEMORY_STATUS: WorldEntityStatus = "candidate";

/** True only for the eight declared memory types. Never throws. */
function isMemoryType(value: unknown): value is WorldEntityKind {
  try {
    return MEMORY_TYPES.some((kind) => kind === value);
  } catch {
    return false;
  }
}

/** Default importance for non-memory entities (matches the write path's 0.5). */
const DEFAULT_IMPORTANCE = 0.5;

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

/** Copies an array field defensively; anything else becomes []. Never throws. */
function listField(source: Record<string, unknown> | null, key: string): unknown[] {
  try {
    const value = source?.[key];
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

/** The empty snapshot, returned for an unusable request. Never throws. */
function emptyState(): WorldState {
  return { userId: null, entities: [], relations: [], asOf: null };
}

/**
 * Builds the bounded world snapshot from caller-supplied inputs. Pure and
 * deterministic; never throws for any input (a hostile request degrades to
 * the empty snapshot). No flag is read here: gating belongs to the entry
 * point in ./index, exactly like the sibling foundations.
 */
export function buildWorldState(request: unknown): WorldState {
  try {
    const source = rec(request);
    if (source === null) return emptyState();

    const userId = safeWorldId(source["userId"]);

    const entities: WorldEntity[] = [];
    const seen = new Set<string>();

    const push = (entity: WorldEntity | null): void => {
      if (entity === null) return;
      if (seen.has(entity.id)) return;
      if (entities.length >= MAX_WORLD_ENTITIES) return;
      seen.add(entity.id);
      entities.push(entity);
    };

    for (const raw of listField(source, "memories")) {
      const memory = rec(raw);
      if (memory === null) continue;
      const id = safeWorldId(memory["id"]);
      if (id === null) continue;

      const rawStatus = memory["status"];
      let status: WorldEntityStatus;
      if (typeof rawStatus !== "string") {
        status = MISSING_MEMORY_STATUS;
      } else {
        const mapped = MEMORY_STATUS_MAP[rawStatus];
        if (mapped === undefined) continue; // archived/deleted/merged/unknown
        status = mapped;
      }

      push({
        id,
        kind: isMemoryType(memory["memoryType"]) ? memory["memoryType"] : "semantic",
        label: safeWorldLabel(memory["title"]),
        status,
        confidence: safeUnit01(memory["confidence"], DEFAULT_CONFIDENCE),
        importance: safeUnit01(memory["importance"], DEFAULT_IMPORTANCE),
        source: "memory",
      });
    }

    for (const raw of listField(source, "goals")) {
      const goal = rec(raw);
      if (goal === null) continue;
      const id = safeWorldId(goal["id"]);
      if (id === null) continue;
      push({
        id,
        kind: "goal",
        label: safeWorldLabel(goal["title"]),
        status: "active",
        confidence: DEFAULT_CONFIDENCE,
        importance: DEFAULT_IMPORTANCE,
        source: "planner",
      });
    }

    for (const raw of listField(source, "tasks")) {
      const task = rec(raw);
      if (task === null) continue;
      const id = safeWorldId(task["id"]);
      if (id === null) continue;
      const done = typeof task["status"] === "string" && task["status"] === "done";
      push({
        id,
        kind: "task",
        label: safeWorldLabel(task["title"]),
        status: done ? "uncertain" : "active",
        confidence: DEFAULT_CONFIDENCE,
        importance: DEFAULT_IMPORTANCE,
        source: "planner",
      });
    }

    const relations: WorldRelation[] = [];
    const relationKeys = new Set<string>();
    const entityIds = seen;

    for (const raw of listField(source, "relations")) {
      if (relations.length >= MAX_WORLD_RELATIONS) break;
      const pair = rec(raw);
      if (pair === null) continue;
      const fromId = safeWorldId(pair["fromId"]);
      const toId = safeWorldId(pair["toId"]);
      if (fromId === null || toId === null) continue;
      if (fromId === toId) continue;
      if (!entityIds.has(fromId) || !entityIds.has(toId)) continue;
      const kind = isWorldRelationKind(pair["kind"]) ? pair["kind"] : "related_to";
      const key = fromId + "|" + toId + "|" + kind;
      if (relationKeys.has(key)) continue;
      relationKeys.add(key);
      relations.push({
        fromId,
        toId,
        kind,
        confidence: safeUnit01(pair["confidence"], DEFAULT_CONFIDENCE),
      });
    }

    const rawAsOf = source["asOf"];
    const asOf =
      typeof rawAsOf === "string" && rawAsOf.trim() !== "" && rawAsOf.length <= MAX_WORLD_ASOF_CHARS
        ? rawAsOf.trim()
        : null;

    return { userId, entities, relations, asOf };
  } catch {
    return emptyState();
  }
}

