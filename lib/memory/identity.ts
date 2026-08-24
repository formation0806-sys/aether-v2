import { matchMemoriesV2 } from "@/lib/repositories/memory.repository";
import { embed } from "@/lib/ai/embeddings/embed";
import type { MemoryType } from "@/lib/memory/types";

/**
 * Option D: hybrid semantic identity recognition.
 *
 * This module is an ADDITIVE safety layer on top of the proven exact-match fast
 * path in `saveMemory`. It only runs when:
 *   - the exact title+content fast path did NOT match, AND
 *   - there is a fresh user observation (observationId present, source !== reflection).
 *
 * It never writes `confidence_v2` directly. The caller corroborates via the
 * existing `corroborateMemory` RPC, so exactly-once / +0.05 semantics are
 * structurally preserved regardless of how this layer behaves.
 */

export type MemoryIdentityDecision =
  | { decision: "corroborate"; targetId: string; reason: string }
  | { decision: "create"; reason: string };

/**
 * Conservative candidate-generation thresholds. These are NOT identity proof:
 * they only narrow the field for the LLM verifier. Retrieval (0.65) is
 * intentionally broader; identity requires a much stricter match.
 */
const IDENTITY_CANDIDATE_MIN_SIMILARITY = 0.85;
const IDENTITY_CANDIDATE_COUNT = 8;

const VALID_DECISIONS = ["SAME", "DIFFERENT", "UNCERTAIN"] as const;
type IdentityVerifyDecision = (typeof VALID_DECISIONS)[number];

interface IdentityCandidate {
  id: string;
  title: string;
  content: string;
  memory_type: string;
  status: string;
  similarity: number;
  // Present on live match_memories_v2 rows (migration 0009 aliases).
  // Used ONLY for deterministic canonical tie-breaking; never mutated.
  effective_score?: number | null;
  confidence?: number | null;
  times_used?: number | null;
  last_used?: string | null;
}

export interface ResolveMemoryIdentityInput {
  userId: string;
  title: string;
  content: string;
  memoryType: MemoryType;
  /**
   * Experimental override of the identity-candidate similarity floor.
   * Omitted by production callers (core/pipeline.ts), so the production
   * default IDENTITY_CANDIDATE_MIN_SIMILARITY (0.85) is byte-for-byte unchanged.
   */
  candidateMinSimilarity?: number;
}

const IDENTITY_VERIFIER_MODEL = "qwen2.5:3b";

/** Extract the first valid JSON object from a model response (tolerant of preamble). */
function extractJsonObject(text: string): Record<string, unknown> | null {
  try {
    const start = text.indexOf("{");
    if (start === -1) return null;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) {
          esc = false;
        } else if (ch === "\\") {
          esc = true;
        } else if (ch === '"') {
          inStr = false;
        }
        continue;
      }
      if (ch === '"') {
        inStr = true;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) return JSON.parse(text.slice(start, i + 1));
      }
    }
  } catch {
    return null;
  }
  return null;
}

function isValidDecision(value: unknown): value is IdentityVerifyDecision {
  return typeof value === "string" && VALID_DECISIONS.includes(value as IdentityVerifyDecision);
}

// Internal helpers/constants for semantic identity (not part of public surface).


/**
 * Ask the local LLM whether the new observation is the SAME underlying fact as
 * one candidate memory. Any error/timeout/malformed output -> UNCERTAIN
 * (which the caller treats as "create", preserving fail-safety).
 */
