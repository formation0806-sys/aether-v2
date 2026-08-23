import { ChatMessage } from "../types";
import { createClient } from "@/lib/supabase/server";

export async function getHistory(
  userId: string
): Promise<ChatMessage[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("messages") 
    .select("role,content")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("History load failed:", error);
    return [];
  }

  return (data ?? []) as ChatMessage[];
}

export async function addMessage(
  userId: string,
  message: ChatMessage
) {
  const supabase = await createClient();

  const { error } = await supabase.from("messages").insert({
    user_id: userId,
    role: message.role,
    content: message.content,
  });

  if (error) {
    console.error("History save failed:", error);
  }
}

export async function clearHistory(userId: string) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("messages")
    .delete()
    .eq("user_id", userId);

  if (error) {
    console.error("History clear failed:", error);
  }
}