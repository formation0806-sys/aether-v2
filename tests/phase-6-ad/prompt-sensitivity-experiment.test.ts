/// <reference types="vitest" />

/**
 * Phase 6-AE — Controlled Prompt Sensitivity Experiment
 *
 * Read-only. productionWrites = 0.
 *
 * Determines whether specific conservative rules in the production reflection
 * prompt (lib/memory/reflector.ts:78-312) are causally responsible for the
 * model returning `[]` on the real 21-memory production input.
 *
 * Conditions:
 *  A Baseline       — real generateReflections() (production path)
 *  B RULE 8 relaxed — only RULE 8 block replaced
 *  C RULE 12 relaxed — only RULE 12 block replaced
 *  D FINAL CHECK relaxed — only FINAL CHECK block replaced
 *  E Minimal combined — B + C + D edits together
 *
 * All conditions share:
 *  - Same real 21-memory production input
 *  - Same model qwen2.5:3b
 *  - Same options { temperature:0.1, num_predict:300, top_p:0.8, num_ctx:4096 }
 *  - Same endpoint http://127.0.0.1:11434
 *  - Same sanitizer (sanitizedReflection logic reproduced verbatim)
 *
 * Safety: only getAllMemories (read-only SELECT) is called. No saveMemory,
 * no inserts, no updates. Raw model text is held in-memory only.
 */

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

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

const probeDir = path.resolve(process.cwd(), "tests/phase-6-ad");
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
import type { ExtractedMemory } from "@/lib/memory/types";

interface ReflectionResult {
  title: string;
  content: string;
  importance?: number;
  confidence?: number;
  classification: "USEFUL_GROUNDED" | "REPETITIVE" | "WEAK" | "UNSUPPORTED";
}

interface ConditionResult {
  name: string;
  finalResult: number;
  reflections: ReflectionResult[];
  [key: string]: unknown;
}

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

function buildReflectionInput(memories: MemoryRow[]): ReflectionInput[] {
  const reflectionCandidates = memories.filter(isEligible);
  const reflectionGroups = reflectionCandidates.reduce(
    (groups, memory) => {
      const type = memory.memory_type;
      if (!groups[type]) groups[type] = [];
      groups[type].push(memory);
      return groups;
    },
    {} as Record<string, MemoryRow[]>
  );
  return Object.entries(reflectionGroups).map(([memoryType, mems]) => ({
    memoryType,
    memories: mems.map((memory) => ({
      id: memory.id,
      title: memory.title,
      content: memory.content,
      summary: memory.summary ?? "",
      importance: memory.importance_v2,
      confidence: memory.confidence_v2,
      memoryType: memory.memory_type,
      tags: memory.tags ?? [],
      metadata: memory.metadata ?? {},
    })),
  }));
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

function classifyReflection(
  reflectionContent: string,
  sourceContents: string[]
): "USEFUL_GROUNDED" | "REPETITIVE" | "WEAK" | "UNSUPPORTED" {
  const tokens = tokenize(reflectionContent);
  if (tokens.length === 0) return "UNSUPPORTED";

  const sourceCorpus = sourceContents.join(" ").toLowerCase();
  const sourceTokens = new Set(tokenize(sourceCorpus));

  let groundedCount = 0;
  const themes = new Set<string>();

  for (const tok of tokens) {
    if (sourceTokens.has(tok)) groundedCount++;
  }

  const groundedFraction = groundedCount / tokens.length;
  if (groundedFraction < 0.3) return "UNSUPPORTED";

  const maxSourceSim = Math.max(
    ...sourceContents.map((s) => similarity(reflectionContent, s))
  );
  if (maxSourceSim > 0.85) return "REPETITIVE";

  for (let i = 0; i < sourceContents.length; i++) {
    for (let j = i + 1; j < sourceContents.length; j++) {
      const si = similarity(reflectionContent, sourceContents[i]);
      const sj = similarity(reflectionContent, sourceContents[j]);
      if (si > 0.2 && sj > 0.2) themes.add(`${i}-${j}`);
    }
  }
  if (themes.size < 2 && sourceContents.length >= 4) return "WEAK";

  return "USEFUL_GROUNDED";
}

function sanitizeReflection(raw: unknown): ExtractedMemory | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.title !== "string" || typeof r.content !== "string") {
    return null;
  }
  const title = r.title.trim();
  const content = r.content.trim();
  if (!title || !content) return null;

  const memory: ExtractedMemory = {
    title,
    content,
    memoryType: "reflection",
  };
  if (
    typeof r.importance === "number" &&
    Number.isInteger(r.importance) &&
    r.importance >= 1 &&
    r.importance <= 10
  ) {
    memory.importance = r.importance;
  }
  if (
    typeof r.confidence === "number" &&
    r.confidence >= 0 &&
    r.confidence <= 1
  ) {
    memory.confidence = r.confidence;
  }
  return memory;
}

