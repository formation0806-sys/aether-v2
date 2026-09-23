/**
 * World-model bounds, vocabulary, and tiny pure helpers (Priority 6).
 *
 * All caps are local to this module: the world model is a bounded projection,
 * so every list it touches has a hard ceiling. Helpers are defensive and never
 * throw - a malformed value degrades to null or a fallback rather than
 * propagating. No imports: pure constants and functions only.
 */

import type { WorldRelationKind } from "./types";

/** Hard cap on entities in one snapshot. */
export const MAX_WORLD_ENTITIES = 50;

/** Hard cap on relations in one snapshot. */
export const MAX_WORLD_RELATIONS = 100;

/** Upper bound on a label copied into an entity or compared by the predictor. */
export const MAX_WORLD_LABEL_CHARS = 80;

/** Upper bound on ids accepted from any input. */
export const MAX_WORLD_ID_CHARS = 256;

/** Hard cap on updates proposed from one observation. */
export const MAX_WORLD_UPDATES = 50;

/** Upper bound on the caller-supplied asOf timestamp string. */
export const MAX_WORLD_ASOF_CHARS = 64;

/**
 * How sure each deterministic prediction rule is, in 0..1. Structural facts
 * about a known state are near-certain; a missing target is never guessed.
 */
export const WORLD_PREDICT_CONFIDENCE: Readonly<
  Record<"entity_created" | "entity_reinforced" | "relation_added" | "no_state_change" | "unknown", number>
> = Object.freeze({
  entity_created: 0.7,
  entity_reinforced: 0.8,
  relation_added: 0.8,
  no_state_change: 0.9,
  unknown: 0.1,
});

/** Every relation kind this foundation accepts, in canonical order. */
export const WORLD_RELATION_KINDS: readonly WorldRelationKind[] = Object.freeze([
  "related_to",
  "part_of",
  "depends_on",
  "contradicts",
] as const);

/** True only for the declared relation kinds. Never throws. */
export function isWorldRelationKind(value: unknown): value is WorldRelationKind {
  try {
    return WORLD_RELATION_KINDS.some((kind) => kind === value);
  } catch {
    return false;
  }
}

/** Trims and caps an id, or returns null when it is unusable. Never throws. */
export function safeWorldId(value: unknown): string | null {
  try {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (trimmed === "" || trimmed.length > MAX_WORLD_ID_CHARS) return null;
    return trimmed;
  } catch {
    return null;
  }
}

/** Trims and caps a label; non-strings become "". Never throws. */
export function safeWorldLabel(value: unknown): string {
  try {
    if (typeof value !== "string") return "";
    return value.trim().slice(0, MAX_WORLD_LABEL_CHARS);
  } catch {
    return "";
  }
}

/** Clamps a finite number into [0, 1], or returns the fallback. Never throws. */
export function safeUnit01(value: unknown, fallback: number): number {
  try {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
    return Math.min(1, Math.max(0, value));
  } catch {
    return fallback;
  }
}

/** Signed clamp with NaN safety. */
export function clampWorldDelta(value: number, bound: number): number {
  try {
    if (Number.isNaN(value)) return 0;
    return Math.min(bound, Math.max(-bound, value));
  } catch {
    return 0;
  }
}
