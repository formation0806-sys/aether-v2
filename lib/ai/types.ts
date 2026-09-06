export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type EmbeddingResult = {
  embedding: number[];
};

export interface AIProvider {
  chat(messages: ChatMessage[]): Promise<string>;
  /**
   * Streamed chat — returns a ReadableStream of text chunks (the incremental
   * `message.content` pieces produced by the provider's streaming endpoint).
   * The caller is responsible for accumulating the full response and
   * persisting it once the stream ends.
   */
  chatStream(messages: ChatMessage[]): Promise<ReadableStream<Uint8Array>>;
  embed(text: string): Promise<EmbeddingResult>;
  name(): string;
}