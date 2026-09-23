/**
 * Continual-learning applicator (Priority 5, step 2).
 *
 * Turns already-evaluated learning proposals (`LearningUpdate[]`, a
 * `LearningJournal`, or a recorded `LearningOutcome`) into bounded writes
 * through *existing* memory infrastructure only. No new table, no new
 * column, no new RPC, no model call, no tool call.
 *
 * Write-surface mapping (verified against the current tree):
 *
 *   - `memory_usage` -> `touchMemories(userId, ids)` in
 *     `lib/repositories/memory.repository.ts`, wrapping the existing
 *     `touch_memories` RPC (batched `times_used` / `last_used`). Same call
 *     `lib/memory/retrieve.ts` already makes for surfaced memories. SUPPORTED.
 *   - `memory_confidence` -> NO safe delta helper exists. The only writer is
 *     `corroborateMemory`, which owns +0.05 / exactly-once / ceiling semantics
 *     tied to the identity flow's `(memoryId, messageId)` pair; reusing it
 *     here would corrupt those guarantees, and `updateMemoryV2` needs a
 *     current value we never read. DEFERRED as `unsupported_target`.
 *   - `procedural_candidate` -> needs extraction via the Priority 3 path
 *     (`extractAndPersistProcedural`); this module never embeds or saves.
 *     DEFERRED as `unsupported_target`.
 *
 * Safety: flag-gated (ENABLE_CONTINUAL_LEARNING), double opt-in for writes
 * (flag on AND `deps.allowWrites === true`, default false), fully injectable
 * writers (default: none, so the default outcome is a no-op), never throws
 * (throwing writers fold into one `write_failed` skip; the rest still run),
 * bounded (MAX_APPLY_MEMORY_IDS ids, deduped, order preserved).
 *
 * Nothing imports this module in production: the agent loop, the memory
 * pipeline, the job worker and the chat route are all untouched.
 */

import { isFeatureEnabled } from "@/lib/config/features";
import type { FeatureFlag } from "@/lib/config/features";
import type {
  LearningDeferReason,
  LearningUpdate,
  LearningUpdateTarget,
} from "./types";
import { CONTINUAL_LEARNING_FLAG, type LearningFlagReader } from "./index";
import {
  evaluateJournal,
  isLearningJournal,
  isLearningUpdate,
} from "./signals";

/** Upper bound on memory ids touched by one apply call. */
export const MAX_APPLY_MEMORY_IDS = 20;

/**
 * The one writer this step supports. Mirrors
 * `touchMemories(userId, ids)`; the return value is ignored (resolve =
 * success, reject = one `write_failed` skip), so mocks can return void.
 */
export type LearningTouchUsageWriter = (
  userId: string,
  memoryIds: string[],
) => Promise<unknown>;

/** Injectable writers. Every field is optional; the default is no writer. */
export interface LearningApplyWriters {
  /** Defaults to absent: without it, `memory_usage` skips as unavailable. */
  touchUsage?: LearningTouchUsageWriter;
}

/** Injectable dependencies. Every field is optional. */
export interface LearningApplyDeps {
  /** Defaults to isFeatureEnabled() from the feature flags. */
  isFlagEnabled?: LearningFlagReader;
  /**
   * Second opt-in gate for writes. Must be exactly `true` to write;
   * default `false`, so the default outcome is a no-op.
   */
  allowWrites?: boolean;
  /** Defaults to {} (no writers): applicable updates skip as unavailable. */
  writers?: LearningApplyWriters;
}

/** What an apply call reads. `updates` wins over `outcome` wins over `journal`. */
export interface ApplyLearningInput {
  /** Owner of the memories. Carried to the writer, never read or written here. */
  userId: string;
  /**
   * Target memories, e.g. the ids retrieval surfaced this turn. The evaluator
   * never resolves ids, so the caller binds them explicitly. Optional: when
   * absent, `memory_usage` skips as `missing_memory_ids` instead of guessing.
   */
  memoryIds?: unknown;
  /** Already-evaluated proposals. Only entries passing `isLearningUpdate` run. */
  updates?: unknown;
  /** A recorded outcome; its `updates` are used when `updates` is absent. */
  outcome?: unknown;
  /** A journal; evaluated via `evaluateJournal` when neither above is present. */
  journal?: unknown;
}

/** Why an apply call produced no writes at all. Content-free. */
export type LearningApplyDeferReason =
  | Extract<
      LearningDeferReason,
      "learning_disabled" | "invalid_request" | "no_learning_signal"
    >
  | "writes_disabled"
  | "no_updates";

/** Why one proposed update was not applied. Content-free. */
export type LearningSkipReason =
  /** No safe write helper exists for this target yet (see module docstring). */
  | "unsupported_target"
  /** `memory_usage` needs explicit memory ids and none were usable. */
  | "missing_memory_ids"
  /** No writer was injected for this target. */
  | "writer_unavailable"
  /** The injected writer threw or rejected; remaining updates still ran. */
  | "write_failed"
  | "no_memory_ids";

