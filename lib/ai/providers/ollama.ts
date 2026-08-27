import {
  AIProvider,
  ChatMessage,
  EmbeddingResult,
} from "../types";
import { OLLAMA_BASE_URL, OLLAMA_AUTH_HEADER } from "../config";

export class OllamaProvider implements AIProvider {
  async chat(messages: ChatMessage[]): Promise<string> {
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
            temperature: 0.2,
            num_predict: 200,
            top_p: 0.9,
            num_ctx: 2048,
          },

          messages,
        }),
      }
    );

    if (!response.ok) {
      throw new Error("Failed to talk to Ollama.");
    }

    const data = await response.json();

    return data.message.content;
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const response = await fetch(
      `${OLLAMA_BASE_URL}/api/embed`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(OLLAMA_AUTH_HEADER ? { Authorization: OLLAMA_AUTH_HEADER } : {}),
        },
        body: JSON.stringify({
          model: "nomic-embed-text",
          input: text,
        }),
      }
    );

    if (!response.ok) {
      throw new Error("Embedding failed.");
    }

    const data = await response.json();

    return {
      embedding: data.embeddings[0],
    };
  }

  name() {
    return "Ollama";
  }
}