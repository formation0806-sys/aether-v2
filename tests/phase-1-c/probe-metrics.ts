/**
 * Phase 1-C Step 1 — measurement metrics (part 1: parser/sanitizer/classifier).
 *
 * Pure helpers. Mirrors of production parser and sanitizer (Phase 6
 * convention: production functions are not exported for testing, so replicas
 * are used and unit-tested against known cases).
 * NOTHING in this file writes to the database or mutates state.
 */

/* -------------------------- parser mirror (1-B) ------------------------ */

export function extractFirstBalancedArray(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const unfenced = (fence ? fence[1] : trimmed).trim();
  const start = unfenced.indexOf("[");
  if (start === -1) return "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < unfenced.length; i += 1) {
    const ch = unfenced[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) return unfenced.slice(start, i + 1);
    }
  }
  return "";
}

export interface ParseOutcome {
  items: unknown[];
  arrayText: string;
  parseError: string | null;
}

export function parseMirror(raw: string): ParseOutcome {
  const arrayText = extractFirstBalancedArray((raw ?? "").trim());
  if (!arrayText) {
    return { items: [], arrayText: "", parseError: "no_json_array_found" };
  }
  try {
    const parsed: unknown = JSON.parse(arrayText);
    if (!Array.isArray(parsed)) {
      return { items: [], arrayText, parseError: "root_not_array" };
    }
    return { items: parsed, arrayText, parseError: null };
  } catch {
    return { items: [], arrayText, parseError: "parse_failed" };
  }
}

/* ------------------------- sanitizer mirror ---------------------------- */

export interface SanitizedMemory {
  title: string;
  content: string;
  memoryType: "reflection";
  importance?: number;
  confidence?: number;
}

export interface SanitizeOutcome {
  memory: SanitizedMemory | null;
  rejected: string | null;
  importanceIgnored: boolean;
  confidenceIgnored: boolean;
}

export function sanitizeMirror(item: unknown): SanitizeOutcome {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    return {
      memory: null,
      rejected: "not_object",
      importanceIgnored: false,
      confidenceIgnored: false,
    };
  }
  const r = item as Record<string, unknown>;
  if (typeof r.title !== "string" || !r.title.trim()) {
    return {
      memory: null,
      rejected: "missing_title",
      importanceIgnored: false,
      confidenceIgnored: false,
    };
  }
  if (typeof r.content !== "string" || !r.content.trim()) {
    return {
      memory: null,
      rejected: "missing_content",
      importanceIgnored: false,
      confidenceIgnored: false,
    };
  }
  const memory: SanitizedMemory = {
    title: r.title.trim(),
    content: r.content.trim(),
    memoryType: "reflection",
  };
  const importanceValid =
    typeof r.importance === "number" &&
    Number.isInteger(r.importance) &&
    r.importance >= 1 &&
    r.importance <= 10;
  const importanceIgnored = r.importance !== undefined && !importanceValid;
  if (importanceValid) memory.importance = r.importance as number;
  const confidenceValid =
    typeof r.confidence === "number" && r.confidence >= 0 && r.confidence <= 1;
  const confidenceIgnored = r.confidence !== undefined && !confidenceValid;
  if (confidenceValid) memory.confidence = r.confidence as number;
  return { memory, rejected: null, importanceIgnored, confidenceIgnored };
}

/* --------------------------- format classifier ------------------------- */

export type FormatClass =
  | "empty_output"
  | "clean_array"
  | "fenced_array"
  | "preamble_array"
  | "preamble_brackets"
  | "truncated"
  | "malformed"
  | "non_array_root"
  | "genuine_empty";

/**
 * Truncation heuristic: num_predict 300 tokens at ~3.5 chars/token ≈ 1050
 * chars; an unbalanced output at/above 1000 chars is classified truncated.
 */
export const TRUNCATION_LENGTH_FLOOR = 1000;

export function classifyFormat(raw: string): FormatClass {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "empty_output";
  const arrayText = extractFirstBalancedArray(trimmed);
  if (!arrayText) {
    // No balanced array: an object root is distinguishable from garbage.
    try {
      const direct: unknown = JSON.parse(trimmed);
      if (direct && typeof direct === "object") return "non_array_root";
    } catch {
      /* fall through */
    }
    if (trimmed.length >= TRUNCATION_LENGTH_FLOOR) return "truncated";
    return "malformed";
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(arrayText);
  } catch {
    return "malformed";
  }
  if (!Array.isArray(parsed)) return "non_array_root";
  // Wrong-group symptom: the grabbed bracket group contains no objects at all
  // (e.g. a preamble "[1]" or "[note]" that parses) — the real array, if any,
  // came later and was shadowed by first-bracket extraction.
  const hasObjectItem = parsed.some(
    (it) => typeof it === "object" && it !== null
  );
  if (parsed.length > 0 && !hasObjectItem) return "preamble_brackets";
  if (parsed.length === 0) return "genuine_empty";
  const fenced = /^```/.test(trimmed);
  const firstBracket = trimmed.indexOf("[");
  const before = trimmed.slice(0, firstBracket);
  if (fenced) return "fenced_array";
  if (before.includes("[")) return "preamble_brackets";
  if (before.trim().length > 0) return "preamble_array";
  return "clean_array";
}

/* ------------------------------ lenses --------------------------------- */

export function tokenJaccard(a: string, b: string): number {
  const tok = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 2)
    );
  const A = tok(a);
  const B = tok(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  const union = A.size + B.size - inter;
  return union === 0 ? 1 : inter / union;
}

/** Measurement heuristic ONLY — mirrors the prompt's RULE 11 vagueness examples. */
export const GENERIC_PHRASES = [
  "the user has many interests",
  "focused on development",
  "works on projects",
  "the user is focused on development",
];

export function isGenericReflection(content: string): boolean {
  const c = content.trim().toLowerCase();
  if (c.length < 60) return true;
  return GENERIC_PHRASES.some((p) => c.includes(p));
}

export const DUPLICATE_JACCARD_LENS = 0.6;

/* -------------------------- model wrappers ----------------------------- */

import type { SupabaseClient } from "@supabase/supabase-js";

export async function ollamaChat(
  ollamaUrl: string,
  model: string,
  options: Record<string, unknown>,
  messages: Array<{ role: string; content: string }>
): Promise<{ status: number; raw: string; latencyMs: number }> {
  const started = Date.now();
  const res = await fetch(`${ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, stream: false, options, messages }),
  });
  const latencyMs = Date.now() - started;
  if (!res.ok) {
    throw new Error(`ollama chat failed: status ${res.status}`);
  }
  const data = (await res.json()) as { message?: { content?: string } };
  const raw =
    typeof data?.message?.content === "string" ? data.message.content : "";
  return { status: res.status, raw, latencyMs };
}

