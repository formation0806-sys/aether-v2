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
        model: "qwen3:4b",
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
    const response = await fetch("http://127.0.0.1:11434/api/embed", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen3:4b",
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

  name(): string {
    return "Ollama";
  }
}