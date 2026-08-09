export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type EmbeddingResult = {
  embedding: number[];
};

export interface AIProvider {
  chat(messages: ChatMessage[]): Promise<string>;
  embed(text: string): Promise<EmbeddingResult>;
  name(): string;
}