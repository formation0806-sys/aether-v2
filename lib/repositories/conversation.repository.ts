import { createClient } from "@/lib/supabase/server";
import { ChatMessage } from "@/lib/ai/types";

/**
 * Loads messages for a conversation. When `conversationId` is provided the
 * query is scoped to that conversation only (session_id). When omitted it
 * returns every message for the user (legacy behavior).
 */
export async function getMessages(userId: string, conversationId?: string | null) {
  const supabase = await createClient();
  let query = supabase
    .from("messages")
    .select("role,content,session_id,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (conversationId) {
    query = query.eq("session_id", conversationId);
  }
  return query;
}

/**
 * Inserts a message row tagged with a conversation id (session_id). The id
 * is required: callers must always pass an explicit conversation identity
 * (newly-created or previously-recorded). Use `null` ONLY for legacy /
 * migration purposes.
 */
export async function insertMessage(
  userId: string,
  message: ChatMessage,
  conversationId: string | null
) {
  const supabase = await createClient();
  return supabase
    .from("messages")
    .insert({
      user_id: userId,
      role: message.role,
      content: message.content,
      session_id: conversationId,
    })
    .select("id")
    .single();
}

export async function deleteMessages(userId: string) {
  const supabase = await createClient();
  return supabase.from("messages").delete().eq("user_id", userId);
}


/**
 * Atomically persist a user `messages` row AND enqueue a memory-maintenance
 * job for it in a single PostgreSQL transaction (via the
 * `create_message_and_job` RPC from migration 0013, extended in 0020).
 *
 * The optional `p_conversation_id` is forwarded into `messages.session_id`
 * so the row is permanently tagged with the conversation it belongs to.
 *
 * Returns the new message id, or `null` if BOTH the RPC and the plain-insert
 * fallback failed (without throwing), matching the swallow semantics the
 * user-message path currently has.
 *
 * Fallback: when the RPC is unavailable in the live database schema (e.g.
 * the function does not yet accept `p_conversation_id`), fall through to a
 * plain `insertMessage` so the row is still persisted. The memory-maintenance
 * job is best-effort and will be skipped if the RPC is unavailable — the
 * user-visible conversation history is still saved.
 */
export async function createMessageWithJob(
  userId: string,
  message: string,
  conversationId?: string | null
): Promise<string | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("create_message_and_job", {
    p_user_id: userId,
    p_message: message,
    p_conversation_id: conversationId ?? null,
  });

  if (!error) {
    return (data as string) ?? null;
  }

  // RPC unavailable / schema mismatch — fall back to a plain insert so the
  // message is still persisted to the `messages` table. This is what powers
  // the sidebar's Recent list and the conversation history reload on refresh.
  console.error(
    "CREATE MESSAGE AND JOB RPC FAILED — falling back to plain insert",
    error
  );

  const fallback = await insertMessage(
    userId,
    { role: "user", content: message },
    conversationId ?? null
  );

  if (fallback.error) {
    console.error(
      "CREATE MESSAGE AND JOB FALLBACK INSERT FAILED",
      fallback.error
    );
    return null;
  }

  const row = fallback.data as { id: string } | null;
  return row?.id ?? null;
}
