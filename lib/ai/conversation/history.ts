import { ChatMessage } from "../types";
import { createClient } from "@/lib/supabase/server";

/**
 * Upper bound on the messages replayed to the model for one turn.
 *
 * The chat endpoint runs with num_ctx = 8192 (lib/ai/providers/ollama.ts), and
 * the prompt must also hold the brain prompt, the agent tool manifest, and —
 * when native tool calling is on — the provider's tool schemas. An unbounded
 * history silently consumed that window: with no session filter and no limit a
 * single request carried 333 messages and 7,684 of 8,192 tokens, leaving the
 * model no room for the tool framing, so it answered in prose instead of
 * calling a tool.
 *
 * 40 messages is about twenty turns: far more than any real conversational
 * window, and small enough to keep the whole prompt near 2k tokens.
 */
export const MAX_HISTORY_MESSAGES = 40;

/**
 * Loads the message history for a SINGLE conversation. When `conversationId`
 * is provided the query is scoped by `session_id`. When omitted it still
 * returns this user's most recent messages (legacy / pre-isolation data)
 * rather than the whole table. Either way the result is bounded by
 * MAX_HISTORY_MESSAGES and returned oldest-first.
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
    // Newest first, so the limit keeps the most recent turns; reversed below so
    // the model still reads the conversation in order.
    .order("created_at", { ascending: false })
    .limit(MAX_HISTORY_MESSAGES);
  if (conversationId) {
    query = query.eq("session_id", conversationId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("History load failed:", error);
    return [];
  }

  return ((data ?? []) as ChatMessage[]).slice().reverse();
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
