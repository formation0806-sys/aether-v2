import {
  findMemoryByTitle,
  insertMemory,
  updateMemoryById,
  matchMemories,
} from "@/lib/repositories/memory.repository";
import { embed } from "@/lib/ai/embeddings/embed";

export interface SaveMemoryInput {
  userId: string;
  title: string;
  content: string;
  role?: string;
}

export interface MemoryRecord {
  id: string;
  title: string;
  content: string;
  similarity?: number;
}

export async function saveMemory({
  userId,
  title,
  content,
  role = "system",
}: SaveMemoryInput) {
  const vector = await embed(content);

  const { data: existing } = await findMemoryByTitle(userId, title);

  if (existing && existing.length > 0) {
    if (existing[0].content === content) {
      console.log("MEMORY SKIPPED");
      return;
    }

    const { error } = await updateMemoryById(existing[0].id, {
      content,
      embedding: vector.embedding,
    });

    if (error) throw error;

    console.log("MEMORY UPDATED");
    return;
  }

  const { error } = await insertMemory({
    user_id: userId,
    title,
    content,
    role,
    embedding: vector.embedding,
  });

  if (error) throw error;

  console.log("MEMORY INSERTED");
}

export async function getRelevantMemories(
  userId: string,
  query: string
): Promise<MemoryRecord[]> {
  const vector = await embed(query);

  const { data, error } = await matchMemories(vector.embedding, userId, 8);

  if (error) throw error;

  console.log("RETRIEVED MEMORIES:", data);

  return (data ?? []) as MemoryRecord[];
}