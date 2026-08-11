import { createClient } from "@/lib/supabase/server";
import { embed } from "@/lib/ai/embeddings/embed";

export async function upsertMemory(
  userId: string,
  title: string,
  content: string
) {
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("memories")
    .select("id,content")
    .eq("user_id", userId)
    .eq("title", title)
    .maybeSingle();

  const vector = await embed(content);

  if (existing) {
    await supabase
      .from("memories")
      .update({
        content,
        embedding: vector.embedding,
      })
      .eq("id", existing.id);

    return;
  }

  await supabase.from("memories").insert({
    user_id: userId,
    title,
    content,
    role: "system",
    embedding: vector.embedding,
  });
}