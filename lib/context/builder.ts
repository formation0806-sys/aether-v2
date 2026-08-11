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

export async function buildContext(
  userId: string,
  message: string
): Promise<ContextResult> {
  const [
    identity,
    memories,
    knowledge,
    planner,
  ] = await Promise.all([
    getIdentity(userId),

    retrieveMemories(userId, message),

    retrieveKnowledge(userId),

    retrievePlanner(userId),
  ]);

  return {
    identity,
    memories,
    knowledge,
    planner,
  };
}