import { getIdentity } from "@/lib/identity";
import { retrieveMemories } from "@/lib/memory";
import { retrieveKnowledge } from "@/lib/knowledge";
import { retrievePlanner } from "@/lib/planner";

export interface ContextResult {
  identity: unknown;

  memories: unknown[];

  knowledge: unknown[];

  planner: {
    goals: unknown[];
    projects: unknown[];
    milestones: unknown[];
    tasks: unknown[];
  };
}

/**
 * Memory retrieval is optional context enrichment. A failure anywhere in the
 * memory branch — Ollama embedding, the `match_memories_v2` RPC, scoring/MMR,
 * or `touchMemories` — must not reject context assembly or the chat request.
 * The identity / knowledge / planner branches remain fatal so unrelated
 * failures stay visible.
 */
async function retrieveMemoriesSafe(
  userId: string,
  message: string
): Promise<unknown[]> {
  try {
    const tMemStart = Date.now();
    const _memResult = await retrieveMemories(userId, message);
    console.log("MEMORY_RETRIEVAL memory_ms=" + (Date.now() - tMemStart).toFixed(2));
    return _memResult;
  } catch (error) {
    console.warn({
      event: "retrieval_degraded",
      userId,
      error,
    });

    return [];
  }
}

export async function buildContext(
  userId: string,
  message: string
): Promise<ContextResult> {
  console.log("CALLER: lib/context/builder.ts");
  console.log("USER PASSED:", userId);
  const tContextStart = Date.now();

  const [
    identity,
    memories,
    knowledge,
    planner,
  ] = await Promise.all([
    getIdentity(userId),

    retrieveMemoriesSafe(userId, message),

    retrieveKnowledge(userId),

    retrievePlanner(userId),
  ]);
  console.log("CONTEXT_TOTAL context_total_ms=" + (Date.now() - tContextStart).toFixed(2));

  return {
    identity,
    memories,
    knowledge,
    planner,
  };
}