const BASELINE_PROMPT = `\nYou are AETHER'S MEMORY REFLECTION ENGINE.

You analyze existing memories and produce ONLY high-confidence higher-level insights.

You are NOT a chatbot.
You are NOT an assistant.
You are NOT allowed to invent facts.

Return ONLY valid JSON.

Your output MUST be a JSON array.

If there is no strong insight, return [].

IMPORTANT:
Prefer returning [] over making a weak or speculative reflection.

==================================================
WHAT COUNTS AS A VALID REFLECTION
==================================================

A valid reflection must connect TWO OR MORE supplied memories.

Allowed reflection types:

1. REPEATED_PATTERN
A fact, preference, behavior, or theme appears repeatedly.

2. CONTRADICTION
Two or more memories directly conflict.

3. RELATIONSHIP
Two or more memories have a strong and explicit relationship.

4. CHANGE_OVER_TIME
ONLY use this when the supplied memories explicitly contain evidence
that something changed over time.

==================================================
STRICT RULES
==================================================

RULE 1:
Use ONLY information explicitly present in the supplied memories.

RULE 2:
Never invent facts.

RULE 3:
Never invent motivations.

RULE 4:
Never invent chronology.

RULE 5:
Never assume that one memory replaces another.

RULE 6:
If two memories conflict, describe the conflict.
Do NOT decide which one is correct.

RULE 7:
Do not create a reflection from only one memory.

RULE 8:
Do not create a reflection merely because several memories mention
the same broad topic.

Example:

Memory A:
"The user is building Aether."

Memory B:
"The user is testing Aether memory."

This alone is NOT enough to create a new reflection.

RULE 9:
Do not create multiple reflections that express essentially the same idea.

If several memories support the same pattern, produce ONE reflection.

RULE 10:
Do not create a reflection about the reflection itself.

RULE 11:
Do not create vague statements such as:
"The user has many interests."
"The user is focused on development."
"The user works on projects."

These are not useful memories.

RULE 12:
A reflection must add information that is more useful than simply repeating
the source memories.

==================================================
CONTRADICTIONS
==================================================

When memories conflict, explicitly state the conflict.

GOOD:

[
  {
    "title": "Development Language Conflict",
    "content": "The memories contain conflicting preferences: some indicate TypeScript while another indicates Python.",
    "importance": 6,
    "confidence": 0.9
  }
]

BAD:

[
  {
    "title": "Change to Python",
    "content": "The user changed from TypeScript to Python."
  }
]

The BAD example invents a timeline unless the memories explicitly say
that the preference changed.

==================================================
REPEATED PATTERNS
==================================================

Only create a repeated pattern when the same meaningful fact is supported
by multiple memories.

GOOD:

Memory A:
"The user prefers dark mode."

Memory B:
"The user repeatedly chooses dark interfaces."

Memory C:
"The user asked to keep the interface dark."

Possible reflection:

[
  {
    "title": "Dark Interface Preference",
    "content": "Multiple memories consistently indicate a preference for dark interfaces.",
    "importance": 5,
    "confidence": 0.9
  }
]

==================================================
DEDUPLICATION
==================================================

Never output several reflections that say approximately the same thing.

For example, these are duplicates:

"TypeScript Preference"

"Strong TypeScript Preference"

"Recurring TypeScript Preference"

"TypeScript Development Preference"

Only ONE should be returned.

==================================================
OUTPUT LIMIT
==================================================

Return AT MOST 2 reflections.

Usually return 0 or 1.

Only return 2 when there are clearly two independent,
high-confidence insights.

==================================================
OUTPUT FORMAT
==================================================

Return EXACTLY:

[
  {
    "title": "Short descriptive title",
    "content": "Grounded synthesis supported by multiple supplied memories.",
    "importance": 1,
    "confidence": 0.0
  }
]

importance:
Integer from 1 to 10.

confidence:
Number from 0 to 1.

Do not include:
- memory IDs
- memoryType
- source
- explanations
- markdown
- code fences
- additional fields

==================================================
FINAL CHECK BEFORE OUTPUT
==================================================

Before returning a reflection, silently verify:

1. Is it supported by at least TWO supplied memories?
2. Does it add useful information?
3. Is every claim explicitly grounded?
4. Did I avoid inventing chronology?
5. Did I avoid inventing motivation?
6. Did I avoid choosing between conflicting memories?
7. Is it different from the other reflection?
8. Would [] be safer?

If any answer is NO, do not output that reflection.

Return [] instead.
`;

