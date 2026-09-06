import { embed } from "@/lib/ai/embeddings/embed";
import {
  matchMemoriesV2,
  type MatchMemoriesV2Options,
} from "@/lib/repositories/memory.repository";

/**
 * Phase 1-B — Pure reflection-grounding validator.
 *
 * Enforces in code the reflection contract that was previously prompt-only
 * (structural proxies for the reflector prompt's RULE 7 and RULE 12):
 *
 *   R1  INSUFFICIENT_SOURCES         a valid reflection must be supported by
 *                                    TWO OR MORE source memories
 *   R2  CONTENT_IDENTICAL_TO_SOURCE  a reflection must not merely repeat one
 *                                    of its source memories verbatim
 *   R3  PROVENANCE_NOT_SUBSET        claimed source IDs must be a subset of
 *                                    the candidate IDs actually supplied to
 *                                    the generation operation
 *
 * Deliberately NOT part of this validator (deferred to Phase 1-C+):
 *   - embedding-based semantic support scoring
 *   - any numeric quality threshold or score invention
 *
 * Pure function: no I/O, no model calls, no scoring, fully deterministic.
 */

export interface GroundingSourceMemory {
  id: string;
  content: string;
}

export type GroundingRejectionReason =
  | "INSUFFICIENT_SOURCES"
  | "CONTENT_IDENTICAL_TO_SOURCE"
  | "PROVENANCE_NOT_SUBSET";

export interface GroundingVerdict {
  ok: boolean;
  reason?: GroundingRejectionReason;
}

export interface GroundingInput {
  /** Reflection content produced by the model (already trimmed upstream). */
  reflectionContent: string;
  /** Source-memory IDs claimed for this reflection (persisted provenance). */
  sourceMemoryIds: string[];
  /** ALL candidate memories that were supplied to the generation operation. */
  candidateMemories: GroundingSourceMemory[];
}

