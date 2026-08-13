import { createClient } from "@/lib/supabase/server";

export async function getProfile(userId: string) {
  const supabase = await createClient();
  return supabase.from("profiles").select("*").eq("id", userId).single();
}

export async function updateProfile(
  userId: string,
  updates: Record<string, unknown>
) {
  const supabase = await createClient();
  return supabase.from("profiles").update(updates).eq("id", userId);
}
