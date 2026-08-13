import {
  DEFAULT_CONFIDENCE,
  DEFAULT_EXTRACTED_IMPORTANCE,
  EFFECTIVE_SCORE_IMPORTANCE_SHARE,
  EFFECTIVE_SCORE_RECENCY_BASE,
  EFFECTIVE_SCORE_RECENCY_SHARE,
  MMR_LAMBDA,
  RETRIEVAL_WEIGHTS,
  IMPORTANCE_WEIGHTS,
  halfLifeDays,
  typeWeight,
} from "./constants";
import type {
  ExtractedMemory,
  MemoryType,
  RetrievalCandidate,
} from "./types";

/** Clamp a number into [0, 1]. */
export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Clamp into [min, max]; NaN-safe. */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Normalize an extractor importance in 1..10 into 0..1. */
export function normalizeExtractedImportance(raw: number | undefined): number {
  const value = raw ?? DEFAULT_EXTRACTED_IMPORTANCE;
  return clamp(value / 10, 0, 1);
}

/** Days elapsed between two timestamps (non-negative). */
export function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return ms <= 0 ? 0 : ms / 86_400_000;
}

/**
 * Exponential decay factor for a single half-life:
 * factor = e^(-ln(2) * days / halfLife). No decay when lastUsed is null.
 */
export function decayFactor(
  lastUsed: Date | string | null,
  halfLife: number,
  now: Date = new Date()
): number {
  if (!lastUsed) return 1;
  const days = daysBetween(new Date(lastUsed), now);
  if (halfLife <= 0) return 0;
  return Math.exp((-Math.LN2 * days) / halfLife);
}

/**
 * Composite importance for a newly extracted memory (0..1).
 *   importance = 0.35*explicitImportance + 0.25*typeWeight
 *              + 0.15*confidence + 0.10*explicit + 0.10*feedback
 *              + 0.05*novelty
 */
export function importanceScore(input: {
  memoryType: MemoryType;
  extractedImportance?: number;
  confidence?: number;
  explicit?: boolean;
  feedbackDelta?: number;
  novelty?: number;
}): number {
  const {
    memoryType,
    extractedImportance,
    confidence,
    explicit = false,
    feedbackDelta = 0,
    novelty = 0,
  } = input;

  const normalized = normalizeExtractedImportance(extractedImportance);
  const conf = clamp01(confidence ?? DEFAULT_CONFIDENCE);
  const feedback = clamp(feedbackDelta, -1, 1);
  const noveltyNorm = clamp01(novelty); // 1 - maxSim, rarely available at write time

  const score =
    IMPORTANCE_WEIGHTS.explicitImportance * normalized +
    IMPORTANCE_WEIGHTS.typeWeight * typeWeight(memoryType) +
    IMPORTANCE_WEIGHTS.confidence * conf +
    IMPORTANCE_WEIGHTS.explicitFlag * (explicit ? 1 : 0) +
    IMPORTANCE_WEIGHTS.feedbackDelta * ((feedback + 1) / 2) +
    IMPORTANCE_WEIGHTS.novelty * noveltyNorm;

  return clamp01(score);
}
/**
 * Retrieval-time fused score (0..1).
 *   retrieval = 0.50*similarity + 0.15*importance + 0.10*recency
 *             + 0.10*confidence + 0.05*typeWeight + 0.05*usage
 *             + 0.05*explicit
 */
export function retrievalScore(input: {
  similarity: number;
  importance: number;
  confidence: number;
  memoryType: MemoryType;
  timesUsed: number;
  lastUsed: Date | string | null;
  explicitBoost?: boolean;
  now?: Date;
}): number {
  const {
    similarity,
    importance,
    confidence,
    memoryType,
    timesUsed,
    lastUsed,
    explicitBoost = false,
    now = new Date(),
  } = input;

  const halfLife = halfLifeDays(memoryType);
  const recency = decayFactor(lastUsed, halfLife, now);
  const usage = usageFactor(timesUsed);

  const score =
    RETRIEVAL_WEIGHTS.similarity * clamp01(similarity) +
    RETRIEVAL_WEIGHTS.importance * clamp01(importance) +
    RETRIEVAL_WEIGHTS.recency * clamp01(recency) +
    RETRIEVAL_WEIGHTS.confidence * clamp01(confidence) +
    RETRIEVAL_WEIGHTS.typeWeight * typeWeight(memoryType) +
    RETRIEVAL_WEIGHTS.usage * usage +
    RETRIEVAL_WEIGHTS.explicit * (explicitBoost ? 1 : 0);

  return clamp01(score);
}

/**
 * Growth function for the usage term at query time:
 * usage_factor = log1p(timesUsed) / log1p(cap). Saturates at `cap`.
 */
export function usageFactor(timesUsed: number, cap = 11): number {
  return Math.log1p(Math.max(0, timesUsed)) / Math.log1p(cap);
}

/** Score a retrieval candidate using its stored fields. */
export function scoreRetrievalCandidate(
  candidate: RetrievalCandidate,
  now: Date = new Date()
): number {
  return retrievalScore({
    similarity: candidate.similarity,
    importance: candidate.importance,
    confidence: candidate.confidence,
    memoryType: candidate.memoryType,
    timesUsed: candidate.timesUsed,
    lastUsed: candidate.lastUsed,
    now,
  });
}

/**
 * MMR diversity rescore. lambda closer to 1 favors relevance,
 * closer to 0 favors diversity against already-selected items.
 */
export function mmrScore(
  score: number,
  maxSimToSelected: number,
  lambda: number = MMR_LAMBDA
): number {
  return lambda * score - (1 - lambda) * maxSimToSelected;
}

/**
 * Decayed score used for lifecycle decisions and the SQL apply_memory_decay
 * equivalent: effective = 0.7*importance + 0.2*recency(base 0.2 when never used).
 */
export function effectiveScore(
  importance: number,
  lastUsed: Date | string | null,
  halfLife: number,
  now: Date = new Date()
): number {
  const recencyTerm = lastUsed
    ? EFFECTIVE_SCORE_RECENCY_SHARE * decayFactor(lastUsed, halfLife, now)
    : EFFECTIVE_SCORE_RECENCY_BASE;

  const score =
    EFFECTIVE_SCORE_IMPORTANCE_SHARE * clamp01(importance) + recencyTerm;

  return clamp01(score);
}

/** Convenience wrapper using a memory type's configured half-life. */
export function effectiveScoreForType(
  importance: number,
  lastUsed: Date | string | null,
  memoryType: MemoryType,
  now: Date = new Date()
): number {
  return effectiveScore(importance, lastUsed, halfLifeDays(memoryType), now);
}

/** Score a writer candidate at capture time (importance only). */
export function scoreExtractedMemory(candidate: ExtractedMemory): {
  importance: number;
  confidence: number;
} {
  const memoryType = candidate.memoryType ?? "semantic";
  const importance = importanceScore({
    memoryType,
    extractedImportance: candidate.importance,
    confidence: candidate.confidence,
    explicit: candidate.explicit,
  });
  const confidence = clamp01(candidate.confidence ?? DEFAULT_CONFIDENCE);
  return { importance, confidence };
}