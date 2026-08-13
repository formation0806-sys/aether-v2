export type MemoryType =
  | "semantic"
  | "identity"
  | "procedural"
  | "project"
  | "episodic"
  | "reflection"
  | "conversation"
  | "working";

export type MemoryStatus =
  | "candidate"
  | "active"
  | "fading"
  | "archived"
  | "deleted";

export type MemorySource =
  | "user"
  | "assistant"
  | "system"
  | "extractor"
  | "reflection"
  | "consolidation"
  | "import"
  | "merge";

export const MEMORY_TYPES: readonly MemoryType[] = [
  "semantic",
  "identity",
  "procedural",
  "project",
  "episodic",
  "reflection",
  "conversation",
  "working",
];

export const MEMORY_STATUSES: readonly MemoryStatus[] = [
  "candidate",
  "active",
  "fading",
  "archived",
  "deleted",
];

export const MEMORY_SOURCES: readonly MemorySource[] = [
  "user",
  "assistant",
  "system",
  "extractor",
  "reflection",
  "consolidation",
  "import",
  "merge",
];

/** The canonical Memory V2 record (DB row contract). */
export interface MemoryRecord {
  id: string;
  userId: string;
  projectId: string | null;

  memoryType: MemoryType;
  status: MemoryStatus;

  title: string;
  content: string;
  summary: string;
  tags: string[];

  importance: number; // 0..1 composite
  confidence: number; // 0..1
  embedding: number[] | null; // vector(768)

  source: MemorySource;
  sourceRef: string | null;
  metadata: Record<string, unknown>;

  timesUsed: number;
  lastUsed: string | null;
  lastScored: string;
  effectiveScore: number;

  createdAt: string;
  updatedAt: string;
}

/** Raw DB row (snake_case as returned by Supabase). */
export interface MemoryRow {
  id: string;
  user_id: string;
  project_id: string | null;
  memory_type: MemoryType;
  status: MemoryStatus;
  title: string;
  content: string;
  summary: string;
  tags: string[] | null;
  importance: number | null;
  confidence: number | null;
  embedding: number[] | null;
  source: MemorySource | null;
  source_ref: string | null;
  metadata: Record<string, unknown> | null;
  times_used: number | null;
  last_used: string | null;
  last_scored: string | null;
  effective_score: number | null;
  created_at: string;
  updated_at: string;
}

/** Candidate extracted from a conversation turn by the writer. */
export interface ExtractedMemory {
  title: string;
  content: string;
  summary?: string;
  memoryType?: MemoryType;
  importance?: number; // 1..10 raw
  confidence?: number; // 0..1
  explicit?: boolean;
  tags?: string[];
  projectRef?: string | null;
}

/** A single retrieval candidate with its fused score. */
export interface RetrievalCandidate {
  id: string;
  title: string;
  content: string;
  summary: string;
  tags: string[];
  memoryType: MemoryType;
  similarity: number; // semantic leg cosine
  importance: number;
  confidence: number;
  effectiveScore: number;
  timesUsed: number;
  lastUsed: string | null;
}

/** Per-candidate attribution for the /memory debug UI. */
export interface RetrievalTraceItem {
  memoryId: string;
  sourceLeg: "vector" | "keyword" | "inject";
  similarity: number;
  fusedScore: number;
}

/** Weights for composite importance scoring. */
export interface ImportanceWeights {
  explicitImportance: number;
  typeWeight: number;
  confidence: number;
  explicitFlag: number;
  feedbackDelta: number;
  novelty: number;
}

/** Weights for retrieval-time fusion. */
export interface RetrievalWeights {
  similarity: number;
  importance: number;
  recency: number;
  confidence: number;
  typeWeight: number;
  usage: number;
  explicit: number;
}