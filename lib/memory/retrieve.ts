import { createClient } from "@/lib/supabase/server";

export async function retrieveMemories(userId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("memories")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    throw error;
  }

  return data ?? [];
}