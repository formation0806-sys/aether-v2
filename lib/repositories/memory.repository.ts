import { createClient } from "@/lib/supabase/server";
import {
  RETRIEVAL_TOP_K,
  MIN_SIMILARITY,
} from "@/lib/memory/constants";
import type {
  MemoryType,
  MemoryStatus,
  MemorySource,
} from "@/lib/memory/types";

export async function findMemoryByTitle(userId: string, title: string) {
  const supabase = await createClient();
  return supabase
    .from("memories")
    .select("id,content")
    .eq("user_id", userId)
    .eq("title", title)
    .limit(1);
}

export async function getMemoryByTitle(userId: string, title: string) {
  const supabase = await createClient();
  return supabase
    .from("memories")
    .select("id,content")
    .eq("user_id", userId)
    .eq("title", title)
    .maybeSingle();
}

export async function insertMemory(data: {
  user_id: string;
  title: string;
  content: string;
  role: string;
  embedding: number[];
}) {
  const supabase = await createClient();
  return supabase.from("memories").insert(data);
}

export async function updateMemoryById(
  id: string,
  updates: {
    content: string;
    embedding: number[];
  }
) {
  const supabase = await createClient();
  return supabase.from("memories").update(updates).eq("id", id);
}

export async function matchMemories(
  queryEmbedding: number[],
  userId: string,
  matchCount: number
) {
  console.log("======== MATCH MEMORIES ========");
  console.log("Embedding length:", queryEmbedding.length);
  console.log("First 5 numbers:", queryEmbedding.slice(0, 5));
  console.log("User ID:", userId);
  console.log("Match Count:", matchCount);

  const supabase = await createClient();

  const result = await supabase.rpc("match_memories", {
    query_embedding: queryEmbedding,
    match_user: userId,
    match_count: matchCount,
  });

  console.log("RPC RESULT:");
  console.log(result);

  return result;
}

export async function incrementMemoryUsage(
  id: string,
  timesUsed: number,
  lastUsed: string
) {
  const supabase = await createClient();
  return supabase
    .from("memories")
    .update({
      times_used: timesUsed,
      last_used: lastUsed,
    })
    .eq("id", id);
}

/* ========================================================================== */
/* Memory V2 data-access (additive)                                            */
/* These methods wire the repository to the V2 schema/RPCs already present in   */
/* supabase/migrations 0001-0004. All legacy methods above are preserved        */
/* unchanged; existing callers (retrieve.ts / upsertMemory.ts / memory.ts)    */
/* keep working unchanged. V2 callers are migrated in a follow-up milestone.    */
/* ========================================================================== */

/** Options for `matchMemoriesV2`. Omitted values fall back to DB defaults. */
export interface MatchMemoriesV2Options {
  /** Max candidates returned. Defaults to RETRIEVAL_TOP_K (30). */
  matchCount?: number;
  /** Cosine-similarity floor. Defaults to MIN_SIMILARITY (0.65). */
  minSimilarity?: number;
  /** null => no type filter; otherwise restrict to these memory types. */
  types?: MemoryType[] | null;
  /** null => no status filter; defaults to ['active']. */
  statuses?: MemoryStatus[] | null;
  /** null => no project filter. */
  projectId?: string | null;
}

/**
 * V2 retrieval via the `match_memories_v2` RPC (migrations 0004).
 * Returns: id, title, content, summary, tags, memory_type, importance,
 * confidence, similarity, effective_score, times_used, last_used.
 */
export async function matchMemoriesV2(
  queryEmbedding: number[],
  userId: string,
  options: MatchMemoriesV2Options = {}
) {
  const supabase = await createClient();

  return supabase.rpc("match_memories_v2", {
    p_user_id: userId,
    p_query_embedding: queryEmbedding,
    p_match_threshold: options.minSimilarity ?? MIN_SIMILARITY,
    p_match_count: options.matchCount ?? RETRIEVAL_TOP_K,
  });
}

