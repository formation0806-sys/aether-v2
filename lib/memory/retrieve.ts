import { createClient } from "@/lib/supabase/server";
import * as memoryRepository from "@/lib/repositories/memory.repository";
import { embed } from "@/lib/ai/embeddings/embed";
import {
  isIdentityRetrievalQuery,
  resolveRetrievalQuery,
} from "@/lib/memory/queryRewrite";
import { scoreRetrievalCandidate, mmrScore } from "@/lib/memory/score";
import {
  RETRIEVAL_TOP_K,
  MIN_SIMILARITY,
  MMR_LAMBDA,
  TOTAL_MEMORY_TOKEN_CAP,
  TOKEN_BUDGETS,
} from "@/lib/memory/constants";
import type { MemoryType, RetrievalCandidate } from "@/lib/memory/types";

/** Approximate token count for a chunk of text (~4 chars/token). */
function approxTokens(text: string | null | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/** Rough token footprint of a retrieved memory (title + content + summary). */
function memoryTokenCount(memory: RetrievalCandidate): number {
  return (
    approxTokens(memory.title) +
    approxTokens(memory.content) +
    approxTokens(memory.summary)
  );
}

/** Cosine similarity between two equal-length vectors. */
function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** Row shape returned by the `match_memories_v2` RPC. */
interface MemoryV2Row {
  id: string;
  title: string;
  content: string;
  summary: string;
  tags: string[] | null;
  memory_type: MemoryType;
  importance: number;
  confidence: number;
  similarity: number;
  effective_score: number;
  times_used: number;
  last_used: string | null;
}

interface MemoryEmbeddingRow {
  id: string;
  embedding: number[] | null;
}

/** Row shape returned by the deterministic identity SELECT. */
interface IdentityMemoryRow {
  id: string;
  title: string;
  content: string;
  summary: string | null;
  tags: string[] | null;
  memory_type: MemoryType;
  status: string;
  importance_v2: number | null;
  confidence_v2: number | null;
  effective_score: number | null;
  times_used: number | null;
  last_used: string | null;
}

/**
 * Deterministic identity-layer fetch for identity-scoped questions.
 *
 * Runs ONLY when `isIdentityRetrievalQuery(query)` is true. Reads the
 * caller's own `active` identity rows directly (no embedding, no similarity
 * floor) and maps them into `RetrievalCandidate`s. Failures degrade to `[]`
 * so normal vector retrieval is never blocked. The repository query is
 * user-scoped (`user_id = userId`); RLS scoping is preserved.
 */
async function fetchIdentityCandidates(
  userId: string,
  query: string
): Promise<RetrievalCandidate[]> {
  if (!isIdentityRetrievalQuery(query)) return [];
  try {
    const { data, error } = await memoryRepository.getActiveIdentityMemories(userId);
    if (error || !data) {
      if (error) {
        console.warn("retrieveMemories: identity fetch failed; continuing with vector results", error);
      }
      return [];
    }
    return (data as IdentityMemoryRow[])
      .filter((row) => row && typeof row.id === "string")
      .map((row) => ({
        id: row.id,
        title: row.title ?? "",
        content: row.content ?? "",
        summary: row.summary ?? "",
        tags: row.tags ?? [],
        memoryType: (row.memory_type ?? "identity") as MemoryType,
        // Deterministic leg: not a vector cosine. Set to the production floor
        // so downstream fused scoring/ordering treats it as a legitimate
        // candidate without inventing a similarity measurement.
        similarity: MIN_SIMILARITY,
        importance: typeof row.importance_v2 === "number" ? row.importance_v2 : 0.5,
        confidence: typeof row.confidence_v2 === "number" ? row.confidence_v2 : 0.5,
        effectiveScore: typeof row.effective_score === "number" ? row.effective_score : 0,
        timesUsed: typeof row.times_used === "number" ? row.times_used : 0,
        lastUsed: row.last_used ?? null,
      }));
  } catch (error) {
    console.warn("retrieveMemories: identity fetch threw; continuing with vector results", error);
    return [];
  }
}

interface ScoredCandidate {
  candidate: RetrievalCandidate;
  relevance: number;
}

/**
 * Greedily select memories from `ordered` (MMR-ranked) without exceeding the
 * global `TOTAL_MEMORY_TOKEN_CAP` budget or the per-type `TOKEN_BUDGETS`.
 */
function selectWithinTokenBudget(ordered: RetrievalCandidate[]): RetrievalCandidate[] {
  const selected: RetrievalCandidate[] = [];
  let used = 0;
  const usedByType: Partial<Record<MemoryType, number>> = {};

  for (const memory of ordered) {
    const tokens = memoryTokenCount(memory);
    if (tokens <= 0) continue;

    const typeBudget = TOKEN_BUDGETS[memory.memoryType] ?? 0;
    const usedInType = usedByType[memory.memoryType] ?? 0;
    if (usedInType + tokens > typeBudget) continue;
    if (used + tokens > TOTAL_MEMORY_TOKEN_CAP) continue;

    selected.push(memory);
    used += tokens;
    usedByType[memory.memoryType] = usedInType + tokens;
  }

  return selected;
}

/**
 * Memory V2 retriever.
 *
 * Pipeline:
 *   1. Embed the query.
 *   2. Retrieve via the `match_memories_v2` RPC (replaces legacy matchMemories).
 *   3. Score each candidate with `scoreRetrievalCandidate` (fusion of
 *      similarity / importance / recency / confidence / typeWeight / usage).
 *   4. Sort by `effectiveScore` (lifecycle priority).
 *   5. Re-rank with MMR (`mmrScore`) for relevance-vs-diversity, using the
 *      candidates' embeddings for pairwise cosine similarity.
 *   6. Greedily select within the token budget (`TOTAL_MEMORY_TOKEN_CAP` +
 *      per-type `TOKEN_BUDGETS`).
 *   7. Bump usage for the surfaced memories via the batched `touch_memories` RPC.
 *
 * Public API unchanged: `retrieveMemories(userId, query)` returns the surfaced
 * memory objects; callers (e.g. lib/context/builder.ts) are unaffected.
 */
export async function retrieveMemories(
  userId: string,
  query: string
) {
  const supabase = await createClient();
  // Approved M2-D R1: precision-gated declarative rewrite of the retrieval
  // embedding input ONLY. The original `query` is preserved everywhere else.
  const retrievalQuery = resolveRetrievalQuery(query);
  const vector = await embed(retrievalQuery);

  // 1-2: V2 retrieval RPC (replaces legacy matchMemories).
  const tRetrievalStart = performance.now();
  const { data: rows, error } = await memoryRepository.matchMemoriesV2(vector.embedding, userId, {
    matchCount: RETRIEVAL_TOP_K,
    minSimilarity: MIN_SIMILARITY,
  });

  console.log(
    "RETRIEVAL match_memories_v2_ms=" +
      (performance.now() - tRetrievalStart).toFixed(2)
  );

  if (error) throw error;

  const candidates: RetrievalCandidate[] = (rows ?? []).map((row: MemoryV2Row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    summary: row.summary,
    tags: row.tags ?? [],
    memoryType: row.memory_type,
    similarity: row.similarity,
    importance: row.importance,
    confidence: row.confidence,
    effectiveScore: row.effective_score,
    timesUsed: row.times_used,
    lastUsed: row.last_used,
  }));

  // Deterministic identity leg (SALPA identity-recall fix): for gated
  // identity-scoped questions, union the caller's own active identity rows
  // with the vector candidates. Dedupe by id (vector leg wins on overlap so
  // measured cosine is preserved). Global MIN_SIMILARITY, embedding model,
  // and scoring semantics are unchanged; non-identity queries are untouched.
  const identityCandidates = await fetchIdentityCandidates(userId, query);
  if (identityCandidates.length > 0) {
    const seen = new Set(candidates.map((c) => c.id));
    for (const identity of identityCandidates) {
      if (!seen.has(identity.id)) {
        candidates.push(identity);
        seen.add(identity.id);
      }
    }
  }

  if (candidates.length === 0) return [];

  // 3: fused retrieval score via the shared scoring module.
  const scored: ScoredCandidate[] = candidates.map((candidate) => ({
    candidate,
    relevance: scoreRetrievalCandidate(candidate),
  }));

  // 4: effectiveScore sort (lifecycle priority: importance * recency weighting).
  scored.sort((a, b) => b.candidate.effectiveScore - a.candidate.effectiveScore);

  // 5: MMR reranking with pairwise cosine similarity from embeddings.
  const ids = candidates.map((c) => c.id);
  const { data: embData, error: embError } = await supabase
    .from("memories")
    .select("id,embedding")
    .in("id", ids)
    .eq("user_id", userId);

  const embeddings = new Map<string, number[]>();
  if (embError) {
    // Non-fatal: MMR degrades to relevance-only ranking without embeddings.
    console.warn(
      "retrieveMemories: embedding fetch failed; falling back to relevance order",
      embError
    );
  } else {
    for (const row of (embData ?? []) as MemoryEmbeddingRow[]) {
      if (row.id && Array.isArray(row.embedding) && row.embedding.length > 0) {
        embeddings.set(row.id, row.embedding);
      }
    }
  }

  const ranked: RetrievalCandidate[] = [];
  const pool: ScoredCandidate[] = [...scored];

  while (ranked.length < candidates.length && pool.length > 0) {
    let bestIdx = 0;
    let bestMmr = -Infinity;

    for (let i = 0; i < pool.length; i++) {
      const entry = pool[i];
      const emb = embeddings.get(entry.candidate.id);
      let maxSimToSelected = 0;
      if (emb) {
        for (const sel of ranked) {
          const selEmb = embeddings.get(sel.id);
          if (selEmb) {
            const sim = cosine(emb, selEmb);
            if (sim > maxSimToSelected) maxSimToSelected = sim;
          }
        }
      }
      const mmr = mmrScore(entry.relevance, maxSimToSelected, MMR_LAMBDA);
      if (mmr > bestMmr) {
        bestMmr = mmr;
        bestIdx = i;
      }
    }

    ranked.push(pool.splice(bestIdx, 1)[0].candidate);
  }

  // 6: enforce the token budget across the MMR-ranked list.
  const surfaced = selectWithinTokenBudget(ranked);

  // 7: bump usage for the memories actually surfaced to the prompt.
  if (surfaced.length > 0) {
    await memoryRepository.touchMemories(userId, surfaced.map((m) => m.id));
  }

  console.log(
    "RETRIEVAL_POSTPROCESS retrieval_ms=" +
      (performance.now() - tRetrievalStart).toFixed(2)
  );

  return surfaced;
}