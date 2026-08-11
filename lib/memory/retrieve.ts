import { createClient } from "@/lib/supabase/server";
import { embed } from "@/lib/ai/embeddings/embed";

export async function retrieveMemories(
  userId: string,
  query: string
) {
  const supabase = await createClient();

  console.time("QUERY EMBEDDING");

  const vector = await embed(query);

  console.timeEnd("QUERY EMBEDDING");

  console.time("VECTOR SEARCH");

  const { data, error } = await supabase.rpc(
    "match_memories",
    {
      query_embedding: vector.embedding,
      match_user: userId,
      match_count: 8,
    }
  );

  console.timeEnd("VECTOR SEARCH");

  if (error) throw error;

  if (!data) return [];

  for (const memory of data) {
    await supabase
      .from("memories")
      .update({
        times_used: (memory.times_used ?? 0) + 1,
        last_used: new Date().toISOString(),
      })
      .eq("id", memory.id);
  }

  return data;
}