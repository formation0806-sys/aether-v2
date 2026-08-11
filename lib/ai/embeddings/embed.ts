import { EmbeddingResult } from "../types";

export async function embed(text: string): Promise<EmbeddingResult> {
  const response = await fetch("http://127.0.0.1:11434/api/embed", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "nomic-embed-text",
      input: text,
    }),
  });

  if (!response.ok) {
    throw new Error("Embedding failed.");
  }

  const data = await response.json();

  return {
    embedding: data.embeddings[0],
  };
}