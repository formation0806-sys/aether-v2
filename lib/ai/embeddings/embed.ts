import { EmbeddingResult } from "../types";

export async function embed(
  text: string
): Promise<EmbeddingResult> {
  const response = await fetch(
    "http://127.0.0.1:11434/api/embed",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "nomic-embed-text:latest",
        input: [text],
      }),
    }
  );

  const json = await response.json();

  console.log("OLLAMA RESPONSE:");
  console.log(json);

  if (!response.ok) {
    throw new Error(JSON.stringify(json));
  }

  if (!json.embeddings) {
    throw new Error("No embeddings field returned.");
  }

  if (!Array.isArray(json.embeddings)) {
    throw new Error("Embeddings is not an array.");
  }

  if (json.embeddings.length === 0) {
    throw new Error("Embedding array is empty.");
  }

  return {
    embedding: json.embeddings[0],
  };
}