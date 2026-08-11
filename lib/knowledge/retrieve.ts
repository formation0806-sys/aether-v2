import { createClient } from "@/lib/supabase/server";

export async function retrieveKnowledge(userId: string) {
  const supabase = await createClient();

  const { data } = await supabase
    .from("knowledge")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", {
      ascending: false,
    });

  return data ?? [];
}