/// <reference types="vitest" />

/**
 * Phase 6-AA — Full 21-memory production input reflector probe.
 *
 * GOAL
 *   Determine whether the REAL reflector produces non-empty output when
 *   given the COMPLETE production-eligible memory pool (21 memories across
 *   4 type-groups), vs the 5-memory subset tested by Phase 6-W/X.
 *
 *   Phase 6-W/X filtered to `observation_id IS NOT NULL` (5 post-repair
 *   memories only). Production `runReflection()` applies NO such filter.
 *   This probe reproduces the production eligibility semantics verbatim.
 *
 * SAFETY
 *   - Uses the REAL `getAllMemories` (read-only SELECT).
 *   - Uses the REAL `generateReflections` (reflector.ts) EXACTLY ONCE
 *     if >= 2 eligible memories exist.
 *   - `generateReflections` itself never writes the DB.
 *   - NEVER calls saveMemory/insertMemoryV2/updateMemoryV2 or
 *     runReflection's saveMemory branch. productionWrites === 0.
 *   - Model / temperature / context are the REAL production values
 *     (qwen2.5:3b, temp 0.1, num_ctx 4096, num_predict 300). Untouched.
 *   - Raw model text is held in-memory only and NEVER written to disk.
 *   - Only safe counters/lengths/classifications written to measurement.json.
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

const probeDir = path.resolve(process.cwd(), "tests/phase-6-aa");
const measurementPath = path.join(probeDir, "measurement.json");

const env = loadEnvVars();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const USER = env.PHASE6H_USER_ID;

const ENV_MISSING = !SUPABASE_URL || !SUPABASE_KEY || !USER;

// Mock ONLY the server-session client factory so getAllMemories (real repo)
// can run in a plain node context. Returns a real service-role client — a
// faithful read. Same technique as Phase 6-W/X.
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
  created_at?: string;
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

function levenshtein(a: string, b: string): number {
  const an = a.length;
  const bn = b.length;
  if (an === 0) return bn;
  if (bn === 0) return an;
  const matrix: number[][] = Array.from({ length: an + 1 }, () =>
    new Array(bn + 1).fill(0)
  );
  for (let i = 0; i <= an; i++) matrix[i][0] = i;
  for (let j = 0; j <= bn; j++) matrix[0][j] = j;
  for (let i = 1; i <= an; i++) {
    for (let j = 1; j <= bn; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[an][bn];
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

const STRUCTURAL_MARKERS = [
  "because",
  "therefore",
  "since",
  "in order to",
  "goal",
  "connected to",
  "relationship",
  "prefers",
  "repeatedly",
  "consistently",
];

describe("Phase 6-AA: full-input reflector probe", () => {
  it("tests reflector on full 21-memory production input (read-only)", async () => {
    const M: Record<string, unknown> = {
      startedAt: new Date().toISOString(),
      experiment: "full-input-reflector-probe",
      productionWrites: 0,
      reflectorInvocations: 0,
      classification: null as string | null,
      reason: null as string | null,
      env: {
        supabaseConfigured: !!SUPABASE_URL && !!SUPABASE_KEY,
        userIdPresent: !!USER,
      },
      selectionRule:
        "status in (active,candidate) AND confidence_v2>=0.7 AND importance_v2>=0.5",
    };

    if (ENV_MISSING) {
      M.classification = "BLOCKED";
      M.reason =
        "missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / PHASE6H_USER_ID in .env.local";
      fs.writeFileSync(measurementPath, JSON.stringify(M, null, 2));
      expect(M.productionWrites).toStrictEqual(0);
      return;
    }

    // 1. REAL read-only SELECT of the user's full memory pool.
    const { data: all, error } = await getAllMemories(USER);
    if (error) {
      M.classification = "BLOCKED";
      M.reason = `getAllMemories failed: ${(error as Error).message ?? String(error)}`;
      fs.writeFileSync(measurementPath, JSON.stringify(M, null, 2));
      expect(M.productionWrites).toStrictEqual(0);
      return;
    }

    const rows = (all ?? []) as MemoryRow[];
    const total = rows.length;

    // PRODUCTION FILTER: no observation_id restriction.
    const eligible = rows.filter(isEligible);

    M.N_total = total;
    M.N_eligible = eligible.length;
    M.selectedIds = eligible.map((m) => m.id);

    if (eligible.length < 2) {
      M.classification = "NOT_ENOUGH_DATA";
      M.reason =
        "fewer than 2 eligible memories; a reflection connecting " +
        ">=2 memories is not possible, so no model call is made.";
      M.reflectorInvocations = 0;
      fs.writeFileSync(measurementPath, JSON.stringify(M, null, 2));
      expect(M.productionWrites).toStrictEqual(0);
      expect(M.reflectorInvocations).toStrictEqual(0);
      return;
    }

    // 2. Inspect reflection-type memories for content quality.
    const reflectionMemories = eligible.filter(
      (m) => m.memory_type === "reflection"
    );
    M.reflectionMemorySummary = reflectionMemories.map((m) => ({
      id: m.id,
      title: m.title,
      contentLength: typeof m.content === "string" ? m.content.length : 0,
      summaryLength: typeof m.summary === "string" ? m.summary.length : 0,
      hasSynthesizedContent: typeof m.content === "string" &&
        m.content.length > 50 &&
        STRUCTURAL_MARKERS.some((marker) =>
          m.content.toLowerCase().includes(marker)
        ),
    }));

    // 3. Build ReflectionInput VERBATIM (pipeline.ts:107-142) from ALL eligible rows.
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
        })),
      })
    );

    M.inputGroups = reflectionInput.map((g) => ({
      memoryType: g.memoryType,
      memoryCount: g.memories.length,
      memoryIds: g.memories.map((x) => x.id),
    }));

    M.fieldsPopulatedInInput = reflectionInput.flatMap((g) =>
      g.memories.map((m) => ({
        id: m.id,
        titleLength: m.title.length,
        contentLength: m.content.length,
        summaryLength: m.summary.length,
        tagsCount: m.tags?.length ?? 0,
        metadataKeyCount: Object.keys(m.metadata ?? {}).length,
        importance: m.importance,
        confidence: m.confidence,
        memoryType: m.memoryType,
      }))
    );

    // 4. Input quality metrics.
    const allInputMemories = reflectionInput.flatMap((g) => g.memories);
    const emptyContentCount = allInputMemories.filter(
      (m) => !m.content || m.content.trim() === ""
    ).length;
    const emptySummaryCount = allInputMemories.filter(
      (m) => !m.summary || m.summary.trim() === ""
    ).length;
    const emptyTagsCount = allInputMemories.filter(
      (m) => !m.tags || m.tags.length === 0
    ).length;
    const emptyMetadataCount = allInputMemories.filter(
      (m) => !m.metadata || Object.keys(m.metadata).length === 0
    ).length;
    const contentLengths = allInputMemories.map((m) => m.content.length);
    const avgContentLength =
      contentLengths.reduce((a, b) => a + b, 0) / contentLengths.length;
    const contentVariance =
      contentLengths.reduce((sum, l) => sum + (l - avgContentLength) ** 2, 0) /
      contentLengths.length;
    const contentStdDev = Math.sqrt(contentVariance);
    const withStructuralMarkers = allInputMemories.filter((m) =>
      STRUCTURAL_MARKERS.some((marker) =>
        m.content.toLowerCase().includes(marker)
      )
    ).length;

    // Near-duplicate detection (Levenshtein > 0.8 on content).
    let nearDuplicatePairs = 0;
    for (let i = 0; i < allInputMemories.length; i++) {
      for (let j = i + 1; j < allInputMemories.length; j++) {
        if (
          similarity(
            allInputMemories[i].content,
            allInputMemories[j].content
          ) > 0.8
        ) {
          nearDuplicatePairs++;
        }
      }
    }

    const typeDistribution = reflectionInput.reduce(
      (acc, g) => {
        acc[g.memoryType] = g.memories.length;
        return acc;
      },
      {} as Record<string, number>
    );

    M.inputQualityMetrics = {
      emptyContentCount,
      emptySummaryCount,
      emptyTagsCount,
      emptyMetadataCount,
      avgContentLength: Math.round(avgContentLength * 100) / 100,
      contentStdDev: Math.round(contentStdDev * 100) / 100,
      nearDuplicatePairs,
      withStructuralMarkers,
      typeDistribution,
    };

    // 5. ONE real model call, via the REAL generateReflections.
    //    Tee the transport (fetch) to capture diagnostics; do not modify
    //    the reflector, prompt, or model configuration. Raw model text is
    //    held in a local variable only and NEVER written to disk.
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

    // 6. Parse diagnostics from the tee'd raw text IN MEMORY ONLY
    //    (never persisted) so we can distinguish parse-rejection from
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

    // 7. Classification.
    if (modelErr) {
      M.classification = "BLOCKED";
      M.reason = `generateReflections threw: ${modelErr}`;
    } else if (finalCount > 0) {
      M.classification = "FULL_INPUT_NONEMPTY";
      M.reason =
        "full 21-memory production input reached the real reflector and " +
        "produced valid, sanitizer-accepted reflection candidate(s).";
    } else if (parseSuccess && rootType === "array" && preSanit > 0) {
      M.classification = "SANITIZER_REJECTION";
      M.reason =
        "model produced array candidate(s), but the sanitizer accepted none.";
    } else if (captured.responseIsLiteralEmptyArray === true) {
      M.classification = "MODEL_EMPTY";
      M.reason =
        "full production input reached the reflector; model returned valid [].";
    } else if (!parseSuccess) {
      M.classification = "PARSE_REJECTION";
      M.reason = "model output existed but JSON parsing or root validation failed.";
    } else if (parseSuccess && rootType === "object") {
      M.classification = "PARSER_EMPTY_OBJECT";
      M.reason =
        "model returned a JSON object (not array); parser rejects non-array roots.";
    } else {
      M.classification = "MODEL_EMPTY";
      M.reason = "no accepted candidates returned.";
    }

    // 8. Comparison with Phase 6-W/X baseline.
    M.comparisonWithPhase6WX = {
      phase6WX: {
        inputMemoryCount: 5,
        typeGroups: 1,
        reflectionMemoriesInInput: 0,
        classification: "POST_REPAIR_MODEL_EMPTY",
        rawModelOutput: "[]",
        candidatesPreSanitizer: 0,
        finalAccepted: 0,
      },
      phase6AA: {
        inputMemoryCount: eligible.length,
        typeGroups: reflectionInput.length,
        reflectionMemoriesInInput: reflectionMemories.length,
        classification: M.classification,
        rawModelOutput: rawText,
        candidatesPreSanitizer: preSanit,
        finalAccepted: finalCount,
      },
      keyDifference:
        "Phase 6-W/X used 5 post-repair project memories (observation_id IS NOT NULL filter). " +
        "Phase 6-AA uses the full production-eligible pool (21 memories, no observation_id filter).",
    };

    // 9. Console output for diagnostic review (not persisted).
    console.log("=== PHASE 6-AA DIAGNOSTIC OUTPUT ===");
    console.log("CLASSIFICATION:", M.classification);
    console.log("REASON:", M.reason);
    console.log("INPUT GROUPS:", JSON.stringify(M.inputGroups, null, 2));
    console.log("INPUT QUALITY METRICS:", JSON.stringify(M.inputQualityMetrics, null, 2));
    console.log("REFLECTION MEMORY SUMMARY:", JSON.stringify(M.reflectionMemorySummary, null, 2));
    console.log("RAW MODEL RESPONSE TEXT:");
    console.log(rawText);
    console.log("=== END RAW MODEL RESPONSE ===");
    console.log("ELIGIBLE MEMORIES DETAIL:");
    for (const m of eligible) {
      console.log(`  ID: ${m.id}`);
      console.log(`  TYPE: ${m.memory_type}`);
      console.log(`  TITLE: ${m.title}`);
      console.log(`  CONTENT: ${m.content}`);
      console.log(`  SUMMARY: ${m.summary ?? "(null)"}`);
      console.log(`  TAGS: ${JSON.stringify(m.tags ?? [])}`);
      console.log(`  METADATA: ${JSON.stringify(m.metadata ?? {})}`);
      console.log(`  IMPORTANCE: ${m.importance_v2}`);
      console.log(`  CONFIDENCE: ${m.confidence_v2}`);
      console.log(`  OBSERVATION_ID: ${m.observation_id}`);
      console.log("  ---");
    }
    console.log("=== END ELIGIBLE MEMORIES ===");

    fs.writeFileSync(measurementPath, JSON.stringify(M, null, 2));

    // Invariants.
    expect(M.productionWrites).toStrictEqual(0);
    expect(M.reflectorInvocations).toStrictEqual(1);
    expect(M.classification).not.toBeNull();
  });
});