/** One update that reached its writer without the writer throwing. */
export interface LearningAppliedUpdate {
  target: LearningUpdateTarget;
  memoryIds: string[];
  count: number;
  delta: number;
}

/** One update that was not applied, and the content-free reason why. */
export interface LearningSkippedUpdate {
  target: LearningUpdateTarget | "unknown";
  reason: LearningSkipReason;
  /** Short content-free label, e.g. the update's own rule note. */
  note: string;
}

/** Result of one apply call. Never throws; always one of these. */
export type LearningApplyResult =
  | {
      kind: "applied";
      applied: LearningAppliedUpdate[];
      skipped: LearningSkippedUpdate[];
    }
  | {
      kind: "deferred";
      reason: LearningApplyDeferReason;
    };

/** Resolves the flag without ever enabling writes on error. Never throws. */
function isApplyEnabled(deps: LearningApplyDeps): boolean {
  try {
    if (deps.isFlagEnabled) {
      return deps.isFlagEnabled(CONTINUAL_LEARNING_FLAG) === true;
    }
    return isFeatureEnabled(CONTINUAL_LEARNING_FLAG as FeatureFlag) === true;
  } catch {
    return false;
  }
}

/** Reads the owner id defensively; null means the input was unusable. */
function applyUserId(input: ApplyLearningInput): string | null {
  try {
    const userId = (
      input as unknown as Record<string, unknown> | null | undefined
    )?.["userId"];
    if (typeof userId !== "string") return null;
    const trimmed = userId.trim();
    if (trimmed === "" || trimmed.length > 256) return null;
    return trimmed;
  } catch {
    return null;
  }
}

/**
 * Reads usable memory ids defensively: non-empty trimmed strings, deduped,
 * order preserved, capped at MAX_APPLY_MEMORY_IDS. Never throws.
 */
function applyMemoryIds(input: ApplyLearningInput): string[] {
  try {
    const raw = (
      input as unknown as Record<string, unknown> | null | undefined
    )?.["memoryIds"];
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const candidate of raw) {
      if (ids.length >= MAX_APPLY_MEMORY_IDS) break;
      if (typeof candidate !== "string") continue;
      const trimmed = candidate.trim();
      if (trimmed === "" || trimmed.length > 256 || seen.has(trimmed)) continue;
      seen.add(trimmed);
      ids.push(trimmed);
    }
    return ids;
  } catch {
    return [];
  }
}

/** Copies the usable proposals out of an untrusted updates value. Never throws. */
function usableApplyUpdates(value: unknown): LearningUpdate[] {
  try {
    if (!Array.isArray(value)) return [];
    return (value as unknown[])
      .filter((entry) => isLearningUpdate(entry))
      .map((entry) => ({ ...(entry as LearningUpdate) }));
  } catch {
    return [];
  }
}

/** Reads the updates carried by a recorded outcome, if any. Never throws. */
function applyOutcomeUpdates(value: unknown): LearningUpdate[] | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const candidate = value as Record<string, unknown>;
    if (candidate["kind"] !== "recorded") return null;
    const updates = candidate["updates"];
    if (!Array.isArray(updates)) return null;
    return usableApplyUpdates(updates);
  } catch {
    return null;
  }
}

/** Picks proposals: updates wins over outcome wins over journal. Never throws. */
function resolveApplyUpdates(input: ApplyLearningInput): LearningUpdate[] {
  try {
    const rec = input as unknown as Record<string, unknown> | null | undefined;
    const direct = rec?.["updates"];
    if (direct !== undefined) return usableApplyUpdates(direct);
    const viaOutcome = applyOutcomeUpdates(rec?.["outcome"]);
    if (viaOutcome !== null) return viaOutcome;
    const journal = rec?.["journal"];
    if (journal !== undefined) {
      if (!isLearningJournal(journal)) return [];
      try {
        return evaluateJournal(journal);
      } catch {
        return [];
      }
    }
    return [];
  } catch {
    return [];
  }
}

/** True only for known-but-deferred proposal targets. Never throws. */
function isDeferredApplyTarget(v: unknown): boolean {
  try {
    return v === "memory_confidence" || v === "procedural_candidate";
  } catch {
    return false;
  }
}

