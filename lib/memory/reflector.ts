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
        messages: [
          {
            role: "system",
            content: `
You are a REFLECTION ENGINE that analyzes a user's stored memories.

DO NOT answer the user.

DO NOT explain.

DO NOT chat.

ONLY return valid JSON.

You will receive a list of memory groups. Each group has a "memoryType" and a list of memories (each with id, title, content, summary).

Identify useful patterns, contradictions, relationships, or higher-level insights.

Return ONLY this format:

[
  {
    "title": "...",
    "content": "...",
    "importance": 1-10,
    "confidence": 0-1
  }
]

Rules:

- "title": short label for the insight.
- "content": a detailed, useful insight derived ONLY from the supplied memories.
- "importance": number from 1 (low) to 10 (high).
- "confidence": number from 0 to 1.
- Do not invent facts that are not present in the supplied memories.
- If there are no useful patterns or insights, return [] instead.
`,
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