import {
  findKnowledgeByTitle,
  insertKnowledge,
  updateKnowledge,
} from "@/lib/repositories/knowledge.repository";

export async function saveKnowledge(
  userId: string,
  title: string,
  content: string,
  category = "general"
) {
  const { data: existing } = await findKnowledgeByTitle(userId, title);

  if (existing) {
    await updateKnowledge(existing.id, {
      content,
      category,
    });

    return;
  }

  await insertKnowledge({
    user_id: userId,
    title,
    content,
    category,
  });
}