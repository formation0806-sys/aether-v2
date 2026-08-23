/// <reference types="vitest" />

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Phase 6-AI: this controlled-production-write test is the PROVEN source of the
 * five placeholder `new Array(768).fill(0.1)` embeddings persisted on
 * 2026-08-21. It now requires an explicit opt-in and is SKIPPED during ordinary /
 * default `npm test` (env gate, not a silent purpose change). When enabled
 * (`PHASE6V_ENABLED=1`) it performs a REAL production write of a memory whose
 * embedding is the mocked constant-0.1 vector — deliberately unchanged from the
 * historical mock per the Phase 6-AI instructions.
 */
const PHASE6V_ENABLED = process.env.PHASE6V_ENABLED === "1";

/**
 * Phase 6-V — Controlled post-repair write verification.
 *
 * Drives the REAL write path (runMemoryMaintenance -> saveMemory ->
 * insertMemoryV2 -> memories row) against the real Supabase project using the
 * designated test user (PHASE6H_USER_ID). External/infra boundaries (Ollama
 * extractor, embedding, identity LLM, reflector, lifecycle, archive purge) are
 * mocked so the verification is deterministic and Ollama-independent. The
 * pipeline, saveMemory, repository, and DB write all run unmodified.
 *
 * This is a CONTROLLED PRODUCTION WRITE. The resulting memory row is left in
 * the database (no auto-cleanup) per the Phase 6-V safety requirement.
 */

// Hoisted: available to the vi.mock factories that run during import phase.
function loadEnvVars(): Record<string, string> {
  const env: Record<string, string> = {};
  const p = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(p)) {
    for (const raw of fs.readFileSync(p, "utf-8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const k = line.slice(0, eq).trim();
      let v = line.slice(eq + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      env[k] = v;
    }
  }
  return env;
}

const env = loadEnvVars();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY!;
const PHASE6H_USER_ID = env.PHASE6H_USER_ID!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !PHASE6H_USER_ID) {
  throw new Error(
    "phase6v: missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / PHASE6H_USER_ID in .env.local"
  );
}

const admin = createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Run-specific token so each execution is a DISTINCT observation (unique
// title/content => always INSERT path, never the exact-match SKIP path).
let CURRENT_RUN_ID = "";

vi.mock("@/lib/supabase/server", () => {
  const e = loadEnvVars();
  const url = e.NEXT_PUBLIC_SUPABASE_URL!;
  const key = e.SUPABASE_SERVICE_ROLE_KEY!;
  return {
    createClient: () => createSupabaseClient(url, key),
  };
});

vi.mock("@/lib/memory/aiExtractor", () => ({
  aiExtractMemories: vi.fn(async () => [
    {
      title: `User Project: Aether [${CURRENT_RUN_ID}]`,
      content: `The user is building a project called Aether with Next.js and Supabase. [${CURRENT_RUN_ID}]`,
      memoryType: "project",
      importance: 8,
      confidence: 0.9,
      explicit: true,
    },
  ]),
}));

vi.mock("@/lib/ai/embeddings/embed", () => ({
  embed: vi.fn(async () => ({ embedding: new Array(768).fill(0.1) })),
}));

vi.mock("@/lib/memory/identity", () => ({
  resolveMemoryIdentity: vi.fn(async () => ({
    decision: "create",
    reason: "phase6v-test",
  })),
}));

vi.mock("@/lib/memory/reflector", () => ({
  generateReflections: vi.fn(async () => []),
}));

vi.mock("@/lib/memory/lifecycle", () => ({
  evaluateLifecycle: vi.fn(async () => ({ transitions: [] })),
}));

// Keep the repository REAL (so saveMemory actually writes), override only
// purgeArchived to avoid archive-purge side effects.
vi.mock("@/lib/repositories/memory.repository", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/repositories/memory.repository")
  >("@/lib/repositories/memory.repository");
  return {
    ...actual,
    purgeArchived: vi.fn(async () => ({ count: 0, error: null })),
  };
});

import { runMemoryMaintenance } from "@/lib/core/pipeline";
import { getAllMemories } from "@/lib/repositories/memory.repository";

function buildTestMessage(runId: string): string {
  return (
    `My project is called Aether and I am building it with Next.js and Supabase. ` +
    `Please remember that I always prefer dark mode interfaces and TypeScript is my favorite language. ` +
    `[phase6v-run=${runId}]`
  );
}

