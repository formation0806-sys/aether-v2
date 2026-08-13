import { createClient } from "@/lib/supabase/server";
import {
  matchMemories,
  incrementMemoryUsage,
} from "@/lib/repositories/memory.repository";
import { embed } from "@/lib/ai/embeddings/embed";

export async function retrieveMemories(
  userId: string,
  query: string
) {
  console.log(
    "ENTER retrieveMemories | userId:",
    userId,
    "| CALL STACK:",
    new Error().stack
  );
  try {
    console.log("========== RETRIEVE ==========");
    console.log("QUERY:", query);
    console.log("USER ID PASSED:", userId);

    // AUTH DEBUG
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    console.log("========== AUTH ==========");
    console.log("AUTH USER:", user);
    console.log("AUTH ERROR:", authError);

    // EMBEDDING
    const vector = await embed(query);

    console.log("========== EMBEDDING ==========");
    console.log("Embedding length:", vector.embedding.length);
    console.log("First 5:", vector.embedding.slice(0, 5));

    // RPC
    const result = await matchMemories(
      vector.embedding,
      userId,
      8
    );

    console.log("========== RPC ==========");
    console.log(result);

    if (result.error) {
      throw result.error;
    }

    const memories = result.data ?? [];

    console.log("========== MEMORIES ==========");
    console.log(memories);

    for (const memory of memories) {
      await incrementMemoryUsage(
        memory.id,
        (memory.times_used ?? 0) + 1,
        new Date().toISOString()
      );
    }

    return memories;
  } catch (err) {
    console.error("========== ERROR ==========");
    console.error(err);
    throw err;
  }
}