/** Batch-increment `times_used` and set `last_used` via the `touch_memories` V2 RPC. */
export async function touchMemories(userId: string, ids: string[]) {
  const supabase = await createClient();
  return supabase.rpc("touch_memories", {
    p_user_id: userId,
    p_ids: ids,
  });
}

/** V2 insert input. Omitted V2 fields fall back to DB defaults
 *  (semantic / candidate / 0.5 importance & confidence / 'extractor' source). */
export interface InsertMemoryV2Input {
  user_id: string;
  title: string;
  content: string;
  embedding?: number[] | null;

  memory_type?: MemoryType;
  status?: MemoryStatus;

  summary?: string;
  tags?: string[];

  importance_v2?: number;
  confidence_v2?: number;
  source_v2?: MemorySource;

  source_ref?: string | null;
  project_id?: string | null;

  /** Originating user `messages.id` that produced this memory. NULL for reflections. */
  observation_id?: string | null;

  metadata?: Record<string, unknown>;

  effective_score?: number;
  last_scored?: string;
}

/** Insert a memory using the Memory V2 columns. */
export async function insertMemoryV2(data: InsertMemoryV2Input) {
  const supabase = await createClient();
  return supabase.from("memories").insert(data);
}

/** V2 update input ΓÇö any subset of the updatable V2 fields. */
export interface UpdateMemoryV2Input {
  title?: string;
  content?: string;
  embedding?: number[] | null;

  memory_type?: MemoryType;
  status?: MemoryStatus;

  summary?: string;
  tags?: string[];

  importance_v2?: number;
  confidence_v2?: number;
  source_v2?: MemorySource;

  source_ref?: string | null;
  project_id?: string | null;

  metadata?: Record<string, unknown>;

  observation_id?: string | null;

  effective_score?: number;
  last_scored?: string;
}

/** Update a memory's V2 fields. */
export async function updateMemoryV2(
  id: string,
  updates: UpdateMemoryV2Input
) {
  const supabase = await createClient();
  return supabase.from("memories").update(updates).eq("id", id);
}

export async function getAllMemories(userId: string) {
  const supabase = await createClient();

  return supabase
    .from("memories")
    .select(
      "id,title,content,summary,memory_type,status,importance_v2,confidence_v2,created_at,updated_at,tags,metadata,source_ref,project_id,observation_id"
    )
    .eq("user_id", userId);
}

/* -------------------------------------------------------------------------- */
/* DEFERRED: findNearDuplicates -> find_near_duplicates RPC.                    */
/* 0004_memory_v2_rpcs.sql defines find_near_duplicates without its closing     */
/* $$; (its body flows into apply_memory_decay), so the RPC definition is      */
/* malformed until the SQL is fixed ΓÇö a SQL change out of scope here. Will be   */
/* added once 0004 is corrected. See ENGINEERING_LOG for the full analysis.      */
/* -------------------------------------------------------------------------- */

/** Sprint 24: Fetch memories with lifecycle-relevant columns for a specific user. */
export async function getMemoriesForLifecycle(userId: string) {
  const supabase = await createClient();
  return supabase.from("memories").select("id,memory_type,status,importance_v2,confidence_v2,effective_score,last_scored,last_used,times_used,created_at,updated_at").eq("user_id", userId);
}

/** Sprint 24: Batch-update lifecycle fields for multiple memories (user-scoped via caller). */
export async function batchUpdateLifecycle(
  updates: Array<{ id: string; status: string; effective_score: number; last_scored: string }>
) {
  const supabase = await createClient();
  for (const u of updates) {
    const { error } = await supabase.from("memories").update({ status: u.status, effective_score: u.effective_score, last_scored: u.last_scored }).eq("id", u.id);
    if (error) console.error("LIFECYCLE UPDATE FAILED", u.id, error);
  }
  return { updated: updates.length };
}
export async function purgeArchived(userId: string) { const supabase = await createClient(); const { data, error } = await supabase.rpc('purge_archived', { p_user_id: userId }); return { count: data ?? 0, error }; }