async function verifyIdentity(
  newMem: { title: string; content: string; memoryType: string },
  candidate: IdentityCandidate
): Promise<IdentityVerifyDecision> {
  const system =
    "You are an identity-resolution classifier for a long-term memory system. " +
    "Decide whether the NEW OBSERVATION refers to the SAME underlying memory fact " +
    "as the EXISTING CANDIDATE MEMORY. " +
    "SAME = the candidate already records this fact, even if worded differently. " +
    "DIFFERENT = different subject, different value, contradiction, temporal shift " +
    "(e.g. 'used to' vs 'currently'), preference vs current usage (e.g. 'I prefer TypeScript' vs 'I use TypeScript'), different entity (brother vs friend), " +
    "different scope, or only a related-but-not-identical topic " +
    "(e.g. 'I like tea' vs 'I prefer mild tea'). " +
    "UNCERTAIN = you cannot be confident. " +
    "Be very conservative. When in doubt choose DIFFERENT or UNCERTAIN. " +
    "Never merge merely because the topic is similar. " +
    "Return ONLY strict JSON: {\"decision\":\"SAME\",\"reason\":\"...\"}";

  const user =
    "NEW OBSERVATION\n" +
    `title: ${newMem.title}\n` +
    `content: ${newMem.content}\n` +
    `memory_type: ${newMem.memoryType}\n\n` +
    "EXISTING CANDIDATE MEMORY\n" +
    `title: ${candidate.title}\n` +
    `content: ${candidate.content}\n` +
    `memory_type: ${candidate.memory_type}\n` +
    `similarity: ${candidate.similarity.toFixed(3)}\n\n` +
    "JSON only:";

  const res = await fetch("http://127.0.0.1:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: IDENTITY_VERIFIER_MODEL,
      stream: false,
      options: { temperature: 0, num_predict: 256, top_p: 0.9 },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) return "UNCERTAIN";
  const data: unknown = await res.json().catch(() => null);
  const text =
    (data &&
      typeof data === "object" &&
      "message" in data &&
      (data as { message?: { content?: unknown } }).message?.content) ||
    "";
  const textStr = typeof text === "string" ? text.trim() : "";
  if (!textStr) return "UNCERTAIN";

    const parsed = extractJsonObject(textStr);
  if (isValidDecision(parsed?.decision)) return parsed!.decision as IdentityVerifyDecision;
  return "UNCERTAIN";
}

/**
 * Resolve whether a newly extracted memory is the same fact as an existing one.
 *
 * Reuses the LIVE `match_memories_v2` RPC + nomic-embed-text embeddings (no new
 * RPC, no new index, no schema change). Decision rules:
 *   - candidates verified in deterministic order until the pool is exhausted
 *     or the pattern becomes non-clean
 *   - clean all-SAME pool of ONE   -> corroborate that memory
 *   - clean all-SAME pool of >1    -> duplicate representation: corroborate
 *                                     exactly ONE canonical candidate chosen by
 *                                     total order (similarity DESC,
 *                                     effective_score DESC, confidence DESC,
 *                                     id ASC); caller invokes corroborate_memory
 *   - any DIFFERENT / UNCERTAIN    -> non-clean pattern -> create (fail-safe)
 *   - any failure                  -> create (fail-safe)
 *
 * At most one corroboration target is ever returned per observation. This module
 * remains a decision layer: it performs no writes itself.
 */
