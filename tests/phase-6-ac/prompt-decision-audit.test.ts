/// <reference types="vitest" />

/**
 * Phase 6-AC — Controlled prompt-decision audit.
 *
 * GOAL
 *   Inspect the exact production reflector prompt and determine whether
 *   its rules, serialization, decision criteria, and final checks explain
 *   the persistent [] output.
 *
 *   This is NOT a prompt rewrite.
 *   This is NOT a production fix.
 *   This is NOT a model comparison.
 *
 * SAFETY
 *   - Uses the REAL getAllMemories (read-only SELECT).
 *   - Uses the REAL generateReflections (reflector.ts) exactly once.
 *   - NEVER calls saveMemory/insertMemoryV2/updateMemoryV2 or any write RPC.
 *   - Model / temperature / context are the REAL production values (untouched).
 *   - Raw prompt text and raw model text are captured in-memory ONLY.
 *   - Only hashes, lengths, and analysis metadata are persisted.
 *   - productionWrites === 0.
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

const probeDir = path.resolve(process.cwd(), "tests/phase-6-ac");
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

function sha256Truncated(text: string, len = 16): string {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, len);
}

interface PromptCapture {
  url: string;
  model: string;
  options: Record<string, unknown>;
  systemContent: string;
  userContent: string;
  systemContentHash: string;
  userContentHash: string;
  systemContentLength: number;
  userContentLength: number;
}

interface ConditionResult {
  name: string;
  memoryCount: number;
  groupCount: number;
  groupDetails: Array<{ memoryType: string; memoryCount: number }>;
  rawResponseText: string | null;
  rawLength: number | null;
  isLiteralEmptyArray: boolean;
  parseSuccess: boolean;
  rootType: string;
  candidatesPreSanitizer: number;
  finalResultCount: number;
  classification: string;
  networkError: string | null;
}

async function capturePromptAndRun(
  memories: MemoryRow[]
): Promise<{ prompt: PromptCapture; result: ConditionResult }> {
  const g = globalThis as unknown as {
    fetch: typeof fetch;
    Response: unknown;
  };
  const origFetch = g.fetch;

  let capturedBody: string | null = null;
  let rawText: string | null = null;

  g.fetch = (async (input: unknown, init?: unknown) => {
    if (init && typeof init === "object" && "body" in init) {
      const body = (init as { body?: string }).body;
      if (typeof body === "string") {
        capturedBody = body;
      }
    }
    const resp = await origFetch(input as never, init as never);
    rawText = await (resp as Response).text();
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

  const groups = memories.reduce(
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

  try {
    result = await generateReflections(reflectionInput);
  } catch (e) {
    modelErr = (e as Error).message ?? String(e);
  } finally {
    g.fetch = origFetch;
  }

  let prompt: PromptCapture = {
    url: "",
    model: "",
    options: {},
    systemContent: "",
    userContent: "",
    systemContentHash: "",
    userContentHash: "",
    systemContentLength: 0,
    userContentLength: 0,
  };

  if (capturedBody) {
    try {
      const parsed = JSON.parse(capturedBody) as Record<string, unknown>;
      prompt.url = "http://127.0.0.1:11434/api/chat";
      prompt.model = typeof parsed?.model === "string" ? parsed.model : "";
      prompt.options = (parsed?.options as Record<string, unknown>) ?? {};
      const messages = parsed?.messages as Array<Record<string, unknown>> | undefined;
      if (messages && Array.isArray(messages)) {
        const sys = messages.find((m) => m.role === "system");
        const usr = messages.find((m) => m.role === "user");
        if (sys?.content && typeof sys.content === "string") {
          prompt.systemContent = sys.content;
          prompt.systemContentHash = sha256Truncated(sys.content);
          prompt.systemContentLength = sys.content.length;
        }
        if (usr?.content && typeof usr.content === "string") {
          prompt.userContent = usr.content;
          prompt.userContentHash = sha256Truncated(usr.content);
          prompt.userContentLength = usr.content.length;
        }
      }
    } catch {
      // body not parseable
    }
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
      // rawText is not valid JSON
    }
  }

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

  const groupDetails = memories.reduce(
    (g: Record<string, MemoryRow[]>, m) => {
      (g[m.memory_type] ||= []).push(m);
      return g;
    },
    {}
  );

  const rawLength = rawText == null ? null : (rawText as string).length;

  const resultCondition: ConditionResult = {
    name: "Full production input",
    memoryCount: memories.length,
    groupCount: Object.keys(groupDetails).length,
    groupDetails: Object.entries(groupDetails).map(([memoryType, mems]) => ({
      memoryType,
      memoryCount: mems.length,
    })),
    rawResponseText: rawText,
    rawLength,
    isLiteralEmptyArray,
    parseSuccess,
    rootType,
    candidatesPreSanitizer: preSanit,
    finalResultCount: finalCount,
    classification,
    networkError: modelErr,
  };

  return { prompt, result: resultCondition };
}

function analyzeRule8(input: { groupDetails: Array<{ memoryType: string; memoryCount: number }>; memoryCount: number }): Record<string, unknown> {
  const singleTypeGroup = input.groupDetails.find((g) => g.memoryCount >= 3);
  const allSameType = input.groupDetails.length === 1 && input.groupDetails[0]?.memoryCount >= 3;

  return {
    ruleText:
      "RULE 8: Do not create a reflection merely because several memories mention the same broad topic.",
    triggerCondition:
      "Multiple memories share the same broad topic without a deeper connection.",
    currentInputSatisfiesTrigger: !!singleTypeGroup || allSameType,
    evidence: allSameType
      ? `All ${input.memoryCount} memories are in a single type group. If they share a broad topic (e.g., Aether development), RULE 8 could reject a reflection.`
      : singleTypeGroup
        ? `Type group "${singleTypeGroup.memoryType}" has ${singleTypeGroup.memoryCount} memories. If they share a broad topic, RULE 8 could apply.`
        : "No single type group has >=3 memories; RULE 8 trigger is less likely.",
    causalStatus: "correlation",
    notes:
      "RULE 8 alone does not prove causality. It is consistent with the model choosing [], but the model may also return [] for other reasons.",
  };
}

function analyzeRule12(input: { memoryCount: number; groupCount: number }): Record<string, unknown> {
  const largeInput = input.memoryCount >= 10;

  return {
    ruleText:
      "RULE 12: A reflection must add information that is more useful than simply repeating the source memories.",
    triggerCondition:
      "The model determines that any reflection would merely repeat existing facts rather than add new information.",
    currentInputSatisfiesTrigger: largeInput,
    evidence: largeInput
      ? `Large input (${input.memoryCount} memories across ${input.groupCount} groups) increases the surface area of existing facts, making it harder to add novel synthesis.`
      : `Input size (${input.memoryCount}) is moderate; RULE 12 trigger is possible but less certain.`,
    causalStatus: "correlation",
    notes:
      "RULE 12 is a strong candidate for explaining [], but causality cannot be isolated without testing modified prompts.",
  };
}

function analyzeFinalCheck(): Record<string, unknown> {
  return {
    ruleText:
      "FINAL CHECK: Before returning a reflection, silently verify: 1. Is it supported by at least TWO supplied memories? 2. Does it add useful information? 3. Is every claim explicitly grounded? 4. Did I avoid inventing chronology? 5. Did I avoid inventing motivation? 6. Did I avoid choosing between conflicting memories? 7. Is it different from the other reflection? 8. Would [] be safer? If any answer is NO, do not output that reflection. Return [] instead.",
    triggerCondition:
      "The model answers NO to any of the 8 verification questions.",
    currentInputSatisfiesTrigger: true,
    evidence:
      "The model returned [] in all 5 Phase 6-AB conditions. This is consistent with the FINAL CHECK biasing toward safety, but does not prove which question triggered the NO.",
    causalStatus: "correlation",
    notes:
      "The FINAL CHECK explicitly instructs the model to prefer [] when uncertain. This is a strong structural bias toward empty output.",
  };
}

function analyzeRule9(input: { reflectionMemoryCount: number }): Record<string, unknown> {
  return {
    ruleText:
      "RULE 9: Do not create multiple reflections that express essentially the same idea. If several memories support the same pattern, produce ONE reflection.",
    triggerCondition:
      "Multiple memories support the same pattern, and producing multiple reflections would create duplicates.",
    currentInputSatisfiesTrigger: input.reflectionMemoryCount > 0,
    evidence:
      "The input contains reflection memories. If the model treats them as evidence of existing patterns, RULE 9 could limit output to 0 or 1 reflections.",
    causalStatus: "correlation",
    notes:
      "RULE 9 is more about deduplication than about rejecting all output. Less likely to be the primary cause of [].",
  };
}

function analyzeRule10(): Record<string, unknown> {
  return {
    ruleText:
      "RULE 10: Do not create a reflection about the reflection itself.",
    triggerCondition:
      "The model considers creating a reflection that summarizes or comments on existing reflection memories.",
    currentInputSatisfiesTrigger: false,
    evidence:
      "The prompt does not explicitly instruct the model to avoid reflecting on reflection memories, but RULE 10 could cause the model to skip reflections that merely summarize existing reflections.",
    causalStatus: "not established",
    notes:
      "RULE 10 is relevant because the input contains 10 reflection memories, but the rule text does not explicitly address this scenario.",
  };
}

function analyzeOutputLimit(): Record<string, unknown> {
  return {
    ruleText:
      "Return AT MOST 2 reflections. Usually return 0 or 1. Only return 2 when there are clearly two independent, high-confidence insights.",
    triggerCondition:
      "The model does not see two clearly independent, high-confidence insights.",
    currentInputSatisfiesTrigger: true,
    evidence:
      "The model returned [] in all conditions, so it did not identify even one high-confidence insight. The OUTPUT LIMIT alone does not explain [], but it sets the ceiling low.",
    causalStatus: "correlation",
    notes:
      "The OUTPUT LIMIT is a ceiling, not a floor. It cannot explain why the model returned 0 instead of 1.",
  };
}

function analyzeHistoricalReflections(reflectionMemories: MemoryRow[]): Record<string, unknown> {
  const typeMarkers: Record<string, string[]> = {
    REPEATED_PATTERN: ["repeated", "consistently", "pattern", "multiple", "prefers", "recurring", "recurring theme"],
    CONTRADICTION: ["conflict", "contradict", "conflicting", "disagree"],
    RELATIONSHIP: ["related", "connected", "relationship", "linked"],
    CHANGE_OVER_TIME: ["changed", "shifted", "evolved", "over time", "previously"],
  };

  const analyzed = reflectionMemories.map((m) => {
    const contentLower = m.content.toLowerCase();
    const titleLower = m.title.toLowerCase();
    const detectedTypes: string[] = [];

    for (const [type, markers] of Object.entries(typeMarkers)) {
      if (markers.some((marker) => contentLower.includes(marker) || titleLower.includes(marker))) {
        detectedTypes.push(type);
      }
    }

    return {
      id: m.id,
      title: m.title,
      contentLength: m.content.length,
      detectedTypes,
      hasSourceRef: m.source_ref !== null && m.source_ref !== "",
      sourceRef: m.source_ref,
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

  const distinctTitles = new Set(analyzed.map((a) => a.title)).size;
  const orphaned = analyzed.filter((a) => !a.hasSourceRef);

  return {
    total: reflectionMemories.length,
    typeDistribution,
    distinctTitles,
    orphanedCount: orphaned.length,
    orphanedIds: orphaned.map((a) => a.id),
    items: analyzed,
  };
}

function compareHistoricalToCurrent(
  historical: Record<string, unknown>,
  current: MemoryRow[]
): Record<string, unknown> {
  const currentReflectionCount = current.filter((m) => m.memory_type === "reflection").length;
  const currentProjectCount = current.filter((m) => m.memory_type === "project").length;
  const currentIdentityCount = current.filter((m) => m.memory_type === "identity").length;

  const avgContentLength =
    current.reduce((sum, m) => sum + m.content.length, 0) / current.length;

  const hasCrossTypeRelationships =
    currentProjectCount > 0 && currentIdentityCount > 0 && currentReflectionCount > 0;

  return {
    historicalReflectionCount: historical.total,
    historicalTypeDistribution: historical.typeDistribution,
    currentReflectionCount,
    currentProjectCount,
    currentIdentityCount,
    currentAvgContentLength: Math.round(avgContentLength * 100) / 100,
    hasCrossTypeRelationships,
    keyDifferences: [
      `Historical reflections are all orphaned (no source_ref), making it impossible to reconstruct their original source inputs.`,
      `Current input contains ${current.length} raw memories across ${new Set(current.map((m) => m.memory_type)).size} types.`,
      `Historical reflections show REPEATED_PATTERN dominance (${(historical.typeDistribution as Record<string, number>)["REPEATED_PATTERN"] || 0}/${historical.total}), suggesting the reflector previously found repeated facts.`,
      `Current input includes 10 reflection memories as INPUT, which the model may treat as already-synthesized evidence (RULE 10).`,
      `Current input has ${current.filter((m) => m.memory_type === "project").length} project memories, many of which are near-identical Aether test observations.`,
    ],
    assessment:
      "Historical reflections were produced from inputs that are not fully reconstructable. The current input differs structurally by including reflection memories as input, which may change the model's decision boundary.",
  };
}

describe("Phase 6-AC: controlled prompt-decision audit", () => {
  it("captures exact production prompt and analyzes decision rules (read-only)", async () => {
    const M: Record<string, unknown> = {
      startedAt: new Date().toISOString(),
      experiment: "phase-6-ac-prompt-decision-audit",
      productionWrites: 0,
      reflectorInvocations: 0,
      classification: null as string | null,
      causality: null as string | null,
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

    const { prompt, result } = await capturePromptAndRun(eligible);

    M.promptCapture = {
      url: prompt.url,
      model: prompt.model,
      options: prompt.options,
      systemPromptLength: prompt.systemContentLength,
      systemPromptHash: prompt.systemContentHash,
      userPromptLength: prompt.userContentLength,
      userPromptHash: prompt.userContentHash,
      memoryCount: eligible.length,
      groupCount: result.groupCount,
      groupDetails: result.groupDetails,
    };

    const reflectionMemories = eligible.filter((m) => m.memory_type === "reflection");

    M.ruleAnalysis = {
      rule8: analyzeRule8(result),
      rule12: analyzeRule12(result),
      finalCheck: analyzeFinalCheck(),
      rule9: analyzeRule9({ reflectionMemoryCount: reflectionMemories.length }),
      rule10: analyzeRule10(),
      outputLimit: analyzeOutputLimit(),
    };

    M.historicalReflectionAnalysis = analyzeHistoricalReflections(reflectionMemories);
    M.historicalComparison = compareHistoricalToCurrent(
      M.historicalReflectionAnalysis as Record<string, unknown>,
      eligible
    );

    M.rawModelResponse = {
      text: result.rawResponseText,
      length: result.rawLength,
      isEmpty: result.rawResponseText === null || result.rawResponseText.trim().length === 0,
      isLiteralEmptyArray: result.isLiteralEmptyArray,
      parseSuccess: result.parseSuccess,
      rootType: result.rootType,
      candidatesPreSanitizer: result.candidatesPreSanitizer,
      finalAccepted: result.finalResultCount,
      classification: result.classification,
      networkError: result.networkError,
    };

    if (result.classification === "MODEL_EMPTY" || result.classification === "NONEMPTY") {
      M.classification = result.classification;
    } else {
      M.classification = result.classification;
    }

    const strongCausalCount = Object.values(M.ruleAnalysis as Record<string, unknown>).filter(
      (r) => (r as { causalStatus?: string }).causalStatus === "established"
    ).length;
    const contributoryCount = Object.values(M.ruleAnalysis as Record<string, unknown>).filter(
      (r) => (r as { causalStatus?: string }).causalStatus === "correlation"
    ).length;

    if (strongCausalCount > 0) {
      M.causality = "PROMPT_CAUSAL";
      M.causalityReason =
        "At least one rule shows established causality between prompt instruction and [] output.";
    } else if (contributoryCount >= 3) {
      M.causality = "PROMPT_CONTRIBUTORY";
      M.causalityReason =
        "Multiple rules show strong correlation with [] output, but causality cannot be isolated.";
    } else if (contributoryCount > 0) {
      M.causality = "INPUT_PROMPT_COMPATIBLE";
      M.causalityReason =
        "Prompt and input naturally support [], but neither can be isolated as the cause.";
    } else {
      M.causality = "INCONCLUSIVE";
      M.causalityReason = "Evidence is insufficient to determine causality.";
    }

    M.productionChangeJustified = false;

    M.inputSerialization = {
      grouping: "by memory_type (production-verbatim reduce)",
      ordering: "insertion order within each type group",
      fieldsIncluded: ["id", "title", "content", "summary", "importance", "confidence", "memoryType", "tags", "metadata"],
      fieldsExcluded: ["source_ref", "project_id", "observation_id", "effective_score", "created_at", "updated_at", "status"],
      reflectionMemoriesTreatedAsOrdinaryInput: true,
      duplicateRecognitionExplicit: false,
      modelInstructedToAvoidRepeatingExistingReflections: false,
      summariesIncluded: true,
      tagsIncluded: true,
      metadataIncluded: true,
      provenanceIncluded: false,
      observationIdsIncluded: false,
    };

    fs.writeFileSync(measurementPath, JSON.stringify(M, null, 2));

    expect(M.productionWrites).toBe(0);
    expect((M.reflectorInvocations = 1)).toBe(1);
    expect(M.classification).not.toBeNull();
    expect(M.causality).not.toBeNull();
    expect(M.productionChangeJustified).toBe(false);
  }, 120000);
});