export async function ollamaEmbed(
  ollamaUrl: string,
  text: string
): Promise<number[]> {
  const res = await fetch(`${ollamaUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "nomic-embed-text", input: text }),
  });
  if (!res.ok) throw new Error(`ollama embed failed: status ${res.status}`);
  const data = (await res.json()) as { embeddings?: number[][] };
  return data.embeddings?.[0] ?? [];
}

/* --------------------- shadow semantic support ------------------------- */

export interface ShadowSupport {
  measured: Array<{ id: string; similarity: number }>;
  unmeasuredIds: string[];
  min: number | null;
  mean: number | null;
  rpcError?: string;
}

/**
 * SHADOW ONLY — never rejects, never persists. Uses the read-only
 * match_memories_v2 RPC to look up cosine similarity between the reflection
 * embedding and each claimed source's stored embedding. Sources not matched
 * (below the RPC floor or absent from the top-K) are reported as unmeasured.
 */
export async function shadowSimilarities(
  client: SupabaseClient,
  userId: string,
  journal: { record(op: string): void },
  ollamaUrl: string,
  reflectionContent: string,
  claimedIds: string[]
): Promise<ShadowSupport> {
  journal.record("embed:reflection(read-only-model-call)");
  const embedding = await ollamaEmbed(ollamaUrl, reflectionContent);
  journal.record("rpc:match_memories_v2(read)");
  const { data, error } = await client.rpc("match_memories_v2", {
    p_user_id: userId,
    p_query_embedding: embedding,
    p_match_threshold: 0,
    p_match_count: 200,
  });
  if (error) {
    return {
      measured: [],
      unmeasuredIds: [...claimedIds],
      min: null,
      mean: null,
      rpcError: JSON.stringify(error),
    };
  }
  const byId = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ id: string; similarity: number }>) {
    byId.set(row.id, row.similarity);
  }
  const measured = claimedIds
    .filter((id) => byId.has(id))
    .map((id) => ({ id, similarity: byId.get(id) as number }));
  const unmeasuredIds = claimedIds.filter((id) => !byId.has(id));
  const sims = measured.map((m) => m.similarity);
  return {
    measured,
    unmeasuredIds,
    min: sims.length ? Math.min(...sims) : null,
    mean: sims.length ? sims.reduce((a, b) => a + b, 0) / sims.length : null,
  };
}

/* --------------------------- repetition stats -------------------------- */

export interface RunSignal {
  empty: boolean;
  valid: boolean;
  latencyMs: number;
  titles: string[];
}

export interface RepetitionStats {
  runs: number;
  emptyRate: number | null;
  validRate: number | null;
  latencyMin: number | null;
  latencyMean: number | null;
  latencyMax: number | null;
  titleJaccardMean: number | null;
  classification: "not_run" | "stable-empty" | "stable-nonempty" | "unstable";
}

export function repetitionStats(runs: RunSignal[]): RepetitionStats {
  if (runs.length === 0) {
    return {
      runs: 0,
      emptyRate: null,
      validRate: null,
      latencyMin: null,
      latencyMean: null,
      latencyMax: null,
      titleJaccardMean: null,
      classification: "not_run",
    };
  }
  const emptyRate = runs.filter((r) => r.empty).length / runs.length;
  const validRate = runs.filter((r) => r.valid).length / runs.length;
  const lats = runs.map((r) => r.latencyMs);
  const pairwise: number[] = [];
  for (let i = 0; i < runs.length; i += 1) {
    for (let j = i + 1; j < runs.length; j += 1) {
      pairwise.push(
        tokenJaccard(
          (runs[i].titles ?? []).join(" "),
          (runs[j].titles ?? []).join(" ")
        )
      );
    }
  }
  const titleJaccardMean = pairwise.length
    ? pairwise.reduce((a, b) => a + b, 0) / pairwise.length
    : 1;
  const classification: RepetitionStats["classification"] =
    validRate === 0
      ? "stable-empty"
      : validRate === 1
        ? "stable-nonempty"
        : "unstable";
  return {
    runs: runs.length,
    emptyRate,
    validRate,
    latencyMin: Math.min(...lats),
    latencyMean: lats.reduce((a, b) => a + b, 0) / lats.length,
    latencyMax: Math.max(...lats),
    titleJaccardMean,
    classification,
  };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
