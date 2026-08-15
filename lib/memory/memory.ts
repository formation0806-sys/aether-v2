import {
  findMemoryByTitle,
  insertMemoryV2,
  updateMemoryV2,
  matchMemoriesV2,
} from "@/lib/repositories/memory.repository";
import { embed } from "@/lib/ai/embeddings/embed";
import { scoreExtractedMemory, effectiveScoreForType } from "./score";
import { PROMOTE_ACTIVE_THRESHOLD } from "./constants";
import type { MemoryType } from "./types";

export interface SaveMemoryInput {
  userId: string;
  title: string;
  content: string;
  role?: string;
  memoryType?: MemoryType;
  importance?: number;
  confidence?: number;
  explicit?: boolean;
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
  memoryType,
  importance,
  confidence,
  explicit,
}: SaveMemoryInput) {
  const vector = await embed(content);

  const { importance: importanceV2, confidence: confidenceV2 } =
    scoreExtractedMemory({ title, content, memoryType, importance, confidence, explicit });

  // Sprint 20 (Option A): deterministic lifecycle gate at write time.
  // Uses the existing effective-score scorer and the frozen
  // PROMOTE_ACTIVE_THRESHOLD. Never demotes; only promotes to active.
  const effective = effectiveScoreForType(
    importanceV2,
    null,
    memoryType ?? "semantic"
  );
  const promoteToActive = effective >= PROMOTE_ACTIVE_THRESHOLD;
  const effectiveScore = Number(effective.toFixed(3));
  const lastScored = new Date().toISOString();

  const { data: existing } = await findMemoryByTitle(userId, title);

  if (existing && existing.length > 0) {
    if (existing[0].content === content) {
      console.log("MEMORY SKIPPED");
      return;
    }

    const { error } = await updateMemoryV2(existing[0].id, {
      content,
      embedding: vector.embedding,
      memory_type: memoryType,
      importance_v2: importanceV2,
      confidence_v2: confidenceV2,
      effective_score: effectiveScore,
      last_scored: lastScored,
      ...(promoteToActive ? ({ status: "active" } as const) : {}),
    });

    if (error) throw error;

    if (promoteToActive) console.log("MEMORY PROMOTED");

    console.log("MEMORY UPDATED");
    return;
  }

  const { error } = await insertMemoryV2({
    user_id: userId,
    title,
    content,
    embedding: vector.embedding,
    memory_type: memoryType,
    importance_v2: importanceV2,
    confidence_v2: confidenceV2,
    source_v2: "extractor",
    status: promoteToActive ? "active" : "candidate",
    effective_score: effectiveScore,
    last_scored: lastScored,
  });

  if (error) throw error;

  if (promoteToActive) console.log("MEMORY PROMOTED");

  console.log("MEMORY INSERTED");
}

export async function getRelevantMemories(
  userId: string,
  query: string
): Promise<MemoryRecord[]> {
  const vector = await embed(query);

  const { data, error } = await matchMemoriesV2(
  vector.embedding,
  userId,
  {
    matchCount: 8,
  }
);

  if (error) throw error;

  console.log("RETRIEVED MEMORIES:", data);

  return (data ?? []) as MemoryRecord[];
}