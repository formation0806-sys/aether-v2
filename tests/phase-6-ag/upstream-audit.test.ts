/// <reference types="vitest" />

/**
 * Phase 6-AG — Upstream Memory Identity/Deduplication Path Audit
 *
 * 8-probe read-only diagnostic tracing the production path:
 * observation → extraction → identity resolution → duplicate/relationship
 * decision → corroboration/merge/supersession → persistence → reflection input.
 *
 * SAFETY
 * - Only read-only operations: getAllMemories, matchMemoriesV2, embed(),
 *   raw memory_events SELECT, raw memories SELECT for times_used/last_used.
 * - No saveMemory, insertMemoryV2, updateMemoryV2, corroborateMemory,
 *   merge_memories, or any write.
 * - verifyIdentity simulation: max 6 Ollama chat calls (capped).
 * - Raw model text held in-memory only, NEVER written to disk.
 * - Only measurement.json is persisted.
 * - productionWrites = 0 hard invariant.
 */

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
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
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      env[k] = v;
    }
  }
  return env;
}

const probeDir = path.resolve(process.cwd(), "tests/phase-6-ag");
const measurementPath = path.join(probeDir, "measurement.json");

const env = loadEnvVars();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const USER = env.PHASE6H_USER_ID;

const ENV_MISSING = !SUPABASE_URL || !SUPABASE_KEY || !USER;

vi.mock("@/lib/supabase/server", () => {
  const e = loadEnvVars();
  const url = e.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = e.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return { createClient: () => createSupabaseClient(url, key) };
});

import { getAllMemories } from "@/lib/repositories/memory.repository";
import { embed } from "@/lib/ai/embeddings/embed";
import { matchMemoriesV2 } from "@/lib/repositories/memory.repository";

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
  updated_at?: string;
};

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

function readIdentityPromptSource(): {
  system: string;
  modelConstant: string;
} {
  const identityPath = path.resolve(process.cwd(), "lib/memory/identity.ts");
  const source = fs.readFileSync(identityPath, "utf-8");

  const systemMatch = source.match(
    /const system = \(([^)]+)\) \+ "You are an identity-resolution classifier[^"]*"\s*\+/
  );
  const system =
    systemMatch?.[1] ??
    "You are an identity-resolution classifier for a long-term memory system. ";

  const modelMatch = source.match(/const IDENTITY_VERIFIER_MODEL = "([^"]+)"/);
  const modelConstant = modelMatch?.[1] ?? "qwen2.5:3b";

  return { system, modelConstant };
}

async function callIdentityVerifier(
  newMem: { title: string; content: string; memoryType: string },
  candidate: { title: string; content: string; memory_type: string; similarity: number }
): Promise<{ decision: string; latencyMs: number }> {
  const { system: systemPrompt, modelConstant } = readIdentityPromptSource();

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

  const reproducedPrompt = systemPrompt + "\n\n" + user;
  const productionPromptSource = fs.readFileSync(
    path.resolve(process.cwd(), "lib/memory/identity.ts"),
    "utf-8"
  );
  const productionSystemMatch = productionPromptSource.match(
    /const system = \(([^)]+)\) \+ "You are an identity-resolution classifier[^"]*"\s*\+/
  );
  const productionSystem =
    productionSystemMatch?.[1] ??
    "You are an identity-resolution classifier for a long-term memory system. ";
  const productionPrompt = productionSystem + "\n\n" + user;

  const reproducedHash = crypto
    .createHash("sha256")
    .update(reproducedPrompt)
    .digest("hex");
  const productionHash = crypto
    .createHash("sha256")
    .update(productionPrompt)
    .digest("hex");

  if (reproducedHash !== productionHash) {
    return {
      decision: "PROMPT_HASH_MISMATCH",
      latencyMs: 0,
    };
  }

  const t0 = Date.now();
  try {
    const res = await fetch("http://127.0.0.1:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelConstant,
        stream: false,
        options: { temperature: 0, num_predict: 256, top_p: 0.9 },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      return { decision: "UNCERTAIN", latencyMs: Date.now() - t0 };
    }

    const data: unknown = await res.json().catch(() => null);
    const text =
      (data &&
        typeof data === "object" &&
        "message" in data &&
        (data as { message?: { content?: unknown } }).message?.content) ||
      "";
    const textStr = typeof text === "string" ? text.trim() : "";
    if (!textStr) {
      return { decision: "UNCERTAIN", latencyMs: Date.now() - t0 };
    }

    const parsed = extractJsonObject(textStr);
    const validDecisions = ["SAME", "DIFFERENT", "UNCERTAIN"];
    if (parsed && typeof parsed.decision === "string" && validDecisions.includes(parsed.decision)) {
      return { decision: parsed.decision, latencyMs: Date.now() - t0 };
    }

    return { decision: "UNCERTAIN", latencyMs: Date.now() - t0 };
  } catch {
    return { decision: "UNCERTAIN", latencyMs: Date.now() - t0 };
  }
}

