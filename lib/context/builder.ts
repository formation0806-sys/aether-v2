import { getIdentity } from "@/lib/identity/identity";
import { retrieveMemories } from "@/lib/memory/retrieve";

export interface Context {
  identity: Awaited<ReturnType<typeof getIdentity>>;
  memories: Awaited<ReturnType<typeof retrieveMemories>>;
}

export async function buildContext(
  userId: string
): Promise<Context> {
  const identity = await getIdentity(userId);

  const memories = await retrieveMemories(userId);

  return {
    identity,
    memories,
  };
}