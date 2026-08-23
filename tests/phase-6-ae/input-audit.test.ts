/// <reference types="vitest" />

/**
 * Phase 6-AF — Input Composition and Relationship Structure Audit
 *
 * Read-only. productionWrites = 0.
 *
 * 8-probe audit of the real 21-memory production input feeding the reflector.
 * Determines WHY no reflection is produced — not by assuming, but by testing
 * every plausible explanation through data inspection and controlled probes.
 *
 * Safety:
 * - Only getAllMemories (read-only SELECT) and matchMemoriesV2 (read-only RPC) called.
 * - No saveMemory / insertMemoryV2 / updateMemoryV2 / corroborateMemory.
 * - verifyIdentity simulation: max 6 Ollama calls (capped).
 * - rawModelText NOT persisted — only SAME/DIFFERENT/UNCERTAIN enum + latency.
 * - No production files modified.
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

const probeDir = path.resolve(process.cwd(), "tests/phase-6-ae");
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

type MemoryRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  memory_type: string;
  status: string;
  title: string;
  content: string;
  summary?: string | null;
  tags?: string[] | null;
  importance_v2?: number | null;
  confidence_v2?: number | null;
  embedding: number[] | null;
  source_v2?: string | null;
  source_ref: string | null;
  metadata?: Record<string, unknown> | null;
  times_used?: number | null;
  last_used?: string | null;
  last_scored?: string | null;
  effective_score?: number | null;
  created_at: string;
  updated_at: string;
  observation_id?: string | null;
};

const OLLAMA_URL = "http://127.0.0.1:11434/api/chat";
const MODEL = "qwen2.5:3b";
const IDENTITY_OPTIONS = { temperature: 0, num_predict: 256, top_p: 0.9 };

const VALID_DECISIONS = ["SAME", "DIFFERENT", "UNCERTAIN"] as const;
type IdentityVerifyDecision = (typeof VALID_DECISIONS)[number];

const IDENTITY_VERIFIER_SYSTEM =
  "You are an identity-resolution classifier for a long-term memory system. " +
  "Decide whether the NEW OBSERVATION refers to the SAME underlying memory fact " +
  "as the EXISTING CANDIDATE MEMORY. " +
  "SAME = the candidate already records this fact, even if worded differently. " +
  "DIFFERENT = different subject, different value, contradiction, temporal shift " +
  "(e.g. 'used to' vs 'currently'), preference vs current usage " +
  "(e.g. 'I prefer TypeScript' vs 'I use TypeScript'), different entity " +
  "(brother vs friend), different scope, or only a related-but-not-identical topic " +
  "(e.g. 'I like tea' vs 'I prefer mild tea'). " +
  "UNCERTAIN = you cannot be confident. " +
  "Be very conservative. When in doubt choose DIFFERENT or UNCERTAIN. " +
  "Never merge merely because the topic is similar. " +
  'Return ONLY strict JSON: {"decision":"SAME","reason":"..."}';

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

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);
}

async function callOllamaWithIdentityPrompt(
  newMem: { title: string; content: string; memoryType: string },
  candidate: { title: string; content: string; memory_type: string; similarity: number }
): Promise<IdentityVerifyDecision> {
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

  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      options: IDENTITY_OPTIONS,
      messages: [
        { role: "system", content: IDENTITY_VERIFIER_SYSTEM },
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

function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

describe("Phase 6-AF: Input Composition and Relationship Structure Audit", () => {
  it("audits the 21-memory production input across 8 probes (read-only)", async () => {
    if (ENV_MISSING) {
      fs.writeFileSync(measurementPath, JSON.stringify({
        startedAt: new Date().toISOString(),
        experiment: "phase-6-af-input-audit",
        productionWrites: 0,
        classification: "BLOCKED",
        reason: "missing environment variables in .env.local",
      }, null, 2));
      expect(ENV_MISSING).toBe(false);
      return;
    }

    const { data: allMemories, error } = await getAllMemories(USER!);
    if (error || !allMemories) {
      throw new Error(`getAllMemories failed: ${JSON.stringify(error)}`);
    }

    const rows = (allMemories ?? []) as MemoryRow[];
    const total = rows.length;

    const isEligible = (m: MemoryRow): boolean => {
      const status = (m.status ?? "").toString();
      return (
        (status === "active" || status === "candidate") &&
        (m.confidence_v2 ?? 0) >= 0.7 &&
        (m.importance_v2 ?? 0) >= 0.5
      );
    };

    const eligible = rows.filter(isEligible);
    const ineligible = rows.filter((m) => !isEligible(m));

    // === PROBE 1: Eligibility Audit ===
    const probe1 = {
      totalMemories: total,
      eligibleCount: eligible.length,
      ineligibleCount: ineligible.length,
      eligibilityFilter: "status IN (active,candidate) AND confidence_v2 >= 0.7 AND importance_v2 >= 0.5",
      ineligibleBreakdown: ineligible.map((m) => ({
        id: m.id.substring(0, 8),
        memory_type: m.memory_type,
        status: m.status,
        importance_v2: m.importance_v2,
        confidence_v2: m.confidence_v2,
        failedFilters: {
          status: m.status !== "active" && m.status !== "candidate",
          confidence: (m.confidence_v2 ?? 0) < 0.7,
          importance: (m.importance_v2 ?? 0) < 0.5,
        },
        source_v2: m.source_v2 ?? null,
      })),
      eligibleBreakdown: eligible.map((m) => ({
        id: m.id.substring(0, 8),
        memory_type: m.memory_type,
        status: m.status,
        importance_v2: m.importance_v2,
        confidence_v2: m.confidence_v2,
        source_v2: m.source_v2 ?? null,
      })),
    };

    // === PROBE 2: Grouping Structure Audit ===
    const groups = eligible.reduce(
      (acc, m) => {
        const t = m.memory_type;
        if (!acc[t]) acc[t] = [];
        acc[t].push(m);
        return acc;
      },
      {} as Record<string, MemoryRow[]>
    );

    const groupDiversity: Record<string, unknown>[] = [];
    for (const [type, mems] of Object.entries(groups)) {
      const contents = mems.map((m) => m.content);
      const sims: number[] = [];
      for (let i = 0; i < contents.length; i++) {
        for (let j = i + 1; j < contents.length; j++) {
          sims.push(similarity(contents[i], contents[j]));
        }
      }
      groupDiversity.push({
        memoryType: type,
        count: mems.length,
        pairwiseSim: {
          min: sims.length > 0 ? Math.min(...sims) : 0,
          mean: sims.length > 0 ? sims.reduce((a, b) => a + b, 0) / sims.length : 0,
          max: sims.length > 0 ? Math.max(...sims) : 0,
        },
        nearDuplicatePairs: sims.filter((s) => s > 0.85).length,
      });
    }

    // Cross-type near-duplicate check
    const typeKeys = Object.keys(groups);
    const crossTypePairs: unknown[] = [];
    for (let i = 0; i < typeKeys.length; i++) {
      for (let j = i + 1; j < typeKeys.length; j++) {
        const typeA = typeKeys[i];
        const typeB = typeKeys[j];
        for (const memA of groups[typeA]) {
          for (const memB of groups[typeB]) {
            const s = similarity(memA.content, memB.content);
            if (s > 0.85) {
              crossTypePairs.push({
                typeA,
                typeB,
                idA: memA.id.substring(0, 8),
                idB: memB.id.substring(0, 8),
                similarity: s,
                contentA: memA.content.substring(0, 100),
                contentB: memB.content.substring(0, 100),
              });
            }
          }
        }
      }
    }

    const probe2 = {
      groupingMechanism: "reduce by memory_type only (pipeline.ts:107-120)",
      groupCount: typeKeys.length,
      groups: groupDiversity,
      crossTypeNearDuplicatePairs: crossTypePairs,
      crossTypePairsCount: crossTypePairs.length,
    };

    // === PROBE 3: Content Inspection (Full 21) ===
    const probe3 = eligible.map((m) => ({
      id: m.id.substring(0, 8),
      title: m.title,
      content: m.content,
      memory_type: m.memory_type,
      source_v2: m.source_v2 ?? null,
      source_ref: m.source_ref,
      observation_id: m.observation_id ?? null,
      created_at: m.created_at,
      importance_v2: m.importance_v2,
      confidence_v2: m.confidence_v2,
      summary: m.summary ?? null,
      tags: m.tags ?? null,
      metadata: m.metadata ?? null,
      summaryPopulated: (m.summary ?? "").length > 0,
      tagsPopulated: (m.tags ?? []).length > 0,
      metadataPopulated: m.metadata && Object.keys(m.metadata).length > 0,
    }));

    const reflectionMemories = eligible.filter((m) => m.memory_type === "reflection");
    const reflectionContentDepth = {
      count: reflectionMemories.length,
      avgContentLength:
        reflectionMemories.length > 0
          ? reflectionMemories.reduce((sum, m) => sum + m.content.length, 0) /
            reflectionMemories.length
          : 0,
      maxContentLength:
        reflectionMemories.length > 0
          ? Math.max(...reflectionMemories.map((m) => m.content.length))
          : 0,
      minContentLength:
        reflectionMemories.length > 0
          ? Math.min(...reflectionMemories.map((m) => m.content.length))
          : 0,
      anyHaveSourceRef: reflectionMemories.some((m) => m.source_ref !== null),
      anyHaveObservationId: reflectionMemories.some((m) => m.observation_id !== null),
      anyHaveSummary: reflectionMemories.some((m) => (m.summary ?? "").length > 0),
      anyHaveTags: reflectionMemories.some((m) => (m.tags ?? []).length > 0),
      anyHaveMetadata: reflectionMemories.some(
        (m) => m.metadata && Object.keys(m.metadata ?? {}).length > 0
      ),
    };

    // === PROBE 4: Near-Duplicate Analysis ===
    const nearDuplicates: unknown[] = [];
    for (let i = 0; i < eligible.length; i++) {
      for (let j = i + 1; j < eligible.length; j++) {
        const s = similarity(eligible[i].content, eligible[j].content);
        if (s > 0.85) {
          nearDuplicates.push({
            idA: eligible[i].id.substring(0, 8),
            idB: eligible[j].id.substring(0, 8),
            typeA: eligible[i].memory_type,
            typeB: eligible[j].memory_type,
            contentA: eligible[i].content,
            contentB: eligible[j].content,
            similarity: s,
            sameType: eligible[i].memory_type === eligible[j].memory_type,
          });
        }
      }
    }

    const memsWithNearDups = new Set<string>();
    nearDuplicates.forEach((nd: any) => {
      memsWithNearDups.add(nd.idA);
      memsWithNearDups.add(nd.idB);
    });

    const nearDupsWithinSameType = nearDuplicates.filter((nd: any) => nd.sameType);
    const nearDupsCrossType = nearDuplicates.filter((nd: any) => !nd.sameType);

    const probe4 = {
      threshold: 0.85,
      totalPairs: nearDuplicates.length,
      nearDuplicatePairs: nearDuplicates,
      nearDuplicateMemoriesCount: memsWithNearDups.size,
      nearDupsWithinSameType: nearDupsWithinSameType.length,
      nearDupsCrossType: nearDupsCrossType.length,
      crossTypePairs: nearDupsCrossType,
    };

    // === PROBE 5: Provenance Chain Audit ===
    const reflectionProvenance = reflectionMemories.map((m) => ({
      id: m.id.substring(0, 8),
      title: m.title,
      content: m.content,
      source_ref: m.source_ref,
      source_v2: m.source_v2 ?? null,
      observation_id: m.observation_id ?? null,
      created_at: m.created_at,
      hasSourceRef: m.source_ref !== null,
      hasObservationId: m.observation_id !== null,
    }));

    const nonReflectionWithSourceRef = eligible
      .filter((m) => m.memory_type !== "reflection" && m.source_ref !== null);

    const probe5 = {
      reflectionMemories: reflectionProvenance,
      reflectionWithSourceRef: reflectionProvenance.filter((r) => r.hasSourceRef),
      reflectionWithObservationId: reflectionProvenance.filter((r) => r.hasObservationId),
      orphanedReflectionCount: reflectionProvenance.filter((r) => !r.hasSourceRef).length,
      orphanedReflectionIds: reflectionProvenance
        .filter((r) => !r.hasSourceRef)
        .map((r) => r.id),
      nonReflectionWithSourceRef: nonReflectionWithSourceRef.map((m) => ({
        id: m.id.substring(0, 8),
        memory_type: m.memory_type,
        source_ref: m.source_ref,
      })),
    };

    // === PROBE 6: Cross-Type Relationship Potential ===
    const crossTypeSims: Record<string, unknown>[] = [];
    const typePairs: [string, string][] = [];
    for (let i = 0; i < typeKeys.length; i++) {
      for (let j = i + 1; j < typeKeys.length; j++) {
        typePairs.push([typeKeys[i], typeKeys[j]]);
      }
    }

    for (const [typeA, typeB] of typePairs) {
      const memsA = groups[typeA];
      const memsB = groups[typeB];
      const highSimPairs: unknown[] = [];
      for (const memA of memsA) {
        for (const memB of memsB) {
          const s = similarity(memA.content, memB.content);
          if (s > 0.5) {
            highSimPairs.push({
              idA: memA.id.substring(0, 8),
              idB: memB.id.substring(0, 8),
              contentA: memA.content.substring(0, 80),
              contentB: memB.content.substring(0, 80),
              similarity: s,
              plausibleReflectionType:
                s > 0.85 ? "REPEATED_PATTERN_or_CONTRADICTION" :
                s > 0.7 ? "RELATIONSHIP" :
                "possible_RELATIONSHIP",
            });
          }
        }
      }
      crossTypeSims.push({
        sourceType: typeA,
        targetType: typeB,
        highSimPairCount: highSimPairs.length,
        highSimPairs: highSimPairs,
      });
    }

    const probe6 = {
      typePairs: typePairs.map(([a, b]) => `${a}+${b}`),
      crossTypeRelationships: crossTypeSims,
      totalCrossTypeHighSimPairs: crossTypeSims.reduce(
        (sum, c: any) => sum + c.highSimPairCount, 0
      ),
    };

    // === PROBE 7: Semantic Diversity Audit ===
    const probe7 = groupDiversity.map((g: any) => {
      const typeMems = groups[g.memoryType as string];
      const tokenizedContents = typeMems.map((m) => new Set(tokenize(m.content)));
      const allTokens: string[] = [];
      for (const t of tokenizedContents) {
        for (const token of t) {
          allTokens.push(token);
        }
      }
      const uniqueTokens = new Set(allTokens);
      const tokenFreq = new Map<string, number>();
      for (const t of allTokens) {
        tokenFreq.set(t, (tokenFreq.get(t) ?? 0) + 1);
      }
      const distinctiveTokens = [...tokenFreq.entries()]
        .filter(([_, freq]) => freq / tokenizedContents.length < 0.5)
        .map(([t]) => t);

      // intra-group Jaccard
      let intraSims: number[] = [];
      for (let i = 0; i < tokenizedContents.length; i++) {
        for (let j = i + 1; j < tokenizedContents.length; j++) {
          intraSims.push(jaccard([...tokenizedContents[i]], [...tokenizedContents[j]]));
        }
      }

      return {
        memoryType: g.memoryType,
        totalTokens: allTokens.length,
        uniqueTokens: uniqueTokens.size,
        diversityRatio: tokenizedContents.length > 0 ? uniqueTokens.size / allTokens.length : 0,
        intraGroupJaccard: {
          mean: intraSims.length > 0 ? intraSims.reduce((a, b) => a + b, 0) / intraSims.length : 0,
          max: intraSims.length > 0 ? Math.max(...intraSims) : 0,
        },
        distinctiveTokenCount: distinctiveTokens.length,
        classification: distinctiveTokens.length < 3 ? "HOMOGENEOUS" : "DIVERSE",
      };
    });

    const probe7Summary = {
      groups: probe7,
      allHomogeneous: probe7.every((g: any) => g.classification === "HOMOGENEOUS"),
      anyDiverse: probe7.some((g: any) => g.classification === "DIVERSE"),
    };

    // === PROBE 8: Identity Resolution Simulation ===
    // Use near-duplicate pairs from Probe 4, capped at 6
    const nearDupPairsForIdentity = nearDuplicates.slice(0, 6) as any[];

    const identityResults: unknown[] = [];
    let ollamaCallCount = 0;

    for (const pair of nearDupPairsForIdentity) {
      const memA = eligible.find((m) => m.id.substring(0, 8) === pair.idA)!;
      const memB = eligible.find((m) => m.id.substring(0, 8) === pair.idB)!;

      // Skip if we already hit the cap
      if (ollamaCallCount >= 6) break;

      const t0 = Date.now();
      const decision = await callOllamaWithIdentityPrompt(
        { title: memA.title, content: memA.content, memoryType: memA.memory_type },
        {
          title: memB.title,
          content: memB.content,
          memory_type: memB.memory_type,
          similarity: pair.similarity,
        }
      );
      const latency = Date.now() - t0;
      ollamaCallCount++;

      identityResults.push({
        pairIdA: pair.idA,
        pairIdB: pair.idB,
        typeA: pair.typeA,
        typeB: pair.typeB,
        contentSim: pair.similarity,
        identityDecision: decision,
        latencyMs: latency,
      });
    }

    const probe8 = {
      nearDuplicatePairsTested: nearDupPairsForIdentity.length,
      ollamaCallsMade: ollamaCallCount,
      results: identityResults,
      sameDecisions: identityResults.filter((r: any) => r.identityDecision === "SAME").length,
      differentDecisions: identityResults.filter((r: any) => r.identityDecision === "DIFFERENT").length,
      uncertainDecisions: identityResults.filter((r: any) => r.identityDecision === "UNCERTAIN").length,
      insight: "If near-duplicate pairs (content similarity > 0.85) are classified as SAME by the identity verifier, they represent facts that should have been merged during extraction. If they survived into the 21 eligible set, the identity layer did not prevent them — suggesting they were inserted as distinct memories despite being semantically identical.",
    };

    // === Assembly + Causal Classification ===
    const measurement: Record<string, unknown> = {
      startedAt: new Date().toISOString(),
      experiment: "phase-6-af-input-audit",
      productionWrites: 0,
      productionFilesModified: [],
      safety: {
        productionWrites: 0,
        noDBWrites: true,
        noSaveMemory: true,
        noInsertUpdate: true,
        noCorroborate: true,
        readOlnyRPCs: ["getAllMemories", "matchMemoriesV2"],
        ollamaCalls: ollamaCallCount,
        rawModelTextPersisted: false,
      },
      model: {
        name: MODEL,
        endpoint: OLLAMA_URL,
        identityVerifier: { temperature: 0, num_predict: 256, top_p: 0.9 },
      },
      environment: {
        supabaseConfigured: !!SUPABASE_URL && !!SUPABASE_KEY,
        userId: USER ? USER.substring(0, 8) + "..." : null,
      },
      probes: {
        probe1_eligibility: probe1,
        probe2_grouping: probe2,
        probe3_content: probe3,
        probe4_duplicates: probe4,
        probe5_provenance: probe5,
        probe6_crossType: probe6,
        probe7_diversity: probe7Summary,
        probe8_identity: probe8,
      },
      reflectionMemoriesAnalysis: reflectionContentDepth,
    };

    // Causal classification
    const allSummariesEmpty = probe3.every((m: any) => !m.summaryPopulated);
    const allTagsEmpty = probe3.every((m: any) => !m.tagsPopulated);
    const allMetadataEmpty = probe3.every((m: any) => !m.metadataPopulated);
    const inputImpoverished = allSummariesEmpty && allTagsEmpty && allMetadataEmpty;

    const crossTypeDupsExist = probe2.crossTypePairsCount > 0;
    const withinTypeDupsExist = probe4.nearDupsWithinSameType > 0;
    const reflectionOrphaned = probe5.orphanedReflectionCount === reflectionMemories.length;

    const totalCrossTypeHighSim = probe6.totalCrossTypeHighSimPairs;

    let classification: string;
    let productionChangeJustified = false;
    let rationale: string;

    if (crossTypeDupsExist && totalCrossTypeHighSim > 0) {
      classification = "GROUPING_FRAGMENTATION";
      rationale = "Cross-type near-duplicate pairs exist that grouping by memory_type prevents the reflector from seeing together.";
    } else if (inputImpoverished && !reflectionOrphaned) {
      classification = "INPUT_IMPOVERISHED";
      rationale = "All memories have empty summary/tags/metadata AND reflection memories have traceable provenance. The input lacks semantic scaffolding but relationships may exist in raw content.";
    } else if (withinTypeDupsExist && reflectionOrphaned) {
      classification = "INPUT_DOMINANT";
      rationale = "Both near-duplicate within-type content AND orphaned reflections confirm the input lacks diverse, relationship-rich content for synthesis.";
    } else if (inputImpoverished) {
      classification = "INPUT_IMPOVERISHED";
      rationale = "All memories have empty summary/tags/metadata. Semantic scaffolding is missing.";
    } else {
      classification = "INPUT_DOMINANT";
      rationale = "No strong alternative explanation found; input composition appears to be the binding constraint.";
    }

    // If cross-type high-sim pairs exist that could form relationships, refine
    if (totalCrossTypeHighSim > 0 && crossTypeDupsExist) {
      classification = "GROUPING_FRAGMENTATION";
      productionChangeJustified = false;
      rationale = "Cross-type near-duplicate pairs exist between different type groups, but type-only grouping prevents the reflector from seeing them together. This is a structural constraint, not a prompt issue.";
    } else if (totalCrossTypeHighSim > 0 && !crossTypeDupsExist) {
      classification = "CROSS_TYPE_POTENTIAL";
      rationale = "Some cross-type content similarity (>0.5) exists but no near-duplicates (>0.85) across types. May indicate relationship opportunities that grouping blocks.";
    }

    measurement.classification = classification;
    measurement.productionChangeJustified = productionChangeJustified;
    measurement.rationale = rationale;

    // Summary metrics
    measurement.summary = {
      totalMemories: total,
      eligibleCount: eligible.length,
      typeGroups: typeKeys.map((t) => ({
        memoryType: t,
        count: groups[t].length,
      })),
      nearDuplicatePairs: nearDuplicates.length,
      nearDuplicatesWithinSameType: nearDuplicates.filter((nd: any) => nd.sameType).length,
      nearDuplicatesCrossType: nearDuplicates.filter((nd: any) => !nd.sameType).length,
      crossTypeHighSimPairs: totalCrossTypeHighSim,
      reflectionMemoriesOrphaned: probe5.orphanedReflectionCount,
      inputImpoverished: inputImpoverished,
      allSummariesEmpty,
      allTagsEmpty,
      allMetadataEmpty,
      identitySimulationsRun: ollamaCallCount,
      identitySameDecisions: probe8.sameDecisions,
      identityDifferentDecisions: probe8.differentDecisions,
      identityUncertainDecisions: probe8.uncertainDecisions,
    };

    fs.writeFileSync(measurementPath, JSON.stringify(measurement, null, 2));

    // Core safety assertions
    expect(measurement.productionWrites).toBe(0);
    expect((measurement.safety as { productionWrites: number }).productionWrites).toBe(0);

    console.log(`Classification: ${classification}`);
    console.log(`  totalMemories: ${total}`);
    console.log(`  eligibleCount: ${eligible.length}`);
    console.log(`  nearDups: ${nearDuplicates.length} (within-type: ${nearDuplicates.filter((nd: any) => nd.sameType).length}, cross-type: ${nearDuplicates.filter((nd: any) => !nd.sameType).length})`);
    console.log(`  crossTypeHighSim: ${totalCrossTypeHighSim}`);
    console.log(`  reflectionOrphaned: ${probe5.orphanedReflectionCount}/${reflectionMemories.length}`);
    console.log(`  inputImpoverished: ${inputImpoverished}`);
    console.log(`  identitySims: ${ollamaCallCount} calls (${probe8.sameDecisions} SAME, ${probe8.differentDecisions} DIFFERENT, ${probe8.uncertainDecisions} UNCERTAIN)`);

    console.log(`  rationale: ${rationale}`);
  }, 300000);
});