/** Short label for a skip; falls back to the target. Never throws. */
function skipNote(update: LearningUpdate | null, fallback: string): string {
  try {
    const note = (update as unknown as Record<string, unknown> | null)?.["note"];
    return typeof note === "string" && note !== "" ? note : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Applies one update through injected writers only. Only `memory_usage` has
 * a supported path (injected touchUsage, production shape:
 * touchMemories(userId, ids)). Never throws.
 */
async function applyOneUpdate(
  update: LearningUpdate,
  userId: string,
  memoryIds: string[],
  writers: LearningApplyWriters,
): Promise<
  | { status: "applied"; applied: LearningAppliedUpdate }
  | { status: "skipped"; skipped: LearningSkippedUpdate }
> {
  try {
    if (update.target === "memory_usage") {
      if (memoryIds.length === 0) {
        return {
          status: "skipped",
          skipped: { target: update.target, reason: "no_memory_ids", note: skipNote(update, update.target) },
        };
      }
      const touch = writers.touchUsage;
      if (typeof touch !== "function") {
        return {
          status: "skipped",
          skipped: { target: update.target, reason: "writer_unavailable", note: skipNote(update, update.target) },
        };
      }
      try {
        await touch(userId, [...memoryIds]);
      } catch {
        return {
          status: "skipped",
          skipped: { target: update.target, reason: "write_failed", note: skipNote(update, update.target) },
        };
      }
      return {
        status: "applied",
        applied: { target: update.target, memoryIds: [...memoryIds], count: update.count, delta: update.delta },
      };
    }
    if (isDeferredApplyTarget(update.target)) {
      return {
        status: "skipped",
        skipped: { target: update.target, reason: "unsupported_target", note: skipNote(update, update.target) },
      };
    }
    return {
      status: "skipped",
      skipped: { target: "unknown", reason: "unsupported_target", note: skipNote(update, "unknown") },
    };
  } catch {
    return { status: "skipped", skipped: { target: "unknown", reason: "unsupported_target", note: "unknown" } };
  }
}

/**
 * Applies already-evaluated proposals through existing infrastructure.
 * Gates: learning_disabled -> writes_disabled (allowWrites !== true) ->
 * invalid_request -> no_updates. Never throws.
 */
export async function applyLearningUpdates(
  input: ApplyLearningInput,
  deps: LearningApplyDeps = {},
): Promise<LearningApplyResult> {
  try {
    const safeDeps: LearningApplyDeps = (() => {
      try {
        if (deps === null || typeof deps !== "object" || Array.isArray(deps)) return {};
        return deps;
      } catch {
        return {};
      }
    })();
    if (!isApplyEnabled(safeDeps)) return { kind: "deferred", reason: "learning_disabled" };
    if (safeDeps.allowWrites !== true) return { kind: "deferred", reason: "writes_disabled" };
    const userId = applyUserId(input);
    if (userId === null) return { kind: "deferred", reason: "invalid_request" };
    const updates = resolveApplyUpdates(input);
    if (updates.length === 0) return { kind: "deferred", reason: "no_updates" };
    const memoryIds = applyMemoryIds(input);
    let writers: LearningApplyWriters = {};
    try {
      const raw = safeDeps.writers;
      writers = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    } catch {
      writers = {};
    }
    const applied: LearningAppliedUpdate[] = [];
    const skipped: LearningSkippedUpdate[] = [];
    for (const update of updates) {
      const outcome = await applyOneUpdate(update, userId, memoryIds, writers);
      if (outcome.status === "applied") applied.push(outcome.applied);
      else skipped.push(outcome.skipped);
    }
    return { kind: "applied", applied, skipped };
  } catch {
    return { kind: "deferred", reason: "invalid_request" };
  }
}

/**
 * Applies proposals carried by a recorded outcome. Same gates (flag, then
 * allowWrites). Non-recorded outcome -> no_updates. Never throws.
 */
export async function applyLearningOutcome(
  outcome: unknown,
  input: { userId: unknown; memoryIds?: unknown },
  deps: LearningApplyDeps = {},
): Promise<LearningApplyResult> {
  try {
    const safeDeps: LearningApplyDeps = (() => {
      try {
        if (deps === null || typeof deps !== "object" || Array.isArray(deps)) return {};
        return deps;
      } catch {
        return {};
      }
    })();
    if (!isApplyEnabled(safeDeps)) return { kind: "deferred", reason: "learning_disabled" };
    if (safeDeps.allowWrites !== true) return { kind: "deferred", reason: "writes_disabled" };
    const updates = applyOutcomeUpdates(outcome);
    if (updates === null) {
      const rec = input as unknown as Record<string, unknown> | null | undefined;
      const who = applyUserId({ userId: rec?.["userId"] } as ApplyLearningInput);
      if (who === null) return { kind: "deferred", reason: "invalid_request" };
      return { kind: "deferred", reason: "no_updates" };
    }
    const rec = input as unknown as Record<string, unknown> | null | undefined;
    const shaped: ApplyLearningInput = {
      userId: rec?.["userId"] as string,
      memoryIds: rec?.["memoryIds"] as string[],
      updates,
    };
    return applyLearningUpdates(shaped, safeDeps);
  } catch {
    return { kind: "deferred", reason: "invalid_request" };
  }
}




