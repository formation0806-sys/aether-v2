import type { ExtractedMemory } from "./types";

/** Input shape produced by `runReflection` in lib/core/pipeline.ts. */
export interface ReflectionInput {
  memoryType: string;
  memories: Array<{
    id: string;
    title: string;
    content: string;
    summary: string;
  }>;
}

/**
 * Sanitize one parsed reflection item.
 * memoryType is force-set to "reflection". Invalid optional
 * importance / confidence fields are omitted, never fabricated.
 */
function sanitizeReflection(raw: unknown): ExtractedMemory | null {
  if (typeof raw !== "object" || raw === null) return null;

  const r = raw as Record<string, unknown>;
  const title = r.title;
  const content = r.content;

  if (typeof title !== "string" || typeof content !== "string") return null;

  const memory: ExtractedMemory = { title, content, memoryType: "reflection" };

  if (
    typeof r.importance === "number" &&
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

/**
 * Sprint 22 — improved reflection system prompt.
 *
 * The original prompt had no examples and told the model to "return [] if there
 * are no useful patterns", which made qwen2.5:3b default to [] for every input.
 * This version teaches the model which categories of synthesis are useful,
 * grounds every claim in the supplied memories, represents contradictions as
 * uncertainty (never fabricated chronology), provides few-shot examples,
 * and explicitly permits [] when no meaningful relationship exists.
 */
const REFLECTION_SYSTEM_PROMPT = `
You are a REFLECTION ENGINE that analyzes a user's stored memories.

Your task is to look ACROSS the supplied memories and identify useful higher-level information:
patterns, contradictions, relationships, preferences, behavioral tendencies,
recurring themes, or changes over time.

You are NOT extracting new facts. You are synthesizing what is already present.

DO NOT answer the user. DO NOT chat. DO NOT explain. ONLY return valid JSON.

Consider ONLY these reflection categories:

- pattern: repeated preferences, behaviors, or themes across memories
- contradiction: two or more memories that conflict
- relationship: a meaningful connection between separate facts
- preference: a clear preference supported by multiple pieces of evidence
- behavioral_tendency: a recurring habit or approach
- recurring_theme: a topic that appears repeatedly
- change_over_time: evidence that something evolved or was updated

GROUNDING RULES (strict):

1. Every reflection must be grounded in the supplied memories.
2. Never invent facts, motivations, plans, or personal information not present in the input.
3. Never treat speculation as fact.
4. If memories conflict, represent the conflict as uncertainty. Do NOT decide which memory is currently true.
5. Do NOT invent a timeline or narrative (e.g. "moved from X to Y") unless the memories themselves state it.
6. Repeated evidence may be synthesized into a single higher-level pattern.
7. Do NOT artificially connect unrelated memories.
8. If there is genuinely no meaningful relationship, return [].

Return ONLY a JSON array. Each item uses EXACTLY this shape:

[
  {
    "title": "short label for the insight",
    "content": "grounded synthesis of the supplied memories",
    "importance": 1-10,
    "confidence": 0-1
  }
]

- importance: integer 1 (low) to 10 (high)
- confidence: number 0 to 1 reflecting how strongly the evidence supports the insight
- Do not include markdown, code fences, or text outside the JSON array.

EXAMPLES

Example 1 — CONTRADICTION

Input:
[
  { "memoryType": "identity", "memories": [
    { "title": "Home City", "content": "The user lives in Mumbai." },
    { "title": "Home City Updated", "content": "The user lives in Delhi." }
  ]}
]

Good output:
[
  {
    "title": "Location Uncertainty",
    "content": "The memories contain conflicting locations: Mumbai and Delhi.",
    "importance": 6,
    "confidence": 0.95
  }
]

Do NOT write "the user moved from Mumbai to Delhi" — no move was stated.

Example 2 — REPEATED PREFERENCE

Input:
[
  { "memoryType": "semantic", "memories": [
    { "title": "Coffee", "content": "The user loves coffee." },
    { "title": "Drinks", "content": "The user orders espresso drinks." },
    { "title": "Morning", "content": "The user drinks coffee every morning." }
  ]}
]

Good output:
[
  {
    "title": "Strong Coffee Preference",
    "content": "Multiple memories consistently indicate a strong preference for coffee, including espresso drinks and a regular morning coffee habit.",
    "importance": 6,
    "confidence": 0.9
  }
]

Example 3 — HIGHER-LEVEL PATTERN

Input:
[
  { "memoryType": "identity", "memories": [
    { "title": "Job", "content": "The user is a backend engineer." },
    { "title": "Stack", "content": "The user works with TypeScript and Node.js." },
    { "title": "Focus", "content": "The user is building an AI assistant." },
    { "title": "Experience", "content": "The user has previously built memory systems." }
  ]}
]

Good output:
[
  {
    "title": "AI Developer Profile",
    "content": "The memories consistently indicate a software engineering focus centered on backend development and building AI systems.",
    "importance": 7,
    "confidence": 0.9
  }
]

Do NOT invent an employer, company, or seniority.

Example 4 — NO MEANINGFUL CONNECTION

Input:
[
  { "memoryType": "semantic", "memories": [
    { "title": "Color", "content": "The user's favorite color is blue." },
    { "title": "Purchase", "content": "The user bought a chair last Tuesday." },
    { "title": "Weather", "content": "The weather was rainy." }
  ]}
]

Good output:
[]

These memories share no meaningful relationship; an empty array is correct.

Remember:
- Synthesize, do not invent.
- Represent contradictions as uncertainty.
- Return [] when nothing meaningful exists.
`;

/**
 * Ask the local Ollama model to reflect over grouped memories and return
 * higher-level insight candidates (patterns, contradictions, relationships).
 * Mirrors the direct-fetch pattern of aiExtractor.ts. Never writes to the DB.
 */
export async function generateReflections(
  reflectionInput: ReflectionInput[]
): Promise<ExtractedMemory[]> {
  const response = await fetch(
    "http://127.0.0.1:11434/api/chat",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen2.5:3b",
        stream: false,
        options: {
          temperature: 0.3,
        },
        messages: [
          {
            role: "system",
            content: REFLECTION_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: JSON.stringify(reflectionInput, null, 2),
          },
        ],
      }),
    }
  );

  const data = await response.json();

  const text = data.message.content.trim();

  console.log("REFLECTION RAW:");
  console.log(text);

  try {
    const parsed: unknown = JSON.parse(text);

    if (!Array.isArray(parsed)) return [];

    const reflections = parsed
      .map((item) => sanitizeReflection(item))
      .filter((m): m is ExtractedMemory => m !== null);

    console.log("REFLECTION PARSED", reflections.length);

    return reflections;
  } catch {
    return [];
  }
}