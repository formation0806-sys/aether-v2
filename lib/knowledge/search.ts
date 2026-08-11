import { createClient } from "@/lib/supabase/server";

export async function searchKnowledge(
  userId: string,
  query: string
) {
  const supabase = await createClient();

  const { data } = await supabase
    .from("knowledge")
    .select("*")
    .eq("user_id", userId)
    .ilike("content", `%${query}%`)
    .limit(10);

  return data ?? [];
}