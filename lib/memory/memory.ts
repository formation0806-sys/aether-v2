import { createClient } from "@/lib/supabase/server";
import { embed } from "@/lib/ai/embeddings/embed";

export interface SaveMemoryInput {
  userId: string;
  title: string;
  content: string;
  role?: string;
}

export interface MemoryRecord {
  id: string;
  title: string;
  content: string;
  similarity?: number;
}

export async function saveMemory({
  userId,
  title,
  content,
  role = "system",
}: SaveMemoryInput) {
  const supabase = await createClient();

  const vector = await embed(content);

  const { data: existing } = await supabase
    .from("memories")
    .select("id,content")
    .eq("user_id", userId)
    .eq("title", title)
    .limit(1);

  if (existing && existing.length > 0) {
    if (existing[0].content === content) {
      console.log("MEMORY SKIPPED");
      return;
    }

    const { error } = await supabase
      .from("memories")
      .update({
        content,
        embedding: vector.embedding,
      })
      .eq("id", existing[0].id);

    if (error) throw error;

    console.log("MEMORY UPDATED");
    return;
  }

  const { error } = await supabase
    .from("memories")
    .insert({
      user_id: userId,
      title,
      content,
      role,
      embedding: vector.embedding,
    });

  if (error) throw error;

  console.log("MEMORY INSERTED");
}

export async function getRelevantMemories(
  userId: string,
  query: string
): Promise<MemoryRecord[]> {
  const supabase = await createClient();

  const vector = await embed(query);

  const { data, error } = await supabase.rpc("match_memories", {
    query_embedding: vector.embedding,
    match_user: userId,
    match_count: 8,
  });

  if (error) throw error;

  console.log("RETRIEVED MEMORIES:", data);

  return (data ?? []) as MemoryRecord[];
}