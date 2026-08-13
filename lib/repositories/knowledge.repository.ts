import { createClient } from "@/lib/supabase/server";

export async function findKnowledgeByTitle(userId: string, title: string) {
  const supabase = await createClient();
  return supabase
    .from("knowledge")
    .select("id")
    .eq("user_id", userId)
    .eq("title", title)
    .maybeSingle();
}

export async function insertKnowledge(data: {
  user_id: string;
  title: string;
  content: string;
  category: string;
}) {
  const supabase = await createClient();
  return supabase.from("knowledge").insert(data);
}

export async function updateKnowledge(
  id: string,
  updates: {
    content: string;
    category: string;
  }
) {
  const supabase = await createClient();
  return supabase.from("knowledge").update(updates).eq("id", id);
}

export async function getKnowledgeByUser(userId: string) {
  const supabase = await createClient();
  return supabase
    .from("knowledge")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
}

export async function searchKnowledgeByContent(userId: string, query: string) {
  const supabase = await createClient();
  return supabase
    .from("knowledge")
    .select("*")
    .eq("user_id", userId)
    .ilike("content", `%${query}%`)
    .limit(10);
}
