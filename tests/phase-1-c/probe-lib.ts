/**
 * Phase 1-C Step 1 — zero-write measurement probe library.
 *
 * SAFETY INVARIANT: productionWrites = 0.
 * Every DB access in the probe goes through the helpers below, which record
 * the operation kind into a journal. Only SELECT-style reads and the
 * read-only `match_memories_v2` RPC are ever performed; the journal is
 * asserted against WRITE_OPS at the end of the run.
 *
 * Mirrors (documented replicas, Phase 6-F convention — production predicates
 * are not exported for testing):
 *   - eligibility filter == lib/core/pipeline.ts runReflection, INCLUDING the
 *     Phase 1-A `memory_type !== "reflection"` exclusion
 *   - type grouping + cross-type window == the Phase 1-B pipeline builder
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

export async function countRows(
  client: SupabaseClient,
  table: string,
  userId: string,
  journal: DbJournal
): Promise<number> {
  journal.record(`select-head-count:${table}`);
  const { count, error } = await client
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw new Error(`count ${table} failed: ${JSON.stringify(error)}`);
  return count ?? 0;
}

/* ------------------------------ mirrors -------------------------------- */

export function isEligible(m: MemoryRow): boolean {
  return (
    (m.status === "active" || m.status === "candidate") &&
    (m.confidence_v2 ?? 0) >= 0.7 &&
    (m.importance_v2 ?? 0) >= 0.5 &&
    m.memory_type !== "reflection"
  );
}

/** Eligible ignoring the Phase 1-A reflection exclusion (census lens only). */
export function isEligibleIgnoringReflectionExclusion(m: MemoryRow): boolean {
  return (
    (m.status === "active" || m.status === "candidate") &&
    (m.confidence_v2 ?? 0) >= 0.7 &&
    (m.importance_v2 ?? 0) >= 0.5
  );
}

export interface InputItem {
  id: string;
  title: string;
  content: string;
  summary: string;
  importance: number | null;
  confidence: number | null;
  memoryType: string;
  tags: string[] | null;
  metadata: Record<string, unknown> | null;
}

export function toInputItem(m: MemoryRow): InputItem {
  return {
    id: m.id,
    title: m.title,
    content: m.content,
    summary: m.summary ?? "",
    importance: m.importance_v2,
    confidence: m.confidence_v2,
    memoryType: m.memory_type,
    tags: m.tags,
    metadata: m.metadata,
  };
}

export function groupByType(
  candidates: MemoryRow[]
): Array<{ memoryType: string; memories: InputItem[] }> {
  const groups: Record<string, MemoryRow[]> = {};
  for (const m of candidates) {
    (groups[m.memory_type] = groups[m.memory_type] ?? []).push(m);
  }
  return Object.entries(groups).map(([memoryType, memories]) => ({
    memoryType,
    memories: memories.map(toInputItem),
  }));
}

export const WINDOW_MAX_MEMORIES = 12;
export const WINDOW_MAX_JSON_CHARS = 6000;
export const WINDOW_LABEL = "cross-type";

/** Exact replica of the Phase 1-B pipeline window builder. */
export function buildWindowMirror(candidates: MemoryRow[]): MemoryRow[] | null {
  if (candidates.length < 2) return null;

  const ranked = [...candidates].sort((a, b) => {
    const ia = a.importance_v2 ?? 0;
    const ib = b.importance_v2 ?? 0;
    if (ia !== ib) return ib - ia;
    const ca = a.confidence_v2 ?? 0;
    const cb = b.confidence_v2 ?? 0;
    if (ca !== cb) return cb - ca;
    const ta = a.created_at ?? "";
    const tb = b.created_at ?? "";
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const members = ranked.slice(0, WINDOW_MAX_MEMORIES);

  const picked: MemoryRow[] = [];
  for (const memory of members) {
    const probe = {
      memoryType: WINDOW_LABEL,
      memories: [...picked, memory].map(toInputItem),
    };
    if (JSON.stringify(probe).length > WINDOW_MAX_JSON_CHARS) break;
    picked.push(memory);
  }

  if (picked.length < 2) return null;
  if (new Set(picked.map((m) => m.memory_type)).size < 2) return null;
  return picked;
}

/* --------------------------- prompt extraction ------------------------- */

export function extractPromptBlock(): {
  block: string;
  prompt: string;
  hash: string;
} {
  const src = fs
    .readFileSync(path.resolve(process.cwd(), "lib/memory/reflector.ts"), "utf8")
    .replace(/\r\n/g, "\n");
  const startMarker = "const REFLECTION_SYSTEM_PROMPT = `";
  const start = src.indexOf(startMarker);
  if (start === -1) throw new Error("REFLECTION_SYSTEM_PROMPT not found");
  const end = src.indexOf("`;", start);
  const block = src.slice(start, end + 2);
  const firstBacktick = block.indexOf("`");
  const lastBacktick = block.lastIndexOf("`");
  const prompt = block.slice(firstBacktick + 1, lastBacktick);
  return {
    block,
    prompt,
    hash: crypto.createHash("sha256").update(block).digest("hex"),
  };
}
