import {
  getMemoriesByTitle,
  insertMemoryV2,
  updateMemoryV2,
  matchMemoriesV2,
} from "@/lib/repositories/memory.repository";
import { createClient } from "@/lib/supabase/server";
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

  const { data: titleMatches, error: lookupError } =
    await getMemoriesByTitle(userId, title);

  if (lookupError) throw lookupError;

  // F2: getMemoryByTitle returns ALL rows sharing this title and never throws
  // on duplicates. N > 1 is an ambiguous title key: never blind-pick a
  // canonical row, never mutate existing rows, never supersede arbitrarily —
  // fall through to the fail-safe plain insert below (the identity verifier
  // has already returned `create` for this observation upstream, so no new
  // contradiction/supersede semantics are introduced here; F4 stays separate).
  if (titleMatches.length > 1) {
    console.warn(
      "MEMORY TITLE AMBIGUOUS",
      title,
      "rows:",
      titleMatches.length
    );
  }

  const existing =
    titleMatches.length === 1 ? titleMatches[0] : undefined;

  if (existing) {
    if (existing.content === content) {
      console.log("MEMORY SKIPPED");
      return existing;
    }

    // Same title, different content → supersession (Option B):
    // Insert the new memory first, then mark the old one as "merged".
    // Preserve old content and provenance; do not overwrite old metadata.

    // Fetch full existing record (incl. metadata) for provenance preservation
    const supabase = await createClient();
    const { data: fullExisting } = await supabase
      .from("memories")
      .select("id,content,metadata,observation_id,created_at,source_v2")
      .eq("id", existing.id)
      .single()

    // 1. Insert the new memory
    const { data: newMemory, error: insertError } = await insertMemoryV2({
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

    if (insertError) throw insertError;

    // 2. Extract the new memory ID from the insert response
    const newMemoryId =
      (Array.isArray(newMemory) ? newMemory[0] : newMemory) as {
        id: string;
      } | null;

    if (!newMemoryId?.id) {
      throw new Error("FAILED_TO_OBTAIN_NEW_MEMORY_ID");
    }

    // 3. Prepare merged metadata for the old memory,
    //    preserving any existing metadata keys and adding supersession info.
    const existingMetadata =
      (fullExisting?.metadata as Record<string, unknown> | null) ?? {};
    const mergedMetadata = {
      ...existingMetadata,
      superseded_by: newMemoryId.id,
      supersession_reason: "identity_update",
    };

    // 4. Update the old memory to "merged" status
    const { error: updateError } = await updateMemoryV2(existing.id, {
      status: "merged",
      metadata: mergedMetadata,
    });

    if (updateError) {
      // F3: partial write must be observable. The new memory is already
      // committed; throwing surfaces the failure to the pipeline so the job
      // is dead-lettered with last_error instead of reporting completion.
      throw new Error(
        `FAILED_TO_SUPERSEDE_OLD_MEMORY: ${updateError.message} (new memory committed; old memory ${existing.id} not merged)`
      );
    }

    console.log("MEMORY SUPERSEDED");

    // 5. Return the new memory
    return newMemory;
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
