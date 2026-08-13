import { searchKnowledgeByContent } from "@/lib/repositories/knowledge.repository";

export async function searchKnowledge(
  userId: string,
  query: string
) {
  const { data } = await searchKnowledgeByContent(userId, query);

  return data ?? [];
}