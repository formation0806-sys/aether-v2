/// <reference types="vitest" />

/**
 * Phase 6-W — Post-repair reflector verification (experiment, NOT a fix).
 *
 * GOAL
 *   Determine whether the REAL post-repair memory state changes REAL
 *   reflector behavior (vs Phase 6-S/T `MODEL_EMPTY` on historical sparse data).
 *
 * SAFETY
 *   - Uses the REAL `getAllMemories` (read-only SELECT).
 *   - Uses the REAL `generateReflections` (reflector.ts) EXACTLY ONCE if and only
 *     if >= 2 reflection-eligible post-repair rows exist.
 *   - `generateReflections` itself never writes the DB.
 *   - This experiment NEVER calls saveMemory/insertMemoryV2/updateMemoryV2 or
 *     runReflection's saveMemory branch. productionWrites === 0.
 *   - Model / temperature / context are the REAL production values
 *     (qwen2.5:3b, temp 0.1, num_ctx 4096, num_predict 300). Untouched.
 *   - Writes a diagnostic-only `measurement.json`. Raw model text is recorded
 *     ONLY as a length + parseable classification, never persisted as content.
 */

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

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

const probeDir = path.resolve(process.cwd(), "tests/phase-6-w");
const measurementPath = path.join(probeDir, "measurement.json");

const env = loadEnvVars();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const USER = env.PHASE6H_USER_ID;

const ENV_MISSING = !SUPABASE_URL || !SUPABASE_KEY || !USER;

// Mock ONLY the server-session client factory so getAllMemories (real repo)
// can run in a plain node context. Returns a real service-role client — a
// faithful read. (Same technique as the Phase 6-V verification test.)
vi.mock("@/lib/supabase/server", () => {
  const e = loadEnvVars();
  const url = e.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = e.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return {
    createClient: () => createSupabaseClient(url, key),
  };
});

// Do NOT mock the repository or the reflector: we exercise the REAL code.
import { getAllMemories } from "@/lib/repositories/memory.repository";
import { generateReflections, ReflectionInput } from "@/lib/memory/reflector";

type MemoryRow = {
  id: string;
  title: string;
  content: string;
  summary?: string | null;
  tags?: string[] | null;
  metadata?: Record<string, unknown> | null;
  source_ref?: string | null;
  project_id?: string | null;
  observation_id?: string | null;
  importance_v2: number;
  confidence_v2: number;
  memory_type: string;
  status: string;
};

function present(v: unknown): string {
  if (v === undefined) return "absent";
  if (v === null) return "null";
  if (Array.isArray(v)) return `array[${v.length}]`;
  if (typeof v === "string") return `str(len=${v.length})`;
  if (typeof v === "object") return "object";
  return typeof v;
}

const ROW_FIELDS = [
  "summary",
  "tags",
  "metadata",
  "source_ref",
  "project_id",
  "observation_id",
  "importance_v2",
  "confidence_v2",
  "memory_type",
  "status",
] as const;

function isEligible(m: MemoryRow): boolean {
  const status = (m.status ?? "").toString();
  return (
    (status === "active" || status === "candidate") &&
    (m.confidence_v2 ?? 0) >= 0.7 &&
    (m.importance_v2 ?? 0) >= 0.5
  );
}

