import { supabase } from "@/lib/memory/supabase";
import { IdentityFact } from "./extractor";

export async function saveIdentityFacts(
  userId: string,
  facts: IdentityFact[]
) {
  if (facts.length === 0) return;

  const updates: Record<string, unknown> = {};

  for (const fact of facts) {
    switch (fact.field) {
      case "name":
        updates.full_name = fact.value;
        break;

      case "profession":
        updates.profession = fact.value;
        break;

      case "age":
        updates.age = Number(fact.value);
        break;

      case "favorite_language":
        updates.favorite_language = fact.value;
        break;

      case "dog_name":
        updates.dog_name = fact.value;
        break;
    }
  }

  const { error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", userId);

  if (error) {
    console.error("Identity save failed:", error);
  }
}