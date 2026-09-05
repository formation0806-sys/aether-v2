import { ChatMessage } from "../types";
import { createClient } from "@/lib/supabase/server";

/**
 * Loads the message history for a SINGLE conversation. When `conversationId`
 * is provided the query is scoped by `session_id`. When omitted it returns
 * every message for the user (legacy / pre-isolation data).
 */
export async function getHistory(
  userId: string,
  conversationId?: string | null
): Promise<ChatMessage[]> {
  const supabase = await createClient();

  let query = supabase
    .from("messages")
    .select("role,content")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (conversationId) {
    query = query.eq("session_id", conversationId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("History load failed:", error);
    return [];
  }

  return (data ?? []) as ChatMessage[];
}

export async function addMessage(
  userId: string,
  message: ChatMessage,
  conversationId?: string | null
) {
  const supabase = await createClient();

  const { error } = await supabase.from("messages").insert({
    user_id: userId,
    role: message.role,
    content: message.content,
    session_id: conversationId ?? null,
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
