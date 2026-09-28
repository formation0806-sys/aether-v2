import {
  AIProvider,
  ChatCompletion,
  ChatMessage,
  EmbeddingResult,
  ProviderToolCall,
  ProviderToolSchema,
} from "../types";
import {
  CHAT_AUTH_HEADER,
  CHAT_BASE_URL,
  CHAT_MODEL,
  OLLAMA_AUTH_HEADER,
  OLLAMA_BASE_URL,
} from "../config";

/**
 * Reads Ollama's `message.tool_calls` into the provider-neutral shape.
 *
 * Never throws: a malformed entry is dropped, so a provider quirk can never
 * break a reply. The name is only carried here — it is resolved against the
 * registry, and the arguments are validated, further downstream.
 */
function readToolCalls(raw: unknown): ProviderToolCall[] {
  try {
    if (!Array.isArray(raw)) return [];

    const out: ProviderToolCall[] = [];

    for (const entry of raw) {
      if (entry === null || typeof entry !== "object") continue;

      const fn = (entry as Record<string, unknown>)["function"];

      if (fn === null || typeof fn !== "object") continue;

      const named = fn as Record<string, unknown>;
      const name = named["name"];

      if (typeof name !== "string" || name.trim() === "") continue;

      const args = readArguments(named["arguments"]);

      if (args === null) continue;

      out.push({ name: name.trim(), arguments: args });
    }

    return out;
  } catch {
    return [];
  }
}

/**
 * Arguments arrive as an object from Ollama, and as a JSON string from some
 * other providers. Both are accepted; anything else is rejected.
 */
function readArguments(raw: unknown): Record<string, unknown> | null {
  try {
    if (raw === null || raw === undefined) return {};

    if (typeof raw === "string") {
      const trimmed = raw.trim();

      if (trimmed === "") return {};

      const parsed: unknown = JSON.parse(trimmed);

      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }

      return parsed as Record<string, unknown>;
    }

    if (typeof raw !== "object" || Array.isArray(raw)) return null;

    return raw as Record<string, unknown>;
  } catch {
    return null;
  }
}

