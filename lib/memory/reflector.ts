import type { ExtractedMemory } from "./types";
import { OLLAMA_BASE_URL, OLLAMA_AUTH_HEADER } from "@/lib/ai/config";

/** Input shape produced by `runReflection` in lib/core/pipeline.ts. */
export interface ReflectionInput {
  memoryType: string;
  memories: Array<{
    id: string;
    title: string;
    content: string;
    summary: string;
    // Nullable DB columns (importance_v2 / confidence_v2 / tags / metadata)
    // are forwarded verbatim; the reflection sanitizer drops null values.
    importance?: number | null;
    confidence?: number | null;
    memoryType?: string;
    tags?: string[] | null;
    metadata?: Record<string, unknown> | null;
  }>;
}

/**
 * Sanitize one parsed reflection item.
 *
 * Reflection output is intentionally strict:
 * - only plain objects are accepted
 * - title/content are required
 * - memoryType is always reflection
 * - importance/confidence are accepted only when valid
 */
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

  if (!title || !content) {
    return null;
  }

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

/**
 * Reflection prompt deliberately optimized for a small local model.
 *
 * The goal is not to generate many insights.
 * The goal is to produce only high-confidence, reusable information.
 */
const REFLECTION_SYSTEM_PROMPT = `
You are AETHER'S MEMORY REFLECTION ENGINE.

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

/**
 * Ask the local Ollama model to reflect over grouped memories.
 *
 * This function never writes to the database.
 * It only returns validated reflection candidates.
 */
export async function generateReflections(
  reflectionInput: ReflectionInput[]
): Promise<ExtractedMemory[]> {
  if (!reflectionInput.length) {
    return [];
  }

  const response = await fetch(
      `${OLLAMA_BASE_URL}/api/chat`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(OLLAMA_AUTH_HEADER ? { Authorization: OLLAMA_AUTH_HEADER } : {}),
      },
      body: JSON.stringify({
        model: "qwen2.5:3b",
        stream: false,

        options: {
          temperature: 0.1,
          num_predict: 300,
          top_p: 0.8,
          num_ctx: 4096,
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

  if (!response.ok) {
    throw new Error(
      `Reflection request failed with status ${response.status}.`
    );
  }

  const data = await response.json();

  const text =
    typeof data?.message?.content === "string"
      ? data.message.content.trim()
      : "";

  console.log("REFLECTION RAW:");
  console.log(text);

  if (!text) {
    console.log("REFLECTION PARSED 0");
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(text);

    if (!Array.isArray(parsed)) {
      console.log("REFLECTION PARSED 0: root is not array");
      return [];
    }

    const reflections = parsed
      .map((item) => sanitizeReflection(item))
      .filter((m): m is ExtractedMemory => m !== null)
      .slice(0, 2);

    console.log("REFLECTION PARSED", reflections.length);

    return reflections;
  } catch (error) {
    console.error("REFLECTION JSON PARSE FAILED", error);
    return [];
  }
}