describe("Phase 6-W: real post-repair reflector probe", () => {
  it("measures reflector behavior on existing post-repair memories (read-only)", async () => {
    const M: Record<string, unknown> = {
      startedAt: new Date().toISOString(),
      experiment: "post-repair-reflector-probe",
      productionWrites: 0,
      reflectorInvocations: 0,
      classification: null as string | null,
      skipped: null as string | null,
      reason: null as string | null,
      env: {
        supabaseConfigured: !!SUPABASE_URL && !!SUPABASE_KEY,
        userIdPresent: !!USER,
      },
    };

    if (ENV_MISSING) {
      M.classification = "BLOCKED";
      M.reason =
        "missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / PHASE6H_USER_ID in .env.local";
      fs.writeFileSync(measurementPath, JSON.stringify(M, null, 2));
      expect(M.productionWrites).toBe(0);
      return;
    }

    // 1. REAL read-only SELECT of the user's memory pool.
    const { data: all, error } = await getAllMemories(USER);
    if (error) {
      M.classification = "BLOCKED";
      M.reason = `getAllMemories failed: ${(error as Error).message ?? String(error)}`;
      fs.writeFileSync(measurementPath, JSON.stringify(M, null, 2));
      expect(M.productionWrites).toBe(0);
      return;
    }

    const rows = (all ?? []) as MemoryRow[];
    const total = rows.length;
    const postRepair = rows.filter((m) => m.observation_id != null);
    const eligible = postRepair.filter(isEligible);

    M.N_total = total;
    M.N_postRepair = postRepair.length;
    M.N_eligible = eligible.length;
    M.selectionRule =
      "observation_id IS NOT NULL AND status in (active,candidate) AND confidence_v2>=0.7 AND importance_v2>=0.5";

    M.rowsBefore = rows.map((m) => {
      const o: Record<string, unknown> = { id: m.id, memoryType: m.memory_type };
      for (const f of ROW_FIELDS) o[f] = present((m as Record<string, unknown>)[f]);
      o.isEligible = isEligible(m);
      o.isPostRepair = m.observation_id != null;
      return o;
    });
    M.selectedIds = eligible.map((m) => m.id);

    // 2. Decision gate: refuse to invoke the model if there is no meaningful
    //    post-repair input. This is the key safety + honesty gate.
    if (eligible.length < 2) {
      M.classification = "NOT_ENOUGH_POST_REPAIR_DATA";
      M.reason =
        "fewer than 2 eligible post-repair memories; a reflection connecting " +
        ">=2 memories is not possible, so no model call is made.";
      M.reflectorInvocations = 0;
      fs.writeFileSync(measurementPath, JSON.stringify(M, null, 2));
      expect(M.productionWrites).toBe(0);
      expect(M.reflectorInvocations).toBe(0);
      return;
    }

    // 3. Build ReflectionInput VERBATIM (pipeline.ts:127-142) from eligible rows.
    const groups = eligible.reduce(
      (g: Record<string, MemoryRow[]>, m) => {
        (g[m.memory_type] ||= []).push(m);
        return g;
      },
      {}
    );

    const reflectionInput: ReflectionInput[] = Object.entries(groups).map(
      ([memoryType, mems]) => ({
        memoryType,
        memories: (mems as MemoryRow[]).map((m) => ({
          id: m.id,
          title: m.title,
          content: m.content,
          summary: m.summary ?? "",
          importance: m.importance_v2,
          confidence: m.confidence_v2,
          memoryType: m.memory_type,
          tags: m.tags ?? [],
          metadata: m.metadata ?? {},
        })),      })
    );

    M.inputGroups = reflectionInput.map((g) => ({
      memoryType: g.memoryType,
      memoryCount: g.memories.length,
      memoryIds: g.memories.map((x) => x.id),
    }));
    M.fieldsPopulatedInInput = reflectionInput.flatMap((g) =>
      g.memories.map((m) => ({
        id: m.id,
        summary: present(m.summary),
        tags: present(m.tags),
        metadata: present(m.metadata),
        importance: m.importance,
        confidence: m.confidence,
        memoryType: m.memoryType,
      }))
    );

    // 4. ONE real model call, via the REAL generateReflections.
    //    We only TEE the transport (fetch) to capture diagnostics; we do not
    //    modify the reflector, prompt, or model configuration. The raw model
    //    text is held in a local variable only and NEVER written to disk.
    const g = globalThis as unknown as {
      fetch: typeof fetch;
      Response: unknown;
    };
    const origFetch = g.fetch;
    const captured: Record<string, unknown> = {
      requestModel: null,
      requestOptions: null,
      responseTextLength: null,
      responseIsLiteralEmptyArray: null,
    };
    let rawText: string | null = null;

    g.fetch = (async (input: unknown, init?: unknown) => {
      try {
        const body = JSON.parse((init as { body?: string }).body ?? "{}");
        captured.requestModel = body.model;
        captured.requestOptions = body.options ?? null;
      } catch {
        // request body not JSON; leave null
      }
      const resp = await origFetch(input as never, init as never);
      rawText = await (resp as Response).text();
      captured.responseTextLength = rawText.length;
      captured.responseIsLiteralEmptyArray = rawText === "[]";
      // Replay an equivalent Response so generateReflections behaves normally.
      return new (g.Response as { new (b: string, init: unknown): Response })(
        rawText,
        {
          status: (resp as Response).status,
          statusText: (resp as Response).statusText,
          headers: (resp as Response).headers,
        }
      );
    }) as typeof fetch;

    let result: Awaited<ReturnType<typeof generateReflections>> = [];
    let modelErr: string | null = null;

    try {
      M.reflectorInvocations = 1;
      result = await generateReflections(reflectionInput);
    } catch (e) {
      modelErr = (e as Error).message ?? String(e);
    } finally {
      g.fetch = origFetch;
    }

    // 5. Parse diagnostics from the tee'd raw text IN MEMORY ONLY (never
    //    persisted) so we can distinguish parse-rejection from
    //    sanitizer-rejection vs model-empty.
    M.modelRequest = {
      model: captured.requestModel,
      options: captured.requestOptions,
    };

    let parseSuccess = false;
    let rootType = "none";
    let preSanit = 0;
    if (rawText !== null) {
      try {
        const parsed: unknown = JSON.parse(rawText);
        parseSuccess = true;
        rootType = Array.isArray(parsed) ? "array" : typeof parsed;
        preSanit = Array.isArray(parsed) ? parsed.length : 0;
      } catch {
        parseSuccess = false;
        rootType = typeof rawText;
        preSanit = 0;
      }
    }

    const finalCount = (result ?? []).length;

    M.parseDiagnostics = {
      rawLength: captured.responseTextLength,
      isLiteralEmptyArray: captured.responseIsLiteralEmptyArray,
      parseSuccess,
      rootType,
      candidatesPreSanitizer: preSanit,
      finalAccepted: finalCount,
      networkError: modelErr,
    };

    // 6. Classification.
    if (modelErr) {
      M.classification = "BLOCKED";
      M.reason = `generateReflections threw: ${modelErr}`;
    } else if (finalCount > 0) {
      M.classification = "POST_REPAIR_NONEMPTY";
      M.reason =
        "real post-repair input reached the real reflector and produced a " +
        "valid, sanitizer-accepted reflection candidate.";
    } else if (parseSuccess && rootType === "array" && preSanit > 0) {
      M.classification = "POST_REPAIR_SANITIZER_REJECTION";
      M.reason =
        "model produced array candidate(s), but the sanitizer accepted none.";
    } else if (captured.responseIsLiteralEmptyArray === true) {
      M.classification = "POST_REPAIR_MODEL_EMPTY";
      M.reason = "real post-repair input reached the reflector; model returned valid [].";
    } else if (!parseSuccess) {
      M.classification = "POST_REPAIR_PARSE_REJECTION";
      M.reason = "model output existed but JSON parsing or root validation failed.";
    } else {
      M.classification = "POST_REPAIR_MODEL_EMPTY";
      M.reason = "no accepted candidates returned.";
    }

    fs.writeFileSync(measurementPath, JSON.stringify(M, null, 2));

    // Invariants.
    expect(M.productionWrites).toStrictEqual(0);
    expect(M.reflectorInvocations).toStrictEqual(1);
    expect(M.classification).not.toBeNull();
  });
});
