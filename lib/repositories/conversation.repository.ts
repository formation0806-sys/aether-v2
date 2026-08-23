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
  return supabase
    .from("messages")
    .insert({
      user_id: userId,
      role: message.role,
      content: message.content,
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
 * `create_message_and_job` RPC from migration 0013).
 *
 * This is the atomic boundary for the user-message path: a `messages` INSERT
 * and a `memory_jobs` INSERT happen together inside the RPC, so we never end
 * up with a message row that has no job (or vice-versa). This replaces the
 * two-step client-side insert and must not be emulated from TypeScript.
 *
 * Returns the new message id, or `null` if the RPC failed (without throwing),
 * matching the swallow semantics the user-message path currently has. Phase 3
 * wires this in and owns the upstream error policy.
 */
export async function createMessageWithJob(
  userId: string,
  message: string
): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_message_and_job", {
    p_user_id: userId,
    p_message: message,
  });
  if (error) {
    console.error("CREATE MESSAGE AND JOB FAILED", error);
    return null;
  }
  return (data as string) ?? null;
}
