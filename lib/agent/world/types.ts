/**
 * Basic world-model foundation types (Priority 6).
 *
 * A world model is a small, structured belief state about the entities the
 * product knows, how they relate, what a candidate action would probably do,
 * and what an observation implies about the state. It is built ONLY from
 * caller-supplied inputs (memory-shaped records, planner rows, candidate
 * actions, observations): this module never reads a database, never calls a
 * provider, and never writes anything.
 *
 * These types are NOT database records. The canonical stored row stays
 * `MemoryRecord` / `MemoryRow` in `lib/memory/types.ts`; a world entity is a
 * bounded projection of existing rows, and this module never names a column
 * or an RPC.
 *
 * Interfaces and type aliases only. The single import is type-only (erased at
 * compile time), so this file adds no runtime dependency. Nothing here is
 * imported by production code: the chat route, the agent loop, the memory
 * pipeline and the job worker are all untouched, and ENABLE_WORLD_MODEL
 * defaults to OFF.
 */

import type { MemoryType } from "@/lib/memory/types";

/**
 * What an entity represents. The eight memory types are reused verbatim so a
 * future writer needs no second mapping; the planner adds its own three.
 */
export type WorldEntityKind =
  | MemoryType
  /** A planner goal row. */
  | "goal"
  /** A planner milestone row. */
  | "milestone"
  /** A planner task row. */
  | "task";

/**
 * Normalized belief status of an entity in the world view.
 * "uncertain" covers fading memories and completed tasks.
 */
export type WorldEntityStatus = "active" | "candidate" | "uncertain";

/**
 * One entity in the snapshot: a bounded projection of a memory row or a
 * planner row. `id` is the source row id (never a synthetic id); `label` is a
 * capped copy of the row title with no other content carried over.
 */
export interface WorldEntity {
  /** Source row id (memory id, goal id, milestone id, task id). */
  id: string;
  /** What the entity represents. */
  kind: WorldEntityKind;
  /** Capped copy of the source title; "" when the source had none. */
  label: string;
  /** Belief status in the world view (normalized from source status). */
  status: WorldEntityStatus;
  /** Confidence in 0..1 (memory confidence, or a fixed default elsewhere). */
  confidence: number;
  /** Importance in 0..1 (memory importance, or a fixed default elsewhere). */
  importance: number;
  /** Which input family produced this entity. */
  source: "memory" | "planner";
}

/** The relation vocabulary the snapshot accepts. */
export type WorldRelationKind =
  | "related_to"
  | "part_of"
  | "depends_on"
  | "contradicts";

/**
 * A typed link between two entities. Only endpoints that exist in the same
 * snapshot are kept, so a relation always points at something the model knows.
 */
export interface WorldRelation {
  /** Source entity id. */
  fromId: string;
  /** Target entity id. */
  toId: string;
  /** Relation kind (validated against the vocabulary). */
  kind: WorldRelationKind;
  /** Belief strength in 0..1. */
  confidence: number;
}

/**
 * The snapshot: everything the model currently believes, bounded and ordered.
 * Built deterministically: identical input always yields an identical state.
 */
export interface WorldState {
  /** Owner the state describes; carried, never read or written. */
  userId: string | null;
  /** Known entities, input order preserved, deduped by id. */
  entities: WorldEntity[];
  /** Known relations, validated, deduped, endpoint-checked. */
  relations: WorldRelation[];
  /** Caller-supplied timestamp (ISO), or null when the caller gave none. */
  asOf: string | null;
}

/** The small, closed vocabulary of candidate actions the predictor knows. */
export type CandidateActionKind =
  /** A new entity would be recorded. */
  | "add_entity"
  /** An existing entity would be reinforced or updated. */
  | "update_entity"
  /** A typed relation would be recorded between two entities. */
  | "add_relation";

/** One candidate action the caller is considering. */
export interface CandidateAction {
  /** Which rule family applies; anything else predicts as "unknown". */
  kind: CandidateActionKind;
  /** Target entity id for update_entity (and the from-end of add_relation). */
  targetId?: string;
  /** To-end of add_relation. */
  toId?: string;
  /** Relation kind for add_relation (defaults to related_to). */
  relationKind?: WorldRelationKind;
  /** Proposed title for add_entity; capped before comparison. */
  label?: string;
  /** Proposed kind for add_entity (defaults to semantic). */
  entityKind?: WorldEntityKind;
}

/** What one prediction says would happen if the action were taken. */
export type WorldEffectKind =
  /** A new entity would enter the world. */
  | "entity_created"
  /** An existing entity's confidence would rise. */
  | "entity_reinforced"
  /** A new relation would enter the world. */
  | "relation_added"
  /** The action would not change the known state. */
  | "no_state_change"
  /** The action was outside the vocabulary; nothing is guessed. */
  | "unknown";

