import { createClient } from "@/lib/supabase/server";
import { RETRIEVAL_TOP_K, MIN_SIMILARITY } from "@/lib/memory/constants";
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
    query_embedding: queryEmbedding,
    p_user_id: userId,
    p_match_count: options.matchCount ?? RETRIEVAL_TOP_K,
    p_min_similarity: options.minSimilarity ?? MIN_SIMILARITY,
    p_types: options.types ?? null,
    p_statuses: options.statuses ?? ["active"],
    p_project_id: options.projectId ?? null,
  });
}

/** Batch-increment `times_used` and set `last_used` via the `touch_memories` V2 RPC. */
export async function touchMemories(ids: string[]) {
  const supabase = await createClient();
  return supabase.rpc("touch_memories", {
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
  importance?: number;
  confidence?: number;
  source?: MemorySource;
  source_ref?: string | null;
  project_id?: string | null;
  metadata?: Record<string, unknown>;
  effective_score?: number;
  last_scored?: string;
}

/** Insert a memory using the Memory V2 columns. */
export async function insertMemoryV2(data: InsertMemoryV2Input) {
  const supabase = await createClient();
  return supabase.from("memories").insert(data);
}

/** V2 update input — any subset of the updatable V2 fields. */
export interface UpdateMemoryV2Input {
  title?: string;
  content?: string;
  embedding?: number[] | null;
  memory_type?: MemoryType;
  status?: MemoryStatus;
  summary?: string;
  tags?: string[];
  importance?: number;
  confidence?: number;
  source?: MemorySource;
  source_ref?: string | null;
  project_id?: string | null;
  metadata?: Record<string, unknown>;
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

/* -------------------------------------------------------------------------- */
/* DEFERRED: findNearDuplicates -> find_near_duplicates RPC.                    */
/* 0004_memory_v2_rpcs.sql defines find_near_duplicates without its closing     */
/* $$; (its body flows into apply_memory_decay), so the RPC definition is      */
/* malformed until the SQL is fixed — a SQL change out of scope here. Will be   */
/* added once 0004 is corrected. See ENGINEERING_LOG for the full analysis.      */
/* -------------------------------------------------------------------------- */
