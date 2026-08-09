import { supabase } from "./supabase";
import { MemoryRecord } from "./types";

export async function saveMemory(memory: MemoryRecord) {
  const { error } = await supabase
    .from("memories")
    .insert({
      user_id: memory.userId,
      role: memory.role,
      title: memory.title,
      content: memory.content,
    });

  if (error) {
    console.error("Save memory failed:", error);
    throw error;
  }
}

export async function getMemories(userId: string) {
  const { data, error } = await supabase
    .from("memories")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", {
      ascending: true,
    });

  if (error) {
    console.error("Load memories failed:", error);
    return [];
  }

  return data;
}

export async function clearMemories(userId: string) {
  const { error } = await supabase
    .from("memories")
    .delete()
    .eq("user_id", userId);

  if (error) {
    console.error("Clear memories failed:", error);
  }
}