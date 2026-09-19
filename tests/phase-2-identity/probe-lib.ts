/**
 * Phase 2 — Identity Intelligence Audit probe harness.
 *
 * SAFETY INVARIANT: productionWrites = 0.
 * The probe journals its OWN direct DB calls (census select + calibration RPC).
 * resolveMemoryIdentity's internal embed/matchMemoriesV2 calls are read-only by
 * code inspection (verified by existing static assertion in
 * identity-multi-same.test.ts:23: identity.ts never invokes corroborateMemory,
 * .insert(, .update(), .delete().
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  createClient as createSupabaseClient,
  SupabaseClient,
} from "@supabase/supabase-js";

export interface ProbeEnv {
  supabaseUrl?: string;
  supabaseKey?: string;
  userId?: string;
  ollamaUrl?: string;
}

export function loadProbeEnv(): ProbeEnv {
  const p = path.resolve(process.cwd(), ".env.local");
  const env: Record<string, string> = {};
  if (fs.existsSync(p)) {
    for (const raw of fs.readFileSync(p, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
  }
  return {
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseKey: env.SUPABASE_SERVICE_ROLE_KEY,
    userId: env.PHASE6H_USER_ID,
    ollamaUrl: (process.env.OLLAMA_BASE_URL ?? env.OLLAMA_BASE_URL ?? "").trim(),
  };
}

/* ---------------------------- write safety ----------------------------- */

export const WRITE_OPS = new Set(["insert", "update", "delete", "upsert"]);

export interface DbJournal {
  record(op: string): void;
  ops(): string[];
  assertNoWrites(): true;
}

export function createDbJournal(): DbJournal {
  const ops: string[] = [];
  return {
    record: (op) => ops.push(op),
    ops: () => [...ops],
    assertNoWrites: () => {
      const bad = ops.filter((op) => WRITE_OPS.has(op.split(":")[0]));
      if (bad.length > 0) {
        throw new Error(`PRODUCTION WRITE ATTEMPTED: ${bad.join(", ")}`);
      }
      return true;
    },
  };
}

/* -------------------------------- rows --------------------------------- */

export interface MemoryRow {
  id: string;
  title: string;
  content: string;
  summary: string | null;
  memory_type: string;
  status: string;
  importance_v2: number | null;
  confidence_v2: number | null;
  created_at: string | null;
  tags: string[] | null;
  metadata: Record<string, unknown> | null;
  source_v2: string | null;
  observation_id: string | null;
}

export function countBy(
  rows: MemoryRow[],
  key: keyof MemoryRow
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = String(r[key] ?? "null");
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/* --------------------------- DB read helpers --------------------------- */

export function createProbeClient(env: ProbeEnv): SupabaseClient {
  return createSupabaseClient(
    env.supabaseUrl as string,
    env.supabaseKey as string
  );
}

export async function selectMemories(
  client: SupabaseClient,
  userId: string,
  journal: DbJournal
): Promise<MemoryRow[]> {
  journal.record("select:memories");
  const { data, error } = await client
    .from("memories")
    .select(
      "id,title,content,summary,memory_type,status,importance_v2,confidence_v2,created_at,updated_at,tags,metadata,source_ref,project_id,observation_id,source_v2"
    )
    .eq("user_id", userId);
  if (error) throw new Error(`census select failed: ${JSON.stringify(error)}`);
  return (data ?? []) as unknown as MemoryRow[];
}

/* ------------------------------ eligibility ---------------------------- */

export function isEligible(m: MemoryRow): boolean {
  return (
    (m.status === "active" || m.status === "candidate") &&
    (m.confidence_v2 ?? 0) >= 0.7 &&
    (m.importance_v2 ?? 0) >= 0.5 &&
    m.memory_type !== "reflection"
  );
}

/* --------------------------- embed wrapper ----------------------------- */

export async function embedObservation(
  ollamaUrl: string,
  text: string,
  journal: DbJournal
): Promise<number[]> {
  journal.record("embed:observation(read-only-model-call)");
  const res = await fetch(`${ollamaUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "nomic-embed-text", input: text }),
  });
  if (!res.ok) throw new Error(`ollama embed failed: status ${res.status}`);
  const data = (await res.json()) as { embeddings?: number[][] };
  return data.embeddings?.[0] ?? [];
}

/* --------------------------- calibration search ------------------------ */

export interface CalibrationCandidate {
  id: string;
  similarity: number;
  memory_type: string;
  title: string;
}

export interface CalibrationResult {
  candidates: CalibrationCandidate[];
  topSimilarity: number | null;
  error?: string;
}

export async function calibrationSearch(
  client: SupabaseClient,
  userId: string,
  journal: DbJournal,
  embedding: number[]
): Promise<CalibrationResult> {
  journal.record("rpc:match_memories_v2(read)");
  const { data, error } = await client.rpc("match_memories_v2", {
    p_user_id: userId,
    p_query_embedding: embedding,
    p_match_threshold: 0,
    p_match_count: 200,
  });
  if (error) {
    return { candidates: [], topSimilarity: null, error: JSON.stringify(error) };
  }
  const rows = (Array.isArray(data) ? data : []) as Array<{
    id: string;
    similarity: number;
    memory_type: string;
    title: string;
  }>;
  const candidates: CalibrationCandidate[] = rows.map((r) => ({
    id: r.id,
    similarity: r.similarity,
    memory_type: r.memory_type,
    title: r.title,
  }));
  const topSimilarity =
    candidates.length > 0 ? candidates[0].similarity : null;
  return { candidates, topSimilarity };
}

/* --------------------- verifier prompt hash pin ------------------------ */

const FROZEN_VERIFIER_PROMPT_HASH =
  "b999aa8fa91d272251123082ab437a5f748585b4fc994cf2f6378c9c53993e2d";

/**
 * Extract the CURRENT production verifier system prompt from lib/memory/identity.ts
 * source TEXT (multi-segment aware, escape-aware), so this audit always observes
 * the real adopted contract. The prompt is never reconstructed or retyped here.
 */
export function extractVerifierPrompt(): string {
  const src = fs
    .readFileSync(path.resolve(process.cwd(), "lib/memory/identity.ts"), "utf-8")
    .replace(/\r\n/g, "\n");
  const start = src.indexOf("const system =");
  const end = src.indexOf('";', start);
  if (start === -1 || end === -1) {
    throw new Error(
      "IDENTITY_PROMPT_EXTRACTION_FAILED: production system block not found in lib/memory/identity.ts"
    );
  }
  const parts = [
    ...src.slice(start, end + 2).matchAll(/"((?:[^"\\]|\\.)*)"/g),
  ].map((m) => JSON.parse(`"${m[1]}"`));
  if (parts.length === 0) {
    throw new Error(
      "IDENTITY_PROMPT_EXTRACTION_FAILED: no prompt literals found in production system block"
    );
  }
  return parts.join("");
}

export function verifierPromptHash(): string {
  const prompt = extractVerifierPrompt();
  return crypto.createHash("sha256").update(prompt).digest("hex");
}

export function assertVerifierPromptHash(): void {
  const hash = verifierPromptHash();
  if (hash !== FROZEN_VERIFIER_PROMPT_HASH) {
    throw new Error(
      `VERIFIER_PROMPT_DRIFTED: expected ${FROZEN_VERIFIER_PROMPT_HASH} got ${hash}`
    );
  }
}
