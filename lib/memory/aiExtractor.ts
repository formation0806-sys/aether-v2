export interface ExtractedMemory {
  title: string;
  content: string;
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
    "content": "..."
  }
]

Extract ONLY long-term information.

Examples:

User:
My name is Prince.

Output:
[
  {
    "title":"User Name",
    "content":"The user's name is Prince."
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
    return JSON.parse(text);
  } catch {
    return [];
  }
}