export function validateReflectionGrounding(
  input: GroundingInput
): GroundingVerdict {
  const { reflectionContent, sourceMemoryIds, candidateMemories } = input;

  // R3 — provenance integrity: every claimed ID must be a real candidate
  // supplied to the generation operation. Never inferred, never invented.
  const candidateIds = new Set(candidateMemories.map((m) => m.id));
  const claimedCount = sourceMemoryIds.filter((id) =>
    candidateIds.has(id)
  ).length;
  if (claimedCount !== sourceMemoryIds.length) {
    return { ok: false, reason: "PROVENANCE_NOT_SUBSET" };
  }

  // R1 — structural RULE 7: a reflection connects TWO OR MORE memories.
  if (claimedCount < 2) {
    return { ok: false, reason: "INSUFFICIENT_SOURCES" };
  }

  // R2 — minimal RULE 12 proxy: a reflection must not be a verbatim repeat
  // of a source memory. Exact (trimmed) equality only — no similarity
  // heuristics, no embeddings, no invented numeric thresholds.
  const normalizedReflection = reflectionContent.trim();
  const sourceContents = new Set(
    candidateMemories.map((m) => m.content.trim())
  );
  if (sourceContents.has(normalizedReflection)) {
    return { ok: false, reason: "CONTENT_IDENTICAL_TO_SOURCE" };
  }

  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Phase 1-C Step 5 — Semantic Shadow Mode (observational only)               */
/* -------------------------------------------------------------------------- */

/**
 * Semantic shadow-mode measurement dependencies.
 *
 * In production, defaults to the real `embed` (Ollama nomic-embed-text) and
 * the read-only `match_memories_v2` RPC wrapper. In tests, mock
 * implementations are supplied to avoid network / database calls.
 */
export interface SemanticShadowDeps {
  embed: (text: string) => Promise<{ embedding: number[] }>;
  matchMemoriesV2: (
    queryEmbedding: number[],
    userId: string,
    options: Pick<MatchMemoriesV2Options, "matchCount" | "minSimilarity">
  ) => Promise<{ data: unknown[] | null; error: unknown }>;
}

/** One claimed source's shadow measurement. */
export interface SemanticMeasuredSource {
  /** Claimed source memory ID. */
  id: string;
  /** Cosine similarity from `match_memories_v2`, or null when the RPC did
   *  not return this source (below its top-K floor or absent from the pool).
   *  null is NEVER silently converted to zero or a supporting score. */
  similarity: number | null;
}

/**
 * Observational-only semantic-support result (shadow mode).
 *
 * This is NOT an enforcement gate. It reports aggregate statistics about how
 * well the claimed source memories support the reflection semantically, but
 * NEVER rejects, saves, or destroys anything based on similarity.
 */
export interface SemanticSupportResult {
  /** Sources found in the RPC result, with their similarity scores. */
  measured: SemanticMeasuredSource[];
  /** Minimum similarity among measured sources (null if none measured). */
  minSimilarity: number | null;
  /** Mean similarity among measured sources (null if none measured). */
  meanSimilarity: number | null;
  /** Count of claimed sources found by the RPC. */
  measuredCount: number;
  /** Count of claimed sources NOT found by the RPC (similarity null). */
  unmeasuredCount: number;
}

/**
 * Phase 1-C Step 5 — Semantic Shadow Mode.
 *
 * Pure, NON-ENFORCING semantic-support measurement.
 *
 * Contract:
 * - EXACTLY ONE embedding call for the reflection content.
 * - EXACTLY ONE `match_memories_v2` call with threshold 0 and match_count 200
 *   (read-only, no writes).
 * - A claimed source present in the RPC results is "measured".
 * - A claimed source absent from the RPC results is "unmeasured" (similarity null).
 * - min/mean are computed over measured similarities only.
 * - NEVER rejects. NEVER persists. NEVER changes the reflection path.
 * - Existing R1/R2/R3 behavior in `validateReflectionGrounding` is unchanged.
 */
export async function measureSemanticSupport(
  reflectionContent: string,
  claimedSourceMemoryIds: string[],
  userId: string,
  deps: SemanticShadowDeps = { embed, matchMemoriesV2 }
): Promise<SemanticSupportResult> {
  // 1. One embedding call for the reflection content.
  const vector = await deps.embed(reflectionContent);

  // 2. Read-only RPC query: threshold 0 (accept all), high match count.
  const { data, error } = await deps.matchMemoriesV2(
    vector.embedding,
    userId,
    { minSimilarity: 0, matchCount: 200 }
  );

  // 3. Build id -> similarity map from RPC results.
  const byId = new Map<string, number>();
  if (!error && Array.isArray(data)) {
    for (const row of data as Array<{
      id: string;
      similarity?: number | null;
    }>) {
      if (
        typeof row.id === "string" &&
        typeof row.similarity === "number" &&
        Number.isFinite(row.similarity)
      ) {
        byId.set(row.id, row.similarity);
      }
    }
  }

  // 4. Match claimed source IDs against RPC results.
  const measured: SemanticMeasuredSource[] = [];
  let unmeasuredCount = 0;

  for (const id of claimedSourceMemoryIds) {
    if (byId.has(id)) {
      measured.push({ id, similarity: byId.get(id) as number });
    } else {
      // Not returned by RPC top-K/floor → similarity = null, unmeasured.
      measured.push({ id, similarity: null });
      unmeasuredCount++;
    }
  }

  // 5. min/mean computed ONLY over non-null measured similarities.
  const sims = measured
    .map((m) => m.similarity)
    .filter((s): s is number => s !== null);

  const minSimilarity = sims.length ? Math.min(...sims) : null;
  const meanSimilarity = sims.length
    ? sims.reduce((a, b) => a + b, 0) / sims.length
    : null;

  return {
    measured,
    minSimilarity,
    meanSimilarity,
    measuredCount: sims.length,
    unmeasuredCount,
  };
}
