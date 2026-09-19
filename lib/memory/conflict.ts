import { createClient } from "@/lib/supabase/server";

/**
 * Phase 2-C2: persist a cross-title contradiction flag.
 *
 * Writes a memory_edges row (relation = 'contradicts') between two active
 * identity memories that the detector judged contradictory. This is the ONLY
 * write path in the conflict-detection feature; it lives outside identity.ts so
 * that module retains its read-only (decision-layer) safety contract.
 *
 * Fail-safe: any error is caught and logged, never thrown. A flag-write failure
 * must never break identity resolution or corroboration.
 */
export async function flagContradiction(
  userId: string,
  sourceId: string,
  targetId: string
): Promise<void> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("memory_edges").insert({
      user_id: userId,
      source_id: sourceId,
      target_id: targetId,
      relation: "contradicts",
    });
    if (error) {
      console.error("CROSS-TITLE FLAG WRITE FAILED", error);
    }
  } catch (e) {
    console.error("CROSS-TITLE FLAG ERROR", e);
  }
}

/**
 * Phase 2-C3: controlled contradiction reconciliation inside evaluateLifecycle.
 *
 * Reads contradiction edges from memory_edges, loads the two referenced memories,
 * evaluates the four safety gate conditions, and only supersedes the loser when
 * every condition passes. Preserves fail-safe behavior; never throws in a way
 * that breaks lifecycle processing.
 */
export async function reconcileContradictions(userId: string): Promise<void> {
  try {
    const supabase = await createClient();

    // Read all contradicts edges for this user
    const { data: edges, error } = await supabase
      .from("memory_edges")
      .select("source_id, target_id")
      .eq("user_id", userId)
      .eq("relation", "contradicts");

    if (error) {
      console.error("CROSS-TITLE RECONCILIATION READ FAILED", error);
      return;
    }

    if (!edges || edges.length === 0) {
      return;
    }

    // Load the two memories referenced by each edge
    const memoryIds = [...new Set([...edges.map((e) => e.source_id), ...edges.map((e) => e.target_id)])];

    const { data: memories, error: memError } = await supabase
      .from("memories")
      .select("id, memory_type, status, effective_score, times_used, created_at, metadata")
      .in("id", memoryIds);

    if (memError) {
      console.error("CROSS-TITLE RECONCILIATION MEMORY READ FAILED", memError);
      return;
    }

    if (!memories || memories.length === 0) {
      return;
    }

    // Index memories by ID for quick lookup
    const memoryMap: Record<string, typeof memories[0]> = {};
    for (const m of memories) {
      memoryMap[m.id] = m;
    }

    // Process each contradicts edge
    for (const edge of edges) {
      const source = memoryMap[edge.source_id];
      const target = memoryMap[edge.target_id];

      if (!source || !target) {
        continue;
      }

      // Both must be ACTIVE for the gate to apply
      if (source.status !== "active" || target.status !== "active") {
        continue;
      }

      // Determine winner and loser by created_at (older = loser, newer = winner)
      const older = source.created_at < target.created_at ? source : target;
      const newer = source.created_at < target.created_at ? target : source;
      const loser = older;
      const winner = newer;

      // Safety gate: all four conditions must pass
      // 1. Both are active (checked above)
      // 2. loser.created_at < winner.created_at (already guaranteed by assignment)
      // 3. loser.effective_score < winner.effective_score
      // 4. winner.times_used > loser.times_used

      if (
        loser.effective_score < winner.effective_score &&
        winner.times_used > loser.times_used
      ) {
        // All safety conditions pass — supersede the loser
        try {
          await supabase
            .from("memories")
            .update({
              status: "merged",
              metadata: {
                ...(metadataSupersededBy(loser.id, winner.id)),
                supersession_reason: "identity_update",
              },
            })
            .eq("id", loser.id);
        } catch (updateError) {
          console.error("CROSS-TITLE SUPERSEDE FAILED", loser.id, updateError);
        }
      }
      // If gate fails: leave the contradiction edge intact, no destructive action
    }
  } catch (e) {
    console.error("CROSS-TITLE RECONCILIATION ERROR", e);
  }
}

/** Build the metadata object: metadata.superseded_by = winner ID. */
function metadataSupersededBy(loserId: string, winnerId: string): Record<string, unknown> {
  return { superseded_by: winnerId };
}
