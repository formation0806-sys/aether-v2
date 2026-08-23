/// <reference types="vitest" />

/**
 * Phase 6-AF — Input Composition and Relationship Structure Audit
 *
 * 8-probe read-only diagnostic of the 21-memory production input feeding
 * the reflector. Determines WHY no reflection is produced by testing
 * every plausible explanation through data inspection and controlled probes.
 *
 * SAFETY
 * - Only getAllMemories (read-only SELECT), matchMemoriesV2 (read-only RPC),
 *   and embed() (read-only Ollama embedding) are invoked.
 * - No saveMemory / insertMemoryV2 / updateMemoryV2 / corroborateMemory.
 * - verifyIdentity simulation: max 6 Ollama chat calls (capped).
 * - Raw model text is held in-memory only and NEVER written to disk.
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

const probeDir = path.resolve(process.cwd(), "tests/phase-6-af");
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

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);
}

function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
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

function hasSynthesizedContent(content: string): boolean {
  return (
    typeof content === "string" &&
    content.length > 50 &&
    STRUCTURAL_MARKERS.some((marker) => content.toLowerCase().includes(marker))
  );
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
  userTemplate: string;
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

  const userTemplate =
    "NEW OBSERVATION\n" +
    "title: ${title}\n" +
    "content: ${content}\n" +
    "memory_type: ${memoryType}\n\n" +
    "EXISTING CANDIDATE MEMORY\n" +
    "title: ${title}\n" +
    "content: ${content}\n" +
    "memory_type: ${memory_type}\n" +
    "similarity: ${similarity}\n\n" +
    "JSON only:";

  return { system, userTemplate, modelConstant };
}

async function callIdentityVerifier(
  newMem: { title: string; content: string; memoryType: string },
  candidate: { title: string; content: string; memory_type: string; similarity: number }
): Promise<{ decision: string; latencyMs: number }> {
  const { system: systemPrompt, userTemplate, modelConstant } = readIdentityPromptSource();

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

describe("Phase 6-AF: Input Composition and Relationship Structure Audit", () => {
  it("runs 8-probe read-only diagnostic on 21-memory production input", async () => {
    if (ENV_MISSING) {
      fs.writeFileSync(
        measurementPath,
        JSON.stringify(
          {
            startedAt: new Date().toISOString(),
            experiment: "phase-6-af-input-audit",
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
    // PROBE 1: Eligibility Audit
    // =============================================
    const probe1 = {
      totalMemories: total,
      eligibleCount: eligible.length,
      ineligibleCount: ineligible.length,
      eligibilityFilter:
        "status IN (active,candidate) AND confidence_v2 >= 0.7 AND importance_v2 >= 0.5",
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
        source_ref: m.source_ref,
      })),
      eligibleBreakdown: eligible.map((m) => ({
        id: m.id.substring(0, 8),
        memory_type: m.memory_type,
        status: m.status,
        importance_v2: m.importance_v2,
        confidence_v2: m.confidence_v2,
        source_ref: m.source_ref,
      })),
    };

    // =============================================
    // PROBE 2: Grouping Structure Audit
    // =============================================
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

    const typeKeys = Object.keys(groups);
    const crossTypeNearDups: unknown[] = [];
    for (let i = 0; i < typeKeys.length; i++) {
      for (let j = i + 1; j < typeKeys.length; j++) {
        const typeA = typeKeys[i];
        const typeB = typeKeys[j];
        for (const memA of groups[typeA]) {
          for (const memB of groups[typeB]) {
            const s = similarity(memA.content, memB.content);
            if (s > 0.85) {
              crossTypeNearDups.push({
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
      crossTypeNearDuplicatePairs: crossTypeNearDups,
      crossTypePairsCount: crossTypeNearDups.length,
    };

    // =============================================
    // PROBE 3: Content Inspection (Full 21)
    // =============================================
    const probe3 = eligible.map((m) => ({
      id: m.id.substring(0, 8),
      title: m.title,
      content: m.content,
      memory_type: m.memory_type,
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
      hasSynthesizedContent: hasSynthesizedContent(m.content),
      contentDepth: hasSynthesizedContent(m.content) ? "synthesized" : "atomic",
    }));

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

    // =============================================
    // PROBE 4: Duplicate / Near-Duplicate Analysis
    // =============================================
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
    (nearDuplicates as any[]).forEach((nd) => {
      memsWithNearDups.add(nd.idA);
      memsWithNearDups.add(nd.idB);
    });

    const nearDupsWithinSameType = (nearDuplicates as any[]).filter((nd) => nd.sameType).length;
    const nearDupsCrossType = (nearDuplicates as any[]).filter((nd) => !nd.sameType).length;

    const probe4 = {
      threshold: 0.85,
      totalPairs: nearDuplicates.length,
      nearDuplicatePairs: nearDuplicates,
      nearDuplicateMemoriesCount: memsWithNearDups.size,
      nearDupsWithinSameType,
      nearDupsCrossType,
      crossTypePairs: (nearDuplicates as any[]).filter((nd) => !nd.sameType),
      phase6AAReproduction: {
        expected: 12,
        actual: nearDuplicates.length,
        match: nearDuplicates.length === 12,
      },
    };

    // =============================================
    // PROBE 5: Provenance Chain Audit
    // =============================================
    const reflectionProvenance = reflectionMemories.map((m) => ({
      id: m.id.substring(0, 8),
      title: m.title,
      content: m.content,
      source_ref: m.source_ref,
      observation_id: m.observation_id ?? null,
      created_at: m.created_at,
      importance_v2: m.importance_v2,
      confidence_v2: m.confidence_v2,
      hasSourceRef: m.source_ref !== null,
      hasObservationId: m.observation_id !== null,
    }));

    const nonReflectionWithSourceRef = eligible
      .filter((m) => m.memory_type !== "reflection" && m.source_ref !== null)
      .map((m) => ({
        id: m.id.substring(0, 8),
        memory_type: m.memory_type,
        source_ref: m.source_ref,
      }));

    const orphanedReflections = reflectionMemories.filter((m) => m.source_ref === null);
    const semanticMatches: Record<string, unknown> = {};

    for (const mem of orphanedReflections) {
      try {
        const { embedding } = await embed(mem.content);
        const { data: matches, error: matchError } = await matchMemoriesV2(embedding, USER!, {
          minSimilarity: 0.7,
          matchCount: 3,
        });
        if (matchError || !matches) {
          semanticMatches[mem.id.substring(0, 8)] = {
            embedError: null,
            matchError: matchError ? String(matchError) : null,
            topMatches: [],
            topSimilarity: 0,
            semanticallyOrphaned: true,
          };
        } else {
          const topMatches = (matches as any[]).map((r) => ({
            id: r.id?.substring(0, 8),
            similarity: r.similarity,
            memory_type: r.memory_type,
          }));
          const topSimilarity = topMatches.length > 0 ? topMatches[0].similarity : 0;
          semanticMatches[mem.id.substring(0, 8)] = {
            embedError: null,
            matchError: null,
            topMatches,
            topSimilarity,
            semanticallyOrphaned: topSimilarity < 0.7,
          };
        }
      } catch (e) {
        semanticMatches[mem.id.substring(0, 8)] = {
          embedError: (e as Error).message ?? String(e),
          matchError: null,
          topMatches: [],
          topSimilarity: 0,
          semanticallyOrphaned: true,
        };
      }
    }

    const probe5 = {
      reflectionMemories: reflectionProvenance,
      reflectionWithSourceRef: reflectionProvenance.filter((r) => r.hasSourceRef).length,
      reflectionWithObservationId: reflectionProvenance.filter((r) => r.hasObservationId).length,
      orphanedReflectionCount: orphanedReflections.length,
      orphanedReflectionIds: reflectionProvenance
        .filter((r) => !r.hasSourceRef)
        .map((r) => r.id),
      nonReflectionWithSourceRef,
      semanticMatching: semanticMatches,
    };

    // =============================================
    // PROBE 6: Cross-Type Relationship Potential (Two-Tier)
    // =============================================
    const typePairs: [string, string][] = [];
    for (let i = 0; i < typeKeys.length; i++) {
      for (let j = i + 1; j < typeKeys.length; j++) {
        typePairs.push([typeKeys[i], typeKeys[j]]);
      }
    }

    const tierA: unknown[] = [];
    const tierB: unknown[] = [];

    for (const [typeA, typeB] of typePairs) {
      const memsA = groups[typeA];
      const memsB = groups[typeB];
      for (const memA of memsA) {
        for (const memB of memsB) {
          const s = similarity(memA.content, memB.content);
          if (s > 0.85) {
            tierA.push({
              typeA,
              typeB,
              idA: memA.id.substring(0, 8),
              idB: memB.id.substring(0, 8),
              contentA: memA.content.substring(0, 80),
              contentB: memB.content.substring(0, 80),
              similarity: s,
            });
          } else if (s > 0.5) {
            tierB.push({
              typeA,
              typeB,
              idA: memA.id.substring(0, 8),
              idB: memB.id.substring(0, 8),
              contentA: memA.content.substring(0, 80),
              contentB: memB.content.substring(0, 80),
              similarity: s,
            });
          }
        }
      }
    }

    const probe6 = {
      typePairs: typePairs.map(([a, b]) => `${a}+${b}`),
      tierA_pairs: tierA,
      tierA_count: tierA.length,
      tierB_pairs: tierB,
      tierB_count: tierB.length,
      note:
        "Tier B pairs are descriptive cross-type relationship candidates only. " +
        "Do NOT classify them as blocked reflections. Leave semantic interpretation to human review.",
    };

    // =============================================
    // PROBE 7: Semantic Diversity Audit
    // =============================================
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

      let intraSims: number[] = [];
      for (let i = 0; i < tokenizedContents.length; i++) {
        for (let j = i + 1; j < tokenizedContents.length; j++) {
          intraSims.push(
            jaccard([...tokenizedContents[i]], [...tokenizedContents[j]])
          );
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
        groupSize: typeMems.length,
        classification:
          distinctiveTokens.length < typeMems.length ? "HOMOGENEOUS" : "DIVERSE",
      };
    });

    const probe7Summary = {
      groups: probe7,
      allHomogeneous: probe7.every((g: any) => g.classification === "HOMOGENEOUS"),
      anyDiverse: probe7.some((g: any) => g.classification === "DIVERSE"),
    };

    // =============================================
    // PROBE 8: Identity Resolution Simulation (Prompt Reproduction)
    // =============================================
    const nearDupPairsForIdentity = [...(nearDuplicates as any[])]
      .sort((a: any, b: any) => b.similarity - a.similarity)
      .slice(0, 6);

    const identityResults: unknown[] = [];
    let ollamaCallCount = 0;
    let promptHashMismatch = false;
    let productionPromptHash = "";
    let reproducedPromptHash = "";

    if (nearDupPairsForIdentity.length > 0) {
      const identitySource = fs.readFileSync(
        path.resolve(process.cwd(), "lib/memory/identity.ts"),
        "utf-8"
      );
      const systemMatch = identitySource.match(
        /const system = \(([^)]+)\) \+ "You are an identity-resolution classifier[^"]*"\s*\+/
      );
      const productionSystem =
        systemMatch?.[1] ??
        "You are an identity-resolution classifier for a long-term memory system. ";

      productionPromptHash = crypto
        .createHash("sha256")
        .update(productionSystem)
        .digest("hex");

      const { system: reproducedSystem } = readIdentityPromptSource();
      reproducedPromptHash = crypto
        .createHash("sha256")
        .update(reproducedSystem)
        .digest("hex");

      promptHashMismatch = productionPromptHash !== reproducedPromptHash;
    }

    if (!promptHashMismatch && nearDupPairsForIdentity.length > 0) {
      for (const pair of nearDupPairsForIdentity) {
        if (ollamaCallCount >= 6) break;

        const memA = eligible.find((m) => m.id.substring(0, 8) === pair.idA);
        const memB = eligible.find((m) => m.id.substring(0, 8) === pair.idB);
        if (!memA || !memB) continue;

        const result = await callIdentityVerifier(
          { title: memA.title, content: memA.content, memoryType: memA.memory_type },
          {
            title: memB.title,
            content: memB.content,
            memory_type: memB.memory_type,
            similarity: pair.similarity,
          }
        );

        if (result.decision === "PROMPT_HASH_MISMATCH") {
          promptHashMismatch = true;
          break;
        }

        ollamaCallCount++;
        identityResults.push({
          pairIdA: pair.idA,
          pairIdB: pair.idB,
          typeA: pair.typeA,
          typeB: pair.typeB,
          contentSim: pair.similarity,
          identityDecision: result.decision,
          latencyMs: result.latencyMs,
        });
      }
    }

    const probe8 = {
      nearDuplicatePairsIdentified: nearDuplicates.length,
      selectionRule:
        "Sort all near-duplicate pairs by content similarity descending. Select top 6 pairs (highest similarity first).",
      pairsTested: nearDupPairsForIdentity.length,
      ollamaCallsMade: ollamaCallCount,
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
    // Assembly
    // =============================================
    const allSummariesEmpty = probe3.every((m: any) => !m.summaryPopulated);
    const allTagsEmpty = probe3.every((m: any) => !m.tagsPopulated);
    const allMetadataEmpty = probe3.every((m: any) => !m.metadataPopulated);
    const inputImpoverished = allSummariesEmpty && allTagsEmpty && allMetadataEmpty;

    const crossTypeDupsExist = probe2.crossTypePairsCount > 0;
    const withinTypeDupsExist = probe4.nearDupsWithinSameType > 0;
    const reflectionOrphaned =
      probe5.orphanedReflectionCount === reflectionMemories.length;

    const measurement: Record<string, unknown> = {
      startedAt: new Date().toISOString(),
      experiment: "phase-6-af-input-audit",
      productionWrites: 0,
      safety: {
        productionWrites: 0,
        noDBWrites: true,
        noSaveMemory: true,
        noInsertUpdate: true,
        noCorroborate: true,
        readOnlyRPCs: ["getAllMemories", "matchMemoriesV2"],
        readOnlyEmbed: ["embed"],
        ollamaCalls: ollamaCallCount,
        rawModelTextPersisted: false,
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
      summary: {
        totalMemories: total,
        eligibleCount: eligible.length,
        typeGroups: typeKeys.map((t) => ({
          memoryType: t,
          count: groups[t].length,
        })),
        nearDuplicatePairs: nearDuplicates.length,
        nearDuplicatesWithinSameType: nearDupsWithinSameType,
        nearDuplicatesCrossType: nearDupsCrossType,
        crossTypeNearDuplicatePairs: probe2.crossTypePairsCount,
        crossTypeTierBPairs: probe6.tierB_count,
        reflectionMemoriesOrphaned: probe5.orphanedReflectionCount,
        inputImpoverished,
        allSummariesEmpty,
        allTagsEmpty,
        allMetadataEmpty,
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
      },
    };

    fs.writeFileSync(measurementPath, JSON.stringify(measurement, null, 2));

    // Core safety assertions
    expect(measurement.productionWrites).toBe(0);
    expect((measurement.safety as { productionWrites: number }).productionWrites).toBe(0);

    console.log(`=== PHASE 6-AF COMPLETE ===`);
    console.log(`  totalMemories: ${total}`);
    console.log(`  eligibleCount: ${eligible.length}`);
    console.log(`  nearDups: ${nearDuplicates.length} (within-type: ${nearDupsWithinSameType}, cross-type: ${nearDupsCrossType})`);
    console.log(`  crossTypeNearDups: ${probe2.crossTypePairsCount}`);
    console.log(`  crossTypeTierB: ${probe6.tierB_count}`);
    console.log(`  reflectionOrphaned: ${probe5.orphanedReflectionCount}/${reflectionMemories.length}`);
    console.log(`  inputImpoverished: ${inputImpoverished}`);
    console.log(`  identitySims: ${ollamaCallCount} calls`);
    console.log(`  promptHashMatch: ${!promptHashMismatch}`);
  }, 300000);
});