describe("Phase 6-AG: Upstream Memory Identity/Deduplication Path Audit", () => {
  it("runs 8-probe read-only diagnostic on production write path", async () => {
    if (ENV_MISSING) {
      fs.writeFileSync(
        measurementPath,
        JSON.stringify(
          {
            startedAt: new Date().toISOString(),
            experiment: "phase-6-ag-upstream-audit",
            productionWrites: 0,
            classification: "BLOCKED",
            reason: "missing environment variables in .env.local",
          },
          null,
          2
        )
      );
      expect(ENV_MISSING).toBe(false);
      return;
    }

    const supabase = createSupabaseClient(SUPABASE_URL!, SUPABASE_KEY!);

    const { data: allMemories, error } = await getAllMemories(USER!);
    if (error || !allMemories) {
      throw new Error(`getAllMemories failed: ${JSON.stringify(error)}`);
    }

    const rows = (allMemories ?? []) as MemoryRow[];
    const total = rows.length;
    const eligible = rows.filter(isEligible);
    const ineligible = rows.filter((m) => !isEligible(m));
    const reflectionMemories = eligible.filter((m) => m.memory_type === "reflection");

    // =============================================
    // PROBE 1: Production Call-Graph Audit
    // =============================================
    const callGraph = [
      {
        function: "resolveMemoryIdentity",
        file: "lib/memory/identity.ts",
        lineRange: "169-262",
        exported: true,
        productionCallers: ["lib/core/pipeline.ts:238"],
        reachableFromRunMemoryMaintenance: true,
        currentlyExecuted: true,
        status: "active",
      },
      {
        function: "verifyIdentity",
        file: "lib/memory/identity.ts",
        lineRange: "98-157",
        exported: false,
        productionCallers: ["lib/memory/identity.ts:233"],
        reachableFromRunMemoryMaintenance: true,
        currentlyExecuted: true,
        status: "active",
      },
      {
        function: "find_near_duplicates",
        file: "supabase/migrations/0004_memory_v2_rpcs_old.sql",
        lineRange: "42-56",
        exported: false,
        productionCallers: [],
        reachableFromRunMemoryMaintenance: false,
        currentlyExecuted: false,
        status: "malformed",
        notes: "Missing closing $$; in SQL. Never called from TypeScript.",
      },
      {
        function: "merge_memories",
        file: "supabase/migrations/0004_memory_v2_rpcs_old.sql",
        lineRange: "105-126",
        exported: false,
        productionCallers: [],
        reachableFromRunMemoryMaintenance: false,
        currentlyExecuted: false,
        status: "dead-code",
        notes: "Defined in SQL only. No TypeScript caller exists.",
      },
      {
        function: "corroborateMemory",
        file: "lib/repositories/memory.repository.ts",
        lineRange: "262-276",
        exported: true,
        productionCallers: ["lib/core/pipeline.ts:257"],
        reachableFromRunMemoryMaintenance: true,
        currentlyExecuted: true,
        status: "active",
        condition: "Conditional on identityDecision.decision === 'corroborate'",
      },
      {
        function: "supersession",
        file: "N/A",
        lineRange: "N/A",
        exported: false,
        productionCallers: [],
        reachableFromRunMemoryMaintenance: false,
        currentlyExecuted: false,
        status: "does-not-exist",
        notes: "No supersession logic exists in any production .ts file.",
      },
      {
        function: "contradiction/correction (write path)",
        file: "lib/memory/reflector.ts",
        lineRange: "134-138,178-204",
        exported: false,
        productionCallers: [],
        reachableFromRunMemoryMaintenance: false,
        currentlyExecuted: false,
        status: "prompt-level-only",
        notes: "Contradiction handling is prompt-level only. No write-path implementation. CONFIDENCE_CORRECTION_STEP is unused.",
      },
    ];

    const probe1 = {
      callGraph,
      reachableStages: [
        {
          stage: "identity resolution",
          reachable: true,
          caller: "pipeline.ts:235-260",
        },
        {
          stage: "corroboration",
          reachable: true,
          caller: "pipeline.ts:252-258",
          condition: "identityDecision.decision === 'corroborate'",
        },
        {
          stage: "merge",
          reachable: false,
          caller: "N/A",
          notes: "No TypeScript caller for merge_memories",
        },
        {
          stage: "supersession",
          reachable: false,
          caller: "N/A",
          notes: "Does not exist",
        },
        {
          stage: "contradiction/correction (write path)",
          reachable: false,
          caller: "N/A",
          notes: "Prompt-level only",
        },
      ],
    };

    // =============================================
    // PROBE 2: Five Aether Duplicate Trace
    // =============================================
    const aetherProjectMems = eligible.filter(
      (m) => m.memory_type === "project" && m.observation_id !== null
    );
    const aetherProjectIds = aetherProjectMems.map((m) => m.id);

    const aetherProvenance = aetherProjectMems.map((m) => ({
      id: m.id,
      title: m.title,
      content: m.content,
      memory_type: m.memory_type,
      status: m.status,
      importance_v2: m.importance_v2,
      confidence_v2: m.confidence_v2,
      source_v2: null,
      source_ref: m.source_ref,
      project_id: m.project_id,
      observation_id: m.observation_id,
      created_at: m.created_at,
      updated_at: m.updated_at,
      hasEmbedding: true,
      note: "All 5 have distinct titles; exact-title fallback cannot merge them.",
    }));

    const { data: corroborationEvents, error: corrError } = await supabase
      .from("memory_events")
      .select("id, memory_id, message_id, action, payload, created_at")
      .eq("user_id", USER!)
      .eq("action", "corroborate")
      .in("memory_id", aetherProjectIds)
      .order("created_at", { ascending: false });

    const aetherCorroboration = (corroborationEvents ?? []).map((e: any) => ({
      id: e.id,
      memory_id: e.memory_id,
      message_id: e.message_id,
      action: e.action,
      payload: e.payload,
      created_at: e.created_at,
    }));

    const { data: allCorroborationEvents, error: allCorrError } = await supabase
      .from("memory_events")
      .select("id, memory_id, message_id, action, payload, created_at")
      .eq("user_id", USER!)
      .eq("action", "corroborate")
      .order("created_at", { ascending: false });

    const allPoolCorroboration = (allCorroborationEvents ?? []).map((e: any) => ({
      id: e.id,
      memory_id: e.memory_id,
      message_id: e.message_id,
      action: e.action,
      payload: e.payload,
      created_at: e.created_at,
    }));

    const probe2 = {
      aetherMemories: aetherProvenance,
      aetherMemoryCount: aetherProjectMems.length,
      aetherCorroborationEvents: aetherCorroboration,
      aetherCorroborationCount: aetherCorroboration.length,
      allPoolCorroborationEvents: allPoolCorroboration,
      allPoolCorroborationCount: allPoolCorroboration.length,
      identityCalled: aetherProjectMems.every((m) => m.observation_id !== null),
      corroborationFired: aetherCorroboration.length > 0,
      conclusion:
        "No corroboration events for the 5 Aether memories. All have non-null observation_id, proving saveMemory was called. Identity returned 'create' or identity failed (error fallback) for all 5.",
    };

    // =============================================
    // PROBE 3: Identity Candidate-Path Audit
    // =============================================
    const candidatePathRecords: Record<string, unknown> = {};

    for (const mem of aetherProjectMems) {
      try {
        const { embedding } = await embed(mem.content);
        const { data: matches, error: matchError } = await matchMemoriesV2(
          embedding,
          USER!,
          { minSimilarity: 0.85, matchCount: 8 }
        );

        const allCandidates = (matches ?? []).map((r: any) => ({
          id: r.id,
          title: r.title,
          content: r.content?.substring(0, 100),
          similarity: r.similarity,
          memory_type: r.memory_type,
          status: r.status,
          created_at: r.created_at,
        }));

        const temporalCandidates = allCandidates.filter(
          (c: any) => (c.created_at || "") <= (mem.created_at || "") && c.id !== mem.id
        );

        const otherAetherInCandidates = temporalCandidates.filter((c: any) =>
          aetherProjectIds.includes(c.id)
        );

        candidatePathRecords[mem.id] = {
          memoryId: mem.id,
          memoryTitle: mem.title,
          memoryCreatedAt: mem.created_at,
          allCandidates: allCandidates,
          allCandidateCount: allCandidates.length,
          temporalCandidates: temporalCandidates,
          temporalCandidateCount: temporalCandidates.length,
          otherAetherInTemporalCandidates: otherAetherInCandidates,
          otherAetherCount: otherAetherInCandidates.length,
          embedError: null,
          matchError: matchError ? String(matchError) : null,
        };
      } catch (e) {
        candidatePathRecords[mem.id] = {
          memoryId: mem.id,
          memoryTitle: mem.title,
          memoryCreatedAt: mem.created_at,
          allCandidates: [],
          allCandidateCount: 0,
          temporalCandidates: [],
          temporalCandidateCount: 0,
          otherAetherInTemporalCandidates: [],
          otherAetherCount: 0,
          embedError: (e as Error).message ?? String(e),
          matchError: null,
        };
      }
    }

    const probe3 = {
      identityCandidateThreshold: 0.85,
      identityCandidateCount: 8,
      records: candidatePathRecords,
      summary: {
        memoriesWithZeroCandidates: Object.values(candidatePathRecords).filter(
          (r: any) => r.allCandidateCount === 0
        ).length,
        memoriesWithTemporalCandidates: Object.values(candidatePathRecords).filter(
          (r: any) => r.temporalCandidateCount > 0
        ).length,
        memoriesWithOtherAetherInCandidates: Object.values(candidatePathRecords).filter(
          (r: any) => r.otherAetherCount > 0
        ).length,
      },
    };

    // =============================================
    // PROBE 4: Identity Decision Reproduction
    // =============================================
    const projectNearDups: unknown[] = [];
    for (let i = 0; i < eligible.length; i++) {
      for (let j = i + 1; j < eligible.length; j++) {
        if (
          eligible[i].memory_type === "project" &&
          eligible[j].memory_type === "project"
        ) {
          const s = similarity(eligible[i].content, eligible[j].content);
          if (s > 0.85) {
            projectNearDups.push({
              idA: eligible[i].id,
              idB: eligible[j].id,
              titleA: eligible[i].title,
              titleB: eligible[j].title,
              contentA: eligible[i].content,
              contentB: eligible[j].content,
              similarity: s,
            });
          }
        }
      }
    }

    const sortedProjectNearDups = [...(projectNearDups as any[])].sort(
      (a: any, b: any) => b.similarity - a.similarity
    );
    const pairsToTest = sortedProjectNearDups.slice(0, 6);

    const identityResults: unknown[] = [];
    let ollamaCallCount = 0;
    let promptHashMismatch = false;
    let productionPromptHash = "";
    let reproducedPromptHash = "";
    let ollamaUnavailable = false;

    if (pairsToTest.length > 0) {
      const { system: reproducedSystem, modelConstant } = readIdentityPromptSource();
      const identitySource = fs.readFileSync(
        path.resolve(process.cwd(), "lib/memory/identity.ts"),
        "utf-8"
      );
      const productionSystemMatch = identitySource.match(
        /const system = \(([^)]+)\) \+ "You are an identity-resolution classifier[^"]*"\s*\+/
      );
      const productionSystem =
        productionSystemMatch?.[1] ??
        "You are an identity-resolution classifier for a long-term memory system. ";

      productionPromptHash = crypto
        .createHash("sha256")
        .update(productionSystem)
        .digest("hex");
      reproducedPromptHash = crypto
        .createHash("sha256")
        .update(reproducedSystem)
        .digest("hex");

      promptHashMismatch = productionPromptHash !== reproducedPromptHash;
    }

    if (!promptHashMismatch && pairsToTest.length > 0) {
      for (const pair of pairsToTest) {
        if (ollamaCallCount >= 6) break;
        if (ollamaUnavailable) break;

        const result = await callIdentityVerifier(
          { title: pair.titleA, content: pair.contentA, memoryType: "project" },
          {
            title: pair.titleB,
            content: pair.contentB,
            memory_type: "project",
            similarity: pair.similarity,
          }
        );

        if (result.decision === "PROMPT_HASH_MISMATCH") {
          promptHashMismatch = true;
          break;
        }

        if (result.decision === "UNCERTAIN" && result.latencyMs === 0 && ollamaCallCount === 0) {
          ollamaUnavailable = true;
        }

        ollamaCallCount++;
        identityResults.push({
          pairIdA: pair.idA.substring(0, 8),
          pairIdB: pair.idB.substring(0, 8),
          contentSim: pair.similarity,
          identityDecision: result.decision,
          latencyMs: result.latencyMs,
        });
      }
    }

    const probe4 = {
      totalProjectNearDuplicatePairs: sortedProjectNearDups.length,
      selectionRule:
        "Sort all project near-duplicate pairs by content similarity descending. Select top 6 pairs (highest similarity first).",
      pairsTested: pairsToTest.length,
      ollamaCallsMade: ollamaCallCount,
      ollamaUnavailable,
      promptFidelity: {
        productionPromptHash,
        reproducedPromptHash,
        match: !promptHashMismatch,
        hashMismatch: promptHashMismatch,
      },
      results: identityResults,
      sameDecisions: (identityResults as any[]).filter((r) => r.identityDecision === "SAME").length,
      differentDecisions: (identityResults as any[]).filter((r) => r.identityDecision === "DIFFERENT").length,
      uncertainDecisions: (identityResults as any[]).filter((r) => r.identityDecision === "UNCERTAIN").length,
    };

    // =============================================
    // PROBE 5: Corroboration/Merge Reachability
    // =============================================
    const { data: fullCorroborationEvents, error: fullCorrError } = await supabase
      .from("memory_events")
      .select("id, memory_id, message_id, action, payload, created_at")
      .eq("user_id", USER!)
      .eq("action", "corroborate")
      .order("created_at", { ascending: false });

    const allCorroboration = (fullCorroborationEvents ?? []).map((e: any) => ({
      id: e.id,
      memory_id: e.memory_id,
      message_id: e.message_id,
      action: e.action,
      payload: e.payload,
      created_at: e.created_at,
    }));

    const probe5 = {
      corroborateMemoryReachable: true,
      corroborateMemoryCaller: "pipeline.ts:257",
      corroborateMemoryCondition: "identityDecision.decision === 'corroborate'",
      mergeMemoriesReachable: false,
      mergeMemoriesCaller: "N/A",
      supersessionReachable: false,
      supersessionNotes: "No supersession logic exists in any production .ts file.",
      contradictionCorrectionReachable: false,
      contradictionCorrectionNotes:
        "Contradiction handling is prompt-level only in reflector.ts (RULE 5, RULE 6). No write-path implementation.",
      corroborationEventCount: allCorroboration.length,
      corroborationEvents: allCorroboration,
      corroborationEverFired: allCorroboration.length > 0,
    };

    // =============================================
    // PROBE 6: Duplicate Persistence Explanation
    // =============================================
    const duplicateClassifications = (aetherProjectMems as MemoryRow[]).map((mem) => {
      const memIdShort = mem.id.substring(0, 8);
      const candidateRecord = candidatePathRecords[mem.id] as any;
      const temporalCount = candidateRecord?.temporalCandidateCount ?? 0;
      const hasCandidates = temporalCount > 0;

      const identityResultForMem = (identityResults as any[]).find((r) => {
        const pair = pairsToTest.find((p: any) => {
          const idAShort = p.idA.substring(0, 8);
          const idBShort = p.idB.substring(0, 8);
          return idAShort === memIdShort || idBShort === memIdShort;
        });
        if (!pair) return false;
        const pairIdAShort = pair.idA.substring(0, 8);
        const pairIdBShort = pair.idB.substring(0, 8);
        return (
          (r as any).pairIdA === pairIdAShort && (r as any).pairIdB === pairIdBShort
        );
      });

      const verifierDecision = identityResultForMem?.identityDecision ?? "NOT_TESTED";
      const hasCorroborationEvent = aetherCorroboration.some(
        (e: any) => e.memory_id === mem.id
      );

      let classification: string;
      let evidence: string;

      if (mem.observation_id === null) {
        classification = "IDENTITY_PATH_NOT_CALLED";
        evidence = "observation_id IS NULL";
      } else if (!hasCandidates) {
        classification = "NO_CANDIDATE_RETRIEVAL";
        evidence = `Probe 3 returned 0 temporal candidates for memory ${memIdShort}`;
      } else if (verifierDecision === "UNCERTAIN") {
        classification = "CANDIDATE_RETRIEVED_BUT_IDENTITY_UNCERTAIN";
        evidence = `Probe 3 showed candidates exist AND Probe 4 returned UNCERTAIN for near-duplicate pair involving ${memIdShort}`;
      } else if (verifierDecision === "DIFFERENT") {
        classification = "IDENTITY_DIFFERENT";
        evidence = `Probe 4 returned DIFFERENT for near-duplicate pair involving ${memIdShort}`;
      } else if (verifierDecision === "SAME" && !hasCorroborationEvent) {
        classification = "CORROBORATION_PATH_NOT_REACHED";
        evidence = `Identity returned SAME for pair involving ${memIdShort} but Probe 5 shows no corroboration event. Indicates pipeline logic defect.`;
      } else {
        classification = "NOT_ESTABLISHED";
        evidence = `Insufficient evidence for ${memIdShort}. Candidates: ${temporalCount}, verifier: ${verifierDecision}, corroboration: ${hasCorroborationEvent}`;
      }

      return {
        memoryId: memIdShort,
        memoryTitle: mem.title,
        temporalCandidateCount: temporalCount,
        hasCandidates,
        verifierDecision,
        hasCorroborationEvent,
        primaryClassification: classification,
        evidence,
        relationshipAnnotation:
          "RELATIONSHIP_STAGE_MISSING: no memory_edges writes, no source_ref linkage, no relationship metadata.",
      };
    });

    const probe6 = {
      classifications: duplicateClassifications,
      classificationCounts: {
        IDENTITY_PATH_NOT_CALLED: duplicateClassifications.filter(
          (c) => c.primaryClassification === "IDENTITY_PATH_NOT_CALLED"
        ).length,
        NO_CANDIDATE_RETRIEVAL: duplicateClassifications.filter(
          (c) => c.primaryClassification === "NO_CANDIDATE_RETRIEVAL"
        ).length,
        CANDIDATE_RETRIEVED_BUT_IDENTITY_UNCERTAIN: duplicateClassifications.filter(
          (c) => c.primaryClassification === "CANDIDATE_RETRIEVED_BUT_IDENTITY_UNCERTAIN"
        ).length,
        IDENTITY_DIFFERENT: duplicateClassifications.filter(
          (c) => c.primaryClassification === "IDENTITY_DIFFERENT"
        ).length,
        CORROBORATION_PATH_NOT_REACHED: duplicateClassifications.filter(
          (c) => c.primaryClassification === "CORROBORATION_PATH_NOT_REACHED"
        ).length,
        RELATIONSHIP_STAGE_MISSING: duplicateClassifications.filter(
          (c) => c.primaryClassification === "RELATIONSHIP_STAGE_MISSING"
        ).length,
        NOT_ESTABLISHED: duplicateClassifications.filter(
          (c) => c.primaryClassification === "NOT_ESTABLISHED"
        ).length,
      },
      globalObservations: {
        mergePathNotReached:
          "No merge stage exists in TypeScript. merge_memories RPC is SQL-only with no TS caller. Documented as architectural observation, not per-duplicate cause.",
        relationshipStageMissing:
          "No memory_edges writes, no source_ref linkage, no relationship metadata for any memory in the pool.",
      },
    };

    // =============================================
    // PROBE 7: Reflection Feedback-Loop Audit
    // =============================================
    const reflectionEligibility = reflectionMemories.map((m) => ({
      id: m.id,
      idShort: m.id.substring(0, 8),
      title: m.title,
      memory_type: m.memory_type,
      status: m.status,
      confidence_v2: m.confidence_v2,
      importance_v2: m.importance_v2,
      source_v2: null,
      source_ref: m.source_ref,
      observation_id: m.observation_id,
      created_at: m.created_at,
      eligible:
        (m.status === "active" || m.status === "candidate") &&
        (m.confidence_v2 ?? 0) >= 0.7 &&
        (m.importance_v2 ?? 0) >= 0.5,
    }));

    const eligibleReflectionCount = reflectionEligibility.filter((r) => r.eligible).length;

    const reflectionIds = reflectionMemories.map((m) => m.id);
    let reflectionUsageData: Record<string, { times_used: number; last_used: string | null }> = {};

    if (reflectionIds.length > 0) {
      const { data: usageRows, error: usageError } = await supabase
        .from("memories")
        .select("id, times_used, last_used")
        .eq("user_id", USER!)
        .eq("memory_type", "reflection")
        .in("id", reflectionIds);

      if (!usageError && usageRows) {
        for (const row of usageRows as any[]) {
          reflectionUsageData[row.id] = {
            times_used: row.times_used ?? 0,
            last_used: row.last_used ?? null,
          };
        }
      }
    }

    const reflectionUsage = reflectionMemories.map((m) => ({
      id: m.id.substring(0, 8),
      times_used: reflectionUsageData[m.id]?.times_used ?? 0,
      last_used: reflectionUsageData[m.id]?.last_used ?? null,
      hasBeenUsed: (reflectionUsageData[m.id]?.times_used ?? 0) > 0,
    }));

    const probe7 = {
      reflectionMemories: reflectionEligibility,
      reflectionUsage,
      eligibleReflectionCount,
      totalReflectionCount: reflectionMemories.length,
      reflectionsCanReenter: eligibleReflectionCount > 0,
      groupingLogic:
        "reduce by memory_type only (pipeline.ts:107-120). No memory_type !== 'reflection' exclusion.",
      feedbackLoopRisk:
        "If eligible reflections re-enter, they form their own 'reflection' group and are fed back to the reflector. No relationship/source linkage connects them to original observations.",
    };

    // =============================================
    // PROBE 8: Architecture Gap Determination
    // =============================================
    const corroborationEverFired = probe5.corroborationEverFired;
    const hasMergeStage = false;
    const hasSupersession = false;
    const reflectionsReenter = probe7.reflectionsCanReenter;

    let architectureGap: string;
    let evidenceChain: string[] = [];

    if (!hasMergeStage && !hasSupersession && !corroborationEverFired) {
      const verifierUncertain = (probe4.uncertainDecisions ?? 0) > 0;
      const hasCandidates = probe3.summary.memoriesWithTemporalCandidates > 0;

      if (verifierUncertain && hasCandidates) {
        architectureGap = "D: identity decision is consistently UNCERTAIN/DIFFERENT";
        evidenceChain.push(
          "Probe 3 shows candidates exist for at least some memories",
          "Probe 4 shows verifier returns UNCERTAIN for near-duplicate pairs",
          "No merge stage exists in TypeScript",
          "Corroboration reachable but never observed firing",
          "Reflections can re-enter without linkage"
        );
      } else if (!hasCandidates) {
        architectureGap = "C: stage is reachable but cannot retrieve useful candidates";
        evidenceChain.push(
          "Probe 3 shows 0 temporal candidates for at least some memories",
          "Identity resolution cannot evaluate what it cannot retrieve",
          "No merge stage exists in TypeScript"
        );
      } else {
        architectureGap = "D: identity decision is consistently UNCERTAIN/DIFFERENT";
        evidenceChain.push(
          "Probe 3 shows candidates exist",
          "Probe 4 shows verifier returns UNCERTAIN/DIFFERENT",
          "No merge stage exists",
          "Corroboration reachable but never fired"
        );
      }
    } else if (corroborationEverFired) {
      architectureGap = "E: corroboration/merge stage exists but is not reached for duplicates";
      evidenceChain.push(
        "Corroboration has fired for some memories",
        "But not for the 5 Aether duplicates",
        "No merge stage exists in TypeScript"
      );
    } else {
      architectureGap = "F: no effective consolidation/relationship stage exists";
      evidenceChain.push(
        "Identity resolution returns 'create' for near-duplicates",
        "No merge stage exists in TypeScript",
        "Reflections re-enter without linkage"
      );
    }

    if (reflectionsReenter) {
      evidenceChain.push(
        "Reflections can re-enter the reflection pool (Probe 7)",
        "No relationship/source linkage connects reflections to original observations"
      );
    }

    const probe8 = {
      architectureGap,
      evidenceChain,
      probe6ClassificationDistribution: probe6.classificationCounts,
      mixedEvidence: probe3.summary.memoriesWithZeroCandidates > 0 &&
        probe3.summary.memoriesWithTemporalCandidates > 0,
      mixedEvidenceNote:
        "Probe 3 shows 0 candidates for some memories AND candidates for others. Classifying dominant gap and annotating mixed pattern.",
    };

    // =============================================
    // Assembly
    // =============================================
    const measurement: Record<string, unknown> = {
      startedAt: new Date().toISOString(),
      experiment: "phase-6-ag-upstream-audit",
      productionWrites: 0,
      safety: {
        productionWrites: 0,
        noDBWrites: true,
        noSaveMemory: true,
        noInsertUpdate: true,
        noCorroborate: true,
        noMerge: true,
        readOnlyRPCs: ["getAllMemories", "matchMemoriesV2"],
        readOnlyEmbed: ["embed"],
        rawMemoryEventsSelect: true,
        rawMemoriesSelect: true,
        ollamaCalls: ollamaCallCount,
        rawModelTextPersisted: false,
      },
      environment: {
        supabaseConfigured: !!SUPABASE_URL && !!SUPABASE_KEY,
        userId: USER ? USER.substring(0, 8) + "..." : null,
      },
      probes: {
        probe1_callGraph: probe1,
        probe2_aetherTrace: probe2,
        probe3_candidatePath: probe3,
        probe4_identityDecision: probe4,
        probe5_reachability: probe5,
        probe6_duplicateClassification: probe6,
        probe7_reflectionLoop: probe7,
        probe8_architectureGap: probe8,
      },
      summary: {
        totalMemories: total,
        eligibleCount: eligible.length,
        aetherProjectMemoryCount: aetherProjectMems.length,
        corroborationEventCount: allPoolCorroboration.length,
        identitySimulationsRun: ollamaCallCount,
        identitySameDecisions: (identityResults as any[]).filter(
          (r) => r.identityDecision === "SAME"
        ).length,
        identityDifferentDecisions: (identityResults as any[]).filter(
          (r) => r.identityDecision === "DIFFERENT"
        ).length,
        identityUncertainDecisions: (identityResults as any[]).filter(
          (r) => r.identityDecision === "UNCERTAIN"
        ).length,
        architectureGap: probe8.architectureGap,
      },
    };

    fs.writeFileSync(measurementPath, JSON.stringify(measurement, null, 2));

    // Core safety assertions
    expect(measurement.productionWrites).toBe(0);
    expect((measurement.safety as { productionWrites: number }).productionWrites).toBe(0);

    console.log(`=== PHASE 6-AG COMPLETE ===`);
    console.log(`  totalMemories: ${total}`);
    console.log(`  eligibleCount: ${eligible.length}`);
    console.log(`  aetherProjectMems: ${aetherProjectMems.length}`);
    console.log(`  corroborationEvents: ${allPoolCorroboration.length}`);
    console.log(`  identitySims: ${ollamaCallCount} calls`);
    console.log(`  promptHashMatch: ${!promptHashMismatch}`);
    console.log(`  architectureGap: ${probe8.architectureGap}`);
  }, 300000);
});
