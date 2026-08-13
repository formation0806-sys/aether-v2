import { createClient } from "@/lib/supabase/server";
import { ChatMessage } from "@/lib/ai/types";

export async function getMessages(userId: string) {
  const supabase = await createClient();
  return supabase
    .from("messages")
    .select("role,content")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
}

export async function insertMessage(userId: string, message: ChatMessage) {
  const supabase = await createClient();
  return supabase.from("messages").insert({
    user_id: userId,
    role: message.role,
    content: message.content,
  });
}

export async function deleteMessages(userId: string) {
  const supabase = await createClient();
  return supabase.from("messages").delete().eq("user_id", userId);
}
