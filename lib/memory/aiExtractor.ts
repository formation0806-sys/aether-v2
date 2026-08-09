import { getProvider } from "@/lib/ai/provider";

export interface ExtractedMemory {
  title: string;
  content: string;
}

export async function aiExtractMemories(
  message: string
): Promise<ExtractedMemory[]> {
  const ai = getProvider();

  const response = await ai.chat([
    {
      role: "system",
      content: `
You are a JSON API.

You NEVER explain.

You NEVER chat.

Extract long-term memories from the user message.

Return ONLY a JSON array.

Example:

[
  {
    "title":"User Name",
    "content":"The user's name is Prince."
  },
  {
    "title":"Location",
    "content":"The user lives in Mumbai."
  }
]

Remember:

- name
- city
- country
- age
- job
- preferences
- pets
- goals
- projects
- skills

Ignore:

- greetings
- jokes
- temporary questions
- requests

If nothing should be stored return exactly:

[]
`,
    },
    {
      role: "user",
      content: message,
    },
  ]);

  console.log("OLLAMA RAW:");
  console.log(response);

  try {
    const cleaned = response
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    return JSON.parse(cleaned);
  } catch (err) {
    console.error("FAILED TO PARSE");
    console.log(response);
    return [];
  }
}