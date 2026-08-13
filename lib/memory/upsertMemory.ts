import {
  getMemoryByTitle,
  insertMemory,
  updateMemoryById,
} from "@/lib/repositories/memory.repository";
import { embed } from "@/lib/ai/embeddings/embed";

export async function upsertMemory(
  userId: string,
  title: string,
  content: string
) {
  const { data: existing } = await getMemoryByTitle(userId, title);

  const vector = await embed(content);

  if (existing) {
    await updateMemoryById(existing.id, {
      content,
      embedding: vector.embedding,
    });

    return;
  }

  await insertMemory({
    user_id: userId,
    title,
    content,
    role: "system",
    embedding: vector.embedding,
  });
}