const BASELINE_RULE_8 =
  `RULE 8:\nDo not create a reflection merely because several memories mention
the same broad topic.

Example:

Memory A:
"The user is building Aether."

Memory B:
"The user is testing Aether memory."

This alone is NOT enough to create a new reflection.`;

const BASELINE_RULE_12 =
  `RULE 12:\nA reflection must add information that is more useful than simply repeating
the source memories.`;

const BASELINE_FINAL_CHECK =
  `FINAL CHECK BEFORE OUTPUT
==================================================

Before returning a reflection, silently verify:

1. Is it supported by at least TWO supplied memories?
2. Does it add useful information?
3. Is every claim explicitly grounded?
4. Did I avoid inventing chronology?
5. Did I avoid inventing motivation?
6. Did I avoid choosing between conflicting memories?
7. Is it different from the other reflection?
8. Would [] be safer?

If any answer is NO, do not output that reflection.

Return [] instead.`;

const RELAXED_RULE_8 = `RULE 8:
You may create a reflection when several memories share a broad topic, provided the reflection connects those memories and adds a grounded synthesis. Do not reject a reflection merely because the memories are about the same general subject.`;

const RELAXED_RULE_12 = `RULE 12:
A reflection should add meaningful synthesis beyond the literal wording of any single source memory. It is acceptable to restate and connect facts already present across the supplied memories in a new higher-level form; do not reject a reflection merely because it relates to information already present, as long as it adds genuine cross-memory synthesis.`;

const RELAXED_FINAL_CHECK = `FINAL CHECK BEFORE OUTPUT
==================================================

Before returning a reflection, silently verify:

1. Is it supported by at least TWO supplied memories?
2. Does it add useful information?
3. Is every claim explicitly grounded?
4. Did I avoid inventing chronology?
5. Did I avoid inventing motivation?
6. Did I avoid choosing between conflicting memories?
7. Is it different from the other reflection?
Only omit a reflection if it fails these checks. Include a reflection when it clearly meets them.`;

function buildPromptB(): string {
  return BASELINE_PROMPT.replace(BASELINE_RULE_8, RELAXED_RULE_8);
}

function buildPromptC(): string {
  return BASELINE_PROMPT.replace(BASELINE_RULE_12, RELAXED_RULE_12);
}

function buildPromptD(): string {
  return BASELINE_PROMPT.replace(BASELINE_FINAL_CHECK, RELAXED_FINAL_CHECK);
}

function buildPromptE(): string {
  return buildPromptB().replace(BASELINE_RULE_12, RELAXED_RULE_12).replace(BASELINE_FINAL_CHECK, RELAXED_FINAL_CHECK);
}

const MODEL = "qwen2.5:3b";
const OPTIONS = { temperature: 0.1, num_predict: 300, top_p: 0.8, num_ctx: 4096 };
const OLLAMA_URL = "http://127.0.0.1:11434/api/chat";

async function callOllamaWithPrompt(
  systemPrompt: string,
  input: ReflectionInput[]
): Promise<string> {
  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      options: OPTIONS,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(input, null, 2) },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
  const data: unknown = await res.json().catch(() => null);
  const content =
    (data &&
      typeof data === "object" &&
      "message" in data &&
      (
        data as { message?: { content?: unknown } }
      ).message?.content) ||
    "";
  return typeof content === "string" ? content.trim() : "";
}