/**
 * Record exactly-once corroboration for (memory_id, message_id) via the
 * `corroborate_memory` RPC (migration 0011). Returns true only when a brand-new
 * corroboration was recorded for this message (and confidence_v2 was bumped by
 * CONFIDENCE_CORROBORATION_STEP inside the RPC, atomically). Duplicate
 * (memory_id, message_id) attempts ΓÇö same message re-processing ΓÇö return false
 * and do not touch confidence.
 */
export async function corroborateMemory(
  memoryId: string,
  messageId: string
): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("corroborate_memory", {
    p_memory_id: memoryId,
    p_message_id: messageId,
  });
  if (error) {
    console.error("CORROBORATE FAILED", memoryId, error);
    return false;
  }
  return data === true;
}

/* -------------------------------------------------------------------------- */
/* Phase 6-AN: consolidation contract (additive)                               */
/* -------------------------------------------------------------------------- */

/** Full rows needed by the consolidation decision module, fetched by ids. */
export interface ConsolidationRow {
  id: string;
  memoryType: string;
  status: string;
  createdAt: string;
  effectiveScore: number | null;
  confidence: number | null;
  timesUsed: number | null;
  lastUsed: string | null;
  title: string;
  content: string;
  observationId: string | null;
  sourceV2: string | null;
}

export async function getMemoriesByIds(
  userId: string,
  ids: string[]
): Promise<ConsolidationRow[]> {
  if (!ids.length) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("memories")
    .select(
      "id,memory_type,status,created_at,effective_score,confidence_v2,times_used,last_used,title,content,observation_id,source_v2"
    )
    .eq("user_id", userId)
    .in("id", ids);
  if (error) {
    console.error("GET MEMORIES BY IDS FAILED", error);
    return [];
  }
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    memoryType: r.memory_type as string,
    status: r.status as string,
    createdAt: r.created_at as string,
    effectiveScore: (r.effective_score as number) ?? null,
    confidence: (r.confidence_v2 as number) ?? null,
    timesUsed: (r.times_used as number) ?? null,
    lastUsed: (r.last_used as string) ?? null,
    title: r.title as string,
    content: r.content as string,
    observationId: (r.observation_id as string) ?? null,
    sourceV2: (r.source_v2 as string) ?? null,
  }));
}

export interface ConsolidateMemoriesResult {
  ok: boolean;
  reason?: string;
  canonicalId?: string;
  merged?: string[];
  consolidationId?: string;
  error?: unknown;
}

/** Invoke the atomic consolidation RPC (migration 0014). Performs writes. */
export async function consolidateMemories(input: {
  userId: string;
  keepId: string;
  mergeIds: string[];
}): Promise<ConsolidateMemoriesResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("consolidate_memories", {
    p_user_id: input.userId,
    p_keep: input.keepId,
    p_merge: input.mergeIds,
  });
  if (error) {
    console.error("CONSOLIDATE FAILED", input.keepId, error);
    return { ok: false, error };
  }
  const d = data as {
    ok: boolean;
    reason?: string;
    canonical_id?: string;
    merged?: string[];
    consolidation_id?: string;
  };
  return {
    ok: d.ok,
    reason: d.reason,
    canonicalId: d.canonical_id,
    merged: d.merged,
    consolidationId: d.consolidation_id,
  };
}

/** Reverse a consolidation batch via the rollback RPC (migration 0014). */
export async function rollbackConsolidation(input: {
  userId: string;
  canonicalId: string;
}): Promise<{ ok: boolean; reason?: string; restored?: string[]; error?: unknown }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rollback_consolidation", {
    p_user_id: input.userId,
    p_canonical_id: input.canonicalId,
  });
  if (error) {
    console.error("ROLLBACK CONSOLIDATION FAILED", input.canonicalId, error);
    return { ok: false, error };
  }
  const d = data as { ok: boolean; reason?: string; restored?: string[] };
  return { ok: d.ok, reason: d.reason, restored: d.restored };
}


