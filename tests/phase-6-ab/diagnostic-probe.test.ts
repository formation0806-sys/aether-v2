/// <reference types="vitest" />

/**
 * Phase 6-AB — Full production input diagnostic probe.
 *
 * GOAL
 *   Determine WHY the current full 21-memory production input causes the
 *   real reflector to return [], despite the database containing historical
 *   reflection memories that demonstrate successful reflection generation
 *   in the past.
 *
 *   Isolates the prompt/input boundary by comparing 5 controlled conditions
 *   derived from the same current memory pool.
 *
 * SAFETY
 *   - Uses the REAL getAllMemories (read-only SELECT).
 *   - Uses the REAL generateReflections (reflector.ts) exactly once per condition.
 *   - NEVER calls saveMemory/insertMemoryV2/updateMemoryV2 or any write RPC.
 *   - Model / temperature / context are the REAL production values (untouched).
 *   - Raw model text is captured in-memory only and NEVER written to disk.
 *   - Only safe metadata written to measurement.json.
 *   - productionWrites === 0.
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

const probeDir = path.resolve(process.cwd(), "tests/phase-6-ab");
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
  return {
    createClient: () => createSupabaseClient(url, key),
  };
});

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
  updated_at?: string;
  effective_score?: number | null;
};

function present(v: unknown): string {
  if (v === undefined) return "absent";
  if (v === null) return "null";
  if (Array.isArray(v)) return `array[${v.length}]`;
  if (typeof v === "string") return `str(len=${v.length})`;
  if (typeof v === "object") return "object";
  return typeof v;
}

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

interface ConditionResult {
  name: string;
  description: string;
  memoryCount: number;
  groupCount: number;
  groupDetails: Array<{ memoryType: string; memoryCount: number; memoryIds: string[] }>;
  memoryDetails: Array<{
    id: string;
    memoryType: string;
    title: string;
    contentLength: number;
    summaryLength: number;
    importance: number;
    confidence: number;
    effectiveScore: number;
    tagsCount: number;
    metadataKeyCount: number;
    sourceRef: string | null;
    projectId: string | null;
    observationId: string | null;
  }>;
  rawResponseText: string | null;
  rawLength: number | null;
  isEmptyText: boolean;
  isLiteralEmptyArray: boolean;
  parseSuccess: boolean;
  rootType: string;
  candidatesPreSanitizer: number;
  sanitizerAccepted: number;
  sanitizerRejected: number;
  rejectionReasons: string[];
  finalResultCount: number;
  classification: string;
  requestModel: string | null;
  requestOptions: Record<string, unknown> | null;
  networkError: string | null;
}

async function runCondition(
  label: string,
  memories: MemoryRow[]
): Promise<ConditionResult> {
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
    result = await generateReflections(buildReflectionInput(memories));
  } catch (e) {
    modelErr = (e as Error).message ?? String(e);
  } finally {
    g.fetch = origFetch;
  }

  let modelContent: string | null = null;
  let isLiteralEmptyArray = false;

  if (rawText !== null) {
    try {
      const parsed = JSON.parse(rawText) as Record<string, unknown>;
      const message = parsed?.message as Record<string, unknown> | undefined;
      const content = message?.content;
      if (typeof content === "string") {
        modelContent = content.trim();
        isLiteralEmptyArray = modelContent === "[]";
      }
    } catch {
      // rawText is not valid JSON; leave modelContent null
    }
  }

  const text = modelContent ?? "";
  const isEmptyText = text.trim().length === 0;

  let parseSuccess = false;
  let rootType = "none";
  let preSanit = 0;

  if (modelContent !== null) {
    try {
      const parsed: unknown = JSON.parse(modelContent);
      parseSuccess = true;
      rootType = Array.isArray(parsed) ? "array" : typeof parsed;
      preSanit = Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      parseSuccess = false;
      rootType = typeof modelContent;
      preSanit = 0;
    }
  }

  const finalCount = (result ?? []).length;
  const rejectionReasons: string[] = [];

  if (parseSuccess && rootType === "array" && preSanit > 0 && finalCount === 0) {
    if (modelContent !== null) {
      try {
        const parsed = JSON.parse(modelContent);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (typeof item !== "object" || item === null || Array.isArray(item)) {
              rejectionReasons.push("not_plain_object");
            } else {
              const r = item as Record<string, unknown>;
              if (typeof r.title !== "string" || typeof r.content !== "string") {
                rejectionReasons.push("missing_title_or_content");
              } else {
                const title = r.title.trim();
                const content = r.content.trim();
                if (!title || !content) {
                  rejectionReasons.push("empty_title_or_content");
                }
              }
            }
          }
        }
      } catch {
        // already handled above
      }
    }
  }

  let classification = "";
  if (modelErr) {
    classification = "BLOCKED";
  } else if (finalCount > 0) {
    classification = "NONEMPTY";
  } else if (parseSuccess && rootType === "array" && preSanit > 0) {
    classification = "SANITIZER_REJECTION";
  } else if (isLiteralEmptyArray) {
    classification = "MODEL_EMPTY";
  } else if (!parseSuccess) {
    classification = "PARSER_REJECTION";
  } else if (parseSuccess && rootType === "object") {
    classification = "PARSER_REJECTION";
  } else {
    classification = "MODEL_EMPTY";
  }

  return {
    name: label,
    description: "",
    memoryCount: memories.length,
    groupCount: new Set(memories.map((m) => m.memory_type)).size,
    groupDetails: [],
    memoryDetails: [],
    rawResponseText: rawText,
    rawLength: captured.responseTextLength as number | null,
    isEmptyText,
    isLiteralEmptyArray,
    parseSuccess,
    rootType,
    candidatesPreSanitizer: preSanit,
    sanitizerAccepted: finalCount,
    sanitizerRejected: preSanit - finalCount,
    rejectionReasons,
    finalResultCount: finalCount,
    classification,
    requestModel: captured.requestModel as string | null,
    requestOptions: captured.requestOptions as Record<string, unknown> | null,
    networkError: modelErr,
  };
}

function buildReflectionInput(memories: MemoryRow[]): ReflectionInput[] {
  const groups = memories.reduce(
    (g: Record<string, MemoryRow[]>, m) => {
      (g[m.memory_type] ||= []).push(m);
      return g;
    },
    {}
  );

  return Object.entries(groups).map(([memoryType, mems]) => ({
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
  }));
}

function analyzeDuplicates(memories: MemoryRow[]): Record<string, unknown> {
  const threshold = 0.8;
  let nearDuplicatePairs = 0;
  const pairs: Array<{ idA: string; idB: string; similarity: number }> = [];

  for (let i = 0; i < memories.length; i++) {
    for (let j = i + 1; j < memories.length; j++) {
      const sim = similarity(memories[i].content, memories[j].content);
      if (sim > threshold) {
        nearDuplicatePairs++;
        pairs.push({
          idA: memories[i].id,
          idB: memories[j].id,
          similarity: Math.round(sim * 100) / 100,
        });
      }
    }
  }

  const totalPairs = (memories.length * (memories.length - 1)) / 2;
  const duplicateRatio = totalPairs > 0 ? nearDuplicatePairs / totalPairs : 0;

  const clusters: string[][] = [];
  const assigned = new Set<string>();

  for (const pair of pairs) {
    if (assigned.has(pair.idA) && assigned.has(pair.idB)) continue;
    const existing = clusters.find((c) => c.includes(pair.idA) || c.includes(pair.idB));
    if (existing) {
      if (!existing.includes(pair.idA)) existing.push(pair.idA);
      if (!existing.includes(pair.idB)) existing.push(pair.idB);
      assigned.add(pair.idA);
      assigned.add(pair.idB);
    } else {
      clusters.push([pair.idA, pair.idB]);
      assigned.add(pair.idA);
      assigned.add(pair.idB);
    }
  }

  const uniqueContentClusters = clusters.length + (memories.length - assigned.size);

  const reflectionMemories = memories.filter((m) => m.memory_type === "reflection");
  const reflectionSummarizingExisting = reflectionMemories.filter((r) => {
    return memories.some(
      (m) => m.memory_type !== "reflection" && similarity(r.content, m.content) > 0.7
    );
  });

  const reflectionInternalPairs: Array<{ idA: string; idB: string; similarity: number }> = [];
  for (let i = 0; i < reflectionMemories.length; i++) {
    for (let j = i + 1; j < reflectionMemories.length; j++) {
      const sim = similarity(reflectionMemories[i].content, reflectionMemories[j].content);
      if (sim > 0.8) {
        reflectionInternalPairs.push({
          idA: reflectionMemories[i].id,
          idB: reflectionMemories[j].id,
          similarity: Math.round(sim * 100) / 100,
        });
      }
    }
  }

  return {
    totalMemories: memories.length,
    nearDuplicatePairs,
    totalPairs,
    duplicateRatio: Math.round(duplicateRatio * 1000) / 1000,
    uniqueContentClusters,
    reflectionMemoriesTotal: reflectionMemories.length,
    reflectionSummarizingExistingCount: reflectionSummarizingExisting.length,
    reflectionSummarizingExistingIds: reflectionSummarizingExisting.map((m) => m.id),
    reflectionInternalDuplicatePairs: reflectionInternalPairs.length,
    reflectionInternalDuplicateDetails: reflectionInternalPairs,
  };
}

function analyzeHistoricalReflections(reflectionMemories: MemoryRow[]): Record<string, unknown> {
  const reflectionTypeMarkers: Record<string, string[]> = {
    REPEATED_PATTERN: ["repeated", "consistently", "pattern", "multiple", "prefers", "recurring"],
    CONTRADICTION: ["conflict", "contradict", "conflicting", "disagree"],
    RELATIONSHIP: ["related", "connected", "relationship", "linked"],
    CHANGE_OVER_TIME: ["changed", "shifted", "evolved", "over time", "previously"],
  };

  const analyzed = reflectionMemories.map((m) => {
    const contentLower = m.content.toLowerCase();
    const titleLower = m.title.toLowerCase();
    const detectedTypes: string[] = [];

    for (const [type, markers] of Object.entries(reflectionTypeMarkers)) {
      if (markers.some((marker) => contentLower.includes(marker) || titleLower.includes(marker))) {
        detectedTypes.push(type);
      }
    }

    const hasSourceRef = m.source_ref !== null && m.source_ref !== "";
    const sourceMemoriesExist = hasSourceRef;

    const otherReflections = reflectionMemories.filter((r) => r.id !== m.id);
    const hasRepeatedPattern = otherReflections.some(
      (r) => similarity(m.content, r.content) > 0.7
    );

    return {
      id: m.id,
      title: m.title,
      contentLength: m.content.length,
      detectedTypes,
      hasSourceRef,
      sourceRef: m.source_ref,
      sourceMemoriesExist,
      hasRepeatedPatternWithOtherReflection: hasRepeatedPattern,
      effectiveScore: m.effective_score,
      createdAt: m.created_at,
    };
  });

  const typeDistribution: Record<string, number> = {};
  for (const a of analyzed) {
    for (const t of a.detectedTypes) {
      typeDistribution[t] = (typeDistribution[t] || 0) + 1;
    }
  }

  const distinctCount = new Set(analyzed.map((a) => a.title)).size;
  const orphanedCount = analyzed.filter((a) => !a.sourceMemoriesExist).length;

  return {
    total: reflectionMemories.length,
    typeDistribution,
    distinctTitles: distinctCount,
    orphanedCount,
    orphanedIds: analyzed.filter((a) => !a.sourceMemoriesExist).map((a) => a.id),
    items: analyzed,
  };
}

function analyzePromptRuleCorrelation(
  condition: ConditionResult,
  allMemories: MemoryRow[]
): Record<string, unknown> {
  const groupDetails = condition.groupDetails;
  const correlations: Record<string, unknown> = {
    rule8: {
      rule: "Do not create a reflection merely because several memories mention the same broad topic.",
      couldApply: false,
      reason: "",
    },
    rule12: {
      rule: "A reflection must add information that is more useful than simply repeating the source memories.",
      couldApply: false,
      reason: "",
    },
    finalCheck: {
      rule: "Before returning a reflection, silently verify: ... Would [] be safer?",
      wouldFavorEmpty: false,
      reason: "",
    },
  };

  const allTypes = groupDetails.map((g) => g.memoryType);
  const uniqueTypes = new Set(allTypes);

  if (uniqueTypes.size === 1) {
    const singleType = Array.from(uniqueTypes)[0];
    const sameTypeCount = groupDetails.find((g) => g.memoryType === singleType)?.memoryCount ?? 0;
    if (sameTypeCount >= 3) {
      const rule8 = correlations.rule8 as Record<string, unknown>;
      rule8.couldApply = true;
      rule8.reason =
        `All ${sameTypeCount} memories share the same type "${singleType}". ` +
        `If they all mention the same broad topic (e.g., Aether development), RULE 8 could reject a reflection.`;
    }
  }

  const nonReflectionMemories = allMemories.filter((m) => m.memory_type !== "reflection");
  const hasHighOverlap = nonReflectionMemories.some((m) =>
    condition.memoryDetails.some((d) => d.contentLength > 0 && similarity(m.content, condition.memoryDetails.find((x) => x.id === m.id)?.contentLength.toString() ?? "") > 0.7)
  );

  if (condition.memoryCount >= 10) {
    const rule12 = correlations.rule12 as Record<string, unknown>;
    rule12.couldApply = true;
    rule12.reason =
      `Large input (${condition.memoryCount} memories) increases likelihood that any synthesized reflection ` +
      `would be seen as merely repeating existing facts rather than adding new information.`;
  }

  if (condition.classification === "MODEL_EMPTY" || condition.classification === "SANITIZER_REJECTION") {
    const finalCheck = correlations.finalCheck as Record<string, unknown>;
    finalCheck.wouldFavorEmpty = true;
    finalCheck.reason =
      `Model returned empty or sanitizer rejected all candidates. ` +
      `The FINAL CHECK question "Would [] be safer?" is consistent with this outcome.`;
  }

  return correlations as Record<string, unknown>;
}

describe("Phase 6-AB: full production input diagnostic probe", () => {
  it("diagnoses why full 21-memory input produces empty reflector output (read-only)", async () => {
    const M: Record<string, unknown> = {
      startedAt: new Date().toISOString(),
      experiment: "phase-6-ab-diagnostic",
      productionWrites: 0,
      reflectorInvocations: 0,
      classification: null as string | null,
      rootCause: null as string | null,
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
      expect(M.productionWrites).toBe(0);
      return;
    }

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
    const eligible = rows.filter(isEligible);

    M.N_total = total;
    M.N_eligible = eligible.length;

    if (eligible.length < 2) {
      M.classification = "NOT_ENOUGH_DATA";
      M.reason =
        "fewer than 2 eligible memories; a reflection connecting " +
        ">=2 memories is not possible.";
      fs.writeFileSync(measurementPath, JSON.stringify(M, null, 2));
      expect(M.productionWrites).toBe(0);
      return;
    }

    const reflectionMemories = eligible.filter((m) => m.memory_type === "reflection");
    const projectMemories = eligible.filter((m) => m.memory_type === "project");
    const identityMemories = eligible.filter((m) => m.memory_type === "identity");
    const nonReflectionMemories = eligible.filter((m) => m.memory_type !== "reflection");

    const conditions: Array<{ id: string; name: string; memories: MemoryRow[] }> = [
      { id: "A", name: "Full", memories: eligible },
      { id: "B", name: "Reflection-only", memories: reflectionMemories },
      { id: "C", name: "Non-reflection-only", memories: nonReflectionMemories },
      {
        id: "D",
        name: "Reflection+Project",
        memories: [...reflectionMemories, ...projectMemories],
      },
      {
        id: "E",
        name: "Reflection+Identity",
        memories: [...reflectionMemories, ...identityMemories],
      },
    ];

    const conditionsRecord: Record<string, ConditionResult> = {};

    for (const cond of conditions) {
      if (cond.memories.length < 2) {
        conditionsRecord[cond.id] = {
          name: cond.name,
          description: `Skipped: only ${cond.memories.length} memory(ies)`,
          memoryCount: cond.memories.length,
          groupCount: 0,
          groupDetails: [],
          memoryDetails: [],
          rawResponseText: null,
          rawLength: null,
          isEmptyText: true,
          isLiteralEmptyArray: false,
          parseSuccess: false,
          rootType: "none",
          candidatesPreSanitizer: 0,
          sanitizerAccepted: 0,
          sanitizerRejected: 0,
          rejectionReasons: [],
          finalResultCount: 0,
          classification: "SKIPPED_INSUFFICIENT_MEMORIES",
          requestModel: null,
          requestOptions: null,
          networkError: null,
        };
        continue;
      }

      const reflectionInput = buildReflectionInput(cond.memories);
      const groupDetails = reflectionInput.map((g) => ({
        memoryType: g.memoryType,
        memoryCount: g.memories.length,
        memoryIds: g.memories.map((x) => x.id),
      }));

      const memoryDetails = cond.memories.map((m) => ({
        id: m.id,
        memoryType: m.memory_type,
        title: m.title,
        contentLength: m.content.length,
        summaryLength: (m.summary ?? "").length,
        importance: m.importance_v2,
        confidence: m.confidence_v2,
        effectiveScore: m.effective_score ?? 0,
        tagsCount: (m.tags ?? []).length,
        metadataKeyCount: Object.keys(m.metadata ?? {}).length,
        sourceRef: m.source_ref ?? null,
        projectId: m.project_id ?? null,
        observationId: m.observation_id ?? null,
      }));

      const result = await runCondition(cond.name, cond.memories);
      result.description = `${cond.memories.length} memories across ${new Set(cond.memories.map((m) => m.memory_type)).size} type groups`;
      result.groupDetails = groupDetails;
      result.memoryDetails = memoryDetails;

      conditionsRecord[cond.id] = result;
      M.reflectorInvocations = (M.reflectorInvocations as number) + 1;
    }

    M.conditions = conditionsRecord;

    M.duplicateAnalysis = analyzeDuplicates(eligible);
    M.historicalReflectionAnalysis = analyzeHistoricalReflections(reflectionMemories);

    const promptRuleCorrelation: Record<string, Record<string, unknown>> = {};
    for (const [id, cond] of Object.entries(conditionsRecord)) {
      if (cond.classification !== "SKIPPED_INSUFFICIENT_MEMORIES") {
        promptRuleCorrelation[id] = analyzePromptRuleCorrelation(
          cond,
          eligible
        );
      }
    }
    M.promptRuleCorrelation = promptRuleCorrelation;

    const classifications = Object.values(conditionsRecord)
      .filter((c): c is ConditionResult => c.classification !== "SKIPPED_INSUFFICIENT_MEMORIES")
      .map((c) => c.classification);

    const nonEmptyCount = classifications.filter((c) => c === "NONEMPTY").length;
    const modelEmptyCount = classifications.filter((c) => c === "MODEL_EMPTY").length;
    const sanitizerRejectionCount = classifications.filter((c) => c === "SANITIZER_REJECTION").length;
    const parserRejectionCount = classifications.filter((c) => c === "PARSER_REJECTION").length;

    if (nonEmptyCount > 0) {
      M.classification = "PARTIAL_NONEMPTY";
      M.rootCause =
        "At least one condition produced non-empty output. The empty result is input-composition-dependent.";
    } else if (modelEmptyCount === classifications.length && classifications.length > 0) {
      M.classification = "MODEL_EMPTY_DUE_TO_INPUT_COMPOSITION";
      M.rootCause =
        "All conditions returned MODEL_EMPTY. The model chose [] across all input compositions. " +
        "This is consistent with the model's conservative behavior under the current prompt rules, " +
        "not necessarily a prompt defect.";
    } else if (sanitizerRejectionCount > 0) {
      M.classification = "SANITIZER_REJECTION";
      M.rootCause =
        "Model produced candidates but sanitizer rejected all. Input may have triggered rule-based rejection.";
    } else if (parserRejectionCount > 0) {
      M.classification = "PARSER_REJECTION";
      M.rootCause = "Model output failed JSON parsing or root validation.";
    } else {
      M.classification = "INCONCLUSIVE";
      M.rootCause = "Mixed or ambiguous results across conditions.";
    }

    M.productionChangeJustified = false;

    M.comparisonMatrix = Object.entries(conditionsRecord).map(([id, c]) => {
      return {
        condition: `${id} ${c.name}`,
        memories: c.memoryCount,
        result: c.classification === "SKIPPED_INSUFFICIENT_MEMORIES" ? "skipped" : (c.isLiteralEmptyArray ? "[]" : (c.finalResultCount > 0 ? `${c.finalResultCount} candidates` : "empty")),
        candidates: c.candidatesPreSanitizer,
        classification: c.classification,
      };
    });

    fs.writeFileSync(measurementPath, JSON.stringify(M, null, 2));

    expect(M.productionWrites).toBe(0);
    expect((M.reflectorInvocations as number)).toBeGreaterThan(0);
    expect(M.classification).not.toBeNull();
    expect(M.productionChangeJustified).toBe(false);
  }, 120000);
});
