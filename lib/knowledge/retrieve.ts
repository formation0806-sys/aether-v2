import { getKnowledgeByUser } from "@/lib/repositories/knowledge.repository";

export async function retrieveKnowledge(userId: string) {
  const { data } = await getKnowledgeByUser(userId);

  return data ?? [];
}