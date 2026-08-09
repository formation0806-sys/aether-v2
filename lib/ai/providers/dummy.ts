import {
  AIProvider,
  ChatMessage,
  EmbeddingResult,
} from "../types";

export class DummyProvider implements AIProvider {
  async chat(messages: ChatMessage[]): Promise<string> {
    const last = messages[messages.length - 1];

    return `Dummy AI received: ${last?.content ?? ""}`;
  }

  async embed(text: string): Promise<EmbeddingResult> {
    return {
      embedding: Array(10).fill(text.length),
    };
  }

  name(): string {
    return "Dummy";
  }
}