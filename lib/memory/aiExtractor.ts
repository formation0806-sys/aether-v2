import { MEMORY_TYPES, type ExtractedMemory, type MemoryType } from "./types";

/** Sanitize one parsed extractor item; invalid optional fields are omitted. */
function sanitizeExtractedMemory(raw: unknown): ExtractedMemory | null {
  if (typeof raw !== "object" || raw === null) return null;

  const r = raw as Record<string, unknown>;
  const title = r.title;
  const content = r.content;

  if (typeof title !== "string" || typeof content !== "string") return null;

  const memory: ExtractedMemory = { title, content };

  if (
    typeof r.memoryType === "string" &&
    (MEMORY_TYPES as readonly string[]).includes(r.memoryType)
  ) {
    memory.memoryType = r.memoryType as MemoryType;
  }

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

  if (typeof r.explicit === "boolean") {
    memory.explicit = r.explicit;
  }

  return memory;
}

export async function aiExtractMemories(
  message: string
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
You are an INFORMATION EXTRACTION ENGINE.

DO NOT answer the user.

DO NOT explain.

DO NOT chat.

ONLY return valid JSON.

Return ONLY this format:

[
  {
    "title": "...",
    "content": "...",
    "memoryType": "...",
    "importance": 1-10,
    "confidence": 0-1,
    "explicit": true/false
  }
]

Optional fields (omit any you are unsure about):

- memoryType must be one of:
  semantic, identity, procedural, project, episodic, reflection, conversation, working
- importance: number from 1 (low) to 10 (high)
- confidence: number from 0 to 1
- explicit: true only if the user explicitly asked for this to be remembered

Extract ONLY long-term information.

Examples:

User:
My name is Prince.

Output:
[
  {
    "title":"User Name",
    "content":"The user's name is Prince.",
    "memoryType":"identity",
    "importance":8,
    "confidence":0.95,
    "explicit":false
  }
]

User:
I'm building Aether.

Output:
[
  {
    "title":"Project",
    "content":"The user is building Aether."
  }
]

User:
My dog is Bruno.

Output:
[
  {
    "title":"Pet",
    "content":"The user's dog is Bruno."
  }
]

User:
I live in Mumbai.

Output:
[
  {
    "title":"Location",
    "content":"The user lives in Mumbai."
  }
]

User:
Blue is my favorite color.

Output:
[
  {
    "title":"Preference",
    "content":"The user's favorite color is blue."
  }
]

If nothing should be remembered:

[]
`,
          },
          {
            role: "user",
            content: message,
          },
        ],
      }),
    }
  );

  const data = await response.json();

  const text = data.message.content.trim();

  console.log("OLLAMA RAW:");
  console.log(text);

  try {
    const parsed: unknown = JSON.parse(text);

    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => sanitizeExtractedMemory(item))
      .filter((m): m is ExtractedMemory => m !== null);
  } catch {
    return [];
  }
}