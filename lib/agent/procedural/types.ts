/**
 * Procedural memory foundation types (Priority 3).
 *
 * Procedural memory records *how the user does things* - skills, strategies
 * and workflows - rather than facts about them. The `procedural` memory type
 * already exists in this codebase (`lib/memory/types.ts`, the `memory_type`
 * database enum, plus weights, half-life, token budget and inject caps in
 * `lib/memory/constants.ts`), but nothing today produces one: the extraction
 * path never emits it and no module reads `ENABLE_PROCEDURAL_MEMORY`.
 *
 * These types describe the structure a future writer would persist. They are
 * NOT the database record: the canonical stored row stays `MemoryRecord` /
 * `MemoryRow` in `lib/memory/types.ts`, and this module only narrows the
 * `procedural` subset into something a structured extractor can fill in.
 *
 * Types and interfaces only. No imports, no runtime code, no side effects.
 * Nothing here is imported by production code: extraction, the job worker and
 * the chat route are untouched, and the writer arrives in a later, separately
 * reviewed step.
 */

/** Which flavour of procedural knowledge this is. */
export type ProceduralKind =
  /** A capability: "I can do X" - how to perform something once mastered. */
  | "skill"
  /** A decision policy: "when X, I do Y" - reasoning about what to choose. */
  | "strategy"
  /** An ordered sequence: "first X, then Y" - a repeatable process. */
  | "workflow";

/** One ordered step of a workflow, strategy or skill. */
export interface ProceduralStep {
  /** Stable identifier assigned at extraction time (never a database id). */
  id: string;
  /** 1-based position, matching array order. */
  order: number;
  /** The action to take, as a short imperative phrase. */
  action: string;
}

/**
 * A procedural memory candidate, before it is written as a memory row.
 *
 * `memoryType` is fixed to the existing `procedural` literal so a future
 * writer can hand this straight to the existing write path without a second
 * mapping step.
 */
export interface ProceduralMemory {
  /** Always "procedural". Kept explicit so writers need no casting. */
  memoryType: "procedural";
  kind: ProceduralKind;
  /** Short human-readable name, e.g. "Release checklist". */
  name: string;
  /** When this procedure applies, in the user's terms. May be empty. */
  trigger: string;
  /** Ordered steps; never empty for an extracted memory. */
  steps: ProceduralStep[];
  /** Conditions that must hold before the procedure is usable. */
  preconditions: string[];
  /** What success looks like. May be empty when the user did not say. */
  outcome: string;
  /** Extraction confidence in 0..1. */
  confidence: number;
}

/** Input for one procedural extraction request. */
export interface ProceduralRequest {
  /** Owner of the future memory. Carried, never read or written. */
  userId: string;
  /** The user message to extract from. */
  message: string;
}

/** Why extraction produced no procedural memory. Content-free. */
export type ProceduralDeferReason =
  /** ENABLE_PROCEDURAL_MEMORY is not enabled. */
  | "procedural_disabled"
  /** The message does not describe a procedure; other paths own it. */
  | "not_procedural"
  /** The request was unusable (missing/oversized message). */
  | "invalid_request";

/** Result of one extraction request. Never throws; always one of these. */
export type ProceduralOutcome =
  | {
      kind: "extracted";
      memory: ProceduralMemory;
    }
  | {
      kind: "deferred";
      reason: ProceduralDeferReason;
    };