/**
 * One deterministic prediction. `delta` is the signed confidence movement the
 * effect implies for `targetId` (0 when the effect moves no existing
 * confidence); `note` is a content-free rule label.
 */
export interface PredictedEffect {
  /** The action kind this prediction was produced for. */
  action: CandidateActionKind | "unknown";
  /** What would happen. */
  effect: WorldEffectKind;
  /** Entity the effect concerns, when it concerns one. */
  targetId?: string;
  /** Would-be relation's to-end, for relation effects. */
  toId?: string;
  /** Would-be relation's kind, for relation effects. */
  relationKind?: WorldRelationKind;
  /** Signed confidence movement implied, clamped into [-1, 1]. */
  delta: number;
  /** How sure the deterministic rule is, in 0..1. */
  confidence: number;
  /** Short content-free rule label, e.g. "rule:add_entity". */
  note: string;
}

/**
 * An observation the caller made after acting. Only ids and relation shapes
 * are accepted - never text - so the proposer stays content-free.
 */
export interface WorldObservation {
  /** Entity ids the observation confirmed. */
  confirmedEntityIds?: string[];
  /** Entity ids the observation contradicted (wins over confirmed). */
  contradictedEntityIds?: string[];
  /** Relations the observation showed to hold. */
  observedRelations?: Array<{
    fromId: string;
    toId: string;
    kind?: WorldRelationKind;
  }>;
}

/**
 * A proposal produced from an observation. Nothing is written: mirroring
 * `LearningUpdate`, `requiresWrite` is always true and stays true while no
 * write path exists, so a caller can never mistake it for a completed write.
 */
export type WorldUpdate =
  | {
      /** An entity was observed to hold (or not hold). */
      type: "entity_confirmed" | "entity_contradicted";
      /** The entity the update concerns. */
      refId: string;
      /** Signed confidence movement proposed, clamped into [-1, 1]. */
      delta: number;
      /** Short content-free rule label. */
      note: string;
      /** Always true: this is a proposal, not a write. */
      requiresWrite: true;
    }
  | {
      /** A relation was observed to hold. */
      type: "relation_observed";
      /** From-end of the observed relation. */
      fromId: string;
      /** To-end of the observed relation. */
      toId: string;
      /** Observed relation kind. */
      relationKind: WorldRelationKind;
      /** Signed confidence movement proposed (always 0 today). */
      delta: number;
      /** Short content-free rule label. */
      note: string;
      /** Always true: this is a proposal, not a write. */
      requiresWrite: true;
    };

/**
 * Minimal memory-shaped input the snapshot accepts. Every field is optional
 * and defensively read: a missing or malformed field degrades, never throws.
 */
export interface WorldMemoryInput {
  id?: unknown;
  memoryType?: unknown;
  status?: unknown;
  title?: unknown;
  confidence?: unknown;
  importance?: unknown;
}

/** Minimal planner-goal input the snapshot accepts. */
export interface WorldGoalInput {
  id?: unknown;
  title?: unknown;
}

/** Minimal planner-task input the snapshot accepts. */
export interface WorldTaskInput {
  id?: unknown;
  title?: unknown;
  status?: unknown;
}

/** Minimal caller-supplied relation pair the snapshot accepts. */
export interface WorldRelationInput {
  fromId?: unknown;
  toId?: unknown;
  kind?: unknown;
  confidence?: unknown;
}

/** Input for one world-model build. */
export interface WorldRequest {
  /** Owner the state describes. Required, non-blank string. */
  userId: string;
  /** Memory-shaped rows to project into entities. */
  memories?: WorldMemoryInput[];
  /** Planner goals to project into entities. */
  goals?: WorldGoalInput[];
  /** Planner tasks to project into entities. */
  tasks?: WorldTaskInput[];
  /** Caller-supplied relation pairs (validated against built entities). */
  relations?: WorldRelationInput[];
  /** Candidate action to predict, when the caller has one. */
  action?: CandidateAction;
  /** Observation to propose updates from, when the caller has one. */
  observation?: WorldObservation;
  /** Caller timestamp (ISO) for the snapshot, if any. */
  asOf?: string;
}

/** Why a world build produced no snapshot. Content-free. */
export type WorldDeferReason =
  /** ENABLE_WORLD_MODEL is not enabled (or the reader failed). */
  | "world_disabled"
  /** The request was unusable (not an object, or a missing userId). */
  | "invalid_request";

/** Result of one world-model build. Never throws; always one of these. */
export type WorldModelOutcome =
  | {
      kind: "built";
      /** The bounded snapshot built from the request's inputs. */
      state: WorldState;
      /** Predictions for the request's action (empty when none was given). */
      predictions: PredictedEffect[];
      /** Updates proposed from the request's observation (empty when none). */
      updates: WorldUpdate[];
    }
  | {
      kind: "deferred";
      /** Content-free deferral reason. */
      reason: WorldDeferReason;
    };