export async function resolveMemoryIdentity(
  input: ResolveMemoryIdentityInput
): Promise<MemoryIdentityDecision> {
  const { userId, title, content, memoryType } = input;

  // Embed the new observation's content via the live embedding model.
  let vector: { embedding: number[] } | null = null;
  try {
    vector = await embed(content);
  } catch (e) {
    console.error("MEMORY IDENTITY EMBED FAILED", (e as Error)?.message);
    return { decision: "create", reason: "embedding failed" };
  }
  if (!vector?.embedding?.length) {
    return { decision: "create", reason: "no embedding" };
  }

  // Semantic candidate search via the live match_memories_v2 RPC.
  let rows: IdentityCandidate[] = [];
  try {
    const { data, error } = await matchMemoriesV2(vector.embedding, userId, {
      minSimilarity: input.candidateMinSimilarity ?? IDENTITY_CANDIDATE_MIN_SIMILARITY,
      matchCount: IDENTITY_CANDIDATE_COUNT,
    });
    if (error) {
      console.error("MEMORY IDENTITY RPC FAILED", error);
      return { decision: "create", reason: "rpc failed" };
    }
    // Malformed/non-array RPC results are treated as an empty pool so the
    // resolver falls through to the fail-safe create path.
    rows = Array.isArray(data) ? (data as IdentityCandidate[]) : [];
  } catch (e) {
    console.error("MEMORY IDENTITY SEARCH FAILED", (e as Error)?.message);
    return { decision: "create", reason: "search failed" };
  }

  console.log(
    "MEMORY IDENTITY CANDIDATES",
    rows.length,
    rows.map((r) => ({
      id: r?.id ?? null,
      type: r?.memory_type ?? null,
      status: r?.status ?? null,
      sim: r?.similarity ?? null,
    }))
  );

    if (rows.length === 0) {
    return { decision: "create", reason: "no semantic candidates" };
  }

  // NOTE: we do NOT hard-filter by memory_type here. The LLM verifier is the
  // identity gate and is given memory_type as context, so it can refuse to merge
  // genuinely different kinds (e.g. identity "my name" vs episodic "met a prince").
  // A hard type filter would block legitimate paraphrase recognition when the
  // (non-deterministic) extractor assigns different types to the same fact.
  // Safety still comes from: strict candidate threshold, the verifier, and the
  // clean-pattern requirement below.

  // Deterministic total ordering over the candidate pool:
  //   similarity DESC -> effective_score DESC -> confidence DESC -> id ASC.
  // Missing/non-finite numerics sort lowest; the unique id guarantees totality,
  // so the order never depends on the array order returned by the RPC.
  const num = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) ? v : Number.NEGATIVE_INFINITY;
  let malformedPool = false;
  const ordered = [...rows].sort((a, b) => {
    if (!a || !b || typeof a.id !== "string" || typeof b.id !== "string") {
      malformedPool = true;
      return 0;
    }
    const ka = [num(a.similarity), num(a.effective_score), num(a.confidence)];
    const kb = [num(b.similarity), num(b.effective_score), num(b.confidence)];
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i]) return kb[i] - ka[i];
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  if (malformedPool) {
    // Invalid candidate shape: fail-safe create (never throw past this layer).
    return { decision: "create", reason: "search failed" };
  }

  console.log("MEMORY IDENTITY VERIFY CANDIDATES", ordered.length);

  // Verify candidates in canonical order until the pool is exhausted or the
  // pattern becomes non-clean. Phase 6-AK.1 measured that duplicate pools
  // produce a clean all-SAME pattern (20/20 SAME, 10/10 stable pairs); any
  // DIFFERENT/UNCERTAIN is treated as genuine ambiguity and falls back to the
  // fail-safe create. At most ONE corroboration target is ever returned.
  let verified = 0;
  let sameCount = 0;

  for (const cand of ordered) {
    if (!cand || typeof cand.id !== "string") {
      return { decision: "create", reason: "search failed" };
    }
    let decision: IdentityVerifyDecision;
    try {
      console.log(
        "MEMORY IDENTITY VERIFY",
        cand.id,
        "sim",
        Number.isFinite(cand.similarity) ? cand.similarity.toFixed(3) : String(cand.similarity)
      );
      decision = await verifyIdentity(
        { title, content, memoryType },
        cand
      );
    } catch (e) {
      console.error("MEMORY IDENTITY VERIFY FAILED", (e as Error)?.message);
      decision = "UNCERTAIN";
    }
    console.log("MEMORY IDENTITY VERIFY RESULT", cand.id, decision);

    verified += 1;
    if (decision !== "SAME") {
      // Non-clean pattern (DIFFERENT or UNCERTAIN present among verified
      // candidates): ambiguous -> fail-safe create. Never corroborate on
      // mixed signals. Early exit: remaining candidates cannot change the
      // outcome.
      console.warn(
        "MEMORY IDENTITY NON-CLEAN PATTERN:",
        decision,
        "after",
        verified,
        "verified candidate(s) -> create"
      );
      return { decision: "create", reason: "non-clean verifier pattern; fail-safe" };
    }
    sameCount += 1;
  }

  if (ordered.length === 1 && sameCount === 1 && ordered[0]) {
    return {
      decision: "corroborate",
      targetId: ordered[0].id,
      reason: `verified SAME (similarity ${
        Number.isFinite(ordered[0].similarity)
          ? ordered[0].similarity.toFixed(3)
          : String(ordered[0].similarity)
      })`,
    };
  }

  // Clean multi-SAME pool: every verified candidate is SAME. Per Phase 6-AJ +
  // 6-AK.1 this represents DUPLICATE REPRESENTATION of one underlying fact
  // rather than ambiguity. Corroborate exactly ONE deterministic canonical
  // candidate (total order above); never more than one target is returned.
  const canonical = ordered[0];
  return {
    decision: "corroborate",
    targetId: canonical.id,
    reason: `verified duplicate representations (${sameCount} SAME candidates); corroborated canonical candidate`,
  };
}

