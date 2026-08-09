import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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
  const { error } = await supabase.from("memories").insert({
    user_id: userId,
    title,
    content,
    role,
  });

  if (error) throw error;
}

export async function getMemories(userId: string) {
  const { data, error } = await supabase
    .from("memories")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) throw error;

  return data ?? [];
}