async function parseAndSanitize(text: string): Promise<ExtractedMemory[]> {
  if (!text) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => sanitizeReflection(item))
      .filter((m): m is ExtractedMemory => m !== null)
      .slice(0, 2);
  } catch {
    return [];
  }
}

describe("Phase 6-AE: Controlled Prompt Sensitivity Experiment", () => {
  it("tests prompt rule relaxation on real 21-memory input (read-only)", async () => {
    if (ENV_MISSING) {
      console.warn("ENV_MISSING — cannot run integration test");
      return;
    }

    const measurement: Record<string, unknown> = {
      startedAt: new Date().toISOString(),
      experiment: "phase-6-ae-prompt-sensitivity-experiment",
      productionWrites: 0,
      productionFilesModified: [],
      safety: {
        productionWrites: 0,
        noDBWrites: true,
        noSaveMemory: true,
        mockSupabase: true,
        readOnlySource: "getAllMemories (read-only SELECT)",
      },
      model: {
        name: MODEL,
        temperature: 0.1,
        num_predict: 300,
        top_p: 0.8,
        num_ctx: 4096,
        endpoint: OLLAMA_URL,
      },
    };

    const { data: allMemories, error } = await getAllMemories(USER!);
    if (error || !allMemories) {
      throw new Error(`getAllMemories failed: ${JSON.stringify(error)}`);
    }

    const eligible = allMemories.filter(isEligible) as MemoryRow[];
    const reflectionInput = buildReflectionInput(eligible);

    const sourceContents: string[] = eligible.map((m) => m.content);

    const baselineHash = await sha256(BASELINE_PROMPT);
    const expectedHash = "24aa25c19b439cb5";

    measurement.promptFidelity = {
      baselinePromptLength: BASELINE_PROMPT.length,
      baselinePromptHash: baselineHash,
      expectedHash: "24aa25c19b439cb5fa988729535a90ebf756498e132e4c5c6157a7a516970975",
      hashMatch: baselineHash.substring(0, 16) === expectedHash,
    };

    const conditions: Array<{
      id: string;
      name: string;
      prompt: string;
      isProductionPath: boolean;
    }> = [
      { id: "A", name: "Baseline (production prompt)", prompt: BASELINE_PROMPT, isProductionPath: true },
      { id: "B", name: "RULE 8 relaxed", prompt: buildPromptB(), isProductionPath: false },
      { id: "C", name: "RULE 12 relaxed", prompt: buildPromptC(), isProductionPath: false },
      { id: "D", name: "FINAL CHECK relaxed", prompt: buildPromptD(), isProductionPath: false },
      { id: "E", name: "Minimal combined (B+C+D)", prompt: buildPromptE(), isProductionPath: false },
    ];

    const results: Record<string, ConditionResult> = {};
    const rawOutputs: Record<string, unknown> = {};
    const sourceMemoryCount = eligible.length;

    for (const cond of conditions) {
      let rawText: string;
      let latencyMs: number;

      if (cond.isProductionPath) {
        const t0 = Date.now();
        const output = await generateReflections(reflectionInput);
        latencyMs = Date.now() - t0;
        rawText = "production_path";
        rawOutputs[cond.id] = {
          rawModelText: "[production path — not captured]",
          parsed: output.map((m) => ({
            title: m.title,
            content: m.content,
            importance: m.importance,
            confidence: m.confidence,
            memoryType: m.memoryType,
          })),
        };
        results[cond.id] = {
          name: cond.name,
          parseSuccess: true,
          rootType: "array",
          candidateCount: output.length,
          sanitizedAccepted: output.length,
          sanitizedRejected: 0,
          finalResult: output.length,
          latencyMs,
          isProductionPath: true,
          reflections: output.map((m) => ({
            title: m.title,
            content: m.content,
            importance: m.importance,
            confidence: m.confidence,
            classification: classifyReflection(m.content, sourceContents),
          })),
        };
      } else {
        const t0 = Date.now();
        rawText = await callOllamaWithPrompt(cond.prompt, reflectionInput);
        latencyMs = Date.now() - t0;
        const parsed = await parseAndSanitize(rawText);
        rawOutputs[cond.id] = {
          rawModelText: rawText,
          parsed: parsed.map((m) => ({
            title: m.title,
            content: m.content,
            importance: m.importance,
            confidence: m.confidence,
            memoryType: m.memoryType,
          })),
        };
        results[cond.id] = {
          name: cond.name,
          rawModelTextLength: rawText.length,
          isEmptyText: rawText === "",
          isLiteralEmptyArray: rawText === "[]",
          parseSuccess: rawText === "" ? false : rawText.startsWith("[") && rawText.endsWith("]"),
          rootType: rawText.startsWith("[") ? "array" : "other",
          candidateCount: (() => {
            try {
              const p = JSON.parse(rawText);
              return Array.isArray(p) ? p.length : 0;
            } catch {
              return 0;
            }
          })(),
          sanitizedAccepted: parsed.length,
          sanitizedRejected: 0,
          finalResult: parsed.length,
          latencyMs,
          isProductionPath: false,
          reflections: parsed.map((m) => ({
            title: m.title,
            content: m.content,
            importance: m.importance,
            confidence: m.confidence,
            classification: classifyReflection(m.content, sourceContents),
          })),
        };
      }

      console.log(
        `  [${cond.id}] ${cond.name}: final=${results[cond.id].finalResult} latency=${latencyMs}ms`
      );
    }

    const nonemptyVariants = conditions
      .filter((c) => !c.isProductionPath)
      .map((c) => c.id)
      .filter((id) => results[id].finalResult > 0);

    measurement.experiment = {
      input: {
        totalMemories: allMemories.length,
        eligibleCount: sourceMemoryCount,
        typeGroups: reflectionInput.map((g) => ({
          memoryType: g.memoryType,
          count: g.memories.length,
        })),
      },
      conditions: results,
      nonemptyVariants,
      invocationBudget: {
        primary: conditions.length,
        confirmation: 0,
        total: conditions.length + 0,
      },
    };

    const aEmpty = results.A.finalResult === 0;
    const anyVariantNonempty = nonemptyVariants.length > 0;
    const anyUsefulGrounded = conditions
      .filter((c) => !c.isProductionPath)
      .some(
        (c) =>
          results[c.id].finalResult > 0 &&
          results[c.id].reflections.some(
            (r) => r.classification === "USEFUL_GROUNDED"
          )
      );

    if (anyUsefulGrounded) {
      const singleRules = ["B", "C", "D"].filter(
        (id) =>
          results[id].finalResult > 0 &&
          results[id].reflections.some(
            (r: ReflectionResult) => r.classification === "USEFUL_GROUNDED"
          )
      );
      const combinedOnly =
        singleRules.length === 0 &&
        nonemptyVariants.includes("E") &&
        results.E.reflections.some(
          (r: ReflectionResult) => r.classification === "USEFUL_GROUNDED"
        );

      if (singleRules.length === 1) {
        measurement.causalClassification = "RULE_CAUSAL";
        measurement.causalRule = singleRules[0];
      } else if (singleRules.length > 1) {
        measurement.causalClassification = "RULE_CAUSAL";
        measurement.causalRules = singleRules;
      } else if (combinedOnly) {
        measurement.causalClassification = "COMBINED_PROMPT_EFFECT";
      } else {
        measurement.causalClassification = "RULE_CONTRIBUTORY";
      }
    } else if (anyVariantNonempty) {
      measurement.causalClassification = "RULE_CONTRIBUTORY";
    } else if (aEmpty) {
      measurement.causalClassification = "INPUT_DOMINANT";
    } else {
      measurement.causalClassification = "MODEL_BEHAVIOR_UNEXPLAINED";
    }

    measurement.classification = measurement.causalClassification;
    measurement.productionChangeJustified = false;

    fs.writeFileSync(
      measurementPath,
      JSON.stringify(measurement, null, 2)
    );

    expect((measurement.promptFidelity as { hashMatch: boolean }).hashMatch).toBe(true);
    expect(allMemories.length).toBeGreaterThan(0);
    expect(reflectionInput.length).toBeGreaterThan(0);

    console.log(
      `Classification: ${measurement.classification} | Variants nonempty: ${nonemptyVariants.join(",") || "none"}`
    );
  }, 300000);
});
