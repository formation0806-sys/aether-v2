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

  async chatStream(messages: ChatMessage[]): Promise<ReadableStream<Uint8Array>> {
    const last = messages[messages.length - 1];
    const content = `Dummy AI received: ${last?.content ?? ""}`;

    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(content));
        controller.close();
      },
    });
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