import type {
  ImportanceWeights,
  MemoryType,
  RetrievalWeights,
} from "./types";

/** Embedding dimension of nomic-embed-text (Ollama). */
export const EMBEDDING_DIM = 768;

/** Default retrieval candidate count for the vector leg. */
export const RETRIEVAL_TOP_K = 30;

/** Floor for the vector leg; below this similarity a memory is not a candidate. */
export const MIN_SIMILARITY = 0.65;

/** MMR diversity lambda (higher = more relevance, lower = more diversity). */
export const MMR_LAMBDA = 0.7;

/* ------------------------------------------------------------------ */
/* Importance scoring weights (input mix, sums to 1.0)                  */
/* ------------------------------------------------------------------ */
export const IMPORTANCE_WEIGHTS: ImportanceWeights = {
  explicitImportance: 0.35, // extractor's 1..10 scaled to 0..1
  typeWeight: 0.25, // layer priority
  confidence: 0.15, // extractor confidence
  explicitFlag: 0.1, // user asked to remember
  feedbackDelta: 0.1, // accumulated user feedback in [-1, +1]
  novelty: 0.05, // 1 - max similarity to existing memories
};

/** Base type priority used by the typeWeight term. */
export const TYPE_WEIGHTS: Record<MemoryType, number> = {
  identity: 1.0,
  procedural: 0.95,
  reflection: 0.8,
  project: 0.85,
  episodic: 0.7,
  semantic: 0.6,
  conversation: 0.4,
  working: 0.3,
};

/** Default extraction importance (1..10) when the extractor omits it. */
export const DEFAULT_EXTRACTED_IMPORTANCE = 5;

/** Default confidence when the extractor omits it. */
export const DEFAULT_CONFIDENCE = 0.5;

/** Confidence bump applied when evidence corroborates an existing memory. */
export const CONFIDENCE_CORROBORATION_STEP = 0.05;

/** Confidence penalty applied on user correction / contradiction. */
export const CONFIDENCE_CORRECTION_STEP = 0.1;

/* ------------------------------------------------------------------ */
/* Retrieval fusion weights (sums to 1.0)                              */
/* ------------------------------------------------------------------ */
export const RETRIEVAL_WEIGHTS: RetrievalWeights = {
  similarity: 0.5,
  importance: 0.15,
  recency: 0.1,
  confidence: 0.1,
  typeWeight: 0.05,
  usage: 0.05,
  explicit: 0.05,
};

/* ------------------------------------------------------------------ */
/* Lifecycle thresholds                                                */
/* ------------------------------------------------------------------ */
export const PROMOTE_ACTIVE_THRESHOLD = 0.6;
export const DEMOTE_FADING_THRESHOLD = 0.25;
export const ARCHIVE_THRESHOLD = 0.15;
export const DEMOTE_HOLD_DAYS = 30; // effective_score must stay low this long
export const ARCHIVE_GRACE_DAYS = 90; // archived -> deleted grace period
export const PURGE_AFTER_GRACE_DAYS = 30; // deleted -> hard delete tail

export const PROMOTE_USED_COUNT = 3; // times_used >= 3 with conf >= 0.7 promotes
export const PROMOTE_CONFIDENCE = 0.7;
export const IDENTITY_CONFIRM_CONFIDENCE = 0.9;
export const IDENTITY_CORROBORATION_COUNT = 2;

/* ------------------------------------------------------------------ */
/* Duplicate thresholds (cosine similarity)                            */
/* ------------------------------------------------------------------ */
export const DEDUPE_MERGE_THRESHOLD = 0.95; // merge into winner
export const DEDUPE_UPDATE_THRESHOLD = 0.88; // update existing, same type
export const DEDUPE_RELATED_THRESHOLD = 0.8; // keep both + 'related_to' edge
export const CONTRADICTION_SIM_THRESHOLD = 0.8; // reflection contradiction signal

/* ------------------------------------------------------------------ */
/* Decay half-lives (days) per type                                    */
/* ------------------------------------------------------------------ */
export const TYPE_HALF_LIFE_DAYS: Record<MemoryType, number> = {
  identity: 3650, // near-eternal
  procedural: 365,
  reflection: 90,
  project: 180,
  episodic: 14,
  semantic: 180,
  conversation: 30,
  working: 1,
};

/** Shares in effectiveScore = a*importance + b*recency (matches SQL). */
export const EFFECTIVE_SCORE_IMPORTANCE_SHARE = 0.7;
export const EFFECTIVE_SCORE_RECENCY_SHARE = 0.2;
export const EFFECTIVE_SCORE_RECENCY_BASE = 0.2; // recency term when lastUsed is null

/* ------------------------------------------------------------------ */
/* Token budgets (brain prompt sections)                               */
/* ------------------------------------------------------------------ */
export const TOKEN_BUDGETS: Record<MemoryType, number> = {
  identity: 500,
  procedural: 600,
  project: 800,
  working: 300,
  semantic: 800,
  episodic: 400,
  reflection: 300,
  conversation: 0, // handled by the conversation window, not this budget
};

/** Total hard ceiling for the memory sections of the prompt. */
export const TOTAL_MEMORY_TOKEN_CAP = 3700;

/** Conversation window: number of recent turns injected verbatim. */
export const CONVERSATION_WINDOW_TURNS = 20;

/** Model context size we target. */
export const CONTEXT_WINDOW_TOKENS = 8192;

/* ------------------------------------------------------------------ */
/* Reflection triggers                                                 */
/* ------------------------------------------------------------------ */
export const REFLECT_EVERY_N_TURNS = 10;
export const REFLECTION_CORRECTION_MIN_CONFIDENCE = 0.75;

/* ------------------------------------------------------------------ */
/* Always-inject caps (layers injected directly, not via VSM)          */
/* ------------------------------------------------------------------ */
export const INJECT_CAPS: Partial<Record<MemoryType, number>> = {
  identity: 50,
  procedural: 30,
};

/** Resolve the type weight for a memory type (safe default). */
export function typeWeight(memoryType: MemoryType): number {
  return TYPE_WEIGHTS[memoryType] ?? TYPE_WEIGHTS.semantic;
}

/** Resolve the half-life for a memory type (safe default). */
export function halfLifeDays(memoryType: MemoryType): number {
  return TYPE_HALF_LIFE_DAYS[memoryType] ?? TYPE_HALF_LIFE_DAYS.semantic;
}