import { EmbeddingResult } from "../types";
import { OLLAMA_BASE_URL, OLLAMA_AUTH_HEADER } from "../config";

export async function embed(
  text: string
): Promise<EmbeddingResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000);

  let response: Response;
  try {
    response = await fetch(
      `${OLLAMA_BASE_URL}/api/embed`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(OLLAMA_AUTH_HEADER ? { Authorization: OLLAMA_AUTH_HEADER } : {}),
        },
        body: JSON.stringify({
          model: "nomic-embed-text:latest",
          input: [text],
        }),
        signal: controller.signal,
      }
    );
  } catch (error) {
    clearTimeout(timeoutId);
    if ((error as Error)?.name === "AbortError") {
      throw new Error("Embedding request timed out.");
    }
    throw new Error(
      `Embedding request failed: ${(error as Error)?.message ?? "network error"}`
    );
  } finally {
    clearTimeout(timeoutId);
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new Error("Embedding response is not valid JSON.");
  }

  if (!response.ok) {
    const body =
      typeof json === "object" && json !== null
        ? JSON.stringify(json)
        : String(json);
    throw new Error(`Embedding request failed with status ${response.status}: ${body}`);
  }

  if (typeof json !== "object" || json === null || !("embeddings" in json)) {
    throw new Error("No embeddings field returned.");
  }

  const embeddings = (json as { embeddings?: unknown }).embeddings;

  if (!Array.isArray(embeddings)) {
    throw new Error("Embeddings is not an array.");
  }

  if (embeddings.length === 0) {
    throw new Error("Embedding array is empty.");
  }

  return {
    embedding: embeddings[0] as number[],
  };
}