import { createClient } from "@/lib/supabase/server";

export interface SaveMemoryInput {
  userId: string;
  title: string;
  content: string;
  role?: string;
}

export async function saveMemory({
  userId,
  title,
  content,
  role = "system",
}: SaveMemoryInput) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("memories")
    .insert({
      user_id: userId,
      title,
      content,
      role,
    });

  if (error) {
    console.error(error);
    throw error;
  }
}

export async function getMemories(userId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("memories")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(error);
    throw error;
  }

  return data ?? [];
}