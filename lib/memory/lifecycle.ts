/**
 * Sprint 24: Deterministic memory lifecycle evaluation.
 *
 * Uses existing effectiveScoreForType from score.ts (which correctly
 * references importance_v2/confidence_v2 V2 columns).
 */
import { effectiveScoreForType, daysBetween } from "./score";
import {
  PROMOTE_ACTIVE_THRESHOLD,
  PROMOTE_USED_COUNT,
  PROMOTE_CONFIDENCE,
  DEMOTE_FADING_THRESHOLD,
  DEMOTE_HOLD_DAYS,
  ARCHIVE_THRESHOLD,
  ARCHIVE_GRACE_DAYS,
} from "./constants";
import type { MemoryType, MemoryStatus } from "./types";
import {
  getMemoriesForLifecycle,
  batchUpdateLifecycle,
} from "@/lib/repositories/memory.repository";

export interface LifecycleTransition {
  memoryId: string;
  from: string;
  to: string;
  effectiveScore: number;
}

export interface LifecycleResult {
  transitions: LifecycleTransition[];
  evaluated: number;
  errors: Array<{ memoryId: string; error: string }>;
}

export async function evaluateLifecycle(
  userId: string
): Promise<LifecycleResult> {
  const result: LifecycleResult = {
    transitions: [],
    evaluated: 0,
    errors: [],
  };

  const { data: memories, error } = await getMemoriesForLifecycle(userId);
  if (error) {
    result.errors.push({ memoryId: "query", error: error.message });
    return result;
  }

  const safe = memories ?? [];
  result.evaluated = safe.length;
  const now = new Date();
  const updates: Array<{ id: string; status: string; effective_score: number; last_scored: string }> = [];

  for (const m of safe) {
    if (m.status === "archived" || m.status === "deleted" || m.status === "merged") continue;

    const importance = m.importance_v2 ?? 0.5;
    const memoryType = (m.memory_type ?? "semantic") as MemoryType;
    const effective = effectiveScoreForType(importance, m.last_used ?? null, memoryType, now);
    const effectiveScore = Number(effective.toFixed(3));
    const lastScored = m.last_scored ?? now.toISOString();
    const daysSinceScored = daysBetween(new Date(lastScored), now);

    let newStatus: MemoryStatus | null = null;

    // Candidate promotion: effective-score threshold (existing) OR the
    // usage+confidence rule declared by PROMOTE_USED_COUNT / PROMOTE_CONFIDENCE.
    // effective_score is monotonic non-increasing for stored memories (fixed
    // importance + decaying recency), so usage is the signal that lets an
    // existing candidate accumulate enough evidence to go active.
    if (m.status === "candidate") {
      const usedAndConfirmed =
        (m.times_used ?? 0) >= PROMOTE_USED_COUNT &&
        (m.confidence_v2 ?? 0) >= PROMOTE_CONFIDENCE;
      if (effectiveScore >= PROMOTE_ACTIVE_THRESHOLD || usedAndConfirmed) {
        newStatus = "active";
      }
    } else if (m.status === "active") {
      if (effectiveScore < DEMOTE_FADING_THRESHOLD && daysSinceScored >= DEMOTE_HOLD_DAYS) {
        newStatus = "fading";
      }
    } else if (m.status === "fading") {
      if (effectiveScore < ARCHIVE_THRESHOLD && daysSinceScored >= ARCHIVE_GRACE_DAYS) {
        newStatus = "archived";
      }
    }

    if (newStatus && newStatus !== m.status) {
      updates.push({ id: m.id, status: newStatus, effective_score: effectiveScore, last_scored: now.toISOString() });
      result.transitions.push({ memoryId: m.id, from: m.status, to: newStatus, effectiveScore });
    }
  }

  if (updates.length > 0) {
    await batchUpdateLifecycle(updates);
  }

  return result;
}

export async function getLifecycleSummary(userId: string) {
  const { data: memories, error } = await getMemoriesForLifecycle(userId);
  if (error || !memories) return { error: error?.message, memories: 0 };
  const counts: Record<string, number> = {};
  for (const m of memories) {
    counts[m.status ?? "unknown"] = (counts[m.status ?? "unknown"] ?? 0) + 1;
  }
  return { memories: memories.length, byStatus: counts };
}