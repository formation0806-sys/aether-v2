import { createClient } from "@/lib/supabase/server";

export async function saveKnowledge(
  userId: string,
  title: string,
  content: string,
  category = "general"
) {
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("knowledge")
    .select("id")
    .eq("user_id", userId)
    .eq("title", title)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("knowledge")
      .update({
        content,
        category,
      })
      .eq("id", existing.id);

    return;
  }

  await supabase.from("knowledge").insert({
    user_id: userId,
    title,
    content,
    category,
  });
}