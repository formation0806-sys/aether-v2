import { createClient } from "@/lib/supabase/server";

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
