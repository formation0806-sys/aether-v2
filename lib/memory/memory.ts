import {
  getMemoryByTitle,
  insertMemoryV2,
  updateMemoryV2,
  matchMemoriesV2,
} from "@/lib/repositories/memory.repository";
import { embed } from "@/lib/ai/embeddings/embed";
import { assertEmbeddingValid } from "./embedding-validation";
import { scoreExtractedMemory } from "./score";
import { effectiveScoreForType } from "./score";
import { PROMOTE_ACTIVE_THRESHOLD } from "./constants";
import type { MemoryType, MemoryStatus, MemorySource } from "./types";

export interface SaveMemoryInput {
  userId: string;
  title: string;
  content: string;

  memoryType?: MemoryType;
  status?: MemoryStatus;

  summary?: string;
  tags?: string[];

  importance?: number;
  confidence?: number;

  explicit?: boolean;

  source?: MemorySource;
  sourceRef?: string | null;

  projectId?: string | null;
  metadata?: Record<string, unknown>;

  observationId?: string | null;
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

  memoryType = "semantic",
  status,

  summary = "",
  tags = [],

  importance = 0.5,
  confidence = 0.8,

  explicit,

  source = "extractor",
  sourceRef = null,

  projectId = null,
  metadata = {},
  observationId = null,
}: SaveMemoryInput) {
  const { importance: normalizedImportance, confidence: normalizedConfidence } =
    scoreExtractedMemory({
      title,
      content,
      memoryType,
      importance,
      confidence,
      explicit,
    });

  const effective = effectiveScoreForType(normalizedImportance, null, memoryType);
  const promoteToActive = effective >= PROMOTE_ACTIVE_THRESHOLD;
  const effectiveScore = Number(effective.toFixed(3));
  const lastScored = new Date().toISOString();

  const vector = await embed(content);
  // Phase 6-AI: prevent obviously invalid embeddings from being persisted.
  assertEmbeddingValid(vector.embedding);

  const { data: existing, error: lookupError } =
    await getMemoryByTitle(userId, title);

  if (lookupError) throw lookupError;

  if (existing) {
    if (existing.content === content) {
      console.log("MEMORY SKIPPED");
      return existing;
    }

    const { error } = await updateMemoryV2(existing.id, {
      title,
      content,
      embedding: vector.embedding,

      memory_type: memoryType,
      ...(status ? { status } : {}),

      summary,
      tags,

      importance_v2: normalizedImportance,
      confidence_v2: normalizedConfidence,
      source_v2: source,

      source_ref: sourceRef,
      project_id: projectId,

      metadata,
      observation_id: observationId,
    });

    if (error) throw error;

    console.log("MEMORY UPDATED");

    return;
  }

  const { error } = await insertMemoryV2({
    user_id: userId,

    title,
    content,

    embedding: vector.embedding,

    memory_type: memoryType,
    status: status ?? (promoteToActive ? "active" : "candidate"),

    summary,
    tags,

    importance_v2: normalizedImportance,
    confidence_v2: normalizedConfidence,
    source_v2: source,

    source_ref: sourceRef,
    project_id: projectId,

    metadata,
    observation_id: observationId,

    effective_score: effectiveScore,
    last_scored: lastScored,
  });

  if (error) throw error;

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

  return (data ?? []) as MemoryRecord[];
}
