/** One tool call requested by a model that supports native tool calling. */
export type ProviderToolCall = {
  /** Name of the tool the model chose. Resolved against the registry, not trusted. */
  name: string;
  /** Arguments as the model produced them. Still validated by the tool itself. */
  arguments: Record<string, unknown>;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Present on an assistant turn that requested native tool calls. */
  tool_calls?: ProviderToolCall[];
  /** Present on a tool result message: the name the corresponding call used. */
  tool_name?: string;
};

/**
 * One tool advertised to a provider that supports native tool calling.
 *
 * A description of what the tool accepts. It grants no capability: the tool's
 * own argument parser remains the only authority on what it will run.
 */
export type ProviderToolSchema = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

/** Result of one completion that may carry a native tool call. */
export type ChatCompletion = {
  /** Text the model produced alongside the call, possibly empty. */
  text: string;
  /** Native tool calls, empty when the model answered in plain text. */
  toolCalls: ProviderToolCall[];
};

export type EmbeddingResult = {
  embedding: number[];
};

export interface AIProvider {
  chat(messages: ChatMessage[]): Promise<string>;
  /**
   * Optional native tool calling.
   *
   * When present, the agent loop offers the registered tools through the
   * provider's own tool API and reads a structured tool call back, instead of
   * relying on the model to imitate the prompt-based JSON contract. Optional so
   * a provider without it keeps working through `chat()` alone.
   */
  chatWithTools?(
    messages: ChatMessage[],
    tools: ProviderToolSchema[]
  ): Promise<ChatCompletion>;
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