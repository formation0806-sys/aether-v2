import {
  AIProvider,
  ChatMessage,
  EmbeddingResult,
} from "../types";

export class OllamaProvider implements AIProvider {
  async chat(messages: ChatMessage[]): Promise<string> {
    const response = await fetch("http://127.0.0.1:11434/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen2.5:3b",
        messages,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to talk to Ollama.");
    }

    const data = await response.json();

    return data.message.content;
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const response = await fetch("http://127.0.0.1:11434/api/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen2.5:3b",
        prompt: text,
      }),
    });

    if (!response.ok) {
      throw new Error("Embedding failed.");
    }

    const data = await response.json();

    return {
      embedding: data.embedding,
    };
  }

  name(): string {
    return "Ollama";
  }
}