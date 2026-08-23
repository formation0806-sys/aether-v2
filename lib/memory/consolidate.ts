import {
  getMemoriesByIds,
  consolidateMemories,
  type ConsolidationRow,
} from "@/lib/repositories/memory.repository";

/**
 * Phase 6-AN consolidation decision module.
 *
 * Pure, decision-only logic plus a fact-equivalence verification gate. It does
 * NOT write to the database itself: writes happen exclusively inside the
 * `consolidate_memories` RPC (migration 0014), which this module invokes after
 * it has (a) chosen a deterministic canonical and (b) re-verified that every
 * merge candidate is the SAME underlying fact as the canonical.
 *
 * The equivalence verifier intentionally mirrors `identity.ts`'s verifier
 * (same frozen model `qwen2.5:3b`, same SAME/DIFFERENT/UNCERTAIN contract) so
 * consolidation cannot merge on similarity alone. `identity.ts` is frozen, so
 * the verifier is re-implemented here rather than imported/extracted.
 */

const CONSOLIDATION_VERIFIER_MODEL = "qwen2.5:3b";

type EquivalenceDecision = "SAME" | "DIFFERENT" | "UNCERTAIN";

export interface ConsolidationMember {
  id: string;
  memoryType: string;
  status: string;
  createdAt: string;
  effectiveScore?: number | null;
  confidence?: number | null;
  timesUsed?: number | null;
  lastUsed?: string | null;
}

export interface ConsolidatePoolInput {
  userId: string;
  memberIds: string[];
}

export interface ConsolidatePoolResult {
  ok: boolean;
  reason?: string;
  canonicalId?: string;
  merged?: string[];
  consolidationId?: string;
  error?: unknown;
}

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : Number.NEGATIVE_INFINITY;

/**
 * Deterministic canonical selection (query-independent). Approved Phase 6-AN
 * contract, exactly:
 *   times_used DESC
 *   -> effective_score DESC
 *   -> confidence DESC
 *   -> id ASC
 * The comparator falls through deterministically so the choice never depends on
 * array order. Null/invalid numbers are treated as NEGATIVE_INFINITY via `num`
 * (so they sort last); the final `id` comparison is the deterministic floor.
 * Unauthorized sort keys (`last_used`, `created_at`) were deliberately removed
 * during the Phase 6-AN contract correction.
 */
export function selectConsolidationCanonical(
  members: ConsolidationMember[]
): string | null {
  if (!members.length) return null;
  const sorted = [...members].sort((a, b) => {
    const tu = num(b.timesUsed) - num(a.timesUsed);
    if (tu !== 0) return tu;

    const es = num(b.effectiveScore) - num(a.effectiveScore);
    if (es !== 0) return es;

    const cf = num(b.confidence) - num(a.confidence);
    if (cf !== 0) return cf;

    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return sorted[0].id;
}

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
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return JSON.parse(text.slice(start, i + 1));
      }
    }
  } catch {
    return null;
  }
  return null;
}

const VALID_EQ = ["SAME", "DIFFERENT", "UNCERTAIN"] as const;
function isEqDecision(v: unknown): v is EquivalenceDecision {
  return typeof v === "string" && (VALID_EQ as readonly string[]).includes(v);
}

/**
 * Ask the local LLM whether `candidate` is the SAME underlying fact as `keep`.
 * Any error / malformed / UNCERTAIN -> UNCERTAIN (fail-safe; the orchestrator
 * aborts the whole consolidation on non-SAME).
 */
async function verifySameFact(
  keep: { title: string; content: string; memoryType: string },
  candidate: { title: string; content: string; memoryType: string }
): Promise<EquivalenceDecision> {
  const system =
    "You are a fact-equivalence classifier for a long-term memory system. " +
    "Decide whether the CANDIDATE MEMORY records the SAME underlying fact as " +
    "the KEEP MEMORY. " +
    "SAME = the candidate already records this fact, even if worded differently. " +
    "DIFFERENT = different subject, different value, contradiction, temporal shift, " +
    "preference vs current usage, different entity, different scope, or only a " +
    "related-but-not-identical topic. " +
    "UNCERTAIN = you cannot be confident. " +
    "Be very conservative. When in doubt choose DIFFERENT or UNCERTAIN. " +
    "Never merge merely because the topic is similar. " +
    "Return ONLY strict JSON: {\"decision\":\"SAME\",\"reason\":\"...\"}";

  const user =
    "KEEP MEMORY\n" +
    `title: ${keep.title}\n` +
    `content: ${keep.content}\n` +
    `memory_type: ${keep.memoryType}\n\n` +
    "CANDIDATE MEMORY\n" +
    `title: ${candidate.title}\n` +
    `content: ${candidate.content}\n` +
    `memory_type: ${candidate.memoryType}\n\n` +
    "JSON only:";

  try {
    const res = await fetch("http://127.0.0.1:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: CONSOLIDATION_VERIFIER_MODEL,
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
    if (isEqDecision(parsed?.decision)) return parsed!.decision;
    return "UNCERTAIN";
  } catch {
    return "UNCERTAIN";
  }
}

/**
 * Orchestrate a consolidation for an explicit pool of memory ids.
 *
 * Steps: load rows -> reject mixed memory_type -> pick deterministic canonical
 * -> re-verify fact-equivalence of every merge candidate against the canonical
 * (fail-safe abort on any DIFFERENT/UNCERTAIN) -> invoke the atomic RPC.
 *
 * This function performs NO database writes itself; the only write path is the
 * `consolidate_memories` RPC. It must NEVER be pointed at rows that should stay
 * untouched — the caller (an explicit, human-approved operation) supplies the
 * pool.
 */
export async function consolidateMemoryPool(
  input: ConsolidatePoolInput
): Promise<ConsolidatePoolResult> {
  const uniqueIds = Array.from(new Set(input.memberIds));
  if (uniqueIds.length < 2) {
    return { ok: false, reason: "need_at_least_two_members" };
  }

  const rows: ConsolidationRow[] = await getMemoriesByIds(
    input.userId,
    uniqueIds
  );
  if (rows.length !== uniqueIds.length) {
    return { ok: false, reason: "member_not_found" };
  }

  // Cross-type / mixed-type guard: refuse to merge across memory types.
  const types = new Set(rows.map((r) => r.memoryType));
  if (types.size > 1) {
    return { ok: false, reason: "mixed_memory_type" };
  }

  const canonicalId = selectConsolidationCanonical(rows);
  if (!canonicalId) return { ok: false, reason: "no_canonical" };

  const keep = rows.find((r) => r.id === canonicalId)!;
  const mergeRows = rows.filter((r) => r.id !== canonicalId);

  // Fact-equivalence gate (fail-safe: any non-SAME aborts the whole batch).
  for (const m of mergeRows) {
    const decision = await verifySameFact(
      { title: keep.title, content: keep.content, memoryType: keep.memoryType },
      { title: m.title, content: m.content, memoryType: m.memoryType }
    );
    if (decision !== "SAME") {
      return {
        ok: false,
        reason: `non_same_member:${m.id}:${decision}`,
      };
    }
  }

  const rpc = await consolidateMemories({
    userId: input.userId,
    keepId: canonicalId,
    mergeIds: mergeRows.map((r) => r.id),
  });
  if (!rpc.ok) {
    return { ok: false, reason: rpc.reason ?? "rpc_error", error: rpc.error };
  }
  return {
    ok: true,
    canonicalId: rpc.canonicalId,
    merged: rpc.merged,
    consolidationId: rpc.consolidationId,
  };
}