export class OllamaProvider implements AIProvider {
    /**
   * Streaming variant: sends `stream: true` and converts Ollama's NDJSON
   * response body into a Web ReadableStream of raw `message.content` text
   * chunks.  The route handler wraps each chunk into an SSE event.
   */
  async chatStream(messages: ChatMessage[]): Promise<ReadableStream<Uint8Array>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);

    let response: Response;
    try {
      response = await fetch(`${CHAT_BASE_URL}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(CHAT_AUTH_HEADER
            ? { Authorization: CHAT_AUTH_HEADER }
            : {}),
        },
        body: JSON.stringify({
          model: CHAT_MODEL,
          stream: true,
          options: {
            temperature: 0.2,
            // Assistant generation limits (chat only): the previous
            // num_predict=200 hard-capped responses at ~150 words and
            // num_ctx=2048 left almost no output room once the system
            // prompt + history were inlined, truncating normal requests
            // (e.g. "100 boys' names") after ~30 items.
            num_predict: 2048,
            top_p: 0.9,
            num_ctx: 8192,
          },
          messages,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      if ((error as Error)?.name === "AbortError") {
        throw new Error("Ollama streaming request timed out.");
      }
      throw new Error(
        `Failed to talk to Ollama. ${(error as Error)?.message ?? "network error"}`
      );
    }

    if (!response.ok) {
      clearTimeout(timer);
      let bodyText = "";
      try {
        bodyText = (await response.text()).slice(0, 500);
      } catch {
        bodyText = "(unreadable body)";
      }
      throw new Error(
        `Failed to talk to Ollama. status=${response.status} ` +
          `statusText=${response.statusText} body=${bodyText}`
      );
    }

    if (!response.body) {
      clearTimeout(timer);
      throw new Error("Ollama returned an empty response body.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let done = false;

    return new ReadableStream<Uint8Array>({
      async pull(streamController) {
        if (done) {
          streamController.close();
          return;
        }

        try {
          while (true) {
            const { value, done: readDone } = await reader.read();

            if (readDone) {
              // Flush any remaining buffered content
              if (buffer) {
                const leftover = buffer;
                buffer = "";
                streamController.enqueue(
                  new TextEncoder().encode(leftover)
                );
              }
              done = true;
              streamController.close();
              return;
            }

            buffer += decoder.decode(value, { stream: true });

            // Ollama NDJSON: one JSON object per line
            let newlineIdx: number;
            while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
              const line = buffer.slice(0, newlineIdx).trim();
              buffer = buffer.slice(newlineIdx + 1);

              if (!line) continue;

              let chunk: unknown;
              try {
                chunk = JSON.parse(line);
              } catch {
                continue; // skip malformed lines silently
              }

              const c = chunk as {
                done?: boolean;
                message?: { content?: string };
              };

              if (c.done) {
                done = true;
                streamController.close();
                return;
              }

              if (c.message?.content) {
                streamController.enqueue(
                  new TextEncoder().encode(c.message.content)
                );
              }
            }
          }
        } catch (error) {
          if ((error as Error)?.name === "AbortError") {
            streamController.error(
              new Error("Ollama streaming timed out.")
            );
          } else {
            streamController.error(error);
          }
        }
      },

            cancel() {
        clearTimeout(timer);
        reader.releaseLock();
      },
    });
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    // Bound the request so a stalled Ollama endpoint cannot hang the
    // pipeline indefinitely.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);

    try {
      const response = await fetch(
        `${CHAT_BASE_URL}/api/chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(CHAT_AUTH_HEADER ? { Authorization: CHAT_AUTH_HEADER } : {}),
          },
          body: JSON.stringify({
            model: CHAT_MODEL,

            stream: false,

            options: {
              temperature: 0.2,
              // Mirrors chatStream(): see the generation-limit note above.
              num_predict: 2048,
              top_p: 0.9,
              num_ctx: 8192,
            },

            messages,
          }),
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        let bodyText = "";

        try {
          bodyText = (await response.text()).slice(0, 500);
        } catch {
          bodyText = "(unreadable body)";
        }

        throw new Error(
          `Failed to talk to Ollama. status=${response.status} ` +
            `statusText=${response.statusText} body=${bodyText}`
        );
      }

      const data = await response.json();

      return data.message.content;
    } catch (error) {
      // Classify AbortError/timeouts and network failures so the route can
      // return a safe 503 instead of exposing a raw infra error as a 500.
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Ollama request timed out.");
      }
      if (
        error instanceof Error &&
        error.message.includes("Failed to talk to Ollama")
      ) {
        throw error;
      }
      throw new Error(
        `Failed to talk to Ollama. ${
          error instanceof Error ? error.message : "network error"
        }`
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Native tool calling.
   *
   * Sends the registered tools through Ollama's own `tools` API and returns the
   * structured `message.tool_calls` the model produced. This is the mechanism
   * that makes tool use structural instead of discretionary: the model is not
   * asked to imitate a JSON contract, it selects from a schema.
   *
   * `chat()` above is unchanged and still used whenever this method is not
   * called, so the prompt-based contract remains a working fallback.
   *
   * Tolerant on the way back: a malformed call is dropped rather than thrown, so
   * a provider quirk can never break a reply. The tool's own argument parser
   * remains the only authority on what actually runs.
   */
  async chatWithTools(
    messages: ChatMessage[],
    tools: ProviderToolSchema[]
  ): Promise<ChatCompletion> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);

    try {
      const response = await fetch(`${CHAT_BASE_URL}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(CHAT_AUTH_HEADER ? { Authorization: CHAT_AUTH_HEADER } : {}),
        },
        body: JSON.stringify({
          model: CHAT_MODEL,
          stream: false,
          tools,
          options: {
            temperature: 0.2,
            num_predict: 2048,
            top_p: 0.9,
            num_ctx: 8192,
          },
          messages,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        let bodyText = "";

        try {
          bodyText = (await response.text()).slice(0, 500);
        } catch {
          bodyText = "(unreadable body)";
        }

        throw new Error(
          `Failed to talk to Ollama. status=${response.status} ` +
            `statusText=${response.statusText} body=${bodyText}`
        );
      }

      const data = (await response.json()) as {
        message?: { content?: unknown; tool_calls?: unknown };
      };

      return {
        text: typeof data.message?.content === "string" ? data.message.content : "",
        toolCalls: readToolCalls(data.message?.tool_calls),
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Ollama request timed out.");
      }

      if (error instanceof Error && error.message.includes("Failed to talk to Ollama")) {
        throw error;
      }

      throw new Error(
        `Failed to talk to Ollama. ${
          error instanceof Error ? error.message : "network error"
        }`
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);

    try {
      const response = await fetch(
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

      if (!response.ok) {
        let bodyText = "";
        try { bodyText = (await response.text()).slice(0, 500); } catch { bodyText = "(unreadable body)"; }
        throw new Error(`Embedding failed. status=${response.status} statusText=${response.statusText} body=${bodyText}`);
      }

      const data = await response.json();

      return {
        embedding: data.embeddings[0],
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Ollama embedding request timed out.");
      }
      if (error instanceof Error && error.message.includes("Embedding failed")) {
        throw error;
      }
      throw new Error(
        `Embedding failed. ${
          error instanceof Error ? error.message : "network error"
        }`
      );
    } finally {
      clearTimeout(timer);
    }
  }

  name() {
    return "Ollama";
  }
}