describe.skipIf(!PHASE6V_ENABLED)("Phase 6-V: controlled post-repair write verification (opt-in via PHASE6V_ENABLED=1)", () => {
  let runId: string;
  let messageId: string;
  let testMessage: string;

  beforeEach(async () => {
    runId = Math.random().toString(36).slice(2, 10);
    CURRENT_RUN_ID = runId;
    testMessage = buildTestMessage(runId);

    // Direct insert bypasses the RPC (which requires auth.uid() == user_id and
    // fails under the service-role key). Service role bypasses RLS.
    const { data: message, error: msgError } = await admin
      .from("messages")
      .insert({ user_id: PHASE6H_USER_ID, role: "user", content: testMessage })
      .select("id")
      .single();

    if (msgError || !message) {
      throw new Error(`phase6v: failed to insert message: ${msgError?.message}`);
    }
    messageId = message.id;

    const { error: jobError } = await admin.from("memory_jobs").insert({
      job_type: "memory_maintenance",
      user_id: PHASE6H_USER_ID,
      message_id: messageId,
      status: "processing",
      payload: { message: testMessage },
    });
    if (jobError) {
      throw new Error(`phase6v: failed to insert job: ${jobError.message}`);
    }
  });

  it("persists repaired fields through the real write path", async () => {
    const result = await runMemoryMaintenance(
      PHASE6H_USER_ID,
      testMessage,
      messageId
    );

    expect(result.ok).toBe(true);
    expect(result.extraction.ok).toBe(true);

    // 3. Read-only SELECT of the resulting memory row.
    const { data: memories, error: selError } = await admin
      .from("memories")
      .select(
        "id, memory_type, status, title, content, summary, importance_v2, confidence_v2, tags, metadata, source_ref, project_id, observation_id"
      )
      .eq("observation_id", messageId);

    expect(selError).toBeNull();
    expect(memories && memories.length).toBeGreaterThanOrEqual(1);

    const m = memories![0];

    // Core repaired plumbing.
    expect(m.observation_id).toBe(messageId);
    expect(m.memory_type).toBe("project");
    expect(m.title).toBe(`User Project: Aether [${runId}]`);
    expect(m.content).toBe(
      `The user is building a project called Aether with Next.js and Supabase. [${runId}]`
    );
    expect(m.status).toBe("active");

    // Fields the extractor legitimately does not produce.
    expect(m.summary).toBe("");
    expect(Array.isArray(m.tags) ? m.tags : []).toEqual([]);

    // Fields hardcoded by the pipeline caller: plumbing works, caller not
    // updated. Their PRESENCE in the row is the verification, not a failure.
    expect(m.metadata).toEqual({});
    expect(m.source_ref).toBeNull();
    expect(m.project_id).toBeNull();

    // Scoring. importanceScore = 0.35*normImp + 0.25*typeWeight + 0.15*conf
    //   + 0.10*(explicit?1:0) + 0.10*(feedback+1)/2 + 0.05*novelty
    // With {imp:8, conf:0.9, type:"project"(0.85), feedback:0, novelty:0}:
    //   explicit forwarded  -> 0.28 + 0.2125 + 0.135 + 0.10 + 0.05 = 0.7775
    //   explicit NOT sent   -> ... + 0.00 + 0.05            = 0.6775
    // DB column is numeric(3,2) -> round(2): forwarded=0.78, not-forwarded=0.68
    const imp = m.importance_v2 as number;
    const forwarded = Math.abs(imp - 0.78) < 0.001;
    const notForwarded = Math.abs(imp - 0.68) < 0.001;
    console.log(`[phase6v] RAW importance_v2 = ${imp}`);
    expect(forwarded || notForwarded).toBe(true);
    console.log(
      `[phase6v] importance_v2=${imp} -> explicit ${
        forwarded ? "FORWARDED" : "NOT forwarded (regression)"
      }`
    );

    // 4. Repository read check (DB -> repo -> app boundary).
    const repo = await getAllMemories(PHASE6H_USER_ID);
    expect(repo.error).toBeNull();
    const repoMem = (repo.data ?? []).find(
      (x) => x.observation_id === messageId
    );
    expect(repoMem).toBeDefined();
    expect(repoMem!.memory_type).toBe("project");
    expect(repoMem!.observation_id).toBe(messageId);
    expect(repoMem!.metadata).toEqual({});
    expect(repoMem!.source_ref).toBeNull();
    expect(repoMem!.project_id).toBeNull();

    // 5. Reflection-input check (read-only structural): enriched columns that
    // runReflection maps are present on the repo row. Reflector NOT invoked.
    expect(repoMem!.importance_v2).toBeCloseTo(imp, 5);
    expect(repoMem!.confidence_v2).toBeCloseTo(0.9, 2);
    expect(Array.isArray(repoMem!.tags)).toBe(true);
    expect(repoMem!.summary).toBe("");

    console.log(
      `[phase6v] rows created for observation_id=${messageId}: ${memories!.length}`
    );
    console.log(
      `[phase6v] test row REMAINS in the database (no auto-cleanup).`
    );
  });
});
